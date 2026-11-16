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
      [4, 1],
      [2, 3],
    ]);
  });

  it('imposes a four-page left-to-right booklet in reading order', () => {
    const layout = { ...baseLayout, booklet: { ...baseLayout.booklet!, direction: 'ltr' as const } };
    expect(imposedPageNumbers(computeImpositionSheets(pages(4), layout))).toEqual([
      [1, 4],
      [3, 2],
    ]);
  });

  it('pads incomplete signatures with blank pages and splits fixed-size signatures', () => {
    const layout = { ...baseLayout, booklet: { ...baseLayout.booklet!, signatureSize: 4 as const } };
    const sheets = computeImpositionSheets(pages(5), layout);
    expect(sheets).toHaveLength(4);
    expect(imposedPageNumbers(sheets)).toEqual([
      [4, 1],
      [2, 3],
      [null, 5],
      [null, null],
    ]);
  });
});
