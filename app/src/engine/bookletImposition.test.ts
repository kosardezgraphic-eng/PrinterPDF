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


  it('applies each booklet margin side independently, sets middle gap strictly from Spine and fold, and honors free cell transforms', () => {
    const basePages = pages(4);
    const baseline = computeImpositionSheets(basePages, {
      ...baseLayout,
      marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
      booklet: { ...baseLayout.booklet!, spineWidthMm: 4 },
    });
    const tallTopMargin = computeImpositionSheets(basePages, {
      ...baseLayout,
      marginsMm: { top: 30, right: 10, bottom: 10, left: 10 },
      booklet: { ...baseLayout.booklet!, spineWidthMm: 4 },
    });
    const wideSpineOnly = computeImpositionSheets(basePages, {
      ...baseLayout,
      marginsMm: { top: 30, right: 10, bottom: 10, left: 10 },
      booklet: { ...baseLayout.booklet!, spineWidthMm: 16 },
    });

    const baseCell0 = baseline[0].cells[0];
    const baseCell1 = baseline[0].cells[1];
    const topCell0 = tallTopMargin[0].cells[0];
    const topCell1 = tallTopMargin[0].cells[1];
    const spineCell0 = wideSpineOnly[0].cells[0];
    const spineCell1 = wideSpineOnly[0].cells[1];

    // Changing only top margin shifts top edge to 30mm and shrinks cell height without moving left/right/bottom or middle gap.
    expect(topCell0.cellXMm).toBe(10);
    expect(topCell0.cellYMm).toBe(30);
    expect(topCell0.cellHeightMm).toBeCloseTo(baseCell0.cellHeightMm - 20);
    expect(topCell0.cellWidthMm).toBeCloseTo(baseCell0.cellWidthMm);
    expect(topCell0.contentWidthMm).toBeLessThan(baseCell0.contentWidthMm);
    expect(topCell0.contentYMm).toBeGreaterThanOrEqual(30);
    expect(topCell1.cellXMm + topCell1.cellWidthMm).toBeCloseTo(baseCell1.cellXMm + baseCell1.cellWidthMm);

    // Middle margin between the two booklet pages depends solely on Spine and fold (spineWidthMm).
    const baseGap = baseCell1.cellXMm - (baseCell0.cellXMm + baseCell0.cellWidthMm);
    const topChangedGap = topCell1.cellXMm - (topCell0.cellXMm + topCell0.cellWidthMm);
    const wideSpineGap = spineCell1.cellXMm - (spineCell0.cellXMm + spineCell0.cellWidthMm);
    expect(baseGap).toBeCloseTo(4);
    expect(topChangedGap).toBeCloseTo(4);
    expect(wideSpineGap).toBeCloseTo(16);

    // Untransformed booklet pages stay bounded by margins and spine.
    expect(topCell0.allowOverflow).toBe(false);
    expect(spineCell0.contentWidthMm).toBeLessThanOrEqual(spineCell0.cellWidthMm);

    // Custom transforms applied in booklet mode are honored so images can be freely moved and resized.
    const movedKey = baseCell0.occurrenceKey!;
    const transformed = computeImpositionSheets(basePages, {
      ...baseLayout,
      cellOverrides: {
        [movedKey]: {
          pageId: baseCell0.page!.id,
          transform: { x: 0.35, y: -0.2, scaleX: 1.5, scaleY: 1.5 },
          allowOverflow: true,
        },
      },
    });
    const movedCell = transformed[0].cells[0];
    expect(movedCell.transform).toEqual({ x: 0.35, y: -0.2, scaleX: 1.5, scaleY: 1.5 });
    expect(movedCell.allowOverflow).toBe(true);
    expect(movedCell.contentWidthMm).toBeGreaterThan(baseCell0.contentWidthMm);
    expect(movedCell.contentXMm).not.toBeCloseTo(baseCell0.contentXMm);
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
