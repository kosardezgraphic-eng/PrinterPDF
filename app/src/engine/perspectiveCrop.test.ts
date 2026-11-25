import { describe, expect, it } from 'vitest';
import type { PageItem, SourceDocument } from '@shared/models';
import {
  computePerspectiveOutputDimensions,
  detectDocumentQuadOffline,
  displayQuadToSourceQuad,
  evaluateHomography,
  isConvexQuad,
  isDefaultPerspectiveQuad,
  DEFAULT_PERSPECTIVE_QUAD,
  rectifyPagePerspective,
  solveUnitSquareToQuadHomography,
  warpPerspectiveRgba,
  type PerspectiveQuad,
} from './perspectiveCrop';
import { encodeRgbaToPngBytesUniversal } from './universalImageDecoder';

describe('perspectiveCrop engine', () => {
  it('solves exact planar projective homography mapping unit square to arbitrary convex quad', () => {
    const quad: PerspectiveQuad = {
      tl: { x: 0.15, y: 0.1 },
      tr: { x: 0.85, y: 0.2 },
      br: { x: 0.92, y: 0.9 },
      bl: { x: 0.08, y: 0.82 },
    };
    const H = solveUnitSquareToQuadHomography(quad);
    expect(evaluateHomography(H, 0, 0).x).toBeCloseTo(quad.tl.x, 6);
    expect(evaluateHomography(H, 0, 0).y).toBeCloseTo(quad.tl.y, 6);
    expect(evaluateHomography(H, 1, 0).x).toBeCloseTo(quad.tr.x, 6);
    expect(evaluateHomography(H, 1, 0).y).toBeCloseTo(quad.tr.y, 6);
    expect(evaluateHomography(H, 1, 1).x).toBeCloseTo(quad.br.x, 6);
    expect(evaluateHomography(H, 1, 1).y).toBeCloseTo(quad.br.y, 6);
    expect(evaluateHomography(H, 0, 1).x).toBeCloseTo(quad.bl.x, 6);
    expect(evaluateHomography(H, 0, 1).y).toBeCloseTo(quad.bl.y, 6);
  });

  it('validates convex vs self-intersecting / degenerate quads and default state', () => {
    expect(isDefaultPerspectiveQuad(DEFAULT_PERSPECTIVE_QUAD)).toBe(true);
    expect(isConvexQuad(DEFAULT_PERSPECTIVE_QUAD)).toBe(true);

    // Bowtie / crossed quad (tr and br swapped)
    expect(
      isConvexQuad({
        tl: { x: 0.1, y: 0.1 },
        tr: { x: 0.9, y: 0.9 },
        br: { x: 0.9, y: 0.1 },
        bl: { x: 0.1, y: 0.9 },
      })
    ).toBe(false);

    // Zero-area collapsed quad
    expect(
      isConvexQuad({
        tl: { x: 0.5, y: 0.5 },
        tr: { x: 0.5, y: 0.5 },
        br: { x: 0.5, y: 0.5 },
        bl: { x: 0.5, y: 0.5 },
      })
    ).toBe(false);
  });

  it('rectifies a skewed quadrilateral document via warpPerspectiveRgba', () => {
    // Build a 100x100 RGBA image where pixels inside a tilted trapezoid are pure Red (255,0,0)
    // and outside are pure Blue (0,0,255)
    const W = 100;
    const H = 100;
    const src = new Uint8ClampedArray(W * H * 4);
    const quad: PerspectiveQuad = {
      tl: { x: 0.25, y: 0.2 },
      tr: { x: 0.8, y: 0.15 },
      br: { x: 0.9, y: 0.85 },
      bl: { x: 0.1, y: 0.8 },
    };

    const pointInQuad = (nx: number, ny: number) => {
      const pts = [quad.tl, quad.tr, quad.br, quad.bl];
      let pos = 0;
      let neg = 0;
      for (let i = 0; i < 4; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        const cross = (b.x - a.x) * (ny - a.y) - (b.y - a.y) * (nx - a.x);
        if (cross >= 0) pos++;
        if (cross <= 0) neg++;
      }
      return pos === 4 || neg === 4;
    };

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        const inside = pointInQuad(x / (W - 1), y / (H - 1));
        src[idx] = inside ? 255 : 0;
        src[idx + 1] = 0;
        src[idx + 2] = inside ? 0 : 255;
        src[idx + 3] = 255;
      }
    }

    // Shrink quad by 4% inward to avoid edge interpolation bleed
    const insetQuad: PerspectiveQuad = {
      tl: { x: 0.29, y: 0.24 },
      tr: { x: 0.76, y: 0.19 },
      br: { x: 0.85, y: 0.8 },
      bl: { x: 0.15, y: 0.76 },
    };

    const dst = warpPerspectiveRgba({
      srcRgba: src,
      srcWidth: W,
      srcHeight: H,
      dstWidth: 40,
      dstHeight: 40,
      sourceQuad: insetQuad,
    });

    // All center and inner-corner pixels of rectified output must be pure red
    for (let y = 2; y < 38; y++) {
      for (let x = 2; x < 38; x++) {
        const idx = (y * 40 + x) * 4;
        expect(dst[idx]).toBeGreaterThan(240);
        expect(dst[idx + 2]).toBeLessThan(15);
      }
    }
  });

  it('computes accurate output dimensions for auto and A4/card presets and respects 90° rotation', async () => {
    const srcQuadRot = displayQuadToSourceQuad(
      {
        tl: { x: 0.1, y: 0.2 },
        tr: { x: 0.9, y: 0.2 },
        br: { x: 0.9, y: 0.8 },
        bl: { x: 0.1, y: 0.8 },
      },
      90
    );
    expect(srcQuadRot.tl.x).toBeCloseTo(0.2, 5);
    expect(srcQuadRot.tl.y).toBeCloseTo(0.9, 5);

    const a4Dims = computePerspectiveOutputDimensions({
      sourceWidthPx: 1000,
      sourceHeightPx: 1400,
      sourceWidthMm: 210,
      sourceHeightMm: 297,
      sourceQuad: DEFAULT_PERSPECTIVE_QUAD,
      aspectPreset: 'a4-portrait',
    });
    expect(a4Dims.widthMm).toBe(210);
    expect(a4Dims.heightMm).toBe(297);

    // Full end-to-end rectifyPagePerspective on a PNG SourceDocument
    const rawRgba = new Uint8ClampedArray(30 * 20 * 4);
    for (let i = 0; i < rawRgba.length; i += 4) {
      rawRgba[i] = 40;
      rawRgba[i + 1] = 180;
      rawRgba[i + 2] = 90;
      rawRgba[i + 3] = 255;
    }
    const pngBytes = await encodeRgbaToPngBytesUniversal(rawRgba, 30, 20);
    const doc: SourceDocument = {
      id: 'd-persp',
      name: 'skewed.png',
      filePath: '',
      fileSize: pngBytes.byteLength,
      fileType: 'image',
      mimeType: 'image/png',
      pageCount: 1,
      createdAt: '',
      rawBytes: pngBytes,
    };
    const page: PageItem = {
      id: 'p-persp',
      documentId: 'd-persp',
      documentName: 'skewed.png',
      sourcePageNumber: 1,
      widthMm: 150,
      heightMm: 100,
      rotation: 0,
      selectedForPrint: true,
      isHighlighted: true,
      isBlankPage: false,
      colorProfile: 'color',
      inkCoveragePercent: 30,
    };

    const result = await rectifyPagePerspective({
      page,
      sourceDoc: doc,
      displayQuad: {
        tl: { x: 0.1, y: 0.1 },
        tr: { x: 0.9, y: 0.15 },
        br: { x: 0.88, y: 0.9 },
        bl: { x: 0.12, y: 0.85 },
      },
      effectiveRotation: 0,
      aspectPreset: 'card-landscape',
    });

    expect(result.widthMm).toBe(85);
    expect(result.heightMm).toBe(55);
    expect(result.pngBytes.byteLength).toBeGreaterThan(20);
    expect(result.thumbnailDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('detects 4 corners of a skewed white sheet on a dark background offline even with dark ink inside', () => {
    const W = 200;
    const H = 200;
    const rgba = new Uint8ClampedArray(W * H * 4);
    const trueQuad: PerspectiveQuad = {
      tl: { x: 0.18, y: 0.14 },
      tr: { x: 0.84, y: 0.2 },
      br: { x: 0.88, y: 0.86 },
      bl: { x: 0.12, y: 0.82 },
    };
    const inQuad = (nx: number, ny: number) => {
      const pts = [trueQuad.tl, trueQuad.tr, trueQuad.br, trueQuad.bl];
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
    };

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        const nx = x / (W - 1);
        const ny = y / (H - 1);
        const inside = inQuad(nx, ny);
        // Simulate dark printed text/blocks inside the bright sheet
        const darkTextInside = inside && nx > 0.35 && nx < 0.65 && ny > 0.4 && ny < 0.58;
        const v = darkTextInside ? 35 : inside ? 245 : 32;
        rgba[idx] = v;
        rgba[idx + 1] = v;
        rgba[idx + 2] = v;
        rgba[idx + 3] = 255;
      }
    }

    const res = detectDocumentQuadOffline({ rgba, width: W, height: H });
    expect(res.found).toBe(true);
    expect(isConvexQuad(res.quad)).toBe(true);
    expect(Math.hypot(res.quad.tl.x - trueQuad.tl.x, res.quad.tl.y - trueQuad.tl.y)).toBeLessThan(0.05);
    expect(Math.hypot(res.quad.tr.x - trueQuad.tr.x, res.quad.tr.y - trueQuad.tr.y)).toBeLessThan(0.05);
    expect(Math.hypot(res.quad.br.x - trueQuad.br.x, res.quad.br.y - trueQuad.br.y)).toBeLessThan(0.05);
    expect(Math.hypot(res.quad.bl.x - trueQuad.bl.x, res.quad.bl.y - trueQuad.bl.y)).toBeLessThan(0.05);

    // Uniform image returns found: false with default full-frame quad
    const flat = new Uint8ClampedArray(30 * 30 * 4).fill(180);
    const flatRes = detectDocumentQuadOffline({ rgba: flat, width: 30, height: 30 });
    expect(flatRes.found).toBe(false);
    expect(isDefaultPerspectiveQuad(flatRes.quad)).toBe(true);
  });
});
