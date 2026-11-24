/**
 * PrintStudio Pro — Imposition & Page Layout Engine (D1 - D5)
 * Calculates exact WYSIWYG cell coordinates, N-Up matrices up to 100×100,
 * Step & Repeat, Unique Scale, Margins, Gutters, Auto-Rotate, and Duplex sheet ordering.
 */

import { IDENTITY_TRANSFORM, pageCropFractions } from './pageGeometry';
import {
  STANDARD_PAPER_SIZES,
  type CellAlignment,
  type ComputedCellPlacement,
  type ComputedSheetSide,
  type LayoutSettings,
  type MarginsMm,
  type MeasurementUnit,
  type PageItem,
  type PageRotation,
  type SheetOrderMode,
} from '@shared/models';

export type DuplexFlipAxis = 'none' | 'horizontal' | 'vertical';

/**
 * Determines which sheet edge flips when Duplex is enabled:
 * - 'horizontal': swaps Left & Right margins on Back/Even sides (Portrait + Long-Edge, Landscape + Short-Edge, or Booklet)
 * - 'vertical': swaps Top & Bottom margins on Back/Even sides (Portrait + Short-Edge, or Landscape + Long-Edge)
 */
export function getDuplexFlipAxis(layout: LayoutSettings): DuplexFlipAxis {
  const effectiveDuplex = layout.booklet?.enabled
    ? layout.booklet.duplexMode
    : layout.duplexMode;
  if (effectiveDuplex === 'none') {
    return 'none';
  }
  const isLandscape = Boolean(layout.booklet?.enabled) || layout.orientation === 'landscape';
  const flipsHorizontally =
    (isLandscape && effectiveDuplex === 'short-edge') ||
    (!isLandscape && effectiveDuplex === 'long-edge');
  return flipsHorizontally ? 'horizontal' : 'vertical';
}

/**
 * Computes the physical sheet margins for Front (odd) and Back (even) sides,
 * mirroring Left/Right (or Top/Bottom) on Back sides when Duplex is active.
 */
export function getEffectiveSideMarginsMm(
  layout: LayoutSettings,
  side: 'front' | 'back'
): MarginsMm {
  const base: MarginsMm = {
    top: Math.max(0, layout.marginsMm.top),
    right: Math.max(0, layout.marginsMm.right),
    bottom: Math.max(0, layout.marginsMm.bottom),
    left: Math.max(0, layout.marginsMm.left),
  };
  if (side !== 'back') {
    return base;
  }
  const axis = getDuplexFlipAxis(layout);
  if (axis === 'horizontal') {
    return {
      top: base.top,
      right: base.left,
      bottom: base.bottom,
      left: base.right,
    };
  }
  if (axis === 'vertical') {
    return {
      top: base.bottom,
      right: base.right,
      bottom: base.top,
      left: base.left,
    };
  }
  return base;
}

export function getSheetDimensionsMm(layout: LayoutSettings): {
  widthMm: number;
  heightMm: number;
} {
  let baseWidth = layout.customWidthMm;
  let baseHeight = layout.customHeightMm;

  if (layout.paperSize !== 'Custom') {
    const std = STANDARD_PAPER_SIZES[layout.paperSize];
    baseWidth = std.widthMm;
    baseHeight = std.heightMm;
  }

  const shortSide = Math.min(baseWidth, baseHeight);
  const longSide = Math.max(baseWidth, baseHeight);

  if (layout.orientation === 'landscape' || layout.booklet?.enabled) {
    return { widthMm: longSide, heightMm: shortSide };
  }
  return { widthMm: shortSide, heightMm: longSide };
}

/**
 * Generates ordered (row, col) coordinates for a grid of rows × cols
 * according to the selected SheetOrderMode (LTR, RTL, Column-wise, or Spiral).
 */
export function getOrderedGridCoordinates(
  rows: number,
  cols: number,
  order: SheetOrderMode
): Array<{ row: number; col: number }> {
  const safeRows = Math.max(1, Math.min(100, Math.floor(rows)));
  const safeCols = Math.max(1, Math.min(100, Math.floor(cols)));
  const coords: Array<{ row: number; col: number }> = [];

  if (order === 'ltr') {
    for (let r = 0; r < safeRows; r++) {
      for (let c = 0; c < safeCols; c++) {
        coords.push({ row: r, col: c });
      }
    }
    return coords;
  }

  if (order === 'rtl') {
    for (let r = 0; r < safeRows; r++) {
      for (let c = safeCols - 1; c >= 0; c--) {
        coords.push({ row: r, col: c });
      }
    }
    return coords;
  }

  if (order === 'column') {
    for (let c = 0; c < safeCols; c++) {
      for (let r = 0; r < safeRows; r++) {
        coords.push({ row: r, col: c });
      }
    }
    return coords;
  }

  // 'spiral' (snake/boustrophedon row order used in imposition)
  for (let r = 0; r < safeRows; r++) {
    if (r % 2 === 0) {
      for (let c = 0; c < safeCols; c++) {
        coords.push({ row: r, col: c });
      }
    } else {
      for (let c = safeCols - 1; c >= 0; c--) {
        coords.push({ row: r, col: c });
      }
    }
  }
  return coords;
}

