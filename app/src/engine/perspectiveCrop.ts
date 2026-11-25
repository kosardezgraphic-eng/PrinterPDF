/**
 * Perspective Crop & Planar Homography Rectification Engine
 * Allows placing 4 arbitrary corners on a skewed/tilted document (raster image or PDF page)
 * and rectifying it via exact projective homography + bilinear resampling into a flat document.
 */
import type { PageItem, PageRotation, SourceDocument } from '@shared/models';
import { decodeUniversalImageToPages, encodeRgbaToPngBytesUniversal } from './universalImageDecoder';

export interface NormalizedPoint {
  x: number;
  y: number;
}

export type PerspectiveCornerKey = 'tl' | 'tr' | 'br' | 'bl';

export interface PerspectiveQuad {
  tl: NormalizedPoint;
  tr: NormalizedPoint;
  br: NormalizedPoint;
  bl: NormalizedPoint;
}

export type PerspectiveAspectPreset =
  | 'auto'
  | 'a4-portrait'
  | 'a4-landscape'
  | 'a5-portrait'
  | 'a5-landscape'
  | 'card-landscape'
  | 'card-portrait'
  | 'square'
  | 'custom';

export interface PerspectiveAspectOption {
  id: PerspectiveAspectPreset;
  labelFa: string;
  labelEn: string;
  ratio?: number;
  fixedMm?: { widthMm: number; heightMm: number };
}

export const PERSPECTIVE_ASPECT_OPTIONS: PerspectiveAspectOption[] = [
  { id: 'auto', labelFa: 'خودکار (تشخیص از ۴ نقطه)', labelEn: 'Auto (from 4 corners)' },
  {
    id: 'a4-portrait',
    labelFa: 'A4 عمودی (۲۱۰×۲۹۷)',
    labelEn: 'A4 Portrait (210×297 mm)',
    ratio: 210 / 297,
    fixedMm: { widthMm: 210, heightMm: 297 },
  },
  {
    id: 'a4-landscape',
    labelFa: 'A4 افقی (۲۹۷×۲۱۰)',
    labelEn: 'A4 Landscape (297×210 mm)',
    ratio: 297 / 210,
    fixedMm: { widthMm: 297, heightMm: 210 },
  },
  {
    id: 'a5-portrait',
    labelFa: 'A5 عمودی (۱۴۸×۲۱۰)',
    labelEn: 'A5 Portrait (148×210 mm)',
    ratio: 148 / 210,
    fixedMm: { widthMm: 148, heightMm: 210 },
  },
  {
    id: 'a5-landscape',
    labelFa: 'A5 افقی (۲۱۰×۱۴۸)',
    labelEn: 'A5 Landscape (210×148 mm)',
    ratio: 210 / 148,
    fixedMm: { widthMm: 210, heightMm: 148 },
  },
  {
    id: 'card-landscape',
    labelFa: 'کارت ویزیت/شناسایی افقی (۸۵×۵۵)',
    labelEn: 'ID / Business Card (85×55 mm)',
    ratio: 85 / 55,
    fixedMm: { widthMm: 85, heightMm: 55 },
  },
  {
    id: 'card-portrait',
    labelFa: 'کارت ویزیت/شناسایی عمودی (۵۵×۸۵)',
    labelEn: 'Card Portrait (55×85 mm)',
    ratio: 55 / 85,
    fixedMm: { widthMm: 55, heightMm: 85 },
  },
  {
    id: 'square',
    labelFa: 'مربع ۱:۱',
    labelEn: 'Square 1:1',
    ratio: 1,
  },
  {
    id: 'custom',
    labelFa: 'نسبت / ابعاد سفارشی',
    labelEn: 'Custom ratio',
  },
];

export const DEFAULT_PERSPECTIVE_QUAD: PerspectiveQuad = {
  tl: { x: 0, y: 0 },
  tr: { x: 1, y: 0 },
  br: { x: 1, y: 1 },
  bl: { x: 0, y: 1 },
};

export function clonePerspectiveQuad(quad: PerspectiveQuad): PerspectiveQuad {
  return {
    tl: { ...quad.tl },
    tr: { ...quad.tr },
    br: { ...quad.br },
    bl: { ...quad.bl },
  };
}

export function clampPoint01(p: NormalizedPoint): NormalizedPoint {
  return {
    x: Number.isFinite(p.x) ? Math.max(0, Math.min(1, p.x)) : 0,
    y: Number.isFinite(p.y) ? Math.max(0, Math.min(1, p.y)) : 0,
  };
}

export function isDefaultPerspectiveQuad(quad: PerspectiveQuad, eps = 1e-3): boolean {
  return (
    Math.abs(quad.tl.x) < eps &&
    Math.abs(quad.tl.y) < eps &&
    Math.abs(quad.tr.x - 1) < eps &&
    Math.abs(quad.tr.y) < eps &&
    Math.abs(quad.br.x - 1) < eps &&
    Math.abs(quad.br.y - 1) < eps &&
    Math.abs(quad.bl.x) < eps &&
    Math.abs(quad.bl.y - 1) < eps
  );
}

/**
 * Checks that the 4 corners form a non-degenerate, non-self-intersecting convex quadrilateral.
 */
