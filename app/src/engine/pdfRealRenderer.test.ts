import { afterAll, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, rgb } from 'pdf-lib';
import { analyzeRgbaPixels, renderAndAnalyzePdfPages } from './pdfRealRenderer';
import { importFilesBatch } from './pdfService';

// Exercise actual PDF.js rendering against a native canvas in Node, not fabricated SVG.
class TestOffscreenCanvas {
  private canvas;
  constructor(width: number, height: number) { this.canvas = createCanvas(width, height); }
  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }
  getContext() { return this.canvas.getContext('2d'); }
  async convertToBlob() { return new Blob([new Uint8Array(await this.canvas.encode('png'))], { type: 'image/png' }); }
}
const originalCanvas = globalThis.OffscreenCanvas;
afterAll(() => { globalThis.OffscreenCanvas = originalCanvas; });

describe('PDF raster rendering', () => {
  it('renders actual page graphics and classifies sampled pixels', async () => {
    (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    globalThis.OffscreenCanvas = TestOffscreenCanvas as unknown as typeof OffscreenCanvas;
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const gray = doc.addPage([200, 200]);
    gray.drawRectangle({ x: 10, y: 10, width: 100, height: 100, color: rgb(.2,.2,.2) });
    const color = doc.addPage([200, 200]);
    color.drawRectangle({ x: 10, y: 10, width: 100, height: 100, color: rgb(1,0,0) });
    const result = await renderAndAnalyzePdfPages(await doc.save(), 'test.pdf');
    expect(result.map(p => p.colorProfile)).toEqual(['blank', 'grayscale', 'color']);
    expect(result[2].thumbnailDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result[2].inkCoveragePercent).toBeGreaterThan(10);
  });
  it('handles transparency as white paper', () => {
    expect(analyzeRgbaPixels(new Uint8ClampedArray([0,0,0,0])).colorProfile).toBe('blank');
    expect(analyzeRgbaPixels(new Uint8ClampedArray([255,0,0,255])).colorProfile).toBe('color');
  });
  it('reports missing worker support instead of returning a fabricated PDF preview', async () => {
    const doc = await PDFDocument.create(); doc.addPage();
    const bytes = await doc.save();
    const result = await importFilesBatch([new File([new Uint8Array(bytes)], 'test.pdf', { type: 'application/pdf' })]);
    expect(result.pages).toHaveLength(0);
    expect(result.errors[0].reasonEn).toContain('Web Worker');
  });
});
