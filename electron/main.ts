import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { PrinterSidecarClient } from './printerSidecarClient';
import { SessionStore } from './sessionStore';
import type {
  AppSettings,
  PrinterProfileSettings,
  PrintJobRequest,
  PspProjectFile,
} from '../shared/models';

const sidecar = new PrinterSidecarClient();
let mainWindow: BrowserWindow | null = null;
let sessionStore: SessionStore;

// Enforce Single-Instance Lock (K3)
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', (_event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    // Forward CLI file paths (A2: Open with Windows / Command Line)
    const fileArgs = commandLine.slice(2).filter((arg) => !arg.startsWith('--'));
    if (fileArgs.length > 0) {
      mainWindow.webContents.send('cli:open-files', fileArgs);
    }
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

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PRINTER_LIST, async () => {
    return sidecar.listPrinters();
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
      return sidecar.submitPrintJob(payload.request, tempPdfPath);
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
