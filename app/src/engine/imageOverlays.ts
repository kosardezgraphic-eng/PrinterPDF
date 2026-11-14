import type {ComputedSheetSide,PageOverlayImage} from '@shared/models';
import {rotateVector} from './pageGeometry';

export interface BoxMm {x:number;y:number;width:number;height:number}
export interface ImageDropPlacement {
  target:'page'|'sheet'; pageId?:string; sheetIndex:number;
  xPercent:number;yPercent:number;widthPercent:number;heightPercent:number;
}
/** A default box that keeps the picture's ratio and never covers more than `maxPercent` of the box. */
export function sizeImageToFit(naturalWidth:number,naturalHeight:number,box:BoxMm,maxPercent=45):{widthPercent:number;heightPercent:number}{
  const ratio=naturalWidth>0&&naturalHeight>0 ? naturalWidth/naturalHeight : 1;
  if(!(ratio>0)||!Number.isFinite(ratio))return {widthPercent:maxPercent,heightPercent:maxPercent};
  const boxAspect=box.width/box.height;
  if(ratio>=boxAspect)return {widthPercent:maxPercent,heightPercent:maxPercent*boxAspect/ratio};
  return {widthPercent:maxPercent*ratio/boxAspect,heightPercent:maxPercent};
}
/** Centres the requested size on a point and clamps it inside the box. */
export function placeImageInBox(point:{xMm:number;yMm:number},box:BoxMm,size:{widthPercent:number;heightPercent:number}):{xPercent:number;yPercent:number}{
  const widthMm=box.width*size.widthPercent/100,heightMm=box.height*size.heightPercent/100;
  const xPercent=((point.xMm-box.x)-widthMm/2)/box.width*100;
  const yPercent=((point.yMm-box.y)-heightMm/2)/box.height*100;
  return {xPercent:Math.max(0,Math.min(100-size.widthPercent,xPercent)),yPercent:Math.max(0,Math.min(100-size.heightPercent,yPercent))};
}
/** Sheet coordinates → the page box's own (unrotated) coordinates. */
export function sheetToBoxPoint(point:{xMm:number;yMm:number},box:BoxMm,rotationDeg:number):{xMm:number;yMm:number}{
  if(!rotationDeg)return point;
  const cx=box.x+box.width/2,cy=box.y+box.height/2;
  const local=rotateVector(point.xMm-cx,point.yMm-cy,-rotationDeg);
  return {xMm:cx+local.x,yMm:cy+local.y};
}
const pointInBox=(point:{xMm:number;yMm:number},box:BoxMm)=>point.xMm>=box.x&&point.xMm<=box.x+box.width&&point.yMm>=box.y&&point.yMm<=box.y+box.height;
/**
 * Maps a point on the sheet to a placement for a new picture overlay: the page box under the
 * cursor wins, the whole output sheet is the fallback, and anything outside the sheet is refused
 * (the caller then imports the file as its own document/page instead).
 */
export function imageDropPlacement(sheet:ComputedSheetSide,point:{xMm:number;yMm:number},natural:{width:number;height:number}):ImageDropPlacement|null{
  if(!pointInBox(point,{x:0,y:0,width:sheet.widthMm,height:sheet.heightMm}))return null;
  const cells=sheet.cells.filter(c=>c.page);
  for(const cell of cells){
    const box={x:cell.contentXMm,y:cell.contentYMm,width:cell.contentWidthMm,height:cell.contentHeightMm};
    const rotation=cell.transform?.rotationDeg??0;
    if(!pointInBox(sheetToBoxPoint(point,box,rotation),box))continue;
    const size=sizeImageToFit(natural.width,natural.height,box);
    const position=placeImageInBox(sheetToBoxPoint(point,box,rotation),box,size);
    return {target:'page',pageId:cell.page!.id,sheetIndex:sheet.sideIndex,...position,...size};
  }
  const box={x:0,y:0,width:sheet.widthMm,height:sheet.heightMm};
  const size=sizeImageToFit(natural.width,natural.height,box);
  const position=placeImageInBox(point,box,size);
  return {target:'sheet',sheetIndex:sheet.sideIndex,...position,...size};
}
export const newOverlayId=()=>globalThis.crypto?.randomUUID?.()??`image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
/** Defaults for a freshly dropped picture: locked ratio, full opacity, centre of the box. */
export function imageOverlayFromPlacement(id:string,src:string,name:string,natural:{width:number;height:number},placement:ImageDropPlacement):PageOverlayImage{
  // Like new text, a dropped picture starts on the page it was dropped on; widening is an explicit, reversible choice.
  return {id,kind:'image',target:placement.target,targetScope:'current',
    targetPageIds:placement.pageId?[placement.pageId]:[],targetSheetIndex:placement.sheetIndex,
    ...(placement.target==='sheet'?{targetSheetIndices:[placement.sheetIndex]}:{}),
    xPercent:placement.xPercent,yPercent:placement.yPercent,widthPercent:placement.widthPercent,heightPercent:placement.heightPercent,
    opacity:1,rotation:0,lockAspect:true,src,name,naturalWidth:natural.width,naturalHeight:natural.height,fit:'fill'};
}
