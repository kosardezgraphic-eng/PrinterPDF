import {describe,expect,it} from 'vitest';
import type {PageItem,PageOverlayText} from '@shared/models';
import {textPlacements} from './textOverlays';
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
});
