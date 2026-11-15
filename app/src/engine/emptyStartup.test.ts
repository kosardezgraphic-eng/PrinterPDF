// @vitest-environment node
/**
 * The desk is empty until a real file arrives.
 *
 * The app used to generate a four-document print shop sample inside `initializeWorkspace`, so the
 * first thing an operator saw was fake pages — and anything they then dragged in landed on a sheet
 * already crowded with them. Startup reads printer state and nothing else, and it must leave a
 * workspace that already has files alone (a hot reload or a StrictMode remount is not a licence to
 * throw the operator's work away).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem, SourceDocument } from '@shared/models';

vi.mock('./pdfService', async importOriginal => {
  const actual = await importOriginal<typeof import('./pdfService')>();
  return {
    ...actual,
    createSamplePrintShopWorkspace: vi.fn(async () => {
      throw new Error('the sample must never be generated on its own');
    }),
    importFilesBatch: vi.fn(async () => ({ documents: [], pages: [], bookmarks: [], errors: [] })),
  };
});

// The bridge is one exported object, so the stubs replace its methods rather than named exports.
vi.mock('./ipcBridge', async importOriginal => {
  const actual = await importOriginal<typeof import('./ipcBridge')>();
  return {
    ...actual,
    ipcBridge: {
      ...actual.ipcBridge,
      // Rich enough for `sanitizePrinterInfo` in shared/models, which reads capabilities and the
      // active profile of every printer the bridge reports.
      listPrinters: vi.fn(async () => [{
        name: 'Hall Printer',
        isDefault: true,
        capabilities: { supportedPapers: ['A4'], supportedTrays: ['Auto Select'], supportedMediaTypes: ['Plain Paper'] },
        activeProfile: { printerName: 'Hall Printer', paperSize: 'A4', tray: 'Auto Select', mediaType: 'Plain Paper' },
      }]),
      listSpoolerJobs: vi.fn(async () => []),
      getPrinterStatusNote: vi.fn(async () => null),
    },
  };
});

import { createSamplePrintShopWorkspace, importFilesBatch } from './pdfService';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';

const doc = (id: string): SourceDocument => ({
  id, name: `${id}.pdf`, filePath: `${id}.pdf`, fileSize: 10, fileType: 'pdf',
  mimeType: 'application/pdf', pageCount: 1, createdAt: '',
});
const page = (id: string, overrides: Partial<PageItem> = {}): PageItem => ({
  id, documentId: 'mine', documentName: 'mine.pdf', sourcePageNumber: 1, widthMm: 100, heightMm: 200,
  rotation: 0, selectedForPrint: true, isHighlighted: false, isBlankPage: false,
  colorProfile: 'color', inkCoveragePercent: 0, ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    documents: [], pages: [], bookmarks: [], overlays: [], toasts: [],
    layout: { ...DEFAULT_LAYOUT, duplexMode: 'none' },
    settings: { ...DEFAULT_SETTINGS, language: 'en' },
    activeSheetIndex: 0, previewPageRequest: null, activePageId: null,
    selectPrinter: vi.fn(),
  });
});

describe('workspace start-up', () => {
  it('starts on an empty desk and never generates the sample', async () => {
    await useAppStore.getState().initializeWorkspace();
    const state = useAppStore.getState();

    expect(createSamplePrintShopWorkspace).not.toHaveBeenCalled();
    expect(state.documents).toEqual([]);
    expect(state.pages).toEqual([]);
    expect(state.bookmarks).toEqual([]);
    expect(state.overlays).toEqual([]);
    // A missing sample must not be reported as a failure either — there is nothing to load.
    expect(state.toasts.some(toast => /sample/i.test(toast.title ?? ''))).toBe(false);
  });

  it('still reads the printers, because that is what start-up is for', async () => {
    await useAppStore.getState().initializeWorkspace();
    const state = useAppStore.getState();

    // 'Hall Printer' only exists in the stubbed bridge, so seeing it proves start-up still asked.
    expect(state.printers.map(printer => printer.name)).toEqual(['Hall Printer']);
    expect(state.selectedPrinterName).toBe('Hall Printer');
    expect(state.printerServiceError).toBeNull();
  });

  it('leaves a workspace that already has files alone when it initialises again', async () => {
    useAppStore.setState({ documents: [doc('mine')], pages: [page('mine-p1', { isHighlighted: true })] });

    await useAppStore.getState().initializeWorkspace();

    expect(useAppStore.getState().pages.map(item => item.id)).toEqual(['mine-p1']);
    expect(useAppStore.getState().documents.map(item => item.id)).toEqual(['mine']);
  });

  it('follows an imported file with the preview instead of leaving the old sheet on screen', async () => {
    // A big desk, currently looked at in the middle of it.
    const existing = Array.from({ length: 12 }, (_, index) => page(`old-${index}`));
    useAppStore.setState({ pages: existing, documents: [doc('mine')], activeSheetIndex: 5 });
    vi.mocked(importFilesBatch).mockResolvedValueOnce({
      documents: [doc('fresh')], pages: [page('fresh-p1', { documentId: 'fresh', documentName: 'fresh.pdf' })],
      bookmarks: [], errors: [],
    });

    await useAppStore.getState().importFiles([new File(['%PDF-1.4'], 'fresh.pdf', { type: 'application/pdf' })]);

    const state = useAppStore.getState();
    expect(state.pages).toHaveLength(13);
    // Navigation is asked for the first new page, which is what makes the drop visibly arrive; the
    // preview turns that request into the sheet and the scroll position.
    expect(state.previewPageRequest).toEqual({ pageId: 'fresh-p1' });
    expect(state.activePageId).toBe('fresh-p1');
  });

  it('does not move the preview when a drop produced no document at all', async () => {
    useAppStore.setState({ pages: [page('old-1')], activeSheetIndex: 0 });

    await useAppStore.getState().importFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })]);

    expect(useAppStore.getState().previewPageRequest).toBeNull();
    expect(useAppStore.getState().pages).toHaveLength(1);
  });
});
