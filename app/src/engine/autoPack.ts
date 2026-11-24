import { pageCropFractions } from './pageGeometry';
import type { CustomCellSlot, MarginsMm, MeasurementUnit, PageItem } from '@shared/models';

export const MAX_IMPOSITION_GRID = 100;
export const MIN_PACK_ITEM_MM = 5;
export const MAX_PACK_ITEM_MM = 2000;

const round2 = (value: number): number => Math.round(value * 100) / 100;
const floor2 = (value: number): number => Math.floor(value * 100 + 1e-6) / 100;
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
  isHybrid: boolean;
  slots?: CustomCellSlot[];
  cellWidthMm: number;
  cellHeightMm: number;
  horizontalGutterMm: number;
  verticalGutterMm: number;
  marginsMm: MarginsMm;
  utilizationPercent: number;
}

interface PackZone {
  x: number;
  y: number;
  cols: number;
  rows: number;
  w: number;
  h: number;
  rotated90: boolean;
}

interface PackCandidate {
  total: number;
  zonesCount: number;
  primaryRotated90: boolean;
  rows: number;
  cols: number;
  cellW: number;
  cellH: number;
  usedW: number;
  usedH: number;
  zones: PackZone[];
}

function fitCount(avail: number, item: number, gap: number): number {
  const eps = 1e-4;
  if (item > avail + eps || item <= 0) return 0;
  return Math.min(MAX_IMPOSITION_GRID, Math.max(0, Math.floor((avail + gap + eps) / (item + gap))));
}

function spanLen(count: number, item: number, gap: number): number {
  return count <= 0 ? 0 : count * item + (count - 1) * gap;
}

function bestUniformZone(
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  w0: number,
  h0: number,
  gx: number,
  gy: number,
  allowRotate: boolean,
  preferRotated: boolean
): PackZone | null {
  const c0 = fitCount(boxW, w0, gx);
  const r0 = fitCount(boxH, h0, gy);
  const t0 = c0 * r0;

  let c90 = 0;
  let r90 = 0;
  let t90 = 0;
  if (allowRotate && Math.abs(w0 - h0) > 0.01) {
    c90 = fitCount(boxW, h0, gx);
    r90 = fitCount(boxH, w0, gy);
    t90 = c90 * r90;
  }

  if (t0 === 0 && t90 === 0) return null;
  const pick90 = t90 > t0 || (t90 === t0 && preferRotated && t90 > 0);
  return pick90
    ? { x: boxX, y: boxY, cols: c90, rows: r90, w: h0, h: w0, rotated90: true }
    : { x: boxX, y: boxY, cols: c0, rows: r0, w: w0, h: h0, rotated90: false };
}

