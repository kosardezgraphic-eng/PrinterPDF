import {describe,expect,it,vi} from 'vitest';
import {createCanvas} from '@napi-rs/canvas';
import type {PageItem,PageOverlayNumbering,PageOverlayText} from '@shared/models';
import {drawOverlayText,parseNumberingTemplate,textPlacements} from './textOverlays';
import {computeImpositionSheets} from './layoutEngine';
import {DEFAULT_LAYOUT} from '../store/useAppStore';
import {getDefaultPageNumberSettings} from './watermarkEngine';
const page=(id:string,selected=true):PageItem=>({id,documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:100,heightMm:200,rotation:0,selectedForPrint:selected,isHighlighted:false,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0});
const text:PageOverlayText={id:'t',kind:'text',target:'page',targetScope:'all',targetPageIds:[],targetSheetIndex:1,xPercent:10,yPercent:20,widthPercent:50,heightPercent:20,opacity:1,rotation:0,text:'متن',fontSize:18,fontFamily:'Vazirmatn',color:'#000',bold:false,italic:false,underline:false,align:'right'};
const pages=[page('a',false),page('b'),page('c')];
const sheets=computeImpositionSheets(pages,{...DEFAULT_LAYOUT,rows:1,cols:1,duplexMode:'none'});
describe('text overlay placement and numbering defaults',()=>{
 it('defaults numbering to disabled',()=>expect(getDefaultPageNumberSettings().enabled).toBe(false));
 it('uses source page order including excluded pages for odd/even and current/selected',()=>{
  expect(textPlacements(sheets[0],2,pages,[{...text,targetScope:'even'}])).toHaveLength(1);
  expect(textPlacements(sheets[1],2,pages,[{...text,targetScope:'even'}])).toHaveLength(0);
  expect(textPlacements(sheets[1],2,pages,[{...text,targetScope:'current',targetPageIds:['c']}])).toHaveLength(1);
  expect(textPlacements(sheets[0],2,pages,[{...text,targetScope:'selected',targetPageIds:['c']}])).toHaveLength(0);
 });
 it('uses sheet order for sheet overlays and proportional page coordinates',()=>{
  expect(textPlacements(sheets[1],2,pages,[{...text,target:'sheet',targetScope:'last'}])).toHaveLength(1);
  const [p]=textPlacements(sheets[0],2,pages,[text]);
  expect(p.x).toBeCloseTo(p.parentX+p.parentWidth*.1);expect(p.y).toBeCloseTo(p.parentY+p.parentHeight*.2);
  expect(p.width).toBeCloseTo(p.parentWidth*.5);
 });
 it('repeats text on every occurrence in a repeated-page matrix',()=>{
  const repeated=computeImpositionSheets(pages,{...DEFAULT_LAYOUT,rows:2,cols:2,placementMode:'step-and-repeat',duplexMode:'none'});
  expect(textPlacements(repeated[0],repeated.length,pages,[text])).toHaveLength(4);
 });
 it('targets captured document IDs and resolves a per-page context',()=>{
  const docs=[{...page('a'),documentId:'d1',documentName:'one.pdf'}, {...page('b'),documentId:'d2',documentName:'two.pdf',sourcePageNumber:7}];
  const sides=computeImpositionSheets(docs,{...DEFAULT_LAYOUT,rows:1,cols:1,duplexMode:'none'});
  const item={...text,text:'{page}/{total} {sheet} {file} {docPage}',targetScope:'selected-documents' as const,targetDocumentIds:['d2']};
  expect(textPlacements(sides[0],2,docs,[item])).toHaveLength(0);
  expect(textPlacements(sides[1],2,docs,[item])[0].renderText.text).toBe('2/2 2 two.pdf 7');
 });
 it('renders script runs and line spacing on the shared canvas renderer',()=>{
  const ctx={clearRect:vi.fn(),fillRect:vi.fn(),fillText:vi.fn(),measureText:(v:string)=>({width:v.length*10}),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),scale:vi.fn(),letterSpacing:'0px',wordSpacing:'0px'};
  drawOverlayText(ctx as unknown as CanvasRenderingContext2D,{...text,text:'H2O\nend',scriptRanges:[{start:1,end:2,script:'sub'}],lineHeight:2,wordSpacingPt:3,letterSpacingPt:1},100,100,1);
  expect(ctx.fillText).toHaveBeenCalledWith('2',expect.any(Number),expect.any(Number));
  expect(ctx.fillText).toHaveBeenCalledWith('end',100,36,100);
  expect(ctx.letterSpacing).toBe('1px');expect(ctx.wordSpacing).toBe('3px');
 });
 it('extends a captured document to all or chosen pages without changing its base scope',()=>{
  const docs=[{...page('a'),documentId:'one'}, {...page('b'),documentId:'two'}, {...page('c'),documentId:'three'}];
  const sides=computeImpositionSheets(docs,{...DEFAULT_LAYOUT,rows:1,cols:1,duplexMode:'none'});
  const base={...text,targetScope:'document' as const,targetDocumentIds:['one']};
  const counts=(item:PageOverlayText)=>sides.map(s=>textPlacements(s,3,docs,[item]).length);
  expect(counts(base)).toEqual([1,0,0]);
  expect(counts({...base,coverageMode:'all'})).toEqual([1,1,1]);
  expect(counts({...base,coverageMode:'selected',coveragePageIds:['c']})).toEqual([1,0,1]);
  expect(counts({...base,coverageMode:undefined,coveragePageIds:['c']})).toEqual([1,0,0]);
  const reordered=[docs[2],docs[1],docs[0]];
  const reorderedSides=computeImpositionSheets(reordered,{...DEFAULT_LAYOUT,rows:1,cols:1,duplexMode:'none'});
  expect(reorderedSides.map(side=>textPlacements(side,3,reordered,[{...base,coverageMode:'selected',coveragePageIds:['c']}]).length)).toEqual([1,0,1]);
 });
 it('extends a sheet scope by output-side index, not by its source pages',()=>{
  const item={...text,target:'sheet' as const,targetScope:'current' as const,targetSheetIndex:1,coverageMode:'selected' as const,coverageSheetIndices:[2]};
  expect(sheets.map(sheet=>textPlacements(sheet,2,pages,[item]).length)).toEqual([1,1]);
  expect(sheets.map(sheet=>textPlacements(sheet,2,pages,[{...item,coverageMode:undefined}]).length)).toEqual([1,0]);
 });
});

