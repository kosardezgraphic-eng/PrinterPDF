/**
 * PrintStudio Pro — Central Zustand Store with Command Pattern Undo/Redo
 */

import { create } from 'zustand';
import type {
  AppSettings,
  BatchJobItem,
  BookmarkItem,
  EffectsSettings,
  LayoutSettings,
  PageItem,
  PageNumberSettings,
  PageRotation,
  PrinterInfo,
  PrinterProfileSettings,
  PrintJobRequest,
  PspProjectFile,
  SourceDocument,
  SpoolerJobInfo,
  WatermarkSettings,
} from '@shared/models';
import { CommandHistoryManager } from '../engine/commandHistory';
import {
  getDefaultPageNumberSettings,
  getDefaultWatermarkSettings,
} from '../engine/watermarkEngine';
import {
  buildCrispPageSvgDataUrl,
  createSamplePrintShopWorkspace,
  exportImposedPdf,
  importFilesBatch,
  triggerBlobDownload,
} from '../engine/pdfService';
import { cropToMm, type Insets } from '../engine/pageGeometry';
import { ipcBridge, selectOptimalPrinter } from '../engine/ipcBridge';

export type RibbonTabId =
  | 'file'
  | 'layout'
  | 'effects'
  | 'insert'
  | 'crop'
  | 'pdf'
  | 'batch'
  | 'printers'
  | 'view';

export type PageEditScope = 'current' | 'selected' | 'all';

export type PreviewViewMode = 'single' | 'double' | 'grid' | 'continuous';

export interface ToastNotification {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message?: string;
}

interface WorkspaceSnapshot {
  documents: SourceDocument[];
  pages: PageItem[];
  bookmarks: BookmarkItem[];
  layout: LayoutSettings;
  effects: EffectsSettings;
  watermark: WatermarkSettings;
  pageNumbering: PageNumberSettings;
}

const historyManager = new CommandHistoryManager<WorkspaceSnapshot>(300);

export const DEFAULT_LAYOUT: LayoutSettings = {
  paperSize: 'A4',
  customWidthMm: 210,
  customHeightMm: 297,
  orientation: 'portrait',
  rows: 1,
  cols: 1,
  placementMode: 'sequential',
  uniqueScale: false,
  marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
  horizontalGutterMm: 6,
  verticalGutterMm: 6,
  scaleMode: 'fit',
  customScalePercent: 100,
  alignment: 'center',
  autoRotateToFit: true,
  duplexMode: 'long-edge',
  sheetOrder: 'rtl',
  manualDuplex: false,
  showCellBorders: true,
  showCropMarks: false,
};

export const DEFAULT_EFFECTS: EffectsSettings = {
  enabled: true,
  scope: 'all',
  invert: false,
  invertPdfStrategy: 'vector-blend',
  grayscale: false,
  blackAndWhite: false,
  threshold: 135,
  blackText: false,
  brightness: 0,
  contrast: 0,
  gamma: 1.0,
  sharpness: 0,
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'fa',
  theme: 'dark',
  unit: 'mm',
  calendar: 'shamsi',
  userName: 'اپراتور چاپخانه مرکزی',
  defaultOutputFolder: 'C:\\PrintStudio\\Output',
  maxCachePages: 400,
  bwPageTariffRials: 15_000,
  colorPageTariffRials: 65_000,
  duplexDiscountPercent: 12,
  autoSaveIntervalSec: 30,
  autoSelectPrinterByPaperAndColor: true,
};

const INITIAL_BATCH_QUEUE: BatchJobItem[] = [
  {
    id: 'batch-1',
    fileName: 'جزوه-مدار-الکتریکی-دانشگاه-تهران.pdf',
    fileSize: 6_420_000,
    pageCount: 64,
    printerName: 'HP LaserJet Enterprise M611dn (High-Speed B&W)',
    copies: 5,
    nUp: 2,
    duplexMode: 'long-edge',
    invert: false,
    status: 'completed',
    progressPercent: 100,
    retryCount: 0,
    addedAt: new Date(Date.now() - 600_000).toISOString(),
    completedAt: new Date(Date.now() - 320_000).toISOString(),
  },
  {
    id: 'batch-2',
    fileName: 'کاتالوگ-نمایشگاه-بین‌المللی-چاپ.pdf',
    fileSize: 18_910_000,
    pageCount: 24,
    printerName: 'Konica Minolta Bizhub C458 (Production Color)',
    copies: 10,
    nUp: 1,
    duplexMode: 'long-edge',
    invert: false,
    status: 'queued',
    progressPercent: 0,
    retryCount: 0,
    addedAt: new Date(Date.now() - 180_000).toISOString(),
  },
  {
    id: 'batch-3',
    fileName: 'اسلایدهای-تاریک-هوش-مصنوعی-Inverted.pdf',
    fileSize: 4_120_000,
    pageCount: 36,
    printerName: 'HP LaserJet Enterprise M611dn (High-Speed B&W)',
    copies: 2,
    nUp: 4,
    duplexMode: 'long-edge',
    invert: true,
    status: 'queued',
    progressPercent: 0,
    retryCount: 0,
    addedAt: new Date(Date.now() - 90_000).toISOString(),
  },
];

interface AppState {
  // Core domain state
  documents: SourceDocument[];
  pages: PageItem[];
  bookmarks: BookmarkItem[];
  layout: LayoutSettings;
  effects: EffectsSettings;
  watermark: WatermarkSettings;
  pageNumbering: PageNumberSettings;
  settings: AppSettings;

  // Printers & Spooler
  printers: PrinterInfo[];
  selectedPrinterName: string;
  spoolerJobs: SpoolerJobInfo[];

