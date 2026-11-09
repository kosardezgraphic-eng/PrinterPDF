import type {OverlayBase} from '@shared/models';
export type OverlayHandle = 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w';
type Geometry = Pick<OverlayBase,'xPercent'|'yPercent'|'widthPercent'|'heightPercent'>;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
/** Deltas are measured in the target box, not screen pixels. */
export function moveOverlay(g:Geometry,dx:number,dy:number):Geometry {
  return {...g,xPercent:clamp(g.xPercent+dx,0,100-g.widthPercent),yPercent:clamp(g.yPercent+dy,0,100-g.heightPercent)};
}
export function resizeOverlay(g:Geometry,handle:OverlayHandle,dx:number,dy:number,minSize=1):Geometry {
  let left=g.xPercent, top=g.yPercent, right=left+g.widthPercent, bottom=top+g.heightPercent;
  if(handle.includes('w'))left=clamp(left+dx,0,right-minSize);
  if(handle.includes('e'))right=clamp(right+dx,left+minSize,100);
  if(handle.includes('n'))top=clamp(top+dy,0,bottom-minSize);
  if(handle.includes('s'))bottom=clamp(bottom+dy,top+minSize,100);
  return {xPercent:left,yPercent:top,widthPercent:right-left,heightPercent:bottom-top};
}