export function isConvexQuad(quad: PerspectiveQuad, minArea = 1e-4): boolean {
  const pts = [quad.tl, quad.tr, quad.br, quad.bl];
  let sign = 0;
  let twiceArea = 0;
  for (let i = 0; i < 4; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % 4];
    const p2 = pts[(i + 2) % 4];
    const dx1 = p1.x - p0.x;
    const dy1 = p1.y - p0.y;
    const dx2 = p2.x - p1.x;
    const dy2 = p2.y - p1.y;
    const cross = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(cross) < 1e-7) return false;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
    twiceArea += p0.x * p1.y - p1.x * p0.y;
  }
  return Math.abs(twiceArea) * 0.5 >= minArea;
}

/**
 * Maps a normalized point in display-rotated space back to unrotated source image space.
 */
export function displayPointToSource(pt: NormalizedPoint, rotation: PageRotation): NormalizedPoint {
  switch (rotation) {
    case 90:
      return { x: pt.y, y: 1 - pt.x };
    case 180:
      return { x: 1 - pt.x, y: 1 - pt.y };
    case 270:
      return { x: 1 - pt.y, y: pt.x };
    default:
      return { ...pt };
  }
}

export function sourcePointToDisplay(pt: NormalizedPoint, rotation: PageRotation): NormalizedPoint {
  switch (rotation) {
    case 90:
      return { x: 1 - pt.y, y: pt.x };
    case 180:
      return { x: 1 - pt.x, y: 1 - pt.y };
    case 270:
      return { x: pt.y, y: 1 - pt.x };
    default:
      return { ...pt };
  }
}

export function displayQuadToSourceQuad(quad: PerspectiveQuad, rotation: PageRotation): PerspectiveQuad {
  return {
    tl: displayPointToSource(quad.tl, rotation),
    tr: displayPointToSource(quad.tr, rotation),
    br: displayPointToSource(quad.br, rotation),
    bl: displayPointToSource(quad.bl, rotation),
  };
}

export interface ProjectiveHomography {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
  h: number;
}

/**
 * Computes exact planar projective homography mapping unit square (u, v) in [0,1]^2
 * -> quad (x0..x3, y0..y3) using Heckbert's algebraic formulation.
 * (0,0)->tl, (1,0)->tr, (1,1)->br, (0,1)->bl.
 */
export function solveUnitSquareToQuadHomography(quad: PerspectiveQuad): ProjectiveHomography {
  const { tl, tr, br, bl } = quad;
  const x0 = tl.x, y0 = tl.y;
  const x1 = tr.x, y1 = tr.y;
  const x2 = br.x, y2 = br.y;
  const x3 = bl.x, y3 = bl.y;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;

  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    return {
      a: x1 - x0,
      b: x3 - x0,
      c: x0,
      d: y1 - y0,
      e: y3 - y0,
      f: y0,
      g: 0,
      h: 0,
    };
  }

  const denom = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(denom) < 1e-12) {
    return {
      a: x1 - x0,
      b: x3 - x0,
      c: x0,
      d: y1 - y0,
      e: y3 - y0,
      f: y0,
      g: 0,
      h: 0,
    };
  }

  const g = (dx3 * dy2 - dx2 * dy3) / denom;
  const h = (dx1 * dy3 - dx3 * dy1) / denom;
  return {
    a: x1 - x0 + g * x1,
    b: x3 - x0 + h * x3,
    c: x0,
    d: y1 - y0 + g * y1,
    e: y3 - y0 + h * y3,
    f: y0,
    g,
    h,
  };
}

export function evaluateHomography(H: ProjectiveHomography, u: number, v: number): NormalizedPoint {
  const w = H.g * u + H.h * v + 1;
  if (Math.abs(w) < 1e-12) return { x: H.c, y: H.f };
  return {
    x: (H.a * u + H.b * v + H.c) / w,
    y: (H.d * u + H.e * v + H.f) / w,
  };
}

/**
 * Estimates physical rectified dimensions (pixels & mm) from a quad on a source image.
 */
