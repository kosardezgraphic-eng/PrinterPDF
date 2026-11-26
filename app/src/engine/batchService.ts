import type {
  BatchJobItem,
  EffectsSettings,
  LayoutSettings,
  PageItem,
  PageNumberSettings,
  PageOverlay,
  PrinterInfo,
  PrintJobRequest,
  WatermarkSettings,
} from '@shared/models';
import { getDefaultPageNumberSettings, getDefaultWatermarkSettings } from './watermarkEngine';
import { computeImpositionSheets, stripTrailingEmptyDuplexSides } from './layoutEngine';
import { parsePageRangeText } from './pdfService';

export function nUpToRowsCols(nUp: number): { rows: number; cols: number } {
  const safe = Math.max(1, Math.round(nUp || 1));
  if (safe === 1) return { rows: 1, cols: 1 };
  if (safe === 2) return { rows: 1, cols: 2 };
  if (safe === 4) return { rows: 2, cols: 2 };
  if (safe === 6) return { rows: 2, cols: 3 };
  if (safe === 9) return { rows: 3, cols: 3 };
  const cols = Math.ceil(Math.sqrt(safe));
  const rows = Math.ceil(safe / cols);
  return { rows, cols };
}

/**
 * Resolves 1-based page numbers selected for a BatchJobItem after applying
 * custom range ("1-4, 7"), Odd/Even filtering, and Reverse Order.
 */
export function resolveBatchJobPageNumbers(
  job: Pick<
    BatchJobItem,
    'pageCount' | 'pageRangeMode' | 'customRangeText' | 'oddEvenFilter' | 'reverseOrder'
  >
): number[] {
  const total = Math.max(0, Math.floor(job.pageCount || 0));
  if (total <= 0) return [];

  let pageNumbers: number[];
  if (job.pageRangeMode === 'custom' && job.customRangeText?.trim()) {
    pageNumbers = parsePageRangeText(job.customRangeText, total);
  } else {
    pageNumbers = Array.from({ length: total }, (_, idx) => idx + 1);
  }

  if (job.oddEvenFilter === 'odd') {
    pageNumbers = pageNumbers.filter((n) => n % 2 === 1);
  } else if (job.oddEvenFilter === 'even') {
    pageNumbers = pageNumbers.filter((n) => n % 2 === 0);
  }

  if (job.reverseOrder) {
    pageNumbers = pageNumbers.slice().reverse();
  }

  return pageNumbers;
}

export interface BatchJobMetrics {
  selectedPagesCount: number;
  impressionsPerSet: number;
  sheetsPerSet: number;
  totalSheets: number;
}

export function estimateBatchJobMetrics(job: BatchJobItem): BatchJobMetrics {
  const selectedPagesCount = resolveBatchJobPageNumbers(job).length;
  const cells = Math.max(1, job.nUp || 1);
  const impressionsPerSet =
    selectedPagesCount > 0 ? Math.ceil(selectedPagesCount / cells) : 0;
  const isDuplex = Boolean(job.duplexMode && job.duplexMode !== 'none');
  const sheetsPerSet = isDuplex
    ? Math.ceil(impressionsPerSet / 2)
    : impressionsPerSet;
  const copies = Math.max(1, Math.round(job.copies || 1));
  return {
    selectedPagesCount,
    impressionsPerSet,
    sheetsPerSet,
    totalSheets: sheetsPerSet * copies,
  };
}

export interface BatchExecutionPlan {
  targetPages: PageItem[];
  allPages: PageItem[];
  layout: LayoutSettings;
  effects: EffectsSettings;
  watermark: WatermarkSettings;
  pageNumbering: PageNumberSettings;
  overlays: PageOverlay[];
  request: PrintJobRequest;
  estimatedSheetSides: number;
}

const FALLBACK_BASE_LAYOUT: LayoutSettings = {
  paperSize: 'A4',
  customWidthMm: 210,
  customHeightMm: 297,
  orientation: 'portrait',
  rows: 1,
  cols: 1,
  placementMode: 'sequential',
  uniqueScale: true,
  marginsMm: { top: 4, right: 4, bottom: 4, left: 4 },
  marginMode: 'printer',
  horizontalGutterMm: 4,
  verticalGutterMm: 4,
  scaleMode: 'fit',
  customScalePercent: 100,
  alignment: 'center',
  autoRotateToFit: true,
  duplexMode: 'none',
  sheetOrder: 'ltr',
  manualDuplex: false,
  showCellBorders: false,
  showCropMarks: false,
};

