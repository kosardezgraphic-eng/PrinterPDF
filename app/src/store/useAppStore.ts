/**
 * PrintStudio Pro — Central Zustand Store with Command Pattern Undo/Redo
 */

import { create } from 'zustand';
import type {
  AppSettings,
  BatchJobItem,
  BookmarkItem,
  DuplexMode,
  EffectsSettings,
  LayoutSettings,
  MarginsMm,
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
  PdfExportOptions,
  PrinterInfo,
  RulerGuide,
  PrinterMarginResult,
  PrinterProfileSettings,
  PrintJobRequest,
  PspProjectFile,
  SettingsPreset,
  SourceDocument,
  SpoolerJobInfo,
  VirtualPrinterConfig,
  VirtualPrinterIncomingPayload,
  VirtualPrinterStatus,
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
import { sanitizeEraseColor, sanitizeEraseShapes, type EraseShape } from '@shared/models';
import { commitEraseShape } from '../engine/imageErase';
import { sanitizeSequence } from '../engine/numberingSequence';
import { effectiveInvert, inheritedInvert } from '../engine/effectsPipeline';
import { CommandHistoryManager } from '../engine/commandHistory';
import {
  getDefaultPageNumberSettings,
  getDefaultWatermarkSettings,
} from '../engine/watermarkEngine';
import { readImagesFromSystemClipboard } from '../engine/clipboardImport';
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
import { clampMarginsToMin, resolvePrinterMinMargins } from '../engine/sheetInteraction';
import {
  BUILTIN_MARGIN_PRESETS_MM,
  DEFAULT_LAST_CUSTOM_MARGINS_MM,
  type MarginPresetId,
} from '../engine/marginPresets';
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
  sheetImagePlacement,
} from '../engine/imageOverlays';
import { defaultShapeStyle, normalizeShapeStyle, shapeCapabilities } from '../engine/shapes';
import { isImageFile, measureImage, readFileAsDataUrl } from '../engine/imageImport';
import { centeredAspectCrop, cropToMm, IDENTITY_TRANSFORM, type Insets } from '../engine/pageGeometry';
import { computeImpositionSheets, getSheetDimensionsMm, sortCellsByLayer, stripTrailingEmptyDuplexSides } from '../engine/layoutEngine';
import { ipcBridge, selectOptimalPrinter } from '../engine/ipcBridge';
import { adjustScriptRanges, setScriptRange } from '../engine/textFormatting';
import { buildBatchExecutionPlan, nUpToRowsCols } from '../engine/batchService';
import { computeAutoPackPlan, type AutoPackPlan } from '../engine/autoPack';
import {
  buildTicketStudioLayout,
  buildTicketStudioOverlays,
  createBlankTicketSource,
  createDefaultTicketConfig,
  generateTicketPages,
  getTicketGridMetrics,
  type TicketConfig,
} from '../engine/ticketNumbering';

export interface AutoPackRequest {
  pageId?: string;
  widthMm: number;
  heightMm: number;
  lockAspect: boolean;
  horizontalGapMm: number;
  verticalGapMm: number;
  outerMarginMm: number;
  allowRotateForMax: boolean;
  centerOnSheet: boolean;
  onlySelectedPage: boolean;
}

export type AppMode = 'studio' | 'batch' | 'ticket';

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

export type InspectorToolId =
  | 'layout'
  | 'margins'
  | 'crop'
  | 'effects'
  | 'text'
  | 'numbering'
  | 'image'
  | 'shape'
  | 'eraser'
  | 'watermark'
  | 'booklet'
  | 'pdf'
  | 'batch'
  | 'printers'
  | 'view'
  | 'file';

export type CanvasTool = 'move' | 'crop' | 'layout' | 'measure';

export type WorkspaceDrawerState = 'batch' | 'printers' | 'closed' | null;

export type PageEditScope = 'current' | 'selected' | 'all';

export type PreviewViewMode = 'single' | 'double' | 'grid' | 'continuous';

export interface PdfPreviewModalState {
  url: string;
  fileName: string;
  pageCount: number;
  byteLength: number;
}

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
const profileSyncSeq = new Map<string, number>();
let batchRunPaused = false;
const canceledBatchJobIds = new Set<string>();

function syncPrintersDuplex(printers: PrinterInfo[], duplexMode: DuplexMode): PrinterInfo[] {
  let changed = false;
  const next = printers.map((p) => {
    if (p.activeProfile.duplexMode === duplexMode) return p;
    changed = true;
    return { ...p, activeProfile: { ...p.activeProfile, duplexMode } };
  });
  return changed ? next : printers;
}

function syncPrintersWithLayout(
  printers: PrinterInfo[],
  selectedPrinterName: string,
  nextLayout: LayoutSettings
): PrinterInfo[] {
  const duplexSynced = syncPrintersDuplex(printers, nextLayout.duplexMode);
  if (!selectedPrinterName) return duplexSynced;
  let changed = false;
  const stdDims = nextLayout.paperSize !== 'Custom' ? STANDARD_PAPER_SIZES[nextLayout.paperSize] : null;
  const next = duplexSynced.map((p) => {
    if (p.name !== selectedPrinterName) return p;
    const matchedPaperOpt =
      p.capabilities.paperOptions?.find(
        (o) =>
          (p.activeProfile.paperName &&
            nextLayout.paperSize === p.activeProfile.paperSize &&
            o.name.toLowerCase() === p.activeProfile.paperName.toLowerCase()) ||
          o.id === nextLayout.paperSize
      ) ?? null;
    const widthMm =
      nextLayout.paperSize === 'Custom'
        ? nextLayout.customWidthMm
        : matchedPaperOpt
          ? Math.min(matchedPaperOpt.widthMm, matchedPaperOpt.heightMm)
          : stdDims?.widthMm ?? nextLayout.customWidthMm;
    const heightMm =
      nextLayout.paperSize === 'Custom'
        ? nextLayout.customHeightMm
        : matchedPaperOpt
          ? Math.max(matchedPaperOpt.widthMm, matchedPaperOpt.heightMm)
          : stdDims?.heightMm ?? nextLayout.customHeightMm;
    const paperName =
      nextLayout.paperSize === 'Custom'
        ? 'Custom'
        : matchedPaperOpt?.name ?? nextLayout.paperSize;
    const ap = p.activeProfile;
    if (
      ap.paperSize === nextLayout.paperSize &&
      ap.paperName === paperName &&
      ap.orientation === nextLayout.orientation &&
      ap.duplexMode === nextLayout.duplexMode &&
      ap.paperWidthMm === widthMm &&
      ap.paperHeightMm === heightMm
    ) {
      return p;
    }
    changed = true;
    return {
      ...p,
      activeProfile: {
        ...ap,
        paperSize: nextLayout.paperSize,
        paperName,
        paperWidthMm: widthMm,
        paperHeightMm: heightMm,
        orientation: nextLayout.orientation,
        duplexMode: nextLayout.duplexMode,
      },
    };
  });
  return changed ? next : duplexSynced;
}

function syncDuplexOnLayoutAndPrinters(
  layout: LayoutSettings,
  printers: PrinterInfo[],
  duplexMode: DuplexMode
): { layout: LayoutSettings; printers: PrinterInfo[] } {
  const nextBooklet =
    layout.booklet && (duplexMode === 'long-edge' || duplexMode === 'short-edge') && layout.booklet.duplexMode !== duplexMode
      ? { ...layout.booklet, duplexMode }
      : layout.booklet;
  const nextLayout: LayoutSettings =
    layout.duplexMode === duplexMode && nextBooklet === layout.booklet
      ? layout
      : { ...layout, duplexMode, ...(nextBooklet !== layout.booklet ? { booklet: nextBooklet } : {}) };
  return {
    layout: nextLayout,
    printers: syncPrintersDuplex(printers, duplexMode),
  };
}

function persistDuplexAcrossPrinters(
  printers: PrinterInfo[],
  duplexMode: DuplexMode,
  excludePrinterName?: string
): void {
  for (const p of printers) {
    if (excludePrinterName && p.name === excludePrinterName) continue;
    void ipcBridge.updatePrinterProfile(p.name, { ...p.activeProfile, duplexMode }).catch(() => {});
  }
}

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

function cloneDefaultLayout(): LayoutSettings {
  return {
    ...DEFAULT_LAYOUT,
    marginsMm: { ...DEFAULT_LAYOUT.marginsMm },
    ...(DEFAULT_LAYOUT.booklet ? { booklet: { ...DEFAULT_LAYOUT.booklet } } : {}),
  };
}

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

function hasActiveVisualEffects(effects: EffectsSettings): boolean {
  return Boolean(
    effects.enabled &&
      (effects.invert ||
        effects.grayscale ||
        effects.blackAndWhite ||
        effects.blackText ||
        effects.brightness !== 0 ||
        effects.contrast !== 0 ||
        Math.abs(effects.gamma - 1) > 0.001 ||
        effects.sharpness !== 0)
  );
}

const SIDEBAR_WIDTH_MIN = 180;
const SIDEBAR_WIDTH_MAX = 560;
const SIDEBAR_WIDTH_DEFAULT = 288;
const THUMB_SIZE_MIN = 72;
const THUMB_SIZE_MAX = 240;
const THUMB_SIZE_DEFAULT = 112;

