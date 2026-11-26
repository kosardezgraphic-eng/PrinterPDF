import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage, Path2D } from '@napi-rs/canvas';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfVectorPreviewer, analyzeRgbaPixels, renderAndAnalyzePdfPages } from './pdfRealRenderer';
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

/** The darkest pixel in a decoded PNG: how much real ink survived the rendering. */
async function darkestPixel(png: Uint8Array): Promise<{ darkest: number; width: number; height: number }> {
  const image = await loadImage(png as unknown as Buffer);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  let darkest = 255;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    darkest = Math.min(darkest, alpha < 1 ? 255 * (1 - alpha) + luminance * alpha : luminance);
  }
  return { darkest, width: image.width, height: image.height };
}

describe('crisp vector preview rendering', () => {
  it('re-runs the page drawing instructions at the requested size instead of stretching the thumbnail', async () => {
    (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    globalThis.OffscreenCanvas = TestOffscreenCanvas as unknown as typeof OffscreenCanvas;
    // A 0.2 pt rule across an A4-tall page: the classic thing a small bitmap cannot keep.
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 400]);
    page.drawRectangle({ x: 0, y: 199.9, width: 200, height: 0.2, color: rgb(0, 0, 0) });
    const bytes = await doc.save();

    const previewer = new PdfVectorPreviewer(1);
    try {
      expect(await previewer.open('vector', bytes)).toBe(1);
      const crisp = await previewer.render({ docId: 'vector', pageNumber: 1, width: 800, height: 1600, taskId: 'crisp' });
      expect(crisp?.png, 'a crisp frame must come back as pixels').toBeTruthy();
      const crispPixels = await darkestPixel(crisp!.png!);
      expect(crispPixels.width).toBe(800);           // the size the cell asked for, not 320
      expect(crispPixels.height).toBe(1600);

      const [thumbnail] = await renderAndAnalyzePdfPages(bytes, 'vector.pdf');
      const thumbPixels = await darkestPixel(new Uint8Array(Buffer.from(thumbnail.thumbnailDataUrl.split(',')[1], 'base64')));
      expect(thumbPixels.width).toBeLessThan(crispPixels.width);
      // The whole point: the hairline is still a hairline with ink in it, not a grey smear. The
      // threshold is a ratio, not a magic number — the crisp pass has to put at least twice as much ink
      // into the darkest pixel of the rule as the stretched thumbnail does.
      expect(thumbPixels.darkest - crispPixels.darkest).toBeGreaterThan(60);
      expect(255 - crispPixels.darkest).toBeGreaterThan((255 - thumbPixels.darkest) * 2);
    } finally {
      previewer.closeAll();
    }
  });

  it('holds only the documents the operator is looking at and forgets the oldest', async () => {
    (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    globalThis.OffscreenCanvas = TestOffscreenCanvas as unknown as typeof OffscreenCanvas;
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const bytes = await doc.save();
    const previewer = new PdfVectorPreviewer(2);
    try {
      await previewer.open('first', bytes);
      await previewer.open('second', bytes);
      expect(previewer.openDocuments).toEqual(['first', 'second']);
      await previewer.open('third', bytes);
      // Two is the ceiling; the file that has not been looked at for longest is the one that goes.
      expect(previewer.openDocuments).toEqual(['second', 'third']);
      await expect(previewer.render({ docId: 'first', pageNumber: 1, width: 96, height: 96, taskId: 'gone' }))
        .rejects.toThrow(/No preview document is open for first/);
      // Re-opening is a parse, not a re-import: the page is available again immediately.
      expect(await previewer.open('first', bytes)).toBe(1);
      expect(await previewer.render({ docId: 'first', pageNumber: 1, width: 96, height: 96, taskId: 'back' })).toBeTruthy();
      // An unknown cancel is not an error: the result would have been dropped anyway.
      expect(() => previewer.cancel('never-asked-for')).not.toThrow();
    } finally {
      previewer.closeAll();
      expect(previewer.openDocuments).toEqual([]);
    }
  });
});
