/**
 * PrintStudio Pro — Universal Image Decoder (TIFF, PSD, WebP, HEIC/HEIF, PNG, JPEG, BMP, GIF, SVG)
 *
 * Decodes raster & layered design formats cleanly in both browser/Electron renderer and Node tests,
 * returning PDF-embeddable PNG/JPEG bytes, intrinsic dimensions, color space hints, and DPI.
 */

import { inspectJpeg, inspectPng } from './imageFormat';

export const ACCEPTED_IMAGE_EXTENSIONS_REGEX = /\.(jpe?g|png|webp|bmp|gif|tiff?|psd|heic|heif|svg)$/i;
export const ACCEPTED_DOCUMENT_EXTENSIONS_REGEX = /\.(pdf|jpe?g|png|webp|bmp|gif|tiff?|psd|heic|heif|svg)$/i;
export const ACCEPTED_IMAGE_INPUT_ACCEPT = 'image/*,.tif,.tiff,.psd,.webp,.heic,.heif,.bmp,.svg';
export const ACCEPTED_DOCUMENT_INPUT_ACCEPT = '.pdf,image/*,.tif,.tiff,.psd,.webp,.heic,.heif,.bmp,.svg';

export type UniversalImageFormat =
  | 'png'
  | 'jpeg'
  | 'tiff'
  | 'psd'
  | 'webp'
  | 'heic'
  | 'bmp'
  | 'gif'
  | 'svg'
  | 'unknown';

export interface DecodedRasterPage {
  pageNumber: number;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
  dpiX?: number;
  dpiY?: number;
  colorSpace: 'RGB' | 'CMYK' | 'Grayscale';
  formatLabel: string;
}

export function isSupportedImageFileNameOrType(name: string, mimeType = ''): boolean {
  const lowerType = (mimeType || '').toLowerCase();
  if (lowerType.startsWith('image/')) return true;
  if (lowerType === 'application/x-photoshop' || lowerType === 'application/photoshop') return true;
  return ACCEPTED_IMAGE_EXTENSIONS_REGEX.test(name || '');
}

export function isSupportedDocumentFileNameOrType(name: string, mimeType = ''): boolean {
  const lowerType = (mimeType || '').toLowerCase();
  if (lowerType === 'application/pdf' || /\.pdf$/i.test(name || '')) return true;
  return isSupportedImageFileNameOrType(name, mimeType);
}

export function detectUniversalImageFormat(
  bytes: Uint8Array,
  fileName = '',
  mimeType = ''
): UniversalImageFormat {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a) ||
      (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2b && bytes[3] === 0x00))
  ) {
    return 'tiff';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x38 &&
    bytes[1] === 0x42 &&
    bytes[2] === 0x50 &&
    bytes[3] === 0x53
  ) {
    return 'psd';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heis', 'heim'].includes(brand)) {
      return 'heic';
    }
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'bmp';
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'gif';
  }

  const lowerName = (fileName || '').toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();
  if (lowerName.endsWith('.psd') || lowerMime.includes('photoshop') || lowerMime === 'image/vnd.adobe.photoshop') {
    return 'psd';
  }
  if (lowerName.endsWith('.tif') || lowerName.endsWith('.tiff') || lowerMime === 'image/tiff') {
    return 'tiff';
  }
  if (lowerName.endsWith('.heic') || lowerName.endsWith('.heif') || lowerMime === 'image/heic' || lowerMime === 'image/heif') {
    return 'heic';
  }
  if (lowerName.endsWith('.webp') || lowerMime === 'image/webp') return 'webp';
  if (lowerName.endsWith('.png') || lowerMime === 'image/png') return 'png';
  if (/\.(jpe?g)$/i.test(lowerName) || lowerMime === 'image/jpeg' || lowerMime === 'image/jpg') return 'jpeg';
  if (lowerName.endsWith('.bmp') || lowerMime === 'image/bmp') return 'bmp';
  if (lowerName.endsWith('.gif') || lowerMime === 'image/gif') return 'gif';
  if (lowerName.endsWith('.svg') || lowerMime === 'image/svg+xml') return 'svg';

  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 256)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return 'svg';
  }
  return 'unknown';
}

/* ============================================================================
 * Pure-JS Lossless PNG Encoder (works in Browser, Web Worker & Node fallback)
 * ========================================================================== */

