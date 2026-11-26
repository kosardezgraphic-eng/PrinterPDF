// @vitest-environment node
/**
 * Numbering a grid, and putting one picture on a sheet, are the two places where "what the operator sees" and
 * "what the layout engine computes" can drift apart silently: a numbered cell looks right in the panel and
 * prints another number on paper. These tests pin the two engines that decide it.
 */
import { describe, expect, it } from 'vitest';
import type { ComputedSheetSide, LayoutSettings, PageItem, PageOverlayImage } from '@shared/models';
import { computeImpositionSheets } from './layoutEngine';
import { numberingSequence, sequenceCells, sequenceOrder, sanitizeSequence } from './numberingSequence';
import { imageOverlayFromPlacement, sheetImagePlacement, imageDropPlacement } from './imageOverlays';
import { imagePlacements } from './overlayPlacements';
import { textPlacements } from './textOverlays';
import { DEFAULT_LAYOUT } from '../store/useAppStore';

const page = (id: string): PageItem => ({
  id, documentId: 'd', documentName: 'd', sourcePageNumber: 1, widthMm: 100, heightMm: 200, rotation: 0,
  selectedForPrint: true, isHighlighted: false, isBlankPage: false, colorProfile: 'color', inkCoveragePercent: 0,
});
// Left-to-right reading order, so cell 1 really is the top-left one and a walk's answer can be read off the
// numbers: with the shipped RTL-snake default the pages would arrive in the grid already reversed.
const layout = (rows: number, cols: number): LayoutSettings => ({
  ...DEFAULT_LAYOUT, paperSize: 'Custom', customWidthMm: 300, customHeightMm: 300, rows, cols,
  duplexMode: 'none', placementMode: 'sequential', sheetOrder: 'ltr',
});
const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(page);
const sides = computeImpositionSheets(eight, layout(2, 2));

describe('the cell walk', () => {
  it('lists only occupied cells, because a half-empty grid must not leave holes in the count', () => {
    const four = computeImpositionSheets(['a', 'b', 'c'].map(page), layout(2, 2))[0];
    expect(sequenceCells(four)).toHaveLength(3);
    expect(sequenceCells(four).map(cell => cell.pageId)).toEqual(['a', 'b', 'c']);
  });

  it('walks rows in writing order, down the columns, or snaking across the sheet', () => {
    const cells = sequenceCells(sides[0]);                              // a b / c d
    expect(sequenceOrder(cells, 'ltr')).toEqual(['a', 'b', 'c', 'd']);
    expect(sequenceOrder(cells, 'rtl')).toEqual(['b', 'a', 'd', 'c']);
    expect(sequenceOrder(cells, 'ttb')).toEqual(['a', 'c', 'b', 'd']);
    expect(sequenceOrder(cells, 'btt')).toEqual(['c', 'a', 'd', 'b']);
    expect(sequenceOrder(cells, 'zigzag')).toEqual(['a', 'b', 'd', 'c']);
  });
});

describe('what a numbering layer counts', () => {
  const at = (pageId: string, basis: 'page' | 'grid' | 'cut-stack' | 'sheet', direction: 'ltr' | 'rtl' | 'ttb' = 'ltr', sheetIndex = 0) =>
    numberingSequence({
      basis, direction, pageId, sheet: sides[sheetIndex], pageIndex: eight.findIndex(p => p.id === pageId) + 1,
      pageTotal: eight.length, sheetTotal: sides.length,
    });

  it('defaults to the document page number, so an old project keeps its numbers', () => {
    expect(at('a', 'page')).toEqual({ index: 1, total: 8 });
    expect(at('f', undefined as unknown as 'page')).toEqual({ index: 6, total: 8 });
  });

  it('counts cells off the printed sheet instead of pages in the workspace', () => {
    // The second side of an eight-page 2×2 is pages e–h but cells 1–4 of that sheet.
    expect(at('e', 'grid', 'ltr', 1)).toEqual({ index: 1, total: 4 });
    expect(at('h', 'grid', 'ltr', 1)).toEqual({ index: 4, total: 4 });
    expect(at('c', 'grid', 'ttb')).toEqual({ index: 2, total: 4 });   // a c / b d read down the columns
  });

  it('counts vertically down each cut-stack pile across sheets so stacked tickets stay sequential', () => {
    // With 8 pages on 2 sheets of 2x2 LTR: pile 0 (top-left: a on sheet 1, e on sheet 2) is 1, 2;
    // pile 1 (top-right: b, f) is 3, 4; pile 2 (bottom-left: c, g) is 5, 6; pile 3 (d, h) is 7, 8.
    expect(at('a', 'cut-stack', 'ltr', 0)).toEqual({ index: 1, total: 8 });
    expect(at('e', 'cut-stack', 'ltr', 1)).toEqual({ index: 2, total: 8 });
    expect(at('b', 'cut-stack', 'ltr', 0)).toEqual({ index: 3, total: 8 });
    expect(at('f', 'cut-stack', 'ltr', 1)).toEqual({ index: 4, total: 8 });
  });

  it('numbers every cell of one side the same when the sheet is the unit', () => {
    // The total is the number of sides, not the number of cells: four cells sharing number 1 of 2 is the point.
    for (const id of ['a', 'b', 'c', 'd']) expect(at(id, 'sheet')).toEqual({ index: 1, total: 2 });
    expect(at('e', 'sheet', 'ltr', 1)).toEqual({ index: 2, total: 2 });
  });

  it('answers with a number, never NaN, for a cell that is not on the sheet', () => {
    expect(at('nope', 'grid')).toEqual({ index: 1, total: 4 });
  });

  it('refuses junk from a panel or a project file instead of storing it', () => {
    expect(sanitizeSequence('grid', 'zigzag')).toEqual({ sequenceBasis: 'grid', sequenceDirection: 'zigzag' });
    expect(sanitizeSequence('cut-stack', 'rtl')).toEqual({ sequenceBasis: 'cut-stack', sequenceDirection: 'rtl' });
    expect(sanitizeSequence('sideways', 'diagonal')).toEqual({ sequenceDirection: 'ltr' });
  });
});

