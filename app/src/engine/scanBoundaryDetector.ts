/**
 * PrintStudio Pro — Offline Scan Boundary Computer Vision Utility
 *
 * 100% offline, deterministic 4-corner document boundary detection for raw scans
 * (light/colored/dark sheets on contrasting backgrounds, skewed receipts, cards,
 * printed pages with heavy interior text/graphics, and subtle scanner shadow edges).
 */
import type { DetectedDocumentBoundaries, DetectedDocumentQuad } from '@shared/models';
import { encodeRgbaToPngBytesUniversal } from './universalImageDecoder';

export interface NormalizedPoint2D {
  x: number;
  y: number;
}

export type QuadCorners = DetectedDocumentQuad;

export interface ScanBoundaryDetectionResult {
  found: boolean;
  quad: QuadCorners;
  bounds: { top: number; right: number; bottom: number; left: number };
  confidence: number;
  method: 'contour' | 'gradient';
  isSkewed: boolean;
}

export const FULL_FRAME_QUAD: QuadCorners = {
  tl: { x: 0, y: 0 },
  tr: { x: 1, y: 0 },
  br: { x: 1, y: 1 },
  bl: { x: 0, y: 1 },
};

export const ZERO_BOUNDS_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function cloneQuad(quad: QuadCorners): QuadCorners {
  return {
    tl: { ...quad.tl },
    tr: { ...quad.tr },
    br: { ...quad.br },
    bl: { ...quad.bl },
  };
}

function quadAreaNormalized(pts: NormalizedPoint2D[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) * 0.5;
}