const PNG_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function pngCrc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = PNG_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let s1 = 1;
  let s2 = 0;
  const MOD = 65521;
  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]) % MOD;
    s2 = (s2 + s1) % MOD;
  }
  return ((s2 << 16) | s1) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crc = pngCrc32(out.subarray(4, 8 + data.length));
  dv.setUint32(8 + data.length, crc, false);
  return out;
}

function deflateStoredZlib(raw: Uint8Array): Uint8Array {
  const maxBlock = 65535;
  const blocks = Math.max(1, Math.ceil(raw.length / maxBlock));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let pos = 2;
  let offset = 0;
  for (let b = 0; b < blocks; b++) {
    const len = Math.min(maxBlock, raw.length - offset);
    const isFinal = b === blocks - 1 ? 1 : 0;
    out[pos++] = isFinal;
    out[pos++] = len & 0xff;
    out[pos++] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    out[pos++] = nlen & 0xff;
    out[pos++] = (nlen >>> 8) & 0xff;
    if (len > 0) {
      out.set(raw.subarray(offset, offset + len), pos);
      pos += len;
      offset += len;
    }
  }
  const adl = adler32(raw);
  const dv = new DataView(out.buffer);
  dv.setUint32(pos, adl, false);
  return out;
}

export async function encodeRgbaToPngBytesUniversal(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): Promise<Uint8Array> {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  // Prefer fast native Canvas PNG compression in browser/OffscreenCanvas
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const img = ctx.createImageData(w, h);
        img.data.set(rgba.subarray(0, w * h * 4));
        ctx.putImageData(img, 0, 0);
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
        if (blob) return new Uint8Array(await blob.arrayBuffer());
      }
    } catch {
      // Fall through to pure-JS PNG encoder
    }
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const img = ctx.createImageData(w, h);
        img.data.set(rgba.subarray(0, w * h * 4));
        ctx.putImageData(img, 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        return new Uint8Array(await blob.arrayBuffer());
      }
    } catch {
      // Fall through to pure-JS PNG encoder
    }
  }

  // Pure-JS lossless RGBA PNG encoder (filter 0 per scanline)
  const stride = w * 4 + 1;
  const rawScanlines = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const rowOut = y * stride;
    rawScanlines[rowOut] = 0; // Filter type None
    rawScanlines.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), rowOut + 1);
  }

  let zlibStream: Uint8Array;
  try {
    const pakoMod = await import('pako');
    const pako = (pakoMod as unknown as { default?: typeof pakoMod }).default ?? pakoMod;
    zlibStream = pako.deflate(rawScanlines, { level: 6 });
  } catch {
    zlibStream = deflateStoredZlib(rawScanlines);
  }

  const ihdr = new Uint8Array(13);
  const idv = new DataView(ihdr.buffer);
  idv.setUint32(0, w, false);
  idv.setUint32(4, h, false);
  ihdr[8] = 8; // Bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', zlibStream);
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let ptr = 0;
  out.set(sig, ptr);
  ptr += sig.length;
  out.set(ihdrChunk, ptr);
  ptr += ihdrChunk.length;
  out.set(idatChunk, ptr);
  ptr += idatChunk.length;
  out.set(iendChunk, ptr);
  return out;
}

function parsePngPhysDpi(bytes: Uint8Array): { dpiX?: number; dpiY?: number } {
  if (bytes.length < 33) return {};
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  while (off + 12 <= bytes.length) {
    const len = dv.getUint32(off, false);
    if (off + 12 + len > bytes.length) break;
    const tag = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    if (tag === 'pHYs' && len >= 9) {
      const ppuX = dv.getUint32(off + 8, false);
      const ppuY = dv.getUint32(off + 12, false);
      const unit = bytes[off + 16];
      if (unit === 1 && ppuX > 0 && ppuY > 0) {
        return {
          dpiX: Math.round(ppuX * 0.0254),
          dpiY: Math.round(ppuY * 0.0254),
        };
      }
    }
    if (tag === 'IDAT' || tag === 'IEND') break;
    off += 12 + len;
  }
  return {};
}

