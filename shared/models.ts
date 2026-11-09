/**
 * PrintStudio Pro — Shared Data Models & Domain Contracts
 * Used across Renderer (/app), Main Process (/electron), and C# Sidecar (/printer-service)
 */

export type AppLanguage = 'fa' | 'en';
export type ThemeMode = 'dark' | 'light' | 'system';
export type MeasurementUnit = 'mm' | 'cm' | 'inch';
export type CalendarSystem = 'shamsi' | 'gregorian';

export type PaperSizeId =
  | 'A0'
  | 'A1'
  | 'A2'
  | 'A3'
  | 'A4'
  | 'A5'
  | 'A6'
  | 'B4'
  | 'B5'
  | 'Letter'
  | 'Legal'
  | 'Custom';

export type PageOrientation = 'portrait' | 'landscape';
export type PageRotation = 0 | 90 | 180 | 270;

export interface PaperDimensionsMm {
  id: PaperSizeId;
  label: string;
  widthMm: number;
  heightMm: number;
}

export const STANDARD_PAPER_SIZES: Record<Exclude<PaperSizeId, 'Custom'>, PaperDimensionsMm> = {
  A0: { id: 'A0', label: 'ISO A0 (841 × 1189 mm)', widthMm: 841, heightMm: 1189 },
  A1: { id: 'A1', label: 'ISO A1 (594 × 841 mm)', widthMm: 594, heightMm: 841 },
  A2: { id: 'A2', label: 'ISO A2 (420 × 594 mm)', widthMm: 420, heightMm: 594 },
  A3: { id: 'A3', label: 'ISO A3 (297 × 420 mm)', widthMm: 297, heightMm: 420 },
  A4: { id: 'A4', label: 'ISO A4 (210 × 297 mm)', widthMm: 210, heightMm: 297 },
  A5: { id: 'A5', label: 'ISO A5 (148 × 210 mm)', widthMm: 148, heightMm: 210 },
  A6: { id: 'A6', label: 'ISO A6 (105 × 148 mm)', widthMm: 105, heightMm: 148 },
  B4: { id: 'B4', label: 'JIS B4 (250 × 353 mm)', widthMm: 250, heightMm: 353 },
  B5: { id: 'B5', label: 'JIS B5 (176 × 250 mm)', widthMm: 176, heightMm: 250 },
  Letter: { id: 'Letter', label: 'US Letter (215.9 × 279.4 mm)', widthMm: 215.9, heightMm: 279.4 },
  Legal: { id: 'Legal', label: 'US Legal (215.9 × 355.6 mm)', widthMm: 215.9, heightMm: 355.6 },
};

export type SupportedFileType = 'pdf' | 'image';

export interface SourceDocument {
  id: string;
  name: string;
  filePath: string;
  fileSize: number;
  fileType: SupportedFileType;
  mimeType: string;
  pageCount: number;
  createdAt: string;
  collapsed?: boolean;
  /** Raw bytes in memory or indexed cache key */
  rawBytes?: Uint8Array;
}

export interface PageTransform {
  x: number; y: number; scaleX: number; scaleY: number;
  /** Additional clockwise rotation of this occurrence around its center, in degrees. */
  rotationDeg?: number;
}
export interface CellOverride { pageId: string; transform?: PageTransform; zIndex?: number; allowOverflow?: boolean }

export interface PagePerPageOverrides {
  invert?: boolean;
  grayscale?: boolean;
  threshold?: boolean;
  /** Keep an explicitly chosen page rotation from being overridden by auto-fit. */
  manualRotation?: boolean;
  cropBoxMm?: { top: number; right: number; bottom: number; left: number };
  /** Relative to the cell: offsets in cell fractions and independent size multipliers. */
  transform?: PageTransform;
}

export interface PageItem {
  id: string;
  documentId: string;
  documentName: string;
  /** 1-based page index inside the source document */
  sourcePageNumber: number;
  /** Width in millimeters */
  widthMm: number;
  /** Height in millimeters */
  heightMm: number;
  /** Rotation in degrees (0, 90, 180, 270) */
  rotation: PageRotation;
  /** Selected for printing / merging */
  selectedForPrint: boolean;
  /** UI selection state for multi-select operations */
  isHighlighted: boolean;
  /** Blank page inserted by user */
  isBlankPage: boolean;
  /** Color analysis classification */
  colorProfile: 'color' | 'grayscale' | 'blank';
  /** Estimated ink coverage 0..100% */
  inkCoveragePercent: number;
  /** Data URL of rendered thumbnail or SVG preview */
  thumbnailDataUrl?: string;
  /** High-res preview or text lines for rich simulation */
  previewLines?: string[];
  previewAccentColor?: string;
  /** Optional per-page overrides (e.g. single page invert) */
  overrides?: PagePerPageOverrides;
}

