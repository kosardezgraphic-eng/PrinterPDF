import { describe, expect, it } from 'vitest';
import type { LayoutSettings, PageItem } from '@shared/models';
import { computeImpositionSheets } from './layoutEngine';

const pages = (count: number): PageItem[] => Array.from({ length: count }, (_, index) => ({
  id: `page-${index + 1}`,
  documentId: 'document-1',
  documentName: 'booklet.pdf',
  sourcePageNumber: index + 1,
  widthMm: 148,
  heightMm: 210,
  rotation: 0,
  selectedForPrint: true,
  isHighlighted: false,
  isBlankPage: false,
  colorProfile: 'grayscale',
  inkCoveragePercent: 20,
}));

const baseLayout: LayoutSettings = {
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
  booklet: {
    enabled: true,
    direction: 'rtl',
    signatureSize: 0,
    spineWidthMm: 4,
    creepMm: 0.2,
    duplexMode: 'short-edge',
    outerMarginMm: 10,
    compensateCreep: true,
  },
};

const imposedPageNumbers = (sheets: ReturnType<typeof computeImpositionSheets>) =>
  sheets.map(sheet => sheet.cells.map(cell => cell.page?.sourcePageNumber ?? null));

describe('booklet imposition', () => {
  it('imposes a four-page right-to-left booklet in reading order', () => {
    expect(imposedPageNumbers(computeImpositionSheets(pages(4), baseLayout))).toEqual([
      [1, 4],
      [3, 2],
    ]);
  });

  it('imposes a four-page left-to-right booklet in reading order', () => {
    const layout = { ...baseLayout, booklet: { ...baseLayout.booklet!, direction: 'ltr' as const } };
    expect(imposedPageNumbers(computeImpositionSheets(pages(4), layout))).toEqual([
      [4, 1],
      [2, 3],
    ]);
  });


  it('applies booklet outer margins inside each half-page and refits page images', () => {
    const pageWithOversizedTransform = pages(4).map((page, index) => index === 0
      ? { ...page, overrides: { transform: { x: 0.35, y: -0.2, scaleX: 2, scaleY: 2 } } }
      : page);
    const narrowMargins = computeImpositionSheets(pageWithOversizedTransform, {
      ...baseLayout,
      booklet: { ...baseLayout.booklet!, outerMarginMm: 10 },
    });
    const wideMargins = computeImpositionSheets(pageWithOversizedTransform, {
      ...baseLayout,
      booklet: { ...baseLayout.booklet!, outerMarginMm: 20 },
    });
    const narrowCell = narrowMargins[0].cells[0];
    const wideCell = wideMargins[0].cells[0];

    expect(wideCell.cellWidthMm).toBeLessThan(narrowCell.cellWidthMm);
    expect(wideCell.cellHeightMm).toBeLessThan(narrowCell.cellHeightMm);
    expect(wideCell.contentWidthMm).toBeLessThan(narrowCell.contentWidthMm);
    // A stored page scale must not prevent booklet pages from refitting to margins.
    expect(narrowCell.transform?.x).toBe(0);
    expect(narrowCell.transform?.y).toBe(0);
    expect(wideCell.transform?.x).toBe(0);
    expect(wideCell.transform?.y).toBe(0);
    expect(narrowCell.transform?.scaleX).toBe(1);
    expect(narrowCell.transform?.scaleY).toBe(1);
    expect(wideCell.transform?.scaleX).toBe(1);
    expect(wideCell.transform?.scaleY).toBe(1);
    expect(narrowCell.allowOverflow).toBe(false);
    expect(wideCell.allowOverflow).toBe(false);
    // Margins shrink and reposition the actual imposed cells, exactly like
    // increasing the spine gap. The physical spine remains centred in that gap.
    const narrowGap = narrowMargins[0].cells[1].cellXMm -
      (narrowCell.cellXMm + narrowCell.cellWidthMm);
    const wideGap = wideMargins[0].cells[1].cellXMm -
      (wideCell.cellXMm + wideCell.cellWidthMm);
    expect(narrowGap).toBeCloseTo(baseLayout.booklet!.spineWidthMm + 20);
    expect(wideGap).toBeCloseTo(baseLayout.booklet!.spineWidthMm + 40);
    expect(narrowCell.cellXMm).toBe(0);
    expect(wideCell.cellXMm).toBe(0);
    expect(narrowCell.contentXMm).toBeGreaterThan(narrowCell.cellXMm);
    expect(wideCell.contentXMm).toBeGreaterThan(narrowCell.contentXMm);
    expect(wideCell.contentYMm).toBeGreaterThan(narrowCell.contentYMm);
    expect(wideCell.contentWidthMm).toBeLessThan(narrowCell.contentWidthMm);
  });

  it('pads incomplete signatures with blank pages and splits fixed-size signatures', () => {
    const layout = { ...baseLayout, booklet: { ...baseLayout.booklet!, signatureSize: 4 as const } };
    const sheets = computeImpositionSheets(pages(5), layout);
    expect(sheets).toHaveLength(4);
    expect(imposedPageNumbers(sheets)).toEqual([
      [4, 1],
      [2, 3],
      [5, null],
      [null, null],
    ]);
  });
});
