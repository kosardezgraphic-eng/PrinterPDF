/** PDF page rasterization and sampled color analysis, executed in a dedicated worker. */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface RealPdfPageAnalysis {
  pageNumber: number;
  widthMm: number;
  heightMm: number;
  rotation: 0 | 90 | 180 | 270;
  colorProfile: 'color' | 'grayscale' | 'blank';
  inkCoveragePercent: number;
  extractedTextLines: string[];
  thumbnailDataUrl: string;
}

/** Estimate ink coverage and color at thumbnail resolution (not a separations measurement). */
export function analyzeRgbaPixels(rgba: Uint8ClampedArray): {
  colorProfile: 'color' | 'grayscale' | 'blank'; inkCoveragePercent: number;
} {
  const total = Math.floor(rgba.length / 4);
  let nonWhite = 0, colored = 0, ink = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    const r = rgba[i] * a + 255 * (1 - a);
    const g = rgba[i + 1] * a + 255 * (1 - a);
    const b = rgba[i + 2] * a + 255 * (1 - a);
    const darkness = (255 - (0.2126 * r + 0.7152 * g + 0.0722 * b)) / 255;
    ink += darkness;
    if (darkness > 0.04) {
      nonWhite++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 14) colored++;
    }
  }
  const coverage = total ? Math.round(ink / total * 10000) / 100 : 0;
  return {
    colorProfile: nonWhite === 0 ? 'blank' : colored > 0 ? 'color' : 'grayscale',
    inkCoveragePercent: coverage,
  };
}

