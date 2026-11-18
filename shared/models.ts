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

/** Non-printing ruler guides measured from the left or top edge of the output sheet. */
export interface RulerGuide { id: string; axis: 'x' | 'y'; positionMm: number }

export interface BookletSettings {
  enabled: boolean;
  direction: 'ltr' | 'rtl';
  /** 0 means one signature containing all pages; otherwise a fixed multiple of four. */
  signatureSize: 0 | 4 | 8 | 12 | 16 | 24 | 32;
  spineWidthMm: number;
  creepMm: number;
  duplexMode: 'long-edge' | 'short-edge';
  outerMarginMm: number;
  compensateCreep: boolean;
}

export interface LayoutSettings {
  /** Optional for compatibility with older saved projects and profiles. */
  booklet?: BookletSettings;
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
  /** Shared workspace guides; positions are in millimetres and never affect output. */
  rulerGuides?: RulerGuide[];
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
  marginsMm?: MarginsMm;
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

export interface PrinterPaperOption {
  id: PaperSizeId;
  /** Exact Windows driver paper name, e.g. "A4", "A3", "SRA3", "Letter" */
  name: string;
  widthMm: number;
  heightMm: number;
  rawKind?: number;
}

export interface PrinterCapabilities {
  supportedPapers: PaperSizeId[];
  /** Full driver-reported paper entries including exact driver names and mm dimensions. */
  paperOptions?: PrinterPaperOption[];
  supportedTrays: string[];
  supportedMediaTypes: string[];
  supportsDuplex: boolean;
  supportsColor: boolean;
  supportedDpi: number[];
  maxCopies: number;
  supportsCollate?: boolean;
  supportsStaple?: boolean;
  supportedStapleModes?: string[];
  supportedHolePunchModes?: string[];
  supportedFoldModes?: string[];
  supportedOutputBins?: string[];
  supportedQualities?: Array<'draft' | 'normal' | 'high'>;
  supportsBorderless?: boolean;
}

export interface PrinterProfileSettings {
  printerName: string;
  paperSize: PaperSizeId;
  /** Exact driver paper name when available (e.g. "A4", "SRA3", "Letter"). */
  paperName?: string;
  tray: string;
  mediaType: string;
  duplexMode: DuplexMode;
  orientation: PageOrientation;
  colorMode: 'color' | 'grayscale' | 'monochrome';
  dpi: number;
  quality: 'draft' | 'normal' | 'high';
  /** Physical media dimensions reported by the selected Windows printer driver. */
  paperWidthMm?: number;
  paperHeightMm?: number;
  collate?: boolean;
  staple?: string;
  outputBin?: string;
  holePunch?: string;
  fold?: string;
  borderless?: boolean;
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
  paperSize?: PaperSizeId;
  paperName?: string;
  paperWidthMm?: number;
  paperHeightMm?: number;
  orientation?: PageOrientation;
  mediaType?: string;
  quality?: 'draft' | 'normal' | 'high';
  staple?: string;
  outputBin?: string;
  holePunch?: string;
  fold?: string;
  borderless?: boolean;
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
  /**
   * How the sheet preview paints a page. `fast` reuses the bitmap made at import, which is cheap but
   * blurry for vector artwork as soon as the operator zooms in; `crisp` re-renders the page from the
   * file's own drawing instructions at the size it is displayed.
   */
  previewFidelity: PreviewFidelity;
}

/** `fast` = stored bitmap only, `crisp` = render the source page at display resolution. */
export type PreviewFidelity = 'fast' | 'crisp';

/**
 * A named, reusable snapshot of the **sheet** settings: what happens to the pages — imposition and
 * placement, colour and effects, watermark, page numbering.
 *
 * The application's own settings (language, unit, calendar, operator name, tariffs, cache and preview
 * fidelity) are deliberately *not* part of a profile. A profile is a press setup you hand to a
 * colleague or switch to ten times a day; the machine's preferences are not, and folding them in made
 * applying a profile change things the operator was not asking to change.
 *
 * `shortcut` is a canonical key chord (`Alt+F7`…`Alt+F12`, or `Ctrl+Alt` with one letter or digit —
 * see `isAssignableShortcut` below), empty when the profile has none. `id` is stable across renames, and the reserved `SHEET_DEFAULT_PRESET_ID` below is a
 * profile that is never stored: it *is* the reset-to-defaults action.
 */
export interface SettingsPreset {
  id: string;
  name: string;
  shortcut: string;
  createdAt: string;
  updatedAt: string;
  layout: LayoutSettings;
  effects: EffectsSettings;
  watermark: WatermarkSettings;
  pageNumbering: PageNumberSettings;
}

/** The built-in "back to the shipped defaults" entry; applying it resets every section, sheet and app. */
export const SHEET_DEFAULT_PRESET_ID = 'preset:defaults';
/** The chord that entry answers to — fixed, and never assignable to a stored profile. */
export const SHEET_DEFAULT_PRESET_SHORTCUT = 'Alt+F6';

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

/** Overlay coordinates are percentages of the output sheet, imposed cell, or source-page box. */
export type OverlayScope = 'current' | 'all' | 'even' | 'odd' | 'first' | 'last' | 'selected' | 'document' | 'selected-documents';
export type OverlayTarget = 'page' | 'cell' | 'sheet';
/** `badge` is a ring: a circle with a reversed circle cut out of the middle. */
export type ShapeType = 'rectangle' | 'square' | 'rounded-rect' | 'circle' | 'line' | 'arrow' | 'triangle' | 'polygon' | 'star' | 'diamond' | 'badge';
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
  /** Keeps the visual width/height ratio while resizing. Shift always locks temporarily. */
  lockAspect?: boolean;
  /** One-based output side indexes captured by a sheet-targeted `selected` scope. */
  targetSheetIndices?: number[];
}
export interface TextScriptRange { start: number; end: number; script: 'super' | 'sub' }
export interface PageOverlayText extends OverlayBase {
  kind: 'text'; text: string; fontSize: number; fontFamily: string; color: string;
  backgroundColor?: string; bold: boolean; italic: boolean; underline: boolean;
  align: 'right' | 'center' | 'left'; syncGroupId?: string;
  /** Numbering overlays use vertical centring and a small safe inset inside their box. */
  verticalAlign?: 'top' | 'middle';
  /** Document scopes use stable document IDs; ranges use UTF-16 offsets. */
  targetDocumentIds?: string[];
  /** Additional coverage is independent of the base scope and can be disabled. */
  coverageMode?: 'all' | 'selected';
  coveragePageIds?: string[];
  /** One-based output side indices, for sheet-targeted text. */
  coverageSheetIndices?: number[];
  scriptRanges?: TextScriptRange[];
  /** Line height multiplier and extra word/letter spacing in points. */
  lineHeight?: number; wordSpacingPt?: number; letterSpacingPt?: number;
}
/** How the ends of an open stroke are cut; a filled outline ignores it. */
export type ShapeLineCap = 'butt' | 'round' | 'square';
/**
 * A drawn outline — a box, a circle, a rule, an arrow. The geometry is derived from these numbers by
 * `app/src/engine/shapes.ts`, which is the only place a shape's outline is described, so the preview,
 * the rasteriser and the exported PDF cannot disagree about what the operator drew.
 *
 * Lengths are physical, not relative: `strokeWidth` in points and `borderRadius` in millimetres, so a
 * 1 pt hairline stays a 1 pt hairline when the box is dragged bigger. Colours are `#rrggbb`, `#rgb` or
 * `transparent` (nothing else is accepted, because the preview paints the shape as SVG).
 */
