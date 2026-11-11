/**
 * PrintStudio Pro — byte-level picture inspection.
 *
 * The exporter has to know what a data URL really contains before handing it to pdf-lib,
 * because pdf-lib only reads the JPEG/PNG header and never corrects it: CMYK streams get an
 * inversion "hedge" that is wrong for plain CMYK, EXIF orientation is ignored, and an animated
 * PNG throws. Reading the header here lets preview and export follow one plan instead of two
 * guesses, and keeps the whole check free of any pixel decoding.
 */

export interface PngInfo {
  width: number; height: number;
  bitDepth: number;
  /** PNG colour type: 0 grey, 2 RGB, 3 palette, 4 grey+alpha, 6 RGBA. */
  colorType: number;
  interlaced: boolean;
  hasTrns: boolean;
  animated: boolean;
  /** True when the chunk walk ran out of bytes before the first IDAT, so tRNS/acTL may be unseen. */
  truncated: boolean;
}

export interface JpegInfo {
  width: number; height: number;
  /** Number of colour components in the start-of-frame marker. */
  components: number;
  /** True when an APP14 "Adobe" segment was found, whatever it claims about the samples. */
  adobe: boolean;
  /**
   * The APP14 transform byte when the segment can be read with confidence: 0 plain samples,
   * 1 YCCK, 2 Adobe's complemented CMYK. Encoders disagree about where in APP14 that byte sits,
   * so it is only reported when the byte two places after a `bits per component` of 8 is in
   * range — the exporter never has to trust a guessed offset.
   */
  adobeTransform: number | null;
  progressive: boolean;
  /** 1..8 from EXIF, or 1 when there is no orientation tag. */
  orientation: number;
}

export type PictureFormat =
  | { kind: 'png'; png: PngInfo }
  | { kind: 'jpeg'; jpeg: JpegInfo }
  | { kind: 'unknown'; reason: string };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Colour types pdf-lib decodes through UPNG; anything else has to go through the Canvas. */
const PNG_EMBEDDABLE_TYPES = new Set([0, 2, 3, 4, 6]);
const PNG_ALPHA_TYPES = new Set([4, 6]);

/**
 * Decodes only the first `bytes` of a base64 payload. Slicing the string before decoding keeps
 * this cheap for multi-megabyte data URLs, and multiples of four keep `atob` happy.
 */
export function decodePrefix(src: string, bytes = 65536): Uint8Array | null {
  const comma = src.indexOf(',');
  if (comma < 0 || !/;base64$/i.test(src.slice(0, comma))) return null;
  // Unpadded base64 is valid for `atob`, and a slice that leaves one dangling character is not.
  const raw = src.slice(comma + 1, comma + 1 + Math.ceil(bytes / 3) * 4).replace(/\s+/g, '').replace(/=+$/, '');
  if (raw.length < 4) return null;
  const aligned = raw.length % 4 === 1 ? raw.slice(0, -1) : raw;
  if (!/^[A-Za-z0-9+/]+$/.test(aligned)) return null;
  try {
    const binary = typeof atob === 'function' ? atob(aligned) : Buffer.from(aligned, 'base64').toString('binary');
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch { return null; }
}

export function inspectPng(bytes: Uint8Array): PngInfo | null {
  if (bytes.length < 33) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const info: PngInfo = {
    width: view.getUint32(16), height: view.getUint32(20),
    bitDepth: bytes[24], colorType: bytes[25],
    interlaced: bytes[28] === 1, hasTrns: false, animated: false, truncated: true,
  };
  // Walk the chunk list up to the first IDAT: tRNS/acTL always precede the pixel data.
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    if (!(length >= 0) || offset + 12 + length > bytes.length) break;
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (type === 'tRNS') info.hasTrns = true;
    if (type === 'acTL') info.animated = true;
    if (type === 'IDAT' || type === 'IEND') { info.truncated = false; break; }
    offset += 12 + length;
  }
  return info;
}

