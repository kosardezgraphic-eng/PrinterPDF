import {describe,expect,it} from 'vitest';
import type {LayoutSettings,PageItem,PageOverlayImage,PageOverlayText} from '@shared/models';
import {imageDropPlacement,imageOverlayFromPlacement,placeImageInBox,sheetToBoxPoint,sizeImageToFit,newOverlayId} from './imageOverlays';
import {imageDrawRect,imagePlacements,overlayPlacements} from './overlayPlacements';
import {resizeOverlay,resizeOverlayKeepingAspect,rotationFromPointer,pointerAngle} from './overlayGeometry';
import {computeImpositionSheets} from './layoutEngine';
import {DEFAULT_LAYOUT} from '../store/useAppStore';

const page=(id:string,extra:Partial<PageItem>={}):PageItem=>({id,documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:100,heightMm:200,rotation:0,selectedForPrint:true,isHighlighted:false,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0,...extra});
const layout=(rows:number,cols:number,duplex:LayoutSettings['duplexMode']='none',placement:LayoutSettings['placementMode']='sequential'):LayoutSettings=>({...DEFAULT_LAYOUT,paperSize:'Custom',customWidthMm:200,customHeightMm:300,rows,cols,duplexMode:duplex,placementMode:placement});
const sheet1=computeImpositionSheets([page('a'),page('b')],layout(1,1))[0];
const grid=computeImpositionSheets([page('a'),page('b'),page('c'),page('d')],layout(2,2));
const image=(overrides:Partial<PageOverlayImage>={}):PageOverlayImage=>{
  const {xPercent=20,yPercent=30,widthPercent=40,heightPercent=20,...rest}=overrides;
  return {id:'i',kind:'image',target:'page',targetScope:'all',targetPageIds:[],targetSheetIndex:1,xPercent,yPercent,widthPercent,heightPercent,
    opacity:1,rotation:0,src:'data:image/png;base64,AAA',name:'logo',naturalWidth:400,naturalHeight:200,...rest};
};

describe('picture drop placement',()=>{
 it('sizes the box from the file ratio and keeps it inside the page box',()=>{
  const box={x:0,y:0,width:200,height:300};
  const size=sizeImageToFit(800,200,box);           // 4:1 wide picture
  expect(size.widthPercent).toBe(45);
  expect((size.widthPercent/100*box.width)/(size.heightPercent/100*box.height)).toBeCloseTo(4,6);
  const wide=sizeImageToFit(1,1000,box,45);          // very tall picture
  expect(wide.heightPercent).toBe(45);
  expect(sizeImageToFit(0,0,box)).toEqual({widthPercent:45,heightPercent:30}); // unknown ratio → fills the box shape
 });
 it('centres the box on the point and clamps it inside the page',()=>{
  const box={x:10,y:20,width:100,height:100};
  expect(placeImageInBox({xMm:60,yMm:70},box,{widthPercent:40,heightPercent:40})).toEqual({xPercent:30,yPercent:30});
  expect(placeImageInBox({xMm:0,yMm:0},box,{widthPercent:40,heightPercent:40})).toEqual({xPercent:0,yPercent:0});
  expect(placeImageInBox({xMm:110,yMm:120},box,{widthPercent:40,heightPercent:40})).toEqual({xPercent:60,yPercent:60});
 });
 it('attaches to the page under the cursor, the sheet as fallback, and nothing outside the sheet',()=>{
  const first=grid[0];const cell=first.cells[0];
  const onPage=imageDropPlacement(first,{xMm:cell.contentXMm+cell.contentWidthMm/2,yMm:cell.contentYMm+cell.contentHeightMm/2},{width:200,height:200})!;
  expect(onPage).toMatchObject({target:'page',pageId:'a',sheetIndex:1});
  const gutter=computeImpositionSheets([page('a')],{...layout(2,2),marginMode:'custom' as const,marginsMm:{top:40,right:40,bottom:40,left:40}})[0];
  const onSheet=imageDropPlacement(gutter,{xMm:10,yMm:10},{width:200,height:200})!;
  expect(onSheet).toMatchObject({target:'sheet',sheetIndex:1});expect('pageId' in onSheet).toBe(false);
  expect(imageDropPlacement(sheet1,{xMm:sheet1.widthMm+5,yMm:5},{width:200,height:200})).toBeNull();
 });
 it('maps sheet coordinates back into a rotated page box',()=>{
  const box={x:100,y:0,width:100,height:50};
  // A 90° turned page is 50 wide on screen around x=150; a point below the centre is its local right side.
  const local=sheetToBoxPoint({xMm:150,yMm:60},box,90);
  expect(local.xMm).toBeCloseTo(185,6);expect(local.yMm).toBeCloseTo(25,6);
  expect(local.xMm).toBeGreaterThan(box.x);expect(local.xMm).toBeLessThan(box.x+box.width);   // inside the unrotated box
  expect(sheetToBoxPoint({xMm:105,yMm:25},box,90).yMm).toBeCloseTo(70,6);                       // outside the turned page stays outside
  expect(sheetToBoxPoint({xMm:50,yMm:50},box,0)).toEqual({xMm:50,yMm:50});
 });
 it('creates a page-scoped overlay with a locked ratio by default',()=>{
  const placement=imageDropPlacement(sheet1,{xMm:50,yMm:60},{width:400,height:200})!;
  const item=imageOverlayFromPlacement(newOverlayId(),'data:image/png;base64,AAA','logo',{width:400,height:200},placement);
  expect(item).toMatchObject({kind:'image',target:'page',targetScope:'current',targetPageIds:['a'],lockAspect:true,fit:'fill',opacity:1,rotation:0,name:'logo'});
  expect(item.id).toBeTruthy();
 });
});