export function computePerspectiveOutputDimensions(params: {
  sourceWidthPx: number;
  sourceHeightPx: number;
  sourceWidthMm: number;
  sourceHeightMm: number;
  sourceQuad: PerspectiveQuad;
  aspectPreset?: PerspectiveAspectPreset;
  customRatioW?: number;
  customRatioH?: number;
  maxSidePx?: number;
}): { widthPx: number; heightPx: number; widthMm: number; heightMm: number } {
  const {
    sourceWidthPx,
    sourceHeightPx,
    sourceWidthMm,
    sourceHeightMm,
    sourceQuad,
    aspectPreset = 'auto',
    customRatioW,
    customRatioH,
    maxSidePx = 2400,
  } = params;

  const toPx = (p: NormalizedPoint) => ({ x: p.x * sourceWidthPx, y: p.y * sourceHeightPx });
  const toMm = (p: NormalizedPoint) => ({ x: p.x * sourceWidthMm, y: p.y * sourceHeightMm });

  const pTl = toPx(sourceQuad.tl);
  const pTr = toPx(sourceQuad.tr);
  const pBr = toPx(sourceQuad.br);
  const pBl = toPx(sourceQuad.bl);

  const pxTop = Math.hypot(pTr.x - pTl.x, pTr.y - pTl.y);
  const pxBottom = Math.hypot(pBr.x - pBl.x, pBr.y - pBl.y);
  const pxLeft = Math.hypot(pBl.x - pTl.x, pBl.y - pTl.y);
  const pxRight = Math.hypot(pBr.x - pTr.x, pBr.y - pTr.y);

  const mTl = toMm(sourceQuad.tl);
  const mTr = toMm(sourceQuad.tr);
  const mBr = toMm(sourceQuad.br);
  const mBl = toMm(sourceQuad.bl);

  const mmTop = Math.hypot(mTr.x - mTl.x, mTr.y - mTl.y);
  const mmBottom = Math.hypot(mBr.x - mBl.x, mBr.y - mBl.y);
  const mmLeft = Math.hypot(mBl.x - mTl.x, mBl.y - mTl.y);
  const mmRight = Math.hypot(mBr.x - mTr.x, mBr.y - mTr.y);

  const rawWidthPx = Math.max(8, Math.max(pxTop, pxBottom));
  const rawHeightPx = Math.max(8, Math.max(pxLeft, pxRight));
  const rawWidthMm = Math.max(5, (mmTop + mmBottom) * 0.5);
  const rawHeightMm = Math.max(5, (mmLeft + mmRight) * 0.5);

  const option = PERSPECTIVE_ASPECT_OPTIONS.find((o) => o.id === aspectPreset);
  let targetRatio = rawWidthMm / rawHeightMm;
  let widthMm = rawWidthMm;
  let heightMm = rawHeightMm;

  if (aspectPreset === 'custom' && customRatioW && customRatioH && customRatioW > 0 && customRatioH > 0) {
    targetRatio = customRatioW / customRatioH;
    // Keep major dimension in mm unless both are explicit realistic page sizes >= 10mm
    if (customRatioW >= 10 && customRatioH >= 10) {
      widthMm = customRatioW;
      heightMm = customRatioH;
    } else if (targetRatio >= 1) {
      widthMm = rawWidthMm;
      heightMm = Math.max(5, rawWidthMm / targetRatio);
    } else {
      heightMm = rawHeightMm;
      widthMm = Math.max(5, rawHeightMm * targetRatio);
    }
  } else if (option?.fixedMm) {
    widthMm = option.fixedMm.widthMm;
    heightMm = option.fixedMm.heightMm;
    targetRatio = widthMm / heightMm;
  } else if (option?.ratio) {
    targetRatio = option.ratio;
    if (targetRatio >= 1) {
      widthMm = rawWidthMm;
      heightMm = Math.max(5, rawWidthMm / targetRatio);
    } else {
      heightMm = rawHeightMm;
      widthMm = Math.max(5, rawHeightMm * targetRatio);
    }
  }

  let outW = Math.round(rawWidthPx);
  let outH = Math.round(outW / Math.max(0.05, Math.min(20, targetRatio)));
  if (outH < rawHeightPx && targetRatio < 1) {
    outH = Math.round(rawHeightPx);
    outW = Math.round(outH * targetRatio);
  }
  const scaleDown = Math.min(1, maxSidePx / Math.max(1, outW, outH));
  return {
    widthPx: Math.max(8, Math.round(outW * scaleDown)),
    heightPx: Math.max(8, Math.round(outH * scaleDown)),
    widthMm: Math.round(widthMm * 100) / 100,
    heightMm: Math.round(heightMm * 100) / 100,
  };
}

/**
 * Pure bilinear projective warp on flat RGBA byte buffers.
 * `sourceQuad` is in normalized [0..1] unrotated source coordinates.
 */
export function warpPerspectiveRgba(params: {
  srcRgba: Uint8ClampedArray | Uint8Array;
  srcWidth: number;
  srcHeight: number;
  dstWidth: number;
  dstHeight: number;
  sourceQuad: PerspectiveQuad;
  fillRgba?: [number, number, number, number];
}): Uint8ClampedArray {
  const {
    srcRgba,
    srcWidth,
    srcHeight,
    dstWidth,
    dstHeight,
    sourceQuad,
    fillRgba = [255, 255, 255, 255],
  } = params;

  const pixelQuad: PerspectiveQuad = {
    tl: { x: sourceQuad.tl.x * (srcWidth - 1), y: sourceQuad.tl.y * (srcHeight - 1) },
    tr: { x: sourceQuad.tr.x * (srcWidth - 1), y: sourceQuad.tr.y * (srcHeight - 1) },
    br: { x: sourceQuad.br.x * (srcWidth - 1), y: sourceQuad.br.y * (srcHeight - 1) },
    bl: { x: sourceQuad.bl.x * (srcWidth - 1), y: sourceQuad.bl.y * (srcHeight - 1) },
  };
  const H = solveUnitSquareToQuadHomography(pixelQuad);

  const out = new Uint8ClampedArray(dstWidth * dstHeight * 4);
  const invW = dstWidth > 1 ? 1 / (dstWidth - 1) : 0;
  const invH = dstHeight > 1 ? 1 / (dstHeight - 1) : 0;

  for (let dy = 0; dy < dstHeight; dy++) {
    const v = dy * invH;
    const rowBase = dy * dstWidth * 4;
    const bU = H.b * v + H.c;
    const eU = H.e * v + H.f;
    const hV = H.h * v + 1;

    for (let dx = 0; dx < dstWidth; dx++) {
      const u = dx * invW;
      const w = H.g * u + hV;
      const outIdx = rowBase + dx * 4;
      if (Math.abs(w) < 1e-12) {
        out[outIdx] = fillRgba[0];
        out[outIdx + 1] = fillRgba[1];
        out[outIdx + 2] = fillRgba[2];
        out[outIdx + 3] = fillRgba[3];
        continue;
      }

      const sx = (H.a * u + bU) / w;
      const sy = (H.d * u + eU) / w;

      if (sx < -0.5 || sx > srcWidth - 0.5 || sy < -0.5 || sy > srcHeight - 0.5) {
        out[outIdx] = fillRgba[0];
        out[outIdx + 1] = fillRgba[1];
        out[outIdx + 2] = fillRgba[2];
        out[outIdx + 3] = fillRgba[3];
        continue;
      }

      const clampedX = Math.max(0, Math.min(srcWidth - 1, sx));
      const clampedY = Math.max(0, Math.min(srcHeight - 1, sy));
      const x0 = Math.floor(clampedX);
      const y0 = Math.floor(clampedY);
      const x1 = Math.min(srcWidth - 1, x0 + 1);
      const y1 = Math.min(srcHeight - 1, y0 + 1);
      const fx = clampedX - x0;
      const fy = clampedY - y0;
      const fx1 = 1 - fx;
      const fy1 = 1 - fy;

      const i00 = (y0 * srcWidth + x0) * 4;
      const i10 = (y0 * srcWidth + x1) * 4;
      const i01 = (y1 * srcWidth + x0) * 4;
      const i11 = (y1 * srcWidth + x1) * 4;

      const w00 = fx1 * fy1;
      const w10 = fx * fy1;
      const w01 = fx1 * fy;
      const w11 = fx * fy;

      out[outIdx] = Math.round(
        srcRgba[i00] * w00 + srcRgba[i10] * w10 + srcRgba[i01] * w01 + srcRgba[i11] * w11
      );
      out[outIdx + 1] = Math.round(
        srcRgba[i00 + 1] * w00 +
          srcRgba[i10 + 1] * w10 +
          srcRgba[i01 + 1] * w01 +
          srcRgba[i11 + 1] * w11
      );
      out[outIdx + 2] = Math.round(
        srcRgba[i00 + 2] * w00 +
          srcRgba[i10 + 2] * w10 +
          srcRgba[i01 + 2] * w01 +
          srcRgba[i11 + 2] * w11
      );
      out[outIdx + 3] = Math.round(
        srcRgba[i00 + 3] * w00 +
          srcRgba[i10 + 3] * w10 +
          srcRgba[i01 + 3] * w01 +
          srcRgba[i11 + 3] * w11
      );
    }
  }

  return out;
}

