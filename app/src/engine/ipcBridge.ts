/**
 * PrintStudio Pro — Typed Renderer-to-Main / Sidecar IPC Bridge
 * Uses window.printStudioAPI in Electron and seamlessly provides a realistic
 * Win32 Spooler & PrinterService simulator when running in Web Preview mode.
 */

import type {
  AppSettings,
  DuplexMode,
  PageOrientation,
  PaperSizeId,
  PrinterInfo,
  PrinterMarginRequest,
  PrinterMarginResult,
  PrinterProfileSettings,
  PrintJobRequest,
  PspProjectFile,
  SpoolerJobInfo,
} from '@shared/models';

const INITIAL_PRINTERS: PrinterInfo[] = [
  {
    name: 'Konica Minolta Bizhub C458 (Production Color)',
    driverName: 'KONICA MINOLTA C458 Series PCL6',
    portName: 'IP_192.168.10.45',
    isDefault: true,
    isNetwork: true,
    isVirtual: false,
    status: 'Ready',
    jobsInQueue: 1,
    tonerLevelPercent: 84,
    totalPageCounter: 148920,
    location: 'سالن اصلی چاپ دیجیتال — دستگاه ۱',
    capabilities: {
      supportedPapers: ['A3', 'A4', 'A5', 'B4', 'B5', 'Letter', 'Legal', 'Custom'],
      supportedTrays: ['Auto Select', 'Tray 1 (A4 Plain)', 'Tray 2 (A3 Glossy)', 'Tray 3 (Heavy 200g)', 'Bypass Tray'],
      supportedMediaTypes: ['Plain Paper 80g', 'Glossy Coated 135g', 'Heavyweight 220g', 'Label Stock'],
      supportsDuplex: true,
      supportsColor: true,
      supportedDpi: [300, 600, 1200],
      maxCopies: 999,
    },
    activeProfile: {
      printerName: 'Konica Minolta Bizhub C458 (Production Color)',
      paperSize: 'A4',
      tray: 'Auto Select',
      mediaType: 'Plain Paper 80g',
      duplexMode: 'long-edge',
      orientation: 'portrait',
      colorMode: 'color',
      dpi: 600,
      quality: 'high',
    },
  },
  {
    name: 'HP LaserJet Enterprise M611dn (High-Speed B&W)',
    driverName: 'HP Universal Printing PCL 6',
    portName: 'IP_192.168.10.48',
    isDefault: false,
    isNetwork: true,
    isVirtual: false,
    status: 'Ready',
    jobsInQueue: 1,
    tonerLevelPercent: 62,
    totalPageCounter: 312450,
    location: 'بخش تکثیر جزوات و سیاه‌وسفید',
    capabilities: {
      supportedPapers: ['A4', 'A5', 'B5', 'Letter', 'Legal'],
      supportedTrays: ['Auto Select', 'Tray 1 (MP)', 'Tray 2 (550-Sheet)', 'Tray 3 (2000-Sheet HCI)'],
      supportedMediaTypes: ['Plain Paper 80g', 'Recycled 70g', 'Letterhead'],
      supportsDuplex: true,
      supportsColor: false,
      supportedDpi: [300, 600, 1200],
      maxCopies: 999,
    },
    activeProfile: {
      printerName: 'HP LaserJet Enterprise M611dn (High-Speed B&W)',
      paperSize: 'A4',
      tray: 'Tray 3 (2000-Sheet HCI)',
      mediaType: 'Plain Paper 80g',
      duplexMode: 'long-edge',
      orientation: 'portrait',
      colorMode: 'monochrome',
      dpi: 600,
      quality: 'normal',
    },
  },
  {
    name: 'PrintStudio Virtual Printer',
    driverName: 'PrintStudio Pro Virtual Driver v1.0',
    portName: 'PSP_VIRTUAL_PORT_01',
    isDefault: false,
    isNetwork: false,
    isVirtual: true,
    status: 'Ready',
    jobsInQueue: 0,
    tonerLevelPercent: 100,
    totalPageCounter: 4820,
    location: 'پرینتر مجازی داخلی ویندوز',
    capabilities: {
      supportedPapers: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B4', 'B5', 'Letter', 'Legal', 'Custom'],
      supportedTrays: ['Virtual Feed'],
      supportedMediaTypes: ['Digital Vector Stream'],
      supportsDuplex: true,
      supportsColor: true,
      supportedDpi: [300, 600, 1200, 2400],
      maxCopies: 999,
    },
    activeProfile: {
      printerName: 'PrintStudio Virtual Printer',
      paperSize: 'A4',
      tray: 'Virtual Feed',
      mediaType: 'Digital Vector Stream',
      duplexMode: 'none',
      orientation: 'portrait',
      colorMode: 'color',
      dpi: 600,
      quality: 'high',
    },
  },
  {
    name: 'Canon imageRUNNER ADVANCE DX 6860i',
    driverName: 'Canon Generic Plus UFR II',
    portName: 'IP_192.168.10.52',
    isDefault: false,
    isNetwork: true,
    isVirtual: false,
    status: 'LowToner',
    jobsInQueue: 0,
    tonerLevelPercent: 11,
    totalPageCounter: 529100,
    location: 'ایستگاه کپی سریع ۲ (هشدار تونر کم)',
    capabilities: {
      supportedPapers: ['A3', 'A4', 'A5', 'B4', 'B5'],
      supportedTrays: ['Auto Select', 'Cassette 1', 'Cassette 2', 'Multi-Purpose Tray'],
      supportedMediaTypes: ['Plain Paper 80g', 'Heavy 160g'],
      supportsDuplex: true,
      supportsColor: false,
      supportedDpi: [600, 1200],
      maxCopies: 999,
    },
    activeProfile: {
      printerName: 'Canon imageRUNNER ADVANCE DX 6860i',
      paperSize: 'A4',
      tray: 'Auto Select',
      mediaType: 'Plain Paper 80g',
      duplexMode: 'long-edge',
      orientation: 'portrait',
      colorMode: 'monochrome',
      dpi: 600,
      quality: 'normal',
    },
  },
  {
    name: 'Epson SureColor T5470M Wide-Format Plotter',
    driverName: 'EPSON SC-T5400 Series ESC/P-R',
    portName: 'USB002',
    isDefault: false,
    isNetwork: false,
    isVirtual: false,
    status: 'PaperJam',
    jobsInQueue: 1,
    tonerLevelPercent: 73,
    totalPageCounter: 9410,
    location: 'واحد پلات و نقشه مهندسی A0/A1',
    capabilities: {
      supportedPapers: ['A0', 'A1', 'A2', 'A3', 'Custom'],
      supportedTrays: ['Roll Paper 36-inch', 'Cut Sheet Slot'],
      supportedMediaTypes: ['CAD Bond Paper 90g', 'Photo Satin 200g', 'Blueprint Tracing'],
      supportsDuplex: false,
      supportsColor: true,
      supportedDpi: [600, 1200, 2400],
      maxCopies: 99,
    },
    activeProfile: {
      printerName: 'Epson SureColor T5470M Wide-Format Plotter',
      paperSize: 'A1',
      tray: 'Roll Paper 36-inch',
      mediaType: 'CAD Bond Paper 90g',
      duplexMode: 'none',
      orientation: 'landscape',
      colorMode: 'color',
      dpi: 1200,
      quality: 'high',
    },
  },
];

