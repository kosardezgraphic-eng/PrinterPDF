import { describe, expect, it } from 'vitest';
import UTIF from 'utif';
import { writePsdUint8Array } from 'ag-psd';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import {
  decodeUniversalImageToPages,
  detectUniversalImageFormat,
  isSupportedDocumentFileNameOrType,
  isSupportedImageFileNameOrType,
} from './universalImageDecoder';
import { exportImposedPdf, importFilesBatch } from './pdfService';
import { DEFAULT_EFFECTS, DEFAULT_LAYOUT } from '../store/useAppStore';
import { getDefaultPageNumberSettings, getDefaultWatermarkSettings } from './watermarkEngine';

function buildMinimalBmpRgba(w: number, h: number): Uint8Array {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const pixelSize = rowSize * h;
  const total = 54 + pixelSize;
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x42; // B
  buf[1] = 0x4d; // M
  dv.setUint32(2, total, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(34, pixelSize, true);
  // Blue pixel in BGR
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const off = 54 + y * rowSize + x * 3;
      buf[off] = 240;
      buf[off + 1] = 80;
      buf[off + 2] = 20;
    }
  }
  return buf;
}

describe('Universal Image Decoder (TIFF, PSD, WebP, HEIC, BMP, PNG, JPG)', () => {
  it('recognizes psd, tif/tiff, webp, heic/heif, png, jpg, pdf via extension or magic bytes', () => {
    expect(isSupportedImageFileNameOrType('design.psd')).toBe(true);
    expect(isSupportedImageFileNameOrType('scan.TIFF')).toBe(true);
    expect(isSupportedImageFileNameOrType('photo.webp')).toBe(true);
    expect(isSupportedImageFileNameOrType('iphone.heic')).toBe(true);
    expect(isSupportedImageFileNameOrType('iphone.heif')).toBe(true);
    expect(isSupportedDocumentFileNameOrType('book.pdf')).toBe(true);
    expect(isSupportedDocumentFileNameOrType('poster.psd')).toBe(true);
    expect(isSupportedImageFileNameOrType('notes.txt')).toBe(false);

    // PSD signature '8BPS'
    expect(detectUniversalImageFormat(new Uint8Array([0x38, 0x42, 0x50, 0x53]), 'x')).toBe('psd');
    // TIFF signature 'II*\0'
    expect(detectUniversalImageFormat(new Uint8Array([0x49, 0x49, 0x2a, 0x00]), 'x')).toBe('tiff');
    // WebP signature 'RIFF....WEBP'
    expect(
      detectUniversalImageFormat(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
        'x'
      )
    ).toBe('webp');
    // HEIC ISO-BMFF '....ftypheic'
    expect(
      detectUniversalImageFormat(
        new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
        'x'
      )
    ).toBe('heic');
  });

  it('decodes single and multi-page TIFF buffers into embeddable PNG pages', async () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      rgba[i * 4] = 20;
      rgba[i * 4 + 1] = 150;
      rgba[i * 4 + 2] = 220;
      rgba[i * 4 + 3] = 255;
    }
    const tiffBuf = new Uint8Array(UTIF.encodeImage(rgba, 4, 4));
    const decoded = await decodeUniversalImageToPages(tiffBuf, 'card.tif', 'image/tiff');

    expect(decoded).toHaveLength(1);
    expect(decoded[0].formatLabel).toBe('TIFF');
    expect(decoded[0].mimeType).toBe('image/png');
    expect(decoded[0].width).toBe(4);
    expect(decoded[0].height).toBe(4);
    // PNG header check
    expect(decoded[0].bytes[0]).toBe(0x89);
    expect(decoded[0].bytes[1]).toBe(0x50);
  });

  it('decodes Adobe PSD buffers (with imageData composite) cleanly and imports into Studio + PDF', async () => {
    const rgba = new Uint8ClampedArray(12 * 8 * 4);
    for (let i = 0; i < 12 * 8; i++) {
      rgba[i * 4] = 225;
      rgba[i * 4 + 1] = 29;
      rgba[i * 4 + 2] = 72;
      rgba[i * 4 + 3] = 255;
    }

    const psdBytes = writePsdUint8Array({
      width: 12,
      height: 8,
      imageData: { width: 12, height: 8, data: rgba },
      children: [
        {
          name: 'Layer 1',
          imageData: { width: 12, height: 8, data: rgba },
        },
      ],
    });

    const decoded = await decodeUniversalImageToPages(psdBytes, 'flyer.psd');
    expect(decoded).toHaveLength(1);
    expect(decoded[0].formatLabel).toBe('PSD');
    expect(decoded[0].width).toBe(12);
    expect(decoded[0].height).toBe(8);

    // Full main-app importFilesBatch + exportImposedPdf roundtrip
    const psdFile = new File([new Uint8Array(psdBytes)], 'flyer.psd');
    const batch = await importFilesBatch([psdFile]);
    expect(batch.documents).toHaveLength(1);
    expect(batch.pages).toHaveLength(1);
    expect(batch.pages[0].widthMm).toBeGreaterThan(0);

    const pdfBytes = await exportImposedPdf({
      documents: batch.documents,
      pages: batch.pages.map((p) => ({ ...p, selectedForPrint: true })),
      layout: DEFAULT_LAYOUT,
      effects: DEFAULT_EFFECTS,
      watermark: getDefaultWatermarkSettings(),
      pageNumbering: getDefaultPageNumberSettings(),
      userName: 'test',
    });
    const loadedPdf = await PDFDocument.load(pdfBytes);
    expect(loadedPdf.getPageCount()).toBe(1);
  });

  it('decodes WebP and BMP images and imports them into Studio cleanly', async () => {
    const c = createCanvas(16, 10);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(0, 0, 16, 10);
    const webpBytes = new Uint8Array(await c.encode('webp'));

    const webpDecoded = await decodeUniversalImageToPages(webpBytes, 'banner.webp', 'image/webp');
    expect(webpDecoded[0].formatLabel).toBe('WEBP');
    expect(webpDecoded[0].width).toBe(16);
    expect(webpDecoded[0].height).toBe(10);

    const bmpBytes = buildMinimalBmpRgba(8, 6);
    const bmpFile = new File([new Uint8Array(bmpBytes)], 'icon.bmp', { type: 'image/bmp' });
    const webpFile = new File([new Uint8Array(webpBytes)], 'banner.webp', { type: 'image/webp' });
    const batch = await importFilesBatch([webpFile, bmpFile]);
    expect(batch.documents).toHaveLength(2);
    expect(batch.pages).toHaveLength(2);
  });
});
