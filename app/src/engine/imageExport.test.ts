import {describe,expect,it} from 'vitest';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import type {LayoutSettings,PageItem,PageOverlayImage,SourceDocument} from '@shared/models';
import {DEFAULT_EFFECTS,DEFAULT_LAYOUT} from '../store/useAppStore';
import {exportImposedPdf} from './pdfService';
import {getDefaultPageNumberSettings,getDefaultWatermarkSettings} from './watermarkEngine';

const MM_TO_PT=72/25.4;
/** A real 1×1 PNG: pdf-lib embeds it without a Canvas, which is exactly the fast path under test. */
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const layout:LayoutSettings={...DEFAULT_LAYOUT,paperSize:'Custom',customWidthMm:200,customHeightMm:300,rows:1,cols:1,duplexMode:'none',
  marginMode:'custom',marginsMm:{top:0,right:0,bottom:0,left:0},horizontalGutterMm:0,verticalGutterMm:0,autoRotateToFit:false,showCellBorders:false};
const page=(id:string,sourcePageNumber:number):PageItem=>({id,documentId:'d',documentName:'d',sourcePageNumber,widthMm:200,heightMm:300,rotation:0,
  selectedForPrint:true,isHighlighted:sourcePageNumber===1,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0});
const image=(overrides:Partial<PageOverlayImage>={}):PageOverlayImage=>({id:'i',kind:'image',target:'sheet',targetScope:'all',targetPageIds:[],targetSheetIndex:1,
  xPercent:25,yPercent:50,widthPercent:50,heightPercent:25,opacity:1,rotation:0,src:PNG,name:'logo',naturalWidth:400,naturalHeight:300,fit:'fill',lockAspect:true,...overrides});
async function source(pages:number){const src=await PDFDocument.create();for(let i=0;i<pages;i++)src.addPage([200*MM_TO_PT,300*MM_TO_PT]);
  return {documents:[{id:'d',fileType:'pdf',rawBytes:await src.save()} as SourceDocument],pages:Array.from({length:pages},(_,i)=>page(`p${i+1}`,i+1))};}
async function exportWith(overlay:PageOverlayImage|PageOverlayImage[],options:{pages?:number;layout?:LayoutSettings}={}){
  const {documents,pages}=await source(options.pages??2);
  const bytes=await exportImposedPdf({documents,pages,allPages:pages,layout:options.layout??layout,effects:{...DEFAULT_EFFECTS,enabled:false},
    watermark:{...getDefaultWatermarkSettings(),enabled:false},pageNumbering:{...getDefaultPageNumberSettings(),enabled:false},
    overlays:Array.isArray(overlay)?overlay:[overlay],userName:'test'});
  const pdf=await PDFDocument.load(bytes);
  const streams=Array.from({length:pdf.getPageCount()},(_,i)=>{const contents=pdf.getPage(i).node.Contents() as PDFArray;
    return Array.from({length:contents.size()},(_,k)=>new TextDecoder().decode(decodePDFRawStream(pdf.context.lookup(contents.get(k)) as PDFRawStream).decode())).join('\n');});
  // Only the picture overlays are image XObjects; the imported pages arrive as form XObjects.
  const dict=(index:number)=>pdf.getPage(index).node.Resources()?.lookup(PDFName.of('XObject'),PDFDict);
  const images=Array.from({length:pdf.getPageCount()},(_,i)=>{const box=dict(i);if(!box)return [];
    return box.keys().map(key=>{const ref=box.lookup(key);const value=pdf.context.lookup(ref) as {dict?:PDFDict}|undefined;
      return {ref:String(ref),image:String(value?.dict?.get(PDFName.of('Subtype'))??'')==='/Image'};}).filter(entry=>entry.image);});
  const xobjects=images.map(list=>list.length);
  const refs=images.map(list=>list.map(entry=>entry.ref));
  return {pdf,streams,xobjects,refs};
}

describe('picture export',()=>{
 it('draws the picture into the same millimetre box the preview shows',async()=>{
  const {streams,xobjects}=await exportWith(image());
  expect(xobjects).toEqual([1,1]);                                                // one picture per sheet
  // 50 % of a 200 mm sheet is 100 mm (283.46 pt) wide and 25 % of 300 mm is 75 mm (212.60 pt) tall.
  expect(streams[0]).toMatch(/1 0 0 1 141\.7\d+ 212\.5\d+ cm/);                  // moved to the box's left/bottom corner
  expect(streams[0]).toMatch(/283\.4\d+ 0 0 212\.5\d+ 0 0 cm/);                    // and scaled to exactly that box
 });
 it('embeds one picture and reuses it on every sheet',async()=>{
  const {refs}=await exportWith(image(),{pages:3});
  expect(refs.map(list=>list.length)).toEqual([1,1,1]);
  expect(new Set(refs.flat()).size).toBe(1);                                     // the same PDF object, not three copies
 });
 it('letterboxes a contained picture instead of stretching it',async()=>{
  const square={xPercent:25,yPercent:33.3333,widthPercent:50,heightPercent:33.3333,fit:'contain' as const};
  const {streams}=await exportWith(image(square));
  // The 4:3 file keeps its ratio inside the 100×100 mm box: 100 mm wide, 75 mm tall.
  expect(streams[0]).toMatch(/283\.4\d+ 0 0 212\.5\d+/);
  expect(streams[0]).not.toMatch(/283\.4\d+ 0 0 283\.4\d+/);                   // never stretched to fill the square
 });
 it('shows a picture only on the sheets its scope selects',async()=>{
  const odd=await exportWith(image({targetScope:'odd'}),{pages:3});
  expect(odd.xobjects).toEqual([1,0,1]);
  const chosen=await exportWith(image({targetScope:'selected',targetSheetIndices:[2]}),{pages:3});
  expect(chosen.xobjects).toEqual([0,1,0]);
 });
 it('clips a page picture to its cell inside a matrix',async()=>{
  const grid={...layout,rows:2,cols:1};
  const {streams}=await exportWith(image({target:'page',targetScope:'all',targetPageIds:[]}),{pages:2,layout:grid});
  expect(streams[0].match(/\/Image-\d+ Do/g)).toHaveLength(2);                    // once on each page of the sheet
  expect(streams[0]).toMatch(/re\nW\nn/);                                          // each draw is clipped to its cell
  expect(streams[0].match(/re\nW\nn/g)).toHaveLength(4);                           // one page clip and one picture clip per cell
 });
 it('refuses to guess when the picture data is gone',async()=>{
  await expect(exportWith(image({src:''}))).rejects.toThrow('Image overlay i lost its picture data');
 });
 it('asks for a Canvas renderer before it can mirror a picture',async()=>{
  await expect(exportWith(image({flipHorizontal:true}))).rejects.toThrow('Exporting a flipped or non PNG/JPEG picture needs a Canvas 2D renderer');
  await expect(exportWith(image({src:'data:image/webp;base64,AAAA'}))).rejects.toThrow('Canvas 2D renderer');
 });
 it('skips a box that collapsed and keeps the rest of the sheet',async()=>{
  const {streams,xobjects}=await exportWith([image({widthPercent:0,heightPercent:0}),image({id:'j',xPercent:5,yPercent:5,widthPercent:10,heightPercent:10})]);
  expect(xobjects).toEqual([1,1]);                                                // the collapsed box drew nothing
  expect(streams[0]).toMatch(/1 0 0 1 28\.3\d+ 722\.8\d+ cm/);                     // only the 20×30 mm box is drawn
  expect(streams[0]).toMatch(/56\.6\d+ 0 0 85\.0\d+ 0 0 cm/);
 });
});