export function isConvexDetectedQuad(quad: QuadCorners, minArea = 1e-4): boolean {
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
 * Validates that every corner angle of the quadrilateral is plausible for a photographed
 * or scanned sheet ([minDeg..maxDeg], default [20°..160°]), rejecting hairline/degenerate slivers.
 */
function hasPlausibleCornerAngles(quad: QuadCorners, minDeg = 20, maxDeg = 160): boolean {
  const pts = [quad.tl, quad.tr, quad.br, quad.bl];
  for (let i = 0; i < 4; i++) {
    const prev = pts[(i + 3) % 4];
    const curr = pts[i];
    const next = pts[(i + 1) % 4];
    const v1x = prev.x - curr.x;
    const v1y = prev.y - curr.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const m1 = Math.hypot(v1x, v1y);
    const m2 = Math.hypot(v2x, v2y);
    if (m1 < 1e-4 || m2 < 1e-4) return false;
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
    const deg = (Math.acos(cos) * 180) / Math.PI;
    if (deg < minDeg || deg > maxDeg) return false;
  }
  return true;
}

export function orderQuadCornersClockwise(pts: NormalizedPoint2D[]): QuadCorners {
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  // Screen Y increases downward: ascending atan2(y - cy, x - cx) orders corners clockwise
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

export function computeBoundsFromQuad(quad: QuadCorners): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const minX = Math.min(quad.tl.x, quad.bl.x, quad.tr.x, quad.br.x);
  const maxX = Math.max(quad.tl.x, quad.bl.x, quad.tr.x, quad.br.x);
  const minY = Math.min(quad.tl.y, quad.tr.y, quad.bl.y, quad.br.y);
  const maxY = Math.max(quad.tl.y, quad.tr.y, quad.bl.y, quad.br.y);
  let left = Math.max(0, Math.min(0.98, minX));
  let right = Math.max(0, Math.min(0.98, 1 - maxX));
  let top = Math.max(0, Math.min(0.98, minY));
  let bottom = Math.max(0, Math.min(0.98, 1 - maxY));
  if (left + right > 0.98) {
    const s = 0.98 / (left + right);
    left *= s;
    right *= s;
  }
  if (top + bottom > 0.98) {
    const s = 0.98 / (top + bottom);
    top *= s;
    bottom *= s;
  }
  return {
    top: Math.round(top * 10000) / 10000,
    right: Math.round(right * 10000) / 10000,
    bottom: Math.round(bottom * 10000) / 10000,
    left: Math.round(left * 10000) / 10000,
  };
}

export function isQuadSkewed(quad: QuadCorners, threshold = 0.015): boolean {
  const topTilt = Math.abs(quad.tl.y - quad.tr.y);
  const bottomTilt = Math.abs(quad.bl.y - quad.br.y);
  const leftTilt = Math.abs(quad.tl.x - quad.bl.x);
  const rightTilt = Math.abs(quad.tr.x - quad.br.x);
  return Math.max(topTilt, bottomTilt, leftTilt, rightTilt) >= threshold;
}

function convexHullPoints(points: NormalizedPoint2D[]): NormalizedPoint2D[] {
  if (points.length <= 3) return points.slice();
  const sorted = points
    .slice()
    .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  const cross = (o: NormalizedPoint2D, a: NormalizedPoint2D, b: NormalizedPoint2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: NormalizedPoint2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: NormalizedPoint2D[] = [];
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

function reduceHullToQuad(hull: NormalizedPoint2D[]): NormalizedPoint2D[] | null {
  if (hull.length < 4) return null;
  const pts = hull.slice();
  while (pts.length > 4) {
    let minArea = Infinity;
    let removeIdx = 0;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const curr = pts[i];
      const next = pts[(i + 1) % pts.length];
      const area =
        Math.abs((prev.x - curr.x) * (next.y - curr.y) - (prev.y - curr.y) * (next.x - curr.x)) * 0.5;
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
  pts: NormalizedPoint2D[],
  a: NormalizedPoint2D,
  b: NormalizedPoint2D,
  maxDist: number
): { nx: number; ny: number; c: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return null;
  const enx = -dy / len;
  const eny = dx / len;
  const near: NormalizedPoint2D[] = [];
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
): NormalizedPoint2D | null {
  const det = l1.nx * l2.ny - l1.ny * l2.nx;
  if (Math.abs(det) < 1e-5) return null;
  return {
    x: (l1.c * l2.ny - l1.ny * l2.c) / det,
    y: (l1.nx * l2.c - l1.c * l2.nx) / det,
  };
}

/**
 * Decodes PNG, JPEG, or WebP raster bytes into flat RGBA pixels across both browser/Electron
 * renderers and headless Node/Vitest environments.
 */
export async function decodeImageBytesToRgba(
  bytes: Uint8Array,
  mimeType = 'image/png'
): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const effectiveMime = mimeType || 'image/png';
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
    try {
      const safe = new Uint8Array(bytes.byteLength);
      safe.set(bytes);
      const blob = new Blob([safe.buffer], { type: effectiveMime });
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
      const url = URL.createObjectURL(new Blob([safe.buffer], { type: effectiveMime }));
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('Failed to decode raster image'));
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

/**
 * Pure offline 4-corner document boundary detector for raw scanned images.
 * Uses:
 *   1) Multi-channel background modeling + Otsu thresholding + morphological closing +
 *      exterior flood-fill + largest-component contour extraction.
 *   2) Sobel gradient fallback with connected-component dust/noise pruning.
 *   3) Convex hull -> 4-point reduction -> orthogonal covariance line fitting & validation.
 */
export function detectRawScanBoundaries(params: {
  rgba: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}): ScanBoundaryDetectionResult {
  const emptyResult = (): ScanBoundaryDetectionResult => ({
    found: false,
    quad: cloneQuad(FULL_FRAME_QUAD),
    bounds: { ...ZERO_BOUNDS_INSETS },
    confidence: 0,
    method: 'contour',
    isSkewed: false,
  });

  const { rgba, width, height } = params;
  if (width < 16 || height < 16 || rgba.length < width * height * 4) {
    return emptyResult();
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

  // 3x3 Gaussian blur on luminance to suppress scanner grain & halftoning
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

  let boundaryPts: NormalizedPoint2D[] = [];
  let confidence = 0;
  let method: 'contour' | 'gradient' = 'contour';

  if (maxInteriorDiff >= 18) {
    const fg = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      fg[i] = diff[i] >= segThresh ? 1 : 0;
    }
    // 1-pass morphological smooth to close hairline gaps along border
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

    // Flood-fill background from image edges so interior dark ink inside the paper stays solid
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
        method = 'contour';
      }
    }
  }

  // Secondary Sobel gradient fallback with isolated dust/speck pruning
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
      const edgeMask = new Uint8Array(n);
      for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
          if (grad[y * w + x] >= thresh) {
            edgeMask[y * w + x] = 1;
          }
        }
      }

      // Prune isolated scanner dust/noise edge components (< 8 connected edge pixels)
      const visited = new Uint8Array(n);
      const edgePts: NormalizedPoint2D[] = [];
      const minClusterSize = Math.max(6, Math.round(Math.min(w, h) * 0.08));
      for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
          const start = y * w + x;
          if (!edgeMask[start] || visited[start]) continue;
          const comp: number[] = [start];
          visited[start] = 1;
          let head = 0;
          while (head < comp.length) {
            const idx = comp[head++];
            const cx = idx % w;
            const cy = (idx - cx) / w;
            for (let dy = -1; dy <= 1; dy++) {
              const ny = cy + dy;
              if (ny < 2 || ny >= h - 2) continue;
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = cx + dx;
                if (nx < 2 || nx >= w - 2) continue;
                const nIdx = ny * w + nx;
                if (edgeMask[nIdx] && !visited[nIdx]) {
                  visited[nIdx] = 1;
                  comp.push(nIdx);
                }
              }
            }
          }
          if (comp.length >= minClusterSize) {
            for (const idx of comp) {
              const px = idx % w;
              const py = (idx - px) / w;
              edgePts.push({ x: (px + 0.5) / w, y: (py + 0.5) / h });
            }
          }
        }
      }

      if (edgePts.length >= 24 && edgePts.length <= n * 0.45) {
        boundaryPts = edgePts;
        confidence = Math.min(0.85, maxGrad / 80);
        method = 'gradient';
      }
    }
  }

  if (boundaryPts.length < 16) {
    return emptyResult();
  }

  const hull = convexHullPoints(boundaryPts);
  const roughQuadPts = reduceHullToQuad(hull);
  if (!roughQuadPts) {
    return emptyResult();
  }

  let candidatePts = roughQuadPts;
  // Refine edges via orthogonal line fitting to outer boundary points
  const fittedLines = roughQuadPts.map((pt, i) =>
    fitLineThroughSegment(boundaryPts, pt, roughQuadPts[(i + 1) % 4], 0.03)
  );
  if (fittedLines.every((l) => l !== null)) {
    const intersections: NormalizedPoint2D[] = [];
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

  const ordered = orderQuadCornersClockwise(candidatePts);
  const area = quadAreaNormalized([ordered.tl, ordered.tr, ordered.br, ordered.bl]);
  if (!isConvexDetectedQuad(ordered, 0.08) || area > 0.975 || !hasPlausibleCornerAngles(ordered)) {
    return emptyResult();
  }

  // Verify the detected quad meaningfully differs from a full-frame uncropped scan
  const cornerMovement = Math.max(
    Math.hypot(ordered.tl.x - 0, ordered.tl.y - 0),
    Math.hypot(ordered.tr.x - 1, ordered.tr.y - 0),
    Math.hypot(ordered.br.x - 1, ordered.br.y - 1),
    Math.hypot(ordered.bl.x - 0, ordered.bl.y - 1)
  );
  if (cornerMovement < 0.025) {
    return emptyResult();
  }

  return {
    found: true,
    quad: ordered,
    bounds: computeBoundsFromQuad(ordered),
    confidence: Math.round(Math.max(0.25, Math.min(1, confidence)) * 100) / 100,
    method,
    isSkewed: isQuadSkewed(ordered),
  };
}