export interface BookmarkItem {
  id: string;
  title: string;
  documentId: string;
  targetPageId: string;
  pageIndex: number;
  level: number;
}

/**
 * D) Page Layout / Imposition Models (D1 - D5)
 */
export type PlacementMode = 'sequential' | 'step-and-repeat';
export type ScaleMode = 'fit' | 'fill' | 'original' | 'custom';
export type DuplexMode = 'none' | 'long-edge' | 'short-edge';
export type SheetOrderMode = 'ltr' | 'rtl' | 'column' | 'spiral';
export type CellAlignment =
  | 'center'
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface MarginsMm {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LayoutSettings {
  paperSize: PaperSizeId;
  customWidthMm: number;
  customHeightMm: number;
  orientation: PageOrientation;
  /** Grid rows (1..10) */
  rows: number;
  /** Grid columns (1..10) */
  cols: number;
  /** D2: 'sequential' = each page in a cell, 'step-and-repeat' = repeat each page across all cells on sheet */
  placementMode: PlacementMode;
  /** D2: Use identical minimum scale factor across all cells on a sheet */
  uniqueScale: boolean;
  /** D3: Outer sheet margins in mm */
  marginsMm: MarginsMm;
  /** Printer defaults follow the selected printer/paper; custom margins are preserved. */
  marginMode?: 'printer' | 'custom';
  /** D3: Horizontal spacing between cells in mm */
  horizontalGutterMm: number;
  /** D3: Vertical spacing between cells in mm */
  verticalGutterMm: number;
  /** Per-occurrence transforms and layer order, keyed by page and matrix occurrence. */
  cellOverrides?: Record<string, CellOverride>;
  /** D3: Scale mode */
  scaleMode: ScaleMode;
  /** Custom scale percentage (10..400) */
  customScalePercent: number;
  /** D3: Cell alignment */
  alignment: CellAlignment;
  /** D3: Automatically rotate page inside cell to maximize fit */
  autoRotateToFit: boolean;
  /** D5: Duplex mode */
  duplexMode: DuplexMode;
  /** D5: Reading / cell filling order */
  sheetOrder: SheetOrderMode;
  /** D5: Manual duplex (2-pass printing with 3D flip guide) */
  manualDuplex: boolean;
  /** D8 / Preview helper: Draw cell borders and crop marks */
  showCellBorders: boolean;
  showCropMarks: boolean;
}

export interface ComputedCellPlacement {
  cellIndex: number;
  row: number;
  col: number;
  page: PageItem | null;
  globalPageNumber: number | null;
  /** Cell bounding box on the sheet in mm */
  cellXMm: number;
  cellYMm: number;
  cellWidthMm: number;
  cellHeightMm: number;
  /** Content bounding box inside the cell in mm */
  contentXMm: number;
  contentYMm: number;
  contentWidthMm: number;
  contentHeightMm: number;
  scaleFactor: number;
  effectiveRotation: PageRotation;
  occurrenceKey?: string;
  transform?: PageTransform;
  zIndex?: number;
  allowOverflow?: boolean;
}

export interface ComputedSheetSide {
  sheetNumber: number;
  side: 'front' | 'back';
  sideIndex: number; // 1-based sheet side index
  widthMm: number;
  heightMm: number;
  cells: ComputedCellPlacement[];
}

/**
 * E) Effects & Filters Pipeline Models (E1 - E2)
 */
export type EffectScope = 'all' | 'selected';

export interface EffectsSettings {
  enabled: boolean;
  scope: EffectScope;
  /** E1: Invert colors (Preview via GPU/CSS, Print via Raster, PDF via Vector BlendMode Difference or Raster) */
  invert: boolean;
  /** Vector vs Raster strategy for PDF Export when Invert is active */
  invertPdfStrategy: 'vector-blend' | 'raster';
  /** E2: Grayscale conversion */
  grayscale: boolean;
  /** E2: Black & White threshold (1-bit style) */
  blackAndWhite: boolean;
  /** Threshold 0..255 (default 128) */
  threshold: number;
  /** E2: Force dark gray text to pure 100% K black */
  blackText: boolean;
  /** E2: Brightness -100..+100 (default 0) */
  brightness: number;
  /** E2: Contrast -100..+100 (default 0) */
  contrast: number;
  /** E2: Gamma 0.2..3.0 (default 1.0) */
  gamma: number;
  /** E2: Sharpness 0..100 (default 0) */
  sharpness: number;
}

/**
 * F) Insert: Watermark & Page/Bates Numbering (F1 - F2)
 */
export interface WatermarkSettings {
  enabled: boolean;
  type: 'text' | 'image';
  /** Supports macros: {page}, {pages}, {sheet}, {sheets}, {date}, {shamsi_date}, {file}, {user} */
  text: string;
  imageDataUrl?: string;
  fontFamily: 'Vazirmatn' | 'Inter';
  fontSizePt: number;
  colorHex: string;
  opacity: number; // 0.05 .. 1.0
  rotationDeg: number; // -90 .. +90
  tiled: boolean;
  tileSpacingMm: number;
}

export type PageNumberFormat = 'persian' | 'english' | 'roman' | 'bates';
export type PageNumberPosition =
  | 'bottom-center'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'top-left'
  | 'top-right';

export interface PageNumberSettings {
  enabled: boolean;
  target: 'page' | 'sheet';
  format: PageNumberFormat;
  position: PageNumberPosition;
  startNumber: number;
  batesPrefix: string;
  batesDigits: number;
  fontSizePt: number;
  marginMm: number;
  headerText: string;
  footerText: string;
}

/**
 * B) Counter Summary Models (B1 - B2)
 */
export interface PaperBreakdownItem {
  sizeLabel: string;
  orientation: PageOrientation;
  totalPages: number;
  selectedPages: number;
  colorPages: number;
  bwPages: number;
  blankPages: number;
}

export interface FileCountSummary {
  documentId: string;
  documentName: string;
  fileSize: number;
  totalPages: number;
  selectedPages: number;
  colorPages: number;
  bwPages: number;
  blankPages: number;
}

export interface CounterSummary {
  totalFiles: number;
  totalPages: number;
  selectedPages: number;
  highlightedPages: number;
  colorPages: number;
  bwPages: number;
  blankPages: number;
  /** Total sheet sides (impressions) after N-Up */
  totalImpressions: number;
  /** Total physical paper sheets after N-Up and Duplex */
  totalPhysicalSheets: number;
  cellsPerSheet: number;
  isDuplex: boolean;
  averageInkCoveragePercent: number;
  estimatedCostRials: number;
  byPaperSize: PaperBreakdownItem[];
  byFile: FileCountSummary[];
}

/**
 * I) Printer Management & Spooler Models (I1 - I3)
 */
export type PrinterStatus =
  | 'Ready'
  | 'Printing'
  | 'Paused'
  | 'Offline'
  | 'PaperJam'
  | 'OutOfPaper'
  | 'LowToner'
  | 'DoorOpen'
  | 'Error';

/** Printable-area query for the selected printer and oriented paper size. */
export interface PrinterMarginRequest {
  printerName: string; paperSize: PaperSizeId; orientation: PageOrientation;
  widthMm: number; heightMm: number;
}
export type PrinterMarginResult =
  | { status: 'available'; source: 'hardware' | 'virtual' | 'simulated-virtual'; marginsMm: MarginsMm }
  | { status: 'unavailable'; reason: string };

export interface PrinterCapabilities {
  supportedPapers: PaperSizeId[];
  supportedTrays: string[];
  supportedMediaTypes: string[];
  supportsDuplex: boolean;
  supportsColor: boolean;
  supportedDpi: number[];
  maxCopies: number;
}

export interface PrinterProfileSettings {
  printerName: string;
  paperSize: PaperSizeId;
  tray: string;
  mediaType: string;
  duplexMode: DuplexMode;
  orientation: PageOrientation;
  colorMode: 'color' | 'grayscale' | 'monochrome';
  dpi: number;
  quality: 'draft' | 'normal' | 'high';
}

export interface PrinterInfo {
  name: string;
  driverName: string;
  portName: string;
  isDefault: boolean;
  isNetwork: boolean;
  isVirtual: boolean;
  status: PrinterStatus;
  jobsInQueue: number;
  tonerLevelPercent?: number;
  totalPageCounter?: number;
  location?: string;
  capabilities: PrinterCapabilities;
  activeProfile: PrinterProfileSettings;
}

export type SpoolerJobStatus =
  | 'Spooling'
  | 'Printing'
  | 'Paused'
  | 'Completed'
  | 'Error'
  | 'Canceled';

export interface SpoolerJobInfo {
  jobId: number;
  printerName: string;
  documentTitle: string;
  userName: string;
  status: SpoolerJobStatus;
  totalPages: number;
  pagesPrinted: number;
  sizeBytes: number;
  priority: number; // 1 (lowest) .. 99 (highest)
  submittedAt: string;
}

/**
 * G) Print Dialog & Execution Request (G1 - G2)
 */
export interface PrintJobRequest {
  printerName: string;
  jobTitle: string;
  copies: number;
  collate: boolean;
  pageRangeMode: 'all-selected' | 'current-page' | 'custom-range';
  customRangeText: string; // e.g. "1-5, 8, 11-13"
  oddEvenFilter: 'all' | 'odd' | 'even';
  reverseOrder: boolean;
  duplexMode: DuplexMode;
  scaleMode: 'fit' | 'actual';
  dpi: number;
  colorMode: 'color' | 'bw';
  tray: string;
  silent: boolean;
}

/**
 * H) Batch Print Queue Models (H1 - H2)
 */
export type BatchJobStatus =
  | 'queued'
  | 'processing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface BatchJobItem {
  id: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  printerName: string;
  copies: number;
  nUp: number; // e.g., 1, 2, 4
  duplexMode: DuplexMode;
  invert: boolean;
  status: BatchJobStatus;
  progressPercent: number;
  retryCount: number;
  errorMessage?: string;
  addedAt: string;
  completedAt?: string;
}

