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

export interface AspectFrame { /** Physical width/height of the box the percentages refer to. */ parentWidth:number; parentHeight:number }
const ratioOf=(g:Geometry,frame:AspectFrame)=>{
  const w=g.widthPercent*frame.parentWidth,h=g.heightPercent*frame.parentHeight;
  return h<=0?1:w/h;
};
/** Resizes while keeping the physical aspect ratio; the anchor edge/corner stays put. */
export function resizeOverlayKeepingAspect(g:Geometry,handle:OverlayHandle,dx:number,dy:number,frame:AspectFrame,minSizeMm=1):Geometry {
  const {parentWidth:pw,parentHeight:ph}=frame;
  const ratio=ratioOf(g,frame);
  if(!(ratio>0)||!Number.isFinite(ratio))return g;
  const left=g.xPercent,top=g.yPercent,right=left+g.widthPercent,bottom=top+g.heightPercent;
  const minW=Math.max(1,minSizeMm/pw*100),minH=Math.max(1,minSizeMm/ph*100);
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
  width=clamp(width,minW,100);height=clamp(height,minH,100);
  // Re-derive the second dimension after clamping so the ratio always survives the parent bounds.
  if(Math.abs(width/ratio*(pw/ph)-height)>1e-9){
    if(Math.abs(dx*pw)>=Math.abs(dy*ph))height=width/ratio*(pw/ph);else width=height*ratio*(ph/pw);
  }
  const anchorLeft=handle.includes('w')?right:handle.includes('e')?left:left+g.widthPercent/2;
  const anchorTop=handle.includes('n')?bottom:handle.includes('s')?top:top+g.heightPercent/2;
  let x=handle.includes('e')?anchorLeft:handle.includes('w')?anchorLeft-width:anchorLeft-width/2;
  let y=handle.includes('s')?anchorTop:handle.includes('n')?anchorTop-height:anchorTop-height/2;
  x=clamp(x,0,100-width);y=clamp(y,0,100-height);
  return {...g,xPercent:x,yPercent:y,widthPercent:width,heightPercent:height};
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