async function decodeBrowserCanvasImage(
  bytes: Uint8Array,
  mimeType: string
): Promise<{ width: number; height: number; pngBytes: Uint8Array }> {
  const safe = new Uint8Array(bytes);
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(new Blob([safe], { type: mimeType }));
    try {
      const w = Math.max(1, bitmap.width);
      const h = Math.max(1, bitmap.height);
      if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, w, h);
          const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
          if (blob) return { width: w, height: h, pngBytes: new Uint8Array(await blob.arrayBuffer()) };
        }
      }
      if (typeof OffscreenCanvas !== 'undefined') {
        const c = new OffscreenCanvas(w, h);
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, w, h);
          const blob = await c.convertToBlob({ type: 'image/png' });
          return { width: w, height: h, pngBytes: new Uint8Array(await blob.arrayBuffer()) };
        }
      }
    } finally {
      bitmap.close?.();
    }
  }

  if (typeof Image !== 'undefined' && typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const probeCanvas = document.createElement('canvas');
    if (probeCanvas.getContext?.('2d')) {
      const url = URL.createObjectURL(new Blob([safe], { type: mimeType }));
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error(`Browser could not decode ${mimeType}`));
          el.src = url;
        });
        const w = Math.max(1, img.naturalWidth || img.width || 800);
        const h = Math.max(1, img.naturalHeight || img.height || 600);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
          if (blob) return { width: w, height: h, pngBytes: new Uint8Array(await blob.arrayBuffer()) };
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  // Headless Node fallback via @napi-rs/canvas when running in Vitest
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const napiPkg = ['@napi-rs', 'canvas'].join('/');
      const mod = (await import(/* @vite-ignore */ napiPkg)) as {
        loadImage: (src: Uint8Array | Buffer) => Promise<{ width: number; height: number }>;
        createCanvas: (w: number, h: number) => {
          getContext: (t: '2d') => { drawImage: (img: unknown, x: number, y: number, w: number, h: number) => void };
          encode: (fmt: 'png') => Promise<Buffer | Uint8Array>;
        };
      };
      const img = await mod.loadImage(Buffer.from(safe));
      const w = Math.max(1, img.width);
      const h = Math.max(1, img.height);
      const c = mod.createCanvas(w, h);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const pngBuf = await c.encode('png');
      return { width: w, height: h, pngBytes: new Uint8Array(pngBuf) };
    } catch {
      // fall through
    }
  }

  throw new Error(`Unable to decode ${mimeType} image in this runtime`);
}

function readTiffRationalDpi(tagVal: unknown, unitVal: unknown): number | undefined {
  if (!Array.isArray(tagVal) || tagVal.length === 0) return undefined;
  let dpi = Number(tagVal[0]);
  if (tagVal.length >= 2 && Number(tagVal[1]) > 0) {
    dpi = Number(tagVal[0]) / Number(tagVal[1]);
  }
  if (!Number.isFinite(dpi) || dpi <= 0) return undefined;
  const unit = Array.isArray(unitVal) ? Number(unitVal[0]) : Number(unitVal);
  if (unit === 3) dpi = dpi * 2.54; // cm -> inch
  return dpi >= 10 && dpi <= 4800 ? Math.round(dpi) : undefined;
}

/**
 * Decodes PDF-ready raster pages from PNG, JPEG, TIFF, PSD, HEIC/HEIF, WebP, BMP, GIF, or SVG.
 */
