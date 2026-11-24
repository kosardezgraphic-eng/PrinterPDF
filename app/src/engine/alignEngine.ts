import type {
  ComputedCellPlacement,
  ComputedSheetSide,
  PageItem,
  PageOverlay,
  PageTransform,
} from '@shared/models';
import { overlayPlacements } from './overlayPlacements';

export type AlignDirection = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type AlignReferenceMode = 'sheet' | 'margins' | 'cell' | 'others';

export interface Box2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StudioAlignPeer {
  id: string;
  kind: 'cell' | 'image' | 'text' | 'shape';
  label: string;
  box: Box2D;
}

export function computeAlignedBoxPosition(
  subject: Box2D,
  reference: Box2D,
  direction: AlignDirection
): { x: number; y: number } {
  let x = subject.x;
  let y = subject.y;
  switch (direction) {
    case 'left':
      x = reference.x;
      break;
    case 'hcenter':
      x = reference.x + (reference.width - subject.width) / 2;
      break;
    case 'right':
      x = reference.x + reference.width - subject.width;
      break;
    case 'top':
      y = reference.y;
      break;
    case 'vcenter':
      y = reference.y + (reference.height - subject.height) / 2;
      break;
    case 'bottom':
      y = reference.y + reference.height - subject.height;
      break;
  }
  return {
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
  };
}

export function computeUnionBox(boxes: Box2D[]): Box2D | null {
  if (boxes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + Math.max(0, b.width));
    maxY = Math.max(maxY, b.y + Math.max(0, b.height));
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return {
    x: minX,
    y: minY,
    width: Math.max(0.1, maxX - minX),
    height: Math.max(0.1, maxY - minY),
  };
}

export function collectStudioSheetPeers(
  sheet: ComputedSheetSide | undefined,
  totalSheets: number,
  pages: PageItem[],
  overlays: PageOverlay[],
  pageIndices: Map<string, number>,
  excludePeerId?: string,
  language: string = 'fa'
): StudioAlignPeer[] {
  if (!sheet) return [];
  const isFa = language === 'fa';
  const peers: StudioAlignPeer[] = [];

  for (const cell of sheet.cells) {
    if (!cell.page || !cell.occurrenceKey) continue;
    const peerId = `cell:${cell.occurrenceKey}`;
    if (peerId === excludePeerId) continue;
    if (cell.contentWidthMm <= 0 || cell.contentHeightMm <= 0) continue;
    const pageNo = (pageIndices.get(cell.page.id) ?? ((cell.globalPageNumber ?? 1) - 1)) + 1;
    peers.push({
      id: peerId,
      kind: 'cell',
      label: isFa ? `صفحه ${pageNo} (خانه ${cell.row + 1}×${cell.col + 1})` : `Page ${pageNo} (${cell.row + 1}×${cell.col + 1})`,
      box: {
        x: cell.contentXMm,
        y: cell.contentYMm,
        width: cell.contentWidthMm,
        height: cell.contentHeightMm,
      },
    });
  }

  const placements = overlayPlacements(sheet, totalSheets, pages, overlays, pageIndices);
  for (const pl of placements) {
    const item = 'text' in pl ? pl.text : 'image' in pl ? pl.image : pl.shape;
    const peerId = `overlay:${item.id}`;
    if (peerId === excludePeerId) continue;
    if (pl.width <= 0 || pl.height <= 0) continue;
    const kind = 'text' in pl ? 'text' : 'image' in pl ? 'image' : 'shape';
    const label =
      'image' in pl
        ? pl.image.name || (isFa ? 'تصویر' : 'Image')
        : 'text' in pl
          ? pl.text.kind === 'numbering'
            ? (isFa ? 'شماره‌گذاری' : 'Numbering')
            : (pl.text.text ?? '').slice(0, 16) || (isFa ? 'متن' : 'Text')
          : isFa
            ? 'شکل'
            : 'Shape';
    peers.push({
      id: peerId,
      kind,
      label,
      box: {
        x: pl.x,
        y: pl.y,
        width: pl.width,
        height: pl.height,
      },
    });
  }

  return peers;
}