export interface PageOverlayShape extends OverlayBase {
  kind: 'shape'; type: ShapeType; fillColor: string; strokeColor: string;
  strokeWidth: number; strokeStyle: 'solid' | 'dashed' | 'dotted'; borderRadius: number;
  /** Vertices of a `polygon`, points of a `star` (3–16); defaults 6 and 5. */
  sides?: number;
  /** How deep a `star`'s waist sits, as a percent of its radius (10–95). */
  innerRadiusPercent?: number;
  lineCap?: ShapeLineCap;
}
export interface PageOverlayNumbering extends OverlayBase {
  kind: 'numbering'; enabled: boolean; fontSize: number; fontFamily: string; color: string;
  backgroundColor?: string; bold: boolean; italic: boolean;
  format: NumberingNumberFormat; template: string; startOffset: number; padZeros: number; customScript: string;
  align?: 'left' | 'center' | 'right';
}
/**
 * One erase gesture on a picture, in **percent of the piece of the box the picture actually paints** (its
 * fit rectangle) — the same space the preview masks and the exporter cuts, so a hole stays on the artwork
 * when the box is moved, resized or letterboxed.
 *
 * It is stored as geometry, not as a rasterised copy of the file: the original bytes stay intact, an erased
 * picture can be erased further or restored completely, and the project file stays small. A brush is a list
 * of points with a physical radius (millimetres, so the brush feels the same size whatever the zoom); a
 * region is the marquee rectangle itself.
 */
