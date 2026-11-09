/**
 * PrintStudio Pro — Imposition & Page Layout Engine (D1 - D5)
 * Calculates exact WYSIWYG cell coordinates, N-Up matrices up to 10×10,
 * Step & Repeat, Unique Scale, Margins, Gutters, Auto-Rotate, and Duplex sheet ordering.
 */

import { IDENTITY_TRANSFORM, pageCropFractions } from './pageGeometry';
import {
  STANDARD_PAPER_SIZES,
  type CellAlignment,
  type ComputedCellPlacement,
  type ComputedSheetSide,
  type LayoutSettings,
  type MeasurementUnit,
  type PageItem,
  type PageRotation,
  type SheetOrderMode,
} from '@shared/models';

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

  if (layout.orientation === 'landscape') {
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
  const safeRows = Math.max(1, Math.min(10, Math.floor(rows)));
  const safeCols = Math.max(1, Math.min(10, Math.floor(cols)));
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
  const activePages = pages.filter((p) => p.selectedForPrint);
  const { widthMm: sheetW, heightMm: sheetH } = getSheetDimensionsMm(layout);

  const rows = Math.max(1, Math.min(10, Math.floor(layout.rows)));
  const cols = Math.max(1, Math.min(10, Math.floor(layout.cols)));
  const cellsPerSide = rows * cols;

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

  // Build chunks of pages per sheet side
  const sidePageGroups: Array<Array<{ page: PageItem; globalPageNumber: number } | null>> = [];

  if (layout.placementMode === 'step-and-repeat') {
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

    // First pass: calculate individual scale factors & rotations
    const rawPlacements = orderedGrid.map((coord, cellIndex) => {
      const entry = group[cellIndex] ?? null;
      const cellXMm =
        layout.marginsMm.left +
        coord.col * (cellWidthMm + Math.max(0, layout.horizontalGutterMm));
      const cellYMm =
        layout.marginsMm.top +
        coord.row * (cellHeightMm + Math.max(0, layout.verticalGutterMm));

      if (!entry) {
        return {
          cellIndex,
          row: coord.row,
          col: coord.col,
          page: null,
          globalPageNumber: null,
          cellXMm,
          cellYMm,
          cellWidthMm,
          cellHeightMm,
          pageW: cellWidthMm,
          pageH: cellHeightMm,
          scaleFactor: 1,
          effectiveRotation: 0 as PageRotation,
        };
      }

      const { page, globalPageNumber } = entry;
      let effectiveRotation: PageRotation = page.rotation;
      const crop = pageCropFractions(page);
      const croppedWidth = page.widthMm * (1 - crop.left - crop.right);
      const croppedHeight = page.heightMm * (1 - crop.top - crop.bottom);
      const isRotated90 = effectiveRotation === 90 || effectiveRotation === 270;
      let pageW = isRotated90 ? croppedHeight : croppedWidth;
      let pageH = isRotated90 ? croppedWidth : croppedHeight;

      // D3: Auto-rotate page to best fit the cell aspect ratio
      if (layout.autoRotateToFit && !page.overrides?.manualRotation) {
        const cellIsLandscape = cellWidthMm > cellHeightMm;
        const pageIsLandscape = pageW > pageH;
        if (cellIsLandscape !== pageIsLandscape && Math.abs(cellWidthMm - cellHeightMm) > 2) {
          effectiveRotation = ((effectiveRotation + 90) % 360) as PageRotation;
          const tmp = pageW;
          pageW = pageH;
          pageH = tmp;
        }
      }

      let scaleFactor = 1;
      const scaleX = cellWidthMm / Math.max(1, pageW);
      const scaleY = cellHeightMm / Math.max(1, pageH);

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
        cellIndex,
        row: coord.row,
        col: coord.col,
        page,
        globalPageNumber,
        cellXMm,
        cellYMm,
        cellWidthMm,
        cellHeightMm,
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
      const contentWidthMm =
        layout.scaleMode === 'fit'
          ? Math.min(item.cellWidthMm, rawContentW)
          : rawContentW;
      const contentHeightMm =
        layout.scaleMode === 'fit'
          ? Math.min(item.cellHeightMm, rawContentH)
          : rawContentH;

      const { offsetX, offsetY } = computeAlignedOffset(
        item.cellWidthMm,
        item.cellHeightMm,
        contentWidthMm,
        contentHeightMm,
        layout.alignment
      );

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
        contentXMm: item.cellXMm + offsetX + (contentWidthMm - finalWidth) / 2 + transform.x * item.cellWidthMm,
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
      cells,
    });
  });

  return sheets;
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
