import type {ComputedSheetSide, OverlayBase} from '@shared/models';
export type OverlayHandle = 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w';
type Geometry = Pick<OverlayBase,'xPercent'|'yPercent'|'widthPercent'|'heightPercent'>;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));

/**
 * How far an overlay may travel, in percent of the box its percentages are measured against.
 *
 * `maxX`/`maxY` are not always 100: a picture attached to a page is measured against the page's content
 * box but clipped by the whole cell, so the cell's far edge sits at some percent above 100 and the near
 * edge below 0. Those are the numbers that let an operator push a logo into the margin — or half off the
 * page, which is what a bleed looks like — without the app silently refusing the drag.
 */
export interface OverlayLimits { minX:number; minY:number; maxX:number; maxY:number }
/** The historical rule: the overlay's box stays inside the box it is measured against. */
export const BOX_LIMITS: OverlayLimits = {minX:0,minY:0,maxX:100,maxY:100};

/** The box the percentages refer to, and the area the overlay is clipped to — both in millimetres. */
export interface OverlayFrame {
  parentXMm:number; parentYMm:number; parentWidthMm:number; parentHeightMm:number;
  limitXMm:number; limitYMm:number; limitWidthMm:number; limitHeightMm:number;
}
/** Millimetre frame → percent limits. Non-positive parents fall back to the box rule instead of dividing by zero. */
export function overlayLimits(frame:OverlayFrame):OverlayLimits {
  if(!(frame.parentWidthMm>0)||!(frame.parentHeightMm>0))return BOX_LIMITS;
  const sx=100/frame.parentWidthMm,sy=100/frame.parentHeightMm;
  return {
    minX:(frame.limitXMm-frame.parentXMm)*sx,
    minY:(frame.limitYMm-frame.parentYMm)*sy,
    maxX:(frame.limitXMm+frame.limitWidthMm-frame.parentXMm)*sx,
    maxY:(frame.limitYMm+frame.limitHeightMm-frame.parentYMm)*sy,
  };
}
/**
 * Keeps the *centre* of the overlay inside the limits, which is what a drag wants: the box may hang over
 * any edge, but half of it always stays in the printable area, so a misplaced picture is still on screen
 * and grabbable rather than lost two millimetres past a margin.
 */
export function centreWithinLimits<T extends Geometry>(g:T,limits:OverlayLimits):T {
  const spanX=limits.maxX-limits.minX,spanY=limits.maxY-limits.minY;
  // An overlay wider than the limit area cannot have its centre inside *and* fit; then it is centred.
  const x=spanX<=g.widthPercent ? limits.minX+(spanX-g.widthPercent)/2
    : clamp(g.xPercent,limits.minX-g.widthPercent/2,limits.maxX-g.widthPercent/2);
  const y=spanY<=g.heightPercent ? limits.minY+(spanY-g.heightPercent)/2
    : clamp(g.yPercent,limits.minY-g.heightPercent/2,limits.maxY-g.heightPercent/2);
  return {...g,xPercent:x,yPercent:y};
}
/** A millimetre box: position of its top-left corner and its size. */
export interface BoxMm { x:number; y:number; width:number; height:number }
/**
 * The travel limits of an overlay measured against `box`, widened to whatever actually clips it.
 *
 * A page overlay is printed inside its cell, so the cell — not the narrower content box the percentages
 * are measured against — is the area it may enter; a sheet overlay, and a page whose cell allows overflow,
 * may use the whole sheet. One function for the three places that need the answer (the drag, the align
 * buttons, the millimetre fields of a side panel), because two rules is how "align left" and "drag left"
 * end up disagreeing about where left is.
 */