async function decodePngBytesToRgba(
  bytes: Uint8Array
): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
    try {
      const safe = new Uint8Array(bytes.byteLength);
      safe.set(bytes);
      const blob = new Blob([safe.buffer], { type: 'image/png' });
      const bmp = await createImageBitmap(blob);
      try {
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(bmp, 0, 0);
          const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
          return { width: bmp.width, height: bmp.height, rgba: img.data };
        }
      } finally {
        bmp.close?.();
      }
    } catch {
      // Fall through to next decoder
    }
  }

  if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
    const probeCanvas = document.createElement('canvas');
    const has2d = !!probeCanvas.getContext?.('2d');
    if (has2d && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const safe = new Uint8Array(bytes.byteLength);
      safe.set(bytes);
      const url = URL.createObjectURL(new Blob([safe.buffer], { type: 'image/png' }));
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('Failed to decode PNG image'));
          el.src = url;
        });
        const c = document.createElement('canvas');
        c.width = Math.max(1, img.naturalWidth);
        c.height = Math.max(1, img.naturalHeight);
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, c.width, c.height);
          return { width: c.width, height: c.height, rgba: data.data };
        }
      } catch {
        // Fall through to @napi-rs/canvas in headless test environments
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  // Headless Node fallback via @napi-rs/canvas
  const napiPkg = ['@napi-rs', 'canvas'].join('/');
  const mod = (await import(/* @vite-ignore */ napiPkg)) as {
    loadImage: (src: Buffer) => Promise<{ width: number; height: number }>;
    createCanvas: (w: number, h: number) => {
      getContext: (t: '2d') => {
        drawImage: (img: unknown, x: number, y: number, w: number, h: number) => void;
        getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
      };
    };
  };
  const img = await mod.loadImage(Buffer.from(bytes));
  const w = Math.max(1, img.width);
  const h = Math.max(1, img.height);
  const c = mod.createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return { width: w, height: h, rgba: ctx.getImageData(0, 0, w, h).data };
}

async function decodeDataUrlToRgba(
  dataUrl: string
): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return decodePngBytesToRgba(bytes);
}

async function renderSourcePageToRgba(
  page: PageItem,
  sourceDoc: SourceDocument | undefined
): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  if (sourceDoc?.fileType === 'image' && sourceDoc.rawBytes?.length) {
    const pages = await decodeUniversalImageToPages(
      sourceDoc.rawBytes,
      sourceDoc.name,
      sourceDoc.mimeType
    );
    const target = pages[Math.max(0, Math.min(pages.length - 1, page.sourcePageNumber - 1))] ?? pages[0];
    if (target?.bytes?.length) {
      return decodePngBytesToRgba(target.bytes);
    }
  }

  if (sourceDoc?.fileType === 'pdf' && sourceDoc.rawBytes?.length && page.sourcePageNumber > 0) {
    try {
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = pdfjsLib.getDocument({
        data: new Uint8Array(sourceDoc.rawBytes),
        useSystemFonts: false,
        isEvalSupported: false,
        disableFontFace: true,
      });
      const pdf = await task.promise;
      try {
        const pdfPage = await pdf.getPage(page.sourcePageNumber);
        try {
          const baseVp = pdfPage.getViewport({ scale: 1, rotation: 0 });
          const scale = Math.min(3, Math.max(1.5, 2000 / Math.max(1, baseVp.width, baseVp.height)));
          const vp = pdfPage.getViewport({ scale, rotation: 0 });
          const w = Math.max(1, Math.round(vp.width));
          const h = Math.max(1, Math.round(vp.height));
          if (typeof OffscreenCanvas !== 'undefined') {
            const canvas = new OffscreenCanvas(w, h);
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, w, h);
              await pdfPage.render({
                canvasContext: ctx as unknown as CanvasRenderingContext2D,
                viewport: vp,
              }).promise;
              return { width: w, height: h, rgba: ctx.getImageData(0, 0, w, h).data };
            }
          } else if (typeof document !== 'undefined') {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, w, h);
              await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
              return { width: w, height: h, rgba: ctx.getImageData(0, 0, w, h).data };
            }
          }
        } finally {
          pdfPage.cleanup?.();
        }
      } finally {
        await pdf.destroy();
      }
    } catch {
      // Fallback to thumbnail if PDF rasterization unavailable in headless environment
    }
  }

  if (page.thumbnailDataUrl) {
    return decodeDataUrlToRgba(page.thumbnailDataUrl);
  }

  throw new Error('تصویر یا محتوای صفحه برای برش پرسپکتیو در دسترس نیست.');
}

