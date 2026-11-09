import React,{useEffect,useRef} from 'react';
import type {ComputedSheetSide,PageItem,PageOverlayText} from '@shared/models';
import {textPlacements,drawOverlayText,type TextPlacement} from '../engine/textOverlays';
import {moveOverlay} from '../engine/overlayGeometry';
import {rotateVector} from '../engine/pageGeometry';
import {useAppStore} from '../store/useAppStore';
const MM_TO_PT=72/25.4;
const newId=()=>globalThis.crypto?.randomUUID?.()??`text-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function TextCanvas({item,width,height,pxPerMm}:{item:PageOverlayText;width:number;height:number;pxPerMm:number}) {
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  let canceled=false;
  const draw=()=>{if(canceled||!ref.current)return;const canvas=ref.current,dpr=Math.min(3,window.devicePixelRatio||1);
    canvas.width=Math.max(1,Math.ceil(width*pxPerMm*dpr));canvas.height=Math.max(1,Math.ceil(height*pxPerMm*dpr));
    const ctx=canvas.getContext('2d');if(ctx)drawOverlayText(ctx,item,canvas.width,canvas.height,pxPerMm*dpr/MM_TO_PT);
  };
  if(document.fonts?.load)void document.fonts.load(`${item.italic?'italic ':''}${item.bold?'bold':'normal'} 18px "${item.fontFamily.replace(/["\\]/g,'')}"`,item.text).then(draw,draw);else draw();
  return ()=>{canceled=true;};
 },[item,width,height,pxPerMm]);
 return <canvas ref={ref} style={{width:'100%',height:'100%',display:'block',opacity:item.opacity}} aria-hidden="true"/>;
}
function TextOccurrence({p,pxPerMm,selected,enabled}:{p:TextPlacement;pxPerMm:number;selected:boolean;enabled:boolean}){
 const select=useAppStore(s=>s.selectOverlay),update=useAppStore(s=>s.updateOverlay),add=useAppStore(s=>s.addOverlay),setTab=useAppStore(s=>s.setActiveRibbonTab);
 const gesture=useRef<{pointer:number;x:number;y:number;node:HTMLDivElement;visual:HTMLElement;copy:boolean;frame:number|null;dx:number;dy:number} | null>(null);
 const cleanup=(g:NonNullable<typeof gesture.current>)=>{if(g.frame!==null)cancelAnimationFrame(g.frame);g.node.style.cursor='move';if(g.visual!==g.node)g.visual.remove();else{g.node.style.left=`${p.text.xPercent}%`;g.node.style.top=`${p.text.yPercent}%`;}gesture.current=null;};
 useEffect(()=>{const cancel=()=>{if(gesture.current)cleanup(gesture.current);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel();};window.addEventListener('blur',cancel);window.addEventListener('keydown',key);return()=>{window.removeEventListener('blur',cancel);window.removeEventListener('keydown',key);cancel();};},[p.text.id,p.parentWidth,p.parentHeight,p.parentRotation,pxPerMm,enabled]);
 const geometry=(g:NonNullable<typeof gesture.current>)=>{const delta=rotateVector(g.dx,g.dy,-p.parentRotation);return moveOverlay(p.text,delta.x/(p.parentWidth*pxPerMm)*100,delta.y/(p.parentHeight*pxPerMm)*100);};
 const paint=(g:NonNullable<typeof gesture.current>)=>{const next=geometry(g);g.visual.style.left=`${next.xPercent}%`;g.visual.style.top=`${next.yPercent}%`;};
 const ensureCopy=(g:NonNullable<typeof gesture.current>)=>{if(!g.copy||g.visual!==g.node||Math.hypot(g.dx,g.dy)<3)return;
  const clone=g.node.cloneNode(true) as HTMLElement;const src=g.node.querySelector('canvas'),dest=clone.querySelector('canvas');
  if(src&&dest){dest.width=src.width;dest.height=src.height;dest.getContext('2d')?.drawImage(src,0,0);}clone.style.pointerEvents='none';clone.style.outline='2px solid #0ea5e9';clone.removeAttribute('data-overlay-id');g.node.parentElement?.appendChild(clone);g.visual=clone;
 };
 return <div data-overlay-id={p.text.id} role="button" tabIndex={enabled?0:-1} aria-label={p.text.text || 'Text overlay'}
   onDoubleClick={e=>{if(!enabled)return;e.stopPropagation();select(p.text.id);setTab('insert');requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('[data-text-editor-input]')?.focus());}}
   onPointerDown={e=>{if(!enabled||gesture.current||(e.pointerType==='mouse'&&e.button!==0))return;e.preventDefault();e.stopPropagation();select(p.text.id);e.currentTarget.style.cursor=e.ctrlKey||e.metaKey?'copy':'move';gesture.current={pointer:e.pointerId,x:e.clientX,y:e.clientY,node:e.currentTarget,visual:e.currentTarget,copy:e.ctrlKey||e.metaKey,frame:null,dx:0,dy:0};e.currentTarget.setPointerCapture(e.pointerId);}}
   onPointerMove={e=>{const g=gesture.current;if(!g){if(enabled)e.currentTarget.style.cursor=e.ctrlKey||e.metaKey?'copy':'move';return;}if(g.pointer!==e.pointerId)return;e.preventDefault();e.stopPropagation();g.dx=e.clientX-g.x;g.dy=e.clientY-g.y;ensureCopy(g);if(g.frame===null)g.frame=requestAnimationFrame(()=>{g.frame=null;if(gesture.current===g)paint(g);});}}
   onPointerUp={e=>{const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;e.preventDefault();e.stopPropagation();g.dx=e.clientX-g.x;g.dy=e.clientY-g.y;const next=geometry(g),moved=Math.hypot(g.dx,g.dy)>=3;cleanup(g);if(!moved)return;
     if(g.copy)add({...p.text,...next,id:newId(),syncGroupId:undefined});else update(p.text.id,next);}}
   onPointerCancel={e=>{if(gesture.current?.pointer===e.pointerId)cleanup(gesture.current);}}
   onLostPointerCapture={e=>{if(gesture.current?.pointer===e.pointerId)cleanup(gesture.current);}}
   onClick={e=>e.stopPropagation()}
   style={{position:'absolute',left:`${p.text.xPercent}%`,top:`${p.text.yPercent}%`,width:`${p.text.widthPercent}%`,height:`${p.text.heightPercent}%`,transform:`rotate(${p.text.rotation}deg)`,outline:selected?'2px solid #0ea5e9':'none',cursor:enabled?'move':'default',touchAction:'none',pointerEvents:enabled?'auto':'none'}}>
   <TextCanvas item={p.text} width={p.width} height={p.height} pxPerMm={pxPerMm}/>
 </div>;
}
export function TextOverlayLayer({sheet,totalSheets,pages,pageIndices,pxPerMm,enabled}:{sheet:ComputedSheetSide;totalSheets:number;pages:PageItem[];pageIndices:Map<string,number>;pxPerMm:number;enabled:boolean}){
 const overlays=useAppStore(s=>s.overlays),selected=useAppStore(s=>s.selectedOverlayId);
 const placements=textPlacements(sheet,totalSheets,pages,overlays,pageIndices);
 return <div className="pointer-events-none absolute inset-0 z-10">{placements.map(p=>{
  const c=p.clip;
  const clip=c?`inset(${c.y*pxPerMm}px ${Math.max(0,(sheet.widthMm-c.x-c.width)*pxPerMm)}px ${Math.max(0,(sheet.heightMm-c.y-c.height)*pxPerMm)}px ${c.x*pxPerMm}px)`:undefined;
  return <div key={p.key} className="pointer-events-none absolute inset-0" style={{clipPath:clip}}>
    <div className="pointer-events-none absolute" style={{left:p.parentX*pxPerMm,top:p.parentY*pxPerMm,width:p.parentWidth*pxPerMm,height:p.parentHeight*pxPerMm,transform:`rotate(${p.parentRotation}deg)`}}>
      <TextOccurrence p={p} pxPerMm={pxPerMm} selected={selected===p.text.id} enabled={enabled}/>
    </div>
  </div>;
 })}</div>;
}
