/**
 * PrintStudio Pro — Typed IPC Channels & RPC Contract Definitions
 * Shared between Electron Main, Preload (contextBridge), Renderer, and C# Sidecar.
 */

import type {
  AppSettings,
  BatchJobItem,
  PrinterInfo,
  PrinterMarginRequest,
  PrinterMarginResult,
  PrinterProfileSettings,
  PrintJobRequest,
  PspProjectFile,
  SpoolerJobInfo,
} from './models';

export const IPC_CHANNELS = {
  // File & Project Operations
  FILE_OPEN_DIALOG: 'file:open-dialog',
  FILE_SAVE_PDF_DIALOG: 'file:save-pdf-dialog',
  PROJECT_SAVE_PSP: 'project:save-psp',
  PROJECT_OPEN_PSP: 'project:open-psp',
  PROJECT_LOAD_AUTOSAVE: 'project:load-autosave',
  PROJECT_WRITE_AUTOSAVE: 'project:write-autosave',

  // Printer Service Sidecar (Win32 Spooler / System.Printing via Named Pipe JSON-RPC)
  PRINTER_LIST: 'printer:list',
  PRINTER_GET_CAPABILITIES: 'printer:get-capabilities',
  PRINTER_GET_MARGINS: 'printer:get-margins',
  PRINTER_UPDATE_PROFILE: 'printer:update-profile',
  PRINTER_SET_DEFAULT: 'printer:set-default',
  PRINTER_PRINT_JOB: 'printer:print-job',
  PRINTER_SILENT_PRINT: 'printer:silent-print',

  // Spooler Queue Manager (I3)
  SPOOLER_LIST_JOBS: 'spooler:list-jobs',
  SPOOLER_PAUSE_JOB: 'spooler:pause-job',
  SPOOLER_RESUME_JOB: 'spooler:resume-job',
  SPOOLER_RESTART_JOB: 'spooler:restart-job',
  SPOOLER_CANCEL_JOB: 'spooler:cancel-job',
  SPOOLER_PURGE_QUEUE: 'spooler:purge-queue',
  SPOOLER_SET_JOB_PRIORITY: 'spooler:set-job-priority',

  // Settings & System
  SETTINGS_LOAD: 'settings:load',
  SETTINGS_SAVE: 'settings:save',
  CACHE_CLEAR: 'cache:clear',
} as const;

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params: TParams;
}

export interface JsonRpcResponse<TResult = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: TResult;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface PrintStudioElectronAPI {
  isElectron: boolean;
  listPrinters(): Promise<PrinterInfo[]>;
  getPrinterMargins(request: PrinterMarginRequest): Promise<PrinterMarginResult>;
  updatePrinterProfile(printerName: string, profile: PrinterProfileSettings): Promise<PrinterInfo>;
  setDefaultPrinter(printerName: string): Promise<boolean>;
  submitPrintJob(request: PrintJobRequest, pdfBytes?: Uint8Array): Promise<SpoolerJobInfo>;
  listSpoolerJobs(printerName?: string): Promise<SpoolerJobInfo[]>;
  controlSpoolerJob(
    printerName: string,
    jobId: number,
    action: 'pause' | 'resume' | 'restart' | 'cancel',
    priority?: number
  ): Promise<boolean>;
  purgePrinterQueue(printerName: string): Promise<boolean>;
  saveAutoSaveSession(project: PspProjectFile): Promise<boolean>;
  loadAutoSaveSession(): Promise<PspProjectFile | null>;
  saveSettings(settings: AppSettings): Promise<boolean>;
  loadSettings(): Promise<AppSettings | null>;
  clearCache(): Promise<boolean>;
}

declare global {
  interface Window {
    printStudioAPI?: PrintStudioElectronAPI;
  }
}