/**
 * Convenience helper for the image import pipeline: decodes encoded raster bytes
 * and runs offline boundary detection, failing safely without breaking import on unusual files.
 */
export async function detectRawScanBoundariesFromEncodedBytes(
  bytes: Uint8Array,
  mimeType = 'image/png'
): Promise<ScanBoundaryDetectionResult> {
  try {
    const decoded = await decodeImageBytesToRgba(bytes, mimeType);
    return detectRawScanBoundaries({
      rgba: decoded.rgba,
      width: decoded.width,
      height: decoded.height,
    });
  } catch {
    return {
      found: false,
      quad: cloneQuad(FULL_FRAME_QUAD),
      bounds: { ...ZERO_BOUNDS_INSETS },
      confidence: 0,
      method: 'contour',
      isSkewed: false,
    };
  }
}

export function toDetectedDocumentBoundaries(
  result: ScanBoundaryDetectionResult
): DetectedDocumentBoundaries | undefined {
  if (!result.found) return undefined;
  return {
    corners: cloneQuad(result.quad),
    bounds: { ...result.bounds },
    confidence: result.confidence,
    method: result.method,
    isSkewed: result.isSkewed,
  };
}

export interface SkewEstimate {
  angleDeg: number;
  confidence: number;
  method: 'boundary' | 'projection';
}