export interface EraseBrushStroke { mode: 'brush'; radiusMm: number; points: { x: number; y: number }[] }
export interface EraseRegion { mode: 'region'; x: number; y: number; width: number; height: number }
export type EraseShape = EraseBrushStroke | EraseRegion;

/** The most erase gestures one picture may carry, and the most points one brush stroke may carry. */
export const ERASE_SHAPE_LIMIT = 240;
export const ERASE_POINT_LIMIT = 900;

export interface PageOverlayImage extends OverlayBase {
  kind: 'image';
  /** data: URL of the picture; kept inside the project file so the overlay survives reloading. */
  src: string;
  /** Original file name, shown in the layer list and aria label. */
  name: string;
  /** Natural pixel size; zero when it could not be measured. */
  naturalWidth: number; naturalHeight: number;
  /** 'fill' stretches into the box, 'contain' letterboxes it inside the box. */
  fit?: 'fill' | 'contain';
  /** Mirrors the picture without touching the box geometry. */
  flipHorizontal?: boolean; flipVertical?: boolean;
  /**
   * Negates the picture's colours. A flag, never a rewrite of the pixels, so pressing the button again
   * is the way back — an "invert" that baked the file would leave the operator holding a double inversion
   * they cannot undo without reloading the artwork.
   */
  invert?: boolean;
  /** Holes punched into the picture by the eraser. Empty or absent means nothing was erased. */
  erase?: EraseShape[];
}
/**
 * Erase gestures a renderer can be handed. Percentages are kept inside a generous band (a hole may start
 * outside the box and cross it, but `-9000` is a corrupted file, not a stroke), the brush radius is a real
 * millimetre size, and a stroke without points or a region without size is dropped rather than drawn.
 */
export function sanitizeEraseShapes(raw: unknown): EraseShape[] {
  if (!Array.isArray(raw)) return [];
  const within = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(-200, Math.min(300, value)) : 0);
  const out: EraseShape[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Record<string, unknown>;
    if (source.mode === 'region') {
      const rawWidth = typeof source.width === 'number' && Number.isFinite(source.width) ? source.width : 0;
      const rawHeight = typeof source.height === 'number' && Number.isFinite(source.height) ? source.height : 0;
      const width = Math.max(0, Math.min(500, rawWidth)), height = Math.max(0, Math.min(500, rawHeight));
      if (width < 0.01 || height < 0.01) continue;
      out.push({ mode: 'region', x: within(source.x), y: within(source.y), width, height });
      continue;
    }
    if (source.mode === 'brush') {
      const rawPoints = Array.isArray(source.points) ? source.points : [];
      const radiusMm = typeof source.radiusMm === 'number' && Number.isFinite(source.radiusMm)
        ? Math.max(0.05, Math.min(500, Math.abs(source.radiusMm))) : 2;
      const points: { x: number; y: number }[] = [];
      for (const point of rawPoints) {
        if (!point || typeof point !== 'object') continue;
        const p = point as Record<string, unknown>;
        if (typeof p.x !== 'number' || typeof p.y !== 'number') continue;
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        points.push({ x: within(p.x), y: within(p.y) });
        if (points.length >= ERASE_POINT_LIMIT) break;
      }
      if (!points.length) continue;
      out.push({ mode: 'brush', radiusMm, points });
    }
    if (out.length >= ERASE_SHAPE_LIMIT) break;
  }
  return out;
}

export type PageOverlay = PageOverlayText | PageOverlayShape | PageOverlayNumbering | PageOverlayImage;

/**
 * Cleans Windows GDI / DEVMODE / WinSpool strings by truncating at the first
 * embedded NUL character (where drivers leave uninitialized heap bytes) and
 * stripping control characters, replacement glyphs, private-use glyphs, and
 * unpaired UTF-16 surrogates.
 */
