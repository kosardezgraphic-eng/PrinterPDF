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
  PageOverlay,
  PageOverlayText,
  PageOverlayNumbering,
  PageOverlayImage,
  PageOverlayShape,
  ShapeType,
  ComputedSheetSide,
  TextScriptRange,
  PageNumberSettings,
  PageRotation,
  PageTransform,
  PrinterInfo,
  RulerGuide,
  PrinterMarginResult,
  PrinterProfileSettings,
  PrintJobRequest,
  PspProjectFile,
  SettingsPreset,
  SourceDocument,
  SpoolerJobInfo,
  WatermarkSettings,
} from '@shared/models';
import {
  clearCrispPreviewCache,
  configureVectorPreview,
  crispCacheBytesFor,
  crispPreviewStats,
  releaseCrispPreviewDocument,
  setCrispPreviewByteBudget,
  setCrispPreviewCacheLimit,
  setCrispPreviewEnabled,
} from '../engine/vectorPreviewBridge';
import { CommandHistoryManager } from '../engine/commandHistory';
import {
  getDefaultPageNumberSettings,
  getDefaultWatermarkSettings,
} from '../engine/watermarkEngine';
import { PDFDocument } from 'pdf-lib';
import {
  buildCrispPageSvgDataUrl,
  createSamplePrintShopWorkspace,
  exportImposedPdf,
  importFilesBatch,
  parsePageRangeText,
  renderPdfToSheetPngs,
  triggerBlobDownload,
} from '../engine/pdfService';
import {
  SHEET_DEFAULT_PRESET_ID,
  SHEET_DEFAULT_PRESET_SHORTCUT,
  STANDARD_PAPER_SIZES,
  sanitizePrinterInfo,
  sanitizeSettingsPresetList,
  sanitizeSettingsShortcut,
} from '@shared/models';
import {
  imageDropPlacement,
  imageOverlayFromPlacement,
  newOverlayId as newImageId,
} from '../engine/imageOverlays';
import { defaultShapeStyle, normalizeShapeStyle, shapeCapabilities } from '../engine/shapes';
import { isImageFile, measureImage, readFileAsDataUrl } from '../engine/imageImport';
import { centeredAspectCrop, cropToMm, IDENTITY_TRANSFORM, type Insets } from '../engine/pageGeometry';
import { computeImpositionSheets, getSheetDimensionsMm, sortCellsByLayer } from '../engine/layoutEngine';
import { ipcBridge, selectOptimalPrinter } from '../engine/ipcBridge';
import { adjustScriptRanges, setScriptRange } from '../engine/textFormatting';

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
  overlays: PageOverlay[];
}

const historyManager = new CommandHistoryManager<WorkspaceSnapshot>(300);

let printRunSequence = 0;
let activePrintRunId = 0;
const canceledPrintRuns = new Set<number>();
let activeSpoolerJob: { printerName: string; jobId: number } | null = null;

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
  marginMode: 'printer',
  horizontalGutterMm: 6,
  verticalGutterMm: 6,
  scaleMode: 'fit',
  customScalePercent: 100,
  alignment: 'center',
  autoRotateToFit: true,
  duplexMode: 'long-edge',
  sheetOrder: 'rtl',
  manualDuplex: false,
  showCellBorders: false,
  showCropMarks: false,
  booklet: { enabled: false, direction: 'rtl', signatureSize: 0, spineWidthMm: 4, creepMm: 0.2, duplexMode: 'short-edge', outerMarginMm: 10, compensateCreep: true },
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
  // Vector pages are re-rendered at the size they are shown — the only way a hairline stays a hairline.
  // The cost is bounded by the cache limit and the render queue, not by how big the file is.
  previewFidelity: 'crisp',
};

/** Why a profile edit was refused; the panel turns these into one-line messages in both languages. */
export type SettingsPresetEditError =
  | 'unknown-id' | 'empty-name' | 'duplicate-name' | 'builtin'
  | 'bad-shortcut' | 'reserved-shortcut' | 'duplicate-shortcut';
export type SettingsPresetEditResult = { ok: true; id: string } | { ok: false; error: SettingsPresetEditError };

const INITIAL_BATCH_QUEUE: BatchJobItem[] = [];

export interface TextEditSession {
  overlayId: string; occurrenceKey: string; text: string; ranges: TextScriptRange[];
  selectionStart: number; selectionEnd: number;
}

export interface PrintProgressState {
  active: boolean;
  jobTitle: string;
  printerName: string;
  stage:
    | 'preparing'
    | 'rendering'
    | 'sending'
    | 'printing'
    | 'canceling'
    | 'canceled'
    | 'completed'
    | 'error';
  percent: number;
  currentSheet: number;
  totalSheets: number;
  spoolerJobId?: number;
  errorMessage?: string;
}

interface AppState {
  // Core domain state
  documents: SourceDocument[];
  pages: PageItem[];
  bookmarks: BookmarkItem[];
  layout: LayoutSettings;
  effects: EffectsSettings;
  watermark: WatermarkSettings;
  pageNumbering: PageNumberSettings;
  overlays: PageOverlay[];
  selectedOverlayId: string | null;
  activePageId: string | null;
  textEdit: TextEditSession | null;
  settings: AppSettings;

  // Printers & Spooler
  printers: PrinterInfo[];
  selectedPrinterName: string;
  printerMargins: PrinterMarginResult | { status: 'loading' };
  spoolerJobs: SpoolerJobInfo[];
  /** Why the real printer list could not be read, or null when the last attempt worked. */
  printerServiceError: string | null;
  /** What the desktop app says about its print sidecar when no call has failed (e.g. it died). */
  printerServiceNote: string | null;
  isRefreshingPrinters: boolean;

  // Batch Queue
  batchQueue: BatchJobItem[];
  isBatchRunning: boolean;

  // UI & Workspace State
  activeRibbonTab: RibbonTabId;
  ribbonCollapsed: boolean;
  sidebarTab: 'pages' | 'bookmarks';
  activeSheetIndex: number;
  sidebarReveal: { pageId: string; occurrenceKey?: string } | null;
  previewPageRequest: { pageId: string } | null;
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
  pendingDuplexPrint: PrintJobRequest | null;
  printProgress: PrintProgressState | null;

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
  invertAllPrintSelection: () => void;
  /** Inverts the print state of the given pages only — the sidebar context menu works on a selection. */
  invertPagesPrintSelection: (pageIds: string[]) => void;
  highlightPage: (pageId: string, multiSelect?: boolean, rangeSelect?: boolean) => void;
  requestPreviewPage: (pageId: string) => void;
  focusPageFromPreview: (pageId: string | null, preserveSelection?: boolean, occurrenceKey?: string) => void;
  selectAllForPrint: (selected: boolean) => void;
  selectOddEvenForPrint: (mode: 'odd' | 'even') => void;
  invertPrintSelection: () => void;
  reversePageOrder: () => void;
  reorderPage: (fromIndex: number, toIndex: number) => void;
  reorderPages: (pageIds: string[], targetPageId: string, position: 'before' | 'after') => void;
  moveHighlightedPages: (direction: 'up' | 'down') => void;
  rotatePages: (pageIds: string[], deltaDeg: 90 | 180 | 270) => void;
  applyAspectRatioCrop: (pageId: string, scope: PageEditScope, ratio: number) => boolean;
  applyPageGeometry: (pageId: string, scope: PageEditScope, edit: { kind: 'crop'; crop: Insets } | { kind: 'transform'; transform: NonNullable<PageItem['overrides']>['transform'] } | { kind: 'reset' }) => void;
  applyCellTransform: (pageId: string, occurrenceKey: string, transform: PageTransform) => void;
  resetCellGeometry: (pageId: string, occurrenceKey: string) => void;
  reorderCellLayer: (sheetIndex: number, occurrenceKey: string, direction: 'front' | 'back' | 'forward' | 'backward') => void;
  duplicatePages: (pageIds: string[]) => void;
  makePageArray: (pageId: string, count: number) => void;
  /** Repeats every given page as an array, in one undo step. */
  makePagesArray: (pageIds: string[], count: number) => void;
  insertBlankPageAfter: (pageId?: string) => void;
  /** Adds one blank page after every given page; with no page given it follows the selection. */
  insertBlankPagesAfter: (pageIds: string[]) => void;
  deletePages: (pageIds: string[]) => void;
  removeDocument: (docId: string) => void;
  toggleDocumentCollapse: (docId: string) => void;
  togglePageInvertOverride: (pageId: string) => void;
  /** Sets the invert override on all given pages, or clears it when all of them already have it. */
  togglePagesInvertOverride: (pageIds: string[]) => void;
  splitEveryNPages: (everyN: number) => void;

  // Layout & Effects & Insert
  updateLayout: (patch: Partial<LayoutSettings>, recordUndo?: boolean) => void;
  setNUpMatrix: (rows: number, cols: number, placementMode?: LayoutSettings['placementMode']) => void;
  updateMargins: (patch: Partial<LayoutSettings['marginsMm']>) => void;
  addRulerGuide: (guide: RulerGuide) => void;
  moveRulerGuide: (id: string, positionMm: number) => void;
  removeRulerGuide: (id: string) => void;
  resetMarginsToPrinter: () => void;
  refreshPrinterMargins: () => void;
  commitLayoutGuides: (patch: Partial<Pick<LayoutSettings, 'marginsMm' | 'horizontalGutterMm' | 'verticalGutterMm'>>) => void;
  updateEffects: (patch: Partial<EffectsSettings>, recordUndo?: boolean) => void;
  toggleGlobalInvert: () => void;
  resetEffects: () => void;
  updateWatermark: (patch: Partial<WatermarkSettings>) => void;
  updatePageNumbering: (patch: Partial<PageNumberSettings>) => void;
  addOverlay: (overlay: PageOverlay) => void;
  updateOverlay: (id: string, patch: Partial<PageOverlay>) => void;
  removeOverlay: (id: string) => void;
  selectOverlay: (id: string | null) => void;
  addTextOverlay: () => void;
  addNumberingOverlay: (convertLegacy?: boolean) => void;
  /**
   * Draws a geometric shape on the current page (or on the sheet, when there is no page to sit on) and
   * selects it, so the shape panel opens on the thing that was just inserted. The outline itself is
   * described once, in `engine/shapes.ts`, and shared by the preview and the exported PDF.
   */
  addShapeOverlay: (type: ShapeType, patch?: Partial<PageOverlayShape>) => string | null;
  /** Moves a layer in the stacking order, which is the order of the `overlays` array. */
  reorderOverlay: (overlayId: string, where: 'front' | 'forward' | 'backward' | 'back') => void;
  addImageOverlayFiles: (files: File[], sheet?: ComputedSheetSide, point?: {xMm:number;yMm:number}) => Promise<number>;
  beginTextEdit: (id: string, occurrenceKey: string) => void;
  updateTextDraft: (text: string, start: number, end: number) => void;
  selectTextDraft: (start: number, end: number) => void;
  styleTextSelection: (script: 'super' | 'sub') => void;
  insertTextToken: (token: string) => void;
  finishTextEdit: (cancel?: boolean) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;

  // Export & Print & Project
  exportMergedOrImposedPdf: (onlyHighlighted?: boolean) => Promise<void>;
  savePspProject: () => void;
  openPspProjectFile: (file: File) => Promise<void>;