function uint8ToDataUrlPng(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * Full page perspective rectification pipeline:
 * Decodes source raster or renders PDF page, applies exact projective homography warp
 * from `displayQuad` (taking `effectiveRotation` into account), encodes output PNG & thumbnail,
 * and returns new physical dimensions in mm.
 */
export async function rectifyPagePerspective(params: {
  page: PageItem;
  sourceDoc: SourceDocument | undefined;
  displayQuad: PerspectiveQuad;
  effectiveRotation: PageRotation;
  aspectPreset?: PerspectiveAspectPreset;
  customRatioW?: number;
  customRatioH?: number;
}): Promise<{
  pngBytes: Uint8Array;
  thumbnailDataUrl: string;
  widthPx: number;
  heightPx: number;
  widthMm: number;
  heightMm: number;
}> {
  const {
    page,
    sourceDoc,
    displayQuad,
    effectiveRotation,
    aspectPreset = 'auto',
    customRatioW,
    customRatioH,
  } = params;

  if (!isConvexQuad(displayQuad)) {
    throw new Error('چهار نقطه انتخاب‌شده باید یک چهارضلعی محدب و معتبر بسازند.');
  }

  const decoded = await renderSourcePageToRgba(page, sourceDoc);
  const sourceQuad = displayQuadToSourceQuad(displayQuad, effectiveRotation);
  const dims = computePerspectiveOutputDimensions({
    sourceWidthPx: decoded.width,
    sourceHeightPx: decoded.height,
    sourceWidthMm: page.widthMm,
    sourceHeightMm: page.heightMm,
    sourceQuad,
    aspectPreset,
    customRatioW,
    customRatioH,
  });

  const warpedRgba = warpPerspectiveRgba({
    srcRgba: decoded.rgba,
    srcWidth: decoded.width,
    srcHeight: decoded.height,
    dstWidth: dims.widthPx,
    dstHeight: dims.heightPx,
    sourceQuad,
  });

  const pngBytes = await encodeRgbaToPngBytesUniversal(warpedRgba, dims.widthPx, dims.heightPx);

  // Build lightweight thumbnail (max 480px)
  const thumbScale = Math.min(1, 480 / Math.max(1, dims.widthPx, dims.heightPx));
  let thumbnailDataUrl: string;
  if (thumbScale < 0.99) {
    const tw = Math.max(4, Math.round(dims.widthPx * thumbScale));
    const th = Math.max(4, Math.round(dims.heightPx * thumbScale));
    const thumbRgba = warpPerspectiveRgba({
      srcRgba: warpedRgba,
      srcWidth: dims.widthPx,
      srcHeight: dims.heightPx,
      dstWidth: tw,
      dstHeight: th,
      sourceQuad: DEFAULT_PERSPECTIVE_QUAD,
    });
    const thumbBytes = await encodeRgbaToPngBytesUniversal(thumbRgba, tw, th);
    thumbnailDataUrl = uint8ToDataUrlPng(thumbBytes);
  } else {
    thumbnailDataUrl = uint8ToDataUrlPng(pngBytes);
  }

  return {
    pngBytes,
    thumbnailDataUrl,
    widthPx: dims.widthPx,
    heightPx: dims.heightPx,
    widthMm: dims.widthMm,
    heightMm: dims.heightMm,
  };
}

export interface AutoDetectQuadResult {
  found: boolean;
  quad: PerspectiveQuad;
  confidence: number;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function quadAreaNormalized(pts: NormalizedPoint[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) * 0.5;
}

function convexHullPoints(points: NormalizedPoint[]): NormalizedPoint[] {
  if (points.length <= 3) return points.slice();
  const sorted = points
    .slice()
    .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  const cross = (o: NormalizedPoint, a: NormalizedPoint, b: NormalizedPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: NormalizedPoint[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: NormalizedPoint[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function reduceHullToQuad(hull: NormalizedPoint[]): NormalizedPoint[] | null {
  if (hull.length < 4) return null;
  const pts = hull.slice();
  while (pts.length > 4) {
    let minArea = Infinity;
    let removeIdx = 0;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const curr = pts[i];
      const next = pts[(i + 1) % pts.length];
      const area = Math.abs((prev.x - curr.x) * (next.y - curr.y) - (prev.y - curr.y) * (next.x - curr.x)) * 0.5;
      if (area < minArea) {
        minArea = area;
        removeIdx = i;
      }
    }
    pts.splice(removeIdx, 1);
  }
  return pts;
}

function fitLineThroughSegment(
  pts: NormalizedPoint[],
  a: NormalizedPoint,
  b: NormalizedPoint,
  maxDist: number
): { nx: number; ny: number; c: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return null;
  const enx = -dy / len;
  const eny = dx / len;
  const near: NormalizedPoint[] = [];
  for (const p of pts) {
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len);
    if (t < -0.04 || t > 1.04) continue;
    const dist = Math.abs((p.x - a.x) * enx + (p.y - a.y) * eny);
    if (dist <= maxDist) near.push(p);
  }
  if (near.length < 6) {
    return { nx: enx, ny: eny, c: enx * a.x + eny * a.y };
  }
  let mx = 0;
  let my = 0;
  for (const p of near) {
    mx += p.x;
    my += p.y;
  }
  mx /= near.length;
  my /= near.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of near) {
    const ux = p.x - mx;
    const uy = p.y - my;
    sxx += ux * ux;
    syy += uy * uy;
    sxy += ux * uy;
  }
  // Smallest eigenvector of covariance matrix gives fitted line normal
  const trace = sxx + syy;
  const detTerm = Math.sqrt(Math.max(0, (sxx - syy) * (sxx - syy) + 4 * sxy * sxy));
  const lambdaMin = 0.5 * (trace - detTerm);
  let nx = sxy;
  let ny = lambdaMin - sxx;
  if (Math.hypot(nx, ny) < 1e-9) {
    nx = lambdaMin - syy;
    ny = sxy;
  }
  const nLen = Math.hypot(nx, ny);
  if (nLen < 1e-9) return { nx: enx, ny: eny, c: enx * a.x + eny * a.y };
  nx /= nLen;
  ny /= nLen;
  return { nx, ny, c: nx * mx + ny * my };
}

function intersectLines(
  l1: { nx: number; ny: number; c: number },
  l2: { nx: number; ny: number; c: number }
): NormalizedPoint | null {
  const det = l1.nx * l2.ny - l1.ny * l2.nx;
  if (Math.abs(det) < 1e-5) return null;
  return {
    x: (l1.c * l2.ny - l1.ny * l2.c) / det,
    y: (l1.nx * l2.c - l1.c * l2.nx) / det,
  };
}

export function orderCornersClockwise(pts: NormalizedPoint[]): PerspectiveQuad {
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  // Screen y grows downward: increasing atan2(y - cy, x - cx) orders clockwise
  const sorted = pts
    .slice()
    .sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let tlIdx = 0;
  let bestScore = Infinity;
  for (let i = 0; i < 4; i++) {
    const score = sorted[i].x + sorted[i].y;
    if (score < bestScore) {
      bestScore = score;
      tlIdx = i;
    }
  }
  return {
    tl: { x: clamp01(sorted[tlIdx].x), y: clamp01(sorted[tlIdx].y) },
    tr: { x: clamp01(sorted[(tlIdx + 1) % 4].x), y: clamp01(sorted[(tlIdx + 1) % 4].y) },
    br: { x: clamp01(sorted[(tlIdx + 2) % 4].x), y: clamp01(sorted[(tlIdx + 2) % 4].y) },
    bl: { x: clamp01(sorted[(tlIdx + 3) % 4].x), y: clamp01(sorted[(tlIdx + 3) % 4].y) },
  };
}

/**
 * Fast, 100% offline 4-corner sheet/document detector on RGBA pixels.
 * Combines border-contrast sheet segmentation (with exterior flood-fill so printed dark text
 * inside a sheet never creates interior holes) and Sobel edge boundary fitting.
 * Returns normalized corners in source image [0..1] space.
 */
export function detectDocumentQuadOffline(params: {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}): AutoDetectQuadResult {
  const { rgba, width, height } = params;
  if (width < 16 || height < 16 || rgba.length < width * height * 4) {
    return { found: false, quad: clonePerspectiveQuad(DEFAULT_PERSPECTIVE_QUAD), confidence: 0 };
  }

  const maxSide = 220;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(24, Math.round(width * scale));
  const h = Math.max(24, Math.round(height * scale));
  const n = w * h;

  const rBuf = new Float32Array(n);
  const gBuf = new Float32Array(n);
  const bBuf = new Float32Array(n);
  const lum = new Float32Array(n);

  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / w));
      const si = (sy * width + sx) * 4;
      const di = y * w + x;
      const r = rgba[si];
      const g = rgba[si + 1];
      const b = rgba[si + 2];
      rBuf[di] = r;
      gBuf[di] = g;
      bBuf[di] = b;
      lum[di] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  // 3x3 Gaussian blur on luminance
  const smooth = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(w - 1, x + 1);
      smooth[y * w + x] =
        (lum[ym * w + xm] + 2 * lum[ym * w + x] + lum[ym * w + xp] +
          2 * lum[y * w + xm] + 4 * lum[y * w + x] + 2 * lum[y * w + xp] +
          lum[yp * w + xm] + 2 * lum[yp * w + x] + lum[yp * w + xp]) /
        16;
    }
  }

  // Estimate outer border background color & luminance
  const borderPadX = Math.max(2, Math.floor(w * 0.04));
  const borderPadY = Math.max(2, Math.floor(h * 0.04));
  let bgR = 0, bgG = 0, bgB = 0, bgL = 0, bgCount = 0;
  const bgLums: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < borderPadX || x >= w - borderPadX || y < borderPadY || y >= h - borderPadY) {
        const i = y * w + x;
        bgR += rBuf[i];
        bgG += gBuf[i];
        bgB += bBuf[i];
        bgL += smooth[i];
        bgLums.push(smooth[i]);
        bgCount++;
      }
    }
  }
  if (bgCount > 0) {
    bgR /= bgCount;
    bgG /= bgCount;
    bgB /= bgCount;
    bgL /= bgCount;
  }
  let bgVar = 0;
  for (const v of bgLums) bgVar += (v - bgL) * (v - bgL);
  const bgStd = Math.sqrt(bgVar / Math.max(1, bgLums.length));

  // Color + luminance distance from border background
  const diff = new Float32Array(n);
  const hist = new Int32Array(256);
  let maxInteriorDiff = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dLum = Math.abs(smooth[i] - bgL);
      const dCol = (Math.abs(rBuf[i] - bgR) + Math.abs(gBuf[i] - bgG) + Math.abs(bBuf[i] - bgB)) / 3;
      const d = Math.min(255, dLum * 0.7 + dCol * 0.55);
      diff[i] = d;
      hist[Math.min(255, Math.round(d))]++;
      if (x >= borderPadX && x < w - borderPadX && y >= borderPadY && y < h - borderPadY) {
        if (d > maxInteriorDiff) maxInteriorDiff = d;
      }
    }
  }

  // Otsu threshold on diff
  let totalSum = 0;
  for (let t = 0; t < 256; t++) totalSum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxBetween = -1;
  let otsuThresh = 24;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (totalSum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxBetween) {
      maxBetween = between;
      otsuThresh = t;
    }
  }
  const segThresh = Math.max(18, Math.min(140, Math.max(otsuThresh * 0.85, bgStd * 2.2)));

  let boundaryPts: NormalizedPoint[] = [];
  let confidence = 0;

  if (maxInteriorDiff >= 18) {
    const fg = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      fg[i] = diff[i] >= segThresh ? 1 : 0;
    }
    // 1 pass morphological smooth to close narrow hairline gaps on border
    const closed = new Uint8Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const sum =
          fg[i - w - 1] + fg[i - w] + fg[i - w + 1] +
          fg[i - 1] + fg[i] + fg[i + 1] +
          fg[i + w - 1] + fg[i + w] + fg[i + w + 1];
        closed[i] = sum >= 4 ? 1 : 0;
      }
    }

    // Flood-fill background from the outer image border so interior dark text holes inside the sheet become solid
    const outside = new Uint8Array(n);
    const queue = new Int32Array(n);
    let qHead = 0;
    let qTail = 0;
    const pushIfBg = (idx: number) => {
      if (!outside[idx] && closed[idx] === 0) {
        outside[idx] = 1;
        queue[qTail++] = idx;
      }
    };
    for (let x = 0; x < w; x++) {
      pushIfBg(x);
      pushIfBg((h - 1) * w + x);
    }
    for (let y = 1; y < h - 1; y++) {
      pushIfBg(y * w);
      pushIfBg(y * w + (w - 1));
    }
    while (qHead < qTail) {
      const idx = queue[qHead++];
      const x = idx % w;
      const y = (idx - x) / w;
      if (x > 0) pushIfBg(idx - 1);
      if (x + 1 < w) pushIfBg(idx + 1);
      if (y > 0) pushIfBg(idx - w);
      if (y + 1 < h) pushIfBg(idx + w);
    }

    // Keep largest connected solid interior component
    const solid = new Uint8Array(n);
    let fgPixels = 0;
    for (let i = 0; i < n; i++) {
      if (!outside[i]) {
        solid[i] = 1;
        fgPixels++;
      }
    }

    const areaFrac = fgPixels / n;
    if (areaFrac >= 0.08 && areaFrac <= 0.96) {
      const visited = new Uint8Array(n);
      let bestComp: number[] = [];
      for (let i = 0; i < n; i++) {
        if (!solid[i] || visited[i]) continue;
        const comp: number[] = [];
        let head = 0;
        visited[i] = 1;
        comp.push(i);
        while (head < comp.length) {
          const idx = comp[head++];
          const x = idx % w;
          const y = (idx - x) / w;
          if (x > 0 && solid[idx - 1] && !visited[idx - 1]) { visited[idx - 1] = 1; comp.push(idx - 1); }
          if (x + 1 < w && solid[idx + 1] && !visited[idx + 1]) { visited[idx + 1] = 1; comp.push(idx + 1); }
          if (y > 0 && solid[idx - w] && !visited[idx - w]) { visited[idx - w] = 1; comp.push(idx - w); }
          if (y + 1 < h && solid[idx + w] && !visited[idx + w]) { visited[idx + w] = 1; comp.push(idx + w); }
        }
        if (comp.length > bestComp.length) bestComp = comp;
      }

      if (bestComp.length >= n * 0.08) {
        const compMask = new Uint8Array(n);
        for (const idx of bestComp) compMask[idx] = 1;
        for (const idx of bestComp) {
          const x = idx % w;
          const y = (idx - x) / w;
          const isEdge =
            x === 0 || x === w - 1 || y === 0 || y === h - 1 ||
            !compMask[idx - 1] || !compMask[idx + 1] || !compMask[idx - w] || !compMask[idx + w];
          if (isEdge) {
            boundaryPts.push({ x: (x + 0.5) / w, y: (y + 0.5) / h });
          }
        }
        confidence = Math.min(1, maxInteriorDiff / 70);
      }
    }
  }

  // Secondary edge-driven fallback if background contrast segmentation did not isolate a clear sheet
  if (boundaryPts.length < 24) {
    const grad = new Float32Array(n);
    let maxGrad = 0;
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const i = y * w + x;
        const gx =
          -smooth[i - w - 1] + smooth[i - w + 1] -
          2 * smooth[i - 1] + 2 * smooth[i + 1] -
          smooth[i + w - 1] + smooth[i + w + 1];
        const gy =
          -smooth[i - w - 1] - 2 * smooth[i - w] - smooth[i - w + 1] +
          smooth[i + w - 1] + 2 * smooth[i + w] + smooth[i + w + 1];
        const g = Math.hypot(gx, gy) / 4;
        grad[i] = g;
        if (g > maxGrad) maxGrad = g;
      }
    }
    if (maxGrad >= 18) {
      const thresh = Math.max(16, maxGrad * 0.35);
      const edgePts: NormalizedPoint[] = [];
      for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
          if (grad[y * w + x] >= thresh) {
            edgePts.push({ x: (x + 0.5) / w, y: (y + 0.5) / h });
          }
        }
      }
      if (edgePts.length >= 24 && edgePts.length <= n * 0.45) {
        boundaryPts = edgePts;
        confidence = Math.min(0.85, maxGrad / 80);
      }
    }
  }

  if (boundaryPts.length < 16) {
    return { found: false, quad: clonePerspectiveQuad(DEFAULT_PERSPECTIVE_QUAD), confidence: 0 };
  }

  const hull = convexHullPoints(boundaryPts);
  const roughQuadPts = reduceHullToQuad(hull);
  if (!roughQuadPts) {
    return { found: false, quad: clonePerspectiveQuad(DEFAULT_PERSPECTIVE_QUAD), confidence: 0 };
  }

  let candidatePts = roughQuadPts;
  // Refine edges via orthogonal line fitting to outer boundary points
  const fittedLines = roughQuadPts.map((pt, i) =>
    fitLineThroughSegment(boundaryPts, pt, roughQuadPts[(i + 1) % 4], 0.03)
  );
  if (fittedLines.every((l) => l !== null)) {
    const intersections: NormalizedPoint[] = [];
    for (let i = 0; i < 4; i++) {
      const prevLine = fittedLines[(i + 3) % 4]!;
      const currLine = fittedLines[i]!;
      const hit = intersectLines(prevLine, currLine);
      if (hit && hit.x >= -0.05 && hit.x <= 1.05 && hit.y >= -0.05 && hit.y <= 1.05) {
        intersections.push({ x: clamp01(hit.x), y: clamp01(hit.y) });
      }
    }
    if (intersections.length === 4) {
      const refinedArea = quadAreaNormalized(intersections);
      if (refinedArea >= 0.08) {
        candidatePts = intersections;
      }
    }
  }

  const ordered = orderCornersClockwise(candidatePts);
  const area = quadAreaNormalized([ordered.tl, ordered.tr, ordered.br, ordered.bl]);
  if (!isConvexQuad(ordered, 0.08) || area > 0.975) {
    return { found: false, quad: clonePerspectiveQuad(DEFAULT_PERSPECTIVE_QUAD), confidence: 0 };
  }

  // Verify the detected quad meaningfully differs from full frame
  const cornerMovement = Math.max(
    Math.hypot(ordered.tl.x - 0, ordered.tl.y - 0),
    Math.hypot(ordered.tr.x - 1, ordered.tr.y - 0),
    Math.hypot(ordered.br.x - 1, ordered.br.y - 1),
    Math.hypot(ordered.bl.x - 0, ordered.bl.y - 1)
  );
  if (cornerMovement < 0.025) {
    return { found: false, quad: clonePerspectiveQuad(DEFAULT_PERSPECTIVE_QUAD), confidence: 0 };
  }

  return {
    found: true,
    quad: ordered,
    confidence: Math.max(0.25, Math.min(1, confidence)),
  };
}