/**
 * K) App Settings & .psp Project File (K1)
 */
export interface AppSettings {
  language: AppLanguage;
  theme: ThemeMode;
  unit: MeasurementUnit;
  calendar: CalendarSystem;
  userName: string;
  defaultOutputFolder: string;
  maxCachePages: number;
  bwPageTariffRials: number;
  colorPageTariffRials: number;
  duplexDiscountPercent: number;
  autoSaveIntervalSec: number;
  autoSelectPrinterByPaperAndColor: boolean;
}

export interface PspProjectFile {
  version: '1.0.0';
  savedAt: string;
  appSettings: AppSettings;
  layout: LayoutSettings;
  effects: EffectsSettings;
  watermark: WatermarkSettings;
  pageNumbering: PageNumberSettings;
  /** Optional for backwards compatibility with older projects. */
  overlays?: PageOverlay[];
  documents: Omit<SourceDocument, 'rawBytes'>[];
  pages: PageItem[];
  bookmarks: BookmarkItem[];
}

/** Overlay coordinates are percentages of the selected sheet or source-page box. */
export type OverlayScope = 'current' | 'all' | 'even' | 'odd' | 'first' | 'last' | 'selected';
export type OverlayTarget = 'page' | 'sheet';
export type ShapeType = 'rectangle' | 'rounded-rect' | 'circle' | 'line' | 'arrow' | 'triangle' | 'polygon' | 'star' | 'diamond' | 'badge';
export type NumberingNumberFormat = 'persian' | 'english' | 'roman' | 'abjad';
export interface OverlayBase {
  id: string;
  target: OverlayTarget;
  targetScope: OverlayScope;
  /** Stable page ids captured when applying current/selected. */
  targetPageIds: string[];
  /** One-based side index captured for current sheet. */
  targetSheetIndex: number;
  xPercent: number; yPercent: number; widthPercent: number; heightPercent: number;
  opacity: number; rotation: number;
}
export interface PageOverlayText extends OverlayBase {
  kind: 'text'; text: string; fontSize: number; fontFamily: string; color: string;
  backgroundColor?: string; bold: boolean; italic: boolean; underline: boolean;
  align: 'right' | 'center' | 'left'; syncGroupId?: string;
}
export interface PageOverlayShape extends OverlayBase {
  kind: 'shape'; type: ShapeType; fillColor: string; strokeColor: string;
  strokeWidth: number; strokeStyle: 'solid' | 'dashed' | 'dotted'; borderRadius: number;
}
export interface PageOverlayNumbering extends OverlayBase {
  kind: 'numbering'; enabled: boolean; fontSize: number; fontFamily: string; color: string;
  backgroundColor?: string; bold: boolean; italic: boolean;
  format: NumberingNumberFormat; template: string; startOffset: number; padZeros: number; customScript: string;
}
export type PageOverlay = PageOverlayText | PageOverlayShape | PageOverlayNumbering;