function normalizeEdgeTiltDeg(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d > 90) d -= 180;
  if (d <= -90) d += 180;
  return d;
}

/**
 * Estimates clockwise tilt angle (in degrees, positive = tilted clockwise so rotating by -angleDeg
 * straightens it) from a detected 4-corner document quadrilateral in source image space.
 */
export function estimateBoundarySkewAngleDeg(
  quad: QuadCorners,
  width: number,
  height: number
): { angleDeg: number; consistent: boolean; confidence: number } {
  const toPx = (p: NormalizedPoint2D) => ({ x: p.x * width, y: p.y * height });
  const tl = toPx(quad.tl);
  const tr = toPx(quad.tr);
  const br = toPx(quad.br);
  const bl = toPx(quad.bl);

  const aTop = normalizeEdgeTiltDeg((Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI);
  const aBottom = normalizeEdgeTiltDeg((Math.atan2(br.y - bl.y, br.x - bl.x) * 180) / Math.PI);
  // Left/right edges point downward (+y): clockwise tilt rotates (+y) toward (-x)
  const aLeft = normalizeEdgeTiltDeg((Math.atan2(-(bl.x - tl.x), bl.y - tl.y) * 180) / Math.PI);
  const aRight = normalizeEdgeTiltDeg((Math.atan2(-(br.x - tr.x), br.y - tr.y) * 180) / Math.PI);

  const angles = [aTop, aBottom, aLeft, aRight].sort((a, b) => a - b);
  const medianAngle = (angles[1] + angles[2]) * 0.5;

  // Consistency: opposing edges tilt in the same general direction (within 10 deg) OR 3 edges cluster tightly
  const topBottomAgree = Math.abs(aTop - aBottom) <= 10;
  const leftRightAgree = Math.abs(aLeft - aRight) <= 10;
  const clusterSpread = angles[3] - angles[0];
  const innerSpread = angles[2] - angles[1];
  const consistent =
    (topBottomAgree && leftRightAgree && innerSpread <= 8) ||
    (innerSpread <= 4.5 && (topBottomAgree || leftRightAgree)) ||
    clusterSpread <= 8;

  if (!consistent || Math.abs(medianAngle) < 0.6 || Math.abs(medianAngle) > 40) {
    return { angleDeg: 0, consistent: false, confidence: 0 };
  }

  const conf = Math.max(0.4, Math.min(1, 1 - innerSpread / 14));
  return {
    angleDeg: Math.round(medianAngle * 100) / 100,
    consistent: true,
    confidence: Math.round(conf * 100) / 100,
  };
}

/**
 * Fast offline Radon / horizontal projection variance sweep (`[-15°..+15°]`) for tilted document
 * scans that fill the frame (no dark scanner margins), aligning text lines and rules horizontally.
 */
export function detectProjectionSkewAngleDeg(params: {
  rgba: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}): SkewEstimate {
  const { rgba, width, height } = params;
  if (width < 24 || height < 24 || rgba.length < width * height * 4) {
    return { angleDeg: 0, confidence: 0, method: 'projection' };
  }

  const maxSide = 160;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(24, Math.round(width * scale));
  const h = Math.max(24, Math.round(height * scale));
  const n = w * h;
  const lum = new Float32Array(n);

  let mean = 0;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / w));
      const si = (sy * width + sx) * 4;
      const l = 0.299 * rgba[si] + 0.587 * rgba[si + 1] + 0.114 * rgba[si + 2];
      lum[y * w + x] = l;
      mean += l;
    }
  }
  mean /= n;

  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = lum[i] - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / n);
  if (std < 8) {
    return { angleDeg: 0, confidence: 0, method: 'projection' };
  }

  // Collect dark foreground ink pixels & strong vertical-transition edges inside central 88%
  const padX = Math.max(2, Math.floor(w * 0.06));
  const padY = Math.max(2, Math.floor(h * 0.06));
  const darkThresh = mean - std * 0.45;
  const rawPtsX: number[] = [];
  const rawPtsY: number[] = [];
  const cx = w * 0.5;
  const cy = h * 0.5;

  for (let y = padY; y < h - padY; y++) {
    for (let x = padX; x < w - padX; x++) {
      const idx = y * w + x;
      const gx = Math.abs(lum[idx + 1] - lum[idx - 1]);
      const gy = Math.abs(lum[idx + w] - lum[idx - w]);
      if (lum[idx] < darkThresh || gy > std * 0.9 || gx > std * 1.1) {
        rawPtsX.push(x - cx);
        rawPtsY.push(y - cy);
      }
    }
  }

  if (rawPtsX.length < 40) {
    return { angleDeg: 0, confidence: 0, method: 'projection' };
  }

  // Subsample evenly if dense so projection sweep always runs in < 2ms
  const maxSamples = 2800;
  const stride = Math.max(1, Math.floor(rawPtsX.length / maxSamples));
  const ptsX: number[] = [];
  const ptsY: number[] = [];
  for (let i = 0; i < rawPtsX.length; i += stride) {
    ptsX.push(rawPtsX[i]);
    ptsY.push(rawPtsY[i]);
  }

  const diag = Math.ceil(Math.hypot(w, h)) + 8;
  const halfDiag = Math.floor(diag / 2);
  const hist = new Float32Array(diag);

  const scoreAngle = (deg: number): number => {
    hist.fill(0);
    // Rotate points by -deg to align tilted baselines horizontally onto Y bins
    const rad = (-deg * Math.PI) / 180;
    const sinA = Math.sin(rad);
    const cosA = Math.cos(rad);
    for (let i = 0; i < ptsX.length; i++) {
      const yRot = Math.round(ptsX[i] * sinA + ptsY[i] * cosA) + halfDiag;
      if (yRot >= 0 && yRot < diag) hist[yRot] += 1;
    }
    let energy = 0;
    for (let b = 1; b < diag; b++) {
      const d = hist[b] - hist[b - 1];
      energy += d * d;
    }
    return energy;
  };

  const zeroScore = scoreAngle(0);
  let bestDeg = 0;
  let bestScore = zeroScore;

  // Coarse search -15° .. +15° step 1°
  for (let deg = -15; deg <= 15; deg += 1) {
    const s = scoreAngle(deg);
    if (s > bestScore) {
      bestScore = s;
      bestDeg = deg;
    }
  }

  // Fine search around best coarse candidate (+/- 1.0°, step 0.2°)
  const fineCenter = bestDeg;
  for (let deg = fineCenter - 1.0; deg <= fineCenter + 1.001; deg += 0.2) {
    const rounded = Math.round(deg * 10) / 10;
    const s = scoreAngle(rounded);
    if (s > bestScore) {
      bestScore = s;
      bestDeg = rounded;
    }
  }

  const improvementRatio = bestScore / Math.max(1e-6, zeroScore);
  if (Math.abs(bestDeg) < 0.7 || improvementRatio < 1.15) {
    return { angleDeg: 0, confidence: 0, method: 'projection' };
  }

  return {
    angleDeg: Math.round(bestDeg * 100) / 100,
    confidence: Math.round(Math.min(1, Math.max(0.35, (improvementRatio - 1) * 1.8)) * 100) / 100,
    method: 'projection',
  };
}

function samplePerimeterFillRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): [number, number, number, number] {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;
  const stepX = Math.max(1, Math.floor(width / 32));
  const stepY = Math.max(1, Math.floor(height / 32));
  for (let x = 0; x < width; x += stepX) {
    for (const y of [0, height - 1]) {
      const idx = (y * width + x) * 4;
      rSum += rgba[idx];
      gSum += rgba[idx + 1];
      bSum += rgba[idx + 2];
      count++;
    }
  }
  for (let y = 0; y < height; y += stepY) {
    for (const x of [0, width - 1]) {
      const idx = (y * width + x) * 4;
      rSum += rgba[idx];
      gSum += rgba[idx + 1];
      bSum += rgba[idx + 2];
      count++;
    }
  }
  if (count === 0) return [255, 255, 255, 255];
  return [
    Math.round(rSum / count),
    Math.round(gSum / count),
    Math.round(bSum / count),
    255,
  ];
}

/**
 * Rotates an RGBA raster clockwise-straightened by `-angleDeg` around its center using bilinear
 * interpolation and expanded bounding dimensions so tilted document corners are never clipped.
 */
export function deskewRgbaImage(params: {
  rgba: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  angleDeg: number;
  fillRgba?: [number, number, number, number];
}): { rgba: Uint8ClampedArray; width: number; height: number } {
  const { rgba, width, height, angleDeg } = params;
  if (Math.abs(angleDeg) < 0.4 || width < 4 || height < 4) {
    return {
      rgba: rgba instanceof Uint8ClampedArray ? new Uint8ClampedArray(rgba) : new Uint8ClampedArray(rgba),
      width,
      height,
    };
  }

  const fill = params.fillRgba ?? samplePerimeterFillRgba(rgba, width, height);
  // Inverse mapping: for each destination pixel (x', y') in rotated(-angleDeg) frame,
  // source point = rotate(+angleDeg) around centers!
  const rad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const absCos = Math.abs(cosA);
  const absSin = Math.abs(sinA);

  const dstWidth = Math.max(width, Math.ceil(width * absCos + height * absSin));
  const dstHeight = Math.max(height, Math.ceil(width * absSin + height * absCos));
  const out = new Uint8ClampedArray(dstWidth * dstHeight * 4);

  const srcCx = (width - 1) * 0.5;
  const srcCy = (height - 1) * 0.5;
  const dstCx = (dstWidth - 1) * 0.5;
  const dstCy = (dstHeight - 1) * 0.5;

  for (let dy = 0; dy < dstHeight; dy++) {
    const ry = dy - dstCy;
    const rowBase = dy * dstWidth * 4;
    for (let dx = 0; dx < dstWidth; dx++) {
      const rx = dx - dstCx;
      const sx = rx * cosA - ry * sinA + srcCx;
      const sy = rx * sinA + ry * cosA + srcCy;
      const outIdx = rowBase + dx * 4;

      if (sx < -0.5 || sx > width - 0.5 || sy < -0.5 || sy > height - 0.5) {
        out[outIdx] = fill[0];
        out[outIdx + 1] = fill[1];
        out[outIdx + 2] = fill[2];
        out[outIdx + 3] = fill[3];
        continue;
      }

      const cx = Math.max(0, Math.min(width - 1, sx));
      const cy = Math.max(0, Math.min(height - 1, sy));
      const x0 = Math.floor(cx);
      const y0 = Math.floor(cy);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const fx = cx - x0;
      const fy = cy - y0;
      const fx1 = 1 - fx;
      const fy1 = 1 - fy;

      const i00 = (y0 * width + x0) * 4;
      const i10 = (y0 * width + x1) * 4;
      const i01 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;

      const w00 = fx1 * fy1;
      const w10 = fx * fy1;
      const w01 = fx1 * fy;
      const w11 = fx * fy;

      out[outIdx] = Math.round(rgba[i00] * w00 + rgba[i10] * w10 + rgba[i01] * w01 + rgba[i11] * w11);
      out[outIdx + 1] = Math.round(rgba[i00 + 1] * w00 + rgba[i10 + 1] * w10 + rgba[i01 + 1] * w01 + rgba[i11 + 1] * w11);
      out[outIdx + 2] = Math.round(rgba[i00 + 2] * w00 + rgba[i10 + 2] * w10 + rgba[i01 + 2] * w01 + rgba[i11 + 2] * w11);
      out[outIdx + 3] = Math.round(rgba[i00 + 3] * w00 + rgba[i10 + 3] * w10 + rgba[i01 + 3] * w01 + rgba[i11 + 3] * w11);
    }
  }

  return { rgba: out, width: dstWidth, height: dstHeight };
}