describe('picture geometry gestures',()=>{
 const frame={parentWidth:200,parentHeight:300};
 it('Shift (or the lock) keeps the millimetre ratio while a corner is dragged',()=>{
  const box={xPercent:20,yPercent:30,widthPercent:40,heightPercent:20};
  const next=resizeOverlayKeepingAspect(box,'se',20,5,frame);
  const before=(box.widthPercent*frame.parentWidth)/(box.heightPercent*frame.parentHeight);
  expect((next.widthPercent*frame.parentWidth)/(next.heightPercent*frame.parentHeight)).toBeCloseTo(before,6);
  expect(next.xPercent).toBe(20);expect(next.yPercent).toBe(30);   // anchor corner stays
  expect(next.widthPercent).toBeGreaterThan(box.widthPercent);
 });
 it('anchoring follows the handle and the box never leaves the page',()=>{
  const box={xPercent:60,yPercent:10,widthPercent:40,heightPercent:60};
  const fromNorthWest=resizeOverlayKeepingAspect(box,'nw',-5,-2,frame);
  expect(fromNorthWest.xPercent+fromNorthWest.widthPercent).toBeCloseTo(100,6);   // the bottom-right corner stays put
  expect(fromNorthWest.yPercent+fromNorthWest.heightPercent).toBeCloseTo(70,6);
  expect(fromNorthWest.widthPercent).toBeGreaterThan(40);expect(fromNorthWest.heightPercent).toBeGreaterThan(60);
  const clamped=resizeOverlayKeepingAspect(box,'se',120,120,frame);
  expect(clamped.xPercent).toBeGreaterThanOrEqual(0);expect(clamped.xPercent+clamped.widthPercent).toBeLessThanOrEqual(100);
  expect(clamped.yPercent+clamped.heightPercent).toBeLessThanOrEqual(100);
 });
 it('edge handles grow the other axis around the centre and stay smaller than the page',()=>{
  const box={xPercent:40,yPercent:40,widthPercent:20,heightPercent:13.3333};
  const east=resizeOverlayKeepingAspect(box,'e',10,0,frame);
  expect(east.xPercent).toBe(40);
  expect((east.widthPercent*200)/(east.heightPercent*300)).toBeCloseTo((box.widthPercent*200)/(box.heightPercent*300),6);
  expect(east.yPercent).toBeLessThan(box.yPercent);
  const free=resizeOverlay(box,'e',10,0);
  expect(free.heightPercent).toBeCloseTo(box.heightPercent,6);   // unlocked resize keeps the other axis
 });
 it('rotates from the pointer with an optional snap',()=>{
  const start=pointerAngle(50,50,100,50);            // pointer to the right, box upright
  expect(rotationFromPointer(50,50,50,100,0,start)).toBeCloseTo(90,6);      // dragged down = clockwise
  expect(rotationFromPointer(50,50,50,0,0,start)).toBeCloseTo(270,6);       // dragged up = anticlockwise
  expect(rotationFromPointer(50,50,52,95,0,start,15)).toBe(90);             // Shift snaps to 15°
  expect(rotationFromPointer(50,50,0,50,0,start)).toBeCloseTo(180,6);
  expect(rotationFromPointer(50,50,50+50*Math.cos(20*Math.PI/180),50+50*Math.sin(20*Math.PI/180),350,start)).toBeCloseTo(10,4); // wraps past 360
 });
});

