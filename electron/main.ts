import { app, BrowserWindow, clipboard, ipcMain, Menu, session } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { IPC_CHANNELS, type ClipboardImagePayload, type LocalFilePayload } from '../shared/ipc-channels';
import { PrinterSidecarClient } from './printerSidecarClient';
import { SessionStore } from './sessionStore';
import { listInstalledSystemFonts } from './systemFonts';
import { VirtualPrinterManager } from './virtualPrinter';
import {
  applyProfileToWindowsPrinterViaPowerShell,
  enrichVirtualPrinterInfo,
  isVirtualPrinterName,
  mapElectronPrintersToPrinterInfo,
  printToWindowsPrinterViaPowerShell,
  queryWindowsPrinterMarginsViaPowerShell,
  queryWindowsPrintersViaPowerShell,
  queryWindowsSpoolerJobsViaPowerShell,
  setWindowsDefaultPrinterViaPowerShell,
} from './windowsPrinterFallback';
import {
  VIRTUAL_PRINTER_DEFAULT_NAME,
  type AppSettings,
  type PrinterInfo,
  type PrinterProfileSettings,
  type PrinterMarginRequest,
  type PrintJobRequest,
  type PspProjectFile,
  type SettingsPreset,
  type VirtualPrinterConfig,
  type VirtualPrinterIncomingPayload,
} from '../shared/models';

/** Anything bigger than this is not something a preview app should hold in memory twice. */
const MAX_NATIVE_FILE_BYTES = 128 * 1024 * 1024;
/** Extensions the import pipeline can read; used to ignore stray arguments. */
const NATIVE_FILE_EXTENSIONS = /\.(pdf|png|jpe?g|webp|gif|bmp|tiff?|svg)$/i;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  svg: 'image/svg+xml',
};

const sidecar = new PrinterSidecarClient();
let mainWindow: BrowserWindow | null = null;
let sessionStore: SessionStore;
let virtualPrinterManager: VirtualPrinterManager | null = null;
let lastNativeFallbackWorked = false;
/** User-edited printer profiles preserved across refreshes when using Windows PowerShell fallback. */
const userProfileOverrides = new Map<string, PrinterProfileSettings>();
let lastKnownPrinters: PrinterInfo[] = [];

interface QueuedProfileSync {
  latestProfile: PrinterProfileSettings;
  running: Promise<void> | null;
  dirty: boolean;
}
const fallbackProfileSyncQueue = new Map<string, QueuedProfileSync>();

function isPrintStudioVirtualPrinter(printerName: string): boolean {
  const configuredName = virtualPrinterManager?.getConfig().printerName || VIRTUAL_PRINTER_DEFAULT_NAME;
  return (
    printerName.trim().toLowerCase() === configuredName.toLowerCase() ||
    printerName.trim().toLowerCase() === VIRTUAL_PRINTER_DEFAULT_NAME.toLowerCase()
  );
}

function queueFallbackProfileSync(printerName: string, profile: PrinterProfileSettings): Promise<void> {
  if (
    process.platform !== 'win32' ||
    sidecar.isRunning ||
    (isVirtualPrinterName(printerName) && !isPrintStudioVirtualPrinter(printerName))
  ) {
    return Promise.resolve();
  }
  const key = printerName.toLowerCase();
  let entry = fallbackProfileSyncQueue.get(key);
  if (!entry) {
    entry = { latestProfile: profile, running: null, dirty: true };
    fallbackProfileSyncQueue.set(key, entry);
  } else {
    entry.latestProfile = profile;
    entry.dirty = true;
  }

  if (!entry.running) {
    entry.running = (async () => {
      try {
        while (entry.dirty) {
          entry.dirty = false;
          const toApply = entry.latestProfile;
          await applyProfileToWindowsPrinterViaPowerShell(printerName, toApply).catch(() => false);
        }
      } finally {
        entry.running = null;
      }
    })();
  }
  return entry.running;
}

async function flushFallbackProfileSync(printerName: string): Promise<void> {
  const key = printerName.toLowerCase();
  const entry = fallbackProfileSyncQueue.get(key);
  while (entry?.running) {
    await entry.running.catch(() => undefined);
  }
}