function isBetterCandidate(a: PackCandidate, b: PackCandidate | null): boolean {
  if (!b) return true;
  if (a.total !== b.total) return a.total > b.total;
  if (a.zonesCount !== b.zonesCount) return a.zonesCount < b.zonesCount;
  if (a.zonesCount === 1 && b.zonesCount === 1 && a.primaryRotated90 !== b.primaryRotated90) {
    return !a.primaryRotated90;
  }
  const areaA = a.usedW * a.usedH;
  const areaB = b.usedW * b.usedH;
  return areaA < areaB - 1e-3;
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
  const w0 = round2(clampDim(Number.isFinite(input.itemWidthMm) ? input.itemWidthMm : MIN_PACK_ITEM_MM));
  const h0 = round2(clampDim(Number.isFinite(input.itemHeightMm) ? input.itemHeightMm : MIN_PACK_ITEM_MM));

  let best: PackCandidate | null = null;

  const tryRegister = (zonesRaw: PackZone[]) => {
    const zones = zonesRaw.filter((z) => z.cols > 0 && z.rows > 0);
    if (zones.length === 0) return;
    let total = 0;
    let maxRight = 0;
    let maxBottom = 0;
    for (const z of zones) {
      total += z.cols * z.rows;
      maxRight = Math.max(maxRight, z.x + spanLen(z.cols, z.w, gx));
      maxBottom = Math.max(maxBottom, z.y + spanLen(z.rows, z.h, gy));
    }
    if (total <= 0 || total > MAX_IMPOSITION_GRID * MAX_IMPOSITION_GRID) return;
    const primary = zones[0];
    const candidate: PackCandidate = {
      total,
      zonesCount: zones.length,
      primaryRotated90: primary.rotated90,
      rows: zones.length === 1 ? primary.rows : Math.max(1, Math.min(MAX_IMPOSITION_GRID, zones.reduce((m, z) => Math.max(m, z.rows), 1))),
      cols: zones.length === 1 ? primary.cols : Math.max(1, Math.min(MAX_IMPOSITION_GRID, Math.ceil(total / Math.max(1, zones.reduce((m, z) => Math.max(m, z.rows), 1))))),
      cellW: primary.w,
      cellH: primary.h,
      usedW: maxRight,
      usedH: maxBottom,
      zones,
    };
    if (isBetterCandidate(candidate, best)) {
      best = candidate;
    }
  };

  // 1) Uniform 0° and 90° grids
  {
    const c0 = fitCount(availW, w0, gx);
    const r0 = fitCount(availH, h0, gy);
    if (c0 > 0 && r0 > 0) {
      tryRegister([{ x: 0, y: 0, cols: c0, rows: r0, w: w0, h: h0, rotated90: false }]);
    }
    if (input.allowRotateForMax && Math.abs(w0 - h0) > 0.01) {
      const c90 = fitCount(availW, h0, gx);
      const r90 = fitCount(availH, w0, gy);
      if (c90 > 0 && r90 > 0) {
        tryRegister([{ x: 0, y: 0, cols: c90, rows: r90, w: h0, h: w0, rotated90: true }]);
      }
    }
  }

  // 2) Hybrid mixed-orientation 2-zone & 3-zone guillotine partitions
  if (input.allowRotateForMax && Math.abs(w0 - h0) > 0.01 && availW > 0 && availH > 0) {
    for (const baseRotated of [false, true]) {
      const bw = baseRotated ? h0 : w0;
      const bh = baseRotated ? w0 : h0;
      const ow = baseRotated ? w0 : h0;
      const oh = baseRotated ? h0 : w0;
      const maxC = fitCount(availW, bw, gx);
      const maxR = fitCount(availH, bh, gy);
      if (maxC <= 0 || maxR <= 0) continue;

      for (let c1 = 1; c1 <= maxC; c1++) {
        const wA = spanLen(c1, bw, gx);
        const remW = availW - wA - gx;
        for (let r1 = 1; r1 <= maxR; r1++) {
          const hA = spanLen(r1, bh, gy);
          const remH = availH - hA - gy;

          const primary: PackZone = {
            x: 0,
            y: 0,
            cols: c1,
            rows: r1,
            w: bw,
            h: bh,
            rotated90: baseRotated,
          };

          // Vertical guillotine split: Right full-height strip + optional Bottom-Left strip under Primary
          const rightFull =
            remW > 0
              ? bestUniformZone(wA + gx, 0, remW, availH, w0, h0, gx, gy, true, !baseRotated)
              : null;
          const bottomLeft =
            remH > 0
              ? bestUniformZone(0, hA + gy, wA, remH, w0, h0, gx, gy, true, !baseRotated)
              : null;

          if (rightFull && bottomLeft) {
            tryRegister([primary, rightFull, bottomLeft]);
          } else if (rightFull) {
            tryRegister([primary, rightFull]);
          } else if (bottomLeft) {
            tryRegister([primary, bottomLeft]);
          }

          // Horizontal guillotine split: Bottom full-width strip + optional Right-Top strip beside Primary
          const bottomFull =
            remH > 0
              ? bestUniformZone(0, hA + gy, availW, remH, w0, h0, gx, gy, true, !baseRotated)
              : null;
          const rightTop =
            remW > 0
              ? bestUniformZone(wA + gx, 0, remW, hA, w0, h0, gx, gy, true, !baseRotated)
              : null;

          if (bottomFull && rightTop) {
            tryRegister([primary, bottomFull, rightTop]);
          } else if (bottomFull) {
            tryRegister([primary, bottomFull]);
          }
        }
      }
    }
  }

  const chosen = best as PackCandidate | null;
  if (!chosen || chosen.total <= 0) {
    return {
      fits: false,
      rows: 1,
      cols: 1,
      totalPerSheet: 0,
      rotated90: false,
      isHybrid: false,
      cellWidthMm: round2(w0),
      cellHeightMm: round2(h0),
      horizontalGutterMm: round2(gx),
      verticalGutterMm: round2(gy),
      marginsMm: baseMargins,
      utilizationPercent: 0,
    };
  }

  const leftoverW = Math.max(0, availW - chosen.usedW);
  const leftoverH = Math.max(0, availH - chosen.usedH);

  const left = round2(input.centerOnSheet ? baseMargins.left + leftoverW / 2 : baseMargins.left);
  const right = Math.max(baseMargins.right, floor2(sheetW - left - chosen.usedW));
  const top = round2(input.centerOnSheet ? baseMargins.top + leftoverH / 2 : baseMargins.top);
  const bottom = Math.max(baseMargins.bottom, floor2(sheetH - top - chosen.usedH));

  const utilizationPercent =
    Math.round(((chosen.total * w0 * h0) / Math.max(1, sheetW * sheetH)) * 1000) / 10;

  const isHybrid = chosen.zones.length > 1;
  let slots: CustomCellSlot[] | undefined;
  if (isHybrid) {
    slots = [];
    let cellIndex = 0;
    for (let zIdx = 0; zIdx < chosen.zones.length; zIdx++) {
      const z = chosen.zones[zIdx];
      for (let r = 0; r < z.rows; r++) {
        for (let c = 0; c < z.cols; c++) {
          slots.push({
            cellIndex,
            row: zIdx * 100 + r,
            col: c,
            xMm: round2(z.x + c * (z.w + gx)),
            yMm: round2(z.y + r * (z.h + gy)),
            widthMm: round2(z.w),
            heightMm: round2(z.h),
            rotated90: z.rotated90,
          });
          cellIndex++;
        }
      }
    }
  }

  return {
    fits: true,
    rows: chosen.rows,
    cols: chosen.cols,
    totalPerSheet: chosen.total,
    rotated90: chosen.primaryRotated90,
    isHybrid,
    ...(slots ? { slots } : {}),
    cellWidthMm: round2(chosen.cellW),
    cellHeightMm: round2(chosen.cellH),
    horizontalGutterMm: round2(gx),
    verticalGutterMm: round2(gy),
    marginsMm: { top, right, bottom, left },
    utilizationPercent,
  };
}