function computeAlignedOffset(
  availableWidth: number,
  availableHeight: number,
  contentWidth: number,
  contentHeight: number,
  alignment: CellAlignment
): { offsetX: number; offsetY: number } {
  const dx = availableWidth - contentWidth;
  const dy = availableHeight - contentHeight;

  let offsetX = dx / 2;
  let offsetY = dy / 2;

  if (alignment.includes('left')) offsetX = 0;
  if (alignment.includes('right')) offsetX = dx;
  if (alignment.includes('top')) offsetY = 0;
  if (alignment.includes('bottom')) offsetY = dy;

  return { offsetX, offsetY };
}

/** Stable for sequential pages and independently addressable repeat-grid occurrences. */
export function cellOccurrenceKey(pageId: string, mode: LayoutSettings['placementMode'], row: number, col: number): string {
  return JSON.stringify(mode === 'step-and-repeat' ? [mode, pageId, row, col] : [mode, pageId]);
}
export function sortCellsByLayer(cells: ComputedCellPlacement[]): ComputedCellPlacement[] {
  return cells.slice().sort((a, b) => (a.zIndex ?? a.cellIndex) - (b.zIndex ?? b.cellIndex) || a.cellIndex - b.cellIndex);
}

/**
 * Computes all output sheet sides (Front/Back) and exact millimeter placements
 * for every active page according to LayoutSettings.
 */