  // Printers & Spooler
  selectPrinter: (printerName: string) => void;
  autoSelectBestPrinter: () => void;
  /** Asks the sidecar for the printer list again and reports exactly why it failed if it does. */
  retryPrinters: () => Promise<void>;
  updatePrinterProfile: (
    printerName: string,
    profile: PrinterProfileSettings | Partial<PrinterProfileSettings>
  ) => Promise<void>;
  setDefaultPrinter: (printerName: string) => Promise<void>;
  openPrinterPreferences: (printerName: string) => Promise<void>;
  submitPrintJob: (request: PrintJobRequest) => Promise<void>;
  silentPrintNow: () => Promise<void>;
  confirmDuplexPrint: (override?: Partial<PrintJobRequest>) => Promise<void>;
  dismissDuplexPrint: () => void;
  cancelActivePrintJob: () => Promise<void>;
  closePrintProgress: () => void;
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

  // Sheet profiles & reset (K2)
  /** Saved sheet profiles, in the order they were created. The defaults entry is not in here. */
  settingsPresets: SettingsPreset[];
  /**
   * The profile whose shortcut is being captured, or `null`. It lives in the store rather than in the
   * panel because the global key handler has to know to stand aside: while a recorder is waiting, a
   * chord must be *learned*, not fired.
   */
  shortcutRecordingFor: string | null;
  beginShortcutRecording: (presetId: string | null) => void;
  /**
   * Which profile the panel is *editing* right now — the row that shows its name field, chord recorder,
   * re-capture and delete buttons. Every other row is a single click to apply, which is the difference
   * between a list of buttons and a list of forms. `null` means nothing is open.
   */
  editingPresetId: string | null;
  /** Opens (or closes, with `null`) the edit controls of one profile. */
  beginEditPreset: (presetId: string | null) => void;
  /** Reads back the settings and the saved profiles from start-up — they used to be write-only. */
  restorePreferences: () => Promise<void>;
  /** Captures the current sheet settings under a name; a name already used is updated, like a save button. */
  saveSettingsPreset: (name: string, shortcut?: string) => string | null;
  /** Renames a profile, (re)assigns its shortcut, or both. Returns why it refused, if it did. */
  editSettingsPreset: (presetId: string, patch: { name?: string; shortcut?: string }) => SettingsPresetEditResult;
  /** Re-captures the current sheet settings into an existing profile, keeping its name and chord. */
  overwriteSettingsPreset: (presetId: string) => SettingsPresetEditResult;
  applySettingsPreset: (presetId: string) => void;
  deleteSettingsPreset: (presetId: string) => void;
  /** Every adjustable section goes back to the shipped defaults — documents and pages stay put. */
  resetAllSettings: () => void;
  /** Drops every crisp page bitmap and the parsed files behind them; visible cells re-render on demand. */
  clearCrispPreviewCacheNow: () => void;
}

function removeCellOverrides(layout: LayoutSettings, removedPageIds: Set<string>): LayoutSettings {
  if (!layout.cellOverrides) return layout;
  return { ...layout, cellOverrides: Object.fromEntries(Object.entries(layout.cellOverrides).filter(([, value]) => !removedPageIds.has(value.pageId))) };
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
    overlays: state.overlays,
  };
}