const INITIAL_SPOOLER_JOBS: SpoolerJobInfo[] = [
  {
    jobId: 1041,
    printerName: 'Konica Minolta Bizhub C458 (Production Color)',
    documentTitle: 'کاتالوگ-محصولات-چاپخانه-۱۴۰۵.pdf',
    userName: 'اپراتور چاپخانه ۱',
    status: 'Printing',
    totalPages: 12,
    pagesPrinted: 7,
    sizeBytes: 4_820_100,
    priority: 80,
    submittedAt: new Date(Date.now() - 95_000).toISOString(),
  },
  {
    jobId: 1042,
    printerName: 'HP LaserJet Enterprise M611dn (High-Speed B&W)',
    documentTitle: 'جزوه-آزمون-مهندسی-نرم‌افزار.pdf',
    userName: 'اپراتور چاپخانه ۱',
    status: 'Spooling',
    totalPages: 40,
    pagesPrinted: 14,
    sizeBytes: 2_190_400,
    priority: 50,
    submittedAt: new Date(Date.now() - 45_000).toISOString(),
  },
  {
    jobId: 1039,
    printerName: 'Epson SureColor T5470M Wide-Format Plotter',
    documentTitle: 'نقشه-معماری-پروژه-برج-میلاد-A3.pdf',
    userName: 'مهندس ناظر',
    status: 'Paused',
    totalPages: 2,
    pagesPrinted: 0,
    sizeBytes: 11_450_000,
    priority: 90,
    submittedAt: new Date(Date.now() - 240_000).toISOString(),
  },
];