export function computeImpositionSheets(
  pages: PageItem[],
  layout: LayoutSettings
): ComputedSheetSide[] {
  if (layout.booklet?.enabled) {
    layout = {
      ...layout, rows: 1, cols: 2, placementMode: 'sequential', scaleMode: 'fit', uniqueScale: true, autoRotateToFit: true,
      sheetOrder: 'ltr', duplexMode: layout.booklet.duplexMode,
      verticalGutterMm: 0,
      orientation: 'landscape',
      // Each outer margin side (top, right, bottom, left) is independent in booklet mode.
      marginsMm: {
        top: Math.max(0, layout.marginsMm.top),
        right: Math.max(0, layout.marginsMm.right),
        bottom: Math.max(0, layout.marginsMm.bottom),
        left: Math.max(0, layout.marginsMm.left),
      },
      // The middle margin between the two booklet pages depends solely on Spine and fold.
      horizontalGutterMm: Math.max(0, layout.booklet.spineWidthMm),
    };
  }
  const activePages = pages.filter((p) => p.selectedForPrint);
  const { widthMm: sheetW, heightMm: sheetH } = getSheetDimensionsMm(layout);

  const customSlots =
    !layout.booklet?.enabled && layout.customCells && layout.customCells.length > 0
      ? layout.customCells
      : null;

  const rows = Math.max(1, Math.min(100, Math.floor(layout.rows)));
  const cols = Math.max(1, Math.min(100, Math.floor(layout.cols)));
  const cellsPerSide = customSlots ? customSlots.length : rows * cols;

  if (activePages.length === 0) {
    return [];
  }

  const printableW = Math.max(
    10,
    sheetW - layout.marginsMm.left - layout.marginsMm.right
  );
  const printableH = Math.max(
    10,
    sheetH - layout.marginsMm.top - layout.marginsMm.bottom
  );

  const totalHGutter = Math.max(0, cols - 1) * Math.max(0, layout.horizontalGutterMm);
  const totalVGutter = Math.max(0, rows - 1) * Math.max(0, layout.verticalGutterMm);

  const cellWidthMm = Math.max(5, (printableW - totalHGutter) / cols);
  const cellHeightMm = Math.max(5, (printableH - totalVGutter) / rows);

  const orderedGrid = getOrderedGridCoordinates(rows, cols, layout.sheetOrder);

  // Booklet imposition nests page pairs from the outside signature sheet toward the fold.
  const sidePageGroups: Array<Array<{ page: PageItem; globalPageNumber: number } | null>> = [];

  if (layout.booklet?.enabled) {
    const selected = activePages.map((page, index) => ({ page, globalPageNumber: index + 1 }));
    const signatureSize = layout.booklet.signatureSize || Math.max(4, Math.ceil(selected.length / 4) * 4);
    for (let offset = 0; offset < selected.length; offset += signatureSize) {
      const signature = selected.slice(offset, offset + signatureSize);
      const paddedLength = Math.max(4, Math.ceil(signature.length / 4) * 4);
      const padded = [...signature, ...Array.from({ length: paddedLength - signature.length }, () => null)];
      const last = padded.length - 1;
      for (let depth = 0; depth < paddedLength / 4; depth++) {
        const outerLeft = padded[last - depth * 2];
        const outerRight = padded[depth * 2];
        const innerLeft = padded[depth * 2 + 1];
        const innerRight = padded[last - depth * 2 - 1];
        // Coordinates are always laid out physically from left to right. Apply the reading
        // direction exactly once here; reversing the grid as well would cancel this ordering.
        const front = layout.booklet.direction === 'rtl' ? [outerRight, outerLeft] : [outerLeft, outerRight];
        const back = layout.booklet.direction === 'rtl' ? [innerRight, innerLeft] : [innerLeft, innerRight];
        sidePageGroups.push(front);
        sidePageGroups.push(back);
      }
    }
  } else if (layout.placementMode === 'step-and-repeat') {
    // D2: Repeat each active page in all cells of its sheet side
    activePages.forEach((page, idx) => {
      const repeated = Array.from({ length: cellsPerSide }, () => ({
        page,
        globalPageNumber: idx + 1,
      }));
      sidePageGroups.push(repeated);
    });
  } else {
    // D2: Sequential — each active page occupies one cell
    for (let i = 0; i < activePages.length; i += cellsPerSide) {
      const slice: Array<{ page: PageItem; globalPageNumber: number } | null> = [];
      for (let c = 0; c < cellsPerSide; c++) {
        const pageIdx = i + c;
        if (pageIdx < activePages.length) {
          slice.push({
            page: activePages[pageIdx],
            globalPageNumber: pageIdx + 1,
          });
        } else {
          slice.push(null);
        }
      }
      sidePageGroups.push(slice);
    }
  }

  // If Duplex is enabled and total sides is odd, add an empty back side so front/back pairs are complete
  if (layout.duplexMode !== 'none' && sidePageGroups.length % 2 !== 0) {
    sidePageGroups.push(Array.from({ length: cellsPerSide }, () => null));
  }

  const sheets: ComputedSheetSide[] = [];

  sidePageGroups.forEach((group, sideIdx) => {
    const isDuplex = layout.duplexMode !== 'none';
    const sheetNumber = isDuplex ? Math.floor(sideIdx / 2) + 1 : sideIdx + 1;
    const side: 'front' | 'back' = isDuplex && sideIdx % 2 === 1 ? 'back' : 'front';
    const sideMargins = getEffectiveSideMarginsMm(layout, side);

    // First pass: calculate individual scale factors & rotations
    const placementTemplates = customSlots
      ? customSlots.map((slot, idx) => ({
          cellIndex: idx,
          row: slot.row,
          col: slot.col,
          cellXMm: sideMargins.left + slot.xMm,
          cellYMm: sideMargins.top + slot.yMm,
          cellWidthMm: Math.max(5, slot.widthMm),
          cellHeightMm: Math.max(5, slot.heightMm),
          rotated90: Boolean(slot.rotated90),
        }))
      : orderedGrid.map((coord, cellIndex) => ({
          cellIndex,
          row: coord.row,
          col: coord.col,
          cellXMm:
            sideMargins.left +
            coord.col * (cellWidthMm + Math.max(0, layout.horizontalGutterMm)),
          cellYMm:
            sideMargins.top +
            coord.row * (cellHeightMm + Math.max(0, layout.verticalGutterMm)),
          cellWidthMm,
          cellHeightMm,
          rotated90: false,
        }));

    const rawPlacements = placementTemplates.map((slot) => {
      const entry = group[slot.cellIndex] ?? null;

      if (!entry) {
        return {
          cellIndex: slot.cellIndex,
          row: slot.row,
          col: slot.col,
          page: null,
          globalPageNumber: null,
          cellXMm: slot.cellXMm,
          cellYMm: slot.cellYMm,
          cellWidthMm: slot.cellWidthMm,
          cellHeightMm: slot.cellHeightMm,
          pageW: slot.cellWidthMm,
          pageH: slot.cellHeightMm,
          scaleFactor: 1,
          effectiveRotation: 0 as PageRotation,
        };
      }

      const { page, globalPageNumber } = entry;
      let effectiveRotation: PageRotation = slot.rotated90
        ? (((page.rotation + 90) % 360) as PageRotation)
        : page.rotation;
      const crop = pageCropFractions(page);
      const availableCellWidthMm = slot.cellWidthMm;
      const availableCellHeightMm = slot.cellHeightMm;
      const croppedWidth = page.widthMm * (1 - crop.left - crop.right);
      const croppedHeight = page.heightMm * (1 - crop.top - crop.bottom);
      const isRotated90 = effectiveRotation === 90 || effectiveRotation === 270;
      let pageW = isRotated90 ? croppedHeight : croppedWidth;
      let pageH = isRotated90 ? croppedWidth : croppedHeight;

      // D3: Auto-rotate page to best fit the cell aspect ratio
      if (!slot.rotated90 && layout.autoRotateToFit && !page.overrides?.manualRotation) {
        const cellIsLandscape = availableCellWidthMm > availableCellHeightMm;
        const pageIsLandscape = pageW > pageH;
        if (cellIsLandscape !== pageIsLandscape && Math.abs(slot.cellWidthMm - slot.cellHeightMm) > 2) {
          effectiveRotation = ((effectiveRotation + 90) % 360) as PageRotation;
          const tmp = pageW;
          pageW = pageH;
          pageH = tmp;
        }
      }

      let scaleFactor = 1;
      const scaleX = availableCellWidthMm / Math.max(1, pageW);
      const scaleY = availableCellHeightMm / Math.max(1, pageH);

      // A cropped page is fitted automatically to its cell.
      const hasCrop = crop.top + crop.right + crop.bottom + crop.left > 0;
      switch (hasCrop ? 'fit' : layout.scaleMode) {
        case 'fit':
          scaleFactor = Math.min(scaleX, scaleY);
          break;
        case 'fill':
          scaleFactor = Math.max(scaleX, scaleY);
          break;
        case 'original':
          scaleFactor = 1;
          break;
        case 'custom':
          scaleFactor = Math.max(0.05, layout.customScalePercent / 100);
          break;
      }

      return {
        cellIndex: slot.cellIndex,
        row: slot.row,
        col: slot.col,
        page,
        globalPageNumber,
        cellXMm: slot.cellXMm,
        cellYMm: slot.cellYMm,
        cellWidthMm: slot.cellWidthMm,
        cellHeightMm: slot.cellHeightMm,
        pageW,
        pageH,
        scaleFactor,
        effectiveRotation,
      };
    });

    // D2: If uniqueScale is enabled, unify all populated cells on the sheet to the minimum scale factor
    const populatedScales = rawPlacements
      .filter((p) => p.page !== null)
      .map((p) => p.scaleFactor);
    const unifiedScale =
      layout.uniqueScale && populatedScales.length > 0
        ? Math.min(...populatedScales)
        : null;

    const cells: ComputedCellPlacement[] = rawPlacements.map((item) => {
      if (!item.page) {
        return {
          cellIndex: item.cellIndex,
          row: item.row,
          col: item.col,
          page: null,
          globalPageNumber: null,
          cellXMm: item.cellXMm,
          cellYMm: item.cellYMm,
          cellWidthMm: item.cellWidthMm,
          cellHeightMm: item.cellHeightMm,
          contentXMm: item.cellXMm,
          contentYMm: item.cellYMm,
          contentWidthMm: 0,
          contentHeightMm: 0,
          scaleFactor: 1,
          effectiveRotation: 0,
        };
      }

      const finalScale = unifiedScale ?? item.scaleFactor;
      const rawContentW = item.pageW * finalScale;
      const rawContentH = item.pageH * finalScale;
      // The cell itself is already reduced by the booklet margins above.
      // Fit the page to that geometry exactly as the spine gap reduces cell width. 
      const availableWidthMm = Math.max(1, item.cellWidthMm);
      const availableHeightMm = Math.max(1, item.cellHeightMm);
      const contentWidthMm =
        layout.scaleMode === 'fit'
          ? Math.min(availableWidthMm, rawContentW)
          : rawContentW;
      const contentHeightMm =
        layout.scaleMode === 'fit'
          ? Math.min(availableHeightMm, rawContentH)
          : rawContentH;

      const { offsetX, offsetY } = computeAlignedOffset(
        availableWidthMm,
        availableHeightMm,
        contentWidthMm,
        contentHeightMm,
        layout.alignment
      );

      const creepShift = layout.booklet?.enabled && layout.booklet.compensateCreep
        ? Math.max(0, sheetNumber - 1) * Math.max(0, layout.booklet.creepMm)
        : 0;
      const occurrenceKey = cellOccurrenceKey(item.page.id, layout.placementMode, item.row, item.col);
      const override = layout.cellOverrides?.[occurrenceKey];
      const transform = override?.transform ?? item.page.overrides?.transform ?? IDENTITY_TRANSFORM;
      const finalWidth = contentWidthMm * Math.max(0.05, Math.min(10, transform.scaleX));
      const finalHeight = contentHeightMm * Math.max(0.05, Math.min(10, transform.scaleY));
      return {
        cellIndex: item.cellIndex,
        row: item.row,
        col: item.col,
        page: item.page,
        globalPageNumber: item.globalPageNumber,
        cellXMm: item.cellXMm,
        cellYMm: item.cellYMm,
        cellWidthMm: item.cellWidthMm,
        cellHeightMm: item.cellHeightMm,
        contentXMm: item.cellXMm + offsetX + (contentWidthMm - finalWidth) / 2 + transform.x * item.cellWidthMm + (layout.booklet?.enabled ? (item.col === 0 ? -creepShift : creepShift) : 0),
        contentYMm: item.cellYMm + offsetY + (contentHeightMm - finalHeight) / 2 + transform.y * item.cellHeightMm,
        contentWidthMm: finalWidth,
        contentHeightMm: finalHeight,
        scaleFactor: finalScale,
        effectiveRotation: item.effectiveRotation,
        occurrenceKey,
        transform,
        zIndex: override?.zIndex,
        allowOverflow: override?.transform ? override.allowOverflow !== false : !!item.page.overrides?.transform,
      };
    });

    sheets.push({
      sheetNumber,
      side,
      sideIndex: sideIdx + 1,
      widthMm: sheetW,
      heightMm: sheetH,
      marginsMm: sideMargins,
      cells,
    });
  });

  return sheets;
}

