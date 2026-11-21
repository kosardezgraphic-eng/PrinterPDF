import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDict, PDFDocument, PDFName, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PageItem, SourceDocument } from '@shared/models';
import { DEFAULT_EFFECTS, DEFAULT_LAYOUT, useAppStore } from '../store/useAppStore';
import { isPageInEffectScope } from './effectsPipeline';
import { exportImposedPdf } from './pdfService';
import { getDefaultPageNumberSettings, getDefaultWatermarkSettings } from './watermarkEngine';

const ptToMm = 25.4 / 72;
const baseLayout = {
  ...DEFAULT_LAYOUT,
  paperSize: 'Custom' as const,
  orientation: 'landscape' as const,
  customWidthMm: 200 * ptToMm,
  customHeightMm: 100 * ptToMm,
  rows: 1,
  cols: 2,
  duplexMode: 'none' as const,
  sheetOrder: 'ltr' as const,
  marginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
  horizontalGutterMm: 0,
  verticalGutterMm: 0,
  autoRotateToFit: false,
  showCellBorders: false,
};

const makePage = (id: string, docId: string, sourcePageNumber: number, isHighlighted = false): PageItem => ({
  id,
  documentId: docId,
  documentName: 'test-doc',
  sourcePageNumber,
  widthMm: 100 * ptToMm,
  heightMm: 100 * ptToMm,
  rotation: 0,
  selectedForPrint: true,
  isHighlighted,
  isBlankPage: false,
  colorProfile: 'color',
  inkCoveragePercent: 20,
});

class NodeTestCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(pair: { canvas: ReturnType<typeof createCanvas> }, width: number, height: number) {
    pair.canvas.width = Math.max(1, Math.ceil(width));
    pair.canvas.height = Math.max(1, Math.ceil(height));
  }
  destroy(pair: { canvas: unknown; context: unknown }) {
    pair.canvas = null;
    pair.context = null;
  }
}

class TestOffscreenCanvas {
  private canvas;
  constructor(width: number, height: number) {
    this.canvas = createCanvas(width, height);
  }
  get width() {
    return this.canvas.width;
  }
  set width(value: number) {
    this.canvas.width = value;
  }
  get height() {
    return this.canvas.height;
  }
  set height(value: number) {
    this.canvas.height = value;
  }
  getContext() {
    return this.canvas.getContext('2d');
  }
  async convertToBlob() {
    return new Blob([new Uint8Array(await this.canvas.encode('png'))], { type: 'image/png' });
  }
}

async function renderPdfPage(bytes: Uint8Array, pageNumber = 1) {
  (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = await import(
    'pdfjs-dist/legacy/build/pdf.worker.mjs'
  );
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    CanvasFactory: NodeTestCanvasFactory as never,
  });
  try {
    const pdf = await task.promise;
    const pdfPage = await pdf.getPage(pageNumber);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await pdfPage.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport })
      .promise;
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    await task.destroy();
  }
}

function pixel(image: { data: Uint8ClampedArray; width: number }, x: number, y: number) {
  return Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3));
}

