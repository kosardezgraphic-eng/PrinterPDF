// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem, PrinterInfo, SourceDocument } from '@shared/models';
import { matchStandardPaperId } from '../../../electron/windowsPrinterFallback';
import { parsePageRangeText } from './pdfService';
import { computeImpositionSheets, getSheetDimensionsMm } from './layoutEngine';
import { ipcBridge } from './ipcBridge';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { QuickBar } from '../components/QuickBar';
import { StatusBar } from '../components/StatusBar';
import { ModalsAndToasts } from '../components/Modals';

function makePrinter(overrides?: Partial<PrinterInfo>): PrinterInfo {
  return {
    name: 'SHARP MX-M453U PCL6',
    driverName: 'SHARP MX-M453U PCL6',
    portName: 'USB001',
    isDefault: true,
    isNetwork: false,
    isVirtual: false,
    jobsInQueue: 0,
    status: 'Ready',
    capabilities: {
      supportsColor: false,
      supportsDuplex: true,
      supportedPapers: ['A4', 'A3', 'Custom'],
      paperOptions: [
        { id: 'A4', name: 'A4', widthMm: 210, heightMm: 297, rawKind: 9 },
        { id: 'A3', name: 'A3', widthMm: 297, heightMm: 420, rawKind: 8 },
        { id: 'Custom', name: 'SRA3', widthMm: 320, heightMm: 450, rawKind: 256 },
      ],
      supportedTrays: ['Auto Select', 'Tray 1', 'Tray 2', 'Bypass Tray'],
      supportedMediaTypes: ['Plain Paper', 'Heavy Paper 1', 'Transparency'],
      supportedDpi: [300, 600, 1200],
      supportedQualities: ['draft', 'normal', 'high'],
      supportsCollate: true,
      supportsStaple: true,
      supportedStapleModes: ['None', 'TopLeft', 'DualLeft'],
      supportedHolePunchModes: ['None', '2Hole'],
      supportedFoldModes: ['None'],
      supportedOutputBins: ['Main Tray', 'Finisher Bin'],
      supportsBorderless: false,
      maxCopies: 999,
    },
    activeProfile: {
      printerName: 'SHARP MX-M453U PCL6',
      paperSize: 'A4',
      paperName: 'A4',
      paperWidthMm: 210,
      paperHeightMm: 297,
      tray: 'Tray 1',
      mediaType: 'Plain Paper',
      duplexMode: 'long-edge',
      orientation: 'portrait',
      colorMode: 'monochrome',
      dpi: 600,
      quality: 'normal',
      collate: true,
      staple: 'None',
      holePunch: 'None',
      fold: 'None',
      outputBin: 'Main Tray',
      borderless: false,
    },
    ...overrides,
  };
}

function makeDoc(rawBytes?: Uint8Array): SourceDocument {
  return {
    id: 'doc-1',
    name: 'TestBook.pdf',
    filePath: '',
    fileSize: rawBytes?.byteLength ?? 1024,
    fileType: 'pdf',
    mimeType: 'application/pdf',
    pageCount: 3,
    createdAt: '2026-01-01T00:00:00Z',
    rawBytes,
  };
}

function makePage(num: number): PageItem {
  return {
    id: `page-${num}`,
    documentId: 'doc-1',
    documentName: 'TestBook.pdf',
    sourcePageNumber: num,
    widthMm: 210,
    heightMm: 297,
    rotation: 0,
    selectedForPrint: true,
    isHighlighted: num === 1,
    isBlankPage: false,
    colorProfile: 'grayscale',
    inkCoveragePercent: 12,
    thumbnailDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  };
}