export function sanitizeDriverText(value?: string | null): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  const nullIndex = value.indexOf('\u0000');
  const beforeNull = nullIndex >= 0 ? value.slice(0, nullIndex) : value;
  let cleaned = '';
  for (let i = 0; i < beforeNull.length; i++) {
    const code = beforeNull.charCodeAt(i);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0xfffd ||
      (code >= 0xe000 && code <= 0xf8ff)
    ) {
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < beforeNull.length ? beforeNull.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        cleaned += beforeNull[i] + beforeNull[i + 1];
        i++;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }
    cleaned += beforeNull[i];
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

export function sanitizePrinterInfo(printer: PrinterInfo): PrinterInfo {
  const cleanList = (items: string[] | undefined, fallback: string[] = []): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of items ?? []) {
      const text = sanitizeDriverText(raw);
      if (!text) continue;
      const key = text.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(text);
      }
    }
    return out.length > 0 ? out : fallback;
  };

  const paperOptions = printer.capabilities.paperOptions
    ?.map((opt) => ({
      ...opt,
      name: sanitizeDriverText(opt.name) || opt.id,
    }))
    .filter((opt) => Boolean(opt.name));

  const name = sanitizeDriverText(printer.name) || printer.name;
  const supportedTrays = cleanList(printer.capabilities.supportedTrays, ['Auto Select']);
  const supportedMediaTypes = cleanList(printer.capabilities.supportedMediaTypes, ['Plain Paper']);

  const cleanTray = sanitizeDriverText(printer.activeProfile.tray);
  const cleanMedia = sanitizeDriverText(printer.activeProfile.mediaType);
  const cleanPaperName = sanitizeDriverText(printer.activeProfile.paperName);
  const cleanStaple = sanitizeDriverText(printer.activeProfile.staple);
  const cleanOutputBin = sanitizeDriverText(printer.activeProfile.outputBin);
  const cleanHolePunch = sanitizeDriverText(printer.activeProfile.holePunch);
  const cleanFold = sanitizeDriverText(printer.activeProfile.fold);

  return {
    ...printer,
    name,
    driverName: sanitizeDriverText(printer.driverName) || 'Windows Printer Driver',
    portName: sanitizeDriverText(printer.portName) || 'LOCAL',
    location: sanitizeDriverText(printer.location) || undefined,
    capabilities: {
      ...printer.capabilities,
      ...(paperOptions ? { paperOptions } : {}),
      supportedTrays,
      supportedMediaTypes,
      ...(printer.capabilities.supportedStapleModes
        ? { supportedStapleModes: cleanList(printer.capabilities.supportedStapleModes) }
        : {}),
      ...(printer.capabilities.supportedHolePunchModes
        ? { supportedHolePunchModes: cleanList(printer.capabilities.supportedHolePunchModes) }
        : {}),
      ...(printer.capabilities.supportedFoldModes
        ? { supportedFoldModes: cleanList(printer.capabilities.supportedFoldModes) }
        : {}),
      ...(printer.capabilities.supportedOutputBins
        ? { supportedOutputBins: cleanList(printer.capabilities.supportedOutputBins) }
        : {}),
    },
    activeProfile: {
      ...printer.activeProfile,
      printerName: name,
      paperName: cleanPaperName || printer.activeProfile.paperSize,
      tray: cleanTray || supportedTrays[0] || 'Auto Select',
      mediaType: cleanMedia || supportedMediaTypes[0] || 'Plain Paper',
      ...(cleanStaple ? { staple: cleanStaple } : { staple: undefined }),
      ...(cleanOutputBin ? { outputBin: cleanOutputBin } : { outputBin: undefined }),
      ...(cleanHolePunch ? { holePunch: cleanHolePunch } : { holePunch: undefined }),
      ...(cleanFold ? { fold: cleanFold } : { fold: undefined }),
    },
  };
}

/**
 * Settings and presets come back from disk (`settings.json`, `presets.json`) or from localStorage,
 * where a hand edit or an older version of the app can leave anything at all. These readers keep the
 * keys whose value is actually possible, and drop the rest, so a corrupted file costs the operator one
 * default value rather than a crash on the next render. The caller merges the result over its own
 * defaults, which is why the return type is a `Partial`.
 */