/** Files that arrived before the renderer had a listener, flushed once it does. */
let pendingOpenFiles: string[] = [];
/** Jobs captured by the Windows Virtual Printer before renderer finished loading. */
let pendingVirtualJobs: VirtualPrinterIncomingPayload[] = [];

// Enforce Single-Instance Lock (K3)
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

/**
 * The window must never leave the app. A file dropped on a spot nothing claims, a link a renderer
 * follows, a `window.open` — each would replace the workspace with the raw file and the operator
 * loses the desk they were working on (this is the classic symptom of a file drop on Windows:
 * the app turns into the PDF viewer instead of importing the file). Only the part of the filesystem
 * the app itself was loaded from is allowed, and in dev only the Vite origin.
 */
function isAppUrl(url: string, appDir: string | null): boolean {
  try {
    const target = new URL(url);
    if (appDir) {
      if (target.protocol !== 'file:') return false;
      // Windows paths arrive percent-encoded (`Program%20Files`) and with a leading slash.
      const loaded = path.resolve(decodeURIComponent(target.pathname).replace(/^\/([A-Za-z]:)/, '$1'));
      return loaded === appDir || loaded.startsWith(appDir + path.sep);
    }
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    return !!devServerUrl && target.origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}

/** Only existing files with a document extension count; switches and the app path do not. */
function fileArguments(argv: string[]): string[] {
  return argv.filter((arg) => NATIVE_FILE_EXTENSIONS.test(arg) && path.isAbsolute(arg));
}

function sendOpenFiles(paths: string[]): void {
  if (!paths.length) return;
  if (!mainWindow || mainWindow.webContents.isLoadingMainFrame()) {
    pendingOpenFiles = [...pendingOpenFiles, ...paths];
    return;
  }
  mainWindow.webContents.send(IPC_CHANNELS.CLI_OPEN_FILES, paths);
}

function sendVirtualPrinterJob(payload: VirtualPrinterIncomingPayload): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoadingMainFrame()) {
    pendingVirtualJobs = [...pendingVirtualJobs, payload];
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainWindow.webContents.send(IPC_CHANNELS.VIRTUAL_PRINTER_JOB_RECEIVED, payload);
}

app.on('second-instance', (_event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    // Forward CLI file paths (A2: Open with Windows / Command Line)
    sendOpenFiles(fileArguments(commandLine.slice(1)));
  }
});

async function createMainWindow(): Promise<void> {
  const userDataDir = app.getPath('userData');
  sessionStore = new SessionStore(userDataDir);
  virtualPrinterManager = new VirtualPrinterManager(sessionStore, userDataDir);
  await virtualPrinterManager.startWatching((payload) => {
    sendVirtualPrinterJob(payload);
  });
  sidecar.startSidecar(process.resourcesPath);

  // Enforce strict Content Security Policy header
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' file: blob: data:; script-src 'self' file: 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' file: 'unsafe-inline'; img-src 'self' file: data: blob:; font-src 'self' file: data:; connect-src 'self' file: blob: data: https: http: wss: ws:; worker-src 'self' file: blob:;",
        ],
      },
    });
  });

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: 'PrintStudio Pro',
    backgroundColor: '#020617',
    webPreferences: {
      // The preload is a single CommonJS bundle (`npm run build:preload`): a sandboxed renderer
      // cannot load an ESM preload script, and silently loses window.printStudioAPI if it is tried.
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  // Files given to the *first* instance (`PrintStudio.exe scan.png`, Explorer "Open with…").
  const startupFiles = fileArguments(process.argv.slice(1));

  mainWindow.webContents.once('did-finish-load', () => {
    if (startupFiles.length) sendOpenFiles(startupFiles);
    else if (pendingOpenFiles.length) {
      const queued = pendingOpenFiles;
      pendingOpenFiles = [];
      mainWindow?.webContents.send(IPC_CHANNELS.CLI_OPEN_FILES, queued);
    }
    if (pendingVirtualJobs.length) {
      const queuedJobs = pendingVirtualJobs;
      pendingVirtualJobs = [];
      for (const jobPayload of queuedJobs) {
        mainWindow?.webContents.send(IPC_CHANNELS.VIRTUAL_PRINTER_JOB_RECEIVED, jobPayload);
      }
    }
  });

  const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/g, (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch)
    );

  const showLoadFailurePage = (title: string, details: string): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>PrintStudio Pro — Load Error</title></head>