let memPrinters: PrinterInfo[] = structuredClone(INITIAL_PRINTERS);
let memJobs: SpoolerJobInfo[] = structuredClone(INITIAL_SPOOLER_JOBS);
let nextJobId = 1043;

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
    return structuredClone(memPrinters);
  },

  /**
   * Why the real printer list is missing, in the desktop app's own words. In a browser there is no
   * sidecar at all, so the answer is fixed instead of pretending the list came from Windows.
   */
  async getPrinterStatusNote(): Promise<string | null> {
    const api = electronApi();
    if (!api) return 'Browser preview: the printer list is simulated, nothing was read from Windows.';
    if (typeof api.getPrinterStatusNote !== 'function') return 'The installed app is older than this bridge; restart it after reinstalling.';
    return api.getPrinterStatusNote();
  },

  async getPrinterMargins(request: PrinterMarginRequest): Promise<PrinterMarginResult> {
    const api = electronApi();
    if (api) {
      if (typeof api.getPrinterMargins !== 'function') return {status:'unavailable',reason:'Printer margin bridge unavailable'};
      return api.getPrinterMargins(request);
    }
    const printer = memPrinters.find(p => p.name === request.printerName);
    if (printer?.isVirtual) return {status:'available',source:'simulated-virtual',marginsMm:{top:0,right:0,bottom:0,left:0}};
    return {status:'unavailable',reason:'Browser preview does not have access to physical printer margins'};
  },

  async updatePrinterProfile(
    printerName: string,
    profile: PrinterProfileSettings
  ): Promise<PrinterInfo> {
    const api = electronApi();
    if (api) return api.updatePrinterProfile(printerName, profile);
    memPrinters = memPrinters.map((p) =>
      p.name === printerName ? { ...p, activeProfile: structuredClone(profile) } : p
    );
    return structuredClone(
      memPrinters.find((p) => p.name === printerName) ?? memPrinters[0]
    );
  },

  async setDefaultPrinter(printerName: string): Promise<boolean> {
    const api = electronApi();
    if (api) return api.setDefaultPrinter(printerName);
    memPrinters = memPrinters.map((p) => ({
      ...p,
      isDefault: p.name === printerName,
    }));
    return true;
  },

  async setSimulatedPrinterStatus(
    printerName: string,
    status: PrinterInfo['status']
  ): Promise<PrinterInfo[]> {
    if (electronApi()) throw new Error('Printer simulation is unavailable in Electron');
    memPrinters = memPrinters.map((p) =>
      p.name === printerName ? { ...p, status } : p
    );
    return structuredClone(memPrinters);
  },

  async listSpoolerJobs(printerName?: string): Promise<SpoolerJobInfo[]> {
    const api = electronApi();
    if (api) return api.listSpoolerJobs(printerName);
    const filtered = printerName
      ? memJobs.filter((j) => j.printerName === printerName)
      : memJobs;
    return structuredClone(filtered);
  },

  async submitPrintJob(
    request: PrintJobRequest,
    totalSheets: number,
    pdfBytes?: Uint8Array
  ): Promise<SpoolerJobInfo> {
    const api = electronApi();
    if (api) return api.submitPrintJob(request, pdfBytes);

    const newJob: SpoolerJobInfo = {
      jobId: nextJobId++,
      printerName: request.printerName,
      documentTitle: request.jobTitle || 'PrintStudio Imposed Job',
      userName: 'اپراتور چاپخانه',
      status: 'Printing',
      totalPages: Math.max(1, totalSheets * Math.max(1, request.copies)),
      pagesPrinted: 0,
      sizeBytes: pdfBytes?.byteLength ?? totalSheets * 340_000,
      priority: 75,
      submittedAt: new Date().toISOString(),
    };

    memJobs = [newJob, ...memJobs];
    memPrinters = memPrinters.map((p) =>
      p.name === request.printerName
        ? { ...p, jobsInQueue: p.jobsInQueue + 1 }
        : p
    );
    return structuredClone(newJob);
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

    if (action === 'cancel') {
      memJobs = memJobs.filter((j) => j.jobId !== jobId);
    } else {
      memJobs = memJobs.map((j) => {
        if (j.jobId !== jobId) return j;
        if (priority !== undefined) {
          return { ...j, priority };
        }
        if (action === 'pause') return { ...j, status: 'Paused' };
        if (action === 'resume') return { ...j, status: 'Printing' };
        if (action === 'restart')
          return { ...j, status: 'Printing', pagesPrinted: 0 };
        return j;
      });
    }
    return structuredClone(memJobs);
  },

  async purgePrinterQueue(printerName: string): Promise<SpoolerJobInfo[]> {
    const api = electronApi();
    if (api) {
      const success = await api.purgePrinterQueue(printerName);
      if (!success) throw new Error(`Could not purge queue for ${printerName}`);
      return api.listSpoolerJobs();
    }
    memJobs = memJobs.filter((j) => j.printerName !== printerName);
    memPrinters = memPrinters.map((p) =>
      p.name === printerName ? { ...p, jobsInQueue: 0 } : p
    );
    return structuredClone(memJobs);
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
};