  // Batch Queue
  batchQueue: BatchJobItem[];
  isBatchRunning: boolean;

  // UI & Workspace State
  activeRibbonTab: RibbonTabId;
  ribbonCollapsed: boolean;
  sidebarTab: 'pages' | 'bookmarks';
  activeSheetIndex: number;
  zoomPercent: number;
  viewMode: PreviewViewMode;
  showRulers: boolean;
  loupeEnabled: boolean;
  transparentMode: boolean;
  isExportingPdf: boolean;
  exportProgress: number;

  // Modals
  showCounterModal: boolean;
  showPrintModal: boolean;
  showSettingsModal: boolean;
  showManualDuplexModal: boolean;
  showSplitModal: boolean;
  showOnboardingTour: boolean;

  // Undo/Redo metadata
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;

  // Notifications
  toasts: ToastNotification[];

  // Actions
  initializeWorkspace: () => Promise<void>;
  loadSampleWorkspace: () => Promise<void>;
  importFiles: (files: File[]) => Promise<void>;
  clearWorkspace: () => void;

  // Undo / Redo
  undo: () => void;
  redo: () => void;

  // Page Operations (A3 - A4)
  togglePageSelectedForPrint: (pageId: string) => void;
  highlightPage: (pageId: string, multiSelect?: boolean, rangeSelect?: boolean) => void;
  selectAllForPrint: (selected: boolean) => void;
  selectOddEvenForPrint: (mode: 'odd' | 'even') => void;
  invertPrintSelection: () => void;
  reversePageOrder: () => void;
  reorderPage: (fromIndex: number, toIndex: number) => void;
  moveHighlightedPages: (direction: 'up' | 'down') => void;
  rotatePages: (pageIds: string[], deltaDeg: 90 | 180 | 270) => void;
  applyPageGeometry: (pageId: string, scope: PageEditScope, edit: { kind: 'crop'; crop: Insets } | { kind: 'transform'; transform: NonNullable<PageItem['overrides']>['transform'] } | { kind: 'reset' }) => void;
  duplicatePages: (pageIds: string[]) => void;
  makePageArray: (pageId: string, count: number) => void;
  insertBlankPageAfter: (pageId?: string) => void;
  deletePages: (pageIds: string[]) => void;
  removeDocument: (docId: string) => void;
  toggleDocumentCollapse: (docId: string) => void;
  togglePageInvertOverride: (pageId: string) => void;
  splitEveryNPages: (everyN: number) => void;

  // Layout & Effects & Insert
  updateLayout: (patch: Partial<LayoutSettings>, recordUndo?: boolean) => void;
  setNUpMatrix: (rows: number, cols: number, placementMode?: LayoutSettings['placementMode']) => void;
  updateMargins: (patch: Partial<LayoutSettings['marginsMm']>) => void;
  updateEffects: (patch: Partial<EffectsSettings>, recordUndo?: boolean) => void;
  toggleGlobalInvert: () => void;
  resetEffects: () => void;
  updateWatermark: (patch: Partial<WatermarkSettings>) => void;
  updatePageNumbering: (patch: Partial<PageNumberSettings>) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;

  // Export & Print & Project
  exportMergedOrImposedPdf: (onlyHighlighted?: boolean) => Promise<void>;
  savePspProject: () => void;
  openPspProjectFile: (file: File) => Promise<void>;

  // Printers & Spooler
  selectPrinter: (printerName: string) => void;
  autoSelectBestPrinter: () => void;
  updatePrinterProfile: (printerName: string, profile: PrinterProfileSettings) => Promise<void>;
  setDefaultPrinter: (printerName: string) => Promise<void>;
  simulatePrinterStatusChange: (printerName: string, status: PrinterInfo['status']) => Promise<void>;
  submitPrintJob: (request: PrintJobRequest) => Promise<void>;
  silentPrintNow: () => Promise<void>;
  controlSpoolerJob: (
    printerName: string,
    jobId: number,
    action: 'pause' | 'resume' | 'restart' | 'cancel',
    priority?: number
  ) => Promise<void>;
  purgePrinterQueue: (printerName: string) => Promise<void>;

  // Batch Print Queue
  addCurrentWorkspaceToBatch: () => void;
  runBatchQueue: () => Promise<void>;
  pauseBatchQueue: () => void;
  removeBatchJob: (id: string) => void;
  retryFailedBatchJobs: () => void;

  // UI Helpers
  setActiveRibbonTab: (tab: RibbonTabId) => void;
  setRibbonCollapsed: (collapsed: boolean) => void;
  setSidebarTab: (tab: 'pages' | 'bookmarks') => void;
  setActiveSheetIndex: (idx: number) => void;
  setZoomPercent: (zoom: number) => void;
  setViewMode: (mode: PreviewViewMode) => void;
  setShowRulers: (show: boolean) => void;
  setLoupeEnabled: (enabled: boolean) => void;
  setTransparentMode: (enabled: boolean) => void;
  setModalState: (
    modal:
      | 'counter'
      | 'print'
      | 'settings'
      | 'manualDuplex'
      | 'split'
      | 'tour',
    open: boolean
  ) => void;
  addToast: (toast: Omit<ToastNotification, 'id'>) => void;
  dismissToast: (id: string) => void;
}

function captureSnapshot(state: AppState): WorkspaceSnapshot {
  return {
    documents: state.documents,
    pages: state.pages,
    bookmarks: state.bookmarks,
    layout: state.layout,
    effects: state.effects,
    watermark: state.watermark,
    pageNumbering: state.pageNumbering,
  };
}

