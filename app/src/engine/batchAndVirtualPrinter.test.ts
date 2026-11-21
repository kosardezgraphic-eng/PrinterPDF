// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { App } from '../App';
import { BatchPrintWorkspace } from '../components/BatchPrintWorkspace';
import { VirtualPrinterCard } from '../components/VirtualPrinterCard';

vi.mock('./pdfService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pdfService')>();
  return {
    ...actual,
    renderPdfToSheetPngs: async () => [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
    ],
  };
});
import {
  buildBatchExecutionPlan,
  estimateBatchJobMetrics,
  resolveBatchJobPageNumbers,
} from './batchService';
import {
  DEFAULT_EFFECTS,
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  useAppStore,
} from '../store/useAppStore';
import {
  VIRTUAL_PRINTER_DEFAULT_NAME,
  type BatchJobItem,
  type PrinterInfo,
  type VirtualPrinterConfig,
  type VirtualPrinterStatus,
} from '@shared/models';
import {
  buildApplyVirtualPrinterConfigScript,
  buildInstallVirtualPrinterScript,
  buildUninstallVirtualPrinterScript,
  buildVirtualPrinterStatusScript,
  createDefaultVirtualPrinterConfig,
  normalizeVirtualPrinterConfig,
} from '../../../electron/virtualPrinter';
import { enrichVirtualPrinterInfo } from '../../../electron/windowsPrinterFallback';

const SAMPLE_PRINTER: PrinterInfo = {
  name: 'HP LaserJet Enterprise M607',
  driverName: 'HP Universal Printing PCL 6',
  portName: 'USB001',
  isDefault: true,
  isNetwork: false,
  isVirtual: false,
  status: 'Ready',
  jobsInQueue: 0,
  capabilities: {
    supportedPapers: ['A4', 'A5', 'Letter', 'Legal'],
    paperOptions: [
      { id: 'A4', name: 'A4', widthMm: 210, heightMm: 297 },
      { id: 'A5', name: 'A5', widthMm: 148, heightMm: 210 },
      { id: 'Letter', name: 'Letter', widthMm: 215.9, heightMm: 279.4 },
    ],
    supportedTrays: ['Auto Select', 'Tray 1', 'Tray 2'],
    supportedMediaTypes: ['Plain Paper', 'Heavy'],
    supportsDuplex: true,
    supportsColor: true,
    supportedDpi: [300, 600, 1200],
    maxCopies: 999,
  },
  activeProfile: {
    printerName: 'HP LaserJet Enterprise M607',
    paperSize: 'A4',
    paperName: 'A4',
    paperWidthMm: 210,
    paperHeightMm: 297,
    tray: 'Tray 2',
    mediaType: 'Plain Paper',
    duplexMode: 'long-edge',
    orientation: 'portrait',
    colorMode: 'color',
    dpi: 600,
    quality: 'normal',
    collate: true,
  },
};

const DEFAULT_VP_STATUS: VirtualPrinterStatus = {
  supportedOnOs: true,
  installedInWindows: true,
  driverName: 'Microsoft Print To PDF',
  portName: 'C:\\Spool\\incoming-job.pdf',
  spoolDir: 'C:\\Spool',
  watcherActive: true,
  lastError: null,
  recentJobs: [],
  config: createDefaultVirtualPrinterConfig(),
};

async function createSamplePdfBytes(pageCount: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawText(`Sample Page ${i + 1}`, { x: 40, y: 780, size: 18 });
  }
  return pdf.save();
}

function resetStoreState() {
  useAppStore.setState({
    appMode: 'studio',
    documents: [],
    pages: [],
    overlays: [],
    selectedOverlayId: null,
    activePageId: null,
    batchQueue: [],
    batchSelectedJobId: null,
    isBatchRunning: false,
    printers: [SAMPLE_PRINTER],
    selectedPrinterName: SAMPLE_PRINTER.name,
    spoolerJobs: [],
    effects: { ...DEFAULT_EFFECTS },
    layout: { ...DEFAULT_LAYOUT },
    settings: { ...DEFAULT_SETTINGS, language: 'fa', theme: 'light' },
    virtualPrinterStatus: DEFAULT_VP_STATUS,
    virtualPrinterBusy: false,
    toasts: [],
  });
}