const all=[page('a'),page('b'),page('c')];
const allSheets=computeImpositionSheets(all,{...DEFAULT_LAYOUT,rows:1,cols:1,duplexMode:'none'});
const numbering:PageOverlayNumbering={id:'n',kind:'numbering',enabled:true,target:'page',targetScope:'all',targetPageIds:[],targetSheetIndex:1,xPercent:30,yPercent:88,widthPercent:40,heightPercent:7,opacity:1,rotation:0,fontSize:14,fontFamily:'Vazirmatn',color:'#000000',bold:false,italic:false,align:'center',format:'persian',template:'{page}',startOffset:1,padZeros:0,customScript:''};
describe('editable numbering placements',()=>{
 it('numbers workspace page order for page targets and output side order for sheet targets',()=>{
  expect(allSheets.map(s=>textPlacements(s,3,all,[{...numbering,template:'{page}/{total}'}])[0].renderText.text)).toEqual(['۱/۳','۲/۳','۳/۳']);
  expect(textPlacements(allSheets[1],3,all,[{...numbering,target:'sheet',template:'{page}/{total}'}])[0].renderText.text).toBe('۲/۳');
 });
 it('honours odd/even/first/last/current/selected scopes',()=>{
  const count=(item:PageOverlayNumbering)=>allSheets.map(s=>textPlacements(s,3,all,[item]).length);
  expect(count({...numbering,targetScope:'odd'})).toEqual([1,0,1]);
  expect(count({...numbering,targetScope:'even'})).toEqual([0,1,0]);
  expect(count({...numbering,targetScope:'first'})).toEqual([1,0,0]);
  expect(count({...numbering,targetScope:'last'})).toEqual([0,0,1]);
  expect(count({...numbering,targetScope:'current',targetPageIds:['c']})).toEqual([0,0,1]);
  expect(count({...numbering,targetScope:'selected',targetPageIds:['a']})).toEqual([1,0,0]);
 });
 it('supports a numeric formula and padding, and keeps independent numbering per sheet range',()=>{
  const p=textPlacements(allSheets[0],3,all,[{...numbering,customScript:'page+1000',startOffset:5,padZeros:6,template:'{serial} {page}',format:'english'}])[0];
  expect(p.renderText.text).toBe('001005 1005');
  const odd=textPlacements(allSheets[2],3,all,[{...numbering,targetScope:'odd',template:'O{page}'}])[0];
  const even=textPlacements(allSheets[1],3,all,[{...numbering,id:'m',targetScope:'even',startOffset:500,template:'E{page}'}])[0];
  expect([odd.renderText.text,even.renderText.text]).toEqual(['O۳','E۵۰۱']);
 });
 it('exposes an error for an invalid formula or unsupported numeral instead of rendering wrong numbers',()=>{
  const bad=textPlacements(allSheets[0],3,all,[{...numbering,customScript:'page/0'}])[0];
  expect(bad.formulaError).toBe('Invalid numbering formula or format');expect(bad.renderText.text).toBe('{page}');
  expect(textPlacements(allSheets[0],3,all,[{...numbering,format:'roman',startOffset:4000}])[0].formulaError).toBe('Invalid numbering formula or format');
 });
 it('skips disabled numbering and sheet ranges chosen by output side index',()=>{
  expect(textPlacements(allSheets[0],3,all,[{...numbering,enabled:false}])).toHaveLength(0);
  const item={...numbering,target:'sheet' as const,targetScope:'selected' as const,targetSheetIndices:[3]};
  expect(allSheets.map(s=>textPlacements(s,3,all,[item]).length)).toEqual([0,0,1]);
 });
 it('paints the resolved number into the shared canvas used by preview and PDF',()=>{
  const canvas=createCanvas(300,80),ctx=canvas.getContext('2d');
  const p=textPlacements(allSheets[2],3,all,[{...numbering,fontSize:40,align:'center',template:'{page} / {total}'}])[0];
  drawOverlayText(ctx as unknown as CanvasRenderingContext2D,p.renderText,300,80,1);
  const data=ctx.getImageData(0,0,300,80).data;let ink=0;for(let i=0;i<data.length;i+=4)if(data[i+3]>0&&data[i]<128)ink++;
  expect(ink).toBeGreaterThan(40);
  const cleared=createCanvas(300,80),c2=cleared.getContext('2d');
  drawOverlayText(c2 as unknown as CanvasRenderingContext2D,{...p.renderText,text:''},300,80,1);
  const d2=c2.getImageData(0,0,300,80).data;let ink2=0;for(let i=0;i<d2.length;i+=4)if(d2[i+3]>0)ink2++;
  expect(ink2).toBe(0);
 });
 it('turns template script markers into superscript and subscript runs',()=>{
  const p=textPlacements(allSheets[0],3,all,[{...numbering,format:'english' as const,template:'Page {page}^{th} _{folio}'}])[0];
  expect(p.renderText.text).toBe('Page 1th folio');
  expect(p.renderText.scriptRanges).toEqual([{start:6,end:8,script:'super'},{start:9,end:14,script:'sub'}]);
  const q=textPlacements(allSheets[1],3,all,[{...numbering,format:'english' as const,template:'N^{page {page}}'}])[0];
  expect(q.renderText.text).toBe('Npage 2');expect(q.renderText.scriptRanges).toEqual([{start:1,end:7,script:'super'}]);
  expect(parseNumberingTemplate('plain ^{sup}_{sub}')).toEqual([{text:'plain '},{text:'sup',script:'super'},{text:'sub',script:'sub'}]);
  expect(parseNumberingTemplate('no markers ^ here')).toEqual([{text:'no markers ^ here'}]);
  expect(parseNumberingTemplate('A_{b^{c}}D')).toEqual([{text:'A'},{text:'bc',script:'sub'},{text:'D'}]);
  expect(textPlacements(allSheets[0],3,all,[{...numbering,template:'{page}^{x}',customScript:'page/0'}])[0].formulaError).toBeTruthy();
 });
});
