import { describe, expect, it } from 'vitest';
import {
  autoDeskewDecodedImage,
  deskewRgbaImage,
  detectProjectionSkewAngleDeg,
  detectRawScanBoundaries,
  detectRawScanBoundariesFromEncodedBytes,
  estimateBoundarySkewAngleDeg,
  isConvexDetectedQuad,
  rotateQuadByDeskewAngle,
  type QuadCorners,
} from './scanBoundaryDetector';
import { encodeRgbaToPngBytesUniversal } from './universalImageDecoder';
import { importFilesBatch } from './pdfService';

function pointInQuad(nx: number, ny: number, quad: QuadCorners): boolean {
  const pts = [quad.tl, quad.tr, quad.br, quad.bl];
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const c = (b.x - a.x) * (ny - a.y) - (b.y - a.y) * (nx - a.x);
    if (c >= 0) pos++;
    if (c <= 0) neg++;
  }
  return pos === 4 || neg === 4;
}

function makeRawScanRgba(params: {
  width: number;
  height: number;
  quad: QuadCorners;
  bgColor: [number, number, number];
  sheetColor: [number, number, number];
  withInteriorText?: boolean;
  withDustSpecks?: boolean;
}): Uint8ClampedArray {
  const {
    width,
    height,
    quad,
    bgColor,
    sheetColor,
    withInteriorText = false,
    withDustSpecks = false,
  } = params;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const nx = x / (width - 1);
      const ny = y / (height - 1);
      const inside = pointInQuad(nx, ny, quad);
      let [r, g, b] = inside ? sheetColor : bgColor;
      if (inside && withInteriorText && nx > 0.35 && nx < 0.65 && ny > 0.4 && ny < 0.58) {
        r = 35;
        g = 35;
        b = 38;
      }
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }
  if (withDustSpecks) {
    // Place isolated 1-2px bright specks near image corners outside the document
    for (const [sx, sy] of [
      [5, 5],
      [width - 6, 6],
      [6, height - 6],
      [width - 7, height - 7],
    ]) {
      const idx = (sy * width + sx) * 4;
      rgba[idx] = 250;
      rgba[idx + 1] = 250;
      rgba[idx + 2] = 250;
    }
  }
  return rgba;
}

function makeRotatedRectQuad(angleDeg: number, halfW = 0.28, halfH = 0.34): QuadCorners {
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const rot = (dx: number, dy: number) => ({
    x: 0.5 + dx * c - dy * s,
    y: 0.5 + dx * s + dy * c,
  });
  return {
    tl: rot(-halfW, -halfH),
    tr: rot(halfW, -halfH),
    br: rot(halfW, halfH),
    bl: rot(-halfW, halfH),
  };
}

function makeFullFrameTextLinesRgba(width: number, height: number, tiltDeg: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const rad = (tiltDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const cx = width * 0.5;
  const cy = height * 0.5;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Un-tilted coordinates on the document page
      const dx = x - cx;
      const dy = y - cy;
      const ux = dx * cosA + dy * sinA + cx;
      const uy = -dx * sinA + dy * cosA + cy;
      const idx = (y * width + x) * 4;
      const inMargins = ux > width * 0.14 && ux < width * 0.86 && uy > height * 0.14 && uy < height * 0.86;
      const linePhase = ((uy % 14) + 14) % 14;
      const wordGap = ((ux % 18) + 18) % 18;
      const isInk = inMargins && linePhase < 3 && wordGap < 14;
      const v = isInk ? 28 : 246;
      rgba[idx] = v;
      rgba[idx + 1] = v;
      rgba[idx + 2] = v;
      rgba[idx + 3] = 255;
    }
  }
  return rgba;
}