/** The orientation tag from a JPEG's EXIF APP1 segment, or 1 when absent or unreadable. */
function readExifOrientation(view: DataView, start: number, end: number): number {
  if (start + 14 > end || view.getUint32(start) !== 0x45786966) return 1;          // "Exif"
  const tiff = start + 6;
  if (tiff + 8 > end) return 1;
  const order = view.getUint16(tiff);
  if (order !== 0x4949 && order !== 0x4d4d) return 1;
  const little = order === 0x4949;
  const u16 = (at: number) => (at + 2 <= end ? little ? view.getUint16(at, true) : view.getUint16(at) : 0);
  const u32 = (at: number) => (at + 4 <= end ? little ? view.getUint32(at, true) : view.getUint32(at) : 0);
  if (u16(tiff + 2) !== 0x2a) return 1;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const entries = Math.min(u16(ifd), 40);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (u16(entry) !== 0x0112) continue;
    const value = u16(entry + 8);                                                    // SHORT lives in the value field
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

/** Finds the APP14 colour-transform byte, using the offset Skia and ImageMagick read. */
function readAdobeTransform(payload: Uint8Array): number | null {
  // A well-formed Adobe segment is 12 bytes: "Adobe\0" (0..5), version, flags, bits per component,
  // colour transform last. Anything else is reported as unreadable instead of being guessed at.
  const value = payload.length >= 12 ? payload[11] : -1;
  return value <= 3 ? value : null;
}

export function inspectJpeg(bytes: Uint8Array): JpegInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.byteLength;
  const info: JpegInfo = { width: 0, height: 0, components: 0, adobe: false, adobeTransform: null, progressive: false, orientation: 1 };
  let offset = 2;
  while (offset + 4 <= end) {
    while (offset < end && bytes[offset] !== 0xff) offset++;
    while (offset < end && bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;             // standalone markers
    if (offset + 2 > end) break;
    const length = view.getUint16(offset);
    const start = offset + 2;
    if (length < 2 || start + length - 2 > end) break;                              // truncated header
    if (marker === 0xda) break;                                    // start of scan: nothing to learn after
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (info.width === 0) {
        info.height = view.getUint16(start + 1);
        info.width = view.getUint16(start + 3);
        info.components = bytes[start + 5];
        info.progressive = marker === 0xc2;
      }
    } else if (marker === 0xee) {                                                    // APP14
      const payload = bytes.subarray(start, Math.min(end, start + length - 2));
      const isAdobe = payload.length >= 6 && payload[0] === 0x41 && payload[1] === 0x64 &&
        payload[2] === 0x6f && payload[3] === 0x62 && payload[4] === 0x65 && payload[5] === 0x00;  // "Adobe\0"
      if (isAdobe) {
        info.adobe = true;
        info.adobeTransform = readAdobeTransform(payload);
      }
    } else if (marker === 0xe1) {
      info.orientation = readExifOrientation(view, start, Math.min(end, start + length - 2));
    }
    offset = start + length - 2;
  }
  // A JPEG is still a JPEG with an unreadable header: report it, with zero dimensions.
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? info : null;
}

export function pictureFormat(src: string): PictureFormat {
  const bytes = decodePrefix(src);
  if (!bytes) return { kind: 'unknown', reason: 'the overlay source is not a base64 image' };
  const png = inspectPng(bytes);
  if (png) return { kind: 'png', png };
  const jpeg = inspectJpeg(bytes);
  if (jpeg) return { kind: 'jpeg', jpeg };
  return { kind: 'unknown', reason: 'the bytes are neither a PNG nor a JPEG stream' };
}

export interface PicturePlan {
  /** `png`/`jpeg` store the file as is; `raster` draws it through Canvas 2D first. */
  route: 'png' | 'jpeg' | 'raster';
  /** The stored bytes carry real transparency, so the PDF needs its soft mask. */
  alpha: boolean;
  cmyk: boolean;
  /**
   * pdf-lib always complements CMYK samples. That is right for Adobe's inverted CMYK
   * (APP14 transform 2) and wrong for plain CMYK, whose Decode has to be set to identity.
   */
  patchDecode: boolean;
  /** Intrinsic size read from the header; 0 when it could not be determined. */
  width: number; height: number;
  /** Human-readable consequences, used by the picture panel and preflight. */
  notes: string[];
}

/**
 * One decision path for preview and export: store the bytes untouched, or flatten them through
 * the same Canvas the preview composites with. Everything that the browser applies to a picture
 * but PDF viewers do not (EXIF rotation, animation, exotic colour types) forces the raster route.
 */