export function overlayLimitsForBox(
  box: BoxMm,
  clip: BoxMm | undefined,
  sheet: { width: number; height: number }
): OverlayLimits {
  const printable = clip ?? { x: 0, y: 0, width: sheet.width, height: sheet.height };
  return overlayLimits({
    parentXMm: box.x, parentYMm: box.y, parentWidthMm: box.width, parentHeightMm: box.height,
    limitXMm: printable.x, limitYMm: printable.y, limitWidthMm: printable.width, limitHeightMm: printable.height,
  });
}
/** Keeps the whole box inside the limits — the rule for resizing, where a handle should not escape. */
export function boxWithinLimits<T extends Geometry>(g:T,limits:OverlayLimits):T {
  const width=Math.min(g.widthPercent,Math.max(0,limits.maxX-limits.minX));
  const height=Math.min(g.heightPercent,Math.max(0,limits.maxY-limits.minY));
  return {...g,widthPercent:width,heightPercent:height,
    xPercent:clamp(g.xPercent,limits.minX,limits.maxX-width),
    yPercent:clamp(g.yPercent,limits.minY,limits.maxY-height)};
}
/**
 * Deltas are measured in the target box, not screen pixels. With `limits` the overlay may hang over the
 * edge of the box it is measured against, as far as its centre stays inside the area it is printed on.
 */
export function moveOverlay(g:Geometry,dx:number,dy:number,limits:OverlayLimits=BOX_LIMITS):Geometry {
  return centreWithinLimits({...g,xPercent:g.xPercent+dx,yPercent:g.yPercent+dy},limits);
}
export function resizeOverlay(g:Geometry,handle:OverlayHandle,dx:number,dy:number,minSize=1,limits:OverlayLimits=BOX_LIMITS):Geometry {
  let left=g.xPercent, top=g.yPercent, right=left+g.widthPercent, bottom=top+g.heightPercent;
  if(handle.includes('w'))left=clamp(left+dx,limits.minX,right-minSize);
  if(handle.includes('e'))right=clamp(right+dx,left+minSize,limits.maxX);
  if(handle.includes('n'))top=clamp(top+dy,limits.minY,bottom-minSize);
  if(handle.includes('s'))bottom=clamp(bottom+dy,top+minSize,limits.maxY);
  return boxWithinLimits({xPercent:left,yPercent:top,widthPercent:right-left,heightPercent:bottom-top},limits);
}

export interface AspectFrame { /** Physical width/height of the box the percentages refer to. */ parentWidth:number; parentHeight:number }
const ratioOf=(g:Geometry,frame:AspectFrame)=>{
  const w=g.widthPercent*frame.parentWidth,h=g.heightPercent*frame.parentHeight;
  return h<=0?1:w/h;
};
/** Resizes while keeping the physical aspect ratio; the anchor edge/corner stays put. */
export function resizeOverlayKeepingAspect(g:Geometry,handle:OverlayHandle,dx:number,dy:number,frame:AspectFrame,minSizeMm=1,limits:OverlayLimits=BOX_LIMITS):Geometry {
  const {parentWidth:pw,parentHeight:ph}=frame;
  const ratio=ratioOf(g,frame);
  if(!(ratio>0)||!Number.isFinite(ratio))return g;
  const left=g.xPercent,top=g.yPercent,right=left+g.widthPercent,bottom=top+g.heightPercent;
  const minW=Math.max(1,minSizeMm/pw*100),minH=Math.max(1,minSizeMm/ph*100);
  const maxW=Math.max(minW,limits.maxX-limits.minX),maxH=Math.max(minH,limits.maxY-limits.minY);
  let width=g.widthPercent,height=g.heightPercent;
  const stretch=(deltaW:number,deltaH:number)=>{
    // The axis moved further in millimetres drives the resize; the other one follows the ratio.
    if(Math.abs(deltaW*pw)>=Math.abs(deltaH*ph)){width=Math.max(minW,g.widthPercent+deltaW);height=width/ratio*(pw/ph);}
    else{height=Math.max(minH,g.heightPercent+deltaH);width=height*ratio*(ph/pw);}
  };
  if(handle==='e')stretch(dx,0);
  else if(handle==='w')stretch(-dx,0);
  else if(handle==='s')stretch(0,dy);
  else if(handle==='n')stretch(0,-dy);
  else stretch(handle.includes('e')?dx:-dx,handle.includes('s')?dy:-dy);
  width=clamp(width,minW,maxW);height=clamp(height,minH,maxH);
  // Re-derive the second dimension after clamping so the ratio always survives the parent bounds.
  if(Math.abs(width/ratio*(pw/ph)-height)>1e-9){
    if(Math.abs(dx*pw)>=Math.abs(dy*ph))height=width/ratio*(pw/ph);else width=height*ratio*(ph/pw);
  }
  const anchorLeft=handle.includes('w')?right:handle.includes('e')?left:left+g.widthPercent/2;
  const anchorTop=handle.includes('n')?bottom:handle.includes('s')?top:top+g.heightPercent/2;
  let x=handle.includes('e')?anchorLeft:handle.includes('w')?anchorLeft-width:anchorLeft-width/2;
  let y=handle.includes('s')?anchorTop:handle.includes('n')?anchorTop-height:anchorTop-height/2;
  x=clamp(x,limits.minX,limits.maxX-width);y=clamp(y,limits.minY,limits.maxY-height);
  return {...g,xPercent:x,yPercent:y,widthPercent:width,heightPercent:height};
}
/** What a side panel needs to know to show and set an overlay's millimetres. */
export interface OverlayPanelFrame {
  /** Millimetre size of the box the percentages are measured against. */
  boxWidthMm:number; boxHeightMm:number;
  /** How far the overlay may travel — the same numbers a drag obeys. */
  limits:OverlayLimits;
}
/**
 * The frame one overlay has on the current sheet, for the panels that edit it by number.
 *
 * A panel that invents its own box is how a field says `X = 0` and the shape sits 10 mm inside the page:
 * the box is the page's content area when the overlay is attached to a page, the output sheet when it is
 * attached to the sheet, and the travel limits are whatever actually clips it. A page that is not on this
 * sheet at all (a scope the operator narrowed a moment ago) falls back to the sheet box, because nothing
 * of it is drawn and the fields are only a description of the numbers in the store.
 */