// Bundle PDF.js' standard fonts with the worker so it does not rely on network access.
const standardFonts = import.meta.glob<string>('../../../node_modules/pdfjs-dist/standard_fonts/*.{ttf,pfb}', {
  eager: true, query: '?url&inline', import: 'default',
});
class BundledStandardFontFactory {
  async fetch({ filename }: { filename: string }) {
    const entry = Object.entries(standardFonts).find(([name]) => name.endsWith(`/${filename}`));
    if (!entry) throw new Error(`PDF standard font unavailable: ${filename}`);
    const response = await fetch(entry[1]);
    if (!response.ok) throw new Error(`Failed to load PDF standard font: ${filename}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

/** PDF.js also creates temporary canvases for images and masks. Workers have no document. */
class WorkerCanvasFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create a temporary PDF canvas');
    return { canvas, context };
  }
  reset(pair: { canvas: OffscreenCanvas }, width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    pair.canvas.width = width; pair.canvas.height = height;
  }
  destroy(pair: { canvas: OffscreenCanvas | null; context: OffscreenCanvasRenderingContext2D | null }) {
    if (pair.canvas) { pair.canvas.width = 0; pair.canvas.height = 0; }
    pair.canvas = null; pair.context = null;
  }
}

/**
 * Crisp, on-demand page rendering for the sheet preview.
 *
 * The bitmap built at import time is a 320×480 PNG: exactly right for a sidebar thumbnail, wrong on
 * a sheet the operator zooms into — scaling a small bitmap up turns a 0.2 pt vector line into a grey
 * smear, which is what made vector files look "rendered incorrectly". This keeps the parsed document
 * open and re-runs the page's own drawing instructions at the size the cell asks for, so a vector page
 * is displayed as vectors at that resolution. Only pages that are actually looked at are rendered, and
 * a render can be cancelled, which is what keeps the CPU and memory use bounded.
 */
type PdfDocumentProxy = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
type PdfPageProxy = Awaited<ReturnType<PdfDocumentProxy['getPage']>>;
type PdfRenderTask = ReturnType<PdfPageProxy['render']>;

export interface VectorRenderRequest {
  /** The document the bytes were opened under; previews ask per page, not per file. */
  docId: string;
  /** One-based page number inside the source PDF. */
  pageNumber: number;
  /** Box the cell will paint into, in device pixels. The page is fitted inside it. */
  width: number;
  height: number;
  /** Lets `cancel` reach exactly this render, even when the same page is requested twice. */
  taskId: string;
}

export interface VectorRenderResult {
  taskId: string;
  docId: string;
  pageNumber: number;
  width: number;
  height: number;
  /** Preferred: transferred to the caller without a copy. */
  bitmap?: ImageBitmap;
  /** Fallback for environments without `createImageBitmap` (and for tests in Node). */
  png?: Uint8Array;
}

export class PdfVectorPreviewer {
  private readonly documents = new Map<string, { pdf: PdfDocumentProxy; tasks: Map<string, PdfRenderTask> }>();
  private readonly canceled = new Set<string>();
  /**
   * How many parsed files a preview session may hold. A parsed PDF keeps its object tree alive, and a
   * desk of thirty files does not need thirty of them: pages outside this window are simply re-opened
   * (a parse, not a re-import) when they come back into view.
   */
  private readonly maxOpenDocuments: number;

  constructor(maxOpenDocuments = 4) {
    this.maxOpenDocuments = Math.max(1, Math.floor(maxOpenDocuments));
  }

  /** Opens (or reuses) a document. The bytes are cloned by `postMessage`, never moved. */
  async open(docId: string, bytes: Uint8Array): Promise<number> {
    const existing = this.documents.get(docId);
    if (existing) {
      // Touch: re-opened documents go to the back of the eviction order.
      this.documents.delete(docId);
      this.documents.set(docId, existing);
      return existing.pdf.numPages;
    }
    // The copy is not waste: PDF.js *transfers* the buffer it is handed, which would detach the
    // ArrayBuffer the store and the import pipeline still depend on. One copy per open document (at
    // most a handful, and re-opened on demand) is the price of leaving the caller's bytes intact.
    const task = pdfjsLib.getDocument({
      data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false, disableFontFace: true,
      CanvasFactory: WorkerCanvasFactory, StandardFontDataFactory: BundledStandardFontFactory,
    });
    let pdf: PdfDocumentProxy;
    try {
      pdf = await task.promise;
    } catch (error) {
      await task.destroy();
      throw error;
    }
    this.documents.set(docId, { pdf, tasks: new Map() });
    while (this.documents.size > this.maxOpenDocuments) {
      const oldestId = this.documents.keys().next().value as string | undefined;
      if (oldestId === undefined) break;
      this.close(oldestId);
    }
    return pdf.numPages;
  }

  /** The parsed documents, oldest first — what the eviction order looks like right now. */
  get openDocuments(): string[] {
    return [...this.documents.keys()];
  }

  isOpen(docId: string): boolean {
    return this.documents.has(docId);
  }

  /** Returns null when the caller cancelled while the page was being painted. */
  async render(request: VectorRenderRequest): Promise<VectorRenderResult | null> {
    const { docId, pageNumber, width, height, taskId } = request;
    const entry = this.documents.get(docId);
    if (!entry) throw new Error(`No preview document is open for ${docId}`);
    if (typeof OffscreenCanvas === 'undefined') throw new Error('OffscreenCanvas is required for crisp PDF preview rendering');
    const page = await entry.pdf.getPage(pageNumber);
    try {
      const base = page.getViewport({ scale: 1, rotation: 0 });
      const scale = Math.min(width / base.width, height / base.height);
      if (!(scale > 0) || !Number.isFinite(scale)) throw new Error('A crisp preview needs a page with positive dimensions');
      const viewport = page.getViewport({ scale, rotation: 0 });
      const canvasWidth = Math.max(1, Math.floor(viewport.width));
      const canvasHeight = Math.max(1, Math.floor(viewport.height));
      const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create a 2D canvas for the crisp preview');
      // The sheet paints on white paper, and so does the import-time thumbnail; keeping the same
      // opaque base means a page with transparency does not suddenly show the grid behind its text.
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvasWidth, canvasHeight);
      const renderTask = page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport });
      entry.tasks.set(taskId, renderTask);
      try {
        await renderTask.promise;
      } catch (error) {
        // pdf.js rejects with its own abort error; the cancellation flag says what really happened.
        if (!this.canceled.has(taskId)) throw error;
        return null;
      } finally {
        entry.tasks.delete(taskId);
        this.canceled.delete(taskId);
      }
      const shared = { taskId, docId, pageNumber, width: canvasWidth, height: canvasHeight };
      // `transferToImageBitmap` moves the pixels instead of encoding them; only where it is missing
      // (a worker without ImageBitmap support, the Node test harness) does the PNG round-trip happen.
      const transfer = (canvas as { transferToImageBitmap?: () => ImageBitmap }).transferToImageBitmap;
      if (typeof transfer === 'function') {
        return { ...shared, bitmap: transfer.call(canvas) };
      }
      if (typeof createImageBitmap === 'function') {
        return { ...shared, bitmap: await createImageBitmap(canvas) };
      }
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return { ...shared, png: new Uint8Array(await blob.arrayBuffer()) };
    } finally {
      // Frees the built-up display list; the parsed document and its fonts stay open for the next page.
      page.cleanup();
    }
  }

  /** Stops a render that is no longer looked at. Unknown ids are fine: the result would be dropped. */
  cancel(taskId: string): void {
    if (!taskId) return;
    this.canceled.add(taskId);
    for (const entry of this.documents.values()) {
      const task = entry.tasks.get(taskId);
      if (!task) continue;
      try { task.cancel(); } catch { /* a finished task has nothing to cancel */ }
      return;
    }
    // Never started (still queued): forget the flag so the id can be reused.
    queueMicrotask(() => this.canceled.delete(taskId));
  }

  close(docId: string): void {
    const entry = this.documents.get(docId);
    if (!entry) return;
    for (const task of entry.tasks.values()) { try { task.cancel(); } catch { /* already done */ } }
    entry.tasks.clear();
    this.documents.delete(docId);
    void entry.pdf.destroy().catch(() => undefined);
  }

  closeAll(): void {
    for (const docId of [...this.documents.keys()]) this.close(docId);
  }
}

export async function renderAndAnalyzePdfPages(
  pdfBytes: Uint8Array,
  _docName: string,
  onPageProgress?: (pageNumber: number, totalPages: number) => void
): Promise<RealPdfPageAnalysis[]> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is required for PDF rendering in the worker');
  }
  const task = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes), useSystemFonts: false, isEvalSupported: false, disableFontFace: true, CanvasFactory: WorkerCanvasFactory, StandardFontDataFactory: BundledStandardFontFactory });
  try {
    const pdf = await task.promise;
    const results: RealPdfPageAnalysis[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      try {
        const viewport = page.getViewport({ scale: 1, rotation: 0 });
        // Limit both dimensions to avoid allocating enormous canvases for extreme aspect ratios.
        const scale = Math.min(320 / viewport.width, 480 / viewport.height);
        const renderViewport = page.getViewport({ scale, rotation: 0 });
        const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(renderViewport.width)), Math.max(1, Math.ceil(renderViewport.height)));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not create a 2D canvas for PDF rendering');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context as unknown as CanvasRenderingContext2D, viewport: renderViewport }).promise;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const analysis = analyzeRgbaPixels(pixels.data);
        const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
        let binary = '';
        for (let i = 0; i < png.length; i += 0x8000) binary += String.fromCharCode(...png.subarray(i, i + 0x8000));
        const text = await page.getTextContent();
        const lines = text.items.filter((item): item is typeof item & { str: string } => 'str' in item).map(item => item.str).filter(Boolean);
        const angle = ((page.rotate % 360) + 360) % 360;
        if (![0, 90, 180, 270].includes(angle)) throw new Error(`Unsupported PDF page rotation: ${angle}`);
        results.push({
          pageNumber: number,
          widthMm: viewport.width * 25.4 / 72,
          heightMm: viewport.height * 25.4 / 72,
          rotation: angle as 0 | 90 | 180 | 270,
          ...analysis,
          extractedTextLines: lines,
          thumbnailDataUrl: `data:image/png;base64,${btoa(binary)}`,
        });
        onPageProgress?.(number, pdf.numPages);
      } finally { page.cleanup(); }
    }
    return results;
  } finally { await task.destroy(); }
}


/** The worker's one preview session: shared by every page the operator scrolls past. */
export const vectorPreviewer = new PdfVectorPreviewer();
