// @vitest-environment node
/**
 * Byte-level picture inspection. The fixtures come from `imageFixtures.ts` so the parser is pinned
 * to the PNG/JPEG specifications rather than to whatever one encoder happens to emit.
 */
import { describe, expect, it } from 'vitest';
import {
  decodePrefix,
  describePictureFormat,
  inspectJpeg,
  inspectPng,
  pictureFormat,
  planPictureEmbedding,
} from './imageFormat';
import {
  adobeApp14,
  exifApp1,
  jpegBytes,
  jpegDataUrl,
  jpegSegment,
  pngBytes,
  pngChunk,
  pngDataUrl,
  sof,
  toDataUrl,
} from './imageFixtures';

const png = pngDataUrl;
const jpeg = jpegDataUrl;

describe('picture header inspection', () => {
  it('reads the PNG IHDR and stops at the first IDAT', () => {
    const bytes = pngBytes({ width: 120, height: 60, colorType: 6 });
    expect(inspectPng(bytes)).toMatchObject({
      width: 120, height: 60, bitDepth: 8, colorType: 6, interlaced: false, hasTrns: false, animated: false, truncated: false,
    });
  });

  it('notices Adam7 interlacing, tRNS transparency and APNG animation', () => {
    expect(inspectPng(pngBytes({ interlace: 1 }))).toMatchObject({ interlaced: true });
    const palette = pngBytes({ colorType: 3, extra: pngChunk('tRNS', [0, 0, 0]) });
    expect(inspectPng(palette)).toMatchObject({ hasTrns: true });
    const animated = pngBytes({ extra: pngChunk('acTL', [0, 0, 0, 3]) });
    expect(inspectPng(animated)).toMatchObject({ animated: true });
  });

  it('reports a truncated chunk walk instead of guessing', () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...pngChunk('IHDR', [0, 0, 0, 8, 0, 0, 0, 8, 8, 2, 0, 0, 0])]);
    expect(inspectPng(bytes)).toMatchObject({ width: 8, height: 8, truncated: true });
  });

  it('rejects buffers that are neither stream', () => {
    expect(inspectPng(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBeNull();
    expect(inspectJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('reads the JPEG SOF, the Adobe transform and the EXIF orientation', () => {
    const baseline = jpegBytes([sof(0xc0, 640, 480, 3)]);
    expect(inspectJpeg(baseline)).toMatchObject(
      { width: 640, height: 480, components: 3, progressive: false, adobe: false, adobeTransform: null, orientation: 1 });
    const grey = jpegBytes([sof(0xc2, 200, 100, 1)]);
    expect(inspectJpeg(grey)).toMatchObject({ width: 200, height: 100, components: 1, progressive: true });
    const inverted = jpegBytes([adobeApp14(2), sof(0xc0, 10, 20, 4)]);
    expect(inspectJpeg(inverted)).toMatchObject({ adobe: true, adobeTransform: 2, components: 4 });
    const plain = jpegBytes([adobeApp14(0), sof(0xc0, 10, 20, 4)]);
    expect(inspectJpeg(plain)).toMatchObject({ adobeTransform: 0 });
    const rotated = jpegBytes([exifApp1(6), sof(0xc0, 30, 40, 3), jpegSegment(0xda, [0, 1, 2])]);
    expect(inspectJpeg(rotated)).toMatchObject({ orientation: 6, width: 30, height: 40 });
    const motorola = jpegBytes([exifApp1(8, false), sof(0xc0, 1, 1, 3)]);
    expect(inspectJpeg(motorola)).toMatchObject({ orientation: 8, width: 1, height: 1 });
  });

  it('survives a huge header and reports what it could not see', () => {
    const padded = jpegBytes([jpegSegment(0xe0, new Array(4000).fill(7)), sof(0xc0, 320, 240, 3)]);
    expect(inspectJpeg(padded)).toMatchObject({ width: 320, height: 240 });
    // An APP0 that swallows the prefix leaves the component count unknown, which callers see as 0.
    const swallowed = jpegBytes([jpegSegment(0xe0, new Array(60000).fill(7))]);
    expect(inspectJpeg(swallowed)).toMatchObject({ width: 0, components: 0 });
  });

  it('keeps a JPEG with an unreadable SOF as a JPEG and rejects other streams', () => {
    expect(pictureFormat('data:image/gif;base64,R0lGODlhAQABAAAAACw=')).toMatchObject({ kind: 'unknown' });
    expect(pictureFormat(jpegDataUrl([sof(0xc0, 4, 4, 3)]))).toMatchObject({ kind: 'jpeg' });
  });
});

describe('embedding plan', () => {
  it('stores ordinary PNG and JPEG bytes untouched', () => {
    expect(planPictureEmbedding(png({ colorType: 2 }))).toMatchObject(
      { route: 'png', alpha: false, cmyk: false, patchDecode: false, width: 8, height: 8, notes: [] });
    expect(planPictureEmbedding(jpeg([sof(0xc0, 300, 200, 3)]))).toMatchObject(
      { route: 'jpeg', patchDecode: false, width: 300, height: 200 });
  });

  it('knows which PNGs carry transparency the PDF has to keep', () => {
    expect(planPictureEmbedding(png({ colorType: 6 }))).toMatchObject({ route: 'png', alpha: true });
    expect(planPictureEmbedding(png({ colorType: 4 }))).toMatchObject({ route: 'png', alpha: true });
    const palette = png({ colorType: 3, extra: pngChunk('tRNS', [1, 2, 3]) });
    expect(planPictureEmbedding(palette)).toMatchObject({ route: 'png', alpha: true });
    expect(planPictureEmbedding(png({ colorType: 3 }))).toMatchObject({ route: 'png', alpha: false });
    expect(planPictureEmbedding(png({ bitDepth: 16 }))).toMatchObject({ route: 'png', notes: ['16-bit samples are reduced to 8 bits'] });
  });

  it('flattens what a PDF viewer cannot decode', () => {
    const animated = png({ extra: pngChunk('acTL', [0, 0, 0, 2]) });
    expect(planPictureEmbedding(animated)).toMatchObject({ route: 'raster', notes: ['the animation is flattened to its first frame'] });
    expect(planPictureEmbedding(png({ colorType: 1 }))).toMatchObject({ route: 'raster', notes: ['PNG colour type 1 cannot be stored in a PDF'] });
    expect(planPictureEmbedding('data:text/plain,hello')).toMatchObject({ route: 'raster', notes: ['the overlay source is not a base64 image'] });
  });

  it('separates plain CMYK from Adobe complemented CMYK', () => {
    const unmarked = jpeg([sof(0xc0, 10, 20, 4)]);
    expect(planPictureEmbedding(unmarked)).toMatchObject(
      { route: 'jpeg', cmyk: true, patchDecode: true, notes: ['plain CMYK samples are stored as-is instead of complemented'] });
    const plainAdobe = jpeg([adobeApp14(0), sof(0xc0, 10, 20, 4)]);
    expect(planPictureEmbedding(plainAdobe)).toMatchObject({ patchDecode: true });
    const inverted = jpeg([adobeApp14(2), sof(0xc0, 10, 20, 4)]);
    expect(planPictureEmbedding(inverted)).toMatchObject(
      { route: 'jpeg', cmyk: true, patchDecode: false, notes: ['CMYK samples follow the Adobe complemented convention'] });
    // An APP14 whose layout we do not understand must not change the bytes.
    const odd = jpeg([jpegSegment(0xee, [0x41, 0x64, 0x6f, 0x62, 0x65, 0x00, 12, 0, 0, 0, 0, 9, 9, 9]), sof(0xc0, 10, 20, 4)]);
    expect(planPictureEmbedding(odd)).toMatchObject({ route: 'jpeg', patchDecode: false });
  });

  it('bakes EXIF orientation in so the print matches the rotated preview', () => {
    const rotated = jpeg([exifApp1(3), sof(0xc0, 40, 20, 3)]);
    expect(planPictureEmbedding(rotated)).toMatchObject({ route: 'raster', width: 40, height: 20, notes: ['EXIF orientation 3 is baked in before embedding'] });
  });

  it('refuses a JPEG with a component count no PDF colour space can hold', () => {
    const odd = jpeg([sof(0xc0, 10, 10, 2)]);
    expect(planPictureEmbedding(odd)).toMatchObject({ route: 'raster', notes: ['a JPEG with 2 components cannot be stored in a PDF'] });
  });

  it('flattens a JPEG whose header is bigger than the inspected prefix', () => {
    const huge = toDataUrl('image/jpeg', jpegBytes([jpegSegment(0xe0, new Array(70000).fill(7)), sof(0xc0, 10, 10, 3)]));
    expect(planPictureEmbedding(huge)).toMatchObject({ route: 'raster', notes: ['the JPEG header is larger than the inspected prefix, so it is rasterized'] });
  });

  it('looks at the bytes, not at the declared MIME type', () => {
    const mislabelled = toDataUrl('image/png', jpegBytes([sof(0xc0, 10, 20, 3)]));
    expect(pictureFormat(mislabelled)).toMatchObject({ kind: 'jpeg' });
    expect(planPictureEmbedding(mislabelled)).toMatchObject({ route: 'jpeg', width: 10, height: 20 });
  });
});

describe('format summary', () => {
  it('describes colour types for the panel', () => {
    expect(describePictureFormat(png({ width: 12, height: 34, colorType: 6, bitDepth: 8 }))).toBe('PNG 12×34, RGB + alpha, 8-bit');
    expect(describePictureFormat(png({ interlace: 1, extra: pngChunk('acTL', [0]) }))).toBe('PNG 8×8, RGB, 8-bit, interlaced, animated');
    expect(describePictureFormat(jpeg([adobeApp14(2), sof(0xc2, 100, 50, 4)]))).toBe('JPEG 100×50, CMYK (Adobe inverted), progressive');
    expect(describePictureFormat(jpeg([sof(0xc0, 100, 50, 1)]))).toBe('JPEG 100×50, greyscale');
    expect(describePictureFormat('data:image/png;base64,###')).toBe('Unrecognised picture (the overlay source is not a base64 image)');
    const sized = describePictureFormat('data:image/png;base64,###', { width: 3, height: 5 });
    expect(sized).toBe('Bitmap 3×5 (the overlay source is not a base64 image)');
  });
});

// Real encoder output is the guard against a parser that only matches its own fixtures.
let real: { png: string; jpeg: string } | null = null;
try {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(37, 21);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(255,0,0,0.5)';
  ctx.fillRect(0, 0, 20, 20);
  ctx.fillStyle = '#00f';
  ctx.fillRect(20, 0, 17, 21);
  real = { png: canvas.toDataURL('image/png'), jpeg: canvas.toDataURL('image/jpeg', 0.8) };
} catch { real = null; }

describe('against a real encoder', () => {
  it.skipIf(!real)('reads the PNG and JPEG a canvas produced', () => {
    expect(planPictureEmbedding(real!.png)).toMatchObject({ route: 'png', alpha: true, width: 37, height: 21, notes: [] });
    expect(planPictureEmbedding(real!.jpeg)).toMatchObject({ route: 'jpeg', alpha: false, width: 37, height: 21, notes: [] });
    expect(describePictureFormat(real!.png)).toBe('PNG 37×21, RGB + alpha, 8-bit');
    expect(describePictureFormat(real!.jpeg)).toBe('JPEG 37×21, YCbCr');
  });
});

describe('prefix decoding', () => {
  it('decodes only what a header needs and rejects anything else', () => {
    const src = toDataUrl('image/png', pngBytes({ width: 4, height: 4 }));
    const decoded = decodePrefix(src, 32);
    expect(decoded).not.toBeNull();
    expect(decoded!.length).toBeLessThanOrEqual(33);
    expect(Array.from(decoded!.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(decodePrefix('data:image/png,raw')).toBeNull();
    expect(decodePrefix('https://example.test/a.png')).toBeNull();
    expect(decodePrefix('data:image/png;base64,!!!!')).toBeNull();
  });
});