export const useAppStore = create<AppState>((set, get) => {
  // The crisp preview layer reads the desk through the store, and the store is the only place that knows
  // when a document arrives or leaves. The resolver is asked lazily, at the moment a render is started,
  // so a file that was closed in the meantime simply yields `null` and the cell keeps its thumbnail.
  configureVectorPreview({
    bytes: docId => get().documents.find((document) => document.id === docId)?.rawBytes,
    documents: () => get().documents,
  });
  let appliedCrispFlag: boolean | null = null;
  let appliedCrispCache = -1;
  let appliedCrispBytes = -1;
  /** Keeps the render pipeline and `settings` telling the same story, whoever changed them. */
  const syncCrispPreview = () => {
    const { previewFidelity, maxCachePages } = get().settings;
    const enabled = previewFidelity === 'crisp';
    if (appliedCrispFlag !== enabled) {
      appliedCrispFlag = enabled;
      setCrispPreviewEnabled(enabled);         // turning it off is also what frees what it was holding
    }
    // `maxCachePages` counts thumbnails; a preview cache holds whole sheets, so it is derived from the
    // same preference by weight rather than shared directly — both an entry count and a byte budget.
    const entries = Math.min(48, Math.max(16, Math.round((maxCachePages || 400) / 16)));
    if (appliedCrispCache !== entries) {
      appliedCrispCache = entries;
      setCrispPreviewCacheLimit(entries);
    }
    const bytes = crispCacheBytesFor(maxCachePages || 400);
    if (appliedCrispBytes !== bytes) {
      appliedCrispBytes = bytes;
      setCrispPreviewByteBudget(bytes);
    }
  };
  const presetNameKey = (name: string) => name.trim().toLowerCase();
  /**
   * What a profile stores: the sheet, and only the sheet. Language, unit, tariffs and the preview
   * settings stay out, so switching a profile on a loaded job cannot change how the application itself
   * behaves — a profile is a press setup, not a preferences dump.
   */
  const capturePresetSections = (): Pick<SettingsPreset, 'layout' | 'effects' | 'watermark' | 'pageNumbering'> => {
    const state = get();
    return {
      layout: { ...state.layout },
      effects: { ...state.effects },
      watermark: { ...state.watermark },
      pageNumbering: { ...state.pageNumbering },
    };
  };
  const newPresetId = () => `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  /** Canonicalises and checks a chord against the rules in `shared/models.ts` and against the other profiles. */
  const resolvePresetShortcut = (
    shortcut: string | undefined,
    exceptId: string
  ): { ok: true; value: string } | { ok: false; error: SettingsPresetEditError } => {
    const text = (shortcut ?? '').trim();
    if (!text) return { ok: true, value: '' };
    // Checked before the general rule so the message says what actually happened: `Alt+F6` is not an
    // unknown chord, it is the one the defaults entry owns.
    if (text.replace(/\s+/g, '').toLowerCase() === SHEET_DEFAULT_PRESET_SHORTCUT.toLowerCase()) {
      return { ok: false, error: 'reserved-shortcut' };
    }
    const canonical = sanitizeSettingsShortcut(text);
    if (!canonical) return { ok: false, error: 'bad-shortcut' };
    const taken = get().settingsPresets.some(item => item.id !== exceptId && item.shortcut === canonical);
    if (taken) return { ok: false, error: 'duplicate-shortcut' };
    return { ok: true, value: canonical };
  };
  const reportPresetError = (error: SettingsPresetEditError, name = ''): SettingsPresetEditResult => {
    const lang = get().settings.language;
    const messages: Record<SettingsPresetEditError, [string, string]> = {
      'unknown-id': ['پریست پیدا نشد', 'That profile is no longer stored'],
      'empty-name': ['نام پریست خالی است', 'The profile needs a name'],
      'duplicate-name': [`پریستی با نام «${name}» از قبل هست`, `A profile called "${name}" already exists`],
      builtin: ['پریست پیش‌فرض قابل ویرایش یا حذف نیست', 'The defaults entry cannot be edited or deleted'],
      'bad-shortcut': ['این کلید مجاز نیست', 'That key combination is not allowed'],
      'reserved-shortcut': ['این کلید برای پیش‌فرض رزرو شده است', 'That chord belongs to the defaults entry'],
      'duplicate-shortcut': ['این کلید به پریست دیگری اختصاص دارد', 'Another profile already uses that chord'],
    };
    const [titleFa, titleEn] = messages[error];
    get().addToast({
      type: 'warning',
      title: lang === 'fa' ? titleFa : titleEn,
      message: lang === 'fa'
        ? 'میانبر پروفایل باید Alt+F7 تا Alt+F12 یا Ctrl+Alt با یک حرف/رقم باشد.'
        : 'A profile chord must be Alt+F7 to Alt+F12, or Ctrl+Alt with one letter or digit.',
    });
    return { ok: false, error };
  };
  const persistPresets = (presets: SettingsPreset[]) => {
    void ipcBridge.saveSettingsPresets(presets).then(saved => {
      if (saved) return;
      const lang = get().settings.language;
      get().addToast({
        type: 'warning',
        title: lang === 'fa' ? 'ذخیره‌سازی پریست انجام نشد' : 'Could not save the preset',
        message: lang === 'fa'
          ? 'حافظهٔ تنظیمات در دسترس نیست؛ پریست فقط تا پایان این نشست نگه داشته می‌شود.'
          : 'The settings store is unavailable, so the preset only lasts for this session.',
      });
    });
  };

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
    overlays: [],
    selectedOverlayId: null,
    activePageId: null,
    textEdit: null,
    settings: DEFAULT_SETTINGS,

    printers: [],
    selectedPrinterName: '',
    printerMargins: { status: 'unavailable', reason: 'No printer selected' },
    spoolerJobs: [],
    printerServiceError: null,
    printerServiceNote: null,
    isRefreshingPrinters: false,

    batchQueue: INITIAL_BATCH_QUEUE,
    isBatchRunning: false,

    activeRibbonTab: 'layout',
    ribbonCollapsed: false,
    sidebarTab: 'pages',
    activeSheetIndex: 0,
    sidebarReveal: null,
    previewPageRequest: null,
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
    pendingDuplexPrint: null,
    printProgress: null,

    settingsPresets: [],
    shortcutRecordingFor: null,
    editingPresetId: null,
    canUndo: false,
    canRedo: false,
    undoLabel: '',
    redoLabel: '',

    toasts: [],

    // The app opens on an empty desk: `initializeWorkspace` reads printer state and nothing else.
    // Sample documents used to be generated here, so every real file the operator dragged in landed
    // on a page already crowded with demo work. The sample stays available through
    // loadSampleWorkspace (an explicit action, used by QA and tests) — it is just never loaded by
    // itself. Whatever is already on the desk is left untouched, because a remount (hot reload,
    // StrictMode) must not wipe files that were imported a moment before.
    initializeWorkspace: async () => {
      const [printerResult, jobResult] = await Promise.all([
        ipcBridge.listPrinters().then(value => ({ value, error: null as unknown })).catch(error => ({ value: [], error })),
        ipcBridge.listSpoolerJobs().then(value => ({ value, error: null as unknown })).catch(error => ({ value: [], error })),
      ]);
      // The new main sanitises whatever the sidecar reports; the sample documents that used to be
      // generated here are gone, so sanitising is all that is left to do with the printer list.
      const printers = printerResult.value.map(sanitizePrinterInfo);
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
      // An empty list is never an explanation on its own, so the reason is kept in the store.
      set({ printerServiceError: error ? (error instanceof Error ? error.message : String(error)) : null,
        printerServiceNote: printerResult.error ? null : await safePrinterStatusNote() });
      const previousMarginKey = marginKey(get());
      const defaultPrinter =
        printers.find((p) => p.isDefault)?.name ?? printers[0]?.name ?? '';
      set({ printers, selectedPrinterName: defaultPrinter, spoolerJobs });
      if (defaultPrinter) get().selectPrinter(defaultPrinter);
      else if (marginKey(get()) === previousMarginKey) refreshPrinterMargins();
    },

    // Deliberately not wired to a button any more: the desk starts empty, so demo pages never get
    // mixed in with real work. QA can still put them there from the console with
    // `useAppStore.getState().loadSampleWorkspace()`.
    loadSampleWorkspace: async () => {
      const before = captureSnapshot(get());
      const sample = await createSamplePrintShopWorkspace();
      set({
        documents: sample.documents,
        pages: sample.pages,
        bookmarks: sample.bookmarks,
        overlays: [], selectedOverlayId: null, textEdit: null, activePageId: null,
        layout: { ...get().layout, cellOverrides: {} },
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
        // New pages are appended to the end of the desk, so the preview has to follow them. Staying
        // on the sheet that was open before is what made a successful drop look like nothing happened.
        const firstImportedPage = result.pages[0];
        if (firstImportedPage) get().requestPreviewPage(firstImportedPage.id);
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
        overlays: [], selectedOverlayId: null, textEdit: null, activePageId: null,
        layout: { ...get().layout, cellOverrides: {} },
        activeSheetIndex: 0,
        previewPageRequest: null,
      });
      clearCrispPreviewCache();
      pushUndo('پاک‌سازی میز کار', 'Clear Workspace', before, captureSnapshot(get()));
    },

    undo: () => {
      if (get().textEdit) get().finishTextEdit();
      const snap = historyManager.undo();
      if (!snap) return;
      const lang = get().settings.language;
      const undoPeek = historyManager.peekUndo();
      const redoPeek = historyManager.peekRedo();
      set({
        ...snap.before,
        selectedOverlayId: snap.before.overlays.some(item => item.id === get().selectedOverlayId) ? get().selectedOverlayId : null,
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
      if (get().textEdit) get().finishTextEdit();
      const snap = historyManager.redo();
      if (!snap) return;
      const lang = get().settings.language;
      const undoPeek = historyManager.peekUndo();
      const redoPeek = historyManager.peekRedo();
      set({
        ...snap.after,
        selectedOverlayId: snap.after.overlays.some(item => item.id === get().selectedOverlayId) ? get().selectedOverlayId : null,
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
      const state = get();
      const clicked = state.pages.find(page => page.id === pageId);
      if (!clicked) return;
      const nextValue = !clicked.selectedForPrint;
      const before = captureSnapshot(state);
      set({ pages: state.pages.map(page => {
        const targeted = page.id === pageId || (clicked.isHighlighted && page.isHighlighted);
        return targeted && page.selectedForPrint !== nextValue ? {...page, selectedForPrint:nextValue} : page;
      }) });
      pushUndo('تغییر وضعیت چاپ صفحات', 'Change page print selection', before, captureSnapshot(get()));
    },

    invertAllPrintSelection: () => {
      const state = get();
      if (!state.pages.length) return;
      const before = captureSnapshot(state);
      set({ pages:state.pages.map(page => ({...page, selectedForPrint:!page.selectedForPrint})) });
      pushUndo('معکوس کردن وضعیت چاپ همه صفحات', 'Invert all pages print selection', before, captureSnapshot(get()));
    },

    // Same flip, but only under the highlighted set — the shape a right-click menu needs. Nothing
    // is selected? Nothing changes: silently inverting the whole desk from a context menu is worse
    // than doing nothing, and the menu only opens on a page anyway, so this set is never empty.
    invertPagesPrintSelection: (pageIds) => {
      const state = get();
      const idSet = new Set(pageIds);
      if (!idSet.size || !state.pages.some(page => idSet.has(page.id))) return;
      const before = captureSnapshot(state);
      set({ pages: state.pages.map(page => idSet.has(page.id) ? { ...page, selectedForPrint: !page.selectedForPrint } : page) });
      pushUndo(
        `معکوس کردن وضعیت چاپ ${idSet.size} صفحه`,
        `Invert print selection of ${idSet.size} page(s)`,
        before,
        captureSnapshot(get())
      );
    },

    // Navigation is deliberately separate from edits and sidebar multi-selection.
    // Only explicit preview navigation replaces the highlighted set.
    focusPageFromPreview: (pageId, preserveSelection = false, occurrenceKey) => {
      set(state => {
        const target = pageId ? state.pages.find(page => page.id === pageId) : undefined;
        if (pageId && !target) return state;
        const keepSelection = !!target && preserveSelection && target.isHighlighted;
        return {
          pages: keepSelection ? state.pages : state.pages.map(page => {
            const highlighted = page.id === target?.id;
            return page.isHighlighted === highlighted ? page : { ...page, isHighlighted: highlighted };
          }),
          documents: target ? state.documents.map(doc => doc.id === target.documentId && doc.collapsed ? { ...doc, collapsed: false } : doc) : state.documents,
          activePageId: target?.id ?? null,
          sidebarTab: target ? 'pages' : state.sidebarTab,
          sidebarReveal: target ? { pageId: target.id, occurrenceKey } : null,
        };
      });
    },

    requestPreviewPage: pageId => {
      if (get().pages.some(page => page.id === pageId)) set({ previewPageRequest: { pageId }, activePageId: pageId });
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
            activePageId: pageId,
            pages: state.pages.map((p, idx) => ({
              ...p,
              isHighlighted: idx >= start && idx <= end,
            })),
          };
        }

        if (multiSelect) {
          return {
            activePageId: pageId,
            pages: state.pages.map((p) =>
              p.id === pageId ? { ...p, isHighlighted: !p.isHighlighted } : p
            ),
          };
        }

        return {
          activePageId: pageId,
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

    // Move a stable ID-based selection as one block. A drop on the selection is a no-op.
    reorderPages: (pageIds, targetPageId, position) => {
      const state = get();
      const ids = new Set(pageIds);
      if (!ids.size || ids.size !== pageIds.length || ids.has(targetPageId) || (position !== 'before' && position !== 'after')) return;
      const moving = state.pages.filter(page => ids.has(page.id));
      if (moving.length !== ids.size) return; // A source disappeared while dragging.
      const remaining = state.pages.filter(page => !ids.has(page.id));
      const targetIndex = remaining.findIndex(page => page.id === targetPageId);
      if (targetIndex < 0) return;
      const insertion = targetIndex + (position === 'after' ? 1 : 0);
      const next = [...remaining.slice(0,insertion), ...moving, ...remaining.slice(insertion)];
      if (next.every((page,index) => page === state.pages[index])) return;
      const before = captureSnapshot(state);
      set({pages:next});
      pushUndo('جابجایی ترتیب صفحات', 'Reorder pages', before, captureSnapshot(get()));
    },

    moveHighlightedPages: (direction) => {
      const state = get();
      const next = state.pages.slice();
      if (direction === 'up') {
        for (let i=1; i<next.length; i++) if (next[i].isHighlighted && !next[i-1].isHighlighted) {
          [next[i-1],next[i]] = [next[i],next[i-1]];
        }
      } else {
        for (let i=next.length-2; i>=0; i--) if (next[i].isHighlighted && !next[i+1].isHighlighted) {
          [next[i],next[i+1]] = [next[i+1],next[i]];
        }
      }
      if (next.every((page,index) => page === state.pages[index])) return;
      const before = captureSnapshot(state);
      set({pages:next});
      pushUndo('جابجایی صفحات انتخاب‌شده', 'Move selected pages', before, captureSnapshot(get()));
    },

    applyAspectRatioCrop: (pageId, scope, ratio) => {
      const state = get();
      const targets = state.pages.filter(page => scope === 'all' || (scope === 'selected' ? page.isHighlighted : page.id === pageId));
      if (!targets.length) return false;
      const crops = new Map(targets.map(page => [page.id, centeredAspectCrop(page, ratio)]));
      if ([...crops.values()].some(crop => !crop)) return false;
      const before = captureSnapshot(state);
      const ids = new Set(crops.keys());
      const cellOverrides = Object.fromEntries(Object.entries(state.layout.cellOverrides ?? {}).map(([key,value]) => {
        if (!ids.has(value.pageId)) return [key,value];
        const { transform: _transform, allowOverflow: _overflow, ...rest } = value;
        return [key,rest];
      }));
      set({ layout:{...state.layout,cellOverrides}, pages:state.pages.map(page => {
        const crop = crops.get(page.id);
        if (!crop) return page;
        const overrides = {...page.overrides, cropBoxMm:cropToMm(page,crop)};
        delete overrides.transform;
        return {...page,overrides};
      }) });
      pushUndo('برش با نسبت ابعاد', 'Crop to aspect ratio', before, captureSnapshot(get()));
      return true;
    },

    applyPageGeometry: (pageId, scope, edit) => {
      const state = get();
      const targets = state.pages.filter(page => scope === 'all' || (scope === 'selected' ? page.isHighlighted : page.id === pageId));
      if (!targets.length) return;
      const ids = new Set(targets.map(page => page.id));
      const before = captureSnapshot(state);
      set(current => {
        const cellOverrides = Object.fromEntries(Object.entries(current.layout.cellOverrides ?? {}).map(([key, value]) => {
          if (!ids.has(value.pageId)) return [key, value];
          const { transform: _transform, allowOverflow: _overflow, ...rest } = value;
          return [key, rest];
        }));
        return { layout: { ...current.layout, cellOverrides }, pages: current.pages.map(page => {
          if (!ids.has(page.id)) return page;
          const overrides = { ...page.overrides };
          if (edit.kind === 'crop') {
            overrides.cropBoxMm = cropToMm(page, edit.crop);
            delete overrides.transform;
          } else if (edit.kind === 'transform') overrides.transform = edit.transform;
          else { delete overrides.cropBoxMm; delete overrides.transform; }
          return { ...page, overrides };
        }) };
      });
      pushUndo('ویرایش هندسه صفحات', 'Edit page geometry', before, captureSnapshot(get()));
    },

    applyCellTransform: (pageId, occurrenceKey, transform) => {
      const state = get();
      const exists = computeImpositionSheets(state.pages, state.layout).some(sheet => sheet.cells.some(cell => cell.page?.id === pageId && cell.occurrenceKey === occurrenceKey));
      if (!exists) return;
      const before = captureSnapshot(state);
      set(current => ({ layout: { ...current.layout, cellOverrides: { ...current.layout.cellOverrides,
        [occurrenceKey]: { ...current.layout.cellOverrides?.[occurrenceKey], pageId, transform, allowOverflow:true } } } }));
      pushUndo('تغییر اندازه و مکان خانه', 'Move or resize cell content', before, captureSnapshot(get()));
    },

    resetCellGeometry: (pageId, occurrenceKey) => {
      const state = get();
      const page = state.pages.find(item => item.id === pageId);
      if (!page || !computeImpositionSheets(state.pages, state.layout).some(sheet => sheet.cells.some(cell => cell.page?.id === pageId && cell.occurrenceKey === occurrenceKey))) return;
      const before = captureSnapshot(state);
      const cellOverrides = { ...state.layout.cellOverrides };
      const existing = { ...cellOverrides[occurrenceKey], pageId };
      if (page.overrides?.transform) { existing.transform = { ...IDENTITY_TRANSFORM }; existing.allowOverflow = false; }
      else { delete existing.transform; delete existing.allowOverflow; }
      cellOverrides[occurrenceKey] = existing;
      set({ layout: { ...state.layout, cellOverrides }, pages: state.pages.map(item => {
        if (item.id !== pageId) return item;
        const overrides = { ...item.overrides }; delete overrides.cropBoxMm;
        return { ...item, overrides };
      }) });
      pushUndo('بازنشانی خانه', 'Reset cell geometry', before, captureSnapshot(get()));
    },

    reorderCellLayer: (sheetIndex, occurrenceKey, direction) => {
      const state = get();
      const sheet = computeImpositionSheets(state.pages, state.layout)[sheetIndex];
      if (!sheet) return;
      const ordered = sortCellsByLayer(sheet.cells).filter(cell => cell.page && cell.occurrenceKey);
      const index = ordered.findIndex(cell => cell.occurrenceKey === occurrenceKey);
      if (index < 0) return;
      const next = direction === 'front' ? ordered.length - 1 : direction === 'back' ? 0 :
        Math.max(0, Math.min(ordered.length - 1, index + (direction === 'forward' ? 1 : -1)));
      if (next === index) return;
      const before = captureSnapshot(state);
      const [moved] = ordered.splice(index, 1); ordered.splice(next, 0, moved);
      const cellOverrides = { ...state.layout.cellOverrides };
      ordered.forEach((cell, zIndex) => { const key = cell.occurrenceKey!;
        cellOverrides[key] = { ...cellOverrides[key], pageId:cell.page!.id, zIndex };
      });
      set({ layout: { ...state.layout, cellOverrides } });
      pushUndo('تغییر ترتیب لایه‌ها', 'Reorder cell layers', before, captureSnapshot(get()));
    },

    rotatePages: (pageIds, deltaDeg) => {
      const state = get();
      const before = captureSnapshot(state);
      const idSet = new Set(pageIds);
      const displayed = new Map<string, PageRotation>();
      for (const sheet of computeImpositionSheets(state.pages, state.layout)) {
        for (const cell of sheet.cells) if (cell.page && idSet.has(cell.page.id) && !displayed.has(cell.page.id)) displayed.set(cell.page.id, cell.effectiveRotation);
      }
      set((state) => ({
        pages: state.pages.map((p) =>
          idSet.has(p.id)
            ? {
                ...p,
                rotation: ((((displayed.get(p.id) ?? p.rotation) + deltaDeg) % 360) as PageRotation),
                overrides: { ...p.overrides, manualRotation: true },
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

    makePagesArray: (pageIds, count) => {
      const safeCount = Math.max(2, Math.min(100, Math.floor(count)));
      const idSet = new Set(pageIds);
      if (!idSet.size) return;
      const before = captureSnapshot(get());
      set((state) => {
        const next: PageItem[] = [];
        for (const p of state.pages) {
          next.push(p);
          if (!idSet.has(p.id)) continue;
          for (let i = 1; i < safeCount; i++) {
            next.push({
              ...structuredClone(p),
              id: `${p.id}-arr-${i}-${Date.now()}`,
            });
          }
        }
        return { pages: next };
      });
      pushUndo(
        `تکرار آرایه‌ای ${idSet.size} صفحه (${safeCount} نسخه)`,
        `Make an Array of ${idSet.size} page(s) (${safeCount} copies)`,
        before,
        captureSnapshot(get())
      );
    },

    makePageArray: (pageId, count) => {
      get().makePagesArray([pageId], count);
    },

    insertBlankPagesAfter: (pageIds) => {
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
      const makeBlank = (refPage: PageItem | undefined, serial: number): PageItem => ({
        id: `blank-${Date.now()}-${serial}-${Math.random().toString(36).slice(2, 6)}`,
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
      });

      const before = captureSnapshot(get());
      set((state) => {
        const wanted = new Set(pageIds);
        // The Ribbon button passes no page at all: then the highlighted set — or, if nothing is
        // highlighted, the last page — is what "insert a blank page" has always meant here.
        const anchors = state.pages.filter((page) =>
          wanted.size ? wanted.has(page.id) : page.isHighlighted
        );
        const targets = anchors.length ? anchors : state.pages.slice(-1);
        if (!targets.length) return { pages: [makeBlank(undefined, 0)] };
        const afterIds = new Set(targets.map((page) => page.id));
        const next: PageItem[] = [];
        let serial = 0;
        for (const page of state.pages) {
          next.push(page);
          if (afterIds.has(page.id)) next.push(makeBlank(page, serial++));
        }
        return { pages: next };
      });

      pushUndo('درج صفحه خالی', 'Insert Blank Page', before, captureSnapshot(get()));
    },

    insertBlankPageAfter: (pageId) => {
      get().insertBlankPagesAfter(pageId ? [pageId] : []);
    },

    deletePages: (pageIds) => {
      if (pageIds.length === 0) return;
      const before = captureSnapshot(get());
      const idSet = new Set(pageIds);
      set((state) => ({
        pages: state.pages.filter((p) => !idSet.has(p.id)),
        layout: removeCellOverrides(state.layout, idSet),
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
        layout: removeCellOverrides(state.layout, new Set(state.pages.filter(p => p.documentId === docId).map(p => p.id))),
        bookmarks: state.bookmarks.filter((b) => b.documentId !== docId),
      }));
      // The parsed file and every bitmap made from it go with it; keeping them would hold megabytes
      // for pages that can never be looked at again.
      releaseCrispPreviewDocument(docId);
      pushUndo('حذف فایل از پروژه', 'Remove document', before, captureSnapshot(get()));
    },

    toggleDocumentCollapse: (docId) => {
      set((state) => ({
        documents: state.documents.map((d) =>
          d.id === docId ? { ...d, collapsed: !d.collapsed } : d
        ),
      }));
    },

    togglePagesInvertOverride: (pageIds) => {
      const state = get();
      const idSet = new Set(pageIds);
      const targets = state.pages.filter((page) => idSet.has(page.id));
      if (!targets.length) return;
      const before = captureSnapshot(state);
      // One gesture over a set never leaves a mix behind: the value is cleared when every target
      // already has it and turned on for all of them otherwise.
      const nextValue = !targets.every((page) => page.overrides?.invert ?? false);
      set({ pages: state.pages.map((page) => idSet.has(page.id) ? {
        ...page,
        overrides: { ...page.overrides, invert: nextValue },
      } : page) });
      pushUndo(
        nextValue ? `معکوس رنگ ${targets.length} صفحه` : `لغو معکوس رنگ ${targets.length} صفحه`,
        nextValue ? `Invert ${targets.length} page(s)` : `Clear invert on ${targets.length} page(s)`,
        before,
        captureSnapshot(get())
      );
    },

    togglePageInvertOverride: (pageId) => {
      get().togglePagesInvertOverride([pageId]);
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
        layout: { ...state.layout, ...patch, ...(patch.marginsMm && !patch.marginMode ? {marginMode: 'custom' as const} : {}) },
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

    addRulerGuide: (guide) => {
      const state = get();
      if (!guide.id || !['x','y'].includes(guide.axis) || !Number.isFinite(guide.positionMm) || guide.positionMm < 0 ||
        (state.layout.rulerGuides ?? []).some(item => item.id === guide.id)) return;
      const before = captureSnapshot(state);
      set({layout:{...state.layout, rulerGuides:[...(state.layout.rulerGuides ?? []), guide]}});
      pushUndo('افزودن خط راهنما', 'Add ruler guide', before, captureSnapshot(get()));
    },
    moveRulerGuide: (id, positionMm) => {
      const state = get(); const guides = state.layout.rulerGuides ?? [];
      const original = guides.find(item => item.id === id);
      if (!original || !Number.isFinite(positionMm) || positionMm < 0 || original.positionMm === positionMm) return;
      const before = captureSnapshot(state);
      set({layout:{...state.layout,rulerGuides:guides.map(item => item.id === id ? {...item,positionMm} : item)}});
      pushUndo('جابجایی خط راهنما', 'Move ruler guide', before, captureSnapshot(get()));
    },
    removeRulerGuide: (id) => {
      const state = get(); const guides = state.layout.rulerGuides ?? [];
      if (!guides.some(item => item.id === id)) return;
      const before = captureSnapshot(state);
      set({layout:{...state.layout,rulerGuides:guides.filter(item => item.id !== id)}});
      pushUndo('حذف خط راهنما', 'Remove ruler guide', before, captureSnapshot(get()));
    },

    commitLayoutGuides: (patch) => {
      const before = captureSnapshot(get());
      set(state => ({ layout: { ...state.layout, ...patch,
        ...(patch.marginsMm && Object.keys(patch.marginsMm).some(key => patch.marginsMm![key as keyof typeof patch.marginsMm] !== state.layout.marginsMm[key as keyof typeof state.layout.marginsMm]) ? {marginMode:'custom' as const} : {}) } }));
      pushUndo('تغییر حاشیه و فاصله‌ها', 'Adjust margins and gutters', before, captureSnapshot(get()));
    },

    updateMargins: (patch) => {
      const before = captureSnapshot(get());
      set((state) => ({
        layout: {
          ...state.layout,
          marginMode: 'custom',
          marginsMm: {
            ...state.layout.marginsMm,
            ...patch,
          },
        },
      }));
      pushUndo('تغییر حاشیه‌ها', 'Update margins', before, captureSnapshot(get()));
    },

    refreshPrinterMargins: () => refreshPrinterMargins(),

    resetMarginsToPrinter: () => {
      const state = get();
      if (state.printerMargins.status !== 'available') return;
      const before = captureSnapshot(state);
      set({ layout: { ...state.layout, marginMode:'printer', marginsMm: { ...state.printerMargins.marginsMm } } });
      pushUndo('بازنشانی حاشیه چاپگر', 'Reset printer margins', before, captureSnapshot(get()));
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
      const turningOn = patch.enabled === true && !get().pageNumbering.enabled;
      set((state) => ({
        pageNumbering: { ...state.pageNumbering, ...patch },
      }));
      if (turningOn && get().overlays.some(item => item.kind === 'numbering' && item.enabled)) {
        get().addToast({
          type: 'warning',
          title: get().settings.language === 'fa'
            ? 'شماره‌گذاری قدیمی و شماره قابل ویرایش هم‌زمان روشن‌اند؛ برای جلوگیری از شماره تکراری یکی را خاموش یا از «تبدیل» استفاده کنید.'
            : 'Legacy numbering and an editable page number are both active; disable one or use Convert to avoid duplicated numbers.',
        });
      }
    },

    addOverlay: (overlay) => {
      const state=get();
      if (state.overlays.some(item=>item.id===overlay.id)) return;
      const before=captureSnapshot(state);
      set({overlays:[...state.overlays,overlay],selectedOverlayId:overlay.id});
      pushUndo('افزودن لایه', 'Add overlay', before, captureSnapshot(get()));
    },
    updateOverlay: (id, patch) => {
      const state=get();
      const item=state.overlays.find(overlay=>overlay.id===id);
      if (!item) return;
      const before=captureSnapshot(state);
      set({overlays:state.overlays.map(overlay=>overlay.id===id ? {...overlay,...patch,id:item.id,kind:item.kind} as PageOverlay : overlay)});
      pushUndo('ویرایش لایه', 'Edit overlay', before, captureSnapshot(get()));
    },
    removeOverlay: (id) => {
      if(get().textEdit?.overlayId===id) get().finishTextEdit();
      const state=get(); if(!state.overlays.some(item=>item.id===id)) return;
      const before=captureSnapshot(state);
      set({overlays:state.overlays.filter(item=>item.id!==id),selectedOverlayId:state.selectedOverlayId===id?null:state.selectedOverlayId});
      pushUndo('حذف لایه', 'Remove overlay', before, captureSnapshot(get()));
    },
    selectOverlay: id => {
      if (get().textEdit && get().textEdit?.overlayId !== id) get().finishTextEdit();
      set({selectedOverlayId:id});
    },
    addImageOverlayFiles: async (files, sheet, point) => {
      if(get().textEdit)get().finishTextEdit();
      const state0=get();
      const images=files.filter(file=>isImageFile(file));
      if(!images.length)return 0;
      const side=sheet??computeImpositionSheets(state0.pages,state0.layout)[Math.min(state0.activeSheetIndex,Math.max(0,computeImpositionSheets(state0.pages,state0.layout).length-1))];
      if(!side)return 0;
      // Without an explicit drop point (ribbon button, clipboard) the picture lands in the middle of the current page.
      const fallbackCell=state0.pages.length ? side.cells.find(c=>c.page?.id===state0.activePageId)??side.cells.find(c=>c.page?.isHighlighted)??side.cells.find(c=>c.page) : undefined;
      const target=point??(fallbackCell ? {xMm:fallbackCell.contentXMm+fallbackCell.contentWidthMm/2,yMm:fallbackCell.contentYMm+fallbackCell.contentHeightMm/2}
        : {xMm:side.widthMm/2,yMm:side.heightMm/2});
      const created:PageOverlayImage[]=[];
      for(const file of images){
        const src=await readFileAsDataUrl(file);
        const natural=await measureImage(src);
        const placement=imageDropPlacement(side,target,natural);
        if(!placement)continue;
        created.push(imageOverlayFromPlacement(newImageId(),src,(file.name?.replace(/\.[^.]+$/,''))||'تصویر',natural,placement));
      }
      if(!created.length)return 0;
      const state=get();
      const before=captureSnapshot(state);
      const first=created[0];
      set({overlays:[...state.overlays,...created],selectedOverlayId:first.id,
        ...(first.target==='page'&&first.targetPageIds[0]?{activePageId:first.targetPageIds[0]}:{})});
      pushUndo(created.length>1?`افزودن ${created.length} تصویر`:'افزودن تصویر روی صفحه',
        created.length>1?`Add ${created.length} pictures to the page`:'Add picture to page',before,captureSnapshot(get()));
      get().addToast({type:'success',title:state.settings.language==='fa'
        ?`${created.length} تصویر روی صفحه قرار گرفت؛ با کشیدن جابه‌جا و با دستگیره‌ها تغییر اندازه می‌دهد.`
        :`${created.length} picture(s) placed on the page. Drag to move, handles to resize.`});
      return created.length;
    },
    addNumberingOverlay: (convertLegacy=false) => {
      if(get().textEdit)get().finishTextEdit();
      const state=get();if(!state.pages.length)return;
      const legacy=state.pageNumbering;
      const format=convertLegacy ? (legacy.format==='bates'?'english':legacy.format) : (state.settings.language==='fa'?'persian':'english');
      const template=convertLegacy ? (legacy.format==='bates'?`${legacy.batesPrefix||'BATES-'}{serial}`:legacy.format==='persian'?'صفحه {page} از {total}':legacy.format==='english'?'Page {page} of {total}':'{page} / {total}') : '{page}';
      const position=convertLegacy?legacy.position:'bottom-center';
      const item:PageOverlayNumbering={id:globalThis.crypto?.randomUUID?.()??`number-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind:'numbering',enabled:true,target:convertLegacy?'sheet':'page',targetScope:'all',targetPageIds:[],targetSheetIndex:1,
        xPercent:position.endsWith('left')?5:position.endsWith('right')?55:30,yPercent:position.startsWith('top')?5:88,widthPercent:40,heightPercent:7,opacity:1,rotation:0,
        fontSize:convertLegacy?legacy.fontSizePt:14,fontFamily:'Vazirmatn',color:'#000000',bold:false,italic:false,align:'center',lockAspect:true,format,template,
        startOffset:convertLegacy?legacy.startNumber:1,padZeros:convertLegacy&&legacy.format==='bates'?Math.max(3,Math.min(10,legacy.batesDigits)):0,customScript:''};
      const before=captureSnapshot(state);
      set({overlays:[...state.overlays,item],selectedOverlayId:item.id,...(convertLegacy?{pageNumbering:{...legacy,enabled:false}}:{})});
      pushUndo('افزودن شماره صفحه','Add page numbering',before,captureSnapshot(get()));
      if(!convertLegacy && legacy.enabled){
        get().addToast({type:'warning',title:state.settings.language==='fa'
          ?'شماره‌گذاری قدیمی همچنان روشن است و ممکن است شماره تکراری بزند. با «تبدیل شماره‌گذاری قدیمی» آن را قابل ویرایش کنید یا خاموشش کنید.'
          :'The legacy numbering is still on and can print a duplicate number. Use Convert legacy numbering to make it editable, or turn it off.'});
      }
    },
    addTextOverlay: () => {
      if(get().textEdit) get().finishTextEdit();
      const state=get();
      const page=state.pages.find(p=>p.id===state.activePageId) ?? state.pages.find(p=>p.isHighlighted) ?? state.pages.find(p=>p.selectedForPrint) ?? state.pages[0];
      if(!page)return;
      const id=globalThis.crypto?.randomUUID?.() ?? `text-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const item:PageOverlayText={id,kind:'text',target:'page',targetScope:'current',targetPageIds:[page.id],targetSheetIndex:1,
        xPercent:25,yPercent:25,widthPercent:50,heightPercent:15,opacity:1,rotation:0,text:'',fontSize:18,fontFamily:'Vazirmatn',color:'#000000',
        bold:false,italic:false,underline:false,align:state.settings.language==='fa'?'right':'left',lineHeight:1.25,wordSpacingPt:0,letterSpacingPt:0};
      const layout=page.selectedForPrint ? state.layout : {...state.layout,duplexMode:'none' as const};
      const sheets=computeImpositionSheets(page.selectedForPrint ? state.pages : [{...page,selectedForPrint:true}],layout);
      const sheet=sheets.find(s=>s.cells.some(c=>c.page?.id===page.id));
      const cell=sheet?.cells.find(c=>c.page?.id===page.id);
      if(!sheet || !cell)return;
      get().addOverlay(item);
      set({activePageId:page.id,previewPageRequest:{pageId:page.id},activeSheetIndex:sheet.sideIndex-1,
        textEdit:{overlayId:id,occurrenceKey:`${id}-${cell.occurrenceKey??cell.cellIndex}`,text:'',ranges:[],selectionStart:0,selectionEnd:0}});
    },
    addShapeOverlay: (type, patch) => {
      if (get().textEdit) get().finishTextEdit();
      const state = get();
      const page = state.pages.find(p => p.id === state.activePageId) ?? state.pages.find(p => p.isHighlighted)
        ?? state.pages.find(p => p.selectedForPrint) ?? state.pages[0];
      const lang = state.settings.language;
      if (!page) {
        // A shape belongs on a sheet; without one this button would look like it does nothing at all.
        state.addToast({ type: 'warning', title: lang === 'fa' ? 'اول یک سند وارد کنید' : 'Load a document first' });
        return null;
      }
      const layout = page.selectedForPrint ? state.layout : { ...state.layout, duplexMode: 'none' as const };
      const sheets = computeImpositionSheets(page.selectedForPrint ? state.pages : [{ ...page, selectedForPrint: true }], layout);
      const sheet = sheets.find(s => s.cells.some(c => c.page?.id === page.id));
      const cell = sheet?.cells.find(c => c.page?.id === page.id);
      if (!sheet || !cell) {
        state.addToast({ type: 'warning', title: lang === 'fa' ? 'این صفحه در هیچ برگه‌ای جا نمی‌شود' : 'This page does not fit on any sheet' });
        return null;
      }
      const boxWidth = Math.max(1, cell.contentWidthMm), boxHeight = Math.max(1, cell.contentHeightMm);
      // A shape is a physical mark, so the default box is measured in millimetres and only then turned
      // into the percentages the overlay model stores — square in millimetres is what keeps a circle round.
      const sideMm = Math.max(12, Math.min(80, Math.min(boxWidth, boxHeight) * 0.28));
      const widthPercent = sideMm / boxWidth * 100, heightPercent = sideMm / boxHeight * 100;
      const item: PageOverlayShape = {
        id: globalThis.crypto?.randomUUID?.() ?? `shape-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'shape', target: 'page', targetScope: 'current', targetPageIds: [page.id], targetSheetIndex: sheet.sideIndex,
        xPercent: (100 - widthPercent) / 2, yPercent: (100 - heightPercent) / 2, widthPercent, heightPercent,
        opacity: 1, rotation: 0, lockAspect: shapeCapabilities(type).lockAspect,
        ...defaultShapeStyle(type), ...normalizeShapeStyle(patch ?? {}),
      };
      get().addOverlay(item);
      set({ activePageId: page.id, previewPageRequest: { pageId: page.id }, activeSheetIndex: sheet.sideIndex - 1 });
      return item.id;
    },

    reorderOverlay: (overlayId, where) => {
      // The overlays array *is* the stacking order: the preview sorts placements by its index and so does
      // the exporter, so moving a layer means moving an element of this array and nothing else.
      const state = get();
      const index = state.overlays.findIndex(item => item.id === overlayId);
      if (index < 0) return;
      const next = [...state.overlays];
      const [item] = next.splice(index, 1);
      const target = where === 'front' ? next.length : where === 'back' ? 0
        : where === 'forward' ? Math.min(next.length, index + 1) : Math.max(0, index - 1);
      if (target === index) return;
      next.splice(target, 0, item);
      const before = captureSnapshot(state);
      set({ overlays: next, selectedOverlayId: overlayId });
      pushUndo('تغییر ترتیب لایه', 'Reorder layer', before, captureSnapshot(get()));
    },

    beginTextEdit: (id, occurrenceKey) => {
      const existing=get().textEdit;
      if(existing?.overlayId===id && existing.occurrenceKey===occurrenceKey)return;
      if(existing)get().finishTextEdit();
      const item=get().overlays.find(o=>o.id===id);
      if(!item || item.kind!=='text')return;
      set({selectedOverlayId:id,textEdit:{overlayId:id,occurrenceKey,text:item.text,ranges:item.scriptRanges??[],selectionStart:0,selectionEnd:0}});
    },
    updateTextDraft: (text,start,end) => set(state=>{
      const edit=state.textEdit;if(!edit)return state;
      return {textEdit:{...edit,text,ranges:adjustScriptRanges(edit.text,text,edit.ranges),selectionStart:start,selectionEnd:end}};
    }),
    selectTextDraft: (start,end) => set(state=>state.textEdit && (state.textEdit.selectionStart!==start || state.textEdit.selectionEnd!==end)?{textEdit:{...state.textEdit,selectionStart:start,selectionEnd:end}}:state),
    styleTextSelection: script => set(state=>{
      const edit=state.textEdit;if(!edit)return state;
      return {textEdit:{...edit,ranges:setScriptRange(edit.text,edit.ranges,edit.selectionStart,edit.selectionEnd,script)}};
    }),
    insertTextToken: token => set(state=>{
      const edit=state.textEdit;if(!edit)return state;
      const text=edit.text.slice(0,edit.selectionStart)+token+edit.text.slice(edit.selectionEnd);
      const cursor=edit.selectionStart+token.length;
      return {textEdit:{...edit,text,ranges:adjustScriptRanges(edit.text,text,edit.ranges),selectionStart:cursor,selectionEnd:cursor}};
    }),
    finishTextEdit: (cancel=false) => {
      const state=get(),edit=state.textEdit;if(!edit)return;
      const item=state.overlays.find(o=>o.id===edit.overlayId);
      set({textEdit:null});
      if(cancel || !item || item.kind!=='text')return;
      if(item.text===edit.text && JSON.stringify(item.scriptRanges??[])===JSON.stringify(edit.ranges))return;
      const before=captureSnapshot(state);
      set({overlays:get().overlays.map(o=>o.id===item.id?{...item,text:edit.text,scriptRanges:edit.ranges}:o)});
      pushUndo('ویرایش نوشته', 'Edit text', before, captureSnapshot(get()));
    },

    updateSettings: (patch) => {
      set((state) => {
        const next = { ...state.settings, ...patch };
        void ipcBridge.saveSettings(next);
        return { settings: next };
      });
      syncCrispPreview();
    },

    // Start-up: settings and saved profiles used to be written to disk and never read back, so every
    // launch quietly returned to the shipped defaults. Both are restored here, once.
    restorePreferences: async () => {
      const [storedSettings, presets] = await Promise.all([
        ipcBridge.loadSettings().catch(() => null),
        ipcBridge.loadSettingsPresets().catch(() => [] as SettingsPreset[]),
      ]);
      // Only a value the session has not moved away from. A read that lands after an edit must not walk
      // over it — "I set it and it snapped back" is the kind of bug nobody can reproduce — and every edit
      // is written through to disk immediately, so the file is never fresher than the state in memory.
      const live = get().settings;
      const restorable: Partial<AppSettings> = {};
      for (const [key, value] of Object.entries(storedSettings ?? {})) {
        const name = key as keyof AppSettings;
        if (live[name] === DEFAULT_SETTINGS[name]) (restorable as Record<string, unknown>)[name] = value;
      }
      // The bridge already sanitises, and so does this: a profile file is the one piece of persisted data
      // the operator is expected to hand-edit (it is a list of names and settings), so the shape is not
      // trusted twice-removed. It also drops the `settings` block profiles used to carry.
      const storedPresets = sanitizeSettingsPresetList(presets);
      set((state) => ({
        settings: { ...state.settings, ...restorable },
        // Anything saved during this session wins over the file; the stored list is the base, not the word.
        settingsPresets: [
          ...storedPresets.filter(stored => !state.settingsPresets.some(item => item.id === stored.id)),
          ...state.settingsPresets,
        ],
      }));
      syncCrispPreview();
    },

    saveSettingsPreset: (name, shortcut) => {
      const trimmed = name.trim();
      if (!trimmed) { reportPresetError('empty-name'); return null; }
      const chord = resolvePresetShortcut(shortcut, '');
      if (!chord.ok) { reportPresetError(chord.error); return null; }
      const lang = get().settings.language;
      const now = new Date().toISOString();
      const sections = capturePresetSections();
      const current = get().settingsPresets;
      const duplicate = current.find((preset) => presetNameKey(preset.name) === presetNameKey(trimmed));
      const next = duplicate
        ? current.map((preset) => preset.id === duplicate.id
            ? { ...preset, ...sections, name: trimmed, shortcut: chord.value || preset.shortcut, updatedAt: now }
            : preset)
        : [...current, { id: newPresetId(), name: trimmed, shortcut: chord.value, createdAt: now, updatedAt: now, ...sections }];
      set({ settingsPresets: next });
      persistPresets(next);
      get().addToast({
        type: 'success',
        title: duplicate
          ? (lang === 'fa' ? `پریست «${trimmed}» به‌روزرسانی شد` : `Updated the "${trimmed}" profile`)
          : (lang === 'fa' ? `پریست «${trimmed}» ذخیره شد` : `Saved the "${trimmed}" profile`),
        message: lang === 'fa'
          ? 'چیدمان، افکت‌ها، واترمارک و شماره‌گذاری صفحه در همین پروفایل نگه داشته شدند؛ تنظیمات خود برنامه دست‌نخورده است.'
          : 'Layout, effects, watermark and page numbering are stored in this profile; the application settings are not part of it.',
      });
      return duplicate?.id ?? next[next.length - 1].id;
    },

    editSettingsPreset: (presetId, patch) => {
      if (presetId === SHEET_DEFAULT_PRESET_ID) { reportPresetError('builtin'); return { ok: false, error: 'builtin' }; }
      const current = get().settingsPresets;
      const preset = current.find((item) => item.id === presetId);
      if (!preset) { reportPresetError('unknown-id'); return { ok: false, error: 'unknown-id' }; }
      const name = patch.name === undefined ? preset.name : patch.name.trim();
      if (!name) { reportPresetError('empty-name'); return { ok: false, error: 'empty-name' }; }
      if (current.some((item) => item.id !== presetId && presetNameKey(item.name) === presetNameKey(name))) {
        reportPresetError('duplicate-name', name);
        return { ok: false, error: 'duplicate-name' };
      }
      const chord = patch.shortcut === undefined
        ? { ok: true as const, value: preset.shortcut }
        : resolvePresetShortcut(patch.shortcut, presetId);
      if (!chord.ok) { reportPresetError(chord.error); return { ok: false, error: chord.error }; }
      const now = new Date().toISOString();
      const next = current.map((item) => item.id === presetId
        ? { ...item, name, shortcut: chord.value, updatedAt: now }
        : item);
      set({ settingsPresets: next });
      persistPresets(next);
      return { ok: true, id: presetId };
    },

    overwriteSettingsPreset: (presetId) => {
      if (presetId === SHEET_DEFAULT_PRESET_ID) { reportPresetError('builtin'); return { ok: false, error: 'builtin' }; }
      const current = get().settingsPresets;
      const preset = current.find((item) => item.id === presetId);
      if (!preset) { reportPresetError('unknown-id'); return { ok: false, error: 'unknown-id' }; }
      const next = current.map((item) => item.id === presetId
        ? { ...item, ...capturePresetSections(), updatedAt: new Date().toISOString() }
        : item);
      set({ settingsPresets: next });
      persistPresets(next);
      return { ok: true, id: presetId };
    },

    beginShortcutRecording: (presetId) => {
      set({ shortcutRecordingFor: presetId });
    },

    beginEditPreset: (presetId) => {
      // Switching rows must not leave a recorder waiting for a key on the row that was just closed.
      set({ editingPresetId: presetId, shortcutRecordingFor: null });
    },

    applySettingsPreset: (presetId) => {
      // The defaults entry is not a stored profile: applying it *is* the reset, so it stays one action
      // with one chord instead of a snapshot that can go stale when the app's defaults change.
      if (presetId === SHEET_DEFAULT_PRESET_ID) { get().resetAllSettings(); return; }
      const preset = get().settingsPresets.find((item) => item.id === presetId);
      const lang = get().settings.language;
      if (!preset) return;
      const before = captureSnapshot(get());
      // Every section is merged over its own default, so a profile saved before the app grew a new
      // option leaves that option at the default instead of at `undefined`.
      set(() => ({
        layout: { ...DEFAULT_LAYOUT, ...preset.layout },
        effects: { ...DEFAULT_EFFECTS, ...preset.effects },
        watermark: { ...getDefaultWatermarkSettings(), ...preset.watermark },
        pageNumbering: { ...getDefaultPageNumberSettings(), ...preset.pageNumbering },
      }));
      pushUndo('اعمال پروفایل شیت', 'Apply sheet profile', before, captureSnapshot(get()));
      get().addToast({
        type: 'info',
        title: lang === 'fa' ? `پروفایل «${preset.name}» اعمال شد` : `Applied the "${preset.name}" profile`,
        message: lang === 'fa'
          ? 'تنظیمات خود برنامه (زبان، واحد، تعرفه و پیش‌نمایش) تغییری نکردند؛ برگشت با Ctrl+Z ممکن است.'
          : 'The application settings (language, unit, tariffs, preview) were not touched; Ctrl+Z brings the previous sheet setup back.',
      });
    },

    deleteSettingsPreset: (presetId) => {
      if (presetId === SHEET_DEFAULT_PRESET_ID) { reportPresetError('builtin'); return; }
      const current = get().settingsPresets;
      const next = current.filter((preset) => preset.id !== presetId);
      if (next.length === current.length) return;
      // An editor pointing at a profile that no longer exists would write into nothing.
      set({ settingsPresets: next,
        ...(get().editingPresetId === presetId ? { editingPresetId: null, shortcutRecordingFor: null } : {}) });
      persistPresets(next);
    },

    resetAllSettings: () => {
      const before = captureSnapshot(get());
      const lang = get().settings.language;
      set({
        layout: { ...DEFAULT_LAYOUT },
        effects: { ...DEFAULT_EFFECTS },
        watermark: getDefaultWatermarkSettings(),
        pageNumbering: getDefaultPageNumberSettings(),
        settings: { ...DEFAULT_SETTINGS, language: lang },
      });
      pushUndo('بازگردانی تمام تنظیمات به پیش‌فرض', 'Reset all settings to defaults', before, captureSnapshot(get()));
      void ipcBridge.saveSettings(get().settings);
      syncCrispPreview();
      get().addToast({
        type: 'success',
        title: lang === 'fa' ? 'همهٔ تنظیمات به حالت پیش‌فرض برگشت' : 'All settings are back to their defaults',
        message: lang === 'fa'
          ? 'چیدمان، افکت‌ها، واترمارک، شماره‌گذاری و تنظیمات عمومی بازنشانی شد؛ فایل‌های روی میز کار دست‌نخورده‌اند.'
          : 'Layout, effects, watermark, page numbering and general settings were reset; the files on the desk are untouched.',
      });
    },

    clearCrispPreviewCacheNow: () => {
      clearCrispPreviewCache();
    },

    exportMergedOrImposedPdf: async (onlyHighlighted = false) => {
      if(get().textEdit)get().finishTextEdit();
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
          overlays: state.overlays,
          allPages: state.pages,
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
              ? `فایل PDF نهایی (${fileName}) ساخته و دانلود شد`
              : `PDF (${fileName}) generated and downloaded`,
        });
      } catch (error) {
        state.addToast({type:'error',title:state.settings.language==='fa'?'ساخت PDF ناموفق بود':'PDF export failed',
          message:error instanceof Error?error.message:String(error)});
      } finally {
        set({ isExportingPdf: false, exportProgress: 0 });
      }
    },

    savePspProject: () => {
      if(get().textEdit)get().finishTextEdit();
      const state = get();
      const project: PspProjectFile = {
        version: '1.0.0',
        savedAt: new Date().toISOString(),
        appSettings: state.settings,
        layout: state.layout,
        effects: state.effects,
        watermark: state.watermark,
        pageNumbering: state.pageNumbering,
        overlays: state.overlays,
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
        const previousMarginKey = marginKey(get());
        set({
          layout: { ...parsed.layout, marginMode: parsed.layout.marginMode ?? 'custom' },
          effects: parsed.effects ?? DEFAULT_EFFECTS,
          watermark: parsed.watermark ?? getDefaultWatermarkSettings(),
          pageNumbering: parsed.pageNumbering ?? getDefaultPageNumberSettings(),
          overlays: Array.isArray(parsed.overlays) ? parsed.overlays : [],
          selectedOverlayId: null, textEdit: null, activePageId: null,
          documents: parsed.documents as SourceDocument[],
          pages: parsed.pages,
          bookmarks: parsed.bookmarks ?? [],
          activeSheetIndex: 0,
        });
        if (get().layout.marginMode === 'printer' && marginKey(get()) === previousMarginKey) refreshPrinterMargins();
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
      const printer = get().printers.find((item) => item.name === printerName);
      const profile = printer?.activeProfile;
      if (!printer || !profile) {
        set({ selectedPrinterName: printerName });
        return;
      }

      const prevKey = marginKey(get());
      const paperSize = profile.paperSize ?? get().layout.paperSize;
      const opt =
        printer.capabilities.paperOptions?.find(
          (o) =>
            (profile.paperName && o.name.toLowerCase() === profile.paperName.toLowerCase()) ||
            o.id === paperSize
        ) ?? null;
      const stdDims = paperSize !== 'Custom' ? STANDARD_PAPER_SIZES[paperSize] : null;
      const wMm = profile.paperWidthMm ?? opt?.widthMm ?? stdDims?.widthMm;
      const hMm = profile.paperHeightMm ?? opt?.heightMm ?? stdDims?.heightMm;

      const nextLayout: LayoutSettings = {
        ...get().layout,
        paperSize,
        orientation: profile.orientation ?? get().layout.orientation,
        duplexMode: printer.capabilities.supportsDuplex
          ? (profile.duplexMode ?? get().layout.duplexMode)
          : 'none',
        ...(wMm && hMm
          ? {
              customWidthMm: Math.min(wMm, hMm),
              customHeightMm: Math.max(wMm, hMm),
            }
          : {}),
      };
      set({ selectedPrinterName: printerName, layout: nextLayout });
      if (get().layout.marginMode === 'printer' && marginKey(get()) === prevKey) {
        refreshPrinterMargins();
      }
    },

    retryPrinters: async () => {
      if (get().isRefreshingPrinters) return;
      set({ isRefreshingPrinters: true });
      try {
        const rawPrinters = await ipcBridge.listPrinters();
        const printers = rawPrinters.map(sanitizePrinterInfo);
        const selected = get().selectedPrinterName;
        const fallback = printers.some((p) => p.name === selected)
          ? selected
          : printers.find((p) => p.isDefault)?.name ?? printers[0]?.name ?? '';
        set({
          printers,
          selectedPrinterName: fallback,
          printerServiceError: null,
          printerServiceNote: await safePrinterStatusNote(),
          isRefreshingPrinters: false,
        });
        // Always re-apply driver paper, tray, and orientation after refreshing the list.
        if (fallback) get().selectPrinter(fallback);
        get().addToast({
          type: printers.length ? 'info' : 'warning',
          title: get().settings.language === 'fa' ? 'فهرست پرینترها تازه شد' : 'Printer list refreshed',
          message: printers.length
            ? (get().settings.language === 'fa'
                ? `${printers.length} پرینتر از ویندوز خوانده شد.`
                : `Read ${printers.length} printer(s) from Windows.`)
            : (get().settings.language === 'fa'
                ? 'ویندوز هیچ پرینتری گزارش نکرد؛ بررسی کنید در «Printers & scanners» چیزی نصب باشد.'
                : 'Windows reported no printers installed.'),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const note = await safePrinterStatusNote();
        set({ printerServiceError: message, printerServiceNote: note, isRefreshingPrinters: false });
        get().addToast({
          type: 'error',
          title: get().settings.language === 'fa' ? 'خواندن فهرست پرینترها ناموفق بود' : 'Could not read the printer list',
          // A toast is the only thing many users read, so it carries the fix, not just the symptom.
          message: note ? `${message}\n${note}` : message,
        });
      }
    },

    openPrinterPreferences: async (printerName) => {
      try {
        const rawPrinters = await ipcBridge.openPrinterPreferences(printerName);
        const printers = rawPrinters.map(sanitizePrinterInfo);
        set({ printers });
        get().selectPrinter(printerName);
        get().addToast({
          type: 'success',
          title: get().settings.language === 'fa'
            ? 'تنظیمات درایور به‌روزرسانی شد'
            : 'Printer driver settings refreshed',
          message: get().settings.language === 'fa'
            ? 'اندازه کاغذ و جهت صفحه از تنظیمات ویندوز خوانده شد.'
            : 'Paper size and orientation were read again from Windows.',
        });
      } catch (error) {
        get().addToast({
          type: 'error',
          title: get().settings.language === 'fa' ? 'بازکردن تنظیمات پرینتر ناموفق بود' : 'Could not open printer preferences',
          message: error instanceof Error ? error.message : String(error),
        });
      }
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
        get().selectPrinter(optimal.name);
      }
    },

    updatePrinterProfile: async (printerName, profileOrPatch) => {
      const state = get();
      const existing = state.printers.find((p) => p.name === printerName);
      const baseProfile: PrinterProfileSettings = existing?.activeProfile ?? {
        printerName,
        paperSize: state.layout.paperSize,
        paperName: state.layout.paperSize,
        paperWidthMm: state.layout.customWidthMm,
        paperHeightMm: state.layout.customHeightMm,
        tray: 'Auto Select',
        mediaType: 'Plain Paper',
        duplexMode: state.layout.duplexMode,
        orientation: state.layout.orientation,
        colorMode: 'color',
        dpi: 600,
        quality: 'normal',
        collate: true,
      };
      const nextProfile: PrinterProfileSettings = {
        ...baseProfile,
        ...profileOrPatch,
        printerName,
      };

      // Optimistically apply to printers and workspace sheet dimensions
      set((s) => ({
        printers: s.printers.map((p) =>
          p.name === printerName ? { ...p, activeProfile: nextProfile } : p
        ),
        ...(s.selectedPrinterName === printerName
          ? {
              layout: {
                ...s.layout,
                paperSize: nextProfile.paperSize,
                orientation: nextProfile.orientation,
                duplexMode: nextProfile.duplexMode,
                ...(nextProfile.paperWidthMm && nextProfile.paperHeightMm
                  ? {
                      customWidthMm: Math.min(nextProfile.paperWidthMm, nextProfile.paperHeightMm),
                      customHeightMm: Math.max(nextProfile.paperWidthMm, nextProfile.paperHeightMm),
                    }
                  : {}),
              },
            }
          : {}),
      }));

      try {
        const updated = sanitizePrinterInfo(
          await ipcBridge.updatePrinterProfile(printerName, nextProfile)
        );
        set((s) => ({
          printers: s.printers.map((p) =>
            p.name === printerName
              ? sanitizePrinterInfo({
                  ...updated,
                  activeProfile: { ...updated.activeProfile, ...nextProfile },
                })
              : p
          ),
        }));
      } catch {
        // Optimistic local profile still drives Quick Print & Dialog when IPC bridge is in browser preview
      }
    },

    setDefaultPrinter: async (printerName) => {
      await ipcBridge.setDefaultPrinter(printerName);
      const printers = (await ipcBridge.listPrinters()).map(sanitizePrinterInfo);
      const previousName = get().selectedPrinterName;
      set({ printers, selectedPrinterName: printerName });
      if (previousName === printerName) refreshPrinterMargins();
    },

    submitPrintJob: async (request) => {
      if (get().textEdit) get().finishTextEdit();
      const state = get();
      const isFa = state.settings.language === 'fa';
      const printerName = request?.printerName?.trim();

      if (!printerName) {
        state.addToast({
          type: 'error',
          title: isFa ? 'پرینتر مقصد انتخاب نشده است' : 'No target printer selected',
          message: isFa
            ? 'لطفاً یک پرینتر متصل ویندوز را از لیست انتخاب کنید.'
            : 'Please select an installed Windows printer first.',
        });
        return;
      }

      const selectedPages = state.pages.filter((p) => p.selectedForPrint);
      const highlighted = state.pages.find((p) => p.isHighlighted);
      let targetPages = selectedPages;

      if (request.pageRangeMode === 'current-page') {
        const allSheets = computeImpositionSheets(selectedPages, state.layout);
        const activeSheet = allSheets[Math.min(state.activeSheetIndex, Math.max(0, allSheets.length - 1))];
        const sheetPages = (activeSheet?.cells ?? [])
          .map((c) => c.page)
          .filter((p): p is PageItem => Boolean(p));
        targetPages = sheetPages.length > 0 ? sheetPages : highlighted ? [highlighted] : selectedPages.slice(0, 1);
      } else if (request.pageRangeMode === 'custom-range') {
        const indices = parsePageRangeText(request.customRangeText || '', selectedPages.length);
        targetPages = indices
          .map((idx) => selectedPages[idx - 1])
          .filter((p): p is PageItem => Boolean(p));
      }

      if (targetPages.length === 0) {
        state.addToast({
          type: 'error',
          title: isFa ? 'صفحه‌ای برای چاپ یافت نشد' : 'No pages selected to print',
          message: isFa
            ? 'حداقل یک صفحه یا محدوده معتبر برای ارسال به چاپگر انتخاب کنید.'
            : 'Select at least one valid page or range before printing.',
        });
        return;
      }

      const targetPrinter = state.printers.find((p) => p.name === printerName);
      const profile = targetPrinter?.activeProfile;
      const bookletMode = state.layout.booklet?.enabled === true;
      const effectivePaperSize = bookletMode ? state.layout.paperSize : request.paperSize ?? profile?.paperSize ?? state.layout.paperSize;
      const effectiveOrientation = bookletMode ? 'landscape' : request.orientation ?? profile?.orientation ?? state.layout.orientation;
      const effectiveDuplex = bookletMode ? state.layout.booklet!.duplexMode : request.duplexMode ?? profile?.duplexMode ?? state.layout.duplexMode;
      const dims = getSheetDimensionsMm({
        ...state.layout,
        paperSize: effectivePaperSize,
        orientation: effectiveOrientation,
        ...(!bookletMode && request.paperWidthMm && request.paperHeightMm
          ? {
              customWidthMm: Math.min(request.paperWidthMm, request.paperHeightMm),
              customHeightMm: Math.max(request.paperWidthMm, request.paperHeightMm),
            }
          : {}),
      });

      const printLayout: LayoutSettings = {
        ...state.layout,
        paperSize: effectivePaperSize,
        orientation: effectiveOrientation,
        duplexMode: effectiveDuplex,
        ...(request.paperWidthMm && request.paperHeightMm
          ? {
              customWidthMm: Math.min(request.paperWidthMm, request.paperHeightMm),
              customHeightMm: Math.max(request.paperWidthMm, request.paperHeightMm),
            }
          : {}),
      };

      const finalRequest: PrintJobRequest = {
        ...request,
        printerName,
        paperSize: effectivePaperSize,
        paperName: bookletMode ? effectivePaperSize : request.paperName ?? profile?.paperName ?? effectivePaperSize,
        paperWidthMm: bookletMode ? Math.min(dims.widthMm, dims.heightMm) : request.paperWidthMm ?? profile?.paperWidthMm ?? Math.min(dims.widthMm, dims.heightMm),
        paperHeightMm: bookletMode ? Math.max(dims.widthMm, dims.heightMm) : request.paperHeightMm ?? profile?.paperHeightMm ?? Math.max(dims.widthMm, dims.heightMm),
        orientation: effectiveOrientation,
        tray: request.tray || profile?.tray || 'Auto Select',
        mediaType: request.mediaType ?? profile?.mediaType ?? 'Plain Paper',
        dpi: request.dpi || profile?.dpi || 600,
        quality: request.quality ?? profile?.quality ?? 'normal',
        duplexMode: effectiveDuplex,
        staple: request.staple ?? profile?.staple,
        outputBin: request.outputBin ?? profile?.outputBin,
        holePunch: request.holePunch ?? profile?.holePunch,
        fold: request.fold ?? profile?.fold,
        borderless: request.borderless ?? profile?.borderless,
      };

      const runId = ++printRunSequence;
      activePrintRunId = runId;
      activeSpoolerJob = null;
      const estimatedSheets = Math.max(
        1,
        computeImpositionSheets(targetPages, printLayout).length
      );

      set({
        isExportingPdf: true,
        exportProgress: 8,
        showPrintModal: false,
        pendingDuplexPrint: null,
        printProgress: {
          active: true,
          jobTitle: finalRequest.jobTitle || 'PrintStudio Document',
          printerName,
          stage: 'preparing',
          percent: 8,
          currentSheet: 0,
          totalSheets: estimatedSheets,
        },
      });

      const ensureNotCanceled = () => {
        if (canceledPrintRuns.has(runId)) {
          throw new Error('PRINT_CANCELED');
        }
      };

      try {
        ensureNotCanceled();
        let imposedPdfBytes = await exportImposedPdf({
          documents: state.documents,
          pages: targetPages.map((p) => ({ ...p, selectedForPrint: true })),
          layout: printLayout,
          effects: state.effects,
          watermark: state.watermark,
          pageNumbering: state.pageNumbering,
          overlays: state.overlays,
          allPages: state.pages,
          userName: state.settings.userName,
          onProgress: (percent) => {
            if (canceledPrintRuns.has(runId)) return;
            const nextPct = Math.max(10, Math.round(percent * 0.5));
            set((s) => ({
              exportProgress: nextPct,
              printProgress:
                activePrintRunId === runId && s.printProgress
                  ? { ...s.printProgress, stage: 'preparing', percent: nextPct }
                  : s.printProgress,
            }));
          },
        });
        ensureNotCanceled();

        // Apply sheet-level Odd/Even & Reverse filters directly on the imposed PDF sheets
        if (finalRequest.oddEvenFilter !== 'all' || finalRequest.reverseOrder) {
          const srcPdf = await PDFDocument.load(imposedPdfBytes);
          const filteredPdf = await PDFDocument.create();
          let sheetIndices = Array.from({ length: srcPdf.getPageCount() }, (_, i) => i);
          if (finalRequest.oddEvenFilter === 'odd') {
            sheetIndices = sheetIndices.filter((i) => (i + 1) % 2 === 1);
          } else if (finalRequest.oddEvenFilter === 'even') {
            sheetIndices = sheetIndices.filter((i) => (i + 1) % 2 === 0);
          }
          if (finalRequest.reverseOrder) {
            sheetIndices = sheetIndices.slice().reverse();
          }
          if (sheetIndices.length === 0) {
            throw new Error(
              isFa
                ? 'پس از اعمال فیلتر فرد/زوج هیچ شیتی برای چاپ باقی نماند.'
                : 'No sheets remain after applying Odd/Even filter.'
            );
          }
          const copied = await filteredPdf.copyPages(srcPdf, sheetIndices);
          for (const page of copied) filteredPdf.addPage(page);
          imposedPdfBytes = await filteredPdf.save();
        }
        ensureNotCanceled();

        set((s) => ({
          exportProgress: 55,
          printProgress:
            activePrintRunId === runId && s.printProgress
              ? { ...s.printProgress, stage: 'rendering', percent: 55 }
              : s.printProgress,
        }));

        const sheetPngs = await renderPdfToSheetPngs(
          imposedPdfBytes,
          finalRequest.dpi,
          (rendered, total) => {
            if (activePrintRunId !== runId || canceledPrintRuns.has(runId)) return;
            const nextPct = 55 + Math.round((rendered / Math.max(1, total)) * 32);
            set((s) => ({
              exportProgress: nextPct,
              printProgress: s.printProgress
                ? {
                    ...s.printProgress,
                    stage: 'rendering',
                    percent: nextPct,
                    currentSheet: rendered,
                    totalSheets: total,
                  }
                : null,
            }));
          },
          () => canceledPrintRuns.has(runId)
        );
        ensureNotCanceled();

        const totalSheetSides = Math.max(
          1,
          sheetPngs.length || estimatedSheets
        );
        set((s) => ({
          exportProgress: 92,
          printProgress:
            activePrintRunId === runId && s.printProgress
              ? {
                  ...s.printProgress,
                  stage: 'sending',
                  percent: 92,
                  currentSheet: totalSheetSides,
                  totalSheets: totalSheetSides,
                }
              : s.printProgress,
        }));

        const job = await ipcBridge.submitPrintJob(
          finalRequest,
          totalSheetSides,
          imposedPdfBytes,
          sheetPngs
        );
        activeSpoolerJob = { printerName, jobId: job.jobId };

        if (canceledPrintRuns.has(runId)) {
          await ipcBridge
            .controlSpoolerJob(printerName, job.jobId, 'cancel')
            .catch(() => undefined);
          throw new Error('PRINT_CANCELED');
        }

        const refreshedJobs = await ipcBridge.listSpoolerJobs(printerName).catch(() => []);
        const mergedJobs = refreshedJobs.some((j) => j.jobId === job.jobId)
          ? refreshedJobs
          : [job, ...refreshedJobs];

        set((s) => ({
          spoolerJobs: mergedJobs,
          showPrintModal: false,
          printProgress:
            activePrintRunId === runId && s.printProgress
              ? {
                  ...s.printProgress,
                  stage: 'completed',
                  percent: 100,
                  currentSheet: totalSheetSides,
                  totalSheets: totalSheetSides,
                  spoolerJobId: job.jobId,
                }
              : s.printProgress,
        }));

        state.addToast({
          type: 'success',
          title: isFa
            ? `کار چاپ #${job.jobId} به «${printerName}» ارسال شد`
            : `Print job #${job.jobId} sent to "${printerName}"`,
          message: isFa
            ? `${totalSheetSides} شیت • ${finalRequest.copies} کپی • سینی: ${finalRequest.tray} • کاغذ: ${finalRequest.paperName || effectivePaperSize}`
            : `${totalSheetSides} sheet(s) • ${finalRequest.copies} cop${finalRequest.copies === 1 ? 'y' : 'ies'} • Tray: ${finalRequest.tray}`,
        });

        setTimeout(() => {
          const cur = get().printProgress;
          if (activePrintRunId === runId && cur?.stage === 'completed') {
            set({ printProgress: null });
          }
        }, 1800);
      } catch (error) {
        const wasCanceled =
          canceledPrintRuns.has(runId) ||
          (error instanceof Error && error.message === 'PRINT_CANCELED');
        if (wasCanceled) {
          if (activePrintRunId === runId) {
            set({ printProgress: null });
          }
        } else {
          const message = error instanceof Error ? error.message : String(error);
          set((s) => ({
            printProgress:
              activePrintRunId === runId && s.printProgress
                ? {
                    ...s.printProgress,
                    stage: 'error',
                    errorMessage: message,
                  }
                : s.printProgress,
          }));
          state.addToast({
            type: 'error',
            title: isFa ? 'ارسال به پرینتر ناموفق بود' : 'Print submission failed',
            message,
          });
        }
      } finally {
        canceledPrintRuns.delete(runId);
        if (activePrintRunId === runId) {
          activeSpoolerJob = null;
        }
        set({ isExportingPdf: false, exportProgress: 0 });
      }
    },

    silentPrintNow: async () => {
      const state = get();
      const targetPrinter =
        state.printers.find((p) => p.name === state.selectedPrinterName) ??
        state.printers.find((p) => p.isDefault) ??
        state.printers[0];
      const printerName = targetPrinter?.name ?? '';
      const profile = targetPrinter?.activeProfile;
      const effectiveDuplex = profile?.duplexMode ?? state.layout.duplexMode;

      const request: PrintJobRequest = {
        printerName,
        jobTitle: state.documents[0]?.name ?? 'PrintStudio Direct Job',
        copies: 1,
        collate: profile?.collate ?? true,
        pageRangeMode: 'all-selected',
        customRangeText: '',
        oddEvenFilter: 'all',
        reverseOrder: false,
        duplexMode: effectiveDuplex,
        scaleMode: 'fit',
        dpi: profile?.dpi ?? 600,
        colorMode:
          state.effects.grayscale ||
          state.effects.blackAndWhite ||
          profile?.colorMode === 'monochrome'
            ? 'bw'
            : 'color',
        tray: profile?.tray ?? 'Auto Select',
        silent: true,
        paperSize: profile?.paperSize ?? state.layout.paperSize,
        paperName: profile?.paperName,
        paperWidthMm: profile?.paperWidthMm,
        paperHeightMm: profile?.paperHeightMm,
        orientation: profile?.orientation ?? state.layout.orientation,
        mediaType: profile?.mediaType,
        quality: profile?.quality,
        staple: profile?.staple,
        outputBin: profile?.outputBin,
        holePunch: profile?.holePunch,
        fold: profile?.fold,
        borderless: profile?.borderless,
      };

      const hasPages = state.pages.some((p) => p.selectedForPrint);
      if (printerName && hasPages && effectiveDuplex !== 'none') {
        set({ pendingDuplexPrint: request });
        return;
      }

      await state.submitPrintJob(request);
    },

    confirmDuplexPrint: async (override) => {
      const pending = get().pendingDuplexPrint;
      if (!pending) return;
      const merged: PrintJobRequest = {
        ...pending,
        ...override,
      };
      set({ pendingDuplexPrint: null });
      if (
        merged.printerName &&
        (override?.orientation || override?.duplexMode)
      ) {
        await get().updatePrinterProfile(merged.printerName, {
          ...(override.orientation ? { orientation: override.orientation } : {}),
          ...(override.duplexMode ? { duplexMode: override.duplexMode } : {}),
        });
      }
      await get().submitPrintJob(merged);
    },

    dismissDuplexPrint: () => {
      set({ pendingDuplexPrint: null });
    },

    cancelActivePrintJob: async () => {
      const state = get();
      const isFa = state.settings.language === 'fa';
      const runId = activePrintRunId;
      if (runId > 0) {
        canceledPrintRuns.add(runId);
      }
      if (state.printProgress) {
        set({
          printProgress: {
            ...state.printProgress,
            stage: 'canceling',
          },
        });
      }
      const spoolTarget = activeSpoolerJob;
      if (spoolTarget) {
        try {
          const jobs = await ipcBridge.controlSpoolerJob(
            spoolTarget.printerName,
            spoolTarget.jobId,
            'cancel'
          );
          set({ spoolerJobs: jobs });
        } catch {
          // Best-effort spooler cancel
        }
        activeSpoolerJob = null;
      }
      set({
        printProgress: null,
        isExportingPdf: false,
        exportProgress: 0,
      });
      get().addToast({
        type: 'warning',
        title: isFa ? 'چاپ توسط کاربر لغو شد' : 'Print job canceled',
        message: spoolTarget
          ? isFa
            ? `درخواست لغو کار #${spoolTarget.jobId} به اسپولر ارسال شد.`
            : `Cancel request sent for spooler job #${spoolTarget.jobId}.`
          : isFa
            ? 'فرآیند آماده‌سازی و ارسال چاپ متوقف گردید.'
            : 'Print preparation was stopped before sending.',
      });
    },

    closePrintProgress: () => {
      set({ printProgress: null });
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
        printerName: state.selectedPrinterName || state.printers[0]?.name || '',
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

/** Sidecar diagnostics must never be the thing that breaks an otherwise healthy workspace. */
async function safePrinterStatusNote(): Promise<string | null> {
  try {
    return await ipcBridge.getPrinterStatusNote();
  } catch {
    return null;
  }
}

// A single subscription covers printer selection, initialization, project restore and
// undo/redo. Results are keyed to the exact oriented media; old responses are discarded.
let printerMarginSequence = 0;
const marginKey = (state?: AppState | null) =>
  state
    ? JSON.stringify([
        state.selectedPrinterName,
        state.layout?.paperSize,
        state.layout?.orientation,
        state.layout?.customWidthMm,
        state.layout?.customHeightMm,
      ])
    : '';

function refreshPrinterMargins() {
  const state = useAppStore.getState();
  const sequence = ++printerMarginSequence;
  const key = marginKey(state);
  if (!state.selectedPrinterName) {
    useAppStore.setState({ printerMargins: { status: 'unavailable', reason: 'No printer selected' } });
    return;
  }
  const request = {
    printerName: state.selectedPrinterName,
    paperSize: state.layout.paperSize,
    orientation: state.layout.orientation,
    ...getSheetDimensionsMm(state.layout),
  };
  useAppStore.setState({ printerMargins: { status: 'loading' } });
  void ipcBridge
    .getPrinterMargins(request)
    .then((result) => {
      const current = useAppStore.getState();
      if (sequence !== printerMarginSequence || marginKey(current) !== key) return;
      const margins = result.status === 'available' ? result.marginsMm : null;
      const valid =
        margins &&
        [margins.top, margins.right, margins.bottom, margins.left].every(
          (v) => Number.isFinite(v) && v >= 0
        ) &&
        margins.left + margins.right < request.widthMm &&
        margins.top + margins.bottom < request.heightMm;
      const safe: PrinterMarginResult =
        result.status === 'available' && !valid
          ? { status: 'unavailable', reason: 'Invalid printer margins' }
          : result;
      useAppStore.setState({
        printerMargins: safe,
        ...(safe.status === 'available' && current.layout.marginMode === 'printer'
          ? { layout: { ...current.layout, marginsMm: { ...safe.marginsMm } } }
          : {}),
      });
    })
    .catch((error) => {
      if (sequence === printerMarginSequence && marginKey(useAppStore.getState()) === key)
        useAppStore.setState({
          printerMargins: {
            status: 'unavailable',
            reason: error instanceof Error ? error.message : String(error),
          },
        });
    });
}

useAppStore.subscribe((state, previous) => {
  if (previous && marginKey(state) !== marginKey(previous)) {
    refreshPrinterMargins();
  }
});