export const useAppStore = create<AppState>((set, get) => {
  const pushUndo = (
    labelFa: string,
    labelEn: string,
    before: WorkspaceSnapshot,
    after: WorkspaceSnapshot
  ) => {
    historyManager.record(labelFa, labelEn, before, after);
    const lang = get().settings.language;
    const undoPeek = historyManager.peekUndo();
    const redoPeek = historyManager.peekRedo();
    set({
      canUndo: historyManager.canUndo(),
      canRedo: historyManager.canRedo(),
      undoLabel: undoPeek ? (lang === 'fa' ? undoPeek.labelFa : undoPeek.labelEn) : '',
      redoLabel: redoPeek ? (lang === 'fa' ? redoPeek.labelFa : redoPeek.labelEn) : '',
    });
  };

  return {
    documents: [],
    pages: [],
    bookmarks: [],
    layout: DEFAULT_LAYOUT,
    effects: DEFAULT_EFFECTS,
    watermark: getDefaultWatermarkSettings(),
    pageNumbering: getDefaultPageNumberSettings(),
    settings: DEFAULT_SETTINGS,

    printers: [],
    selectedPrinterName: '',
    spoolerJobs: [],

    batchQueue: INITIAL_BATCH_QUEUE,
    isBatchRunning: false,

    activeRibbonTab: 'layout',
    ribbonCollapsed: false,
    sidebarTab: 'pages',
    activeSheetIndex: 0,
    zoomPercent: 100,
    viewMode: 'single',
    showRulers: true,
    loupeEnabled: false,
    transparentMode: false,
    isExportingPdf: false,
    exportProgress: 0,

    showCounterModal: false,
    showPrintModal: false,
    showSettingsModal: false,
    showManualDuplexModal: false,
    showSplitModal: false,
    showOnboardingTour: false,

    canUndo: false,
    canRedo: false,
    undoLabel: '',
    redoLabel: '',

    toasts: [],

    initializeWorkspace: async () => {
      const [printerResult, jobResult, sampleResult] = await Promise.all([
        ipcBridge.listPrinters().then(value => ({ value, error: null as unknown })).catch(error => ({ value: [], error })),
        ipcBridge.listSpoolerJobs().then(value => ({ value, error: null as unknown })).catch(error => ({ value: [], error })),
        createSamplePrintShopWorkspace().then(value => ({ value, error: null as unknown })).catch(error => ({ value: null, error })),
      ]);
      const sample = sampleResult.value;
      if (sampleResult.error) {
        console.error('Sample PDF rendering failed:', sampleResult.error);
        get().addToast({ type: 'error', title: get().settings.language === 'fa' ? 'بارگذاری نمونه ناموفق بود' : 'Could not load sample',
          message: sampleResult.error instanceof Error ? sampleResult.error.message : String(sampleResult.error) });
      }
      const printers = printerResult.value;
      const spoolerJobs = jobResult.value;
      const error = printerResult.error ?? jobResult.error;
      if (error) {
        console.error('Printer service initialization failed:', error);
        get().addToast({
          type: 'error',
          title: get().settings.language === 'fa' ? 'اتصال به سرویس چاپگر برقرار نشد' : 'Printer service unavailable',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const defaultPrinter =
        printers.find((p) => p.isDefault)?.name ?? printers[0]?.name ?? '';
      set({
        printers,
        selectedPrinterName: defaultPrinter,
        spoolerJobs,
        documents: sample?.documents ?? [],
        pages: sample?.pages ?? [],
        bookmarks: sample?.bookmarks ?? [],
      });
    },

    loadSampleWorkspace: async () => {
      const before = captureSnapshot(get());
      const sample = await createSamplePrintShopWorkspace();
      set({
        documents: sample.documents,
        pages: sample.pages,
        bookmarks: sample.bookmarks,
        activeSheetIndex: 0,
      });
      pushUndo(
        'بارگذاری نمونه چاپخانه',
        'Load Print Shop Sample',
        before,
        captureSnapshot(get())
      );
      get().addToast({
        type: 'success',
        title:
          get().settings.language === 'fa'
            ? '۴ سند نمونه چاپخانه (۱۸ صفحه) با موفقیت بارگذاری شد'
            : 'Loaded 4 sample print shop documents (18 pages)',
      });
    },

    importFiles: async (files: File[]) => {
      if (files.length === 0) return;
      const before = captureSnapshot(get());
      const result = await importFilesBatch(files);

      if (result.documents.length > 0) {
        set((state) => ({
          documents: [...state.documents, ...result.documents],
          pages: [...state.pages, ...result.pages],
          bookmarks: [...state.bookmarks, ...result.bookmarks],
        }));
        pushUndo(
          `افزودن ${result.documents.length} فایل`,
          `Import ${result.documents.length} file(s)`,
          before,
          captureSnapshot(get())
        );
        get().addToast({
          type: 'success',
          title:
            get().settings.language === 'fa'
              ? `${result.documents.length} فایل (${result.pages.length} صفحه) اضافه شد`
              : `Imported ${result.documents.length} file(s) (${result.pages.length} pages)`,
        });
      }

      for (const err of result.errors) {
        const isFa = get().settings.language === 'fa';
        get().addToast({
          type: 'error',
          title: isFa ? err.reasonFa : err.reasonEn,
          message: isFa ? err.solutionFa : err.solutionEn,
        });
      }
    },

    clearWorkspace: () => {
      const before = captureSnapshot(get());
      set({
        documents: [],
        pages: [],
        bookmarks: [],
        activeSheetIndex: 0,
      });
      pushUndo('پاک‌سازی میز کار', 'Clear Workspace', before, captureSnapshot(get()));
    },

    undo: () => {
      const snap = historyManager.undo();
      if (!snap) return;
      const lang = get().settings.language;
      const undoPeek = historyManager.peekUndo();
      const redoPeek = historyManager.peekRedo();
      set({
        ...snap.before,
        canUndo: historyManager.canUndo(),
        canRedo: historyManager.canRedo(),
        undoLabel: undoPeek ? (lang === 'fa' ? undoPeek.labelFa : undoPeek.labelEn) : '',
        redoLabel: redoPeek ? (lang === 'fa' ? redoPeek.labelFa : redoPeek.labelEn) : '',
      });
      get().addToast({
        type: 'info',
        title:
          lang === 'fa'
            ? `واگرد: ${snap.labelFa}`
            : `Undone: ${snap.labelEn}`,
      });
    },

    redo: () => {
      const snap = historyManager.redo();
      if (!snap) return;
      const lang = get().settings.language;
      const undoPeek = historyManager.peekUndo();
      const redoPeek = historyManager.peekRedo();
      set({
        ...snap.after,
        canUndo: historyManager.canUndo(),
        canRedo: historyManager.canRedo(),
        undoLabel: undoPeek ? (lang === 'fa' ? undoPeek.labelFa : undoPeek.labelEn) : '',
        redoLabel: redoPeek ? (lang === 'fa' ? redoPeek.labelFa : redoPeek.labelEn) : '',
      });
      get().addToast({
        type: 'info',
        title:
          lang === 'fa'
            ? `ازنو: ${snap.labelFa}`
            : `Redone: ${snap.labelEn}`,
      });
    },

    togglePageSelectedForPrint: (pageId) => {
      const before = captureSnapshot(get());
      set((state) => ({
        pages: state.pages.map((p) =>
          p.id === pageId ? { ...p, selectedForPrint: !p.selectedForPrint } : p
        ),
      }));
      pushUndo(
        'تغییر وضعیت چاپ صفحه',
        'Toggle page print selection',
        before,
        captureSnapshot(get())
      );
    },

    highlightPage: (pageId, multiSelect = false, rangeSelect = false) => {
      set((state) => {
        const targetIndex = state.pages.findIndex((p) => p.id === pageId);
        if (targetIndex === -1) return state;

        if (rangeSelect) {
          const lastHighlightedIdx = state.pages.findIndex((p) => p.isHighlighted);
          const start = Math.min(
            lastHighlightedIdx === -1 ? targetIndex : lastHighlightedIdx,
            targetIndex
          );
          const end = Math.max(
            lastHighlightedIdx === -1 ? targetIndex : lastHighlightedIdx,
            targetIndex
          );
          return {
            pages: state.pages.map((p, idx) => ({
              ...p,
              isHighlighted: idx >= start && idx <= end,
            })),
          };
        }

        if (multiSelect) {
          return {
            pages: state.pages.map((p) =>
              p.id === pageId ? { ...p, isHighlighted: !p.isHighlighted } : p
            ),
          };
        }

        return {
          pages: state.pages.map((p) => ({
            ...p,
            isHighlighted: p.id === pageId,
          })),
        };
      });
    },

    selectAllForPrint: (selected) => {
      const before = captureSnapshot(get());
      set((state) => ({
        pages: state.pages.map((p) => ({
          ...p,
          selectedForPrint: selected,
          isHighlighted: selected,
        })),
      }));
      pushUndo(
        selected ? 'انتخاب همه صفحات' : 'لغو انتخاب همه صفحات',
        selected ? 'Select all pages' : 'Deselect all pages',
        before,
        captureSnapshot(get())
      );
    },

    selectOddEvenForPrint: (mode) => {
      const before = captureSnapshot(get());
      set((state) => ({
        pages: state.pages.map((p, idx) => {
          const oneBased = idx + 1;
          const match = mode === 'odd' ? oneBased % 2 === 1 : oneBased % 2 === 0;
          return {
            ...p,
            selectedForPrint: match,
            isHighlighted: match,
          };
        }),
      }));
      pushUndo(
        mode === 'odd' ? 'انتخاب صفحات فرد' : 'انتخاب صفحات زوج',
        mode === 'odd' ? 'Select odd pages' : 'Select even pages',
        before,
        captureSnapshot(get())
      );
    },

    invertPrintSelection: () => {
      const before = captureSnapshot(get());
      set((state) => ({ pages: state.pages.map((page) => ({
        ...page, selectedForPrint: !page.selectedForPrint, isHighlighted: !page.selectedForPrint,
      })) }));
      pushUndo('معکوس کردن انتخاب', 'Invert selection', before, captureSnapshot(get()));
    },

    reversePageOrder: () => {
      const before = captureSnapshot(get());
      set((state) => ({
        pages: state.pages.slice().reverse(),
      }));
      pushUndo(
        'معکوس کردن ترتیب صفحات',
        'Reverse page order',
        before,
        captureSnapshot(get())
      );
    },

    reorderPage: (fromIndex, toIndex) => {
      const state = get();
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= state.pages.length ||
        toIndex >= state.pages.length
      ) {
        return;
      }
      const before = captureSnapshot(state);
      const next = state.pages.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      set({ pages: next });
      pushUndo('جابجایی ترتیب صفحه', 'Reorder page', before, captureSnapshot(get()));
    },

    moveHighlightedPages: (direction) => {
      const state = get();
      const idx = state.pages.findIndex((p) => p.isHighlighted);
      if (idx === -1) return;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      get().reorderPage(idx, targetIdx);
    },

    applyPageGeometry: (pageId, scope, edit) => {
      const state = get();
      const targets = state.pages.filter(page => scope === 'all' || (scope === 'selected' ? page.isHighlighted : page.id === pageId));
      if (!targets.length) return;
      const ids = new Set(targets.map(page => page.id));
      const before = captureSnapshot(state);
      set(current => ({ pages: current.pages.map(page => {
        if (!ids.has(page.id)) return page;
        const overrides = { ...page.overrides };
        if (edit.kind === 'crop') {
          overrides.cropBoxMm = cropToMm(page, edit.crop);
          // Cropping re-fits the remaining content in its cell.
          delete overrides.transform;
        } else if (edit.kind === 'transform') overrides.transform = edit.transform;
        else { delete overrides.cropBoxMm; delete overrides.transform; }
        return { ...page, overrides };
      }) }));
      pushUndo('ویرایش هندسه صفحات', 'Edit page geometry', before, captureSnapshot(get()));
    },

    rotatePages: (pageIds, deltaDeg) => {
      const before = captureSnapshot(get());
      const idSet = new Set(pageIds);
      set((state) => ({
        pages: state.pages.map((p) =>
          idSet.has(p.id)
            ? {
                ...p,
                rotation: (((p.rotation + deltaDeg) % 360) as PageRotation),
              }
            : p
        ),
      }));
      pushUndo(
        `چرخش ${deltaDeg} درجه صفحات`,
        `Rotate pages ${deltaDeg}°`,
        before,
        captureSnapshot(get())
      );
    },

    duplicatePages: (pageIds) => {
      if (pageIds.length === 0) return;
      const before = captureSnapshot(get());
      const idSet = new Set(pageIds);
      set((state) => {
        const next: PageItem[] = [];
        for (const p of state.pages) {
          next.push(p);
          if (idSet.has(p.id)) {
            next.push({
              ...structuredClone(p),
              id: `${p.id}-dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              isHighlighted: true,
            });
          }
        }
        return { pages: next };
      });
      pushUndo('تکثیر صفحه (Duplicate)', 'Duplicate page(s)', before, captureSnapshot(get()));
    },

    makePageArray: (pageId, count) => {
      const safeCount = Math.max(2, Math.min(100, Math.floor(count)));
      const before = captureSnapshot(get());
      set((state) => {
        const next: PageItem[] = [];
        for (const p of state.pages) {
          next.push(p);
          if (p.id === pageId) {
            for (let i = 1; i < safeCount; i++) {
              next.push({
                ...structuredClone(p),
                id: `${p.id}-arr-${i}-${Date.now()}`,
              });
            }
          }
        }
        return { pages: next };
      });
      pushUndo(
        `تکرار آرایه‌ای صفحه (${safeCount} نسخه)`,
        `Make an Array (${safeCount} copies)`,
        before,
        captureSnapshot(get())
      );
    },

    insertBlankPageAfter: (pageId) => {
      const before = captureSnapshot(get());
      const blankThumb = buildCrispPageSvgDataUrl({
        title: 'Blank Page',
        subtitle: '',
        pageNumber: 1,
        totalPages: 1,
        widthMm: 210,
        heightMm: 297,
        colorProfile: 'blank',
        accentColor: '#94a3b8',
        lines: [],
      });

      set((state) => {
        const refPage =
          state.pages.find((p) => p.id === pageId) ??
          state.pages.find((p) => p.isHighlighted) ??
          state.pages[state.pages.length - 1];

        const blankPage: PageItem = {
          id: `blank-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          documentId: refPage?.documentId ?? 'blank-doc',
          documentName: refPage?.documentName ?? 'صفحات الحاقی',
          sourcePageNumber: 0,
          widthMm: refPage?.widthMm ?? 210,
          heightMm: refPage?.heightMm ?? 297,
          rotation: 0,
          selectedForPrint: true,
          isHighlighted: true,
          isBlankPage: true,
          colorProfile: 'blank',
          inkCoveragePercent: 0,
          thumbnailDataUrl: blankThumb,
        };

        if (!refPage) {
          return { pages: [blankPage] };
        }
        const idx = state.pages.findIndex((p) => p.id === refPage.id);
        const next = state.pages.slice();
        next.splice(idx + 1, 0, blankPage);
        return { pages: next };
      });

      pushUndo('درج صفحه خالی', 'Insert Blank Page', before, captureSnapshot(get()));
    },

    deletePages: (pageIds) => {
      if (pageIds.length === 0) return;
      const before = captureSnapshot(get());
      const idSet = new Set(pageIds);
      set((state) => ({
        pages: state.pages.filter((p) => !idSet.has(p.id)),
      }));
      pushUndo(
        `حذف ${pageIds.length} صفحه`,
        `Delete ${pageIds.length} page(s)`,
        before,
        captureSnapshot(get())
      );
    },

    removeDocument: (docId) => {
      const before = captureSnapshot(get());
      set((state) => ({
        documents: state.documents.filter((d) => d.id !== docId),
        pages: state.pages.filter((p) => p.documentId !== docId),
        bookmarks: state.bookmarks.filter((b) => b.documentId !== docId),
      }));
      pushUndo('حذف فایل از پروژه', 'Remove document', before, captureSnapshot(get()));
    },

    toggleDocumentCollapse: (docId) => {
      set((state) => ({
        documents: state.documents.map((d) =>
          d.id === docId ? { ...d, collapsed: !d.collapsed } : d
        ),
      }));
    },

    togglePageInvertOverride: (pageId) => {
      const before = captureSnapshot(get());
      set((state) => ({
        pages: state.pages.map((p) => {
          if (p.id !== pageId) return p;
          const current = p.overrides?.invert ?? false;
          return {
            ...p,
            overrides: {
              ...p.overrides,
              invert: !current,
            },
          };
        }),
      }));
      pushUndo(
        'معکوس رنگ (Invert) صفحه انتخابی',
        'Toggle page Invert override',
        before,
        captureSnapshot(get())
      );
    },

    splitEveryNPages: (everyN) => {
      const safeN = Math.max(1, Math.floor(everyN));
      const before = captureSnapshot(get());
      set((state) => {
        const newDocs: SourceDocument[] = [];
        const newPages: PageItem[] = [];
        const newBookmarks: BookmarkItem[] = [];

        let chunkIdx = 1;
        for (let i = 0; i < state.pages.length; i += safeN) {
          const slice = state.pages.slice(i, i + safeN);
          const docId = `split-doc-${Date.now()}-${chunkIdx}`;
          const docName = `بخش-${chunkIdx}-از-تفکیک (${slice.length} صفحه).pdf`;
          newDocs.push({
            id: docId,
            name: docName,
            filePath: docName,
            fileSize: slice.length * 145_000,
            fileType: 'pdf',
            mimeType: 'application/pdf',
            pageCount: slice.length,
            createdAt: new Date().toISOString(),
          });

          slice.forEach((p, idx) => {
            const updatedPage: PageItem = {
              ...p,
              documentId: docId,
              documentName: docName,
              sourcePageNumber: idx + 1,
            };
            newPages.push(updatedPage);
            if (idx === 0) {
              newBookmarks.push({
                id: `bm-${docId}`,
                title: docName.replace(/\.pdf$/i, ''),
                documentId: docId,
                targetPageId: updatedPage.id,
                pageIndex: newPages.length - 1,
                level: 0,
              });
            }
          });
          chunkIdx++;
        }

        return {
          documents: newDocs,
          pages: newPages,
          bookmarks: newBookmarks,
        };
      });
      pushUndo(
        `تفکیک سند هر ${safeN} صفحه`,
        `Split document every ${safeN} pages`,
        before,
        captureSnapshot(get())
      );
    },

    updateLayout: (patch, recordUndo = true) => {
      const before = captureSnapshot(get());
      set((state) => ({
        layout: { ...state.layout, ...patch },
        activeSheetIndex: 0,
      }));
      if (recordUndo) {
        pushUndo(
          'تغییر چیدمان صفحه (Layout)',
          'Update Page Layout',
          before,
          captureSnapshot(get())
        );
      }
      if (get().settings.autoSelectPrinterByPaperAndColor) {
        get().autoSelectBestPrinter();
      }
    },

    setNUpMatrix: (rows, cols, placementMode) => {
      const before = captureSnapshot(get());
      set((state) => ({
        layout: {
          ...state.layout,
          rows: Math.max(1, Math.min(10, rows)),
          cols: Math.max(1, Math.min(10, cols)),
          placementMode: placementMode ?? state.layout.placementMode,
        },
        activeSheetIndex: 0,
      }));
      pushUndo(
        `تغییر چیدمان به ${rows}×${cols} (${rows * cols}-Up)`,
        `Set ${rows}×${cols} (${rows * cols}-Up) layout`,
        before,
        captureSnapshot(get())
      );
    },

    updateMargins: (patch) => {
      const before = captureSnapshot(get());
      set((state) => ({
        layout: {
          ...state.layout,
          marginsMm: {
            ...state.layout.marginsMm,
            ...patch,
          },
        },
      }));
      pushUndo('تغییر حاشیه‌ها', 'Update margins', before, captureSnapshot(get()));
    },

    updateEffects: (patch, recordUndo = false) => {
      const before = captureSnapshot(get());
      set((state) => ({
        effects: { ...state.effects, ...patch },
      }));
      if (recordUndo) {
        pushUndo('تغییر افکت‌های تصویر', 'Update visual effects', before, captureSnapshot(get()));
      }
    },

    toggleGlobalInvert: () => {
      const before = captureSnapshot(get());
      const nextInvert = !get().effects.invert;
      set((state) => ({
        effects: {
          ...state.effects,
          enabled: true,
          invert: nextInvert,
        },
      }));
      pushUndo(
        nextInvert ? 'فعال‌سازی معکوس رنگ (Invert)' : 'غیرفعال‌سازی معکوس رنگ (Invert)',
        nextInvert ? 'Enable Invert Colors' : 'Disable Invert Colors',
        before,
        captureSnapshot(get())
      );
      get().addToast({
        type: 'info',
        title:
          get().settings.language === 'fa'
            ? nextInvert
              ? 'حالت معکوس رنگ (Invert) برای پیش‌نمایش، چاپ و خروجی PDF فعال شد'
              : 'حالت معکوس رنگ (Invert) غیرفعال شد'
            : nextInvert
              ? 'Invert Colors enabled for Preview, Print & Vector PDF Export'
              : 'Invert Colors disabled',
      });
    },

    resetEffects: () => {
      const before = captureSnapshot(get());
      set((state) => ({
        effects: DEFAULT_EFFECTS,
        pages: state.pages.map((p) => ({ ...p, overrides: undefined })),
      }));
      pushUndo('بازنشانی افکت‌ها', 'Reset all effects', before, captureSnapshot(get()));
    },

    updateWatermark: (patch) => {
      set((state) => ({
        watermark: { ...state.watermark, ...patch },
      }));
    },

    updatePageNumbering: (patch) => {
      set((state) => ({
        pageNumbering: { ...state.pageNumbering, ...patch },
      }));
    },

    updateSettings: (patch) => {
      set((state) => {
        const next = { ...state.settings, ...patch };
        void ipcBridge.saveSettings(next);
        return { settings: next };
      });
    },

    exportMergedOrImposedPdf: async (onlyHighlighted = false) => {
      const state = get();
      const targetPages = onlyHighlighted
        ? state.pages.filter((p) => p.isHighlighted)
        : state.pages.filter((p) => p.selectedForPrint);

      if (targetPages.length === 0) {
        state.addToast({
          type: 'warning',
          title:
            state.settings.language === 'fa'
              ? 'هیچ صفحه‌ای برای خروجی PDF انتخاب نشده است'
              : 'No pages selected for PDF export',
        });
        return;
      }

      set({ isExportingPdf: true, exportProgress: 10 });
      try {
        const pdfBytes = await exportImposedPdf({
          documents: state.documents,
          pages: targetPages.map((p) => ({ ...p, selectedForPrint: true })),
          layout: state.layout,
          effects: state.effects,
          watermark: state.watermark,
          pageNumbering: state.pageNumbering,
          userName: state.settings.userName,
          onProgress: (percent) => set({ exportProgress: percent }),
        });

        const fileName = onlyHighlighted
          ? `PrintStudio-Extracted-${targetPages.length}p.pdf`
          : `PrintStudio-Imposed-${state.layout.rows}x${state.layout.cols}-${Date.now()}.pdf`;

        triggerBlobDownload(pdfBytes, fileName, 'application/pdf');

        state.addToast({
          type: 'success',
          title:
            state.settings.language === 'fa'
              ? `فایل PDF نهایی (${fileName}) با کیفیت برداری ساخته و دانلود شد`
              : `Vector PDF (${fileName}) generated and downloaded`,
        });
      } finally {
        set({ isExportingPdf: false, exportProgress: 0 });
      }
    },

    savePspProject: () => {
      const state = get();
      const project: PspProjectFile = {
        version: '1.0.0',
        savedAt: new Date().toISOString(),
        appSettings: state.settings,
        layout: state.layout,
        effects: state.effects,
        watermark: state.watermark,
        pageNumbering: state.pageNumbering,
        documents: state.documents.map(({ rawBytes: _r, ...rest }) => rest),
        pages: state.pages,
        bookmarks: state.bookmarks,
      };
      void ipcBridge.saveAutoSaveSession(project);
      triggerBlobDownload(
        JSON.stringify(project, null, 2),
        `PrintStudio-Session-${Date.now()}.psp`,
        'application/json'
      );
      state.addToast({
        type: 'success',
        title:
          state.settings.language === 'fa'
            ? 'پروژه با فرمت .psp ذخیره شد (Auto-save نیز به‌روزرسانی گردید)'
            : 'Project saved as .psp file',
      });
    },

    openPspProjectFile: async (file) => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as PspProjectFile;
        if (!parsed.pages || !parsed.layout) {
          throw new Error('INVALID_PSP');
        }
        set({
          layout: parsed.layout,
          effects: parsed.effects ?? DEFAULT_EFFECTS,
          watermark: parsed.watermark ?? getDefaultWatermarkSettings(),
          pageNumbering: parsed.pageNumbering ?? getDefaultPageNumberSettings(),
          documents: parsed.documents as SourceDocument[],
          pages: parsed.pages,
          bookmarks: parsed.bookmarks ?? [],
          activeSheetIndex: 0,
        });
        get().addToast({
          type: 'success',
          title:
            get().settings.language === 'fa'
              ? 'پروژه .psp با موفقیت بازیابی شد'
              : 'Restored .psp project session',
        });
      } catch {
        get().addToast({
          type: 'error',
          title:
            get().settings.language === 'fa'
              ? 'فایل پروژه .psp معتبر نیست'
              : 'Invalid .psp project file',
        });
      }
    },

    selectPrinter: (printerName) => {
      set({ selectedPrinterName: printerName });
    },

    autoSelectBestPrinter: () => {
      const state = get();
      const needsColor = state.pages.some(
        (p) => p.selectedForPrint && p.colorProfile === 'color'
      ) && !state.effects.grayscale && !state.effects.blackAndWhite;
      const optimal = selectOptimalPrinter(
        state.printers,
        state.layout.paperSize,
        needsColor
      );
      if (optimal && optimal.name !== state.selectedPrinterName) {
        set({ selectedPrinterName: optimal.name });
      }
    },

    updatePrinterProfile: async (printerName, profile) => {
      const updated = await ipcBridge.updatePrinterProfile(printerName, profile);
      set((state) => ({
        printers: state.printers.map((p) =>
          p.name === printerName ? updated : p
        ),
      }));
    },

    setDefaultPrinter: async (printerName) => {
      await ipcBridge.setDefaultPrinter(printerName);
      const printers = await ipcBridge.listPrinters();
      set({ printers, selectedPrinterName: printerName });
    },

    simulatePrinterStatusChange: async (printerName, status) => {
      const printers = await ipcBridge.setSimulatedPrinterStatus(
        printerName,
        status
      );
      set({ printers });
      if (get().settings.autoSelectPrinterByPaperAndColor) {
        get().autoSelectBestPrinter();
      }
    },

    submitPrintJob: async (_request) => {
      // The sidecar does not yet implement PDF submission. Do not claim that a
      // browser simulator or a request without PDF bytes was physically printed.
      get().addToast({
        type: 'error',
        title: get().settings.language === 'fa' ? 'چاپ مستقیم هنوز متصل نشده است' : 'Direct printing is not available yet',
        message: get().settings.language === 'fa' ? 'هیچ کاری به چاپگر ارسال نشد. برای تهیه فایل از خروجی PDF استفاده کنید.' : 'No job was sent to a printer. Export a PDF instead.',
      });
    },

    silentPrintNow: async () => {
      const state = get();
      const printerName =
        state.selectedPrinterName || state.printers[0]?.name || 'PrintStudio Virtual Printer';
      await state.submitPrintJob({
        printerName,
        jobTitle: state.documents[0]?.name ?? 'PrintStudio Direct Job',
        copies: 1,
        collate: true,
        pageRangeMode: 'all-selected',
        customRangeText: '',
        oddEvenFilter: 'all',
        reverseOrder: false,
        duplexMode: state.layout.duplexMode,
        scaleMode: 'fit',
        dpi: 600,
        colorMode: state.effects.grayscale || state.effects.blackAndWhite ? 'bw' : 'color',
        tray: 'Auto Select',
        silent: true,
      });
    },

    controlSpoolerJob: async (printerName, jobId, action, priority) => {
      const jobs = await ipcBridge.controlSpoolerJob(
        printerName,
        jobId,
        action,
        priority
      );
      set({ spoolerJobs: jobs });
    },

    purgePrinterQueue: async (printerName) => {
      const jobs = await ipcBridge.purgePrinterQueue(printerName);
      const printers = await ipcBridge.listPrinters();
      set({ spoolerJobs: jobs, printers });
      get().addToast({
        type: 'info',
        title:
          get().settings.language === 'fa'
            ? `صف چاپ پرینتر «${printerName}» پاک‌سازی شد`
            : `Purged print queue for "${printerName}"`,
      });
    },

    addCurrentWorkspaceToBatch: () => {
      const state = get();
      const selectedCount = state.pages.filter((p) => p.selectedForPrint).length;
      if (selectedCount === 0) return;

      const newItem: BatchJobItem = {
        id: `batch-${Date.now()}`,
        fileName:
          state.documents.length === 1
            ? state.documents[0].name
            : `پروژه-ادغامی-${state.documents.length}-فایل.pdf`,
        fileSize: state.documents.reduce((acc, d) => acc + d.fileSize, 0),
        pageCount: selectedCount,
        printerName: state.selectedPrinterName || 'Konica Minolta Bizhub C458 (Production Color)',
        copies: 1,
        nUp: state.layout.rows * state.layout.cols,
        duplexMode: state.layout.duplexMode,
        invert: state.effects.invert,
        status: 'queued',
        progressPercent: 0,
        retryCount: 0,
        addedAt: new Date().toISOString(),
      };

      set((s) => ({
        batchQueue: [...s.batchQueue, newItem],
        activeRibbonTab: 'batch',
      }));
      state.addToast({
        type: 'success',
        title:
          state.settings.language === 'fa'
            ? 'پروژه فعلی به صف چاپ دسته‌ای (Batch Queue) اضافه شد'
            : 'Added current workspace to Batch Print Queue',
      });
    },

    runBatchQueue: async () => {
      // Batch items contain only metadata, not a snapshot of the document bytes.
      // Marking them complete would falsely report that a job was printed.
      const message = get().settings.language === 'fa'
        ? 'چاپ دسته‌ای هنوز به ارسال واقعی اسناد متصل نیست؛ هیچ کاری چاپ نشد.'
        : 'Batch printing is not connected to document submission; no jobs were printed.';
      set(state => ({
        isBatchRunning: false,
        batchQueue: state.batchQueue.map(item => item.status === 'queued'
          ? { ...item, status: 'failed', progressPercent: 0 }
          : item),
      }));
      get().addToast({ type: 'error', title: message });
    },

    pauseBatchQueue: () => {
      set((s) => ({
        isBatchRunning: false,
        batchQueue: s.batchQueue.map((b) =>
          b.status === 'processing' ? { ...b, status: 'paused' } : b
        ),
      }));
    },

    removeBatchJob: (id) => {
      set((s) => ({
        batchQueue: s.batchQueue.filter((b) => b.id !== id),
      }));
    },

    retryFailedBatchJobs: () => {
      set((s) => ({
        batchQueue: s.batchQueue.map((b) =>
          b.status === 'failed' || b.status === 'paused'
            ? {
                ...b,
                status: 'queued',
                progressPercent: 0,
                retryCount: b.retryCount + 1,
              }
            : b
        ),
      }));
      void get().runBatchQueue();
    },

    setActiveRibbonTab: (tab) => set({ activeRibbonTab: tab }),
    setRibbonCollapsed: (collapsed) => set({ ribbonCollapsed: collapsed }),
    setSidebarTab: (tab) => set({ sidebarTab: tab }),
    setActiveSheetIndex: (idx) => set({ activeSheetIndex: Math.max(0, idx) }),
    setZoomPercent: (zoom) =>
      set({ zoomPercent: Math.max(5, Math.min(400, Math.round(zoom))) }),
    setViewMode: (mode) => set({ viewMode: mode }),
    setShowRulers: (show) => set({ showRulers: show }),
    setLoupeEnabled: (enabled) => set({ loupeEnabled: enabled }),
    setTransparentMode: (enabled) => set({ transparentMode: enabled }),

    setModalState: (modal, open) => {
      if (modal === 'counter') set({ showCounterModal: open });
      if (modal === 'print') set({ showPrintModal: open });
      if (modal === 'settings') set({ showSettingsModal: open });
      if (modal === 'manualDuplex') set({ showManualDuplexModal: open });
      if (modal === 'split') set({ showSplitModal: open });
      if (modal === 'tour') set({ showOnboardingTour: open });
    },

    addToast: (toast) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id }] }));
      setTimeout(() => {
        get().dismissToast(id);
      }, 4500);
    },

    dismissToast: (id) => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
  };
});
