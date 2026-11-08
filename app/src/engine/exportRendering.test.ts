import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDict, PDFDocument, PDFName, PDFStream, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PageItem, SourceDocument } from '@shared/models';
import { DEFAULT_EFFECTS, DEFAULT_LAYOUT } from '../store/useAppStore';
import { getDefaultPageNumberSettings, getDefaultWatermarkSettings } from './watermarkEngine';
import { exportImposedPdf, importFilesBatch } from './pdfService';

const ptToMm = 25.4 / 72;
const layout = { ...DEFAULT_LAYOUT, paperSize: 'Custom' as const, customWidthMm: 100 * ptToMm,
  customHeightMm: 100 * ptToMm, rows: 1, cols: 1, duplexMode: 'none' as const,
  marginsMm: { top: 0, right: 0, bottom: 0, left: 0 }, horizontalGutterMm: 0, verticalGutterMm: 0,
  autoRotateToFit: false, showCellBorders: false };
const page = (rotation: PageItem['rotation']): PageItem => ({ id:'p', documentId:'d', documentName:'source', sourcePageNumber:1,
  widthMm:60*ptToMm, heightMm:100*ptToMm, rotation, selectedForPrint:true, isHighlighted:false, isBlankPage:false,
  colorProfile:'color', inkCoveragePercent:10 });
async function exportOne(doc: SourceDocument, rotation: PageItem['rotation']) {
  return exportImposedPdf({ documents: [doc], pages: [page(rotation)], layout, effects: { ...DEFAULT_EFFECTS, enabled:false },
    watermark: { ...getDefaultWatermarkSettings(), enabled:false }, pageNumbering: { ...getDefaultPageNumberSettings(), enabled:false }, userName:'test' });
}
async function render(bytes: Uint8Array) {
  (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  try {
    const pdf = await task.promise; const pdfPage = await pdf.getPage(1); const viewport = pdfPage.getViewport({scale: 1});
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await pdfPage.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
    return ctx.getImageData(0,0,canvas.width,canvas.height);
  } finally { await task.destroy(); }
}
function pixel(image: { data: Uint8ClampedArray; width: number }, x: number, y: number) {
  return Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3));
}

describe('real output rendering', () => {
  it.each([
    [0, 30, 10], [90, 90, 30], [180, 70, 90], [270, 10, 70],
  ] as const)('places a rotated PDF accurately at %i degrees', async (angle, x, y) => {
    const source = await PDFDocument.create(); const p = source.addPage([60,100]);
    p.drawRectangle({x:0,y:80,width:20,height:20,color:rgb(1,0,0)});
    const doc = { id:'d', fileType:'pdf', rawBytes:await source.save() } as SourceDocument;
    const image = await render(await exportOne(doc, angle));
    const [r,g,b] = pixel(image,x,y);
    expect(r).toBeGreaterThan(240); expect(g).toBeLessThan(20); expect(b).toBeLessThan(20);
  });
  it('clips fill-mode content to its cell, leaving the adjacent empty cell white', async () => {
    const source = await PDFDocument.create();
    source.addPage([100,100]).drawRectangle({ x:0, y:0, width:100, height:100, color:rgb(1,0,0) });
    const doc = { id:'d', fileType:'pdf', rawBytes:await source.save() } as SourceDocument;
    const output = await exportImposedPdf({ documents:[doc], pages:[{ ...page(0), widthMm:100*ptToMm }],
      layout:{ ...layout, cols:2, sheetOrder:'ltr', scaleMode:'fill' }, effects:{ ...DEFAULT_EFFECTS, enabled:false },
      watermark:{ ...getDefaultWatermarkSettings(), enabled:false }, pageNumbering:{ ...getDefaultPageNumberSettings(), enabled:false }, userName:'test' });
    const bitmap = await render(output);
    expect(pixel(bitmap, 25, 50)).toEqual([255, 0, 0]);
    expect(pixel(bitmap, 60, 50)).toEqual([255, 255, 255]);
  });
  it('embeds PNG as an image resource in exported PDF', async () => {
    const canvas = createCanvas(60,100); const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0,0,60,100); ctx.fillStyle = 'red'; ctx.fillRect(0,0,20,20);
    const png = new Uint8Array(await canvas.encode('png'));
    const input = await importFilesBatch([new File([png], 'image.png', {type:'image/png'})]);
    expect(input.errors).toEqual([]);
    expect(input.pages[0].widthMm / input.pages[0].heightMm).toBeCloseTo(0.6);
    const doc = { ...input.documents[0], id:'d' };
    const output = await PDFDocument.load(await exportOne(doc,90));
    const resources = output.getPage(0).node.Resources();
    const xobjects = resources?.lookup(PDFName.of('XObject'), PDFDict);
    expect(xobjects?.keys().length).toBe(1);
    const image = xobjects!.lookup(xobjects!.keys()[0], PDFStream);
    expect(image.dict.get(PDFName.of('Subtype'))?.toString()).toBe('/Image');
    expect(image.dict.get(PDFName.of('Width'))?.toString()).toBe('60');
    expect(image.dict.get(PDFName.of('Height'))?.toString()).toBe('100');
  });
  it('imports and embeds JPEG without changing its aspect ratio', async () => {
    const canvas = createCanvas(80,40);
    const jpeg = new Uint8Array(await canvas.encode('jpeg'));
    const result = await importFilesBatch([new File([jpeg], 'photo.jpg', { type:'image/jpeg' })]);
    expect(result.errors).toEqual([]);
    expect(result.pages[0].widthMm / result.pages[0].heightMm).toBeCloseTo(2);
    const output = await PDFDocument.load(await exportOne({ ...result.documents[0], id:'d' }, 0));
    const xobjects = output.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
    const image = xobjects!.lookup(xobjects!.keys()[0], PDFStream);
    expect(image.dict.get(PDFName.of('Filter'))?.toString()).toBe('/DCTDecode');
  });
});