describe('scanBoundaryDetector offline CV utility & import pipeline', () => {
  it('detects 4 corners, skew flag, and bounds of a tilted paper scan with dust specks and interior print', () => {
    const trueQuad: QuadCorners = {
      tl: { x: 0.16, y: 0.12 },
      tr: { x: 0.84, y: 0.19 },
      br: { x: 0.89, y: 0.88 },
      bl: { x: 0.11, y: 0.83 },
    };
    const rgba = makeRawScanRgba({
      width: 200,
      height: 200,
      quad: trueQuad,
      bgColor: [30, 32, 36],
      sheetColor: [244, 242, 236],
      withInteriorText: true,
      withDustSpecks: true,
    });

    const result = detectRawScanBoundaries({ rgba, width: 200, height: 200 });
    expect(result.found).toBe(true);
    expect(result.isSkewed).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(isConvexDetectedQuad(result.quad)).toBe(true);
    expect(Math.hypot(result.quad.tl.x - trueQuad.tl.x, result.quad.tl.y - trueQuad.tl.y)).toBeLessThan(0.05);
    expect(Math.hypot(result.quad.tr.x - trueQuad.tr.x, result.quad.tr.y - trueQuad.tr.y)).toBeLessThan(0.05);
    expect(Math.hypot(result.quad.br.x - trueQuad.br.x, result.quad.br.y - trueQuad.br.y)).toBeLessThan(0.05);
    expect(Math.hypot(result.quad.bl.x - trueQuad.bl.x, result.quad.bl.y - trueQuad.bl.y)).toBeLessThan(0.05);
    expect(result.bounds.left).toBeCloseTo(0.11, 1);
    expect(result.bounds.right).toBeCloseTo(0.11, 1);
  });

  it('detects a tilted colored/dark ID card scanned on a white flatbed scanner lid', () => {
    const cardQuad: QuadCorners = {
      tl: { x: 0.2, y: 0.24 },
      tr: { x: 0.78, y: 0.18 },
      br: { x: 0.82, y: 0.74 },
      bl: { x: 0.24, y: 0.8 },
    };
    const rgba = makeRawScanRgba({
      width: 180,
      height: 180,
      quad: cardQuad,
      bgColor: [248, 248, 248],
      sheetColor: [42, 68, 122],
    });

    const result = detectRawScanBoundaries({ rgba, width: 180, height: 180 });
    expect(result.found).toBe(true);
    expect(isConvexDetectedQuad(result.quad)).toBe(true);
    expect(Math.hypot(result.quad.tl.x - cardQuad.tl.x, result.quad.tl.y - cardQuad.tl.y)).toBeLessThan(0.05);
    expect(Math.hypot(result.quad.br.x - cardQuad.br.x, result.quad.br.y - cardQuad.br.y)).toBeLessThan(0.05);
  });

  it('refines document corners accurately on high-resolution scans without following interior print', () => {
    const trueQuad: QuadCorners = {
      tl: { x: 0.137, y: 0.112 },
      tr: { x: 0.861, y: 0.174 },
      br: { x: 0.892, y: 0.887 },
      bl: { x: 0.104, y: 0.824 },
    };
    const width = 1280;
    const height = 960;
    const rgba = makeRawScanRgba({
      width,
      height,
      quad: trueQuad,
      bgColor: [28, 30, 34],
      sheetColor: [246, 244, 238],
      withInteriorText: true,
      withDustSpecks: true,
    });

    const result = detectRawScanBoundaries({ rgba, width, height });
    expect(result.found).toBe(true);
    expect(isConvexDetectedQuad(result.quad)).toBe(true);
    for (const corner of ['tl', 'tr', 'br', 'bl'] as const) {
      expect(Math.hypot(
        result.quad[corner].x - trueQuad[corner].x,
        result.quad[corner].y - trueQuad[corner].y
      )).toBeLessThan(0.025);
    }
  });

  it('returns found: false on uniform or tiny non-scan images', async () => {
    const flat = new Uint8ClampedArray(60 * 60 * 4).fill(220);
    const pngBytes = await encodeRgbaToPngBytesUniversal(flat, 60, 60);
    const detected = await detectRawScanBoundariesFromEncodedBytes(pngBytes, 'image/png');
    expect(detected.found).toBe(false);
    expect(detected.quad).toEqual({
      tl: { x: 0, y: 0 },
      tr: { x: 1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    });
  });

  it('estimates +8 deg boundary tilt and deskews raster + quad back to axis-aligned', () => {
    const tiltedQuad = makeRotatedRectQuad(8, 0.26, 0.34);
    const rgba = makeRawScanRgba({
      width: 220,
      height: 220,
      quad: tiltedQuad,
      bgColor: [25, 25, 30],
      sheetColor: [246, 244, 238],
      withInteriorText: true,
    });

    const detected = detectRawScanBoundaries({ rgba, width: 220, height: 220 });
    expect(detected.found).toBe(true);

    const skew = estimateBoundarySkewAngleDeg(detected.quad, 220, 220);
    expect(skew.consistent).toBe(true);
    expect(skew.angleDeg).toBeGreaterThan(6.5);
    expect(skew.angleDeg).toBeLessThan(9.5);

    const rotated = deskewRgbaImage({
      rgba,
      width: 220,
      height: 220,
      angleDeg: skew.angleDeg,
    });
    expect(rotated.width).toBeGreaterThanOrEqual(220);
    expect(rotated.height).toBeGreaterThanOrEqual(220);

    const transformedQuad = rotateQuadByDeskewAngle({
      quad: detected.quad,
      angleDeg: skew.angleDeg,
      srcWidth: 220,
      srcHeight: 220,
      dstWidth: rotated.width,
      dstHeight: rotated.height,
    });
    // After rotation by -skew.angleDeg, top edge should be nearly flat
    expect(Math.abs(transformedQuad.tl.y - transformedQuad.tr.y)).toBeLessThan(0.025);
    expect(Math.abs(transformedQuad.bl.y - transformedQuad.br.y)).toBeLessThan(0.025);

    // Re-running boundary detection on straightened image finds minimal residual skew
    const afterDetect = detectRawScanBoundaries({
      rgba: rotated.rgba,
      width: rotated.width,
      height: rotated.height,
    });
    expect(afterDetect.found).toBe(true);
    const residual = estimateBoundarySkewAngleDeg(afterDetect.quad, rotated.width, rotated.height);
    expect(Math.abs(residual.angleDeg)).toBeLessThan(1.5);
  });

  it('detects and straightens full-frame -6 deg tilted text lines via projection profile without outer borders', async () => {
    const tiltedLinesRgba = makeFullFrameTextLinesRgba(200, 200, -6);
    const est = detectProjectionSkewAngleDeg({ rgba: tiltedLinesRgba, width: 200, height: 200 });
    expect(Math.abs(est.angleDeg - -6)).toBeLessThan(1.2);
    expect(est.confidence).toBeGreaterThan(0.35);

    const pngBytes = await encodeRgbaToPngBytesUniversal(tiltedLinesRgba, 200, 200);
    const deskewed = await autoDeskewDecodedImage({ bytes: pngBytes, mimeType: 'image/png' });
    expect(deskewed.applied).toBe(true);
    expect(deskewed.method).toBe('projection');
    expect(Math.abs(deskewed.angleDeg - -6)).toBeLessThan(1.2);

    // Already horizontal text image must not trigger deskew
    const flatLinesRgba = makeFullFrameTextLinesRgba(200, 200, 0);
    const flatPng = await encodeRgbaToPngBytesUniversal(flatLinesRgba, 200, 200);
    const notDeskewed = await autoDeskewDecodedImage({ bytes: flatPng, mimeType: 'image/png' });
    expect(notDeskewed.applied).toBe(false);
  });

  it('automatically populates PageItem.overrides.detectedBoundaries and deskewInfo inside importFilesBatch when tilted, while respecting autoDeskew: false', async () => {
    const trueQuad = makeRotatedRectQuad(9, 0.27, 0.33);
    const scanRgba = makeRawScanRgba({
      width: 180,
      height: 180,
      quad: trueQuad,
      bgColor: [24, 24, 28],
      sheetColor: [245, 245, 240],
      withInteriorText: true,
    });
    const scanPng = await encodeRgbaToPngBytesUniversal(scanRgba, 180, 180);
    const scanBuf = new Uint8Array(scanPng);
    const makeScanFile = () => {
      const f = new File([scanBuf], 'scanned-invoice.png', { type: 'image/png' });
      Object.defineProperty(f, 'arrayBuffer', {
        value: async () => scanBuf.buffer.slice(scanBuf.byteOffset, scanBuf.byteOffset + scanBuf.byteLength),
      });
      return f;
    };

    const flatRgba = new Uint8ClampedArray(40 * 40 * 4).fill(200);
    const flatPng = await encodeRgbaToPngBytesUniversal(flatRgba, 40, 40);
    const flatBuf = new Uint8Array(flatPng);
    const flatFile = new File([flatBuf], 'solid-artwork.png', { type: 'image/png' });
    Object.defineProperty(flatFile, 'arrayBuffer', {
      value: async () => flatBuf.buffer.slice(flatBuf.byteOffset, flatBuf.byteOffset + flatBuf.byteLength),
    });

    // 1) Default autoDeskew: true straightens the tilted scan and preserves preDeskewRawBytes
    const batch = await importFilesBatch([makeScanFile(), flatFile]);
    expect(batch.errors).toEqual([]);
    expect(batch.pages).toHaveLength(2);
    expect(batch.documents).toHaveLength(2);

    const scanPage = batch.pages[0];
    const scanDoc = batch.documents[0];
    expect(scanPage.overrides?.deskewInfo?.applied).toBe(true);
    expect(scanPage.overrides!.deskewInfo!.angleDeg).toBeGreaterThan(7);
    expect(scanDoc.preDeskewRawBytes).toBeDefined();
    expect(scanPage.overrides?.detectedBoundaries).toBeDefined();
    const detected = scanPage.overrides!.detectedBoundaries!;
    expect(detected.confidence).toBeGreaterThan(0.5);
    // After auto-deskew, top and bottom paper edges are straight
    expect(Math.abs(detected.corners.tl.y - detected.corners.tr.y)).toBeLessThan(0.03);

    const flatPage = batch.pages[1];
    expect(flatPage.overrides?.detectedBoundaries).toBeUndefined();
    expect(flatPage.overrides?.deskewInfo).toBeUndefined();

    // 2) autoDeskew: false skips deskew while still detecting raw boundaries
    const skipped = await importFilesBatch([makeScanFile()], undefined, { autoDeskew: false });
    expect(skipped.pages[0].overrides?.deskewInfo).toBeUndefined();
    expect(skipped.documents[0].preDeskewRawBytes).toBeUndefined();
    expect(skipped.pages[0].overrides?.detectedBoundaries?.isSkewed).toBe(true);
  });
});