export function resolveStudioCellAlignTransform(
  sheet: ComputedSheetSide,
  cell: ComputedCellPlacement,
  direction: AlignDirection,
  refMode: AlignReferenceMode,
  otherBoxes: Box2D[]
): PageTransform | null {
  const subject: Box2D = {
    x: cell.contentXMm,
    y: cell.contentYMm,
    width: cell.contentWidthMm,
    height: cell.contentHeightMm,
  };

  let reference: Box2D | null = null;
  if (refMode === 'sheet') {
    reference = { x: 0, y: 0, width: sheet.widthMm, height: sheet.heightMm };
  } else if (refMode === 'margins') {
    const margins = sheet.marginsMm ?? { left: 0, top: 0, right: 0, bottom: 0 };
    reference = {
      x: margins.left,
      y: margins.top,
      width: Math.max(1, sheet.widthMm - margins.left - margins.right),
      height: Math.max(1, sheet.heightMm - margins.top - margins.bottom),
    };
  } else if (refMode === 'cell') {
    reference = {
      x: cell.cellXMm,
      y: cell.cellYMm,
      width: cell.cellWidthMm,
      height: cell.cellHeightMm,
    };
  } else {
    reference = computeUnionBox(otherBoxes);
  }

  if (!reference) return null;

  const target = computeAlignedBoxPosition(subject, reference, direction);
  const deltaXMm = target.x - subject.x;
  const deltaYMm = target.y - subject.y;
  const base = cell.transform ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationDeg: 0 };

  return {
    ...base,
    x: Math.round((base.x + deltaXMm / Math.max(0.01, cell.cellWidthMm)) * 10000) / 10000,
    y: Math.round((base.y + deltaYMm / Math.max(0.01, cell.cellHeightMm)) * 10000) / 10000,
  };
}

export function resolveStudioOverlayAlignPercent(
  sheet: ComputedSheetSide,
  item: PageOverlay,
  direction: AlignDirection,
  refMode: AlignReferenceMode,
  otherBoxes: Box2D[]
): { xPercent: number; yPercent: number } | null {
  const cell =
    item.target === 'page'
      ? sheet.cells.find((c) => c.page?.id === item.targetPageIds[0])
      : undefined;

  const parent: Box2D = cell
    ? {
        x: cell.contentXMm,
        y: cell.contentYMm,
        width: Math.max(1, cell.contentWidthMm),
        height: Math.max(1, cell.contentHeightMm),
      }
    : { x: 0, y: 0, width: Math.max(1, sheet.widthMm), height: Math.max(1, sheet.heightMm) };

  const subject: Box2D = {
    x: parent.x + (item.xPercent / 100) * parent.width,
    y: parent.y + (item.yPercent / 100) * parent.height,
    width: (item.widthPercent / 100) * parent.width,
    height: (item.heightPercent / 100) * parent.height,
  };

  let reference: Box2D | null = null;
  if (refMode === 'sheet') {
    reference = { x: 0, y: 0, width: sheet.widthMm, height: sheet.heightMm };
  } else if (refMode === 'margins') {
    const margins = sheet.marginsMm ?? { left: 0, top: 0, right: 0, bottom: 0 };
    reference = {
      x: margins.left,
      y: margins.top,
      width: Math.max(1, sheet.widthMm - margins.left - margins.right),
      height: Math.max(1, sheet.heightMm - margins.top - margins.bottom),
    };
  } else if (refMode === 'cell') {
    reference = cell
      ? { x: cell.cellXMm, y: cell.cellYMm, width: cell.cellWidthMm, height: cell.cellHeightMm }
      : { x: 0, y: 0, width: sheet.widthMm, height: sheet.heightMm };
  } else {
    reference = computeUnionBox(otherBoxes);
  }

  if (!reference) return null;

  const target = computeAlignedBoxPosition(subject, reference, direction);
  return {
    xPercent: Math.round(((target.x - parent.x) / parent.width) * 10000) / 100,
    yPercent: Math.round(((target.y - parent.y) / parent.height) * 10000) / 100,
  };
}

export function resolveTicketSlotAlignPercent(
  slot: { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number },
  otherSlots: Array<{ xPercent: number; yPercent: number; widthPercent: number; heightPercent: number }>,
  cellSheetBoundsPct: Box2D,
  direction: AlignDirection,
  refMode: 'cell' | 'sheet' | 'others'
): { xPercent: number; yPercent: number } | null {
  const subject: Box2D = {
    x: slot.xPercent,
    y: slot.yPercent,
    width: slot.widthPercent,
    height: slot.heightPercent,
  };

  let reference: Box2D | null = null;
  if (refMode === 'cell') {
    reference = { x: 0, y: 0, width: 100, height: 100 };
  } else if (refMode === 'others') {
    reference = computeUnionBox(
      otherSlots.map((s) => ({
        x: s.xPercent,
        y: s.yPercent,
        width: s.widthPercent,
        height: s.heightPercent,
      }))
    );
  } else {
    // Convert full-sheet bounds [0..100]% into active cell's percentage coordinate system
    const cw = Math.max(1, cellSheetBoundsPct.width);
    const ch = Math.max(1, cellSheetBoundsPct.height);
    reference = {
      x: ((0 - cellSheetBoundsPct.x) / cw) * 100,
      y: ((0 - cellSheetBoundsPct.y) / ch) * 100,
      width: (100 / cw) * 100,
      height: (100 / ch) * 100,
    };
  }

  if (!reference) return null;
  const target = computeAlignedBoxPosition(subject, reference, direction);
  return {
    xPercent: Math.round(Math.max(0, Math.min(100 - slot.widthPercent, target.x)) * 10) / 10,
    yPercent: Math.round(Math.max(0, Math.min(100 - slot.heightPercent, target.y)) * 10) / 10,
  };
}