export function sanitizeAppSettings(raw: unknown): Partial<AppSettings> {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const out: Partial<AppSettings> = {};
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value);
  const num = (value: unknown, min: number, max: number): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;
  const text = (value: unknown, maxLength = 400): string | null =>
    typeof value === 'string' ? sanitizeDriverText(value).slice(0, maxLength) : null;

  if (oneOf(source.language, ['fa', 'en'] as const)) out.language = source.language;
  if (oneOf(source.theme, ['dark', 'light', 'system'] as const)) out.theme = source.theme;
  if (oneOf(source.unit, ['mm', 'cm', 'inch'] as const)) out.unit = source.unit;
  if (oneOf(source.calendar, ['shamsi', 'gregorian'] as const)) out.calendar = source.calendar;
  if (oneOf(source.previewFidelity, ['fast', 'crisp'] as const)) out.previewFidelity = source.previewFidelity;
  const userName = text(source.userName, 120); if (userName !== null) out.userName = userName;
  const folder = text(source.defaultOutputFolder); if (folder !== null) out.defaultOutputFolder = folder;
  const cache = num(source.maxCachePages, 16, 20000); if (cache !== null) out.maxCachePages = cache;
  const bw = num(source.bwPageTariffRials, 0, 100_000_000); if (bw !== null) out.bwPageTariffRials = bw;
  const color = num(source.colorPageTariffRials, 0, 100_000_000); if (color !== null) out.colorPageTariffRials = color;
  const discount = num(source.duplexDiscountPercent, 0, 95); if (discount !== null) out.duplexDiscountPercent = discount;
  const autoSave = num(source.autoSaveIntervalSec, 0, 3600); if (autoSave !== null) out.autoSaveIntervalSec = autoSave;
  if (typeof source.autoSelectPrinterByPaperAndColor === 'boolean') out.autoSelectPrinterByPaperAndColor = source.autoSelectPrinterByPaperAndColor;
  return out;
}

/**
 * Reads a persisted profile list back. Three things are enforced, because this file can be edited by
 * hand and was written by an older build:
 *
 * - the built-in "defaults" row is never restorable from disk (the store synthesises it, and a file that
 *   could define it could also point the reset chord at anything);
 * - a `settings` block that profiles used to carry is dropped, since a profile is now sheet-only — old
 *   files stay readable but can no longer change the application's own preferences;
 * - the chord is normalised through `sanitizeSettingsShortcut`, so a hand-written or duplicated key
 *   becomes "no shortcut" rather than a chord the app would never have offered.
 */
export function sanitizeSettingsPresetList(raw: unknown): SettingsPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: SettingsPreset[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Record<string, unknown>;
    if (typeof source.id !== 'string' || !source.id || seen.has(source.id)) continue;
    if (typeof source.name !== 'string' || !source.name.trim()) continue;
    seen.add(source.id);
    const section = <T>(value: unknown): T => ((value && typeof value === 'object' ? value : {}) as T);
    const stamp = (value: unknown): string => typeof value === 'string' ? value : '';
    // The profile's own id is the one thing that must not be spoofable: the built-in defaults entry is
    // synthesised by the store and would otherwise be replaceable by a file.
    if (source.id === SHEET_DEFAULT_PRESET_ID) continue;
    out.push({
      id: source.id,
      name: sanitizeDriverText(source.name).slice(0, 120) || source.name,
      // Normalised through the same rules the recorder uses, so a hand-edited file cannot claim a chord
      // the app would never accept (or one that belongs to the browser).
      shortcut: sanitizeSettingsShortcut(source.shortcut),
      createdAt: stamp(source.createdAt),
      updatedAt: stamp(source.updatedAt),
      layout: section<LayoutSettings>(source.layout),
      effects: section<EffectsSettings>(source.effects),
      watermark: section<WatermarkSettings>(source.watermark),
      pageNumbering: section<PageNumberSettings>(source.pageNumbering),
    });
    if (out.length >= 100) break;                     // a preset list is a menu, not a database
  }
  return out;
}