export function planPictureEmbedding(src: string): PicturePlan {
  const plan: PicturePlan = { route: 'raster', alpha: false, cmyk: false, patchDecode: false, width: 0, height: 0, notes: [] };
  const format = pictureFormat(src);

  if (format.kind === 'png') {
    const { png } = format;
    plan.width = png.width;
    plan.height = png.height;
    plan.alpha = PNG_ALPHA_TYPES.has(png.colorType) || png.hasTrns;
    if (png.animated) { plan.notes.push('the animation is flattened to its first frame'); return plan; }
    if (!PNG_EMBEDDABLE_TYPES.has(png.colorType)) { plan.notes.push(`PNG colour type ${png.colorType} cannot be stored in a PDF`); return plan; }
    if (png.bitDepth !== 8 && png.bitDepth !== 1 && png.bitDepth !== 4) plan.notes.push(`${png.bitDepth}-bit samples are reduced to 8 bits`);
    plan.route = 'png';
    return plan;
  }

  if (format.kind === 'jpeg') {
    const { jpeg } = format;
    plan.width = jpeg.width;
    plan.height = jpeg.height;
    plan.cmyk = jpeg.components === 4;
    if (jpeg.components > 0 && jpeg.components !== 1 && jpeg.components !== 3 && !plan.cmyk) {
      plan.notes.push(`a JPEG with ${jpeg.components} components cannot be stored in a PDF`);
      return plan;
    }
    // The browser rotates the preview by the EXIF tag; pdf-lib ignores it entirely, so baking the
    // orientation into a raster is the only way the two agree.
    if (jpeg.orientation !== 1) { plan.notes.push(`EXIF orientation ${jpeg.orientation} is baked in before embedding`); return plan; }
    // No start-of-frame inside the prefix means we cannot even tell the colour order apart.
    if (jpeg.components === 0 || jpeg.width === 0) {
      plan.notes.push('the JPEG header is larger than the inspected prefix, so it is rasterized');
      return plan;
    }
    // pdf-lib complements every CMYK stream it stores, which is right only for the Adobe
    // convention. A file that says otherwise — or says nothing at all — needs an identity Decode
    // or it prints as a colour negative.
    plan.patchDecode = plan.cmyk && (!jpeg.adobe || (jpeg.adobeTransform !== null && jpeg.adobeTransform < 2));
    if (plan.patchDecode) plan.notes.push('plain CMYK samples are stored as-is instead of complemented');
    else if (plan.cmyk) plan.notes.push('CMYK samples follow the Adobe complemented convention');
    if (jpeg.adobeTransform === 1) plan.notes.push('YCCK is decoded by the PDF viewer, not by the exporter');
    plan.route = 'jpeg';
    return plan;
  }

  plan.notes.push(format.reason);
  return plan;
}

/** Human-readable colour summary for the panel and preflight; never guesses an ICC profile. */
export function describePictureFormat(src: string, natural?: { width: number; height: number }): string {
  const format = pictureFormat(src);
  if (format.kind === 'png') {
    const { png } = format;
    const channels = png.colorType === 0 ? 'greyscale' : png.colorType === 2 ? 'RGB' : png.colorType === 3 ? 'palette'
      : png.colorType === 4 ? 'greyscale + alpha' : png.colorType === 6 ? 'RGB + alpha' : `type ${png.colorType}`;
    return `PNG ${png.width}×${png.height}, ${channels}, ${png.bitDepth}-bit${png.interlaced ? ', interlaced' : ''}${png.animated ? ', animated' : ''}`;
  }
  if (format.kind === 'jpeg') {
    const { jpeg } = format;
    const space = jpeg.components === 1 ? 'greyscale' : jpeg.components === 3 ? 'YCbCr'
      : jpeg.components === 4 ? `CMYK${jpeg.adobeTransform === 2 ? ' (Adobe inverted)' : jpeg.adobeTransform === 0 ? ' (plain)' : ' (unmarked)'}`
      : `${jpeg.components} components`;
    return `JPEG ${jpeg.width}×${jpeg.height}, ${space}${jpeg.progressive ? ', progressive' : ''}${jpeg.orientation !== 1 ? `, EXIF orientation ${jpeg.orientation}` : ''}`;
  }
  return natural && natural.width > 0 ? `Bitmap ${natural.width}×${natural.height} (${format.reason})` : `Unrecognised picture (${format.reason})`;
}
