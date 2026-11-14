import { app, BrowserWindow, ipcMain, session } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs/promises';
import { IPC_CHANNELS, type LocalFilePayload } from '../shared/ipc-channels.js';
import { PrinterSidecarClient } from './printerSidecarClient.js';
import { SessionStore } from './sessionStore.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import type {
  AppSettings,
  PrinterProfileSettings,
  PrinterMarginRequest,
  PrintJobRequest,
  PspProjectFile,
} from '../shared/models.js';

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
/** Files that arrived before the renderer had a listener, flushed once it does. */
let pendingOpenFiles: string[] = [];

// Enforce Single-Instance Lock (K3)
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
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

app.on('second-instance', (_event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    // Forward CLI file paths (A2: Open with Windows / Command Line)
    sendOpenFiles(fileArguments(commandLine.slice(1)));
  }
});

async function createMainWindow(): Promise<void> {
  sessionStore = new SessionStore(app.getPath('userData'));
  sidecar.startSidecar(process.resourcesPath);

  // Enforce strict Content Security Policy header
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:;",
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Files given to the *first* instance (`PrintStudio.exe scan.png`, Explorer "Open with…").
  const startupFiles = fileArguments(process.argv.slice(1));

  mainWindow.webContents.once('did-finish-load', () => {
    if (startupFiles.length) sendOpenFiles(startupFiles);
    else if (pendingOpenFiles.length) {
      const queued = pendingOpenFiles;
      pendingOpenFiles = [];
      mainWindow?.webContents.send(IPC_CHANNELS.CLI_OPEN_FILES, queued);
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PRINTER_LIST, async () => {
    return sidecar.listPrinters();
  });

  ipcMain.handle(IPC_CHANNELS.PRINTER_GET_MARGINS, async (_e, request: PrinterMarginRequest) => {
    if (!request || typeof request.printerName !== 'string' || !request.printerName ||
      !Number.isFinite(request.widthMm) || !Number.isFinite(request.heightMm) ||
      request.widthMm <= 0 || request.heightMm <= 0 || request.widthMm > 2000 || request.heightMm > 2000 ||
      !['portrait','landscape'].includes(request.orientation)) throw new Error('Invalid printer margin request');
    return sidecar.getPrinterMargins(request);
  });

  ipcMain.handle(
    IPC_CHANNELS.PRINTER_UPDATE_PROFILE,
    async (
      _e,
      payload: { printerName: string; profile: PrinterProfileSettings }
    ) => {
      return sidecar.updateProfile(payload.printerName, payload.profile);
    }
  );

  ipcMain.handle(IPC_CHANNELS.PRINTER_SET_DEFAULT, async (_e, printerName: string) => {
    return sidecar.setDefaultPrinter(printerName);
  });

  ipcMain.handle(IPC_CHANNELS.PRINTER_OPEN_PREFERENCES, async (_e, printerName: string) => {
    if (process.platform !== 'win32') throw new Error('Windows printer preferences are only available on Windows');
    if (typeof printerName !== 'string' || !printerName.trim()) throw new Error('A printer must be selected');
    await new Promise<void>((resolve, reject) => {
      execFile('rundll32.exe', ['printui.dll,PrintUIEntry', '/e', '/n', printerName], { windowsHide: false }, (error) => {
        if (error) reject(new Error(`Could not open Windows printer preferences: ${error.message}`));
        else resolve();
      });
    });
    // Refresh after the native dialog closes so paper size and orientation reflect the driver.
    return sidecar.listPrinters();
  });

  ipcMain.handle(
    IPC_CHANNELS.PRINTER_PRINT_JOB,
    async (
      _e,
      payload: { request: PrintJobRequest; pdfBytes?: Uint8Array }
    ) => {
      let tempPdfPath: string | undefined;
      if (payload.pdfBytes) {
        tempPdfPath = path.join(
          os.tmpdir(),
          `printstudio-job-${Date.now()}.pdf`
        );
        await fs.writeFile(tempPdfPath, Buffer.from(payload.pdfBytes));
      }
      try {
        return await sidecar.submitPrintJob(payload.request, tempPdfPath);
      } finally {
        // The spooler has the bytes by the time the RPC answers, so the job file must not stay
        // behind: one per print job in a directory nobody cleans would fill the disk.
        if (tempPdfPath) await fs.rm(tempPdfPath, { force: true }).catch(() => undefined);
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.SPOOLER_LIST_JOBS, async (_e, printerName?: string) => {
    return sidecar.listSpoolerJobs(printerName);
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

  ipcMain.handle(IPC_CHANNELS.CACHE_CLEAR, async () => {
    if (mainWindow) {
      await mainWindow.webContents.session.clearCache();
    }
    return true;
  });
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await createMainWindow();
});

app.on('window-all-closed', () => {
  sidecar.stopSidecar();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