<body style="margin:0;padding:32px;background:#020617;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;">
  <div style="max-width:680px;margin:48px auto;padding:24px;border-radius:12px;background:#0f172a;border:1px solid #334155;">
    <h1 style="margin:0 0 12px;font-size:20px;color:#f87171;">${escapeHtml(title)}</h1>
    <pre style="white-space:pre-wrap;word-break:break-word;background:#020617;padding:12px;border-radius:8px;border:1px solid #1e293b;color:#cbd5e1;font-size:13px;">${escapeHtml(details)}</pre>
  </div>
</body>
</html>`;
    void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  };

  let retriedLoopback = false;
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || validatedURL.startsWith('data:text/html')) return;
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (!retriedLoopback && devServerUrl && devServerUrl.includes('localhost')) {
      retriedLoopback = true;
      const ipv4Url = devServerUrl.replace('localhost', '127.0.0.1');
      void mainWindow?.loadURL(ipv4Url).catch(() => undefined);
      return;
    }
    showLoadFailurePage(
      'Failed to load PrintStudio Pro UI',
      `Code: ${errorCode}\nDescription: ${errorDescription}\nURL: ${validatedURL}`
    );
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    showLoadFailurePage(
      'Renderer process exited unexpectedly',
      `Reason: ${details.reason}\nExit Code: ${details.exitCode}`
    );
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const contents = mainWindow.webContents;
  contents.on('will-navigate', (event, url) => {
    // The renderer's own folder, written out the way `packaging.test.ts` pins it for the load below.
    const appDir = devServerUrl ? null : path.dirname(path.join(__dirname, '../../dist/index.html'));
    if (!isAppUrl(url, appDir)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // The guard is registered before the load, or the very navigation it exists to stop can already
  // have happened by the time the try/catch around the load is running.
  try {
    if (devServerUrl) {
      await mainWindow.loadURL(devServerUrl);
    } else {
      // `__dirname` is <resources>/dist-electron/electron once packed, so the renderer is two up.
      await mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    }
  } catch (err) {
    showLoadFailurePage(
      'Failed to load PrintStudio Pro UI',
      err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
    );
  }
}

/**
 * Runs a sidecar call with a message the operator can act on: the raw pipe error alone says
 * nothing about a missing executable or a service that died on startup, which is exactly what an
 * empty printer list otherwise hides.
 */
async function withSidecarDiagnostics<TResult>(action: Promise<TResult>): Promise<TResult> {
  const blocked = sidecar.blockedReason;
  if (blocked) throw new Error(blocked);
  try {
    return await action;
  } catch (error) {
    throw new Error(sidecar.describeFailure(error));
  }
}

function applyCachedProfileOverrides(printers: PrinterInfo[]): PrinterInfo[] {
  const vpConfig = virtualPrinterManager?.getConfig();
  return printers.map((rawPrinter) => {
    const printer = enrichVirtualPrinterInfo(rawPrinter, vpConfig);
    const override = userProfileOverrides.get(printer.name);
    if (!override) return printer;
    return {
      ...printer,
      activeProfile: {
        ...printer.activeProfile,
        ...override,
        printerName: printer.name,
      },
    };
  });
}

async function listRealWindowsPrinters(): Promise<PrinterInfo[]> {
  try {
    const printers = await withSidecarDiagnostics(sidecar.listPrinters());
    lastNativeFallbackWorked = false;
    const resolved = applyCachedProfileOverrides(printers);
    lastKnownPrinters = resolved;
    return resolved;
  } catch (sidecarError) {
    if (process.platform !== 'win32') {
      throw sidecarError;
    }

    // On Windows, if PrinterService.exe has not been compiled (e.g. no .NET 8 SDK),
    // enumerate real Windows printers directly via Win32_Printer PowerShell and Chromium Spooler.
    const psPrinters = await queryWindowsPrintersViaPowerShell().catch(() => []);
    if (psPrinters.length > 0) {
      lastNativeFallbackWorked = true;
      const resolved = applyCachedProfileOverrides(psPrinters);
      lastKnownPrinters = resolved;
      return resolved;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      const nativePrinters = await mainWindow.webContents.getPrintersAsync().catch(() => []);
      const mapped = mapElectronPrintersToPrinterInfo(nativePrinters);
      if (mapped.length > 0) {
        lastNativeFallbackWorked = true;
        const resolved = applyCachedProfileOverrides(mapped);
        lastKnownPrinters = resolved;
        return resolved;
      }
    }

    lastNativeFallbackWorked = false;
    throw sidecarError;
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PRINTER_LIST, async () => {
    return listRealWindowsPrinters();
  });

  ipcMain.handle(IPC_CHANNELS.PRINTER_STATUS_NOTE, async () => {
    if (lastNativeFallbackWorked) return null;
    return sidecar.statusNote();
  });

  ipcMain.handle(IPC_CHANNELS.PRINTER_GET_MARGINS, async (_e, request: PrinterMarginRequest) => {
    if (!request || typeof request.printerName !== 'string' || !request.printerName ||
      !Number.isFinite(request.widthMm) || !Number.isFinite(request.heightMm) ||
      request.widthMm <= 0 || request.heightMm <= 0 || request.widthMm > 2000 || request.heightMm > 2000 ||
      !['portrait','landscape'].includes(request.orientation)) throw new Error('Invalid printer margin request');
    try {
      return await withSidecarDiagnostics(sidecar.getPrinterMargins(request));
    } catch (error) {
      if (process.platform === 'win32') {
        return queryWindowsPrinterMarginsViaPowerShell(request);
      }
      throw error;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.PRINTER_UPDATE_PROFILE,
    async (
      _e,
      payload: { printerName: string; profile: PrinterProfileSettings }
    ) => {
      const mergedProfile: PrinterProfileSettings = {
        ...payload.profile,
        printerName: payload.printerName,
      };
      userProfileOverrides.set(payload.printerName, mergedProfile);
      if (virtualPrinterManager && isPrintStudioVirtualPrinter(payload.printerName)) {
        await virtualPrinterManager.updateConfig({
          paperSize: mergedProfile.paperSize,
          ...(mergedProfile.paperWidthMm ? { paperWidthMm: mergedProfile.paperWidthMm } : {}),
          ...(mergedProfile.paperHeightMm ? { paperHeightMm: mergedProfile.paperHeightMm } : {}),
          orientation: mergedProfile.orientation,
          dpi: mergedProfile.dpi,
        });
      }
      try {
        if (sidecar.isRunning) {
          const updated = await sidecar.updateProfile(payload.printerName, mergedProfile);
          const enriched = enrichVirtualPrinterInfo(updated, virtualPrinterManager?.getConfig());
          lastKnownPrinters = lastKnownPrinters.map((p) =>
            p.name.toLowerCase() === payload.printerName.toLowerCase() ? enriched : p
          );
          return enriched;
        }
      } catch {
        // Fall back to syncing Windows DEVMODE/UserPrintTicket via PowerShell
      }
      void queueFallbackProfileSync(payload.printerName, mergedProfile);
      const cachedMatch = lastKnownPrinters.find(
        (p) => p.name.toLowerCase() === payload.printerName.toLowerCase()
      );
      if (cachedMatch) {
        const updatedCached = enrichVirtualPrinterInfo(
          {
            ...cachedMatch,
            activeProfile: {
              ...cachedMatch.activeProfile,
              ...mergedProfile,
              printerName: cachedMatch.name,
            },
          },
          virtualPrinterManager?.getConfig()
        );
        lastKnownPrinters = lastKnownPrinters.map((p) =>
          p.name.toLowerCase() === payload.printerName.toLowerCase() ? updatedCached : p
        );
        return updatedCached;
      }
      const printers = await listRealWindowsPrinters();
      const matched = printers.find(
        (p) => p.name.toLowerCase() === payload.printerName.toLowerCase()
      );
      if (matched) return matched;
      throw new Error(`Printer "${payload.printerName}" is not available`);
    }
  );

  ipcMain.handle(IPC_CHANNELS.PRINTER_SET_DEFAULT, async (_e, printerName: string) => {
    try {
      return await withSidecarDiagnostics(sidecar.setDefaultPrinter(printerName));
    } catch (error) {
      if (process.platform === 'win32') {
        return setWindowsDefaultPrinterViaPowerShell(printerName);
      }
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.PRINTER_OPEN_PREFERENCES, async (_e, printerName: string) => {
    if (process.platform !== 'win32') throw new Error('Windows printer preferences are only available on Windows');
    if (typeof printerName !== 'string' || !printerName.trim()) throw new Error('A printer must be selected');
    await flushFallbackProfileSync(printerName);
    await new Promise<void>((resolve, reject) => {
      execFile('rundll32.exe', ['printui.dll,PrintUIEntry', '/e', '/n', printerName], { windowsHide: false }, (error) => {
        if (error) reject(new Error(`Could not open Windows printer preferences: ${error.message}`));
        else resolve();
      });
    });
    // Native Windows driver preferences take precedence; clear cached override so fresh driver settings load.
    userProfileOverrides.delete(printerName);
    if (sidecar.isRunning) {
      await sidecar.reloadProfile(printerName).catch(() => undefined);
    }
    return listRealWindowsPrinters();
  });

  ipcMain.handle(
    IPC_CHANNELS.PRINTER_PRINT_JOB,
    async (
      _e,
      payload: { request: PrintJobRequest; pdfBytes?: Uint8Array; pageImages?: Uint8Array[] }
    ) => {
      if (virtualPrinterManager && isPrintStudioVirtualPrinter(payload.request?.printerName || '')) {
        return virtualPrinterManager.captureInAppPrintJob(
          payload.request,
          payload.pdfBytes,
          payload.pageImages
        );
      }

      let tempPdfPath: string | undefined;
      const tempImagePaths: string[] = [];
      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      if (payload.pdfBytes && payload.pdfBytes.byteLength > 0) {
        tempPdfPath = path.join(os.tmpdir(), `printstudio-job-${stamp}.pdf`);
        await fs.writeFile(tempPdfPath, Buffer.from(payload.pdfBytes));
      }
      if (Array.isArray(payload.pageImages) && payload.pageImages.length > 0) {
        for (let i = 0; i < payload.pageImages.length; i++) {
          const imgPath = path.join(os.tmpdir(), `printstudio-page-${stamp}-${i + 1}.png`);
          await fs.writeFile(imgPath, Buffer.from(payload.pageImages[i]));
          tempImagePaths.push(imgPath);
        }
      }
      try {
        if (payload.request?.printerName) {
          await flushFallbackProfileSync(payload.request.printerName);
        }
        if (sidecar.isRunning) {
          return await sidecar.submitPrintJob(payload.request, tempPdfPath, tempImagePaths);
        }
        if (process.platform === 'win32') {
          return await printToWindowsPrinterViaPowerShell(payload.request, tempImagePaths);
        }
        return await withSidecarDiagnostics(
          sidecar.submitPrintJob(payload.request, tempPdfPath, tempImagePaths)
        );
      } finally {
        // The spooler has the bytes by the time the RPC answers, so temporary job files must not stay behind.
        if (tempPdfPath) await fs.rm(tempPdfPath, { force: true }).catch(() => undefined);
        await Promise.all(
          tempImagePaths.map((p) => fs.rm(p, { force: true }).catch(() => undefined))
        );
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.VIRTUAL_PRINTER_GET_STATUS, async () => {
    if (!virtualPrinterManager) {
      throw new Error('Virtual printer manager is not initialized');
    }
    return virtualPrinterManager.getStatus(true);
  });

  ipcMain.handle(
    IPC_CHANNELS.VIRTUAL_PRINTER_UPDATE_CONFIG,
    async (_e, patch: Partial<VirtualPrinterConfig>) => {
      if (!virtualPrinterManager) {
        throw new Error('Virtual printer manager is not initialized');
      }
      return virtualPrinterManager.updateConfig(patch ?? {});
    }
  );

  ipcMain.handle(IPC_CHANNELS.VIRTUAL_PRINTER_INSTALL, async () => {
    if (!virtualPrinterManager) {
      throw new Error('Virtual printer manager is not initialized');
    }
    return virtualPrinterManager.install();
  });

  ipcMain.handle(IPC_CHANNELS.VIRTUAL_PRINTER_UNINSTALL, async () => {
    if (!virtualPrinterManager) {
      throw new Error('Virtual printer manager is not initialized');
    }
    return virtualPrinterManager.uninstall();
  });

  ipcMain.handle(IPC_CHANNELS.SPOOLER_LIST_JOBS, async (_e, printerName?: string) => {
    try {
      return await withSidecarDiagnostics(sidecar.listSpoolerJobs(printerName));
    } catch (error) {
      if (process.platform === 'win32') {
        return queryWindowsSpoolerJobsViaPowerShell(printerName);
      }
      throw error;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.SPOOLER_PAUSE_JOB,
    async (
      _e,
      payload: {
        printerName: string;
        jobId: number;
        action: 'pause' | 'resume' | 'restart' | 'cancel';
        priority?: number;
      }
    ) => {
      return sidecar.controlSpoolerJob(
        payload.printerName,
        payload.jobId,
        payload.action,
        payload.priority
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.SPOOLER_PURGE_QUEUE, async (_e, printerName: string) => {
    return sidecar.purgeQueue(printerName);
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_WRITE_AUTOSAVE, async (_e, project: PspProjectFile) => {
    return sessionStore.writeAutoSave(project);
  });

  ipcMain.handle(IPC_CHANNELS.PROJECT_LOAD_AUTOSAVE, async () => {
    return sessionStore.readAutoSave();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, async (_e, settings: AppSettings) => {
    return sessionStore.saveSettings(settings);
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_LOAD, async () => {
    return sessionStore.loadSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_PRESETS_SAVE, async (_e, presets: SettingsPreset[]) => {
    return sessionStore.saveSettingsPresets(Array.isArray(presets) ? presets : []);
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_PRESETS_LOAD, async () => {
    return sessionStore.loadSettingsPresets();
  });

  ipcMain.handle(IPC_CHANNELS.SYSTEM_LIST_FONTS, async (_e, forceRefresh?: boolean) => {
    return listInstalledSystemFonts(Boolean(forceRefresh));
  });

  ipcMain.handle(IPC_CHANNELS.FILE_READ_LOCAL, async (_e, filePath: unknown): Promise<LocalFilePayload> => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid file path');
    const resolved = path.resolve(filePath);
    const stats = await fs.stat(resolved);
    if (!stats.isFile()) throw new Error('Not a file');
    if (stats.size > MAX_NATIVE_FILE_BYTES) throw new Error(`File is larger than ${Math.floor(MAX_NATIVE_FILE_BYTES / (1024 * 1024))} MB`);
    const bytes = await fs.readFile(resolved);
    const extension = path.extname(resolved).slice(1).toLowerCase();
    return {
      name: path.basename(resolved),
      path: resolved,
      size: stats.size,
      mimeType: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    };
  });

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_READ_IMAGE, async (): Promise<ClipboardImagePayload | null> => {
    const img = clipboard.readImage();
    if (!img || img.isEmpty()) return null;
    const png = img.toPNG();
    if (!png || png.byteLength === 0) return null;
    return {
      name: `clipboard-image-${Date.now()}.png`,
      mimeType: 'image/png',
      bytes: new Uint8Array(png.buffer, png.byteOffset, png.byteLength),
    };
  });

  ipcMain.handle(IPC_CHANNELS.CACHE_CLEAR, async () => {
    if (mainWindow) {
      await mainWindow.webContents.session.clearCache();
    }
    return true;
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  await createMainWindow();
});

app.on('window-all-closed', () => {
  virtualPrinterManager?.stopWatching();
  sidecar.stopSidecar();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
