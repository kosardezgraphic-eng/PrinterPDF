// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickBar } from '../components/QuickBar';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import type { PageItem, PrinterInfo, PrintJobRequest, SourceDocument } from '@shared/models';

const samplePrinter: PrinterInfo = {
  name: 'HP LaserJet Test',
  driverName: 'HP Universal',
  portName: 'USB001',
  isDefault: true,
  isNetwork: false,
  isVirtual: false,
  status: 'Ready',
  jobsInQueue: 0,
  capabilities: {
    supportedPapers: ['A4'],
    paperOptions: [{ id: 'A4', name: 'A4', widthMm: 210, heightMm: 297 }],
    supportedTrays: ['Auto Select'],
    supportedDpi: [600],
    supportedMediaTypes: ['Plain Paper'],
    supportedQualities: ['normal'],
    supportsColor: true,
    supportsDuplex: true,
    supportsCollate: true,
    supportsBorderless: false,
    supportsStaple: false,
    maxCopies: 99,
  },
  activeProfile: {
    printerName: 'HP LaserJet Test',
    paperSize: 'A4',
    paperName: 'A4',
    paperWidthMm: 210,
    paperHeightMm: 297,
    orientation: 'portrait',
    duplexMode: 'none',
    tray: 'Auto Select',
    dpi: 600,
    mediaType: 'Plain Paper',
    quality: 'normal',
    colorMode: 'color',
    collate: true,
    borderless: false,
  },
};

const sampleDoc = {
  id: 'doc-1',
  name: 'brochure.pdf',
  mimeType: 'application/pdf',
  fileSize: 1024,
  pageCount: 1,
  rawBytes: new Uint8Array(),
} as unknown as SourceDocument;

const samplePage = {
  id: 'page-1',
  documentId: 'doc-1',
  pageNumber: 1,
  widthMm: 210,
  heightMm: 297,
  rotation: 0,
  selectedForPrint: true,
  isHighlighted: true,
  isBlank: false,
  colorType: 'color',
  thumbnailUrl: '',
} as unknown as PageItem;

describe('QuickBar Copies control', () => {
  let root: Root;
  let host: HTMLDivElement;
  const initial = useAppStore.getState();

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState({
      appMode: 'studio',
      documents: [sampleDoc],
      pages: [samplePage],
      printers: [samplePrinter],
      selectedPrinterName: samplePrinter.name,
      quickPrintCopies: 1,
      pendingDuplexPrint: null,
      settings: { ...DEFAULT_SETTINGS, language: 'fa' },
      layout: { ...DEFAULT_LAYOUT, duplexMode: 'none' },
      submitPrintJob: initial.submitPrintJob,
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    useAppStore.setState({
      documents: [],
      pages: [],
      printers: [],
      quickPrintCopies: 1,
      pendingDuplexPrint: null,
      submitPrintJob: initial.submitPrintJob,
    });
  });

  it('renders Copies input next to Quick Print and submits exact copy count', async () => {
    const submitSpy = vi.fn<(req: PrintJobRequest) => Promise<void>>(async () => {});
    useAppStore.setState({ submitPrintJob: submitSpy });

    act(() => root.render(React.createElement(QuickBar)));

    const quickBtn = host.querySelector<HTMLButtonElement>('[data-quick-print]');
    const copiesWrap = host.querySelector<HTMLElement>('[data-quick-copies-wrap]');
    const copiesInput = host.querySelector<HTMLInputElement>('[data-quick-copies-input]');
    const incBtn = host.querySelector<HTMLButtonElement>('[data-quick-copies-inc]');
    const decBtn = host.querySelector<HTMLButtonElement>('[data-quick-copies-dec]');

    expect(quickBtn).not.toBeNull();
    expect(copiesWrap).not.toBeNull();
    expect(copiesInput?.value).toBe('1');
    expect(quickBtn?.nextElementSibling).toBe(copiesWrap);

    // Increment twice -> 3 copies
    act(() => incBtn?.click());
    act(() => incBtn?.click());
    expect(copiesInput?.value).toBe('3');
    expect(useAppStore.getState().quickPrintCopies).toBe(3);

    // Decrement once -> 2 copies
    act(() => decBtn?.click());
    expect(copiesInput?.value).toBe('2');

    // Type custom count 12 and clamp over maxCopies (99)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      setter?.call(copiesInput, '12');
      copiesInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(useAppStore.getState().quickPrintCopies).toBe(12);

    await act(async () => {
      quickBtn?.click();
      await Promise.resolve();
    });

    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy.mock.calls[0]?.[0]?.copies).toBe(12);

    // Clamps values exceeding printer maxCopies (99)
    act(() => useAppStore.getState().setQuickPrintCopies(500));
    expect(useAppStore.getState().quickPrintCopies).toBe(99);
  });

  it('preserves quickPrintCopies in duplex confirmation workflow', async () => {
    const duplexPrinter: PrinterInfo = {
      ...samplePrinter,
      activeProfile: { ...samplePrinter.activeProfile, duplexMode: 'long-edge' },
    };
    const submitSpy = vi.fn<(req: PrintJobRequest) => Promise<void>>(async () => {});
    useAppStore.setState({
      printers: [duplexPrinter],
      layout: { ...DEFAULT_LAYOUT, duplexMode: 'long-edge' },
      quickPrintCopies: 5,
      submitPrintJob: submitSpy,
    });

    await act(async () => {
      await useAppStore.getState().silentPrintNow();
    });

    const pending = useAppStore.getState().pendingDuplexPrint;
    expect(pending?.copies).toBe(5);

    await act(async () => {
      await useAppStore.getState().confirmDuplexPrint();
    });

    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy.mock.calls[0]?.[0]?.copies).toBe(5);
  });
});
