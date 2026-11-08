/**
 * PrintStudio Pro — Instant & Background Page/Sheet Counter Engine (B1 - B2)
 * Computes files, pages, selected pages, N-Up & Duplex physical sheets,
 * paper size/orientation breakdown, ink coverage, and print cost.
 */

import type {
  AppSettings,
  CounterSummary,
  FileCountSummary,
  LayoutSettings,
  PageItem,
  PaperBreakdownItem,
  SourceDocument,
} from '@shared/models';
import { computeImpositionSheets } from './layoutEngine';

export function classifyPaperSizeLabel(widthMm: number, heightMm: number): string {
  const short = Math.min(widthMm, heightMm);
  const long = Math.max(widthMm, heightMm);

  const match = (w: number, h: number) =>
    Math.abs(short - w) <= 4 && Math.abs(long - h) <= 4;

  if (match(210, 297)) return 'A4';
  if (match(297, 420)) return 'A3';
  if (match(148, 210)) return 'A5';
  if (match(105, 148)) return 'A6';
  if (match(420, 594)) return 'A2';
  if (match(594, 841)) return 'A1';
  if (match(841, 1189)) return 'A0';
  if (match(250, 353)) return 'B4';
  if (match(176, 250)) return 'B5';
  if (match(215.9, 279.4)) return 'Letter';
  if (match(215.9, 355.6)) return 'Legal';
  return `${Math.round(short)}×${Math.round(long)} mm`;
}

export function computeCounterSummary(
  documents: SourceDocument[],
  pages: PageItem[],
  layout: LayoutSettings,
  settings: Pick<
    AppSettings,
    'bwPageTariffRials' | 'colorPageTariffRials' | 'duplexDiscountPercent'
  >
): CounterSummary {
  const selectedPagesList = pages.filter((p) => p.selectedForPrint);
  const highlightedPagesList = pages.filter((p) => p.isHighlighted);

  const colorPages = selectedPagesList.filter((p) => p.colorProfile === 'color').length;
  const bwPages = selectedPagesList.filter((p) => p.colorProfile === 'grayscale').length;
  const blankPages = selectedPagesList.filter(
    (p) => p.colorProfile === 'blank' || p.isBlankPage
  ).length;

  const sheets = computeImpositionSheets(pages, layout);
  const populatedSides = sheets.filter((side) =>
    side.cells.some((c) => c.page !== null)
  );
  const totalImpressions = populatedSides.length;
  const isDuplex = layout.duplexMode !== 'none';
  const totalPhysicalSheets = isDuplex
    ? Math.ceil(populatedSides.length / 2)
    : populatedSides.length;

  const cellsPerSheet = Math.max(1, layout.rows * layout.cols);

  const totalInk = selectedPagesList.reduce(
    (acc, p) => acc + (p.inkCoveragePercent || 0),
    0
  );
  const averageInkCoveragePercent =
    selectedPagesList.length > 0
      ? Number((totalInk / selectedPagesList.length).toFixed(1))
      : 0;

  // Breakdown by paper size + orientation
  const sizeMap = new Map<string, PaperBreakdownItem>();
  for (const page of pages) {
    const isRotated = page.rotation === 90 || page.rotation === 270;
    const effW = isRotated ? page.heightMm : page.widthMm;
    const effH = isRotated ? page.widthMm : page.heightMm;
    const orientation = effW > effH ? 'landscape' : 'portrait';
    const sizeLabel = classifyPaperSizeLabel(effW, effH);
    const key = `${sizeLabel}-${orientation}`;

    const existing = sizeMap.get(key) ?? {
      sizeLabel,
      orientation,
      totalPages: 0,
      selectedPages: 0,
      colorPages: 0,
      bwPages: 0,
      blankPages: 0,
    };

    existing.totalPages += 1;
    if (page.selectedForPrint) {
      existing.selectedPages += 1;
      if (page.colorProfile === 'color') existing.colorPages += 1;
      else if (page.colorProfile === 'grayscale') existing.bwPages += 1;
      else existing.blankPages += 1;
    }
    sizeMap.set(key, existing);
  }

  // Breakdown by file
  const byFile: FileCountSummary[] = documents.map((doc) => {
    const docPages = pages.filter((p) => p.documentId === doc.id);
    const sel = docPages.filter((p) => p.selectedForPrint);
    return {
      documentId: doc.id,
      documentName: doc.name,
      fileSize: doc.fileSize,
      totalPages: docPages.length,
      selectedPages: sel.length,
      colorPages: sel.filter((p) => p.colorProfile === 'color').length,
      bwPages: sel.filter((p) => p.colorProfile === 'grayscale').length,
      blankPages: sel.filter((p) => p.colorProfile === 'blank' || p.isBlankPage).length,
    };
  });

  // Cost calculation (B5 preview)
  const rawCost =
    colorPages * settings.colorPageTariffRials +
    bwPages * settings.bwPageTariffRials;
  const discountMultiplier = isDuplex
    ? Math.max(0, 1 - settings.duplexDiscountPercent / 100)
    : 1;
  const estimatedCostRials = Math.round(rawCost * discountMultiplier);

  return {
    totalFiles: documents.length,
    totalPages: pages.length,
    selectedPages: selectedPagesList.length,
    highlightedPages: highlightedPagesList.length,
    colorPages,
    bwPages,
    blankPages,
    totalImpressions,
    totalPhysicalSheets,
    cellsPerSheet,
    isDuplex,
    averageInkCoveragePercent,
    estimatedCostRials,
    byPaperSize: Array.from(sizeMap.values()),
    byFile,
  };
}
