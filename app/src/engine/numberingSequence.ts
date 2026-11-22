/**
 * Which number goes in which cell.
 *
 * A numbering layer used to take its number from wherever the page sat in the workspace: fine for a stack of
 * A4s, wrong the moment the sheet is a grid. A 2×2 imposition of an eight-page file wants 1,2,3,4 read off the
 * *printed sheet* — not 1,2,3,4,5,6,7,8 as the pages happen to be stacked in the workspace — and a sheet of
 * tickets wants the count to snake across the grid rather than jump back to the leading edge. Neither of those
 * is the document's own page number and neither should force the operator to reorder their pages.
 *
 * So the layer carries two choices — what it counts (`sequenceBasis`) and, for a grid, which way it reads
 * (`sequenceDirection`) — and this module turns a computed sheet into the two numbers a template needs. Three
 * rules keep it honest:
 *
 * - `page` is the workspace page's own position: the number already printed in the sidebar, and the one an
 *   invoice page must carry. It is the default, so an old project keeps the numbers it was saved with.
 * - The grid walk is over **populated cells only, in reading order**, never over the grid's rectangles: a 2×3
 *   grid holding four pages counts 1–4, so a half-empty sheet does not leave holes in the sequence.
 * - `{total}` follows the same choice as the index. Counting cells while reporting pages would print "cell 3
 *   of 12" on a 2×2 sheet, which is a true statement about nothing the operator asked for.
 */
import type {
  ComputedSheetSide,
  NumberingSequenceBasis,
  NumberingSequenceDirection,
  PageOverlayNumbering,
} from '@shared/models';
import { NUMBERING_SEQUENCE_BASES, NUMBERING_SEQUENCE_DIRECTIONS } from '@shared/models';

/** One occupied cell of a sheet, in the terms the walk needs. */
export interface SequenceCell {
  pageId: string;
  row: number;
  col: number;
}

/** The occupied cells of a sheet, de-duplicated by page (a step-and-repeat sheet repeats one page). */
export function sequenceCells(sheet: ComputedSheetSide): SequenceCell[] {
  const seen = new Set<string>();
  const cells: SequenceCell[] = [];
  for (const cell of sheet.cells) {
    if (!cell.page) continue;
    if (seen.has(cell.page.id)) continue;
    seen.add(cell.page.id);
    cells.push({ pageId: cell.page.id, row: cell.row, col: cell.col });
  }
  return cells;
}

/**
 * The order the cells are numbered in, as page ids.
 *
 * `zigzag` is the boustrophedon reading of a grid: the first row in writing order, the second reversed. It is a
 * direction of its own rather than a combination of the others because the reversal alternates per row, and a
 * second sheet of tickets has to continue the count from the end of the previous row instead of starting over.
 */
export function sequenceOrder(
  cells: SequenceCell[],
  direction: NumberingSequenceDirection = 'ltr'
): string[] {
  const rows = new Map<number, SequenceCell[]>();
  const columns = new Map<number, SequenceCell[]>();
  for (const cell of cells) {
    const row = rows.get(cell.row) ?? [];
    row.push(cell);
    rows.set(cell.row, row);
    const column = columns.get(cell.col) ?? [];
    column.push(cell);
    columns.set(cell.col, column);
  }
  const byColumn = (a: SequenceCell, b: SequenceCell) => a.col - b.col;
  const byRow = (a: SequenceCell, b: SequenceCell) => a.row - b.row;

  const walkRows = (mode: 'forward' | 'reverse' | 'zigzag') =>
    [...rows.keys()]
      .sort((a, b) => a - b)
      .flatMap((key, index) => {
        const inRow = [...rows.get(key)!].sort(byColumn);
        const backwards = mode === 'reverse' || (mode === 'zigzag' && index % 2 === 1);
        return (backwards ? inRow.reverse() : inRow).map(cell => cell.pageId);
      });
  const walkColumns = (reverse: boolean) =>
    [...columns.keys()]
      .sort((a, b) => a - b)
      .flatMap(key => {
        const inColumn = [...columns.get(key)!].sort(byRow);
        return (reverse ? inColumn.reverse() : inColumn).map(cell => cell.pageId);
      });

  switch (direction) {
    case 'rtl': return walkRows('reverse');
    case 'ttb': return walkColumns(false);
    case 'btt': return walkColumns(true);
    case 'zigzag': return walkRows('zigzag');
    case 'ltr':
    default: return walkRows('forward');
  }
}

