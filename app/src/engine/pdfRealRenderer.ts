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