function readStoredNumber(key: string, min: number, max: number, fallback: number): number {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const val = Number(raw);
    return Number.isFinite(val) ? Math.max(min, Math.min(max, Math.round(val))) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredNumber(key: string, value: number): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, String(value));
    }
  } catch {
    // ignore storage errors
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'fa',
  theme: 'light',
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
  /**
   * Which eraser the pointer uses while it is over a picture, chosen from the Insert tab: `'brush'` paints a
   * round hole along the drag, `'region'` deletes the rectangle it drags out, `'off'` lets the pointer move
   * the picture as usual. UI state, deliberately never part of a saved sheet profile.
   */
  eraseTool: import('../engine/imageErase').EraseTool;
  /** Brush diameter in millimetres on the sheet — a physical size, like a pen the operator picks up. */
  eraseBrushMm: number;
  /**
   * What the brush lays down: `null` removes the pixels, a `#rrggbb` covers them with that colour. It is the
   * answer to "paint this corner the colour of the background" without touching the picture's own file, and it
   * is what the eyedropper writes when the operator picks a spot on the artwork.
   */
  eraseColor: string | null;
  /**
   * The marquee the region tool has drawn but not yet spent. A region only cuts when `Delete` is pressed, so
   * between the drag and the key it lives here — in the store rather than in the layer, because the key is
   * handled globally and the panel offers the same commit for hands that stay on the mouse.
   */
  erasePending: { overlayId: string; shape: EraseShape } | null;
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

  // Batch Queue, Ticket Numbering & Standalone Environments
  appMode: AppMode;
  batchQueue: BatchJobItem[];
  batchSelectedJobId: string | null;
  isBatchRunning: boolean;
  ticketConfig: TicketConfig;
  ticketSourceDocument: SourceDocument | null;
  ticketSourcePages: PageItem[];
  ticketSelectedSourcePageId: string | null;

  // Windows Virtual Printer
  virtualPrinterStatus: VirtualPrinterStatus | null;
  virtualPrinterBusy: boolean;

  // UI & Workspace State
  activeRibbonTab: RibbonTabId;
  ribbonCollapsed: boolean;
  activeInspectorTool: InspectorToolId;
  inspectorCollapsed: boolean;
  canvasTool: CanvasTool;
  showPreflight: boolean;
  fitPageNonce: number;
  pdfExportOptions: PdfExportOptions;
  pdfPreviewModal: PdfPreviewModalState | null;
  isGeneratingPdfPreview: boolean;
  workspaceDrawer: WorkspaceDrawerState;
  sidebarTab: 'pages' | 'bookmarks';
  sidebarWidthPx: number;
  sidebarThumbnailSizePx: number;
  activeSheetIndex: number;
  sidebarReveal: { pageId: string; occurrenceKey?: string } | null;
  previewPageRequest: { pageId: string } | null;
  zoomPercent: number;
  viewMode: PreviewViewMode;
  showRulers: boolean;
  snapEnabled: boolean;
  smartGuidesEnabled: boolean;
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
  showPageSetupModal: boolean;
  pageSetupInitialTab: 'margins' | 'paper';
  showOnboardingTour: boolean;
  showShortcutsModal: boolean;
  lastCustomMarginsMm: MarginsMm | null;
  quickPrintCopies: number;
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
  importFromClipboard: (options?: { target?: 'document' | 'overlay' }) => Promise<number>;
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
  autoPackPageOnSheet: (request: AutoPackRequest) => AutoPackPlan | null;
  updateMargins: (patch: Partial<LayoutSettings['marginsMm']>) => void;
  applyMarginPreset: (presetId: MarginPresetId) => void;
  addRulerGuide: (guide: RulerGuide) => void;
  moveRulerGuide: (id: string, positionMm: number) => void;
  removeRulerGuide: (id: string) => void;
  resetMarginsToPrinter: () => void;
  refreshPrinterMargins: () => void;
  commitLayoutGuides: (patch: Partial<Pick<LayoutSettings, 'marginsMm' | 'horizontalGutterMm' | 'verticalGutterMm' | 'booklet'>>) => void;
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
  /**
   * Replace the erase gestures of a picture (or all the selected ones with the same list). An empty list is
   * the restore: the file's bytes were never touched, so clearing the list gives the picture back whole.
   */
  setOverlayErase: (overlayId: string, shapes: EraseShape[]) => void;
  /** Commit reversible eraser marks directly to a source PDF/image page. */
  setPageErase: (pageId: string, shapes: EraseShape[]) => void;
  /**
   * Flip the picture's own colours, once per selected overlay. It is a toggle, never a rewrite: the second
   * press is the way back, whatever the selection looked like before.
   */
  toggleOverlayInvert: (overlayIds?: string[]) => void;
  /** Pick the eraser mode from the Insert tab. `'off'` hands the pointer back to moving the picture. */
  setEraseTool: (tool: import('../engine/imageErase').EraseTool) => void;
  /** Brush diameter in millimetres; anything below a hairline or above a sheet is clamped. */
  setEraseBrushMm: (diameterMm: number) => void;
  /** The brush's paint colour, or `null` to take pixels away. Junk is refused, not guessed at. */
  setEraseColor: (color: string | null) => void;
  /** The marquee the region tool selected, waiting for `Delete`. */
  setErasePending: (pending: { overlayId: string; shape: EraseShape } | null) => void;
  /** Spend the pending marquee on its picture — the same thing `Delete` does. */
  commitErasePending: () => void;
  /**
   * Whether a global key belongs to the waiting marquee rather than to the rest of the app: `Delete` applies
   * it, `Escape` throws it away. The keys are app-wide (they belong to whatever the pointer last touched, not
   * to the focused control), so the answer lives next to the state instead of inside the key listener.
   */
  spendEraseKey: (key: string) => boolean;
  beginTextEdit: (id: string, occurrenceKey: string) => void;
  updateTextDraft: (text: string, start: number, end: number) => void;
  selectTextDraft: (start: number, end: number) => void;
  styleTextSelection: (script: 'super' | 'sub') => void;
  insertTextToken: (token: string) => void;
  finishTextEdit: (cancel?: boolean) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;

  // Export & Print & Project
  setPdfExportOptions: (patch: Partial<PdfExportOptions>) => void;
  exportMergedOrImposedPdf: (onlyHighlighted?: boolean) => Promise<void>;
  openPdfPreviewModal: () => Promise<void>;
  closePdfPreviewModal: () => void;
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
  setQuickPrintCopies: (copies: number) => void;
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

  // Batch Print Queue & Workspace Mode
  setAppMode: (mode: AppMode) => void;
  selectBatchJob: (id: string | null) => void;
  addBatchFiles: (files: File[]) => Promise<void>;
  addCurrentWorkspaceToBatch: () => void;
  updateBatchJob: (id: string, patch: Partial<BatchJobItem>) => void;
  applyPrinterProfileToAllBatchJobs: () => void;
  moveBatchJob: (id: string, direction: 'up' | 'down') => void;
  duplicateBatchJob: (id: string) => void;
  clearCompletedBatchJobs: () => void;
  clearAllBatchJobs: () => void;
  cancelBatchJob: (id: string) => void;
  runBatchQueue: () => Promise<void>;
  pauseBatchQueue: () => void;
  removeBatchJob: (id: string) => void;
  retryFailedBatchJobs: () => void;

  // Standalone Ticket / Receipt Numbering & Sheet Division
  updateTicketConfig: (patch: Partial<TicketConfig> | ((prev: TicketConfig) => TicketConfig)) => void;
  resetTicketConfig: () => void;
  setTicketSelectedSourcePageId: (pageId: string | null) => void;
  importTicketSourceFiles: (files: File[]) => Promise<void>;
  useStudioActivePageAsTicketSource: () => boolean;
  clearTicketSource: () => void;
  generateTicketSheetsToStudio: () => number;
  exportTicketPdfDirect: () => Promise<Uint8Array | null>;

  // Windows Virtual Printer
  refreshVirtualPrinterStatus: () => Promise<void>;
  updateVirtualPrinterConfig: (patch: Partial<VirtualPrinterConfig>) => Promise<void>;
  installVirtualPrinter: () => Promise<void>;
  uninstallVirtualPrinter: () => Promise<void>;
  handleIncomingVirtualPrinterJob: (payload: VirtualPrinterIncomingPayload) => Promise<void>;

  // UI Helpers
  setActiveRibbonTab: (tab: RibbonTabId) => void;
  setRibbonCollapsed: (collapsed: boolean) => void;
  setActiveInspectorTool: (tool: InspectorToolId) => void;
  setInspectorCollapsed: (collapsed: boolean) => void;
  setCanvasTool: (tool: CanvasTool) => void;
  setShowPreflight: (show: boolean) => void;
  triggerFitPage: () => void;
  setWorkspaceDrawer: (drawer: WorkspaceDrawerState) => void;
  setSidebarTab: (tab: 'pages' | 'bookmarks') => void;
  setSidebarWidthPx: (widthPx: number) => void;
  setSidebarThumbnailSizePx: (sizePx: number) => void;
  setActiveSheetIndex: (idx: number) => void;
  setZoomPercent: (zoom: number) => void;
  setViewMode: (mode: PreviewViewMode) => void;
  setShowRulers: (show: boolean) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setSmartGuidesEnabled: (enabled: boolean) => void;
  setLoupeEnabled: (enabled: boolean) => void;
  setTransparentMode: (enabled: boolean) => void;
  setModalState: (
    modal:
      | 'counter'
      | 'print'
      | 'settings'
      | 'manualDuplex'
      | 'split'
      | 'pageSetup'
      | 'tour'
      | 'shortcuts',
    open: boolean
  ) => void;
  openPageSetup: (tab?: 'margins' | 'paper') => void;
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
  const capturePresetSections = (): Pick<
    SettingsPreset,
    'layout' | 'effects' | 'watermark' | 'pageNumbering' | 'numberingOverlays'
  > => {
    const state = get();
    const clonedLayout = structuredClone(state.layout);
    delete clonedLayout.cellOverrides;
    return {
      layout: clonedLayout,
      effects: structuredClone(state.effects),
      watermark: structuredClone(state.watermark),
      pageNumbering: structuredClone(state.pageNumbering),
      numberingOverlays: structuredClone(
        state.overlays.filter((item): item is PageOverlayNumbering => item.kind === 'numbering')
      ),
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
    eraseTool: 'off',
    eraseBrushMm: 8,
    eraseColor: null,
    erasePending: null,
    settings: DEFAULT_SETTINGS,

    printers: [],
    selectedPrinterName: '',
    printerMargins: { status: 'unavailable', reason: 'No printer selected' },
    spoolerJobs: [],
    printerServiceError: null,
    printerServiceNote: null,
    isRefreshingPrinters: false,

    appMode: 'studio',
    batchQueue: INITIAL_BATCH_QUEUE,
    batchSelectedJobId: null,
    isBatchRunning: false,
    ticketConfig: createDefaultTicketConfig(),
    ticketSourceDocument: null,
    ticketSourcePages: [],
    ticketSelectedSourcePageId: null,

    virtualPrinterStatus: null,
    virtualPrinterBusy: false,

    activeRibbonTab: 'layout',
    ribbonCollapsed: false,
    activeInspectorTool: 'layout',
    inspectorCollapsed: false,
    canvasTool: 'move',
    showPreflight: false,
    fitPageNonce: 0,
    pdfExportOptions: { imageHandling: 'preserve', compression: 'lossless' },
    pdfPreviewModal: null,
    isGeneratingPdfPreview: false,
    workspaceDrawer: null,
    sidebarTab: 'pages',
    sidebarWidthPx: readStoredNumber('printstudio:sidebar-width-px', SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_DEFAULT),
    sidebarThumbnailSizePx: readStoredNumber('printstudio:sidebar-thumb-px', THUMB_SIZE_MIN, THUMB_SIZE_MAX, THUMB_SIZE_DEFAULT),
    activeSheetIndex: 0,
    sidebarReveal: null,
    previewPageRequest: null,
    zoomPercent: 100,
    viewMode: 'single',
    showRulers: true,
    snapEnabled: true,
    smartGuidesEnabled: true,
    loupeEnabled: false,
    transparentMode: false,
    isExportingPdf: false,
    exportProgress: 0,

    showCounterModal: false,
    showPrintModal: false,
    showSettingsModal: false,
    showManualDuplexModal: false,
    showSplitModal: false,
    showPageSetupModal: false,
    pageSetupInitialTab: 'margins',
    showOnboardingTour: false,
    showShortcutsModal: false,
    lastCustomMarginsMm: null,
    quickPrintCopies: 1,
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
        overlays: [], selectedOverlayId: null, textEdit: null, activePageId: null, eraseTool: 'off', erasePending: null,
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

    importFromClipboard: async (options) => {
      const isFa = get().settings.language === 'fa';
      const res = await readImagesFromSystemClipboard();
      if (res.status === 'permission-denied') {
        get().addToast({
          type: 'warning',
          title: isFa ? 'دسترسی به کلیپ‌بورد مجاز نیست' : 'Clipboard access blocked',
          message: isFa
            ? 'می‌توانید تصویر را مستقیم با کلید ترکیبی Ctrl+V بچسبانید یا مجوز کلیپ‌بورد مرورگر را بدهید.'
            : 'Press Ctrl+V directly inside the app window, or grant browser clipboard permission.',
        });
        return 0;
      }
      if (res.status === 'unsupported') {
        get().addToast({
          type: 'info',
          title: isFa ? 'چسباندن با Ctrl+V' : 'Paste with Ctrl+V',
          message: isFa
            ? 'مرورگر خواندن مستقیم کلیپ‌بورد با دکمه را پشتیبانی نمی‌کند؛ با Ctrl+V تصویر را بچسبانید.'
            : 'Direct button read is unavailable here; press Ctrl+V to paste an image from clipboard.',
        });
        return 0;
      }
      if (res.status === 'empty' || res.files.length === 0) {
        get().addToast({
          type: 'info',
          title: isFa ? 'تصویری در کلیپ‌بورد نیست' : 'No image found in clipboard',
          message: isFa
            ? 'ابتدا یک اسکرین‌شات یا تصویر را کپی کنید، سپس دوباره امتحان کنید.'
            : 'Copy an image or screenshot first, then paste again.',
        });
        return 0;
      }
      const state = get();
      if (state.appMode === 'batch') {
        await state.addBatchFiles(res.files);
        return res.files.length;
      }
      if (state.appMode === 'ticket') {
        await state.importTicketSourceFiles(res.files);
        return res.files.length;
      }
      if (options?.target === 'overlay' && state.pages.length > 0) {
        return await state.addImageOverlayFiles(res.files);
      }
      await state.importFiles(res.files);
      return res.files.length;
    },

    clearWorkspace: () => {
      const before = captureSnapshot(get());
      set({
        documents: [],
        pages: [],
        bookmarks: [],
        overlays: [], selectedOverlayId: null, textEdit: null, activePageId: null, eraseTool: 'off', erasePending: null,
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
        printers: syncPrintersDuplex(get().printers, snap.before.layout.duplexMode),
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
        printers: syncPrintersDuplex(get().printers, snap.after.layout.duplexMode),
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

        let nextPages: PageItem[];
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
          nextPages = state.pages.map((p, idx) => ({
            ...p,
            isHighlighted: idx >= start && idx <= end,
          }));
        } else if (multiSelect) {
          nextPages = state.pages.map((p) =>
            p.id === pageId ? { ...p, isHighlighted: !p.isHighlighted } : p
          );
        } else {
          nextPages = state.pages.map((p) => ({
            ...p,
            isHighlighted: p.id === pageId,
          }));
        }

        const shouldFollowHighlight =
          state.effects.scope === 'selected' && !hasActiveVisualEffects(state.effects);

        return {
          activePageId: pageId,
          pages: nextPages,
          ...(shouldFollowHighlight
            ? {
                effects: {
                  ...state.effects,
                  targetPageIds: nextPages.filter((p) => p.isHighlighted).map((p) => p.id),
                },
              }
            : {}),
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
                overrides: { ...p.overrides, manualRotation: true, autoPackBaseRotation: undefined },
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
        ...(state.effects.targetPageIds !== undefined
          ? {
              effects: {
                ...state.effects,
                targetPageIds: state.effects.targetPageIds.filter((id) => !idSet.has(id)),
              },
            }
          : {}),
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
      set((state) => {
        const removedIds = new Set(state.pages.filter((p) => p.documentId === docId).map((p) => p.id));
        return {
          documents: state.documents.filter((d) => d.id !== docId),
          pages: state.pages.filter((p) => p.documentId !== docId),
          layout: removeCellOverrides(state.layout, removedIds),
          bookmarks: state.bookmarks.filter((b) => b.documentId !== docId),
          ...(state.effects.targetPageIds !== undefined
            ? {
                effects: {
                  ...state.effects,
                  targetPageIds: state.effects.targetPageIds.filter((id) => !removedIds.has(id)),
                },
              }
            : {}),
        };
      });
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
      // One gesture over a set never leaves a mix behind: the value is cleared when every target already
      // shows an inversion and turned on for all of them otherwise. The question is asked about the
      // *effective* inversion — what the operator actually sees — because a page that inherits the flag from
      // the document switch is inverted just as much as one that carries it itself, and reading only the
      // override made the first press of this button a silent no-op on those pages.
      const nextValue = !targets.every((page) => effectiveInvert(page, state.effects));
      set({ pages: state.pages.map((page) => {
        if (!idSet.has(page.id)) return page;
        // …and the second press is the way back to exactly what the page was doing before, not a second
        // inversion: an override that only repeats what this page already inherits is dropped rather than
        // written, so a page that had none ends with none and the document switch keeps its authority.
        let overrides: PageItem['overrides'] = nextValue === inheritedInvert(page, state.effects)
          ? { ...page.overrides, invert: undefined }
          : { ...page.overrides, invert: nextValue };
        // An object whose every key is unset is not "an override", it is noise in the project file, so the
        // page ends up exactly as it started: no `overrides` at all.
        if (!Object.values(overrides).some(value => value !== undefined)) overrides = undefined;
        return { ...page, overrides };
      }) });
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
      let duplexToPersist: DuplexMode | undefined;
      let profileToSync: PrinterProfileSettings | undefined;
      const paperOrOrientChanged =
        patch.paperSize !== undefined ||
        patch.customWidthMm !== undefined ||
        patch.customHeightMm !== undefined ||
        patch.orientation !== undefined;
      set((state) => {
        // While booklet imposition is active, editing its controls must not send the preview
        // back to the first sheet. Keep the operator on the current sheet; the preview clamps
        // the index if a changed signature size reduces the total sheet count.
        const preserveBookletPreview = !!(state.layout.booklet?.enabled || patch.booklet?.enabled);
        const activePrinter = state.printers.find((p) => p.name === state.selectedPrinterName);
        const minMargins = resolvePrinterMinMargins(state.printerMargins, activePrinter);
        const nextPatch = patch.marginsMm
          ? { ...patch, marginsMm: clampMarginsToMin(patch.marginsMm, minMargins) }
          : patch;
        const clearCustomCells =
          nextPatch.customCells === undefined &&
          Boolean(state.layout.customCells?.length) &&
          (paperOrOrientChanged ||
            nextPatch.rows !== undefined ||
            nextPatch.cols !== undefined ||
            nextPatch.booklet?.enabled ||
            nextPatch.placementMode === 'sequential');
        const mergedLayout: LayoutSettings = {
          ...state.layout,
          ...nextPatch,
          ...(clearCustomCells ? { customCells: undefined } : {}),
          ...(nextPatch.marginsMm && !nextPatch.marginMode ? { marginMode: 'custom' as const } : {}),
        };
        const bookletDuplexChanged =
          patch.booklet?.duplexMode !== undefined &&
          patch.booklet.duplexMode !== state.layout.booklet?.duplexMode;
        const bookletJustEnabledFromSimplex =
          patch.booklet?.enabled === true &&
          !state.layout.booklet?.enabled &&
          state.layout.duplexMode === 'none';
        const unifiedDuplex: DuplexMode | undefined =
          patch.duplexMode !== undefined
            ? patch.duplexMode
            : bookletDuplexChanged
              ? patch.booklet!.duplexMode
              : bookletJustEnabledFromSimplex
                ? (mergedLayout.booklet?.duplexMode ?? 'short-edge')
                : undefined;

        const synced = unifiedDuplex !== undefined
          ? syncDuplexOnLayoutAndPrinters(mergedLayout, state.printers, unifiedDuplex)
          : { layout: mergedLayout, printers: state.printers };

        if (unifiedDuplex !== undefined && unifiedDuplex !== state.layout.duplexMode) {
          duplexToPersist = unifiedDuplex;
        }

        let nextPrinters = synced.printers;
        if (paperOrOrientChanged && state.selectedPrinterName) {
          const nextLayout = synced.layout;
          const stdDims = nextLayout.paperSize !== 'Custom' ? STANDARD_PAPER_SIZES[nextLayout.paperSize] : null;
          const matchedPaperOpt =
            activePrinter?.capabilities.paperOptions?.find(
              (o) =>
                (activePrinter.activeProfile.paperName &&
                  nextLayout.paperSize === activePrinter.activeProfile.paperSize &&
                  o.name.toLowerCase() === activePrinter.activeProfile.paperName.toLowerCase()) ||
                o.id === nextLayout.paperSize
            ) ?? null;
          const nextWidthMm =
            nextLayout.paperSize === 'Custom'
              ? nextLayout.customWidthMm
              : matchedPaperOpt
                ? Math.min(matchedPaperOpt.widthMm, matchedPaperOpt.heightMm)
                : stdDims?.widthMm ?? nextLayout.customWidthMm;
          const nextHeightMm =
            nextLayout.paperSize === 'Custom'
              ? nextLayout.customHeightMm
              : matchedPaperOpt
                ? Math.max(matchedPaperOpt.widthMm, matchedPaperOpt.heightMm)
                : stdDims?.heightMm ?? nextLayout.customHeightMm;
          const nextPaperName =
            nextLayout.paperSize === 'Custom'
              ? (activePrinter?.activeProfile.paperSize === 'Custom' &&
                 activePrinter.activeProfile.paperName &&
                 Math.abs((activePrinter.activeProfile.paperWidthMm ?? 0) - nextWidthMm) <= 2.2 &&
                 Math.abs((activePrinter.activeProfile.paperHeightMm ?? 0) - nextHeightMm) <= 2.2
                  ? activePrinter.activeProfile.paperName
                  : 'Custom')
              : matchedPaperOpt?.name ?? nextLayout.paperSize;

          nextPrinters = nextPrinters.map((p) => {
            if (p.name !== state.selectedPrinterName) return p;
            const ap = p.activeProfile;
            if (
              ap.paperSize === nextLayout.paperSize &&
              ap.paperName === nextPaperName &&
              ap.orientation === nextLayout.orientation &&
              ap.paperWidthMm === nextWidthMm &&
              ap.paperHeightMm === nextHeightMm
            ) {
              return p;
            }
            profileToSync = {
              ...ap,
              paperSize: nextLayout.paperSize,
              paperName: nextPaperName,
              paperWidthMm: nextWidthMm,
              paperHeightMm: nextHeightMm,
              orientation: nextLayout.orientation,
              duplexMode: nextLayout.duplexMode,
            };
            return { ...p, activeProfile: profileToSync };
          });
        }

        return {
          layout: synced.layout,
          ...(nextPatch.marginsMm && synced.layout.marginMode !== 'printer'
            ? { lastCustomMarginsMm: synced.layout.marginsMm }
            : {}),
          ...(nextPrinters !== state.printers ? { printers: nextPrinters } : {}),
          ...(preserveBookletPreview ? {} : { activeSheetIndex: 0 }),
        };
      });
      if (profileToSync) {
        const syncTarget = profileToSync;
        const expectedSeq = profileSyncSeq.get(syncTarget.printerName) ?? 0;
        queueMicrotask(() => {
          if ((profileSyncSeq.get(syncTarget.printerName) ?? 0) === expectedSeq) {
            void ipcBridge.updatePrinterProfile(syncTarget.printerName, syncTarget).catch(() => {});
          }
        });
      }
      if (duplexToPersist !== undefined) {
        persistDuplexAcrossPrinters(get().printers, duplexToPersist, profileToSync?.printerName);
      }
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
          rows: Math.max(1, Math.min(50, rows)),
          cols: Math.max(1, Math.min(50, cols)),
          placementMode: placementMode ?? state.layout.placementMode,
          customCells: undefined,
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

    autoPackPageOnSheet: (request) => {
      const state = get();
      const targetPage =
        (request.pageId ? state.pages.find((p) => p.id === request.pageId) : undefined) ??
        (state.activePageId ? state.pages.find((p) => p.id === state.activePageId) : undefined) ??
        state.pages.find((p) => p.isHighlighted) ??
        state.pages.find((p) => p.selectedForPrint) ??
        state.pages[0];

      const lang = state.settings.language;
      if (!targetPage) {
        state.addToast({
          type: 'warning',
          title: lang === 'fa' ? 'ابتدا یک تصویر یا صفحه وارد کنید' : 'Import an image or page first',
        });
        return null;
      }

      const activePrinter = state.printers.find((p) => p.name === state.selectedPrinterName);
      const minMargins = resolvePrinterMinMargins(state.printerMargins, activePrinter);
      const reqMargin = Math.max(0, Number.isFinite(request.outerMarginMm) ? request.outerMarginMm : 0);
      const baseMarginsMm: MarginsMm = {
        top: Math.max(minMargins?.top ?? 0, reqMargin),
        right: Math.max(minMargins?.right ?? 0, reqMargin),
        bottom: Math.max(minMargins?.bottom ?? 0, reqMargin),
        left: Math.max(minMargins?.left ?? 0, reqMargin),
      };

      const layoutForSheet: LayoutSettings = state.layout.booklet?.enabled
        ? { ...state.layout, booklet: { ...state.layout.booklet, enabled: false } }
        : state.layout;
      const sheetDims = getSheetDimensionsMm(layoutForSheet);

      const plan = computeAutoPackPlan({
        sheetWidthMm: sheetDims.widthMm,
        sheetHeightMm: sheetDims.heightMm,
        baseMarginsMm,
        itemWidthMm: request.widthMm,
        itemHeightMm: request.heightMm,
        horizontalGapMm: request.horizontalGapMm,
        verticalGapMm: request.verticalGapMm,
        allowRotateForMax: request.allowRotateForMax,
        centerOnSheet: request.centerOnSheet,
      });

      if (!plan.fits) {
        state.addToast({
          type: 'warning',
          title:
            lang === 'fa'
              ? 'ابعاد انتخاب‌شده از فضای قابل چاپ شیت بزرگ‌تر است'
              : 'Selected item dimensions exceed the printable sheet area',
        });
        return plan;
      }

      const before = captureSnapshot(state);
      const baseRot: PageRotation = targetPage.overrides?.autoPackBaseRotation ?? targetPage.rotation;
      const shouldRotateTarget = !plan.isHybrid && plan.rotated90;
      const nextRotation: PageRotation = shouldRotateTarget
        ? (((baseRot + 90) % 360) as PageRotation)
        : baseRot;
      const customSlots = plan.isHybrid && plan.slots?.length ? plan.slots : undefined;

      set((curr) => ({
        pages: curr.pages.map((page) => {
          const isTarget = page.id === targetPage.id;
          const nextSelected = request.onlySelectedPage
            ? isTarget
            : isTarget
              ? true
              : page.selectedForPrint;
          if (!isTarget) {
            return nextSelected !== page.selectedForPrint
              ? { ...page, selectedForPrint: nextSelected }
              : page;
          }
          const nextOverrides: PageItem['overrides'] = {
            ...page.overrides,
            manualRotation: shouldRotateTarget ? true : page.overrides?.manualRotation,
            autoPackBaseRotation: baseRot,
            transform: undefined,
          };
          return {
            ...page,
            rotation: nextRotation,
            selectedForPrint: nextSelected,
            overrides: nextOverrides,
          };
        }),
        layout: {
          ...curr.layout,
          booklet: curr.layout.booklet
            ? { ...curr.layout.booklet, enabled: false }
            : curr.layout.booklet,
          rows: plan.rows,
          cols: plan.cols,
          placementMode: 'step-and-repeat',
          scaleMode: request.lockAspect ? 'fit' : 'fill',
          uniqueScale: true,
          autoRotateToFit: false,
          marginMode: 'custom',
          marginsMm: plan.marginsMm,
          horizontalGutterMm: plan.horizontalGutterMm,
          verticalGutterMm: plan.verticalGutterMm,
          customCells: customSlots,
          cellOverrides: undefined,
        },
        lastCustomMarginsMm: plan.marginsMm,
        activePageId: targetPage.id,
        activeSheetIndex: 0,
      }));

      pushUndo(
        plan.isHybrid
          ? `چیدمان بیشینه مختلط (${plan.totalPerSheet} عدد در برگ)`
          : `چیدمان بیشینه ${plan.rows}×${plan.cols} (${plan.totalPerSheet} عدد در برگ)`,
        plan.isHybrid
          ? `Auto-pack mixed (${plan.totalPerSheet} per sheet)`
          : `Auto-pack ${plan.rows}×${plan.cols} (${plan.totalPerSheet} per sheet)`,
        before,
        captureSnapshot(get())
      );

      get().addToast({
        type: 'success',
        title: plan.isHybrid
          ? lang === 'fa'
            ? `${plan.totalPerSheet} نسخه (چیدمان بهینه ترکیبی ۰°+۹۰°) روی برگ چیده شد`
            : `Packed ${plan.totalPerSheet} copies (optimal mixed 0°+90° layout) per sheet`
          : lang === 'fa'
            ? `${plan.totalPerSheet} نسخه (${plan.cols}×${plan.rows}) با اندازه ${plan.cellWidthMm}×${plan.cellHeightMm}mm روی برگ چیده شد`
            : `Packed ${plan.totalPerSheet} copies (${plan.cols}×${plan.rows}) at ${plan.cellWidthMm}×${plan.cellHeightMm} mm per sheet`,
      });

      return plan;
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
      set(state => {
        const activePrinter = state.printers.find((p) => p.name === state.selectedPrinterName);
        const minMargins = resolvePrinterMinMargins(state.printerMargins, activePrinter);
        const nextPatch = patch.marginsMm
          ? { ...patch, marginsMm: clampMarginsToMin(patch.marginsMm, minMargins) }
          : patch;
        const marginsChanged =
          !!nextPatch.marginsMm &&
          Object.keys(nextPatch.marginsMm).some(
            (key) =>
              nextPatch.marginsMm![key as keyof MarginsMm] !==
              state.layout.marginsMm[key as keyof MarginsMm]
          );
        return {
          layout: {
            ...state.layout,
            ...nextPatch,
            ...(marginsChanged ? { marginMode: 'custom' as const } : {}),
          },
          ...(marginsChanged && nextPatch.marginsMm
            ? { lastCustomMarginsMm: nextPatch.marginsMm }
            : {}),
        };
      });
      pushUndo('تغییر حاشیه و فاصله‌ها', 'Adjust margins and gutters', before, captureSnapshot(get()));
    },

    updateMargins: (patch) => {
      const before = captureSnapshot(get());
      set((state) => {
        const activePrinter = state.printers.find((p) => p.name === state.selectedPrinterName);
        const minMargins = resolvePrinterMinMargins(state.printerMargins, activePrinter);
        const nextMargins = clampMarginsToMin(
          {
            ...state.layout.marginsMm,
            ...patch,
          },
          minMargins
        );
        return {
          layout: {
            ...state.layout,
            marginMode: 'custom',
            marginsMm: nextMargins,
          },
          lastCustomMarginsMm: nextMargins,
        };
      });
      pushUndo('تغییر حاشیه‌ها', 'Update margins', before, captureSnapshot(get()));
    },

    applyMarginPreset: (presetId) => {
      if (presetId === 'hardware') {
        get().resetMarginsToPrinter();
        return;
      }
      const state = get();
      const before = captureSnapshot(state);
      const activePrinter = state.printers.find((p) => p.name === state.selectedPrinterName);
      const minMargins = resolvePrinterMinMargins(state.printerMargins, activePrinter);
      const rawMargins =
        presetId === 'last-custom'
          ? state.lastCustomMarginsMm ?? DEFAULT_LAST_CUSTOM_MARGINS_MM
          : BUILTIN_MARGIN_PRESETS_MM[presetId].marginsMm;
      const nextMargins = clampMarginsToMin(rawMargins, minMargins);
      set({
        layout: {
          ...state.layout,
          marginMode: 'custom',
          marginsMm: nextMargins,
        },
      });
      const label =
        presetId === 'last-custom'
          ? { fa: 'اعمال آخرین تنظیمات دلخواه حاشیه', en: 'Apply Last Custom Margins' }
          : {
              fa: `اعمال پریست حاشیه ${BUILTIN_MARGIN_PRESETS_MM[presetId].titleFa}`,
              en: `Apply ${BUILTIN_MARGIN_PRESETS_MM[presetId].titleEn} Margins`,
            };
      pushUndo(label.fa, label.en, before, captureSnapshot(get()));
    },

    refreshPrinterMargins: () => refreshPrinterMargins(),

    resetMarginsToPrinter: () => {
      const state = get();
      if (state.printerMargins.status !== 'available') return;
      const before = captureSnapshot(state);
      const activePrinter = state.printers.find((p) => p.name === state.selectedPrinterName);
      const pm = resolvePrinterMinMargins(state.printerMargins, activePrinter) ?? state.printerMargins.marginsMm;
      set({
        layout: {
          ...state.layout,
          marginMode: 'printer',
          marginsMm: { ...pm },
        },
      });
      pushUndo('بازنشانی حاشیه چاپگر', 'Reset printer margins', before, captureSnapshot(get()));
    },

    updateEffects: (patch, recordUndo = false) => {
      const before = captureSnapshot(get());
      set((state) => {
        const nextScope = patch.scope ?? state.effects.scope;
        let targetPageIds = state.effects.targetPageIds;
        if (nextScope === 'all') {
          targetPageIds = undefined;
        } else if (patch.targetPageIds !== undefined) {
          targetPageIds = [...patch.targetPageIds];
        } else if (patch.scope === 'selected' || state.effects.targetPageIds === undefined) {
          targetPageIds = state.pages.filter((p) => p.isHighlighted).map((p) => p.id);
        }
        return {
          effects: {
            ...state.effects,
            ...patch,
            targetPageIds,
            enabled: patch.enabled !== undefined ? patch.enabled : true,
          },
        };
      });
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
          ...(state.effects.scope === 'selected' && state.effects.targetPageIds === undefined
            ? { targetPageIds: state.pages.filter((p) => p.isHighlighted).map((p) => p.id) }
            : {}),
        },
      }));
      pushUndo(
        nextInvert ? 'فعال‌سازی معکوس رنگ (Invert)' : 'غیرفعال‌سازی معکوس رنگ (Invert)',
        nextInvert ? 'Enable Invert Colors' : 'Disable Invert Colors',
        before,
        captureSnapshot(get())
      );
      // This button is a pure flip, so pressing it again always returns the document to the state it was in
      // a moment ago. The one thing that can hide that from the operator is a page carrying its own override:
      // such a page answers to its own button, never to this one, and without this sentence the switch looks
      // stuck at exactly the moment it is working.
      const shadowed = get().pages.filter(page => page.overrides?.invert !== undefined).length;
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
        ...(shadowed ? { message: get().settings.language === 'fa'
          ? `${shadowed} صفحه معکوس رنگ اختصاصی دارند؛ این دکمه آن‌ها را عوض نمی‌کند — روی همان صفحه راست‌کلیک کنید.`
          : `${shadowed} page(s) carry their own invert override, so this switch cannot change them — use the page's own right-click menu.` } : {}),
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
      // A marquee waiting for `Delete` on a layer that is gone must not commit onto nothing (or worse, onto a
      // new layer that happens to take the id later).
      set({overlays:state.overlays.filter(item=>item.id!==id),selectedOverlayId:state.selectedOverlayId===id?null:state.selectedOverlayId,
        ...(state.erasePending?.overlayId===id?{erasePending:null}:{})});
      pushUndo('حذف لایه', 'Remove overlay', before, captureSnapshot(get()));
    },
    selectOverlay: id => {
      if (get().textEdit && get().textEdit?.overlayId !== id) get().finishTextEdit();
      const overlay = id ? get().overlays.find(item => item.id === id) : undefined;
      set(() => ({
        selectedOverlayId: id,
        ...(overlay && (overlay.kind === 'text' || overlay.kind === 'numbering' || overlay.kind === 'image' || overlay.kind === 'shape')
          ? { activeInspectorTool: overlay.kind, inspectorCollapsed: false }
          : {}),
      }));
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
      // On a grid — anything but one cell per side — a picture dropped anywhere goes across the whole output
      // sheet. Echoing it into every cell is still available (`sheetFill: 'each-cell'`), but it has to be the
      // operator's choice: a logo dropped on one ticket used to appear on all of them with no way to say no.
      const grid=side.cells.filter(c=>c.page).length>1;
      const created:PageOverlayImage[]=[];
      for(const file of images){
        const src=await readFileAsDataUrl(file);
        const natural=await measureImage(src);
        const placement=(grid?null:imageDropPlacement(side,target,natural))??sheetImagePlacement(side,natural);
        if(!placement)continue;
        created.push(imageOverlayFromPlacement(newImageId(),src,(file.name?.replace(/\.[^.]+$/,''))||'تصویر',natural,placement));
      }
      if(!created.length)return 0;
      const state=get();
      const before=captureSnapshot(state);
      const first=created[0];
      set({overlays:[...state.overlays,...created],selectedOverlayId:first.id,activeInspectorTool:'image',inspectorCollapsed:false,
        ...(first.target==='page'&&first.targetPageIds[0]?{activePageId:first.targetPageIds[0]}:{})});
      pushUndo(created.length>1?`افزودن ${created.length} تصویر`:'افزودن تصویر روی صفحه',
        created.length>1?`Add ${created.length} pictures to the page`:'Add picture to page',before,captureSnapshot(get()));
      get().addToast({type:'success',title:state.settings.language==='fa'
        ?`${created.length} تصویر روی صفحه قرار گرفت؛ با کشیدن جابه‌جا و با دستگیره‌ها تغییر اندازه می‌دهد.`
        :`${created.length} picture(s) placed on the page. Drag to move, handles to resize.`});
      return created.length;
    },
    setEraseTool: (tool) => {
      // Leaving the eraser also hands the pointer back: a half-finished gesture must not survive a mode flip.
      set({
        eraseTool: tool,
        textEdit: null,
        erasePending: null,
        ...(tool !== 'off' ? { canvasTool: 'move' as const, activeInspectorTool: 'eraser' as const, inspectorCollapsed: false } : {}),
      });
    },
    setEraseColor: (color) => {
      set({ eraseColor: sanitizeEraseColor(color ?? undefined) ?? null });
    },
    setErasePending: (pending) => set({ erasePending: pending }),
    spendEraseKey: (key) => {
      const pending = get().erasePending;
      if (!pending) return false;
      if (key === 'Escape') {
        set({ erasePending: null });
        return true;
      }
      if (key === 'Delete' || key === 'Backspace') {
        get().commitErasePending();
        return true;
      }
      return false;
    },
    commitErasePending: () => {
      const state = get();
      const pending = state.erasePending;
      if (!pending) return;
      const target = state.overlays.find(o => o.id === pending.overlayId);
      set({ erasePending: null });
      if (!target || target.kind !== 'image') return;
      get().setOverlayErase(pending.overlayId, commitEraseShape(target.erase, pending.shape));
    },
    setEraseBrushMm: (diameterMm) => {
      if (!Number.isFinite(diameterMm)) return;
      set({ eraseBrushMm: Math.max(0.2, Math.min(500, Math.abs(diameterMm))) });
    },
    setPageErase: (pageId, shapes) => {
      const state = get();
      const target = state.pages.find(page => page.id === pageId);
      if (!target) return;
      const clean = sanitizeEraseShapes(shapes);
      if (JSON.stringify(target.erase ?? []) === JSON.stringify(clean)) return;
      const before = captureSnapshot(state);
      set({ pages: state.pages.map(page => page.id === pageId ? { ...page, erase: clean.length ? clean : undefined } : page) });
      pushUndo(clean.length ? 'پاک کردن بخشی از صفحه' : 'بازگرداندن صفحه',
        clean.length ? 'Erase part of page' : 'Restore page', before, captureSnapshot(get()));
    },
    setOverlayErase: (overlayId, shapes) => {
      const state=get();
      const target=state.overlays.find(o=>o.id===overlayId);
      if(!target||target.kind!=='image')return;
      const clean=sanitizeEraseShapes(shapes);
      // A gesture that changes nothing must not cost the operator an undo step or a dirty document, which is
      // why the comparison is on the sanitised lists rather than on object identity.
      if(clean.length===(target.erase?.length??0) && JSON.stringify(target.erase??[])===JSON.stringify(clean))return;
      const before=captureSnapshot(state);
      set({overlays:state.overlays.map(o=>o.id===overlayId?{...o,erase:clean.length?clean:undefined}:o)});
      pushUndo(clean.length?`پاک کردن بخشی از ${target.name}`:'بازگرداندن تصویر',
        clean.length?`Erase part of ${target.name}`:'Restore the picture',before,captureSnapshot(get()));
      if(!clean.length&&(target.erase?.length??0)){
        get().addToast({type:'info',title:state.settings.language==='fa'
          ?'همه پاک‌کردن‌ها برگشت؛ تصویر همان فایل اصلی است.'
          :'All erasures undone — the picture is the original file.'});
      }
    },
    toggleOverlayInvert: (overlayIds) => {
      const state=get();
      const wanted=new Set(overlayIds??[]);
      const targets:PageOverlayImage[]=state.overlays.filter((o):o is PageOverlayImage=>o.kind==='image'&&(wanted.size?wanted.has(o.id):o.id===state.selectedOverlayId));
      if(!targets.length)return;
      const ids=new Set(targets.map(o=>o.id));
      const before=captureSnapshot(state);
      // One gesture never leaves a mix behind, and never applies a second inversion to a picture that is
      // already inverted: the value comes from the selection as a whole, exactly like the page-level toggle.
      const nextValue=!targets.every(o=>o.invert===true);
      set({overlays:state.overlays.map(o=>ids.has(o.id)?{...o,invert:nextValue}:o)});
      pushUndo(nextValue?'معکوس رنگ تصویر':'لغو معکوس رنگ تصویر',
        nextValue?'Invert the picture':'Undo the picture inversion',before,captureSnapshot(get()));
    },
    addNumberingOverlay: (convertLegacy=false) => {
      if(get().textEdit)get().finishTextEdit();
      const state=get();if(!state.pages.length)return;
      const legacy=state.pageNumbering;
      const format=convertLegacy ? (legacy.format==='bates'?'english':legacy.format) : (state.settings.language==='fa'?'persian':'english');
      const template=convertLegacy ? (legacy.format==='bates'?`${legacy.batesPrefix||'BATES-'}{serial}`:legacy.format==='persian'?'صفحه {page} از {total}':legacy.format==='english'?'Page {page} of {total}':'{page} / {total}') : '{page}';
      const position=convertLegacy?legacy.position:'bottom-center';
      const item:PageOverlayNumbering={id:globalThis.crypto?.randomUUID?.()??`number-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind:'numbering',enabled:true,target:'sheet',targetScope:'all',targetPageIds:[],targetSheetIndex:1,
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
          ? 'افکت‌ها، حاشیه و میانه‌ها، چیدمان، جهت و دورو، واترمارک و شماره‌گذاری صفحه/بخش در همین پروفایل ذخیره شدند.'
          : 'Effects, margins, gutters, custom layout, orientation, duplex, watermark and numbering are stored in this profile.',
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
      set((state) => {
        const defaultLayout = cloneDefaultLayout();
        const presetLayout = preset.layout ? structuredClone(preset.layout) : ({} as Partial<LayoutSettings>);
        const nextLayout: LayoutSettings = {
          ...defaultLayout,
          ...presetLayout,
          marginsMm: { ...defaultLayout.marginsMm, ...(presetLayout.marginsMm ?? {}) },
          booklet: defaultLayout.booklet
            ? { ...defaultLayout.booklet, ...(presetLayout.booklet ?? {}) }
            : presetLayout.booklet,
        };
        const nextEffects: EffectsSettings = {
          ...DEFAULT_EFFECTS,
          ...(preset.effects ? structuredClone(preset.effects) : {}),
        };
        if (nextEffects.scope === 'selected') {
          const validIds = new Set(state.pages.map((p) => p.id));
          const matchingSaved = (nextEffects.targetPageIds ?? []).filter((id) => validIds.has(id));
          nextEffects.targetPageIds =
            matchingSaved.length > 0
              ? matchingSaved
              : state.pages.filter((p) => p.isHighlighted).map((p) => p.id);
        } else {
          nextEffects.targetPageIds = undefined;
        }
        const nextOverlays = Array.isArray(preset.numberingOverlays)
          ? [
              ...state.overlays.filter((item) => item.kind !== 'numbering'),
              ...structuredClone(preset.numberingOverlays),
            ]
          : state.overlays;
        const nextSelectedOverlayId = nextOverlays.some((o) => o.id === state.selectedOverlayId)
          ? state.selectedOverlayId
          : null;
        return {
          layout: nextLayout,
          printers: syncPrintersWithLayout(state.printers, state.selectedPrinterName, nextLayout),
          effects: nextEffects,
          watermark: { ...getDefaultWatermarkSettings(), ...(preset.watermark ? structuredClone(preset.watermark) : {}) },
          pageNumbering: { ...getDefaultPageNumberSettings(), ...(preset.pageNumbering ? structuredClone(preset.pageNumbering) : {}) },
          overlays: nextOverlays,
          selectedOverlayId: nextSelectedOverlayId,
          activeSheetIndex: 0,
        };
      });
      pushUndo('اعمال پروفایل شیت', 'Apply sheet profile', before, captureSnapshot(get()));
      get().addToast({
        type: 'info',
        title: lang === 'fa' ? `پروفایل «${preset.name}» اعمال شد` : `Applied the "${preset.name}" profile`,
        message: lang === 'fa'
          ? 'تنظیمات محیطی برنامه تغییری نکردند؛ برگشت با Ctrl+Z ممکن است.'
          : 'Application environment preferences were not touched; Ctrl+Z brings the previous sheet setup back.',
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
      set((state) => {
        const nextLayout = cloneDefaultLayout();
        return {
          layout: nextLayout,
          printers: syncPrintersWithLayout(state.printers, state.selectedPrinterName, nextLayout),
          effects: { ...DEFAULT_EFFECTS },
          watermark: getDefaultWatermarkSettings(),
          pageNumbering: getDefaultPageNumberSettings(),
          overlays: [],
          selectedOverlayId: null,
          textEdit: null,
          eraseTool: 'off',
          erasePending: null,
          canvasTool: 'move',
          activeSheetIndex: 0,
          previewPageRequest: null,
          pages: state.pages.map((p) => ({
            ...p,
            ...(p.overrides?.manualRotation ? { rotation: 0 } : {}),
            overrides: undefined,
          })),
        };
      });
      pushUndo('بازگردانی تنظیمات صفحه و طراحی به پیش‌فرض', 'Reset sheet and design settings to defaults', before, captureSnapshot(get()));
      syncCrispPreview();
      get().addToast({
        type: 'success',
        title: lang === 'fa' ? 'تنظیمات صفحه، افکت‌ها و چیدمان به پیش‌فرض برگشت' : 'Sheet, effect & layout settings reset to defaults',
        message: lang === 'fa'
          ? 'افکت‌ها، مارجین، میانه‌ها، چیدمان، شماره صفحه/بخش، جهت، دورو و اشکال بازنشانی شدند؛ تنظیمات محیطی برنامه و فایل‌ها دست‌نخورده ماندند.'
          : 'Effects, margins, gutters, layout, numbering, orientation, duplex & shapes were reset; app environment preferences and files are untouched.',
      });
    },

    clearCrispPreviewCacheNow: () => {
      clearCrispPreviewCache();
    },

    setPdfExportOptions: (patch) =>
      set((state) => ({
        pdfExportOptions: { ...state.pdfExportOptions, ...patch },
      })),

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

      set({ isExportingPdf: true, exportProgress: 5 });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      try {
        const exportPages = onlyHighlighted
          ? targetPages.map((p) => (p.selectedForPrint ? p : { ...p, selectedForPrint: true }))
          : targetPages;
        const pdfBytes = await exportImposedPdf({
          documents: state.documents,
          pages: exportPages,
          layout: state.layout,
          effects: state.effects,
          watermark: state.watermark,
          pageNumbering: state.pageNumbering,
          overlays: state.overlays,
          allPages: state.pages,
          userName: state.settings.userName,
          exportOptions: state.pdfExportOptions,
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

    openPdfPreviewModal: async () => {
      if (get().textEdit) get().finishTextEdit();
      const state = get();
      const targetPages = state.pages.filter((p) => p.selectedForPrint);
      if (targetPages.length === 0) {
        state.addToast({
          type: 'warning',
          title:
            state.settings.language === 'fa'
              ? 'هیچ صفحه‌ای برای پیش‌نمایش PDF انتخاب نشده است'
              : 'No pages selected for PDF preview',
        });
        return;
      }
      const prevUrl = state.pdfPreviewModal?.url;
      set({ isGeneratingPdfPreview: true, isExportingPdf: true, exportProgress: 5 });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      try {
        let previewPageCount: number | null = null;
        const pdfBytes = await exportImposedPdf({
          documents: state.documents,
          pages: targetPages,
          layout: state.layout,
          effects: state.effects,
          watermark: state.watermark,
          pageNumbering: state.pageNumbering,
          overlays: state.overlays,
          allPages: state.pages,
          userName: state.settings.userName,
          exportOptions: state.pdfExportOptions,
          onProgress: (percent) => set({ exportProgress: percent }),
          onMeta: ({ sheetCount }) => {
            previewPageCount = sheetCount;
          },
        });
        const pageCount = previewPageCount ?? (await PDFDocument.load(pdfBytes)).getPageCount();
        const safeBytes =
          pdfBytes.byteOffset === 0 && pdfBytes.byteLength === pdfBytes.buffer.byteLength
            ? (pdfBytes.buffer as ArrayBuffer)
            : (pdfBytes.slice().buffer as ArrayBuffer);
        const blob = new Blob([safeBytes], { type: 'application/pdf' });
        const url =
          typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
            ? URL.createObjectURL(blob)
            : `data:application/pdf;base64,${btoa(Array.from(pdfBytes, (b) => String.fromCharCode(b)).join(''))}`;
        if (prevUrl && prevUrl.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(prevUrl);
        }
        set({
          pdfPreviewModal: {
            url,
            fileName: `PrintStudio-Preview-${state.layout.rows}x${state.layout.cols}.pdf`,
            pageCount,
            byteLength: pdfBytes.byteLength,
          },
        });
      } catch (error) {
        state.addToast({
          type: 'error',
          title: state.settings.language === 'fa' ? 'ساخت پیش‌نمایش PDF ناموفق بود' : 'PDF preview failed',
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        set({ isGeneratingPdfPreview: false, isExportingPdf: false, exportProgress: 0 });
      }
    },

    closePdfPreviewModal: () => {
      const prevUrl = get().pdfPreviewModal?.url;
      if (prevUrl && prevUrl.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(prevUrl);
      }
      set({ pdfPreviewModal: null });
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
        set((state) => {
          const loadedLayout = { ...parsed.layout, marginMode: parsed.layout.marginMode ?? 'custom' };
          return {
            layout: loadedLayout,
            printers: syncPrintersDuplex(state.printers, loadedLayout.duplexMode),
            effects: parsed.effects ?? DEFAULT_EFFECTS,
            watermark: parsed.watermark ?? getDefaultWatermarkSettings(),
            pageNumbering: parsed.pageNumbering ?? getDefaultPageNumberSettings(),
            // Overlays come from a file, so the two fields that decide *what a number counts* and *whether a
            // picture is repeated* are read through their own validators rather than trusted as written.
            overlays: Array.isArray(parsed.overlays)
              ? parsed.overlays.map((overlay) => overlay.kind === 'numbering'
                ? { ...overlay, ...sanitizeSequence(overlay.sequenceBasis, overlay.sequenceDirection) }
                : overlay)
              : [],
            selectedOverlayId: null, textEdit: null, activePageId: null, eraseTool: 'off', erasePending: null,
            documents: parsed.documents as SourceDocument[],
            pages: parsed.pages,
            bookmarks: parsed.bookmarks ?? [],
            activeSheetIndex: 0,
          };
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

      const nextDuplex: DuplexMode = profile.duplexMode ?? get().layout.duplexMode;
      const baseLayout: LayoutSettings = {
        ...get().layout,
        paperSize,
        orientation: profile.orientation ?? get().layout.orientation,
        duplexMode: nextDuplex,
        ...(wMm && hMm
          ? {
              customWidthMm: Math.min(wMm, hMm),
              customHeightMm: Math.max(wMm, hMm),
            }
          : {}),
      };
      const synced = syncDuplexOnLayoutAndPrinters(baseLayout, get().printers, nextDuplex);
      set({ selectedPrinterName: printerName, layout: synced.layout, printers: synced.printers });
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
      profileSyncSeq.set(printerName, (profileSyncSeq.get(printerName) ?? 0) + 1);
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
      const hasDuplexPatch = profileOrPatch.duplexMode !== undefined;
      set((s) => {
        const updatedPrinters = s.printers.map((p) =>
          p.name === printerName
            ? { ...p, activeProfile: nextProfile }
            : hasDuplexPatch
              ? { ...p, activeProfile: { ...p.activeProfile, duplexMode: nextProfile.duplexMode } }
              : p
        );
        const nextActivePrinter = updatedPrinters.find((p) => p.name === printerName);
        const minMargins =
          s.selectedPrinterName === printerName
            ? resolvePrinterMinMargins(s.printerMargins, nextActivePrinter)
            : undefined;
        const nextMarginsMm =
          minMargins
            ? s.layout.marginMode === 'printer'
              ? { ...minMargins }
              : clampMarginsToMin(s.layout.marginsMm, minMargins)
            : s.layout.marginsMm;
        const nextBooklet =
          hasDuplexPatch &&
          s.layout.booklet &&
          (nextProfile.duplexMode === 'long-edge' || nextProfile.duplexMode === 'short-edge')
            ? { ...s.layout.booklet, duplexMode: nextProfile.duplexMode }
            : s.layout.booklet;
        const nextLayout: LayoutSettings =
          s.selectedPrinterName === printerName
            ? {
                ...s.layout,
                paperSize: nextProfile.paperSize,
                orientation: nextProfile.orientation,
                duplexMode: nextProfile.duplexMode,
                ...(nextBooklet !== s.layout.booklet ? { booklet: nextBooklet } : {}),
                marginsMm: nextMarginsMm,
                ...(nextProfile.paperWidthMm && nextProfile.paperHeightMm
                  ? {
                      customWidthMm: Math.min(nextProfile.paperWidthMm, nextProfile.paperHeightMm),
                      customHeightMm: Math.max(nextProfile.paperWidthMm, nextProfile.paperHeightMm),
                    }
                  : {}),
              }
            : hasDuplexPatch
              ? {
                  ...s.layout,
                  duplexMode: nextProfile.duplexMode,
                  ...(nextBooklet !== s.layout.booklet ? { booklet: nextBooklet } : {}),
                }
              : s.layout;
        return {
          printers: updatedPrinters,
          ...(nextLayout !== s.layout ? { layout: nextLayout } : {}),
        };
      });

      if (hasDuplexPatch) {
        persistDuplexAcrossPrinters(get().printers, nextProfile.duplexMode, printerName);
      }

      try {
        const updated = sanitizePrinterInfo(
          await ipcBridge.updatePrinterProfile(printerName, nextProfile)
        );
        set((s) => ({
          printers: s.printers.map((p) =>
            p.name === printerName
              ? sanitizePrinterInfo({
                  ...updated,
                  activeProfile: {
                    ...updated.activeProfile,
                    ...nextProfile,
                    duplexMode: s.layout.duplexMode,
                  },
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
        ...(!bookletMode && request.paperWidthMm && request.paperHeightMm
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
      const rawEstimatedSheets = computeImpositionSheets(targetPages, printLayout);
      const effectiveEstimatedDuplex = printLayout.booklet?.enabled
        ? printLayout.booklet.duplexMode
        : printLayout.duplexMode;
      const estimatedSheets = Math.max(
        1,
        stripTrailingEmptyDuplexSides(rawEstimatedSheets, effectiveEstimatedDuplex).length
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

    setQuickPrintCopies: (copies) => {
      const state = get();
      const targetPrinter =
        state.printers.find((p) => p.name === state.selectedPrinterName) ??
        state.printers.find((p) => p.isDefault) ??
        state.printers[0];
      const maxCopies = targetPrinter?.capabilities.maxCopies ?? 999;
      const numeric = Number.isFinite(copies) ? Math.round(copies) : 1;
      set({ quickPrintCopies: Math.max(1, Math.min(maxCopies, numeric)) });
    },

    silentPrintNow: async () => {
      const state = get();
      const targetPrinter =
        state.printers.find((p) => p.name === state.selectedPrinterName) ??
        state.printers.find((p) => p.isDefault) ??
        state.printers[0];
      const printerName = targetPrinter?.name ?? '';
      const profile = targetPrinter?.activeProfile;
      const effectiveDuplex = state.layout.booklet?.enabled
        ? state.layout.booklet.duplexMode
        : (profile?.duplexMode ?? state.layout.duplexMode);
      const maxCopies = targetPrinter?.capabilities.maxCopies ?? 999;
      const copies = Math.max(
        1,
        Math.min(maxCopies, Math.round(state.quickPrintCopies) || 1)
      );

      const request: PrintJobRequest = {
        printerName,
        jobTitle: state.documents[0]?.name ?? 'PrintStudio Direct Job',
        copies,
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

    setAppMode: (mode) => set({ appMode: mode }),

    updateTicketConfig: (patch) =>
      set((state) => ({
        ticketConfig:
          typeof patch === 'function'
            ? patch(state.ticketConfig)
            : { ...state.ticketConfig, ...patch },
      })),

    resetTicketConfig: () =>
      set({
        ticketConfig: createDefaultTicketConfig(),
      }),

    setTicketSelectedSourcePageId: (pageId) =>
      set({ ticketSelectedSourcePageId: pageId }),

    importTicketSourceFiles: async (files) => {
      if (!files.length) return;
      const result = await importFilesBatch([files[0]]);
      const isFa = get().settings.language === 'fa';
      if (result.documents.length > 0 && result.pages.length > 0) {
        const doc = result.documents[0];
        const docPages = result.pages
          .filter((p) => p.documentId === doc.id)
          .map((p, idx) => ({ ...p, selectedForPrint: true, isHighlighted: idx === 0 }));
        set({
          ticketSourceDocument: doc,
          ticketSourcePages: docPages,
          ticketSelectedSourcePageId: docPages[0]?.id ?? null,
        });
        get().addToast({
          type: 'success',
          title: isFa
            ? `فرم «${doc.name}» (${docPages.length} صفحه) بارگذاری شد`
            : `Loaded form "${doc.name}" (${docPages.length} page${docPages.length > 1 ? 's' : ''})`,
        });
      }
      for (const err of result.errors) {
        get().addToast({
          type: 'error',
          title: isFa ? err.reasonFa : err.reasonEn,
          message: isFa ? err.solutionFa : err.solutionEn,
        });
      }
    },

    useStudioActivePageAsTicketSource: () => {
      const state = get();
      const isFa = state.settings.language === 'fa';
      const activePage =
        state.pages.find((p) => p.id === state.activePageId) ??
        state.pages.find((p) => p.isHighlighted) ??
        state.pages[0];
      if (!activePage) {
        state.addToast({
          type: 'warning',
          title: isFa ? 'صفحه‌ای در استودیو انتخاب نشده است' : 'No page available in Studio',
        });
        return false;
      }
      const sourceDoc = state.documents.find((d) => d.id === activePage.documentId) ?? null;
      const docPages = sourceDoc
        ? state.pages.filter((p) => p.documentId === sourceDoc.id)
        : [activePage];
      const uniquePages = docPages.filter(
        (page, index, arr) =>
          arr.findIndex((p) => p.sourcePageNumber === page.sourcePageNumber && p.id === page.id) === index
      );
      const docForTicket: SourceDocument = sourceDoc ?? {
        id: activePage.documentId,
        name: activePage.documentName,
        filePath: activePage.documentName,
        fileSize: 0,
        fileType: 'pdf',
        mimeType: 'application/pdf',
        pageCount: 1,
        createdAt: new Date().toISOString(),
      };
      set({
        ticketSourceDocument: docForTicket,
        ticketSourcePages: uniquePages.length > 0 ? uniquePages : [activePage],
        ticketSelectedSourcePageId: activePage.id,
      });
      state.addToast({
        type: 'success',
        title: isFa
          ? `فرم فعلی استودیو (${activePage.documentName}) برای شماره‌گذاری انتخاب شد`
          : `Using Studio page (${activePage.documentName}) as ticket form`,
      });
      return true;
    },

    clearTicketSource: () =>
      set({
        ticketSourceDocument: null,
        ticketSourcePages: [],
        ticketSelectedSourcePageId: null,
      }),

    generateTicketSheetsToStudio: () => {
      if (get().textEdit) get().finishTextEdit();
      const state = get();
      const isFa = state.settings.language === 'fa';
      const config = state.ticketConfig;
      const metrics = getTicketGridMetrics(config);
      const before = captureSnapshot(state);

      let sourceDoc = state.ticketSourceDocument;
      let sourcePage =
        state.ticketSourcePages.find((p) => p.id === state.ticketSelectedSourcePageId) ??
        state.ticketSourcePages[0];

      if (!sourceDoc || !sourcePage) {
        const blank = createBlankTicketSource(metrics.cellWidthMm, metrics.cellHeightMm, isFa);
        sourceDoc = blank.document;
        sourcePage = blank.page;
      }

      const generatedPages = generateTicketPages(sourcePage, metrics.totalTickets);
      const nextLayout = buildTicketStudioLayout(state.layout, config);
      const nextOverlays = buildTicketStudioOverlays(config, nextLayout, generatedPages);
      const firstNumbering = nextOverlays.find((o) => o.kind === 'numbering');
      const nextBookmark: BookmarkItem = {
        id: `bm-ticket-${Date.now()}`,
        title: sourceDoc.name,
        documentId: sourceDoc.id,
        targetPageId: generatedPages[0].id,
        pageIndex: 0,
        level: 0,
      };

      clearCrispPreviewCache();
      set({
        documents: [sourceDoc],
        pages: generatedPages,
        bookmarks: [nextBookmark],
        layout: nextLayout,
        pageNumbering: { ...state.pageNumbering, enabled: false },
        printers: syncPrintersWithLayout(state.printers, state.selectedPrinterName, nextLayout),
        overlays: nextOverlays,
        selectedOverlayId: firstNumbering?.id ?? nextOverlays[0]?.id ?? null,
        activePageId: generatedPages[0]?.id ?? null,
        activeSheetIndex: 0,
        previewPageRequest: generatedPages[0] ? { pageId: generatedPages[0].id } : null,
        textEdit: null,
        eraseTool: 'off',
        erasePending: null,
        appMode: 'studio',
        activeRibbonTab: 'insert',
        activeInspectorTool: firstNumbering ? 'numbering' : 'layout',
        inspectorCollapsed: false,
      });

      pushUndo(
        `تولید خودکار ${metrics.effectiveSheetCount} شیت قبض (${metrics.totalTickets} قبض)`,
        `Generate ${metrics.effectiveSheetCount} Ticket Sheets (${metrics.totalTickets} tickets)`,
        before,
        captureSnapshot(get())
      );

      get().addToast({
        type: 'success',
        title: isFa
          ? `${metrics.effectiveSheetCount} شیت (${metrics.totalTickets} قبض) ساخته شد و در استودیو باز شد`
          : `Generated ${metrics.effectiveSheetCount} sheets (${metrics.totalTickets} tickets) in Studio`,
        message: isFa
          ? 'تمامی شماره‌ها و خطوط برش و پرفراژ در استودیو قابل ویرایش و چاپ هستند.'
          : 'All numbering boxes and cut/perforation guides are editable in Studio.',
      });

      return generatedPages.length;
    },

    exportTicketPdfDirect: async () => {
      if (get().textEdit) get().finishTextEdit();
      const state = get();
      const isFa = state.settings.language === 'fa';
      const config = state.ticketConfig;
      const metrics = getTicketGridMetrics(config);

      let sourceDoc = state.ticketSourceDocument;
      let sourcePage =
        state.ticketSourcePages.find((p) => p.id === state.ticketSelectedSourcePageId) ??
        state.ticketSourcePages[0];

      if (!sourceDoc || !sourcePage) {
        const blank = createBlankTicketSource(metrics.cellWidthMm, metrics.cellHeightMm, isFa);
        sourceDoc = blank.document;
        sourcePage = blank.page;
      }

      set({ isExportingPdf: true, exportProgress: 5 });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      try {
        const generatedPages = generateTicketPages(sourcePage, metrics.totalTickets);
        const nextLayout = buildTicketStudioLayout(state.layout, config);
        const nextOverlays = buildTicketStudioOverlays(config, nextLayout, generatedPages);

        const pdfBytes = await exportImposedPdf({
          documents: [sourceDoc],
          pages: generatedPages,
          layout: nextLayout,
          effects: state.effects,
          watermark: state.watermark,
          pageNumbering: { ...state.pageNumbering, enabled: false },
          overlays: nextOverlays,
          allPages: generatedPages,
          userName: state.settings.userName,
          exportOptions: state.pdfExportOptions,
          onProgress: (percent) => set({ exportProgress: percent }),
        });

        const fileName = `PrintStudio-Tickets-${metrics.rows}x${metrics.cols}-${metrics.totalTickets}pcs-${Date.now()}.pdf`;
        triggerBlobDownload(pdfBytes, fileName, 'application/pdf');

        state.addToast({
          type: 'success',
          title: isFa
            ? `فایل PDF قبض‌ها (${metrics.effectiveSheetCount} شیت / ${metrics.totalTickets} قبض) ساخته و ذخیره شد`
            : `Ticket PDF (${metrics.effectiveSheetCount} sheets / ${metrics.totalTickets} tickets) saved`,
        });

        return pdfBytes;
      } catch (error) {
        state.addToast({
          type: 'error',
          title: isFa ? 'ساخت PDF قبض ناموفق بود' : 'Ticket PDF export failed',
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      } finally {
        set({ isExportingPdf: false, exportProgress: 0 });
      }
    },

    selectBatchJob: (id) => set({ batchSelectedJobId: id }),

    addBatchFiles: async (files) => {
      if (!files.length) return;
      const state = get();
      const isFa = state.settings.language === 'fa';
      const activePrinter =
        state.printers.find((p) => p.name === state.selectedPrinterName) ??
        state.printers.find((p) => p.isDefault) ??
        state.printers[0];
      const hw = activePrinter?.activeProfile;
      const addedJobs: BatchJobItem[] = [];

      for (const file of files) {
        const result = await importFilesBatch([file]);
        for (const doc of result.documents) {
          const docPages = result.pages
            .filter((p) => p.documentId === doc.id)
            .map((p) => ({ ...p, selectedForPrint: true }));
          if (docPages.length === 0) continue;

          const newJob: BatchJobItem = {
            id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            fileName: doc.name,
            fileSize: doc.fileSize,
            pageCount: docPages.length,
            printerName: activePrinter?.name ?? state.selectedPrinterName ?? '',
            copies: 1,
            collate: hw?.collate ?? true,
            pageRangeMode: 'all',
            customRangeText: '',
            oddEvenFilter: 'all',
            reverseOrder: false,
            nUp: 1,
            scaleMode: 'fit',
            paperSize: hw?.paperSize ?? state.layout.paperSize,
            paperName: hw?.paperName,
            paperWidthMm: hw?.paperWidthMm,
            paperHeightMm: hw?.paperHeightMm,
            orientation: hw?.orientation ?? state.layout.orientation,
            tray: hw?.tray ?? 'Auto Select',
            mediaType: hw?.mediaType ?? 'Plain Paper',
            dpi: hw?.dpi ?? 600,
            quality: hw?.quality ?? 'normal',
            colorMode: hw?.colorMode === 'monochrome' ? 'bw' : 'color',
            duplexMode: hw?.duplexMode ?? 'none',
            staple: hw?.staple,
            holePunch: hw?.holePunch,
            fold: hw?.fold,
            outputBin: hw?.outputBin,
            borderless: hw?.borderless,
            invert: false,
            useGlobalPrinterSettings: true,
            snapshotDocuments: [doc],
            snapshotPages: docPages,
            snapshotLayout: {
              ...DEFAULT_LAYOUT,
              paperSize: hw?.paperSize ?? state.layout.paperSize,
              customWidthMm: hw?.paperWidthMm ?? state.layout.customWidthMm,
              customHeightMm: hw?.paperHeightMm ?? state.layout.customHeightMm,
              orientation: hw?.orientation ?? state.layout.orientation,
              duplexMode: hw?.duplexMode ?? 'none',
              rows: 1,
              cols: 1,
              marginsMm: { ...state.layout.marginsMm },
            },
            status: 'queued',
            progressPercent: 0,
            retryCount: 0,
            addedAt: new Date().toISOString(),
          };
          addedJobs.push(newJob);
        }
        for (const err of result.errors) {
          state.addToast({
            type: 'error',
            title: isFa ? err.reasonFa : err.reasonEn,
            message: isFa ? err.solutionFa : err.solutionEn,
          });
        }
      }

      if (addedJobs.length > 0) {
        set((s) => ({
          batchQueue: [...s.batchQueue, ...addedJobs],
          batchSelectedJobId: s.batchSelectedJobId ?? addedJobs[0].id,
        }));
        state.addToast({
          type: 'success',
          title: isFa
            ? `${addedJobs.length} فایل به صف چاپ دسته‌ای اضافه شد`
            : `Added ${addedJobs.length} file(s) to Batch Print Queue`,
        });
      }
    },

    addCurrentWorkspaceToBatch: () => {
      const state = get();
      const selectedPages = state.pages.filter((p) => p.selectedForPrint);
      if (selectedPages.length === 0) return;

      const activePrinter =
        state.printers.find((p) => p.name === state.selectedPrinterName) ??
        state.printers.find((p) => p.isDefault) ??
        state.printers[0];
      const hw = activePrinter?.activeProfile;

      const newItem: BatchJobItem = {
        id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        fileName:
          state.documents.length === 1
            ? state.documents[0].name
            : `پروژه-ادغامی-${state.documents.length}-فایل.pdf`,
        fileSize: state.documents.reduce((acc, d) => acc + d.fileSize, 0),
        pageCount: selectedPages.length,
        printerName: state.selectedPrinterName || state.printers[0]?.name || '',
        copies: 1,
        collate: hw?.collate ?? true,
        pageRangeMode: 'all',
        customRangeText: '',
        oddEvenFilter: 'all',
        reverseOrder: false,
        nUp: state.layout.rows * state.layout.cols,
        scaleMode: state.layout.scaleMode === 'original' ? 'actual' : 'fit',
        paperSize: hw?.paperSize ?? state.layout.paperSize,
        paperName: hw?.paperName,
        paperWidthMm: hw?.paperWidthMm,
        paperHeightMm: hw?.paperHeightMm,
        orientation: hw?.orientation ?? state.layout.orientation,
        tray: hw?.tray ?? 'Auto Select',
        mediaType: hw?.mediaType ?? 'Plain Paper',
        dpi: hw?.dpi ?? 600,
        quality: hw?.quality ?? 'normal',
        colorMode:
          state.effects.grayscale ||
          state.effects.blackAndWhite ||
          hw?.colorMode === 'monochrome'
            ? 'bw'
            : 'color',
        duplexMode: hw?.duplexMode ?? state.layout.duplexMode,
        staple: hw?.staple,
        holePunch: hw?.holePunch,
        fold: hw?.fold,
        outputBin: hw?.outputBin,
        borderless: hw?.borderless,
        invert: state.effects.invert,
        useGlobalPrinterSettings: true,
        snapshotDocuments: state.documents.map((d) => ({ ...d })),
        snapshotPages: selectedPages.map((p) => ({ ...p, selectedForPrint: true })),
        snapshotLayout: structuredClone(state.layout),
        snapshotEffects: structuredClone(state.effects),
        snapshotWatermark: structuredClone(state.watermark),
        snapshotPageNumbering: structuredClone(state.pageNumbering),
        snapshotOverlays: structuredClone(state.overlays),
        status: 'queued',
        progressPercent: 0,
        retryCount: 0,
        addedAt: new Date().toISOString(),
      };

      set((s) => ({
        batchQueue: [...s.batchQueue, newItem],
        batchSelectedJobId: newItem.id,
        activeRibbonTab: 'batch',
        workspaceDrawer: null,
      }));
      state.addToast({
        type: 'success',
        title:
          state.settings.language === 'fa'
            ? 'پروژه فعلی به صف چاپ دسته‌ای (Batch Queue) اضافه شد'
            : 'Added current workspace to Batch Print Queue',
      });
    },

    updateBatchJob: (id, patch) => {
      set((s) => ({
        batchQueue: s.batchQueue.map((item) => {
          if (item.id !== id) return item;
          const next = { ...item, ...patch };
          if (patch.nUp !== undefined && next.snapshotLayout) {
            const { rows, cols } = nUpToRowsCols(patch.nUp);
            next.snapshotLayout = { ...next.snapshotLayout, rows, cols };
          }
          return next;
        }),
      }));
    },

    applyPrinterProfileToAllBatchJobs: () => {
      const state = get();
      const activePrinter =
        state.printers.find((p) => p.name === state.selectedPrinterName) ??
        state.printers[0];
      if (!activePrinter) return;
      const hw = activePrinter.activeProfile;
      set((s) => ({
        batchQueue: s.batchQueue.map((item) =>
          item.status === 'processing'
            ? item
            : {
                ...item,
                printerName: activePrinter.name,
                paperSize: hw.paperSize,
                paperName: hw.paperName,
                paperWidthMm: hw.paperWidthMm,
                paperHeightMm: hw.paperHeightMm,
                orientation: hw.orientation,
                tray: hw.tray,
                mediaType: hw.mediaType,
                dpi: hw.dpi,
                quality: hw.quality,
                collate: hw.collate,
                duplexMode: hw.duplexMode,
                colorMode: hw.colorMode === 'monochrome' ? 'bw' : 'color',
                staple: hw.staple,
                holePunch: hw.holePunch,
                fold: hw.fold,
                outputBin: hw.outputBin,
                borderless: hw.borderless,
                useGlobalPrinterSettings: true,
              }
        ),
      }));
      state.addToast({
        type: 'info',
        title:
          state.settings.language === 'fa'
            ? `تنظیمات سخت‌افزاری «${activePrinter.name}» به کل صف اعمال شد`
            : `Applied "${activePrinter.name}" hardware profile to all batch jobs`,
      });
    },

    moveBatchJob: (id, direction) => {
      set((s) => {
        const idx = s.batchQueue.findIndex((b) => b.id === id);
        if (idx === -1) return s;
        const nextIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (nextIdx < 0 || nextIdx >= s.batchQueue.length) return s;
        const copy = s.batchQueue.slice();
        const [moved] = copy.splice(idx, 1);
        copy.splice(nextIdx, 0, moved);
        return { batchQueue: copy };
      });
    },

    duplicateBatchJob: (id) => {
      set((s) => {
        const idx = s.batchQueue.findIndex((b) => b.id === id);
        if (idx === -1) return s;
        const src = s.batchQueue[idx];
        const dup: BatchJobItem = {
          ...src,
          id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          status: 'queued',
          progressPercent: 0,
          retryCount: 0,
          errorMessage: undefined,
          spoolerJobId: undefined,
          completedAt: undefined,
          addedAt: new Date().toISOString(),
        };
        const copy = s.batchQueue.slice();
        copy.splice(idx + 1, 0, dup);
        return { batchQueue: copy, batchSelectedJobId: dup.id };
      });
    },

    clearCompletedBatchJobs: () => {
      set((s) => {
        const next = s.batchQueue.filter((b) => b.status !== 'completed');
        const nextSel = next.some((b) => b.id === s.batchSelectedJobId)
          ? s.batchSelectedJobId
          : next[0]?.id ?? null;
        return { batchQueue: next, batchSelectedJobId: nextSel };
      });
    },

    clearAllBatchJobs: () => {
      set((s) => ({
        isBatchRunning: false,
        batchQueue: s.batchQueue.filter((b) => b.status === 'processing'),
        batchSelectedJobId: null,
      }));
    },

    cancelBatchJob: (id) => {
      canceledBatchJobIds.add(id);
      set((s) => ({
        batchQueue: s.batchQueue.map((b) =>
          b.id === id ? { ...b, status: 'canceled', progressPercent: 0 } : b
        ),
      }));
    },

    runBatchQueue: async () => {
      const initialState = get();
      if (initialState.isBatchRunning) return;

      const queuedIds = initialState.batchQueue
        .filter((b) => b.status === 'queued' || b.status === 'paused')
        .map((b) => b.id);
      if (queuedIds.length === 0) return;

      batchRunPaused = false;
      canceledBatchJobIds.clear();
      set({ isBatchRunning: true });

      let completedCount = 0;
      let failedCount = 0;
      let lastFailureMessage = '';

      for (const jobId of queuedIds) {
        if (batchRunPaused) break;
        const currentJob = get().batchQueue.find((b) => b.id === jobId);
        if (!currentJob || currentJob.status === 'canceled') continue;

        const isFa = get().settings.language === 'fa';

        // Fail cleanly (and never falsely report completion) if a stub job has no document bytes/pages.
        if (!currentJob.snapshotDocuments?.length || !currentJob.snapshotPages?.length) {
          failedCount++;
          lastFailureMessage = isFa
            ? 'چاپ دسته‌ای برای این آیتم فاقد داده سند و فایل منبع است؛ امکان چاپ وجود ندارد.'
            : 'Batch item has no source document snapshot to print.';
          set((s) => ({
            batchQueue: s.batchQueue.map((item) =>
              item.id === jobId
                ? {
                    ...item,
                    status: 'failed',
                    progressPercent: 0,
                    errorMessage: lastFailureMessage,
                  }
                : item
            ),
          }));
          continue;
        }

        try {
          set((s) => ({
            batchQueue: s.batchQueue.map((item) =>
              item.id === jobId
                ? {
                    ...item,
                    status: 'processing',
                    progressPercent: 12,
                    errorMessage: undefined,
                  }
                : item
            ),
          }));

          const liveState = get();
          const targetPrinterName =
            currentJob.printerName ||
            liveState.selectedPrinterName ||
            liveState.printers.find((p) => p.isDefault)?.name ||
            liveState.printers[0]?.name ||
            '';
          const matchedPrinter = liveState.printers.find(
            (p) => p.name.toLowerCase() === targetPrinterName.toLowerCase()
          );

          const plan = buildBatchExecutionPlan(
            { ...currentJob, printerName: targetPrinterName },
            matchedPrinter,
            liveState.layout,
            isFa
          );

          if (!plan.request.printerName) {
            throw new Error(
              isFa
                ? 'هیچ پرینتری برای ارسال کار انتخاب نشده است.'
                : 'No target printer is selected.'
            );
          }

          if (canceledBatchJobIds.has(jobId) || batchRunPaused) continue;

          const imposedPdfBytes = await exportImposedPdf({
            documents: currentJob.snapshotDocuments,
            pages: plan.targetPages,
            layout: plan.layout,
            effects: plan.effects,
            watermark: plan.watermark,
            pageNumbering: plan.pageNumbering,
            overlays: plan.overlays,
            allPages: plan.allPages,
            userName: liveState.settings.userName,
            onProgress: (pct) => {
              if (canceledBatchJobIds.has(jobId) || batchRunPaused) return;
              const mapped = 15 + Math.round(pct * 0.45);
              set((s) => ({
                batchQueue: s.batchQueue.map((item) =>
                  item.id === jobId ? { ...item, progressPercent: mapped } : item
                ),
              }));
            },
          });

          if (canceledBatchJobIds.has(jobId) || batchRunPaused) continue;

          set((s) => ({
            batchQueue: s.batchQueue.map((item) =>
              item.id === jobId ? { ...item, progressPercent: 65 } : item
            ),
          }));

          const sheetPngs = await renderPdfToSheetPngs(
            imposedPdfBytes,
            plan.request.dpi,
            (rendered, total) => {
              if (canceledBatchJobIds.has(jobId) || batchRunPaused) return;
              const mapped = 65 + Math.round((rendered / Math.max(1, total)) * 25);
              set((s) => ({
                batchQueue: s.batchQueue.map((item) =>
                  item.id === jobId ? { ...item, progressPercent: mapped } : item
                ),
              }));
            },
            () => canceledBatchJobIds.has(jobId) || batchRunPaused
          );

          if (canceledBatchJobIds.has(jobId) || batchRunPaused) continue;

          const totalSheetSides = Math.max(
            1,
            sheetPngs.length || plan.estimatedSheetSides
          );

          set((s) => ({
            batchQueue: s.batchQueue.map((item) =>
              item.id === jobId ? { ...item, progressPercent: 92 } : item
            ),
          }));

          const spoolJob = await ipcBridge.submitPrintJob(
            plan.request,
            totalSheetSides,
            imposedPdfBytes,
            sheetPngs
          );

          completedCount++;
          set((s) => ({
            batchQueue: s.batchQueue.map((item) =>
              item.id === jobId
                ? {
                    ...item,
                    status: 'completed',
                    progressPercent: 100,
                    spoolerJobId: spoolJob.jobId,
                    completedAt: new Date().toISOString(),
                    errorMessage: undefined,
                  }
                : item
            ),
          }));
        } catch (err) {
          if (canceledBatchJobIds.has(jobId)) {
            set((s) => ({
              batchQueue: s.batchQueue.map((item) =>
                item.id === jobId
                  ? { ...item, status: 'canceled', progressPercent: 0 }
                  : item
              ),
            }));
          } else if (batchRunPaused) {
            set((s) => ({
              batchQueue: s.batchQueue.map((item) =>
                item.id === jobId
                  ? { ...item, status: 'paused', progressPercent: 0 }
                  : item
              ),
            }));
          } else {
            failedCount++;
            lastFailureMessage = err instanceof Error ? err.message : String(err);
            set((s) => ({
              batchQueue: s.batchQueue.map((item) =>
                item.id === jobId
                  ? {
                      ...item,
                      status: 'failed',
                      progressPercent: 0,
                      errorMessage: lastFailureMessage,
                    }
                  : item
              ),
            }));
          }
        }
      }

      if (completedCount > 0) {
        const refreshed = await ipcBridge
          .listSpoolerJobs(get().selectedPrinterName || undefined)
          .catch(() => null);
        if (refreshed) {
          set({ spoolerJobs: refreshed });
        }
      }

      set({ isBatchRunning: false });

      const isFa = get().settings.language === 'fa';
      if (failedCount > 0) {
        get().addToast({
          type: 'error',
          title:
            completedCount > 0
              ? isFa
                ? `${completedCount} فایل چاپ شد، ${failedCount} فایل ناموفق بود`
                : `${completedCount} printed, ${failedCount} failed`
              : lastFailureMessage ||
                (isFa ? 'ارسال صف چاپ دسته‌ای ناموفق بود' : 'Batch print failed'),
        });
      } else if (completedCount > 0 && !batchRunPaused) {
        get().addToast({
          type: 'success',
          title: isFa
            ? `صف چاپ دسته‌ای تکمیل شد (${completedCount} فایل به پرینتر ارسال گردید)`
            : `Batch queue completed (${completedCount} job(s) sent)`,
        });
      }
    },

    pauseBatchQueue: () => {
      batchRunPaused = true;
      set((s) => ({
        isBatchRunning: false,
        batchQueue: s.batchQueue.map((b) =>
          b.status === 'processing' ? { ...b, status: 'paused' } : b
        ),
      }));
    },

    removeBatchJob: (id) => {
      canceledBatchJobIds.add(id);
      set((s) => {
        const nextQueue = s.batchQueue.filter((b) => b.id !== id);
        const nextSelected =
          s.batchSelectedJobId === id
            ? nextQueue[0]?.id ?? null
            : s.batchSelectedJobId;
        return {
          batchQueue: nextQueue,
          batchSelectedJobId: nextSelected,
        };
      });
    },

    retryFailedBatchJobs: () => {
      set((s) => ({
        batchQueue: s.batchQueue.map((b) =>
          b.status === 'failed' || b.status === 'paused' || b.status === 'canceled'
            ? {
                ...b,
                status: 'queued',
                progressPercent: 0,
                errorMessage: undefined,
                retryCount: b.retryCount + 1,
              }
            : b
        ),
      }));
      void get().runBatchQueue();
    },

    refreshVirtualPrinterStatus: async () => {
      try {
        const status = await ipcBridge.getVirtualPrinterStatus();
        set({ virtualPrinterStatus: status });
      } catch {
        // Ignore if unavailable outside desktop shell
      }
    },

    updateVirtualPrinterConfig: async (patch) => {
      set({ virtualPrinterBusy: true });
      try {
        const nextStatus = await ipcBridge.updateVirtualPrinterConfig(patch);
        set({ virtualPrinterStatus: nextStatus });
        const printers = get().printers;
        const matchVp = printers.find(
          (p) =>
            p.name.toLowerCase() ===
            nextStatus.config.printerName.toLowerCase()
        );
        if (matchVp) {
          set({
            printers: printers.map((p) =>
              p.name === matchVp.name
                ? {
                    ...p,
                    activeProfile: {
                      ...p.activeProfile,
                      paperSize: nextStatus.config.paperSize,
                      paperName:
                        nextStatus.config.paperSize !== 'Custom'
                          ? nextStatus.config.paperSize
                          : p.activeProfile.paperName,
                      paperWidthMm: nextStatus.config.paperWidthMm,
                      paperHeightMm: nextStatus.config.paperHeightMm,
                      orientation: nextStatus.config.orientation,
                      dpi: nextStatus.config.dpi,
                    },
                  }
                : p
            ),
          });
        }
      } finally {
        set({ virtualPrinterBusy: false });
      }
    },

    installVirtualPrinter: async () => {
      const isFa = get().settings.language === 'fa';
      set({ virtualPrinterBusy: true });
      try {
        const nextStatus = await ipcBridge.installVirtualPrinter();
        set({ virtualPrinterStatus: nextStatus });
        if (nextStatus.installedInWindows) {
          await get().retryPrinters();
          get().addToast({
            type: 'success',
            title: isFa
              ? `پرینتر مجازی «${nextStatus.config.printerName}» در ویندوز نصب شد`
              : `Installed "${nextStatus.config.printerName}" in Windows`,
            message: isFa
              ? 'اکنون از هر برنامه ویندوز می‌توانید روی این پرینتر چاپ بگیرید تا خودکار وارد PrintStudio Pro شود.'
              : 'You can now print from any Windows app to this printer to import directly into PrintStudio Pro.',
          });
        } else if (nextStatus.lastError) {
          get().addToast({
            type: 'error',
            title: isFa ? 'نصب پرینتر مجازی ناموفق بود' : 'Virtual Printer installation failed',
            message: nextStatus.lastError,
          });
        }
      } catch (err) {
        get().addToast({
          type: 'error',
          title: isFa ? 'نصب پرینتر مجازی ناموفق بود' : 'Virtual Printer installation failed',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        set({ virtualPrinterBusy: false });
      }
    },

    uninstallVirtualPrinter: async () => {
      const isFa = get().settings.language === 'fa';
      set({ virtualPrinterBusy: true });
      try {
        const nextStatus = await ipcBridge.uninstallVirtualPrinter();
        set({ virtualPrinterStatus: nextStatus });
        await get().retryPrinters();
        get().addToast({
          type: 'info',
          title: isFa
            ? 'پرینتر مجازی از ویندوز حذف شد'
            : 'Windows Virtual Printer uninstalled',
        });
      } catch (err) {
        get().addToast({
          type: 'error',
          title: isFa ? 'حذف پرینتر مجازی ناموفق بود' : 'Virtual Printer uninstall failed',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        set({ virtualPrinterBusy: false });
      }
    },

    handleIncomingVirtualPrinterJob: async (payload) => {
      if (!payload?.bytes || payload.bytes.byteLength === 0) return;
      const state = get();
      const isFa = state.settings.language === 'fa';
      const cfg = state.virtualPrinterStatus?.config;

      set((s) => ({
        virtualPrinterStatus: s.virtualPrinterStatus
          ? {
              ...s.virtualPrinterStatus,
              recentJobs: [payload.job, ...s.virtualPrinterStatus.recentJobs].slice(0, 25),
            }
          : s.virtualPrinterStatus,
      }));

      if (cfg && !cfg.autoImportToStudio) {
        state.addToast({
          type: 'info',
          title: isFa
            ? `فایل «${payload.fileName}» از پرینتر مجازی دریافت شد`
            : `Captured "${payload.fileName}" from Virtual Printer`,
        });
        return;
      }

      const rawCopy = new Uint8Array(payload.bytes.byteLength);
      rawCopy.set(payload.bytes);
      const file = new File([rawCopy], payload.fileName, {
        type: payload.mimeType || 'application/pdf',
      });
      if (typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== 'function') {
        Object.defineProperty(file, 'arrayBuffer', {
          value: async () =>
            rawCopy.buffer.slice(rawCopy.byteOffset, rawCopy.byteOffset + rawCopy.byteLength),
        });
      }

      await state.importFiles([file]);

      if (cfg?.switchToStudioOnReceive ?? true) {
        set({ appMode: 'studio' });
      }

      state.addToast({
        type: 'success',
        title: isFa
          ? `فایل «${payload.fileName}» از پرینتر مجازی وارد استودیو شد`
          : `Added "${payload.fileName}" from Virtual Printer to workspace`,
        message: isFa
          ? `${payload.job.paperSize} • ${payload.job.orientation === 'landscape' ? 'افقی' : 'عمودی'} • ${payload.job.dpi} DPI`
          : `${payload.job.paperSize} · ${payload.job.orientation} · ${payload.job.dpi} DPI`,
      });
    },

    setActiveRibbonTab: (tab) => set({ activeRibbonTab: tab, workspaceDrawer: null }),
    setRibbonCollapsed: (collapsed) => set({ ribbonCollapsed: collapsed }),
    setActiveInspectorTool: (tool) =>
      set((state) => {
        const nextRibbon: Partial<AppState> =
          tool === 'file' ||
          tool === 'layout' ||
          tool === 'effects' ||
          tool === 'crop' ||
          tool === 'pdf' ||
          tool === 'batch' ||
          tool === 'printers' ||
          tool === 'view'
            ? { activeRibbonTab: tool, workspaceDrawer: null, ribbonCollapsed: false }
            : tool === 'margins'
              ? { activeRibbonTab: 'layout', workspaceDrawer: null, ribbonCollapsed: false }
              : {};
        let nextSelectedOverlayId = state.selectedOverlayId;
        if (tool === 'text' || tool === 'numbering' || tool === 'image' || tool === 'shape') {
          const current = state.overlays.find((o) => o.id === state.selectedOverlayId);
          if (!current || current.kind !== tool) {
            const firstMatch = state.overlays.find((o) => o.kind === tool);
            if (firstMatch) nextSelectedOverlayId = firstMatch.id;
          }
        }
        return {
          ...nextRibbon,
          activeInspectorTool: tool,
          inspectorCollapsed: false,
          selectedOverlayId: nextSelectedOverlayId,
        };
      }),
    setInspectorCollapsed: (collapsed) => set({ inspectorCollapsed: collapsed }),
    setCanvasTool: (tool) => set({ canvasTool: tool }),
    setShowPreflight: (show) => set({ showPreflight: show }),
    triggerFitPage: () => set((state) => ({ fitPageNonce: state.fitPageNonce + 1 })),
    setWorkspaceDrawer: (drawer) => set({ workspaceDrawer: drawer }),
    setSidebarTab: (tab) => set({ sidebarTab: tab }),
    setSidebarWidthPx: (widthPx) => {
      if (!Number.isFinite(widthPx)) return;
      const clamped = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.round(widthPx)));
      writeStoredNumber('printstudio:sidebar-width-px', clamped);
      set({ sidebarWidthPx: clamped });
    },
    setSidebarThumbnailSizePx: (sizePx) => {
      if (!Number.isFinite(sizePx)) return;
      const clamped = Math.max(THUMB_SIZE_MIN, Math.min(THUMB_SIZE_MAX, Math.round(sizePx)));
      writeStoredNumber('printstudio:sidebar-thumb-px', clamped);
      set({ sidebarThumbnailSizePx: clamped });
    },
    setActiveSheetIndex: (idx) => set({ activeSheetIndex: Math.max(0, idx) }),
    setZoomPercent: (zoom) =>
      set({ zoomPercent: Math.max(5, Math.min(400, Math.round(zoom))) }),
    setViewMode: (mode) => set({ viewMode: mode }),
    setShowRulers: (show) => set({ showRulers: show }),
    setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
    setSmartGuidesEnabled: (enabled) => set({ smartGuidesEnabled: enabled }),
    setLoupeEnabled: (enabled) => set({ loupeEnabled: enabled }),
    setTransparentMode: (enabled) => set({ transparentMode: enabled }),

    setModalState: (modal, open) => {
      if (modal === 'counter') set({ showCounterModal: open });
      if (modal === 'print') set({ showPrintModal: open });
      if (modal === 'settings') set({ showSettingsModal: open });
      if (modal === 'manualDuplex') set({ showManualDuplexModal: open });
      if (modal === 'split') set({ showSplitModal: open });
      if (modal === 'pageSetup') set({ showPageSetupModal: open });
      if (modal === 'tour') set({ showOnboardingTour: open });
      if (modal === 'shortcuts') set({ showShortcutsModal: open });
    },
    openPageSetup: (tab = 'margins') => {
      set({ pageSetupInitialTab: tab, showPageSetupModal: true });
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
      const maxHardwareMargin = margins ? Math.max(margins.top, margins.right, margins.bottom, margins.left) : 0;
      const plausibleHardware =
        result.status !== 'available' ||
        result.source !== 'hardware' ||
        maxHardwareMargin === 0 ||
        maxHardwareMargin >= 0.5;
      const valid =
        margins &&
        plausibleHardware &&
        [margins.top, margins.right, margins.bottom, margins.left].every(
          (v) => Number.isFinite(v) && v >= 0
        ) &&
        margins.left + margins.right < request.widthMm &&
        margins.top + margins.bottom < request.heightMm;
      const safe: PrinterMarginResult =
        result.status === 'available' && !valid
          ? { status: 'unavailable', reason: plausibleHardware ? 'Invalid printer margins' : 'Driver reported implausibly small non-zero hardware margins' }
          : result;
      const activePrinter = current.printers.find((p) => p.name === current.selectedPrinterName);
      const minMargins = resolvePrinterMinMargins(safe, activePrinter);
      useAppStore.setState({
        printerMargins: safe,
        ...(safe.status === 'available'
          ? {
              layout: {
                ...current.layout,
                marginsMm: current.layout.marginMode === 'printer'
                  ? { ...(minMargins ?? safe.marginsMm) }
                  : clampMarginsToMin(current.layout.marginsMm, minMargins),
              },
            }
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