/** Everything one cell's number depends on. */
export interface NumberingSequenceInput {
  basis: NumberingSequenceBasis | undefined;
  direction: NumberingSequenceDirection | undefined;
  /** The occupied cell whose number is being asked for, and the side it sits on. */
  pageId: string;
  sheet: ComputedSheetSide;
  /** 1-based position of the page in workspace order, and how many pages the workspace holds. */
  pageIndex: number;
  pageTotal: number;
  /** How many output sides there are — the total a `sheet` walk reports. */
  sheetTotal: number;
}

/**
 * The two numbers a numbering template is resolved against: the one it counts to, and the total.
 *
 * A cell that is not in the walk (it cannot happen for a cell read off the same sheet, but a caller may pass a
 * stale id) is numbered 1 rather than `NaN`, because a numbering layer that prints "NaN" on a sheet is worse
 * than one that prints a wrong number the operator can see and correct.
 */
export function numberingSequence(input: NumberingSequenceInput): { index: number; total: number } {
  const basis = input.basis ?? 'page';
  if (basis === 'page') return { index: input.pageIndex, total: input.pageTotal };
  if (basis === 'sheet') return { index: input.sheet.sideIndex, total: Math.max(1, input.sheetTotal) };
  if (basis === 'cut-stack') {
    const order = sequenceOrder(sequenceCells(input.sheet), input.direction ?? 'ltr');
    const slotIndex = Math.max(0, order.indexOf(input.pageId));
    const perSheet = Math.max(1, input.sheet.cells.length);
    const totalTickets = Math.max(1, input.pageTotal);
    const sheetIndexZero = Math.max(0, input.sheet.sideIndex - 1);
    const basePerPile = Math.floor(totalTickets / perSheet);
    const remainder = totalTickets % perSheet;
    const offsetBeforeSlot = slotIndex * basePerPile + Math.min(slotIndex, remainder);
    return { index: offsetBeforeSlot + sheetIndexZero + 1, total: totalTickets };
  }
  const order = sequenceOrder(sequenceCells(input.sheet), input.direction ?? 'ltr');
  const found = order.indexOf(input.pageId);
  return { index: found >= 0 ? found + 1 : 1, total: Math.max(1, order.length) };
}

/**
 * Both fields as a panel or a project file may safely store them, from anything at all.
 *
 * `undefined` stays `undefined` for the basis when the input was not a recognised value, so an untouched layer
 * keeps meaning "the document's own page number" instead of being rewritten to a value it never had.
 */
export function sanitizeSequence(
  basis: unknown,
  direction: unknown
): { sequenceBasis?: NumberingSequenceBasis; sequenceDirection: NumberingSequenceDirection } {
  const knownBasis = NUMBERING_SEQUENCE_BASES.includes(basis as NumberingSequenceBasis)
    ? (basis as NumberingSequenceBasis)
    : undefined;
  const knownDirection = NUMBERING_SEQUENCE_DIRECTIONS.includes(direction as NumberingSequenceDirection)
    ? (direction as NumberingSequenceDirection)
    : 'ltr';
  return { ...(knownBasis ? { sequenceBasis: knownBasis } : {}), sequenceDirection: knownDirection };
}

/** A stable cache key for one cell's number, so a re-render does not re-resolve a template per frame. */
export function sequenceKey(item: PageOverlayNumbering, sheetIndex: number, pageId?: string): string {
  return [item.id, item.sequenceBasis ?? 'page', item.sequenceDirection ?? 'ltr', sheetIndex, pageId ?? '-'].join(':');
}