/**
 * Runs offline 4-corner detection for a Studio PageItem and transforms the detected corners
 * into display-rotated quad space ready for interactive editing in PageCanvasCell.
 */
export async function autoDetectPagePerspectiveQuad(params: {
  page: PageItem;
  sourceDoc: SourceDocument | undefined;
  effectiveRotation: PageRotation;
}): Promise<AutoDetectQuadResult> {
  const { page, sourceDoc, effectiveRotation } = params;
  const decoded = await renderSourcePageToRgba(page, sourceDoc);
  const detected = detectDocumentQuadOffline({
    rgba: decoded.rgba,
    width: decoded.width,
    height: decoded.height,
  });
  if (!detected.found) {
    return detected;
  }
  const rotatedPts = [
    sourcePointToDisplay(detected.quad.tl, effectiveRotation),
    sourcePointToDisplay(detected.quad.tr, effectiveRotation),
    sourcePointToDisplay(detected.quad.br, effectiveRotation),
    sourcePointToDisplay(detected.quad.bl, effectiveRotation),
  ];
  const orderedDisplay = orderCornersClockwise(rotatedPts);
  if (!isConvexQuad(orderedDisplay, 0.06)) {
    return { found: false, quad: clonePerspectiveQuad(DEFAULT_PERSPECTIVE_QUAD), confidence: 0 };
  }
  return {
    found: true,
    quad: orderedDisplay,
    confidence: detected.confidence,
  };
}