describe('scoped effects pinning & PDF effect export', () => {
  beforeEach(() => {
    useAppStore.setState({
      effects: { ...DEFAULT_EFFECTS },
      pages: [],
      documents: [],
      layout: baseLayout,
    });
  });

  it('pins selected-page effects to the thumbnail selection and does not leak when scrolling preview pages', async () => {
    const source = await PDFDocument.create();
    // Page 1: dark blue (0, 0, 120) -> lum ~8.6 (below threshold -> black when B&W applied)
    source.addPage([100, 100]).drawRectangle({ x: 0, y: 0, width: 100, height: 100, color: rgb(0, 0, 120 / 255) });
    // Page 2: bright red (255, 0, 0)
    source.addPage([100, 100]).drawRectangle({ x: 0, y: 0, width: 100, height: 100, color: rgb(1, 0, 0) });
    const doc = { id: 'd', fileType: 'pdf', rawBytes: await source.save() } as SourceDocument;
    const p1 = makePage('p1', 'd', 1, true);
    const p2 = makePage('p2', 'd', 2, false);

    useAppStore.setState({
      documents: [doc],
      pages: [p1, p2],
      layout: baseLayout,
      effects: { ...DEFAULT_EFFECTS },
    });

    // Enable selected-page scope while p1 is selected
    useAppStore.getState().updateEffects({ scope: 'selected', blackAndWhite: true, threshold: 128 }, true);
    expect(useAppStore.getState().effects.targetPageIds).toEqual(['p1']);

    // Simulate scrolling in Continuous/Grid preview onto p2
    useAppStore.getState().focusPageFromPreview('p2');
    const stateAfterScroll = useAppStore.getState();
    expect(stateAfterScroll.pages.map((p) => p.isHighlighted)).toEqual([false, true]);
    expect(stateAfterScroll.effects.targetPageIds).toEqual(['p1']);
    expect(isPageInEffectScope(stateAfterScroll.pages[0], stateAfterScroll.effects)).toBe(true);
    expect(isPageInEffectScope(stateAfterScroll.pages[1], stateAfterScroll.effects)).toBe(false);

    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas);
    try {
      const exported = await exportImposedPdf({
        documents: [doc],
        pages: stateAfterScroll.pages,
        layout: baseLayout,
        effects: stateAfterScroll.effects,
        watermark: { ...getDefaultWatermarkSettings(), enabled: false },
        pageNumbering: { ...getDefaultPageNumberSettings(), enabled: false },
        userName: 'test',
      });
      const img = await renderPdfPage(exported, 1);
      // p1 has B&W threshold applied -> black; p2 was scrolled onto but NOT targeted -> stays red
      expect(pixel(img, 50, 50)).toEqual([0, 0, 0]);
      expect(pixel(img, 150, 50)).toEqual([255, 0, 0]);

      // Explicitly re-target effects to p2
      useAppStore.getState().updateEffects({ targetPageIds: ['p2'] }, true);
      const retargeted = await exportImposedPdf({
        documents: [doc],
        pages: useAppStore.getState().pages,
        layout: baseLayout,
        effects: useAppStore.getState().effects,
        watermark: { ...getDefaultWatermarkSettings(), enabled: false },
        pageNumbering: { ...getDefaultPageNumberSettings(), enabled: false },
        userName: 'test',
      });
      const img2 = await renderPdfPage(retargeted, 1);
      // Now p1 keeps original dark blue and p2 is B&W black
      expect(pixel(img2, 50, 50)).toEqual([0, 0, 120]);
      expect(pixel(img2, 150, 50)).toEqual([0, 0, 0]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('adds a Transparency /Group for vector PDF invert and supports raster PDF invert baking', async () => {
    const source = await PDFDocument.create();
    // Red square (255, 0, 0) -> inverted = Cyan (0, 255, 255)
    source.addPage([100, 100]).drawRectangle({ x: 0, y: 0, width: 100, height: 100, color: rgb(1, 0, 0) });
    const doc = { id: 'd', fileType: 'pdf', rawBytes: await source.save() } as SourceDocument;
    const singleLayout = { ...baseLayout, cols: 1, customWidthMm: 100 * ptToMm };
    const p1 = makePage('p1', 'd', 1, true);

    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas);
    try {
      // Vector invert path sets Transparency Group on output page
      const vectorOut = await exportImposedPdf({
        documents: [doc],
        pages: [p1],
        layout: singleLayout,
        effects: { ...DEFAULT_EFFECTS, enabled: true, invert: true, invertPdfStrategy: 'vector-blend' },
        watermark: { ...getDefaultWatermarkSettings(), enabled: false },
        pageNumbering: { ...getDefaultPageNumberSettings(), enabled: false },
        userName: 'test',
      });
      const vectorPdf = await PDFDocument.load(vectorOut);
      const groupDict = vectorPdf.getPage(0).node.lookupMaybe(PDFName.of('Group'), PDFDict);
      expect(groupDict?.get(PDFName.of('S'))?.toString()).toBe('/Transparency');
      expect(groupDict?.get(PDFName.of('CS'))?.toString()).toBe('/DeviceRGB');

      const vectorImg = await renderPdfPage(vectorOut, 1);
      expect(pixel(vectorImg, 50, 50)).toEqual([0, 255, 255]);

      // Raster invert strategy also bakes inverted pixels into exported PDF
      const rasterOut = await exportImposedPdf({
        documents: [doc],
        pages: [p1],
        layout: singleLayout,
        effects: { ...DEFAULT_EFFECTS, enabled: true, invert: true, invertPdfStrategy: 'raster' },
        watermark: { ...getDefaultWatermarkSettings(), enabled: false },
        pageNumbering: { ...getDefaultPageNumberSettings(), enabled: false },
        userName: 'test',
      });
      const rasterImg = await renderPdfPage(rasterOut, 1);
      expect(pixel(rasterImg, 50, 50)).toEqual([0, 255, 255]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('bakes invert and visual effects into exported JPEG/PNG image pages without double-inverting', async () => {
    const srcCanvas = createCanvas(100, 100);
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.fillStyle = 'rgb(255, 0, 0)';
    srcCtx.fillRect(0, 0, 100, 100);
    const jpegBytes = new Uint8Array(await srcCanvas.encode('jpeg'));
    const doc = { id: 'img-d', fileType: 'image', mimeType: 'image/jpeg', rawBytes: jpegBytes } as SourceDocument;
    const singleLayout = { ...baseLayout, cols: 1, customWidthMm: 100 * ptToMm };
    const imgPage = makePage('img-1', 'img-d', 1, true);

    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas);
    vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
      const img = await loadImage(Buffer.from(await blob.arrayBuffer()));
      return Object.assign(img, { close: () => {} });
    });

    try {
      const out = await exportImposedPdf({
        documents: [doc],
        pages: [imgPage],
        layout: singleLayout,
        effects: { ...DEFAULT_EFFECTS, enabled: true, invert: true },
        watermark: { ...getDefaultWatermarkSettings(), enabled: false },
        pageNumbering: { ...getDefaultPageNumberSettings(), enabled: false },
        userName: 'test',
      });
      const rendered = await renderPdfPage(out, 1);
      const [r, g, b] = pixel(rendered, 50, 50);
      expect(r).toBeLessThan(15);
      expect(g).toBeGreaterThan(240);
      expect(b).toBeGreaterThan(240);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
