import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { analyzeRgbaPixels, renderAndAnalyzePdfPages } from './pdfRealRenderer';
import { createSamplePrintShopWorkspace, importFilesBatch } from './pdfService';

// Exercise actual PDF.js rendering against a native canvas in Node, not fabricated SVG.
class TestOffscreenCanvas {
  private canvas;
  constructor(width: number, height: number) { this.canvas = createCanvas(width, height); }
  get width() { return this.canvas.width; }
  set width(value: number) { this.canvas.width = value; }
  get height() { return this.canvas.height; }
  set height(value: number) { this.canvas.height = value; }
  getContext() { return this.canvas.getContext('2d'); }
  async convertToBlob() { return new Blob([new Uint8Array(await this.canvas.encode('png'))], { type: 'image/png' }); }
}
const originalCanvas = globalThis.OffscreenCanvas;
const originalPath = globalThis.Path2D;
afterEach(() => vi.unstubAllGlobals());
afterAll(() => { globalThis.OffscreenCanvas = originalCanvas; globalThis.Path2D = originalPath; });

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
  it('renders text in addition to extracting it', async () => {
    globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([200, 200]).drawText('Document text', { x: 20, y: 120, size: 24, font });
    const pages = await renderAndAnalyzePdfPages(await doc.save(), 'text.pdf');
    expect(pages[0].extractedTextLines.join(' ')).toContain('Document text');
    expect(pages[0].inkCoveragePercent).toBeGreaterThan(0);
  });
  it('generates sample PDFs with thumbnails rendered from their real pages', async () => {
    globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;
    vi.stubGlobal('Worker', class {
      onmessage: (event: unknown) => void = () => {};
      terminate() {}
      async postMessage(payload: { id: string; pdfBytes: Uint8Array; fileName: string }) {
        try {
          const pages = await renderAndAnalyzePdfPages(payload.pdfBytes, payload.fileName);
          this.onmessage({ data: { id: payload.id, type: 'analyze-pdf-result', pages } });
        } catch (error) {
          this.onmessage({ data: { id: payload.id, type: 'analyze-pdf-error', errorMessage: String(error) } });
        }
      }
    });
    const sample = await createSamplePrintShopWorkspace();
    expect(sample.pages).toHaveLength(18);
    expect(sample.pages.every(p => p.thumbnailDataUrl?.startsWith('data:image/png;base64,'))).toBe(true);
    expect(sample.pages[0].previewLines?.join(' ')).toContain('PrintStudio Pro Vector Document');
    expect(sample.pages[0].inkCoveragePercent).toBeGreaterThan(0);
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
