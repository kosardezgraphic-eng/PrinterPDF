import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDict, PDFDocument, PDFName, PDFStream, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PageItem, SourceDocument } from '@shared/models';
import { DEFAULT_EFFECTS, DEFAULT_LAYOUT, useAppStore } from '../store/useAppStore';
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
  it.each([0,90] as const)('crops PDF content and refits it for rotation %i', async angle => {
    const source = await PDFDocument.create(); const p = source.addPage([100,100]);
    p.drawRectangle({x:0,y:0,width:50,height:100,color:rgb(1,0,0)});
    p.drawRectangle({x:50,y:0,width:50,height:100,color:rgb(0,0,1)});
    const doc = { id:'d', fileType:'pdf', rawBytes:await source.save() } as SourceDocument;
    const input = { ...page(angle), widthMm:100*ptToMm, heightMm:100*ptToMm,
      overrides:{ cropBoxMm:{left:50*ptToMm, top:0, right:0, bottom:0} } };
    const output = await exportImposedPdf({ documents:[doc], pages:[input], layout:{...layout,scaleMode:'original'},
      effects:{...DEFAULT_EFFECTS, enabled:false}, watermark:{...getDefaultWatermarkSettings(),enabled:false},
      pageNumbering:{...getDefaultPageNumberSettings(),enabled:false}, userName:'test' });
    const image = await render(output);
    expect(pixel(image,50,50)).toEqual([0,0,255]);
    if (angle === 0) expect(pixel(image,10,50)).toEqual([255,255,255]);
    else expect(pixel(image,50,10)).toEqual([255,255,255]);
  });
  it('honors a nonzero source CropBox when cropping the PDF', async () => {
    const source = await PDFDocument.create(); const p = source.addPage([120,100]);
    p.drawRectangle({x:0,y:0,width:60,height:100,color:rgb(1,0,0)});
    p.drawRectangle({x:60,y:0,width:60,height:100,color:rgb(0,0,1)});
    p.setCropBox(20,10,80,80);
    const input = { ...page(0), widthMm:80*ptToMm, heightMm:80*ptToMm,
      overrides:{ cropBoxMm:{left:40*ptToMm, top:0, right:0, bottom:0} } };
    const output = await exportImposedPdf({ documents:[{id:'d',fileType:'pdf',rawBytes:await source.save()} as SourceDocument],
      pages:[input], layout, effects:{...DEFAULT_EFFECTS,enabled:false}, watermark:{...getDefaultWatermarkSettings(),enabled:false},
      pageNumbering:{...getDefaultPageNumberSettings(),enabled:false}, userName:'test' });
    const image = await render(output);
    expect(pixel(image,50,50)).toEqual([0,0,255]);
    expect(pixel(image,10,50)).toEqual([255,255,255]);
  });
  it('exports moved and resized PDF content at its transformed position', async () => {
    const source = await PDFDocument.create();
    source.addPage([100,100]).drawRectangle({x:0,y:0,width:100,height:100,color:rgb(1,0,0)});
    const input = { ...page(0), widthMm:100*ptToMm, overrides:{transform:{x:.25,y:0,scaleX:.5,scaleY:.5}} };
    const output = await exportImposedPdf({ documents:[{id:'d',fileType:'pdf',rawBytes:await source.save()} as SourceDocument],
      pages:[input],layout,effects:{...DEFAULT_EFFECTS,enabled:false},watermark:{...getDefaultWatermarkSettings(),enabled:false},
      pageNumbering:{...getDefaultPageNumberSettings(),enabled:false},userName:'test' });
    const image = await render(output);
    expect(pixel(image,75,50)).toEqual([255,0,0]);
    expect(pixel(image,25,50)).toEqual([255,255,255]);
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
  it('keeps the paper orientation and exports a manually rotated page even with auto-fit enabled', async () => {
    const source = await PDFDocument.create(); const p = source.addPage([60,100]);
    p.drawRectangle({x:0,y:80,width:20,height:20,color:rgb(1,0,0)});
    const doc = {id:'d',fileType:'pdf',rawBytes:await source.save()} as SourceDocument;
    const portrait = {...layout,customWidthMm:100*ptToMm,customHeightMm:160*ptToMm,autoRotateToFit:true};
    useAppStore.setState({pages:[page(0)],documents:[doc],layout:portrait});
    useAppStore.getState().rotatePages(['p'],90);
    const output = await exportImposedPdf({ documents:[doc],pages:useAppStore.getState().pages,layout:portrait,
      effects:{...DEFAULT_EFFECTS,enabled:false}, watermark:{...getDefaultWatermarkSettings(),enabled:false},
      pageNumbering:{...getDefaultPageNumberSettings(),enabled:false},userName:'test' });
    const outputPdf = await PDFDocument.load(output);
    expect(outputPdf.getPage(0).getWidth()).toBeCloseTo(100);
    expect(outputPdf.getPage(0).getHeight()).toBeCloseTo(160);
    const image = await render(output);
    expect(pixel(image,90,60)).toEqual([255,0,0]);
    expect(pixel(image,50,20)).toEqual([255,255,255]);
  });
  it('exports the adjusted margins and uniform gutter at the preview cell bounds', async () => {
    const source = await PDFDocument.create();
    source.addPage([100,100]).drawRectangle({x:0,y:0,width:100,height:100,color:rgb(1,0,0)});
    const adjusted = {...layout, orientation:'landscape' as const, customWidthMm:200*ptToMm, customHeightMm:100*ptToMm,
      marginsMm:{left:10*ptToMm,right:10*ptToMm,top:10*ptToMm,bottom:10*ptToMm}, horizontalGutterMm:20*ptToMm,
      cols:2, placementMode:'step-and-repeat' as const};
    const output = await exportImposedPdf({ documents:[{id:'d',fileType:'pdf',rawBytes:await source.save()} as SourceDocument],
      pages:[{...page(0),widthMm:100*ptToMm}],layout:adjusted,effects:{...DEFAULT_EFFECTS,enabled:false},
      watermark:{...getDefaultWatermarkSettings(),enabled:false},pageNumbering:{...getDefaultPageNumberSettings(),enabled:false},userName:'test' });
    const image = await render(output);
    expect(pixel(image,5,50)).toEqual([255,255,255]);
    expect(pixel(image,40,50)).toEqual([255,0,0]);
    expect(pixel(image,100,50)).toEqual([255,255,255]);
    expect(pixel(image,160,50)).toEqual([255,0,0]);
  });
  it('renders overlapping moved cells in the chosen layer order without cell clipping', async () => {
    const source = await PDFDocument.create();
    source.addPage([50,100]).drawRectangle({x:0,y:0,width:50,height:100,color:rgb(1,0,0)});
    source.addPage([50,100]).drawRectangle({x:0,y:0,width:50,height:100,color:rgb(0,0,1)});
    const doc = {id:'d',fileType:'pdf',rawBytes:await source.save()} as SourceDocument;
    const pages = [{...page(0),id:'red',widthMm:50*ptToMm},{...page(0),id:'blue',sourcePageNumber:2,widthMm:50*ptToMm}];
    const matrix = {...layout,cols:2,sheetOrder:'ltr' as const};
    useAppStore.setState({pages,documents:[doc],layout:matrix});
    const {computeImpositionSheets} = await import('./layoutEngine');
    const red = computeImpositionSheets(pages,matrix)[0].cells[0];
    useAppStore.getState().applyCellTransform('red',red.occurrenceKey!,{x:.6,y:0,scaleX:1,scaleY:1});
    const generate = () => exportImposedPdf({documents:[doc],pages,layout:useAppStore.getState().layout,effects:{...DEFAULT_EFFECTS,enabled:false},
      watermark:{...getDefaultWatermarkSettings(),enabled:false},pageNumbering:{...getDefaultPageNumberSettings(),enabled:false},userName:'test'});
    let bitmap = await render(await generate());
    expect(pixel(bitmap,35,50)).toEqual([255,0,0]);
    expect(pixel(bitmap,65,50)).toEqual([0,0,255]);
    useAppStore.getState().reorderCellLayer(0,red.occurrenceKey!,'front');
    bitmap = await render(await generate());
    expect(pixel(bitmap,65,50)).toEqual([255,0,0]);
    expect(pixel(bitmap,90,50)).toEqual([0,0,255]);
    useAppStore.getState().undo();
    bitmap = await render(await generate());
    expect(pixel(bitmap,65,50)).toEqual([0,0,255]);
  });
  it('renders an overlapping PDF page with the same white paper backing as its preview thumbnail', async () => {
    const source = await PDFDocument.create();
    source.addPage([50,100]).drawRectangle({x:0,y:0,width:50,height:100,color:rgb(1,0,0)});
    source.addPage([50,100]).drawRectangle({x:0,y:0,width:10,height:10,color:rgb(0,0,1)});
    const doc = {id:'d',fileType:'pdf',rawBytes:await source.save()} as SourceDocument;
    const pages = [{...page(0),id:'red',widthMm:50*ptToMm},{...page(0),id:'blue',sourcePageNumber:2,widthMm:50*ptToMm}];
    const matrix = {...layout,cols:2,sheetOrder:'ltr' as const};
    useAppStore.setState({pages,documents:[doc],layout:matrix});
    const {computeImpositionSheets} = await import('./layoutEngine');
    const red = computeImpositionSheets(pages,matrix)[0].cells[0];
    useAppStore.getState().applyCellTransform('red',red.occurrenceKey!,{x:.6,y:0,scaleX:1,scaleY:1});
    const output = await exportImposedPdf({documents:[doc],pages,layout:useAppStore.getState().layout,effects:{...DEFAULT_EFFECTS,enabled:false},
      watermark:{...getDefaultWatermarkSettings(),enabled:false},pageNumbering:{...getDefaultPageNumberSettings(),enabled:false},userName:'test'});
    const image = await render(output);
    expect(pixel(image,35,50)).toEqual([255,0,0]);
    expect(pixel(image,65,50)).toEqual([255,255,255]);
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