describe('a sheet picture', () => {
  const picture = (overrides: Partial<PageOverlayImage> = {}): PageOverlayImage =>
    imageOverlayFromPlacement('i', 'data:image/png;base64,AAA', 'logo', { width: 400, height: 200 },
      sheetImagePlacement(sides[0], { width: 400, height: 200 }));
  const placementsOn = (item: PageOverlayImage, sheet: ComputedSheetSide = sides[0]) =>
    imagePlacements(sheet, sides.length, eight, [item]);

  it('is placed once across the whole side, not echoed into every cell', () => {
    const item = { ...picture(), targetScope: 'all' as const };
    const placed = placementsOn(item);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ parentX: 0, parentY: 0, parentWidth: sides[0].widthMm });
    expect(placed[0].pageId).toBeUndefined();
  });

  it('repeats per cell only when that is asked for, because a watermark per cell is a real job too', () => {
    const item = { ...picture(), targetScope: 'all' as const, sheetFill: 'each-cell' as const };
    const placed = placementsOn(item);
    expect(placed).toHaveLength(4);
    expect(new Set(placed.map(p => p.pageId))).toEqual(new Set(['a', 'b', 'c', 'd']));
    // Each copy is sized against its own cell, so the boxes differ where the cells do.
    expect(placed.every(p => p.parentWidth > 0 && p.parentHeight > 0)).toBe(true);
  });

  it('stays on the page it was dropped into and does not spread to its neighbours', () => {
    const cell = sides[0].cells[0];
    const dropped = imageDropPlacement(sides[0], { xMm: cell.contentXMm + 1, yMm: cell.contentYMm + 1 }, { width: 100, height: 100 })!;
    expect(dropped).toMatchObject({ target: 'page', pageId: 'a' });
    const item = imageOverlayFromPlacement('j', 'data:image/png;base64,AAA', 'stamp', { width: 100, height: 100 }, dropped);
    const placed = placementsOn(item);
    expect(placed).toHaveLength(1);
    expect(placed[0].pageId).toBe('a');
  });

  it('falls back to the sheet when a picture arrives on a grid without a drop point', () => {
    expect(sheetImagePlacement(sides[0], { width: 400, height: 200 })).toMatchObject({ target: 'sheet', sheetIndex: 1 });
  });
});

describe('the printed numbering matches the panel', () => {
  it('hands the cell walk to the placement that draws the number', () => {
    const numbering = {
      id: 'n', kind: 'numbering' as const, enabled: true, target: 'page' as const, targetScope: 'all' as const,
      targetPageIds: [], targetSheetIndex: 1, xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100,
      opacity: 1, rotation: 0, fontSize: 12, fontFamily: 'Vazirmatn', color: '#000000', bold: false, italic: false,
      format: 'english' as const, template: '{page}', startOffset: 1, padZeros: 0, customScript: '',
      sequenceBasis: 'grid' as const, sequenceDirection: 'ltr' as const,
    };
    const placed = textPlacements(sides[1], sides.length, eight, [numbering]);
    // The second side holds e,f,g,h; as cells they are 1,2,3,4, whatever the workspace order says.
    expect(placed.map(p => p.renderText.text)).toEqual(['1', '2', '3', '4']);
  });
});
