/**
 * PrintStudio Pro — Typed Renderer-to-Main / Sidecar IPC Bridge
 * Uses window.printStudioAPI in Electron (C# Win32 Spooler sidecar / Chromium Windows Spooler),
 * or the local Windows dev host bridge (/api/windows-printers) when running in a browser on Windows.
 * Never fabricates fake/simulated hardware printers.
 */

import type {
  AppSettings,
  PaperSizeId,
  PrinterInfo,
  PrinterMarginRequest,
  PrinterMarginResult,
  PrinterProfileSettings,
  PrintJobRequest,
  PspProjectFile,
  SettingsPreset,
  SpoolerJobInfo,
  VirtualPrinterConfig,
  VirtualPrinterIncomingPayload,
  VirtualPrinterStatus,
} from '@shared/models';
import {
  VIRTUAL_PRINTER_DEFAULT_NAME,
  sanitizeAppSettings,
  sanitizeSettingsPresetList,
} from '@shared/models';

const BROWSER_NO_WINDOWS_NOTE =
  'Browser preview cannot access local Windows printers directly (no fake printers are shown). Run the app on Windows using "npm run electron:dev" or "npm run dev" on your Windows PC.';

let cachedBrowserPrinters: PrinterInfo[] = [];
let cachedBrowserStatusNote: string | null = BROWSER_NO_WINDOWS_NOTE;

interface BrowserPrintersResponse {
  supported?: boolean;
  platform?: string;
  printers?: PrinterInfo[];
  note?: string | null;
  error?: string;
}

function canUseHttpBridge(): boolean {
  return (
    typeof fetch === 'function' &&
    typeof window !== 'undefined' &&
    typeof window.location?.protocol === 'string' &&
    /^https?:$/i.test(window.location.protocol)
  );
}

