import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type PrintStudioElectronAPI,
} from '../shared/ipc-channels.js';
import type {
  AppSettings,
  PrinterProfileSettings,
  PrinterMarginRequest,
  PrintJobRequest,
  PspProjectFile,
} from '../shared/models.js';

/**
 * Secure Preload Bridge with contextIsolation: true and nodeIntegration: false.
 * Exposes only strictly typed IPC channels under window.printStudioAPI.
 */
const api: PrintStudioElectronAPI = {
  isElectron: true,

  listPrinters: () => ipcRenderer.invoke(IPC_CHANNELS.PRINTER_LIST),
  getPrinterMargins: (request: PrinterMarginRequest) => ipcRenderer.invoke(IPC_CHANNELS.PRINTER_GET_MARGINS, request),

  updatePrinterProfile: (printerName: string, profile: PrinterProfileSettings) =>
    ipcRenderer.invoke(IPC_CHANNELS.PRINTER_UPDATE_PROFILE, { printerName, profile }),

  setDefaultPrinter: (printerName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.PRINTER_SET_DEFAULT, printerName),

  submitPrintJob: (request: PrintJobRequest, pdfBytes?: Uint8Array) =>
    ipcRenderer.invoke(IPC_CHANNELS.PRINTER_PRINT_JOB, { request, pdfBytes }),

  listSpoolerJobs: (printerName?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SPOOLER_LIST_JOBS, printerName),

  controlSpoolerJob: (
    printerName: string,
    jobId: number,
    action: 'pause' | 'resume' | 'restart' | 'cancel',
    priority?: number
  ) =>
    ipcRenderer.invoke(IPC_CHANNELS.SPOOLER_PAUSE_JOB, {
      printerName,
      jobId,
      action,
      priority,
    }),

  purgePrinterQueue: (printerName: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SPOOLER_PURGE_QUEUE, printerName),

  saveAutoSaveSession: (project: PspProjectFile) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROJECT_WRITE_AUTOSAVE, project),

  loadAutoSaveSession: () => ipcRenderer.invoke(IPC_CHANNELS.PROJECT_LOAD_AUTOSAVE),

  saveSettings: (settings: AppSettings) =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, settings),

  loadSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_LOAD),

  clearCache: () => ipcRenderer.invoke(IPC_CHANNELS.CACHE_CLEAR),

  readLocalFile: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ_LOCAL, path),

  onCliOpenFiles: (callback: (paths: string[]) => void) => {
    const listener = (_event: unknown, paths: string[]) => callback(Array.isArray(paths) ? paths : []);
    ipcRenderer.on(IPC_CHANNELS.CLI_OPEN_FILES, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.CLI_OPEN_FILES, listener);
    };
  },
};

contextBridge.exposeInMainWorld('printStudioAPI', api);
