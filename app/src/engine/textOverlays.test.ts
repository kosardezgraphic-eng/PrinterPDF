import {describe,expect,it,vi} from 'vitest';
import type {PageItem,PageOverlayText} from '@shared/models';
import {drawOverlayText,textPlacements} from './textOverlays';
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
});