/**
 * Key chords for sheet profiles. The rules live here, next to the persisted type, because the same three
 * questions have to be answered in three places — while recording, when a stored file is read back, and
 * when a keypress is matched against the list — and a divergent answer in any of them is either a dead
 * shortcut or a chord the operator did not intend.
 *
 * Only two families are assignable, and both are deliberate:
 *
 * - `Alt+F7` … `Alt+F12` — function keys are never text input, so the chord works with the caret in a
 *   field, which is exactly what a print-shop operator needs. `F1`…`F6` stay out: help, refresh and the
 *   reset chord live there, and the OS owns some of them.
 * - `Ctrl+Alt+<letter or digit>` — a chord the browser does not already use (`Ctrl+1`…`Ctrl+9` switch
 *   browser tabs, so a bare `Ctrl+digit` profile would be unreachable).
 *
 * Anything else is refused rather than accepted-and-ignored, because a shortcut that silently does
 * nothing is worse than being told to pick another one.
 */
export type KeyEventLike = {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

/** The order the canonical string lists modifiers in, and the only one `formatShortcut` produces. */
const SHORTCUT_MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const FUNCTION_KEYS = ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'] as const;

/** Turns a keypress into `Ctrl+Alt+A` / `Alt+F7`, or `null` when no modifier is involved at all. */
export function formatShortcut(event: KeyEventLike): string | null {
  const raw = event.key;
  if (!raw || raw === 'Unidentified') return null;
  if (raw === 'Control' || raw === 'Alt' || raw === 'Shift' || raw === 'Meta') return null;   // modifier alone
  const mods: string[] = [];
  if (event.ctrlKey) mods.push('Ctrl');
  if (event.altKey) mods.push('Alt');
  if (event.shiftKey) mods.push('Shift');
  if (event.metaKey) mods.push('Meta');
  if (mods.length === 0) return null;
  const functionKey = FUNCTION_KEYS.find(name => name.toLowerCase() === raw.toLowerCase());
  const key = functionKey ?? (raw.length === 1 ? raw.toUpperCase() : raw);
  return `${[...SHORTCUT_MODIFIERS.filter(mod => mods.includes(mod)), key].join('+')}`;
}

/** True when the chord is one a profile may own. `''` and `null` are not chords; they are "no shortcut". */
export function isAssignableShortcut(shortcut: unknown): shortcut is string {
  if (typeof shortcut !== 'string') return false;
  const text = shortcut.trim();
  if (!text) return false;
  const parts = text.split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts);
  if (mods.size === 0 || parts.length !== mods.size) return false;          // dupes or junk
  for (const mod of mods) if (!SHORTCUT_MODIFIERS.includes(mod as typeof SHORTCUT_MODIFIERS[number])) return false;
  const onlyAlt = mods.size === 1 && mods.has('Alt');
  const onlyCtrlAlt = mods.size === 2 && mods.has('Ctrl') && mods.has('Alt');
  if (onlyAlt) {
    const index = FUNCTION_KEYS.indexOf(key as typeof FUNCTION_KEYS[number]);
    return index >= 6 && index <= 11;                                        // F7…F12
  }
  if (onlyCtrlAlt) return key.length === 1 && /[a-z0-9]/i.test(key);
  return false;
}

/** Normalises whatever a file or a recorder produced into the canonical form, or `''` when unusable. */
export function sanitizeSettingsShortcut(shortcut: unknown): string {
  if (typeof shortcut !== 'string') return '';
  const parts = shortcut.trim().split('+').map(part => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return '';
  const mods = parts.map(mod => {
    const lower = mod.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') return 'Ctrl';
    if (lower === 'alt' || lower === 'option') return 'Alt';
    if (lower === 'shift') return 'Shift';
    if (lower === 'meta' || lower === 'cmd' || lower === 'command') return 'Meta';
    return mod;
  });
  const functionKey = FUNCTION_KEYS.find(name => name.toLowerCase() === key.toLowerCase());
  const normalized = [...SHORTCUT_MODIFIERS.filter(mod => mods.includes(mod)), functionKey ?? (key.length === 1 ? key.toUpperCase() : key)].join('+');
  return isAssignableShortcut(normalized) ? normalized : '';
}

/** Does this keypress fire this chord? Exact on modifiers, so `Ctrl+Alt+A` is not `Ctrl+Alt+Shift+A`. */
export function shortcutMatchesEvent(shortcut: string, event: KeyEventLike): boolean {
  const fired = formatShortcut(event);
  return !!fired && fired === shortcut;
}