async function fetchBrowserWindowsPrinters(): Promise<BrowserPrintersResponse | null> {
  if (!canUseHttpBridge()) return null;
  try {
    const response = await fetch('/api/windows-printers', {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return null;
    return (await response.json()) as BrowserPrintersResponse;
  } catch {
    return null;
  }
}

/**
 * Selects the optimal Ready printer automatically based on paper size and color requirement (I1 Auto Select).
 */
export function selectOptimalPrinter(
  printers: PrinterInfo[],
  requiredPaper: PaperSizeId,
  needsColor: boolean
): PrinterInfo | undefined {
  const readyPrinters = printers.filter(
    (p) => p.status === 'Ready' || p.status === 'Printing' || p.status === 'LowToner'
  );
  const candidates = readyPrinters.filter((p) =>
    p.capabilities.supportedPapers.includes(requiredPaper)
  );

  if (needsColor) {
    const colorMatch = candidates.find(
      (p) => p.capabilities.supportsColor && !p.isVirtual
    );
    if (colorMatch) return colorMatch;
  } else {
    const bwMatch = candidates.find(
      (p) => !p.capabilities.supportsColor && !p.isVirtual
    );
    if (bwMatch) return bwMatch;
  }

  return (
    candidates.find((p) => p.isDefault) ??
    candidates[0] ??
    readyPrinters[0] ??
    printers[0]
  );
}

/** Never substitute a simulated printer for an unavailable Electron bridge. */
function electronApi() {
  if (window.printStudioAPI?.isElectron) return window.printStudioAPI;
  if (typeof navigator !== 'undefined' && /Electron\//i.test(navigator.userAgent)) {
    throw new Error('Electron preload bridge is unavailable');
  }
  return undefined;
}

export const ipcBridge = {
  async listPrinters(): Promise<PrinterInfo[]> {
    const api = electronApi();
    if (api) return api.listPrinters();

    const hostData = await fetchBrowserWindowsPrinters();
    if (hostData?.supported && Array.isArray(hostData.printers)) {
      cachedBrowserPrinters = structuredClone(hostData.printers);
      cachedBrowserStatusNote = hostData.note ?? null;
      return structuredClone(hostData.printers);
    }

    cachedBrowserPrinters = [];
    cachedBrowserStatusNote = hostData?.note ?? BROWSER_NO_WINDOWS_NOTE;
    return [];
  },

  /**
   * Why the real printer list is missing, in the desktop app's own words. In a non-Windows browser
   * preview there is no Windows Spooler, so it reports that honestly without fabricating printers.
   */
  async getPrinterStatusNote(): Promise<string | null> {
    const api = electronApi();
    if (!api) return cachedBrowserStatusNote;
    if (typeof api.getPrinterStatusNote !== 'function') {
      return 'The installed app is older than this bridge; restart it after reinstalling.';
    }
    return api.getPrinterStatusNote();
  },

  async getPrinterMargins(request: PrinterMarginRequest): Promise<PrinterMarginResult> {
    const api = electronApi();
    if (api) {
      if (typeof api.getPrinterMargins !== 'function') {
        return { status: 'unavailable', reason: 'Printer margin bridge unavailable' };
      }
      return api.getPrinterMargins(request);
    }
    if (canUseHttpBridge()) {
      try {
        const res = await fetch('/api/windows-margins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(request),
        });
        if (res.ok) {
          return (await res.json()) as PrinterMarginResult;
        }
      } catch {
        // Fall through to unavailable
      }
    }
    return {
      status: 'unavailable',
      reason: 'Browser preview does not have access to physical printer driver margins',
    };
  },

  async updatePrinterProfile(
    printerName: string,
    profile: PrinterProfileSettings
  ): Promise<PrinterInfo> {
    const api = electronApi();
    if (api) return api.updatePrinterProfile(printerName, profile);

    const idx = cachedBrowserPrinters.findIndex((p) => p.name === printerName);
    if (idx === -1) {
      throw new Error(`Printer "${printerName}" is not available`);
    }
    const updated: PrinterInfo = {
      ...cachedBrowserPrinters[idx],
      activeProfile: structuredClone(profile),
    };
    cachedBrowserPrinters[idx] = updated;
    return structuredClone(updated);
  },

  async setDefaultPrinter(printerName: string): Promise<boolean> {
    const api = electronApi();
    if (api) return api.setDefaultPrinter(printerName);

    if (canUseHttpBridge()) {
      try {
        const res = await fetch('/api/windows-set-default-printer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ printerName }),
        });
        if (res.ok) {
          const data = (await res.json()) as { ok?: boolean };
          return Boolean(data.ok);
        }
      } catch {
        return false;
      }
    }
    return false;
  },

  /** Native driver preferences are a desktop-only capability: never fake it in the browser. */
  async openPrinterPreferences(printerName: string): Promise<PrinterInfo[]> {
    const api = electronApi();
    if (!api) {
      throw new Error('Native Windows printer preferences are available only in the desktop app');
    }
    if (typeof api.openPrinterPreferences !== 'function') {
      throw new Error('The installed app is older than this bridge; restart it after reinstalling.');
    }
    return api.openPrinterPreferences(printerName);
  },

  async listSpoolerJobs(printerName?: string): Promise<SpoolerJobInfo[]> {
    const api = electronApi();
    if (api) return api.listSpoolerJobs(printerName);

    if (canUseHttpBridge()) {
      try {
        const query = printerName
          ? `?printerName=${encodeURIComponent(printerName)}`
          : '';
        const response = await fetch(`/api/windows-spooler-jobs${query}`, {
          headers: { Accept: 'application/json' },
        });
        if (response.ok) {
          const data = (await response.json()) as {
            supported?: boolean;
            jobs?: SpoolerJobInfo[];
          };
          if (data.supported && Array.isArray(data.jobs)) {
            return structuredClone(data.jobs);
          }
        }
      } catch {
        // Fall through to empty list
      }
    }
    return [];
  },

  async submitPrintJob(
    request: PrintJobRequest,
    _totalSheets: number,
    pdfBytes?: Uint8Array,
    pageImages?: Uint8Array[]
  ): Promise<SpoolerJobInfo> {
    const api = electronApi();
    if (api) return api.submitPrintJob(request, pdfBytes, pageImages);

    if (canUseHttpBridge() && cachedBrowserPrinters.length > 0 && pageImages && pageImages.length > 0) {
      const pageImagesBase64 = pageImages.map((bytes) => {
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return btoa(bin);
      });
      const res = await fetch('/api/windows-print-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ request, pageImagesBase64 }),
      });
      const data = (await res.json()) as SpoolerJobInfo & { error?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP print failed (${res.status})`);
      }
      return data;
    }

    throw new Error('Direct Windows spooler printing requires the Windows desktop app.');
  },

  async controlSpoolerJob(
    printerName: string,
    jobId: number,
    action: 'pause' | 'resume' | 'restart' | 'cancel',
    priority?: number
  ): Promise<SpoolerJobInfo[]> {
    const api = electronApi();
    if (api) {
      const success = await api.controlSpoolerJob(printerName, jobId, action, priority);
      if (!success) throw new Error(`Spooler ${action} failed for job ${jobId}`);
      return api.listSpoolerJobs();
    }
    throw new Error('Windows spooler job control requires the Windows desktop app.');
  },

  async purgePrinterQueue(printerName: string): Promise<SpoolerJobInfo[]> {
    const api = electronApi();
    if (api) {
      const success = await api.purgePrinterQueue(printerName);
      if (!success) throw new Error(`Could not purge queue for ${printerName}`);
      return api.listSpoolerJobs();
    }
    throw new Error('Purging the Windows spooler queue requires the Windows desktop app.');
  },

  async saveAutoSaveSession(project: PspProjectFile): Promise<boolean> {
    const api = electronApi();
    if (api) {
      return api.saveAutoSaveSession(project);
    }
    try {
      localStorage.setItem('printstudio:autosave', JSON.stringify(project));
      return true;
    } catch {
      return false;
    }
  },

  async loadAutoSaveSession(): Promise<PspProjectFile | null> {
    const api = electronApi();
    if (api) {
      return api.loadAutoSaveSession();
    }
    try {
      const raw = localStorage.getItem('printstudio:autosave');
      return raw ? (JSON.parse(raw) as PspProjectFile) : null;
    } catch {
      return null;
    }
  },

  async saveSettings(settings: AppSettings): Promise<boolean> {
    const api = electronApi();
    if (api) {
      return api.saveSettings(settings);
    }
    try {
      localStorage.setItem('printstudio:settings', JSON.stringify(settings));
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Settings used to be saved but never read back, so every start-up quietly went back to the
   * built-in defaults. Both storages are read here; `null` means "nothing stored", which the caller
   * treats as "keep the defaults" rather than as an error.
   */
  async loadSettings(): Promise<Partial<AppSettings> | null> {
    const api = electronApi();
    if (api) {
      const stored = await api.loadSettings();
      return sanitizeAppSettings(stored);
    }
    try {
      const raw = localStorage.getItem('printstudio:settings');
      return raw ? sanitizeAppSettings(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  },

  /** Saved setting profiles. Kept apart from the settings file so a reset does not erase them. */
  async saveSettingsPresets(presets: SettingsPreset[]): Promise<boolean> {
    const api = electronApi();
    if (api) {
      return api.saveSettingsPresets(presets);
    }
    try {
      localStorage.setItem('printstudio:presets', JSON.stringify(presets));
      return true;
    } catch {
      return false;
    }
  },

  async loadSettingsPresets(): Promise<SettingsPreset[]> {
    const api = electronApi();
    if (api) {
      return (await api.loadSettingsPresets()) ?? [];
    }
    try {
      const raw = localStorage.getItem('printstudio:presets');
      return raw ? sanitizeSettingsPresetList(JSON.parse(raw)) : [];
    } catch {
      return [];
    }
  },

  async listSystemFonts(forceRefresh = false): Promise<string[]> {
    const api = electronApi();
    if (api && typeof api.listSystemFonts === 'function') {
      try {
        const fonts = await api.listSystemFonts(forceRefresh);
        return Array.isArray(fonts) ? fonts : [];
      } catch {
        return [];
      }
    }
    if (canUseHttpBridge()) {
      try {
        const query = forceRefresh ? '?refresh=1' : '';
        const response = await fetch(`/api/system-fonts${query}`, {
          headers: { Accept: 'application/json' },
        });
        if (response.ok) {
          const contentType = response.headers.get('content-type') ?? '';
          if (contentType.includes('application/json')) {
            const data = (await response.json()) as { fonts?: unknown };
            if (Array.isArray(data.fonts)) {
              return data.fonts.filter((f): f is string => typeof f === 'string' && f.trim().length > 0);
            }
          }
        }
      } catch {
        // Ignore network errors and fall back to browser probes
      }
    }
    return [];
  },

  async getVirtualPrinterStatus(): Promise<VirtualPrinterStatus> {
    const api = electronApi();
    if (api && typeof api.getVirtualPrinterStatus === 'function') {
      return api.getVirtualPrinterStatus();
    }
    const storedRaw = (() => {
      try {
        const raw = localStorage.getItem('printstudio:virtual-printer-config');
        return raw ? (JSON.parse(raw) as Partial<VirtualPrinterConfig>) : null;
      } catch {
        return null;
      }
    })();
    return {
      supportedOnOs: false,
      installedInWindows: false,
      driverName: null,
      portName: null,
      spoolDir: '',
      watcherActive: false,
      lastError: null,
      config: {
        enabled: storedRaw?.enabled ?? true,
        printerName: storedRaw?.printerName || VIRTUAL_PRINTER_DEFAULT_NAME,
        paperSize: storedRaw?.paperSize ?? 'A4',
        paperWidthMm: storedRaw?.paperWidthMm ?? 210,
        paperHeightMm: storedRaw?.paperHeightMm ?? 297,
        orientation: storedRaw?.orientation ?? 'portrait',
        dpi: storedRaw?.dpi ?? 600,
        autoImportToStudio: storedRaw?.autoImportToStudio ?? true,
        switchToStudioOnReceive: storedRaw?.switchToStudioOnReceive ?? true,
      },
      recentJobs: [],
    };
  },

  async updateVirtualPrinterConfig(
    patch: Partial<VirtualPrinterConfig>
  ): Promise<VirtualPrinterStatus> {
    const api = electronApi();
    if (api && typeof api.updateVirtualPrinterConfig === 'function') {
      return api.updateVirtualPrinterConfig(patch);
    }
    const current = await this.getVirtualPrinterStatus();
    const nextConfig: VirtualPrinterConfig = {
      ...current.config,
      ...patch,
    };
    try {
      localStorage.setItem(
        'printstudio:virtual-printer-config',
        JSON.stringify(nextConfig)
      );
    } catch {
      // Ignore storage quota errors
    }
    return {
      ...current,
      config: nextConfig,
    };
  },

  async installVirtualPrinter(): Promise<VirtualPrinterStatus> {
    const api = electronApi();
    if (api && typeof api.installVirtualPrinter === 'function') {
      return api.installVirtualPrinter();
    }
    throw new Error(
      'Installing the Windows Virtual Printer requires the Windows desktop app.'
    );
  },

  async uninstallVirtualPrinter(): Promise<VirtualPrinterStatus> {
    const api = electronApi();
    if (api && typeof api.uninstallVirtualPrinter === 'function') {
      return api.uninstallVirtualPrinter();
    }
    throw new Error(
      'Uninstalling the Windows Virtual Printer requires the Windows desktop app.'
    );
  },

  listenForVirtualPrinterJobs(
    callback: (payload: VirtualPrinterIncomingPayload) => void
  ): () => void {
    const api = window.printStudioAPI;
    if (api?.isElectron && typeof api.onVirtualPrinterJob === 'function') {
      return api.onVirtualPrinterJob(callback);
    }
    return () => undefined;
  },
};