const FALLBACK_BASE_EFFECTS: EffectsSettings = {
  enabled: false,
  scope: 'all',
  invert: false,
  invertPdfStrategy: 'vector-blend',
  grayscale: false,
  blackAndWhite: false,
  threshold: 128,
  blackText: false,
  brightness: 0,
  contrast: 0,
  gamma: 1,
  sharpness: 0,
};

export function buildBatchExecutionPlan(
  job: BatchJobItem,
  matchedPrinter: PrinterInfo | undefined,
  fallbackLayout?: LayoutSettings,
  isFa = true
): BatchExecutionPlan {
  if (!job.snapshotDocuments?.length || !job.snapshotPages?.length) {
    throw new Error(
      isFa
        ? `فایل «${job.fileName}» فاقد داده اسنپ‌شات برای ارسال به چاپگر است.`
        : `Batch item "${job.fileName}" has no source document snapshot to print.`
    );
  }

  const pageNumbers = resolveBatchJobPageNumbers({
    pageCount: job.snapshotPages.length,
    pageRangeMode: job.pageRangeMode,
    customRangeText: job.customRangeText,
    oddEvenFilter: job.oddEvenFilter,
    reverseOrder: job.reverseOrder,
  });

  if (pageNumbers.length === 0) {
    throw new Error(
      isFa
        ? `در فایل «${job.fileName}» هیچ صفحه‌ای با بازه انتخاب‌شده مطابقت ندارد.`
        : `No pages in "${job.fileName}" match the selected range.`
    );
  }

  const targetPages: PageItem[] = [];
  for (const num of pageNumbers) {
    const page = job.snapshotPages[num - 1];
    if (page) {
      targetPages.push({ ...page, selectedForPrint: true });
    }
  }

  if (targetPages.length === 0) {
    throw new Error(
      isFa
        ? `هیچ صفحه معتبری در «${job.fileName}» یافت نشد.`
        : `No valid pages found in "${job.fileName}".`
    );
  }

  const followPrinter = job.useGlobalPrinterSettings !== false;
  const hw = matchedPrinter?.activeProfile;

  const effectivePaperSize =
    (followPrinter ? hw?.paperSize : job.paperSize) ??
    job.paperSize ??
    hw?.paperSize ??
    job.snapshotLayout?.paperSize ??
    fallbackLayout?.paperSize ??
    'A4';

  const effectivePaperName =
    (followPrinter ? hw?.paperName : job.paperName) ??
    job.paperName ??
    hw?.paperName ??
    effectivePaperSize;

  const effectiveWidthMm =
    (followPrinter ? hw?.paperWidthMm : job.paperWidthMm) ??
    job.paperWidthMm ??
    hw?.paperWidthMm ??
    job.snapshotLayout?.customWidthMm ??
    210;

  const effectiveHeightMm =
    (followPrinter ? hw?.paperHeightMm : job.paperHeightMm) ??
    job.paperHeightMm ??
    hw?.paperHeightMm ??
    job.snapshotLayout?.customHeightMm ??
    297;

  const effectiveOrientation =
    (followPrinter ? hw?.orientation : job.orientation) ??
    job.orientation ??
    hw?.orientation ??
    job.snapshotLayout?.orientation ??
    'portrait';

  const effectiveDuplex =
    (followPrinter ? hw?.duplexMode ?? job.duplexMode : job.duplexMode) ??
    hw?.duplexMode ??
    'none';

  const effectiveDpi =
    (followPrinter ? hw?.dpi : job.dpi) ??
    job.dpi ??
    hw?.dpi ??
    600;

  const effectiveTray =
    (followPrinter ? hw?.tray : job.tray) ??
    job.tray ??
    hw?.tray ??
    'Auto Select';

  const effectiveMediaType =
    (followPrinter ? hw?.mediaType : job.mediaType) ??
    job.mediaType ??
    hw?.mediaType ??
    'Plain Paper';

  const effectiveQuality =
    (followPrinter ? hw?.quality : job.quality) ??
    job.quality ??
    hw?.quality ??
    'normal';

  const effectiveCollate =
    (followPrinter ? hw?.collate : job.collate) ??
    job.collate ??
    hw?.collate ??
    true;

  const effectiveColorMode: 'color' | 'bw' = (() => {
    if (job.colorMode === 'bw') return 'bw';
    if (followPrinter && hw?.colorMode === 'monochrome') return 'bw';
    if (matchedPrinter && !matchedPrinter.capabilities.supportsColor) return 'bw';
    return job.colorMode ?? 'color';
  })();

  const { rows, cols } = nUpToRowsCols(job.nUp);
  const baseLayout = job.snapshotLayout ?? fallbackLayout ?? FALLBACK_BASE_LAYOUT;

  const layout: LayoutSettings = {
    ...baseLayout,
    paperSize: effectivePaperSize,
    customWidthMm: Math.min(effectiveWidthMm, effectiveHeightMm),
    customHeightMm: Math.max(effectiveWidthMm, effectiveHeightMm),
    orientation: effectiveOrientation,
    rows,
    cols,
    duplexMode: effectiveDuplex,
    scaleMode: job.scaleMode === 'actual' ? 'original' : baseLayout.scaleMode === 'original' && job.scaleMode !== 'fit' ? 'original' : 'fit',
  };

  const baseEffects = job.snapshotEffects ?? FALLBACK_BASE_EFFECTS;
  const effects: EffectsSettings = {
    ...baseEffects,
    enabled:
      baseEffects.enabled ||
      Boolean(job.invert) ||
      effectiveColorMode === 'bw',
    invert: Boolean(job.invert),
    grayscale: baseEffects.grayscale || effectiveColorMode === 'bw',
  };

  const watermark = job.snapshotWatermark ?? getDefaultWatermarkSettings();
  const pageNumbering = job.snapshotPageNumbering ?? getDefaultPageNumberSettings();
  const overlays = job.snapshotOverlays ?? [];

  const rawSheets = computeImpositionSheets(targetPages, layout);
  const effectiveDuplexForCount = layout.booklet?.enabled
    ? layout.booklet.duplexMode
    : layout.duplexMode;
  const estimatedSheetSides = Math.max(
    1,
    stripTrailingEmptyDuplexSides(rawSheets, effectiveDuplexForCount).length
  );

  const printerName = job.printerName || matchedPrinter?.name || '';
  const request: PrintJobRequest = {
    printerName,
    jobTitle: job.fileName,
    copies: Math.max(1, Math.min(999, Math.round(job.copies || 1))),
    collate: Boolean(effectiveCollate),
    pageRangeMode: 'all-selected',
    customRangeText: '',
    oddEvenFilter: 'all',
    reverseOrder: false,
    duplexMode: effectiveDuplex,
    scaleMode: job.scaleMode === 'actual' ? 'actual' : 'fit',
    dpi: effectiveDpi,
    colorMode: effectiveColorMode,
    tray: effectiveTray,
    silent: true,
    paperSize: effectivePaperSize,
    paperName: effectivePaperName,
    paperWidthMm: Math.min(effectiveWidthMm, effectiveHeightMm),
    paperHeightMm: Math.max(effectiveWidthMm, effectiveHeightMm),
    orientation: effectiveOrientation,
    mediaType: effectiveMediaType,
    quality: effectiveQuality,
    staple: (followPrinter ? hw?.staple : job.staple) ?? job.staple ?? hw?.staple,
    outputBin:
      (followPrinter ? hw?.outputBin : job.outputBin) ?? job.outputBin ?? hw?.outputBin,
    holePunch:
      (followPrinter ? hw?.holePunch : job.holePunch) ?? job.holePunch ?? hw?.holePunch,
    fold: (followPrinter ? hw?.fold : job.fold) ?? job.fold ?? hw?.fold,
    borderless:
      (followPrinter ? hw?.borderless : job.borderless) ??
      job.borderless ??
      hw?.borderless,
  };

  return {
    targetPages,
    allPages: job.snapshotPages,
    layout,
    effects,
    watermark,
    pageNumbering,
    overlays,
    request,
    estimatedSheetSides,
  };
}
