import { pageCropFractions } from './pageGeometry';
import type { MarginsMm, MeasurementUnit, PageItem } from '@shared/models';

export const MAX_IMPOSITION_GRID = 50;
export const MIN_PACK_ITEM_MM = 5;
export const MAX_PACK_ITEM_MM = 2000;

const round2 = (value: number): number => Math.round(value * 100) / 100;
const clampDim = (value: number): number =>
  Math.max(MIN_PACK_ITEM_MM, Math.min(MAX_PACK_ITEM_MM, value));

export function convertUnitToMm(value: number, unit: MeasurementUnit): number {
  if (!Number.isFinite(value)) return 0;
  switch (unit) {
    case 'cm':
      return value * 10;
    case 'inch':
      return value * 25.4;
    case 'mm':
    default:
      return value;
  }
}

export function getPageDisplayDimensionsMm(
  page: Pick<PageItem, 'widthMm' | 'heightMm' | 'rotation' | 'overrides'>
): {
  widthMm: number;
  heightMm: number;
  aspectRatio: number;
} {
  const crop = pageCropFractions(page as PageItem);
  const croppedW = Math.max(1, page.widthMm * (1 - crop.left - crop.right));
  const croppedH = Math.max(1, page.heightMm * (1 - crop.top - crop.bottom));
  const isRot90 = page.rotation === 90 || page.rotation === 270;
  const widthMm = isRot90 ? croppedH : croppedW;
  const heightMm = isRot90 ? croppedW : croppedH;
  return {
    widthMm: round2(widthMm),
    heightMm: round2(heightMm),
    aspectRatio: widthMm / Math.max(0.1, heightMm),
  };
}

export function resolveAutoPackTargetDimensions(params: {
  sourceWidthMm: number;
  sourceHeightMm: number;
  driver: 'width' | 'height';
  targetWidthMm?: number;
  targetHeightMm?: number;
  lockAspect: boolean;
}): { widthMm: number; heightMm: number } {
  const ratio = Math.max(0.05, params.sourceWidthMm) / Math.max(0.05, params.sourceHeightMm);
  const rawW = params.targetWidthMm ?? params.sourceWidthMm;
  const rawH = params.targetHeightMm ?? params.sourceHeightMm;

  if (!params.lockAspect) {
    return {
      widthMm: round2(clampDim(Number.isFinite(rawW) ? rawW : params.sourceWidthMm)),
      heightMm: round2(clampDim(Number.isFinite(rawH) ? rawH : params.sourceHeightMm)),
    };
  }

  if (params.driver === 'width') {
    const widthMm = clampDim(Number.isFinite(rawW) ? rawW : params.sourceWidthMm);
    const heightMm = clampDim(widthMm / ratio);
    return {
      widthMm: round2(widthMm),
      heightMm: round2(heightMm),
    };
  }

  const heightMm = clampDim(Number.isFinite(rawH) ? rawH : params.sourceHeightMm);
  const widthMm = clampDim(heightMm * ratio);
  return {
    widthMm: round2(widthMm),
    heightMm: round2(heightMm),
  };
}

export interface AutoPackPlanInput {
  sheetWidthMm: number;
  sheetHeightMm: number;
  baseMarginsMm: MarginsMm;
  itemWidthMm: number;
  itemHeightMm: number;
  horizontalGapMm: number;
  verticalGapMm: number;
  allowRotateForMax: boolean;
  centerOnSheet: boolean;
}

export interface AutoPackPlan {
  fits: boolean;
  rows: number;
  cols: number;
  totalPerSheet: number;
  rotated90: boolean;
  cellWidthMm: number;
  cellHeightMm: number;
  horizontalGutterMm: number;
  verticalGutterMm: number;
  marginsMm: MarginsMm;
  utilizationPercent: number;
}

interface OrientationCandidate {
  rows: number;
  cols: number;
  total: number;
  w: number;
  h: number;
  rotated90: boolean;
}