/**
 * Removes trailing auto-padded empty back sides added only for duplex pair completeness
 * when printing or exporting PDF so odd-sided jobs do not eject a blank final sheet.
 */
export function stripTrailingEmptyDuplexSides(
  sheets: ComputedSheetSide[],
  duplexMode: LayoutSettings['duplexMode'],
  hasSheetOverlay?: (side: ComputedSheetSide, originalTotalSides: number) => boolean
): ComputedSheetSide[] {
  if (duplexMode === 'none' || sheets.length <= 1) return sheets;
  const originalTotal = sheets.length;
  const trimmed = sheets.slice();
  while (trimmed.length > 1) {
    const last = trimmed[trimmed.length - 1];
    if (last.cells.some((c) => c.page !== null)) break;
    if (hasSheetOverlay?.(last, originalTotal)) break;
    trimmed.pop();
  }
  return trimmed;
}

/**
 * D5: Manual Duplex Pass Helper
 * Splits computed sheets into Pass 1 (Odd/Front sides) and Pass 2 (Even/Back sides)
 * with exact instructions on how to flip the stack for the tray.
 */
export function computeManualDuplexPasses(
  sheets: ComputedSheetSide[],
  duplexMode: LayoutSettings['duplexMode']
): {
  pass1FrontSides: ComputedSheetSide[];
  pass2BackSides: ComputedSheetSide[];
  flipInstructionFa: string;
  flipInstructionEn: string;
} {
  const pass1FrontSides = sheets.filter((s) => s.side === 'front');
  const pass2BackSides = sheets.filter((s) => s.side === 'back').slice().reverse();

  const isShortEdge = duplexMode === 'short-edge';
  return {
    pass1FrontSides,
    pass2BackSides,
    flipInstructionFa: isShortEdge
      ? 'پس از پایان مرحله اول، دسته کاغذ را بدون چرخاندن ساعت‌گرد، از لبه کوتاه (بالا به پایین) برگردانید و دوباره در سینی پرینتر قرار دهید.'
      : 'پس از پایان مرحله اول، دسته کاغذ را حول لبه بلند (مانند ورق زدن کتاب) برگردانید و دوباره در سینی پرینتر قرار دهید.',
    flipInstructionEn: isShortEdge
      ? 'After Pass 1 completes, flip the paper stack over the SHORT edge (top-to-bottom) and reload into the input tray.'
      : 'After Pass 1 completes, flip the paper stack over the LONG edge (like turning a book page) and reload into the input tray.',
  };
}

export function convertMmToUnit(mm: number, unit: MeasurementUnit): number {
  switch (unit) {
    case 'cm':
      return Number((mm / 10).toFixed(2));
    case 'inch':
      return Number((mm / 25.4).toFixed(2));
    case 'mm':
    default:
      return Number(mm.toFixed(1));
  }
}