/**
 * Transforms normalized `[0..1]` 4-corner coordinates cleanly into the deskewed image space.
 */
export function rotateQuadByDeskewAngle(params: {
  quad: QuadCorners;
  angleDeg: number;
  srcWidth: number;
  srcHeight: number;
  dstWidth: number;
  dstHeight: number;
}): QuadCorners {
  const { quad, angleDeg, srcWidth, srcHeight, dstWidth, dstHeight } = params;
  const rad = (-angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const srcCx = (srcWidth - 1) * 0.5;
  const srcCy = (srcHeight - 1) * 0.5;
  const dstCx = (dstWidth - 1) * 0.5;
  const dstCy = (dstHeight - 1) * 0.5;

  const mapPt = (p: NormalizedPoint2D): NormalizedPoint2D => {
    const px = p.x * (srcWidth - 1) - srcCx;
    const py = p.y * (srcHeight - 1) - srcCy;
    const dx = px * cosA - py * sinA + dstCx;
    const dy = px * sinA + py * cosA + dstCy;
    return {
      x: clamp01(dx / Math.max(1, dstWidth - 1)),
      y: clamp01(dy / Math.max(1, dstHeight - 1)),
    };
  };

  return orderQuadCornersClockwise([
    mapPt(quad.tl),
    mapPt(quad.tr),
    mapPt(quad.br),
    mapPt(quad.bl),
  ]);
}

export interface AutoDeskewResult {
  applied: boolean;
  angleDeg: number;
  confidence: number;
  method: 'boundary' | 'projection';
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  sourceWidth?: number;
  sourceHeight?: number;
  boundaryDetection: ScanBoundaryDetectionResult;
}

/**
 * Analyzes an encoded raster scan, estimates document tilt using detected outer boundaries
 * or interior horizontal projection profiles, and straightens tilted scans offline.
 */
export async function autoDeskewDecodedImage(params: {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
  boundaryDetection?: ScanBoundaryDetectionResult;
}): Promise<AutoDeskewResult> {
  const { bytes, mimeType } = params;
  try {
    const decoded = await decodeImageBytesToRgba(bytes, mimeType);
    const detection =
      params.boundaryDetection ??
      detectRawScanBoundaries({
        rgba: decoded.rgba,
        width: decoded.width,
        height: decoded.height,
      });

    let angleDeg = 0;
    let confidence = 0;
    let method: 'boundary' | 'projection' = 'boundary';

    if (detection.found) {
      const boundarySkew = estimateBoundarySkewAngleDeg(
        detection.quad,
        decoded.width,
        decoded.height
      );
      if (boundarySkew.consistent && Math.abs(boundarySkew.angleDeg) >= 0.6) {
        angleDeg = boundarySkew.angleDeg;
        confidence = boundarySkew.confidence;
        method = 'boundary';
      }
    }

    if (Math.abs(angleDeg) < 0.6) {
      const proj = detectProjectionSkewAngleDeg({
        rgba: decoded.rgba,
        width: decoded.width,
        height: decoded.height,
      });
      if (Math.abs(proj.angleDeg) >= 0.7) {
        angleDeg = proj.angleDeg;
        confidence = proj.confidence;
        method = 'projection';
      }
    }

    if (Math.abs(angleDeg) < 0.6) {
      return {
        applied: false,
        angleDeg: 0,
        confidence: 0,
        method,
        bytes,
        mimeType,
        width: decoded.width,
        height: decoded.height,
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        boundaryDetection: detection,
      };
    }

    const rotated = deskewRgbaImage({
      rgba: decoded.rgba,
      width: decoded.width,
      height: decoded.height,
      angleDeg,
    });
    const pngBytes = await encodeRgbaToPngBytesUniversal(
      rotated.rgba,
      rotated.width,
      rotated.height
    );

    let nextBoundary = detection;
    if (detection.found) {
      const nextQuad = rotateQuadByDeskewAngle({
        quad: detection.quad,
        angleDeg,
        srcWidth: decoded.width,
        srcHeight: decoded.height,
        dstWidth: rotated.width,
        dstHeight: rotated.height,
      });
      nextBoundary = {
        ...detection,
        quad: nextQuad,
        bounds: computeBoundsFromQuad(nextQuad),
        isSkewed: isQuadSkewed(nextQuad),
      };
    }

    return {
      applied: true,
      angleDeg,
      confidence,
      method,
      bytes: pngBytes,
      mimeType: 'image/png',
      width: rotated.width,
      height: rotated.height,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      boundaryDetection: nextBoundary,
    };
  } catch {
    return {
      applied: false,
      angleDeg: 0,
      confidence: 0,
      method: 'boundary',
      bytes,
      mimeType,
      width: 0,
      height: 0,
      boundaryDetection: params.boundaryDetection ?? {
        found: false,
        quad: cloneQuad(FULL_FRAME_QUAD),
        bounds: { ...ZERO_BOUNDS_INSETS },
        confidence: 0,
        method: 'contour',
        isSkewed: false,
      },
    };
  }
}