describe('direct print & printer hardware integration', () => {
  beforeEach(async () => {
    const samplePdf = await PDFDocument.create();
    for (let i = 0; i < 3; i++) {
      const p = samplePdf.addPage([595, 842]);
      p.drawText(`Page ${i + 1}`, { x: 40, y: 760, size: 18 });
    }
    const pdfBytes = await samplePdf.save();

    vi.spyOn(ipcBridge, 'getPrinterMargins').mockResolvedValue({
      status: 'available',
      source: 'hardware',
      marginsMm: { top: 4.2, right: 4.2, bottom: 4.2, left: 4.2 },
    });
    vi.spyOn(ipcBridge, 'updatePrinterProfile').mockImplementation(async (name, prof) =>
      makePrinter({ name, activeProfile: prof })
    );
    vi.spyOn(ipcBridge, 'listSpoolerJobs').mockResolvedValue([]);
    useAppStore.setState({
      documents: [makeDoc(pdfBytes)],
      pages: [makePage(1), makePage(2), makePage(3)],
      printers: [makePrinter()],
      selectedPrinterName: 'SHARP MX-M453U PCL6',
      layout: { ...DEFAULT_LAYOUT },
      settings: { ...DEFAULT_SETTINGS, language: 'fa' },
      toasts: [],
      spoolerJobs: [],
      showPrintModal: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps driver paper sizes and exact mm dimensions via matchStandardPaperId', () => {
    expect(matchStandardPaperId(210, 297, 'ISO A4')).toBe('A4');
    expect(matchStandardPaperId(297, 210, 'A4 Landscape')).toBe('A4');
    expect(matchStandardPaperId(420, 297, 'A3')).toBe('A3');
    expect(matchStandardPaperId(215.9, 279.4, 'Letter')).toBe('Letter');
    expect(matchStandardPaperId(320, 450, 'SRA3')).toBe('Custom');
    expect(matchStandardPaperId(undefined, undefined, 'Legal')).toBe('Legal');
  });

  it('parses custom page range expressions cleanly', () => {
    expect(parsePageRangeText('1-2, 3, 2', 5)).toEqual([1, 2, 3]);
    expect(parsePageRangeText('3-1', 5)).toEqual([3, 2, 1]);
    expect(parsePageRangeText('0, 99', 3)).toEqual([]);
  });

  it('syncs layout dimensions and imposed sheet size when selecting a printer or updating paper profile', () => {
    const sra3Printer = makePrinter({
      name: 'Production Press',
      activeProfile: {
        ...makePrinter().activeProfile,
        printerName: 'Production Press',
        paperSize: 'Custom',
        paperName: 'SRA3',
        paperWidthMm: 320,
        paperHeightMm: 450,
        orientation: 'landscape',
        duplexMode: 'short-edge',
      },
    });
    useAppStore.setState({ printers: [makePrinter(), sra3Printer] });
    useAppStore.getState().selectPrinter('Production Press');

    const layout = useAppStore.getState().layout;
    expect(layout.paperSize).toBe('Custom');
    expect(layout.orientation).toBe('landscape');
    expect(layout.duplexMode).toBe('short-edge');
    expect(getSheetDimensionsMm(layout)).toEqual({ widthMm: 450, heightMm: 320 });

    const sheets = computeImpositionSheets(useAppStore.getState().pages, layout);
    expect(sheets[0].widthMm).toBe(450);
    expect(sheets[0].heightMm).toBe(320);
  });

  it('re-applies updated driver paper size on retryPrinters even for the same printer name', async () => {
    const updatedA3 = makePrinter({
      activeProfile: {
        ...makePrinter().activeProfile,
        paperSize: 'A3',
        paperName: 'A3',
        paperWidthMm: 297,
        paperHeightMm: 420,
      },
    });
    vi.spyOn(ipcBridge, 'listPrinters').mockResolvedValue([updatedA3]);

    await useAppStore.getState().retryPrinters();
    const dims = getSheetDimensionsMm(useAppStore.getState().layout);
    expect(useAppStore.getState().layout.paperSize).toBe('A3');
    expect(dims).toEqual({ widthMm: 297, heightMm: 420 });
  });

  it('updates tray, paper size, and sheet dimensions together via updatePrinterProfile', async () => {
    await useAppStore.getState().updatePrinterProfile('SHARP MX-M453U PCL6', {
      tray: 'Bypass Tray',
      paperSize: 'A3',
      paperName: 'A3',
      paperWidthMm: 297,
      paperHeightMm: 420,
    });

    const state = useAppStore.getState();
    const printer = state.printers.find((p) => p.name === 'SHARP MX-M453U PCL6');
    expect(printer?.activeProfile.tray).toBe('Bypass Tray');
    expect(state.layout.paperSize).toBe('A3');
    expect(getSheetDimensionsMm(state.layout)).toEqual({ widthMm: 297, heightMm: 420 });
  });

  it('submits a real direct print job with imposed PDF bytes and active hardware profile', async () => {
    const submitSpy = vi.spyOn(ipcBridge, 'submitPrintJob').mockResolvedValue({
      jobId: 42,
      printerName: 'SHARP MX-M453U PCL6',
      documentTitle: 'TestBook.pdf',
      userName: 'operator',
      status: 'Spooling',
      totalPages: 2,
      pagesPrinted: 0,
      sizeBytes: 4096,
      priority: 1,
      submittedAt: new Date().toISOString(),
    });
    vi.spyOn(ipcBridge, 'listSpoolerJobs').mockResolvedValue([
      {
        jobId: 42,
        printerName: 'SHARP MX-M453U PCL6',
        documentTitle: 'TestBook.pdf',
        userName: 'operator',
        status: 'Spooling',
        totalPages: 2,
        pagesPrinted: 0,
        sizeBytes: 4096,
        priority: 1,
        submittedAt: new Date().toISOString(),
      },
    ]);

    useAppStore.setState({ showPrintModal: true });
    await useAppStore.getState().silentPrintNow();

    expect(submitSpy).toHaveBeenCalledTimes(1);
    const [req, sheetCount, pdfBytes] = submitSpy.mock.calls[0];
    expect(req.printerName).toBe('SHARP MX-M453U PCL6');
    expect(req.tray).toBe('Tray 1');
    expect(req.paperSize).toBe('A4');
    expect(req.paperWidthMm).toBe(210);
    expect(req.paperHeightMm).toBe(297);
    expect(req.mediaType).toBe('Plain Paper');
    expect(req.dpi).toBe(600);
    expect(req.duplexMode).toBe('long-edge');
    expect(req.staple).toBe('None');
    expect(req.outputBin).toBe('Main Tray');
    expect(sheetCount).toBeGreaterThanOrEqual(1);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect((pdfBytes as Uint8Array).byteLength).toBeGreaterThan(100);

    const nextState = useAppStore.getState();
    expect(nextState.showPrintModal).toBe(false);
    expect(nextState.spoolerJobs).toHaveLength(1);
    expect(nextState.toasts.at(-1)?.type).toBe('success');
  });

  it('renders QuickBar Tray & Paper Size controls synced with StatusBar and Modals', () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    act(() => {
      useAppStore.setState({ showPrintModal: true });
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(QuickBar),
          React.createElement(StatusBar, { cursorPos: null }),
          React.createElement(ModalsAndToasts)
        )
      );
    });

    const traySelect = container.querySelector<HTMLSelectElement>('select[aria-label="سینی کاغذ چاپ فوری"]');
    expect(traySelect).toBeTruthy();
    expect(Array.from(traySelect!.options).map((o) => o.value)).toEqual([
      'Auto Select',
      'Tray 1',
      'Tray 2',
      'Bypass Tray',
    ]);
    expect(traySelect!.value).toBe('Tray 1');

    const paperSelect = container.querySelector<HTMLSelectElement>('select[aria-label="سایز کاغذ پرینتر"]');
    expect(paperSelect).toBeTruthy();
    expect(paperSelect!.options[0].textContent).toContain('210×297 mm');

    expect(container.querySelector('[data-testid="status-tray"]')?.textContent).toContain('Tray 1');

    // Change tray from QuickBar right next to Quick Print
    act(() => {
      traySelect!.value = 'Bypass Tray';
      traySelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useAppStore.getState().printers[0].activeProfile.tray).toBe('Bypass Tray');
    expect(container.querySelector('[data-testid="status-tray"]')?.textContent).toContain('Bypass Tray');

    // Print Modal exposes full hardware settings including Driver Paper Size and Media Type
    expect(container.textContent).toContain('تنظیمات درایور ویندوز');
    expect(container.textContent).toContain('سایز کاغذ درایور');
    expect(container.textContent).toContain('جنس کاغذ (Media)');

    act(() => root.unmount());
    container.remove();
  });
});
