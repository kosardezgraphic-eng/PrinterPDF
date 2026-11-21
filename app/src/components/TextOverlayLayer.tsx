import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {ComputedSheetSide,PageItem,PageOverlay,PageOverlayImage,PageOverlayShape,PageOverlayText} from '@shared/models';
import {drawOverlayText} from '../engine/textOverlays';
import {imageDrawRect,overlayPlacements,type OverlayPlacement} from '../engine/overlayPlacements';
import {centreWithinLimits,moveOverlay,overlayLimitsForBox,resizeOverlay,resizeOverlayKeepingAspect,rotationFromPointer,pointerAngle,type OverlayHandle,type OverlayLimits} from '../engine/overlayGeometry';
import {rotateVector} from '../engine/pageGeometry';
import type {EraseShape} from '@shared/models';
import {beginEraseShape,commitEraseShape,colorFromPixels,eraseMaskCss,erasePaintCss,eraseRegionIsSelected,eraseShapeIsMeaningful,eraseShapeParts,eraseToolPaints,growEraseShape} from '../engine/imageErase';
import {MM_PER_PT, SHAPE_NAMES, shapeCommands, shapeDashPattern, shapeHasFill, shapeIsStrokedOnly, shapeSvgPath} from '../engine/shapes';
import {useSmartGuides} from './SmartGuidesOverlay';
import {useAppStore} from '../store/useAppStore';
const MM_TO_PT=72/25.4;
const newId=()=>globalThis.crypto?.randomUUID?.()??`overlay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
/** The editable geometry lives on the overlay itself for every kind. */
const targetOf=(p:OverlayPlacement)=>'text' in p ? p.text : 'image' in p ? p.image : p.shape;

function TextCanvas({item,width,height,pxPerMm,thumbnailMode=false}:{item:PageOverlayText;width:number;height:number;pxPerMm:number;thumbnailMode?:boolean}) {
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  let canceled=false;
  const draw=()=>{if(canceled||!ref.current)return;const canvas=ref.current,dpr=thumbnailMode?Math.max(2,Math.min(3,window.devicePixelRatio||1)):Math.min(3,window.devicePixelRatio||1);
    canvas.width=Math.max(1,Math.ceil(width*pxPerMm*dpr));canvas.height=Math.max(1,Math.ceil(height*pxPerMm*dpr));
    const ctx=canvas.getContext('2d');if(ctx)drawOverlayText(ctx,item,canvas.width,canvas.height,pxPerMm*dpr/MM_TO_PT);
  };
  const family = item.fontFamily.replace(/["\\]/g, '').trim();
  if (document.fonts?.load && family) {
    try {
      void Promise.resolve(
        document.fonts.load(
          `${item.italic ? 'italic ' : ''}${item.bold ? 'bold' : 'normal'} 18px "${family}"`,
          item.text || 'اABC123'
        )
      ).then(draw, draw);
    } catch {
      draw();
    }
  } else {
    draw();
  }
  return ()=>{canceled=true;};
 },[item,width,height,pxPerMm]);
 return <canvas ref={ref} style={{width:'100%',height:'100%',display:'block',opacity:item.opacity}} aria-hidden="true"/>;
}
/** The box a picture paints in, in millimetres: what the eraser's percentages and the mask's viewBox share. */
function eraseSpaceOf(item:PageOverlayImage,widthMm:number,heightMm:number) {
 const rect=imageDrawRect(item,widthMm,heightMm);
 return {rect,box:{width:Math.max(0.0001,rect.width),height:Math.max(0.0001,rect.height),widthMm:Math.max(0.0001,rect.width),heightMm:Math.max(0.0001,rect.height)}};
}
/**
 * Pictures are shown unscaled-by-JavaScript: the browser scales the same mm box the exporter rasterizes.
 *
 * The eraser and the colour inversion are applied here as a mask and a filter, in the same millimetre space
 * `rasterizeOverlayImage` cuts the export bitmap in — the screen and the sheet therefore remove exactly the
 * same part of the same picture, which is the whole reason an erase is stored as geometry instead of pixels.
 */
/** A box that carries a picture: the props of the image branch of `overlayProps()`. */
interface PictureBox {image:PageOverlayImage;width:number;height:number}
/** The rectangle the artwork covers inside the box, in millimetres — the eraser's own space. */
function pictureRect(p:PictureBox) {
 return imageDrawRect((p as {image:PageOverlayImage}).image,p.width,p.height);
}
/** The same rectangle as percentages of the box, so a mark can be laid over the picture it belongs to. */
function pictureFit(p:PictureBox) {
 const rect=pictureRect(p),width=p.width,height=p.height;
 return rect.width>0&&rect.height>0
   ?{left:`${rect.x/width*100}%`,top:`${rect.y/height*100}%`,width:`${rect.width/width*100}%`,height:`${rect.height/height*100}%`}
   :{left:'0%',top:'0%',width:'100%',height:'100%'};
}
function ImagePicture({item,width,height,live}:{item:PageOverlayImage;width:number;height:number;live?:EraseShape|null}) {
 const {rect,box}=eraseSpaceOf(item,width,height);
 const fit=rect.width>0&&rect.height>0?{left:`${rect.x/width*100}%`,top:`${rect.y/height*100}%`,width:`${rect.width/width*100}%`,height:`${rect.height/height*100}%`}:{left:'0%',top:'0%',width:'100%',height:'100%'};
 // The stroke in progress is drawn *as the result*, not as a red band over it: while the button is held the
 // operator is looking for "did that spot go away", and an approximation there would be a second renderer.
 const shapes=live?[...(item.erase??[]),live]:(item.erase??[]);
 const mask=eraseMaskCss(shapes,box);
 const paint=erasePaintCss(shapes,box);
 const mirror=`scaleX(${item.flipHorizontal?-1:1}) scaleY(${item.flipVertical?-1:1})`;
 return <div style={{position:'absolute',...fit,transform:mirror,opacity:item.opacity,pointerEvents:'none',userSelect:'none'}}>
   <img src={item.src} alt={item.name} draggable={false} style={{position:'relative',display:'block',width:'100%',height:'100%',maxWidth:'100%',maxHeight:'100%',
     ...(item.invert?{filter:'invert(1)'}:{}),
     ...(mask?{maskImage:mask,WebkitMaskImage:mask,maskSize:'100% 100%',WebkitMaskSize:'100% 100%',maskRepeat:'no-repeat',WebkitMaskRepeat:'no-repeat'}:{})}}/>
   {/* Coloured strokes sit above the picture, each cut by the holes that came after it — the same order the
       exported raster keeps, so the screen and the sheet agree about the operator's own history. */}
   {paint && <div aria-hidden="true" data-image-paint style={{position:'absolute',inset:0,pointerEvents:'none',backgroundImage:paint,backgroundSize:'100% 100%',backgroundRepeat:'no-repeat'}}/>}
 </div>;
}

/**
 * What the eraser is eating while the pointer is still down: the pending gesture drawn in the same
 * millimetre space as the mask, in the red of "this will not be on the paper". No second renderer —
 * `eraseShapeParts` is the only geometry, so the band cannot drift away from what the release commits.
 */
/**
 * A region that has been drawn but not yet spent: a marching outline with the colour it would cut (or the
 * colour it would paint), because "drag a rectangle, press Delete" only reads as a tool if the rectangle waits
 * in plain sight in between.
 */
function EraseSelectionMark({shape,widthMm,heightMm}:{shape:EraseShape;widthMm:number;heightMm:number}) {
 const {rects}=eraseShapeParts(shape,{width:widthMm,height:heightMm,widthMm,heightMm});
 const stroke=shape.color??'#f87171';
 return <svg data-erase-selection aria-hidden="true" width="100%" height="100%" style={{position:'absolute',inset:0,pointerEvents:'none',overflow:'visible'}}
   viewBox={`0 0 ${widthMm} ${heightMm}`} preserveAspectRatio="none">
   <g fill={shape.color??'none'} fillOpacity={shape.color?0.35:0} stroke={stroke} strokeWidth="0.4" strokeDasharray="1.6 1.2">
     {rects.map((r,i)=><rect key={`r${i}`} x={r.x} y={r.y} width={r.width} height={r.height}/>)}
   </g>
 </svg>;
}
/**
 * A drawn shape in the preview. The path comes from the same `shapeCommands` the exported PDF turns into
 * vector operators, and the viewBox is in millimetres around the centre of the box, so the picture on the
 * screen and the ink on the sheet are the same numbers — not two drawings that drift apart.
 */
function ShapeGlyph({item,widthMm,heightMm}:{item:PageOverlayShape;widthMm:number;heightMm:number}) {
 const d=shapeSvgPath(shapeCommands(item,widthMm,heightMm));
 const lineWidth=Math.max(0,item.strokeWidth*MM_PER_PT);
 const dash=shapeDashPattern(item.strokeStyle,lineWidth);
 return <svg data-shape-glyph={item.type} width="100%" height="100%" aria-hidden="true"
   viewBox={`${-widthMm/2} ${-heightMm/2} ${widthMm} ${heightMm}`} preserveAspectRatio="none"
   style={{display:'block',overflow:'visible',opacity:item.opacity}}>
   <path d={d} fill={shapeHasFill(item)?item.fillColor:'none'} fillRule="nonzero"
     stroke={lineWidth>0?item.strokeColor:'none'} strokeWidth={lineWidth}
     strokeDasharray={dash?dash.join(' '):undefined}
     strokeLinecap={item.lineCap ?? (shapeIsStrokedOnly(item.type)?'round':'butt')} strokeLinejoin="round"/>
 </svg>;
}

const HANDLES: {id:OverlayHandle;left:string;top:string;cursor:string}[]=[
 {id:'nw',left:'0%',top:'0%',cursor:'nwse-resize'},{id:'n',left:'50%',top:'0%',cursor:'ns-resize'},
 {id:'ne',left:'100%',top:'0%',cursor:'nesw-resize'},{id:'e',left:'100%',top:'50%',cursor:'ew-resize'},
 {id:'se',left:'100%',top:'100%',cursor:'nwse-resize'},{id:'s',left:'50%',top:'100%',cursor:'ns-resize'},
 {id:'sw',left:'0%',top:'100%',cursor:'nesw-resize'},{id:'w',left:'0%',top:'50%',cursor:'ew-resize'}];
type Gesture={pointer:number;x:number;y:number;node:HTMLDivElement;visual:HTMLElement;copy:boolean;handle:OverlayHandle|'move'|'rotate';frame:number|null;dx:number;dy:number;
 startRotation:number;startAngle:number;centerX:number;centerY:number;lock?:boolean};
function OverlayOccurrence({p,pxPerMm,selected,enabled,sheetMm}:{p:OverlayPlacement;pxPerMm:number;selected:boolean;enabled:boolean;sheetMm:{width:number;height:number}}){
 const item=targetOf(p);
 const smartGuides=useSmartGuides();
 const smartGuidesRef=useRef(smartGuides);
 smartGuidesRef.current=smartGuides;
 const select=useAppStore(s=>s.selectOverlay),update=useAppStore(s=>s.updateOverlay),add=useAppStore(s=>s.addOverlay),beginEdit=useAppStore(s=>s.beginTextEdit);
 const edit=useAppStore(s=>s.textEdit?.occurrenceKey===p.key?s.textEdit:null);
 const textarea=useRef<HTMLTextAreaElement>(null);
 const mounted=useRef(false);
 const gesture=useRef<Gesture|null>(null);
 const isImage='image' in p;
 const isShape='shape' in p;
 const eraseTool=useAppStore(s=>s.eraseTool);
 const eraseBrushMm=useAppStore(s=>s.eraseBrushMm);
 const eraseColor=useAppStore(s=>s.eraseColor);
 const setEraseColor=useAppStore(s=>s.setEraseColor);
 const setErasePending=useAppStore(s=>s.setErasePending);
 /** The marquee this picture is holding, if the region tool left one. */
 const pending=useAppStore(s=>s.erasePending&&s.erasePending.overlayId===item.id?s.erasePending.shape:null);
 /** The gesture under the pointer, kept out of the store until it is finished. */
 const [liveErase,setLiveErase]=useState<EraseShape|null>(null);
 const erase=useRef<{pointer:number;anchor:{x:number;y:number};shape:EraseShape}|null>(null);
 const ring=useRef<HTMLDivElement>(null);
 const ringAt=useRef<{x:number;y:number}|null>(null);
 // A locked layer or an open text edit keeps the pointer: the eraser paints on the picture, and nowhere else.
 const eraseActive=!!isImage && !!enabled && !edit && eraseTool!=='off';
 const erasing=eraseActive && eraseToolPaints(eraseTool);
 // A brush is applied as it is drawn, so its live gesture goes straight into the picture's own layers. A region
 // is only *selected* until `Delete`, so its live outline is the marching rectangle — the same mark it keeps
 // waiting with, which is what tells the operator the rectangle has not been spent yet.
 const liveBrush=liveErase&&liveErase.mode==='brush'?liveErase:null;
 const selection=liveErase&&eraseRegionIsSelected(liveErase)?liveErase:pending;
 /**
  * A client point → percent of the picture **as it is painted**, not of the box around it, so a `contain`
  * letterbox cannot make the hole land somewhere other than under the cursor. A mirrored picture is flipped
  * back here because the mask is applied before the CSS transform — the hole must follow the artwork, and
  * the artwork is on the other side of the mirror.
  */
 const erasePoint=(node:HTMLElement,clientX:number,clientY:number)=>{
   const img=node.querySelector('img')?.getBoundingClientRect()??node.getBoundingClientRect();
   const image=(p as {image:PageOverlayImage}).image;
   let x=(clientX-img.left)/Math.max(1,img.width)*100, y=(clientY-img.top)/Math.max(1,img.height)*100;
   if(image.flipHorizontal)x=100-x;
   if(image.flipVertical)y=100-y;
   return {x,y};
 };
 /** The ring that replaces the arrow while the brush is armed — the cursor *is* the brush, at its size. */
 const moveRing=(node:HTMLElement,clientX:number,clientY:number)=>{
   const box=node.getBoundingClientRect();
   const x=clientX-box.left,y=clientY-box.top;
   ringAt.current={x,y};
   // The follow itself is a direct style write, not a state update: a pointermove arrives far faster than a
   // frame, and re-rendering the layer per event would make the cursor lag behind the hand.
   const el=ring.current;if(el){el.style.left=`${x}px`;el.style.top=`${y}px`;}
 };
 const hideRing=()=>{ringAt.current=null;const el=ring.current;if(el){el.style.left='-9999px';el.style.top='-9999px';}};
 /**
  * The eyedropper: the colour of the artwork under the pointer, taken from the same pixels the picture is
  * drawn from (and negated when the picture is displayed inverted, because the operator picks what they see).
  * An empty spot has no colour to take, and the panel says so instead of inventing white.
  */
 const pickColour=async(node:HTMLElement,clientX:number,clientY:number)=>{
   const image=(p as {image:PageOverlayImage}).image;
   const at=erasePoint(node,clientX,clientY);
   const img=node.querySelector('img');
   if(typeof document==='undefined'||!img||!(image.naturalWidth>0)||!(image.naturalHeight>0)){
     useAppStore.getState().addToast({type:'warning',title:useAppStore.getState().settings.language==='fa'
       ?'این مرورگر نمی‌تواند رنگ پیکسل‌ها را بخواند؛ رنگ را دستی انتخاب کنید.'
       :'This browser cannot read the picture’s pixels; pick the colour by hand instead.'});
     return;
   }
   const canvas=document.createElement('canvas');
   canvas.width=Math.max(1,Math.round(image.naturalWidth));canvas.height=Math.max(1,Math.round(image.naturalHeight));
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   if(!ctx){
     useAppStore.getState().addToast({type:'warning',title:useAppStore.getState().settings.language==='fa'
       ?'خواندن رنگ تصویر به Canvas 2D نیاز دارد؛ رنگ را دستی انتخاب کنید.'
       :'Sampling the picture needs a Canvas 2D context; pick the colour by hand instead.'});
     return;
   }
   ctx.drawImage(img,0,0,canvas.width,canvas.height);
   // The area sampled is the brush's own footprint, at the file's scale — not one pixel. A click on a JPEG
   // logo or an anti-aliased edge would otherwise pick a single noise pixel and paint a patch that does not
   // match the surroundings it came from.
   const {rect}=eraseSpaceOf(image,p.width,p.height);
   const radius=Math.max(0,Math.min(16,Math.round(rect.width>0?(eraseBrushMm/2)*(canvas.width/rect.width):0)));
   const cx=Math.floor(at.x/100*canvas.width),cy=Math.floor(at.y/100*canvas.height);
   const x0=Math.max(0,cx-radius),y0=Math.max(0,cy-radius);
   const w=Math.min(canvas.width-x0,radius*2+1),h=Math.min(canvas.height-y0,radius*2+1);
   const data=ctx.getImageData(x0,y0,w,h).data;
   const color=colorFromPixels(data,w,cx-x0,cy-y0,{invert:!!image.invert,radius});
   if(!color){
     useAppStore.getState().addToast({type:'info',title:useAppStore.getState().settings.language==='fa'
       ?'آن نقطه از تصویر خالی است؛ رنگی برای برداشتن وجود ندارد.'
       :'That spot of the picture is empty — there is no colour to take from it.'});
     return;
   }
   setEraseColor(color);
   useAppStore.getState().setEraseTool('brush');
 };
 /** Images and text are free by default; page numbers keep their ratio unless Shift is held. */
 const lockedDefault=item.lockAspect ?? item.kind==='numbering';
 /**
  * How far the box may travel. A page overlay is clipped by its cell, so the cell — not the narrower
  * content box the percentages refer to — is the limit; a sheet overlay (and a page whose cell allows
  * overflow) is limited by the sheet. Everything inside it is printable, so a picture can be pushed into
  * the margin or over one edge for a bleed, and only its centre must stay on the page.
  */
 const limits:OverlayLimits = overlayLimitsForBox(
   {x:p.parentX,y:p.parentY,width:p.parentWidth,height:p.parentHeight},p.clip,sheetMm);
 const cleanup=(g:Gesture)=>{if(g.frame!==null)cancelAnimationFrame(g.frame);g.node.style.cursor='move';
  if(g.visual!==g.node)g.visual.remove();
  else{g.node.style.left=`${item.xPercent}%`;g.node.style.top=`${item.yPercent}%`;g.node.style.width=`${item.widthPercent}%`;g.node.style.height=`${item.heightPercent}%`;g.node.style.transform=`rotate(${item.rotation}deg)`;}
  gesture.current=null;smartGuidesRef.current?.clearGuides();};
 useEffect(()=>{const cancel=()=>{if(gesture.current)cleanup(gesture.current);
  // An erase that was never released must not be left hanging on the screen, and must not be committed either.
  if(erase.current){erase.current=null;setLiveErase(null);}};
 // `Delete` on a waiting marquee is a global key (the app owns it), but throwing the marquee away is this
 // layer's business, because it is this layer that drew it.
 const key=(e:KeyboardEvent)=>{if(e.key!=='Escape')return;cancel();if(useAppStore.getState().erasePending?.overlayId===item.id)useAppStore.getState().setErasePending(null);};window.addEventListener('blur',cancel);window.addEventListener('keydown',key);return()=>{window.removeEventListener('blur',cancel);window.removeEventListener('keydown',key);cancel();};},[item.id,p.parentWidth,p.parentHeight,p.parentRotation,pxPerMm,enabled]);
 useLayoutEffect(()=>{if(edit&&textarea.current){textarea.current.focus();textarea.current.setSelectionRange(edit.selectionStart,edit.selectionEnd);}},[!!edit]);
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;const pending=useAppStore.getState().textEdit;
  if(pending?.occurrenceKey===p.key)queueMicrotask(()=>{if(!mounted.current && useAppStore.getState().textEdit===pending)useAppStore.getState().finishTextEdit();});};},[p.key]);
 const geometry=(g:Gesture)=>{
  const angle=p.parentRotation+(g.handle==='move'?0:item.rotation);
  const delta=rotateVector(g.dx,g.dy,-angle),pw=p.parentWidth*pxPerMm,ph=p.parentHeight*pxPerMm;
  if(g.handle==='move')return moveOverlay(item,delta.x/pw*100,delta.y/ph*100,limits);
  const handle=g.handle as OverlayHandle;
  const next=(g.lock ?? lockedDefault)
    ? resizeOverlayKeepingAspect(item,handle,delta.x/pw*100,delta.y/ph*100,{parentWidth:p.parentWidth,parentHeight:p.parentHeight},1,limits)
    : resizeOverlay(item,handle,delta.x/pw*100,delta.y/ph*100,1,limits);
  const dx=((next.xPercent+next.widthPercent/2)-(item.xPercent+item.widthPercent/2))*pw/100;
  const dy=((next.yPercent+next.heightPercent/2)-(item.yPercent+item.heightPercent/2))*ph/100;
  const shifted=rotateVector(dx,dy,item.rotation);
  // A rotated box grows its bounding rect, so the centre is moved back and re-clamped rather than the corners.
  return centreWithinLimits({...next,
   xPercent:item.xPercent+item.widthPercent/2+shifted.x/pw*100-next.widthPercent/2,
   yPercent:item.yPercent+item.heightPercent/2+shifted.y/ph*100-next.heightPercent/2},limits);
 };
 const snapGeometry=(g:Gesture,commit:boolean)=>{
  const next=geometry(g);
  const sg=smartGuidesRef.current;
  if(!sg||g.handle==='rotate'||Math.abs(p.parentRotation)>0.5||Math.abs(item.rotation)>0.5||p.parentWidth<=0||p.parentHeight<=0)return next;
  const rectMm={
   x:p.parentX+(p.parentWidth*next.xPercent)/100,
   y:p.parentY+(p.parentHeight*next.yPercent)/100,
   width:(p.parentWidth*next.widthPercent)/100,
   height:(p.parentHeight*next.heightPercent)/100,
  };
  const snapped=sg.applySnap({
   rectMm,
   mode:g.handle==='move'?'move':'resize',
   resizeHandle:g.handle==='move'?undefined:(g.handle as OverlayHandle),
   keepAspect:!!(g.lock??lockedDefault),
   excludeId:`overlay:${item.id}`,
   commit,
  });
  const adjusted={
   xPercent:((snapped.rectMm.x-p.parentX)/p.parentWidth)*100,
   yPercent:((snapped.rectMm.y-p.parentY)/p.parentHeight)*100,
   widthPercent:Math.max(1,(snapped.rectMm.width/p.parentWidth)*100),
   heightPercent:Math.max(1,(snapped.rectMm.height/p.parentHeight)*100),
  };
  return centreWithinLimits(adjusted,limits);
 };
 const paint=(g:Gesture)=>{
  if(g.handle==='rotate'){smartGuidesRef.current?.clearGuides();g.node.style.transform=`rotate(${rotationFromPointer(g.centerX,g.centerY,g.x+g.dx,g.y+g.dy,g.startRotation,g.startAngle,g.lock?15:undefined)}deg)`;return;}
  const next=snapGeometry(g,false);g.visual.style.left=`${next.xPercent}%`;g.visual.style.top=`${next.yPercent}%`;g.visual.style.width=`${next.widthPercent}%`;g.visual.style.height=`${next.heightPercent}%`;
 };
 const ensureCopy=(g:Gesture)=>{if(!g.copy||g.visual!==g.node||Math.hypot(g.dx,g.dy)<3)return;
  const clone=g.node.cloneNode(true) as HTMLElement;const src=g.node.querySelector('canvas,img'),dest=clone.querySelector('canvas,img');
  if(src&&dest instanceof HTMLCanvasElement&&src instanceof HTMLCanvasElement){dest.width=src.width;dest.height=src.height;dest.getContext('2d')?.drawImage(src,0,0);}
  clone.style.pointerEvents='none';clone.style.outline='2px solid #0ea5e9';clone.removeAttribute('data-overlay-id');g.node.parentElement?.appendChild(clone);g.visual=clone;
 };
 const activate=()=>{if(p.pageId)useAppStore.setState({activePageId:p.pageId,activeSheetIndex:p.sheetIndex-1});};
 const start=(e:React.PointerEvent<HTMLElement>,handle:OverlayHandle|'move'|'rotate')=>{
  if(!enabled||edit||gesture.current||(e.pointerType==='mouse'&&e.button!==0))return;
  const node=e.currentTarget.closest<HTMLDivElement>('[data-overlay-id]');if(!node)return;
  e.preventDefault();e.stopPropagation();activate();select(item.id);
  const box=node.getBoundingClientRect();
  node.style.cursor=(handle==='move'&&(e.ctrlKey||e.metaKey))?'copy':handle==='rotate'?'grab':'move';
  gesture.current={pointer:e.pointerId,x:e.clientX,y:e.clientY,node,visual:node,copy:handle==='move'&&(e.ctrlKey||e.metaKey),handle,frame:null,dx:0,dy:0,
    startRotation:item.rotation,startAngle:pointerAngle(box.left+box.width/2,box.top+box.height/2,e.clientX,e.clientY),centerX:box.left+box.width/2,centerY:box.top+box.height/2,
    lock:handle==='rotate'?e.shiftKey:e.shiftKey?!lockedDefault:lockedDefault};
  e.currentTarget.setPointerCapture(e.pointerId);
 };
 const eraseStart=(e:React.PointerEvent<HTMLElement>)=>{
  if(!eraseActive||e.pointerType==='mouse'&&e.button!==0)return;
  e.preventDefault();e.stopPropagation();activate();select(item.id);
  if(eraseTool==='picker'){void pickColour(e.currentTarget,e.clientX,e.clientY);return;}
  const at=erasePoint(e.currentTarget,e.clientX,e.clientY);
  const shape=beginEraseShape(eraseTool==='region'?'region':'brush',at,eraseBrushMm/2,eraseTool==='brush'?eraseColor:null);
  erase.current={pointer:e.pointerId,anchor:at,shape};setLiveErase(shape);setErasePending(null);
  moveRing(e.currentTarget,e.clientX,e.clientY);
  e.currentTarget.setPointerCapture(e.pointerId);
 };
 const eraseMove=(e:React.PointerEvent<HTMLElement>)=>{
  moveRing(e.currentTarget,e.clientX,e.clientY);
  const g=erase.current;if(!g||g.pointer!==e.pointerId)return;
  e.preventDefault();e.stopPropagation();
  // The box is the part of the picture the eye sees: the brush's own diameter (in millimetres) is compared with it
  // to decide whether two samples already touch, which is what keeps a fast drag one stroke instead of a dotted line.
  const {box:eraseBox}=eraseSpaceOf((p as {image:PageOverlayImage}).image,p.width,p.height);
  const next=growEraseShape(g.shape,g.anchor,erasePoint(e.currentTarget,e.clientX,e.clientY),eraseBox);
  if(next!==g.shape){g.shape=next;setLiveErase(next);}
 };
 const eraseFinish=(e:React.PointerEvent<HTMLElement>,cancel=false)=>{
  const g=erase.current;if(!g||g.pointer!==e.pointerId)return;
  e.preventDefault();e.stopPropagation();erase.current=null;setLiveErase(null);hideRing();
  if(cancel)return;
  // A press without travel is a click on the layer, not a hole in the artwork; and the whole stroke lands in
  // the store in one go, so `Ctrl+Z` gives back a gesture rather than a third of one.
  if(!eraseShapeIsMeaningful(g.shape))return;
  // The list is read from the store, not from the placement this render was built with: two pointers on the
  // same picture (or a panel button pressed mid-drag) must not silently drop the stroke that landed first.
  if(g.shape.mode==='region'){setErasePending({overlayId:item.id,shape:g.shape});return;}
  const live=useAppStore.getState().overlays.find(o=>o.id===item.id) as PageOverlayImage|undefined;
  if(!live)return;
  useAppStore.getState().setOverlayErase(item.id,commitEraseShape(live.erase,g.shape));
 };
 const move=(e:React.PointerEvent<HTMLElement>)=>{const g=gesture.current;if(!g){if(enabled&&e.currentTarget instanceof HTMLDivElement)e.currentTarget.style.cursor=eraseActive?'crosshair':e.ctrlKey||e.metaKey?'copy':'move';return;}
  if(g.pointer!==e.pointerId)return;e.preventDefault();e.stopPropagation();g.dx=e.clientX-g.x;g.dy=e.clientY-g.y;
  if(g.handle!=='rotate')g.lock=e.shiftKey?!lockedDefault:lockedDefault;else g.lock=e.shiftKey;
  ensureCopy(g);if(g.frame===null)g.frame=requestAnimationFrame(()=>{g.frame=null;if(gesture.current===g)paint(g);});};
 const finish=(e:React.PointerEvent<HTMLElement>,cancel=false)=>{const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;
  e.preventDefault();e.stopPropagation();g.dx=e.clientX-g.x;g.dy=e.clientY-g.y;
  const moved=Math.hypot(g.dx,g.dy)>=3;
  const patch:Partial<PageOverlay>=g.handle==='rotate'
    ? {rotation:rotationFromPointer(g.centerX,g.centerY,g.x+g.dx,g.y+g.dy,g.startRotation,g.startAngle,g.lock?15:undefined)}
    : snapGeometry(g,true);
  cleanup(g);if(cancel||!moved)return;
  const live=useAppStore.getState().overlays.find(o=>o.id===item.id);if(!live || live!==item)return;
  if(g.copy)add({...item,...patch,id:newId()} as PageOverlay);else update(item.id,patch);
 };
 const lang=useAppStore(s=>s.settings.language);
 const editable=!isImage && item.kind==='text' ? item as PageOverlayText : null;
 const label=isImage?(p as {image:PageOverlayImage}).image.name:isShape?(lang==='fa'?SHAPE_NAMES[(p as {shape:PageOverlayShape}).shape.type][0]:SHAPE_NAMES[(p as {shape:PageOverlayShape}).shape.type][1]):('renderText' in p ? p.renderText.text : '')||(lang==='fa'?'نوشته':'Overlay');
 return <div data-overlay-id={item.id} role="button" tabIndex={enabled?0:-1} aria-label={label || (lang==='fa'?'لایه':'Overlay')}
   onDoubleClick={e=>{if(!enabled)return;e.stopPropagation();activate();if(editable)beginEdit(item.id,p.key);else{select(item.id);const el=document.querySelector<HTMLTextAreaElement>('[data-numbering-template],[data-image-source],[data-shape-fill]');if(el){el.focus();el.select();}}}}
   onKeyDown={e=>{if(!enabled)return;
   const arrows:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
   const step=arrows[e.key];
   if(step){e.preventDefault();e.stopPropagation();activate();
     // One millimetre on the sheet, five with Shift; the delta is rotated back into the parent box's own axes.
     const mm=(e.shiftKey?5:1),delta=rotateVector(step[0]*mm*pxPerMm,step[1]*mm*pxPerMm,-(p.parentRotation+item.rotation));
     update(item.id,moveOverlay(item,delta.x/(p.parentWidth*pxPerMm)*100,delta.y/(p.parentHeight*pxPerMm)*100,limits));return;}
   if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();activate();if(editable)beginEdit(item.id,p.key);else select(item.id);}}}
   // The ring is the cursor, so it has to be where the pointer is the moment the pointer arrives — not only
   // after the first move. It stays on while a gesture holds the pointer, even outside the box: that stroke is
   // still drawing, and a cursor that vanishes mid-drag reads as a dropped gesture.
   onPointerEnter={e=>{if(erasing&&!erase.current)moveRing(e.currentTarget,e.clientX,e.clientY);}}
   onPointerLeave={()=>{if(erasing&&!erase.current)hideRing();}}
   onPointerDown={e=>{if(erase.current)return;if(eraseActive){eraseStart(e);return;}if(!edit)start(e,'move');}} onPointerMove={e=>{if(eraseActive&&!edit)moveRing(e.currentTarget,e.clientX,e.clientY);if(erase.current){eraseMove(e);return;}move(e);}} onPointerUp={e=>{if(erase.current){eraseFinish(e);return;}finish(e);}} onPointerCancel={e=>{if(erase.current){eraseFinish(e,true);return;}finish(e,true);}} onLostPointerCapture={e=>{if(erase.current){eraseFinish(e,true);return;}finish(e,true);}} onClick={e=>e.stopPropagation()}
   style={{position:'absolute',left:`${item.xPercent}%`,top:`${item.yPercent}%`,width:`${item.widthPercent}%`,height:`${item.heightPercent}%`,transform:`rotate(${item.rotation}deg)`,outline:erasing?'1px dashed #f87171':selected?'2px solid #0ea5e9':'none',cursor:eraseActive?(eraseTool==='brush'?'none':eraseTool==='picker'?'copy':'crosshair'):enabled?'move':'default',touchAction:'none',pointerEvents:enabled?'auto':'none'}}>
   {!edit && (isImage
     ? <ImagePicture item={(p as {image:PageOverlayImage}).image} width={p.width} height={p.height} live={liveBrush}/>
     : isShape
       ? <ShapeGlyph item={(p as {shape:PageOverlayShape}).shape} widthMm={p.width} heightMm={p.height}/>
       : <TextCanvas item={(p as {renderText:PageOverlayText}).renderText} width={p.width} height={p.height} pxPerMm={pxPerMm}/>)}
   {isImage && eraseTool==='brush' && enabled && !edit && <div ref={ring} data-brush-cursor aria-hidden="true" style={{position:'absolute',
     // The last position the pointer was seen at is kept in a ref *and* rendered from it, so a re-render in the
     // middle of a stroke — which is what committing one is — cannot blink the cursor back to nowhere.
     left:`${ringAt.current?.x??-9999}px`,top:`${ringAt.current?.y??-9999}px`,width:`${eraseBrushMm*pxPerMm}px`,height:`${eraseBrushMm*pxPerMm}px`,transform:'translate(-50%,-50%)',borderRadius:'50%',pointerEvents:'none',border:`1px solid ${eraseColor??'#f87171'}`,boxShadow:'0 0 0 1px rgba(15,23,42,0.55)',background:eraseColor?`${eraseColor}80`:'transparent'}}/>}
   {isImage && eraseRegionIsSelected(selection) && <div style={{position:'absolute',...pictureFit(p)}}><EraseSelectionMark shape={selection} widthMm={pictureRect(p).width} heightMm={pictureRect(p).height}/></div>}
   {'formulaError' in p && p.formulaError && !edit && <span role="alert" className="absolute bottom-full left-0 whitespace-nowrap bg-red-800 px-1 text-white">{lang==='fa'?'فرمول نامعتبر':'Invalid formula'}</span>}
   {edit && editable && <textarea ref={textarea} data-inline-overlay-editor aria-label={lang==='fa'?'ویرایش متن روی صفحه':'Edit text on page'} value={edit.text}
      wrap="off" spellCheck={false} dir={/[\u0590-\u08ff]/.test(edit.text)?'rtl':'ltr'}
      onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}
      onChange={e=>useAppStore.getState().updateTextDraft(e.target.value,e.target.selectionStart,e.target.selectionEnd)}
      onSelect={e=>useAppStore.getState().selectTextDraft(e.currentTarget.selectionStart,e.currentTarget.selectionEnd)}
      onKeyDown={e=>{e.stopPropagation();if(e.nativeEvent.isComposing)return;if(e.key==='Escape'){e.preventDefault();useAppStore.getState().finishTextEdit(true);}else if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();useAppStore.getState().finishTextEdit();}}}
      onBlur={e=>{const related=e.relatedTarget instanceof Element?e.relatedTarget:null;if(!related?.closest('[data-text-control-panel]'))useAppStore.getState().finishTextEdit();}}
      style={{width:'100%',height:'100%',resize:'none',border:0,padding:0,margin:0,outline:'none',overflow:'auto',background:editable.backgroundColor||'transparent',color:editable.color,
        fontFamily:`"${editable.fontFamily}", sans-serif`,fontWeight:editable.bold?'bold':'normal',fontStyle:editable.italic?'italic':'normal',textDecoration:editable.underline?'underline':'none',
        textAlign:editable.align,fontSize:editable.fontSize*pxPerMm/MM_TO_PT,lineHeight:editable.lineHeight??1.25,wordSpacing:`${(editable.wordSpacingPt??0)*pxPerMm/MM_TO_PT}px`,letterSpacing:`${(editable.letterSpacingPt??0)*pxPerMm/MM_TO_PT}px`,opacity:editable.opacity,touchAction:'auto'}} />}
   {selected && enabled && !edit && HANDLES.map(h=><button key={h.id} type="button" aria-label={`${isImage?(lang==='fa'?'تغییر اندازه تصویر':'Resize image'):isShape?(lang==='fa'?'تغییر اندازه شکل':'Resize shape'):item.kind==='numbering'?(lang==='fa'?'تغییر اندازه شماره':'Resize number'):(lang==='fa'?'تغییر اندازه متن':'Resize text')} ${h.id}`} data-text-resize={h.id}
      onPointerDown={e=>start(e,h.id)} onClick={e=>e.stopPropagation()} style={{position:'absolute',left:h.left,top:h.top,transform:'translate(-50%,-50%)',cursor:h.cursor,touchAction:'none'}}
      className="flex h-6 w-6 items-center justify-center"><span className="h-2.5 w-2.5 border border-white bg-sky-600"/></button>)}
   {selected && enabled && !edit && <button type="button" aria-label={lang==='fa'?'چرخش':'Rotate'} data-text-rotate
      title={lang==='fa'?'برای چرخش آزاد بکشید؛ Shift گام ۱۵ درجه است.':'Drag to rotate; Shift snaps to 15°.'}
      onPointerDown={e=>start(e,'rotate')} onClick={e=>e.stopPropagation()}
      style={{position:'absolute',left:'50%',top:'-24px',transform:'translate(-50%,-50%)',cursor:'grab',touchAction:'none'}}
      className="flex h-6 w-6 items-center justify-center rounded-full border border-white bg-sky-700"/>}
 </div>;
}
function ThumbnailOverlayOccurrence({p,pxPerMm}:{p:OverlayPlacement;pxPerMm:number}){
 const item=targetOf(p);
 const isImage='image' in p;
 const isShape='shape' in p;
 return <div aria-hidden="true" style={{position:'absolute',left:`${item.xPercent}%`,top:`${item.yPercent}%`,width:`${item.widthPercent}%`,height:`${item.heightPercent}%`,transform:`rotate(${item.rotation}deg)`,pointerEvents:'none'}}>
  {isImage
    ? <ImagePicture item={(p as {image:PageOverlayImage}).image} width={p.width} height={p.height}/>
    : isShape
      ? <ShapeGlyph item={(p as {shape:PageOverlayShape}).shape} widthMm={p.width} heightMm={p.height}/>
      : <TextCanvas item={(p as {renderText:PageOverlayText}).renderText} width={p.width} height={p.height} pxPerMm={pxPerMm} thumbnailMode/>}
 </div>;
}
export function TextOverlayLayer({sheet,totalSheets,pages,pageIndices,pxPerMm,enabled,previewOnly=false,thumbnailMode=false,thumbnailPageId,thumbnailOccurrenceKey}:{sheet:ComputedSheetSide;totalSheets:number;pages:PageItem[];pageIndices:Map<string,number>;pxPerMm:number;enabled:boolean;previewOnly?:boolean;thumbnailMode?:boolean;thumbnailPageId?:string;thumbnailOccurrenceKey?:string}){
 const overlays=useAppStore(s=>s.overlays),selected=useAppStore(s=>s.selectedOverlayId),textEdit=useAppStore(s=>s.textEdit);
 const effectiveOverlays=useMemo(()=>{
  if(!thumbnailMode||!textEdit)return overlays;
  return overlays.map(o=>o.kind==='text'&&o.id===textEdit.overlayId?{...o,text:textEdit.text,scriptRanges:textEdit.ranges}:o);
 },[overlays,thumbnailMode,textEdit]);
 const rawPlacements=overlayPlacements(sheet,totalSheets,pages,effectiveOverlays,pageIndices);
 const placements=useMemo(()=>{
  if(!thumbnailMode||(!thumbnailPageId&&!thumbnailOccurrenceKey))return rawPlacements;
  return rawPlacements.filter(p=>{
   if(!p.pageId)return true;
   if(thumbnailOccurrenceKey)return p.key.endsWith(`-${thumbnailOccurrenceKey}`);
   return p.pageId===thumbnailPageId;
  });
 },[rawPlacements,thumbnailMode,thumbnailPageId,thumbnailOccurrenceKey]);
 const sheetMm={width:sheet.widthMm,height:sheet.heightMm};
 return <div className="pointer-events-none absolute inset-0 z-10">{placements.map(p=>{
  const item=targetOf(p);
  const c=p.clip;
  const clip=c?`inset(${c.y*pxPerMm}px ${Math.max(0,(sheet.widthMm-c.x-c.width)*pxPerMm)}px ${Math.max(0,(sheet.heightMm-c.y-c.height)*pxPerMm)}px ${c.x*pxPerMm}px)`:undefined;
  return <div key={p.key} className="pointer-events-none absolute inset-0" style={{clipPath:clip}}>
    <div className="pointer-events-none absolute" style={{left:p.parentX*pxPerMm,top:p.parentY*pxPerMm,width:p.parentWidth*pxPerMm,height:p.parentHeight*pxPerMm,transform:`rotate(${p.parentRotation}deg)`}}>
      {thumbnailMode
        ? <ThumbnailOverlayOccurrence p={p} pxPerMm={pxPerMm}/>
        : <OverlayOccurrence p={p} pxPerMm={pxPerMm} sheetMm={sheetMm} selected={selected===item.id} enabled={enabled && (!previewOnly || item.target!=='sheet')}/>}
    </div>
  </div>;
 })}</div>;
}