export async function decodeUniversalImageToPages(
  bytes: Uint8Array,
  fileName: string,
  mimeType = ''
): Promise<DecodedRasterPage[]> {
  const format = detectUniversalImageFormat(bytes, fileName, mimeType);

  if (format === 'png') {
    const info = inspectPng(bytes);
    if (info && !info.animated && [0, 2, 3, 4, 6].includes(info.colorType)) {
      const phys = parsePngPhysDpi(bytes);
      return [
        {
          pageNumber: 1,
          width: info.width,
          height: info.height,
          mimeType: 'image/png',
          bytes,
          dpiX: phys.dpiX,
          dpiY: phys.dpiY,
          colorSpace: info.colorType === 0 || info.colorType === 4 ? 'Grayscale' : 'RGB',
          formatLabel: 'PNG',
        },
      ];
    }
    const decoded = await decodeBrowserCanvasImage(bytes, 'image/png');
    return [
      {
        pageNumber: 1,
        width: decoded.width,
        height: decoded.height,
        mimeType: 'image/png',
        bytes: decoded.pngBytes,
        colorSpace: 'RGB',
        formatLabel: 'PNG',
      },
    ];
  }

  if (format === 'jpeg') {
    const info = inspectJpeg(bytes);
    if (info && info.width > 0 && info.height > 0 && info.orientation === 1 && [1, 3, 4].includes(info.components)) {
      return [
        {
          pageNumber: 1,
          width: info.width,
          height: info.height,
          mimeType: 'image/jpeg',
          bytes,
          colorSpace: info.components === 4 ? 'CMYK' : info.components === 1 ? 'Grayscale' : 'RGB',
          formatLabel: 'JPEG',
        },
      ];
    }
    const decoded = await decodeBrowserCanvasImage(bytes, 'image/jpeg');
    return [
      {
        pageNumber: 1,
        width: decoded.width,
        height: decoded.height,
        mimeType: 'image/png',
        bytes: decoded.pngBytes,
        colorSpace: 'RGB',
        formatLabel: 'JPEG',
      },
    ];
  }

  if (format === 'tiff') {
    const utifMod = await import('utif');
    const UTIF = (utifMod as unknown as { default?: typeof utifMod }).default ?? utifMod;
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const ifds = UTIF.decode(ab);
    if (!ifds || ifds.length === 0) {
      throw new Error('فایل TIFF معتبر نیست یا فاقد صفحه تصویر است');
    }
    const pages: DecodedRasterPage[] = [];
    for (let i = 0; i < ifds.length; i++) {
      const ifd = ifds[i];
      UTIF.decodeImage(ab, ifd);
      const rgba = UTIF.toRGBA8(ifd);
      const w = Math.max(1, ifd.width || 1);
      const h = Math.max(1, ifd.height || 1);
      const pngBytes = await encodeRgbaToPngBytesUniversal(rgba, w, h);
      const photo = Array.isArray(ifd.t262) ? Number(ifd.t262[0]) : undefined;
      const colorSpace: DecodedRasterPage['colorSpace'] =
        photo === 5 ? 'CMYK' : photo === 0 || photo === 1 ? 'Grayscale' : 'RGB';
      const dpiX = readTiffRationalDpi(ifd.t282, ifd.t296);
      const dpiY = readTiffRationalDpi(ifd.t283, ifd.t296) ?? dpiX;
      pages.push({
        pageNumber: i + 1,
        width: w,
        height: h,
        mimeType: 'image/png',
        bytes: pngBytes,
        dpiX,
        dpiY,
        colorSpace,
        formatLabel: 'TIFF',
      });
    }
    return pages;
  }

  if (format === 'psd') {
    const { readPsd, initializeCanvas } = await import('ag-psd');
    if (typeof document === 'undefined' && typeof initializeCanvas === 'function') {
      initializeCanvas(
        (cw: number, ch: number) =>
          ({
            width: cw,
            height: ch,
            getContext: () => ({
              createImageData: (iw: number, ih: number) => ({
                width: iw,
                height: ih,
                data: new Uint8ClampedArray(iw * ih * 4),
              }),
            }),
          }) as unknown as HTMLCanvasElement,
        (iw: number, ih: number) =>
          ({
            width: iw,
            height: ih,
            data: new Uint8ClampedArray(iw * ih * 4),
          }) as unknown as ImageData
      );
    }
    let psd = readPsd(bytes, {
      useImageData: true,
      skipLayerImageData: true,
      skipThumbnail: true,
    });
    if (!psd.imageData && !psd.canvas) {
      psd = readPsd(bytes, { useImageData: true });
    }

    let rgba: Uint8ClampedArray | Uint8Array | null = null;
    let w = Math.max(1, psd.width || 1);
    let h = Math.max(1, psd.height || 1);

    if (psd.imageData && psd.imageData.data?.length) {
      w = psd.imageData.width;
      h = psd.imageData.height;
      const rawData = psd.imageData.data;
      if (rawData instanceof Uint8ClampedArray || rawData instanceof Uint8Array) {
        rgba = rawData;
      } else if (rawData instanceof Uint16Array) {
        const out = new Uint8ClampedArray(rawData.length);
        for (let i = 0; i < rawData.length; i++) out[i] = rawData[i] >>> 8;
        rgba = out;
      } else {
        const out = new Uint8ClampedArray(rawData.length);
        for (let i = 0; i < rawData.length; i++) {
          out[i] = Math.max(0, Math.min(255, Math.round(rawData[i] * 255)));
        }
        rgba = out;
      }
    } else if (psd.canvas) {
      const ctx = psd.canvas.getContext('2d');
      if (ctx) {
        w = psd.canvas.width;
        h = psd.canvas.height;
        rgba = ctx.getImageData(0, 0, w, h).data;
      }
    }

    if (!rgba) {
      throw new Error('فایل PSD فاقد تصویر ترکیبی (Composite) قابل خواندن است؛ در فتوشاپ با گزینه Maximize Compatibility ذخیره کنید.');
    }

    const pngBytes = await encodeRgbaToPngBytesUniversal(rgba, w, h);
    const resInfo = psd.imageResources?.resolutionInfo;
    const dpiX =
      resInfo?.horizontalResolution && Number.isFinite(resInfo.horizontalResolution)
        ? Math.round(resInfo.horizontalResolution)
        : undefined;
    const dpiY =
      resInfo?.verticalResolution && Number.isFinite(resInfo.verticalResolution)
        ? Math.round(resInfo.verticalResolution)
        : dpiX;
    const colorSpace: DecodedRasterPage['colorSpace'] =
      psd.colorMode === 4 ? 'CMYK' : psd.colorMode === 1 ? 'Grayscale' : 'RGB';

    return [
      {
        pageNumber: 1,
        width: w,
        height: h,
        mimeType: 'image/png',
        bytes: pngBytes,
        dpiX,
        dpiY,
        colorSpace,
        formatLabel: 'PSD',
      },
    ];
  }

  if (format === 'heic') {
    const heicMod = await import('heic-decode');
    type HeicDecodedImg = { data: Uint8Array | Uint8ClampedArray; width: number; height: number };
    type HeicSingleFn = (opts: { buffer: Uint8Array }) => Promise<HeicDecodedImg>;
    type HeicAllFn = (opts: { buffer: Uint8Array }) => Promise<
      Array<{ decode(): Promise<HeicDecodedImg> }> & { dispose?: () => void }
    >;
    const heicAny = heicMod as unknown as {
      default?: (HeicSingleFn & { all?: HeicAllFn }) | { default?: HeicSingleFn; all?: HeicAllFn };
      all?: HeicAllFn;
    };
    const decodeAll = heicAny.all ?? heicAny.default?.all;
    const rawDefault = heicAny.default;
    const decodeSingle: HeicSingleFn | undefined =
      typeof rawDefault === 'function'
        ? rawDefault
        : rawDefault && typeof rawDefault.default === 'function'
          ? rawDefault.default
          : undefined;

    if (typeof decodeAll === 'function') {
      const imgs = await decodeAll({ buffer: bytes });
      try {
        if (imgs.length > 0) {
          const pages: DecodedRasterPage[] = [];
          for (let i = 0; i < imgs.length; i++) {
            const decoded = await imgs[i].decode();
            const pngBytes = await encodeRgbaToPngBytesUniversal(
              decoded.data,
              decoded.width,
              decoded.height
            );
            pages.push({
              pageNumber: i + 1,
              width: decoded.width,
              height: decoded.height,
              mimeType: 'image/png',
              bytes: pngBytes,
              colorSpace: 'RGB',
              formatLabel: 'HEIC',
            });
          }
          return pages;
        }
      } finally {
        imgs.dispose?.();
      }
    }
    if (!decodeSingle) {
      throw new Error('مبدل HEIC در دسترس نیست.');
    }
    const single = await decodeSingle({ buffer: bytes });
    const pngBytes = await encodeRgbaToPngBytesUniversal(single.data, single.width, single.height);
    return [
      {
        pageNumber: 1,
        width: single.width,
        height: single.height,
        mimeType: 'image/png',
        bytes: pngBytes,
        colorSpace: 'RGB',
        formatLabel: 'HEIC',
      },
    ];
  }

  const mimeMap: Record<UniversalImageFormat, string> = {
    webp: 'image/webp',
    bmp: 'image/bmp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpeg: 'image/jpeg',
    tiff: 'image/tiff',
    psd: 'image/vnd.adobe.photoshop',
    heic: 'image/heic',
    unknown: mimeType || 'image/png',
  };
  if (format === 'unknown' && !isSupportedImageFileNameOrType(fileName, mimeType)) {
    throw new Error(`فرمت تصویر «${fileName}» پشتیبانی نمی‌شود`);
  }
  const decoded = await decodeBrowserCanvasImage(bytes, mimeMap[format]);
  return [
    {
      pageNumber: 1,
      width: decoded.width,
      height: decoded.height,
      mimeType: 'image/png',
      bytes: decoded.pngBytes,
      colorSpace: 'RGB',
      formatLabel: format === 'unknown' ? 'IMAGE' : format.toUpperCase(),
    },
  ];
}

export function decodedPageToDataUrl(page: Pick<DecodedRasterPage, 'bytes' | 'mimeType'>): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < page.bytes.length; i += CHUNK) {
    const sub = page.bytes.subarray(i, Math.min(page.bytes.length, i + CHUNK));
    binary += String.fromCharCode(...sub);
  }
  const b64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(page.bytes).toString('base64');
  return `data:${page.mimeType};base64,${b64}`;
}