describe('Standalone Batch Print Workspace & Windows Virtual Printer', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetStoreState();
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: (event: unknown) => void = () => {};
        terminate() {}
        async postMessage(payload: { id: string; pdfBytes: Uint8Array }) {
          const doc = await PDFDocument.load(payload.pdfBytes);
          const pages = doc.getPages().map((_, idx) => ({
            pageNumber: idx + 1,
            widthMm: 210,
            heightMm: 297,
            rotation: 0,
            colorProfile: 'color',
            inkCoveragePercent: 5,
            thumbnailDataUrl: 'data:image/png;base64,AA==',
            extractedTextLines: [],
          }));
          this.onmessage({ data: { id: payload.id, type: 'analyze-pdf-result', pages } });
        }
      }
    );
  });

  afterEach(() => {
    delete (window as unknown as { printStudioAPI?: unknown }).printStudioAPI;
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('switches completely between Studio UI and standalone Batch Print environment', () => {
    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(App));
    });

    expect(container.querySelector('[data-top-tool-ribbon]')).not.toBeNull();
    expect(container.querySelector('[data-batch-workspace]')).toBeNull();

    const batchBtn = container.querySelector<HTMLButtonElement>('[data-app-mode-batch]')!;
    expect(batchBtn).not.toBeNull();
    act(() => batchBtn.click());

    expect(useAppStore.getState().appMode).toBe('batch');
    expect(container.querySelector('[data-batch-workspace]')).not.toBeNull();
    expect(container.querySelector('[data-top-tool-ribbon]')).toBeNull();
    expect(container.querySelector('[data-status-bar-mode="batch"]')).not.toBeNull();

    const studioBtn = container.querySelector<HTMLButtonElement>('[data-app-mode-studio]')!;
    act(() => studioBtn.click());

    expect(useAppStore.getState().appMode).toBe('studio');
    expect(container.querySelector('[data-batch-workspace]')).toBeNull();
    expect(container.querySelector('[data-top-tool-ribbon]')).not.toBeNull();

    act(() => root.unmount());
  });

  it('adds files independently to Batch Print queue without mutating Studio workspace', async () => {
    const pdfBytes = await createSamplePdfBytes(5);
    const file = {
      name: 'batch-invoice.pdf',
      size: pdfBytes.byteLength,
      type: 'application/pdf',
      arrayBuffer: async () =>
        pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
    } as unknown as File;

    await useAppStore.getState().addBatchFiles([file]);

    const state = useAppStore.getState();
    expect(state.documents).toEqual([]);
    expect(state.pages).toEqual([]);
    expect(state.batchQueue).toHaveLength(1);
    expect(state.batchQueue[0].fileName).toBe('batch-invoice.pdf');
    expect(state.batchQueue[0].pageCount).toBe(5);
    expect(state.batchQueue[0].snapshotDocuments).toHaveLength(1);
    expect(state.batchQueue[0].snapshotPages).toHaveLength(5);
  });

  it('computes per-file page ranges, odd/even filter, reverse order, N-Up, and copy sets accurately', () => {
    const job: BatchJobItem = {
      id: 'b1',
      fileName: 'manual.pdf',
      fileSize: 2048,
      pageCount: 10,
      printerName: SAMPLE_PRINTER.name,
      nUp: 2,
      copies: 3,
      collate: true,
      pageRangeMode: 'custom',
      customRangeText: '1-6, 9-10',
      oddEvenFilter: 'odd',
      reverseOrder: true,
      duplexMode: 'long-edge',
      invert: false,
      status: 'queued',
      progressPercent: 0,
      retryCount: 0,
      addedAt: '2026-11-21T00:00:00Z',
    };

    expect(resolveBatchJobPageNumbers(job)).toEqual([9, 5, 3, 1]);

    const metrics = estimateBatchJobMetrics(job);
    expect(metrics.selectedPagesCount).toBe(4);
    expect(metrics.impressionsPerSet).toBe(2);
    expect(metrics.sheetsPerSet).toBe(1);
    expect(metrics.totalSheets).toBe(3);
  });

  it('executes Batch Print queue using per-file range & hardware profile and prints via IPC', async () => {
    const pdfBytes = await createSamplePdfBytes(4);
    const submitPrintJob = vi.fn().mockResolvedValue({ success: true, jobId: 404 });
    (window as unknown as { printStudioAPI: unknown }).printStudioAPI = {
      isElectron: true,
      submitPrintJob,
      listSpoolerJobs: vi.fn().mockResolvedValue([]),
    };

    const file = {
      name: 'contract-4p.pdf',
      size: pdfBytes.byteLength,
      type: 'application/pdf',
      arrayBuffer: async () =>
        pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
    } as unknown as File;

    await useAppStore.getState().addBatchFiles([file]);
    const jobId = useAppStore.getState().batchQueue[0].id;

    useAppStore.getState().updateBatchJob(jobId, {
      pageRangeMode: 'custom',
      customRangeText: '2-3',
      copies: 4,
      collate: true,
      useGlobalPrinterSettings: false,
      paperSize: 'A5',
      paperName: 'A5',
      paperWidthMm: 148,
      paperHeightMm: 210,
      orientation: 'landscape',
      dpi: 1200,
      tray: 'Tray 1',
      duplexMode: 'none',
    });

    const plan = buildBatchExecutionPlan(
      useAppStore.getState().batchQueue[0],
      SAMPLE_PRINTER,
      DEFAULT_LAYOUT,
      true
    );
    expect(plan.targetPages.map((p) => p.sourcePageNumber)).toEqual([2, 3]);
    expect(plan.request.copies).toBe(4);
    expect(plan.request.paperSize).toBe('A5');
    expect(plan.request.orientation).toBe('landscape');
    expect(plan.request.dpi).toBe(1200);
    expect(plan.request.tray).toBe('Tray 1');

    await useAppStore.getState().runBatchQueue();

    expect(useAppStore.getState().batchQueue[0].errorMessage).toBeUndefined();
    expect(submitPrintJob).toHaveBeenCalledTimes(1);
    const [submittedReq, submittedBytes, submittedImages] = submitPrintJob.mock.calls[0];
    expect(submittedImages).toHaveLength(2);
    expect(submittedReq.copies).toBe(4);
    expect(submittedReq.orientation).toBe('landscape');
    expect(submittedReq.dpi).toBe(1200);
    expect(submittedReq.paperSize).toBe('A5');
    expect(submittedReq.tray).toBe('Tray 1');
    const outPdf = await PDFDocument.load(submittedBytes);
    expect(outPdf.getPageCount()).toBe(2);

    const finishedJob = useAppStore.getState().batchQueue[0];
    expect(finishedJob.status).toBe('completed');
    expect(finishedJob.progressPercent).toBe(100);
    expect(finishedJob.spoolerJobId).toBe(404);
  });

  it('builds Windows Virtual Printer PowerShell scripts and updates Paper Size / Orientation / DPI', async () => {
    const cfg: VirtualPrinterConfig = normalizeVirtualPrinterConfig({
      paperSize: 'A3',
      orientation: 'landscape',
      dpi: 1200,
    });
    expect(cfg.paperWidthMm).toBe(297);
    expect(cfg.paperHeightMm).toBe(420);
    expect(cfg.orientation).toBe('landscape');
    expect(cfg.dpi).toBe(1200);

    const installPs = buildInstallVirtualPrinterScript(
      VIRTUAL_PRINTER_DEFAULT_NAME,
      'C:\\Spool\\incoming-job.pdf',
      cfg
    );
    expect(installPs).toContain('Add-PrinterPort');
    expect(installPs).toContain('Add-Printer');
    expect(installPs).toContain(VIRTUAL_PRINTER_DEFAULT_NAME);

    const applyPs = buildApplyVirtualPrinterConfigScript(VIRTUAL_PRINTER_DEFAULT_NAME, cfg);
    expect(applyPs).toContain("$paper = 'A3'");
    expect(applyPs).toContain('$isLand = $true');
    expect(applyPs).toContain('$targetDpi = 1200');

    const statusPs = buildVirtualPrinterStatusScript(VIRTUAL_PRINTER_DEFAULT_NAME);
    expect(statusPs).toContain('Get-Printer');

    const uninstallPs = buildUninstallVirtualPrinterScript(
      VIRTUAL_PRINTER_DEFAULT_NAME,
      'C:\\Spool\\incoming-job.pdf'
    );
    expect(uninstallPs).toContain('Remove-Printer');

    const enriched = enrichVirtualPrinterInfo(
      {
        name: VIRTUAL_PRINTER_DEFAULT_NAME,
        driverName: 'Microsoft Print To PDF',
        portName: 'C:\\Spool\\incoming-job.pdf',
        isDefault: false,
        isNetwork: false,
        isVirtual: true,
        status: 'Ready',
        jobsInQueue: 0,
        capabilities: {
          supportedPapers: ['A4'],
          supportedTrays: ['Auto Select'],
          supportedMediaTypes: ['Plain Paper'],
          supportsDuplex: false,
          supportsColor: true,
          supportedDpi: [600],
          maxCopies: 99,
        },
        activeProfile: {
          printerName: VIRTUAL_PRINTER_DEFAULT_NAME,
          paperSize: 'A4',
          tray: 'Auto Select',
          mediaType: 'Plain Paper',
          duplexMode: 'none',
          orientation: 'portrait',
          colorMode: 'color',
          dpi: 600,
          quality: 'normal',
        },
      },
      cfg
    );
    expect(enriched.capabilities.supportedDpi).toEqual([150, 300, 600, 1200]);
    expect(enriched.activeProfile.paperSize).toBe('A3');
    expect(enriched.activeProfile.orientation).toBe('landscape');
    expect(enriched.activeProfile.dpi).toBe(1200);

    const updateVirtualPrinterConfig = vi.fn().mockResolvedValue({
      ...DEFAULT_VP_STATUS,
      config: cfg,
    });
    (window as unknown as { printStudioAPI: unknown }).printStudioAPI = {
      isElectron: true,
      updateVirtualPrinterConfig,
      listPrinters: vi.fn().mockResolvedValue([SAMPLE_PRINTER, enriched]),
    };

    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(VirtualPrinterCard));
    });

    const dpiSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="رزولوشن چاپ پرینتر مجازی"]'
    )!;
    expect(dpiSelect).not.toBeNull();
    await act(async () => {
      dpiSelect.value = '1200';
      dpiSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(updateVirtualPrinterConfig).toHaveBeenCalledWith({ dpi: 1200 });

    const orientationSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="جهت صفحه پرینتر مجازی"]'
    )!;
    expect(orientationSelect).not.toBeNull();
    await act(async () => {
      orientationSelect.value = 'landscape';
      orientationSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(updateVirtualPrinterConfig).toHaveBeenCalledWith({ orientation: 'landscape' });

    act(() => root.unmount());
  });

  it('automatically imports PDFs captured from Windows Virtual Printer into Studio', async () => {
    const pdfBytes = await createSamplePdfBytes(2);
    useAppStore.setState({ appMode: 'batch' });

    await useAppStore.getState().handleIncomingVirtualPrinterJob({
      fileName: 'ExternalWordDoc.pdf',
      mimeType: 'application/pdf',
      bytes: pdfBytes,
      job: {
        id: 'vp-1',
        jobTitle: 'ExternalWordDoc',
        fileName: 'ExternalWordDoc.pdf',
        pageCount: 2,
        receivedAt: '2026-11-21T01:00:00Z',
        paperSize: 'A4',
        orientation: 'portrait',
        dpi: 600,
        sizeBytes: pdfBytes.byteLength,
        source: 'windows-spool',
      },
    });

    const state = useAppStore.getState();
    expect(state.documents).toHaveLength(1);
    expect(state.documents[0].name).toBe('ExternalWordDoc.pdf');
    expect(state.pages).toHaveLength(2);
    expect(state.appMode).toBe('studio');
  });

  it('renders BatchPrintWorkspace with per-file range, copies, hardware panel, and virtual printer card', () => {
    const job: BatchJobItem = {
      id: 'job-ui-1',
      fileName: 'Brochure.pdf',
      fileSize: 4096,
      pageCount: 6,
      printerName: SAMPLE_PRINTER.name,
      nUp: 1,
      copies: 2,
      collate: true,
      pageRangeMode: 'custom',
      customRangeText: '1-4',
      oddEvenFilter: 'all',
      reverseOrder: false,
      duplexMode: 'none',
      invert: false,
      status: 'queued',
      progressPercent: 0,
      retryCount: 0,
      addedAt: '2026-11-21T00:00:00Z',
    };
    useAppStore.setState({ batchQueue: [job], batchSelectedJobId: job.id });

    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(BatchPrintWorkspace));
    });

    expect(container.querySelector('[data-batch-workspace]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="تعداد سری فایل"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="virtual-printer-card"]')).not.toBeNull();
    expect(container.textContent).toContain('Brochure.pdf');

    act(() => root.unmount());
  });
});