describe('picture placements',()=>{
 const pages=[page('a'),page('b'),page('c')];
 const sheets=computeImpositionSheets(pages,layout(1,1,'none'));
 it('shows a current-page picture only on that page and honours scopes',()=>{
  const item=image({targetScope:'current',targetPageIds:['b']});
  expect(sheets.map(side=>imagePlacements(side,3,pages,[item]).length)).toEqual([0,1,0]);
  expect(sheets.map(side=>imagePlacements(side,3,pages,[{...item,targetScope:'odd' as const}]).length)).toEqual([1,0,1]);
  expect(sheets.map(side=>imagePlacements(side,3,pages,[{...item,targetScope:'even' as const}]).length)).toEqual([0,1,0]);
  expect(sheets.map(side=>imagePlacements(side,3,pages,[{...item,target:'sheet' as const,targetScope:'selected' as const,targetPageIds:[],targetSheetIndices:[2]}]).length)).toEqual([0,1,0]);
 });
 it('uses the page box for percentages and clips to the cell in a matrix',()=>{
  const side=computeImpositionSheets(pages,layout(2,1))[0];
  const [placement]=imagePlacements(side,2,pages,[image({xPercent:0,yPercent:0,widthPercent:100,heightPercent:50})]);
  expect(placement.x).toBeCloseTo(placement.parentX,6);
  expect(placement.width).toBeCloseTo(placement.parentWidth,6);
  expect(placement.clip).toBeDefined();
  expect(placement.key).toContain('i-');
 });
 it('repeats a picture on every occurrence of a step-and-repeat page',()=>{
  const repeated=computeImpositionSheets([page('a')],layout(2,2,'none','step-and-repeat'));
  expect(imagePlacements(repeated[0],repeated.length,[page('a')],[image()])).toHaveLength(4);
 });
 it('keeps text and pictures in one z-ordered list',()=>{
  const text:PageOverlayText={id:'t',kind:'text',target:'sheet',targetScope:'all',targetPageIds:[],targetSheetIndex:1,xPercent:10,yPercent:10,widthPercent:40,heightPercent:10,opacity:1,rotation:0,text:'hi',fontSize:12,fontFamily:'Arial',color:'#000',bold:false,italic:false,underline:false,align:'left'};
  const ordered=overlayPlacements(sheet1,2,pages,[text,image({id:'i'})]);
  expect(ordered[0].key).toBe('t-sheet-1');expect(ordered[1].key).toContain('i-');
  const flipped=overlayPlacements(sheet1,2,pages,[image({id:'i'}),text]);
  expect(flipped[0].key).toContain('i-');expect(flipped[1].key).toBe('t-sheet-1');
 });
 it('letterboxes only when asked',()=>{
  const box=imageDrawRect(image({naturalWidth:400,naturalHeight:200,fit:'fill'}),100,100);
  expect(box).toEqual({x:0,y:0,width:100,height:100});
  const contained=imageDrawRect(image({naturalWidth:400,naturalHeight:200,fit:'contain'}),100,100);
  expect(contained).toEqual({x:0,y:25,width:100,height:50});
  const tall=imageDrawRect(image({naturalWidth:100,naturalHeight:400,fit:'contain'}),100,100);
  expect(tall).toEqual({x:37.5,y:0,width:25,height:100});
  expect(imageDrawRect(image({naturalWidth:0,naturalHeight:0,fit:'contain'}),100,100)).toEqual({x:0,y:0,width:100,height:100});
 });
});
