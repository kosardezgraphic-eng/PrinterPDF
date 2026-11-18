// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem, PrinterInfo, SourceDocument } from '@shared/models';
import { sanitizeDriverText, sanitizePrinterInfo } from '@shared/models';
import {
  buildApplyProfilePowerShellScript,
  buildWindowsPrintPowerShellScript,
  matchStandardPaperId,
} from '../../../electron/windowsPrinterFallback';
import { parsePageRangeText } from './pdfService';
import { computeImpositionSheets, getSheetDimensionsMm } from './layoutEngine';
import { ipcBridge } from './ipcBridge';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { QuickBar } from '../components/QuickBar';
import { Ribbon } from '../components/Ribbon';
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
      pendingDuplexPrint: null,
      printProgress: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strips embedded NUL-terminated Windows heap mojibake from paper sizes and trays', () => {
    expect(sanitizeDriverText('A4\u0000븜鴉뷘鴉뷼')).toBe('A4');
    expect(sanitizeDriverText('A2 (Fit To Page)\u0000랠걊鴉랠鴉뇨')).toBe('A2 (Fit To Page)');
    expect(sanitizeDriverText('Auto Select\u0000䍩\uFFFD\u0007')).toBe('Auto Select');

    const dirtyPrinter = makePrinter({
      capabilities: {
        ...makePrinter().capabilities,
        paperOptions: [
          { id: 'A4', name: 'A4\u0000븜鴉뷘', widthMm: 210, heightMm: 297, rawKind: 9 },
          { id: 'A2', name: 'A2 (Fit To Page)\u0000랠걊鴉', widthMm: 420, heightMm: 594, rawKind: 66 },
        ],
        supportedTrays: ['Auto Select\u0000䍩...', 'Tray 1\u0000븜鴉'],
      },
      activeProfile: {
        ...makePrinter().activeProfile,
        paperName: 'A4\u0000븜鴉',
        tray: 'Auto Select\u0000䍩...',
      },
    });
    const clean = sanitizePrinterInfo(dirtyPrinter);
    expect(clean.capabilities.paperOptions?.map((p) => p.name)).toEqual([
      'A4',
      'A2 (Fit To Page)',
    ]);
    expect(clean.capabilities.supportedTrays).toEqual(['Auto Select', 'Tray 1']);
    expect(clean.activeProfile.paperName).toBe('A4');
    expect(clean.activeProfile.tray).toBe('Auto Select');
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

  it('prompts duplex orientation & front/back visualization on Quick Print when duplex is active, then submits after confirm', async () => {
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

    // Duplex printer opens confirmation visualization modal instead of printing blindly
    await useAppStore.getState().silentPrintNow();
    expect(submitSpy).not.toHaveBeenCalled();
    expect(useAppStore.getState().pendingDuplexPrint).toBeTruthy();

    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    act(() => {
      root.render(React.createElement(ModalsAndToasts));
    });

    expect(container.textContent).toContain('پیش‌نمایش و تعیین جهت چاپ پشت و رو');
    const backPreview = container.querySelector('[data-testid="duplex-back-preview"]');
    expect(backPreview?.getAttribute('data-rotated')).toBe('0');

    // Switch to Short Edge in portrait -> back preview flips 180deg (top-edge flip)
    const shortEdgeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('لبه کوتاه')
    );
    expect(shortEdgeBtn).toBeTruthy();
    act(() => {
      shortEdgeBtn!.click();
    });
    expect(
      container.querySelector('[data-testid="duplex-back-preview"]')?.getAttribute('data-rotated')
    ).toBe('180');

    // Switch orientation to Landscape + Short Edge -> flips horizontally like a book (0deg)
    const landscapeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('افقی')
    );
    act(() => {
      landscapeBtn!.click();
    });
    expect(
      container.querySelector('[data-testid="duplex-back-preview"]')?.getAttribute('data-rotated')
    ).toBe('0');

    // Confirm and print
    const confirmBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('تایید جهت و ارسال به پرینتر')
    );
    expect(confirmBtn).toBeTruthy();
    await act(async () => {
      confirmBtn!.click();
      await Promise.resolve();
    });

    expect(submitSpy).toHaveBeenCalledTimes(1);
    const [req, sheetCount, pdfBytes] = submitSpy.mock.calls[0];
    expect(req.printerName).toBe('SHARP MX-M453U PCL6');
    expect(req.orientation).toBe('landscape');
    expect(req.duplexMode).toBe('short-edge');
    expect(req.tray).toBe('Tray 1');
    expect(req.paperSize).toBe('A4');
    expect(sheetCount).toBe(3);
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect((pdfBytes as Uint8Array).byteLength).toBeGreaterThan(100);
    expect((await PDFDocument.load(pdfBytes as Uint8Array)).getPageCount()).toBe(3);

    const nextState = useAppStore.getState();
    expect(nextState.pendingDuplexPrint).toBeNull();
    expect(nextState.spoolerJobs).toHaveLength(1);
    expect(nextState.toasts.at(-1)?.type).toBe('success');

    act(() => root.unmount());
    container.remove();
  });

  it('submits simplex Quick Print directly, shows Print Progress popup, and supports canceling mid-flight', async () => {
    const simplexPrinter = makePrinter({
      activeProfile: { ...makePrinter().activeProfile, duplexMode: 'none' },
    });
    useAppStore.setState({ printers: [simplexPrinter] });

    let resolveSubmit!: (val: Awaited<ReturnType<typeof ipcBridge.submitPrintJob>>) => void;
    const submitSpy = vi.spyOn(ipcBridge, 'submitPrintJob').mockImplementation(
      () =>
        new Promise((res) => {
          resolveSubmit = res;
        })
    );
    const controlSpy = vi.spyOn(ipcBridge, 'controlSpoolerJob').mockResolvedValue([]);

    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    act(() => {
      root.render(React.createElement(ModalsAndToasts));
    });

    const printPromise = useAppStore.getState().silentPrintNow();

    // Wait briefly for PDF imposition + progress popup activation
    await vi.waitFor(() => {
      expect(useAppStore.getState().printProgress?.active).toBe(true);
      expect(submitSpy).toHaveBeenCalledTimes(1);
    });

    act(() => {
      root.render(React.createElement(ModalsAndToasts));
    });
    expect(container.textContent).toContain('در حال ارسال و چاپ سند');
    const cancelBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('لغو چاپ')
    );
    expect(cancelBtn).toBeTruthy();

    await act(async () => {
      cancelBtn!.click();
    });

    expect(useAppStore.getState().printProgress).toBeNull();
    expect(useAppStore.getState().toasts.at(-1)?.type).toBe('warning');

    // If spooler responds late after cancel, store cancels the late job on the spooler too
    resolveSubmit({
      jobId: 99,
      printerName: 'SHARP MX-M453U PCL6',
      documentTitle: 'TestBook.pdf',
      userName: 'operator',
      status: 'Spooling',
      totalPages: 2,
      pagesPrinted: 0,
      sizeBytes: 2048,
      priority: 1,
      submittedAt: new Date().toISOString(),
    });
    await printPromise;
    expect(controlSpy).toHaveBeenCalledWith('SHARP MX-M453U PCL6', 99, 'cancel');

    act(() => root.unmount());
    container.remove();
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

  it('unifies duplex mode bidirectionally between sheet settings, booklet, and all printers regardless of supportsDuplex', async () => {
    const printerA = makePrinter({
      name: 'SHARP MX-M453U PCL6',
      capabilities: { ...makePrinter().capabilities, supportsDuplex: true },
      activeProfile: { ...makePrinter().activeProfile, printerName: 'SHARP MX-M453U PCL6', duplexMode: 'long-edge' },
    });
    const printerB = makePrinter({
      name: 'HP LaserJet 527 (No Auto Duplex)',
      isDefault: false,
      capabilities: { ...makePrinter().capabilities, supportsDuplex: false },
      activeProfile: { ...makePrinter().activeProfile, printerName: 'HP LaserJet 527 (No Auto Duplex)', duplexMode: 'none' },
    });

    useAppStore.setState({
      printers: [printerA, printerB],
      selectedPrinterName: printerA.name,
      activeRibbonTab: 'layout',
      showPrintModal: true,
    });

    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(QuickBar),
          React.createElement(Ribbon),
          React.createElement(ModalsAndToasts)
        )
      );
    });

    // Open QuickBar Hardware popover
    const hwToggle = container.querySelector<HTMLButtonElement>('button[aria-label="تنظیمات سخت‌افزاری پرینتر"]');
    expect(hwToggle).toBeTruthy();
    act(() => {
      hwToggle!.click();
    });

    const sheetDuplexSelect = container.querySelector<HTMLSelectElement>('select[aria-label="حالت چاپ دورو شیت"]');
    const hwDuplexSelect = container.querySelector<HTMLSelectElement>('select[aria-label="چاپ دورو سخت‌افزاری"]');
    const modalDuplexSelect = container.querySelector<HTMLSelectElement>('select[aria-label="چاپ دورو (Duplex)"]');
    expect(sheetDuplexSelect).toBeTruthy();
    expect(hwDuplexSelect).toBeTruthy();
    expect(modalDuplexSelect).toBeTruthy();

    // 1. Change duplex in Sheet settings (Ribbon) -> updates hardware in ALL printers & modal & booklet
    act(() => {
      sheetDuplexSelect!.value = 'short-edge';
      sheetDuplexSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    let state = useAppStore.getState();
    expect(state.layout.duplexMode).toBe('short-edge');
    expect(state.layout.booklet?.duplexMode).toBe('short-edge');
    expect(state.printers.every((p) => p.activeProfile.duplexMode === 'short-edge')).toBe(true);
    expect(hwDuplexSelect!.value).toBe('short-edge');
    expect(modalDuplexSelect!.value).toBe('short-edge');

    // 2. Switch to Printer B (where supportsDuplex === false) -> still enabled and unified!
    act(() => {
      useAppStore.getState().selectPrinter(printerB.name);
    });
    expect(hwDuplexSelect!.disabled).toBe(false);
    expect(modalDuplexSelect!.disabled).toBe(false);
    expect(hwDuplexSelect!.value).toBe('short-edge');
    expect(modalDuplexSelect!.value).toBe('short-edge');
    expect(sheetDuplexSelect!.value).toBe('short-edge');

    // 3. Change duplex in Hardware settings while on Printer B -> updates sheet settings, booklet, and Printer A too
    await act(async () => {
      hwDuplexSelect!.value = 'long-edge';
      hwDuplexSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    state = useAppStore.getState();
    expect(state.layout.duplexMode).toBe('long-edge');
    expect(state.layout.booklet?.duplexMode).toBe('long-edge');
    expect(state.printers.every((p) => p.activeProfile.duplexMode === 'long-edge')).toBe(true);
    expect(sheetDuplexSelect!.value).toBe('long-edge');
    expect(modalDuplexSelect!.value).toBe('long-edge');

    // 4. Change duplex to simplex ('none') in Print Dialog -> updates sheet settings and ALL printers
    await act(async () => {
      modalDuplexSelect!.value = 'none';
      modalDuplexSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    state = useAppStore.getState();
    expect(state.layout.duplexMode).toBe('none');
    expect(state.printers.every((p) => p.activeProfile.duplexMode === 'none')).toBe(true);
    expect(sheetDuplexSelect!.value).toBe('none');
    expect(hwDuplexSelect!.value).toBe('none');

    // 5. Booklet duplex update also propagates to sheet layout & all printers
    act(() => {
      useAppStore.getState().updateLayout({
        booklet: { ...useAppStore.getState().layout.booklet!, enabled: true, duplexMode: 'short-edge' },
      });
    });
    state = useAppStore.getState();
    expect(state.layout.duplexMode).toBe('short-edge');
    expect(state.printers.every((p) => p.activeProfile.duplexMode === 'short-edge')).toBe(true);

    act(() => root.unmount());
    container.remove();
  });

  it('generates C# 5.0 compatible 2-pass DEVMODE + UserPrintTicket PowerShell scripts for profile sync & print', () => {
    const applyScript = buildApplyProfilePowerShellScript('C:\\Temp\\profile.json');
    const printScript = buildWindowsPrintPowerShellScript('C:\\Temp\\dispatch.json');

    for (const script of [applyScript, printScript]) {
      expect(script).toContain('PrintStudioWin32DevMode');
      expect(script).toContain('Sync-PrintStudioUserPrintTicket');
      expect(script).toContain('PRINTER_INFO_9');
      expect(script).toContain('SetPrinter(hPrinter, 9, ref info9, 0)');
      expect(script).toContain('DM_MEDIATYPE');
      expect(script).toContain('DM_DEFAULTSOURCE');
      expect(script).toContain('DM_DUPLEX');
      expect(script).toContain('DM_IN_BUFFER | DM_OUT_BUFFER');

      // Pass 1 (paper size + orientation) must occur before Pass 2 (duplex + tray + media)
      const pass1Idx = script.indexOf('// Pass 1: Paper Size & Orientation');
      const pass2Idx = script.indexOf('// Pass 2: Duplex, Tray, MediaType');
      expect(pass1Idx).toBeGreaterThan(-1);
      expect(pass2Idx).toBeGreaterThan(pass1Idx);

      // Extract embedded C# block to verify strict C# 5.0 compatibility for Windows PowerShell 5.1 Add-Type
      const csStart = script.indexOf("@'\r\n") + 4;
      const csEnd = script.indexOf("\r\n'@", csStart);
      const csBody = script.slice(csStart, csEnd);
      expect(csBody).not.toContain('nameof(');
      expect(csBody).not.toContain('?.');
      expect(csBody).not.toContain('out var ');
      expect(csBody).not.toContain('using var ');
    }

    expect(printScript).toContain('ConfigurePrinterSettingsForPrint');
    expect(printScript).toContain('SetHdevmode');
    expect(printScript).toContain('add_QueryPageSettings');
    expect(printScript).toContain('MergeAndValidatePrintTicket($newTicket, (New-Object System.Printing.PrintTicket))');
  });

  it('syncs sheet paperSize/orientation changes from updateLayout and finishing options from Print Modal to activeProfile', async () => {
    const profileSpy = vi.spyOn(ipcBridge, 'updatePrinterProfile');

    // Standalone updateLayout (e.g. from booklet panel or preset) syncs selected printer activeProfile & IPC
    act(() => {
      useAppStore.getState().updateLayout({ paperSize: 'A3', orientation: 'landscape' });
    });
    await Promise.resolve();

    const updatedPrinter = useAppStore.getState().printers[0];
    expect(updatedPrinter.activeProfile.paperSize).toBe('A3');
    expect(updatedPrinter.activeProfile.orientation).toBe('landscape');
    expect(profileSpy).toHaveBeenCalledWith(
      'SHARP MX-M453U PCL6',
      expect.objectContaining({ paperSize: 'A3', orientation: 'landscape' })
    );

    profileSpy.mockClear();

    // Open Print Modal and change Collate, Staple, Hole Punch, Output Bin -> updates activeProfile immediately
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    act(() => {
      useAppStore.setState({ showPrintModal: true });
      root.render(React.createElement(ModalsAndToasts));
    });

    const collateCheckbox = container.querySelector<HTMLInputElement>('input[aria-label="مرتب‌سازی دسته‌ها (Collate)"]');
    const stapleSelect = container.querySelector<HTMLSelectElement>('select[aria-label="منگنه (Staple)"]');
    const punchSelect = container.querySelector<HTMLSelectElement>('select[aria-label="پانچ (Hole Punch)"]');
    const binSelect = container.querySelector<HTMLSelectElement>('select[aria-label="سینی خروجی (Output Bin)"]');
    expect(collateCheckbox).toBeTruthy();
    expect(stapleSelect).toBeTruthy();
    expect(punchSelect).toBeTruthy();
    expect(binSelect).toBeTruthy();

    await act(async () => {
      collateCheckbox!.click();
      stapleSelect!.value = 'TopLeft';
      stapleSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      punchSelect!.value = '2Hole';
      punchSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      binSelect!.value = 'Finisher Bin';
      binSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    const prof = useAppStore.getState().printers[0].activeProfile;
    expect(prof.collate).toBe(false);
    expect(prof.staple).toBe('TopLeft');
    expect(prof.holePunch).toBe('2Hole');
    expect(prof.outputBin).toBe('Finisher Bin');
    expect(profileSpy).toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });
});