export function overlayPanelFrame(
  sheet: ComputedSheetSide | undefined,
  item: { target: 'page' | 'sheet'; targetPageIds: string[] }
): OverlayPanelFrame {
  const sheetMm = { width: sheet?.widthMm ?? 210, height: sheet?.heightMm ?? 297 };
  const cell = item.target === 'page' ? sheet?.cells.find(candidate => candidate.page?.id === item.targetPageIds[0]) : undefined;
  const box: BoxMm = cell
    ? { x: cell.contentXMm, y: cell.contentYMm, width: cell.contentWidthMm, height: cell.contentHeightMm }
    : { x: 0, y: 0, width: sheetMm.width, height: sheetMm.height };
  const clip = cell && !cell.allowOverflow
    ? { x: cell.cellXMm, y: cell.cellYMm, width: cell.cellWidthMm, height: cell.cellHeightMm }
    : undefined;
  return { boxWidthMm: box.width, boxHeightMm: box.height, limits: overlayLimitsForBox(box, clip, sheetMm) };
}

/** Which edge or middle line of the box an overlay is being lined up with. */
export type OverlayAlignment = 'left'|'hcenter'|'right'|'top'|'vcenter'|'bottom';
/**
 * Lining an overlay up with the box it is measured against. The limits are the same ones a drag obeys, so
 * "align left" puts a shape against the same edge it can be dragged to — not against a narrower inner box
 * that the operator then has to fight with the mouse.
 */
export function alignOverlay(g:Geometry,align:OverlayAlignment,limits:OverlayLimits=BOX_LIMITS):Geometry {
  switch (align) {
    case 'left': return {...g,xPercent:limits.minX};
    case 'hcenter': return {...g,xPercent:(limits.minX+limits.maxX-g.widthPercent)/2};
    case 'right': return {...g,xPercent:limits.maxX-g.widthPercent};
    case 'top': return {...g,yPercent:limits.minY};
    case 'vcenter': return {...g,yPercent:(limits.minY+limits.maxY-g.heightPercent)/2};
    case 'bottom': return {...g,yPercent:limits.maxY-g.heightPercent};
  }
}

/** Rotation in degrees from a pointer position, relative to the box centre, snapped when asked. */
export function rotationFromPointer(centerX:number,centerY:number,x:number,y:number,startRotation:number,startAngle:number,snapDeg?:number):number{
  const angle=Math.atan2(y-centerY,x-centerX)*180/Math.PI;
  let next=startRotation+(angle-startAngle);
  if(snapDeg&&snapDeg>0)next=Math.round(next/snapDeg)*snapDeg;
  next=((next%360)+360)%360;
  return Math.round(next*10)/10;
}
export const pointerAngle=(centerX:number,centerY:number,x:number,y:number)=>Math.atan2(y-centerY,x-centerX)*180/Math.PI;