export function computeAutoPackPlan(input: AutoPackPlanInput): AutoPackPlan {
  const baseMargins: MarginsMm = {
    top: Math.max(0, Number.isFinite(input.baseMarginsMm.top) ? input.baseMarginsMm.top : 0),
    right: Math.max(0, Number.isFinite(input.baseMarginsMm.right) ? input.baseMarginsMm.right : 0),
    bottom: Math.max(0, Number.isFinite(input.baseMarginsMm.bottom) ? input.baseMarginsMm.bottom : 0),
    left: Math.max(0, Number.isFinite(input.baseMarginsMm.left) ? input.baseMarginsMm.left : 0),
  };

  const sheetW = Math.max(10, input.sheetWidthMm);
  const sheetH = Math.max(10, input.sheetHeightMm);
  const availW = Math.max(0, sheetW - baseMargins.left - baseMargins.right);
  const availH = Math.max(0, sheetH - baseMargins.top - baseMargins.bottom);
  const gx = Math.max(0, Math.min(200, Number.isFinite(input.horizontalGapMm) ? input.horizontalGapMm : 0));
  const gy = Math.max(0, Math.min(200, Number.isFinite(input.verticalGapMm) ? input.verticalGapMm : 0));
  const w0 = clampDim(Number.isFinite(input.itemWidthMm) ? input.itemWidthMm : MIN_PACK_ITEM_MM);
  const h0 = clampDim(Number.isFinite(input.itemHeightMm) ? input.itemHeightMm : MIN_PACK_ITEM_MM);

  const evaluate = (w: number, h: number, rotated90: boolean): OrientationCandidate => {
    const eps = 1e-6;
    const cols =
      w <= availW + eps
        ? Math.min(MAX_IMPOSITION_GRID, Math.max(0, Math.floor((availW + gx + eps) / (w + gx))))
        : 0;
    const rows =
      h <= availH + eps
        ? Math.min(MAX_IMPOSITION_GRID, Math.max(0, Math.floor((availH + gy + eps) / (h + gy))))
        : 0;
    return {
      rows,
      cols,
      total: rows * cols,
      w,
      h,
      rotated90,
    };
  };

  const normal = evaluate(w0, h0, false);
  const rotated = input.allowRotateForMax ? evaluate(h0, w0, true) : null;
  const best = rotated && rotated.total > normal.total ? rotated : normal;

  if (best.total <= 0) {
    return {
      fits: false,
      rows: 1,
      cols: 1,
      totalPerSheet: 0,
      rotated90: false,
      cellWidthMm: round2(w0),
      cellHeightMm: round2(h0),
      horizontalGutterMm: round2(gx),
      verticalGutterMm: round2(gy),
      marginsMm: baseMargins,
      utilizationPercent: 0,
    };
  }

  const usedW = best.cols * best.w + Math.max(0, best.cols - 1) * gx;
  const usedH = best.rows * best.h + Math.max(0, best.rows - 1) * gy;
  const leftoverW = Math.max(0, availW - usedW);
  const leftoverH = Math.max(0, availH - usedH);

  const left = round2(input.centerOnSheet ? baseMargins.left + leftoverW / 2 : baseMargins.left);
  const right = round2(Math.max(baseMargins.right, sheetW - left - usedW));
  const top = round2(input.centerOnSheet ? baseMargins.top + leftoverH / 2 : baseMargins.top);
  const bottom = round2(Math.max(baseMargins.bottom, sheetH - top - usedH));

  const utilizationPercent =
    Math.round(((best.total * best.w * best.h) / Math.max(1, sheetW * sheetH)) * 1000) / 10;

  return {
    fits: true,
    rows: best.rows,
    cols: best.cols,
    totalPerSheet: best.total,
    rotated90: best.rotated90,
    cellWidthMm: round2(best.w),
    cellHeightMm: round2(best.h),
    horizontalGutterMm: round2(gx),
    verticalGutterMm: round2(gy),
    marginsMm: { top, right, bottom, left },
    utilizationPercent,
  };
}
