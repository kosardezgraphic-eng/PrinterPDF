import React,{useEffect,useLayoutEffect,useRef} from 'react';
import type {ComputedSheetSide,PageItem,PageOverlayText} from '@shared/models';
import {textPlacements,drawOverlayText,type TextPlacement} from '../engine/textOverlays';
import {moveOverlay,resizeOverlay,type OverlayHandle} from '../engine/overlayGeometry';
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
const HANDLES: {id:OverlayHandle;left:string;top:string;cursor:string}[]=[
 {id:'nw',left:'0%',top:'0%',cursor:'nwse-resize'},{id:'n',left:'50%',top:'0%',cursor:'ns-resize'},
 {id:'ne',left:'100%',top:'0%',cursor:'nesw-resize'},{id:'e',left:'100%',top:'50%',cursor:'ew-resize'},
 {id:'se',left:'100%',top:'100%',cursor:'nwse-resize'},{id:'s',left:'50%',top:'100%',cursor:'ns-resize'},
 {id:'sw',left:'0%',top:'100%',cursor:'nesw-resize'},{id:'w',left:'0%',top:'50%',cursor:'ew-resize'}];
type Gesture={pointer:number;x:number;y:number;node:HTMLDivElement;visual:HTMLElement;copy:boolean;handle:OverlayHandle|'move';frame:number|null;dx:number;dy:number};
function TextOccurrence({p,pxPerMm,selected,enabled}:{p:TextPlacement;pxPerMm:number;selected:boolean;enabled:boolean}){
 const select=useAppStore(s=>s.selectOverlay),update=useAppStore(s=>s.updateOverlay),add=useAppStore(s=>s.addOverlay),beginEdit=useAppStore(s=>s.beginTextEdit);
 const edit=useAppStore(s=>s.textEdit?.occurrenceKey===p.key?s.textEdit:null);
 const textarea=useRef<HTMLTextAreaElement>(null);
 const mounted=useRef(false);
 const gesture=useRef<Gesture|null>(null);
 const cleanup=(g:Gesture)=>{if(g.frame!==null)cancelAnimationFrame(g.frame);g.node.style.cursor='move';
  if(g.visual!==g.node)g.visual.remove();else{g.node.style.left=`${p.text.xPercent}%`;g.node.style.top=`${p.text.yPercent}%`;g.node.style.width=`${p.text.widthPercent}%`;g.node.style.height=`${p.text.heightPercent}%`;}gesture.current=null;};
 useEffect(()=>{const cancel=()=>{if(gesture.current)cleanup(gesture.current);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel();};window.addEventListener('blur',cancel);window.addEventListener('keydown',key);return()=>{window.removeEventListener('blur',cancel);window.removeEventListener('keydown',key);cancel();};},[p.text.id,p.parentWidth,p.parentHeight,p.parentRotation,pxPerMm,enabled]);
 useLayoutEffect(()=>{if(edit&&textarea.current){textarea.current.focus();textarea.current.setSelectionRange(edit.selectionStart,edit.selectionEnd);}},[!!edit]);
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;const pending=useAppStore.getState().textEdit;
  if(pending?.occurrenceKey===p.key)queueMicrotask(()=>{if(!mounted.current && useAppStore.getState().textEdit===pending)useAppStore.getState().finishTextEdit();});};},[p.key]);
 const geometry=(g:Gesture)=>{
  const angle=p.parentRotation+(g.handle==='move'?0:p.text.rotation);
  const delta=rotateVector(g.dx,g.dy,-angle),pw=p.parentWidth*pxPerMm,ph=p.parentHeight*pxPerMm;
  if(g.handle==='move')return moveOverlay(p.text,delta.x/pw*100,delta.y/ph*100);
  const next=resizeOverlay(p.text,g.handle,delta.x/pw*100,delta.y/ph*100);
  const dx=((next.xPercent+next.widthPercent/2)-(p.text.xPercent+p.text.widthPercent/2))*pw/100;
  const dy=((next.yPercent+next.heightPercent/2)-(p.text.yPercent+p.text.heightPercent/2))*ph/100;
  const shifted=rotateVector(dx,dy,p.text.rotation);
  return {...next,xPercent:Math.max(0,Math.min(100-next.widthPercent,p.text.xPercent+p.text.widthPercent/2+shifted.x/pw*100-next.widthPercent/2)),
   yPercent:Math.max(0,Math.min(100-next.heightPercent,p.text.yPercent+p.text.heightPercent/2+shifted.y/ph*100-next.heightPercent/2))};
 };
 const paint=(g:Gesture)=>{const next=geometry(g);g.visual.style.left=`${next.xPercent}%`;g.visual.style.top=`${next.yPercent}%`;g.visual.style.width=`${next.widthPercent}%`;g.visual.style.height=`${next.heightPercent}%`;};
 const ensureCopy=(g:Gesture)=>{if(!g.copy||g.visual!==g.node||Math.hypot(g.dx,g.dy)<3)return;
  const clone=g.node.cloneNode(true) as HTMLElement;const src=g.node.querySelector('canvas'),dest=clone.querySelector('canvas');
  if(src&&dest){dest.width=src.width;dest.height=src.height;dest.getContext('2d')?.drawImage(src,0,0);}clone.style.pointerEvents='none';clone.style.outline='2px solid #0ea5e9';clone.removeAttribute('data-overlay-id');g.node.parentElement?.appendChild(clone);g.visual=clone;
 };
 const activate=()=>{if(p.pageId)useAppStore.setState({activePageId:p.pageId,activeSheetIndex:p.sheetIndex-1});};
 const start=(e:React.PointerEvent<HTMLElement>,handle:OverlayHandle|'move')=>{
  if(!enabled||edit||gesture.current||(e.pointerType==='mouse'&&e.button!==0))return;
  const node=e.currentTarget.closest<HTMLDivElement>('[data-overlay-id]');if(!node)return;
  e.preventDefault();e.stopPropagation();activate();select(p.text.id);node.style.cursor=(handle==='move'&&(e.ctrlKey||e.metaKey))?'copy':'move';
  gesture.current={pointer:e.pointerId,x:e.clientX,y:e.clientY,node,visual:node,copy:handle==='move'&&(e.ctrlKey||e.metaKey),handle,frame:null,dx:0,dy:0};e.currentTarget.setPointerCapture(e.pointerId);
 };
 const move=(e:React.PointerEvent<HTMLElement>)=>{const g=gesture.current;if(!g){if(enabled&&e.currentTarget instanceof HTMLDivElement)e.currentTarget.style.cursor=e.ctrlKey||e.metaKey?'copy':'move';return;}
  if(g.pointer!==e.pointerId)return;e.preventDefault();e.stopPropagation();g.dx=e.clientX-g.x;g.dy=e.clientY-g.y;ensureCopy(g);if(g.frame===null)g.frame=requestAnimationFrame(()=>{g.frame=null;if(gesture.current===g)paint(g);});};
 const finish=(e:React.PointerEvent<HTMLElement>,cancel=false)=>{const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;
  e.preventDefault();e.stopPropagation();g.dx=e.clientX-g.x;g.dy=e.clientY-g.y;const next=geometry(g),moved=Math.hypot(g.dx,g.dy)>=3;cleanup(g);if(cancel||!moved)return;
  const live=useAppStore.getState().overlays.find(o=>o.id===p.text.id);if(!live || live!==p.text)return;
  if(g.copy)add({...p.text,...next,id:newId(),syncGroupId:undefined});else update(p.text.id,next);
 };
 const lang=useAppStore(s=>s.settings.language);
 return <div data-overlay-id={p.text.id} role="button" tabIndex={enabled?0:-1} aria-label={p.text.text || (lang==='fa'?'متن':'Text overlay')}
   onDoubleClick={e=>{if(!enabled)return;e.stopPropagation();activate();beginEdit(p.text.id,p.key);}}
   onKeyDown={e=>{if(enabled && (e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();activate();beginEdit(p.text.id,p.key);}}}
   onPointerDown={e=>{if(!edit)start(e,'move');}} onPointerMove={move} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)} onLostPointerCapture={e=>finish(e,true)} onClick={e=>e.stopPropagation()}
   style={{position:'absolute',left:`${p.text.xPercent}%`,top:`${p.text.yPercent}%`,width:`${p.text.widthPercent}%`,height:`${p.text.heightPercent}%`,transform:`rotate(${p.text.rotation}deg)`,outline:selected?'2px solid #0ea5e9':'none',cursor:enabled?'move':'default',touchAction:'none',pointerEvents:enabled?'auto':'none'}}>
   {!edit && <TextCanvas item={p.renderText} width={p.width} height={p.height} pxPerMm={pxPerMm}/>}
   {p.formulaError && !edit && <span role="alert" className="absolute bottom-full left-0 whitespace-nowrap bg-red-800 px-1 text-white">{lang==='fa'?'فرمول نامعتبر':'Invalid formula'}</span>}
   {edit && <textarea ref={textarea} data-inline-overlay-editor aria-label={lang==='fa'?'ویرایش متن روی صفحه':'Edit text on page'} value={edit.text}
      wrap="off" spellCheck={false} dir={/[\u0590-\u08ff]/.test(edit.text)?'rtl':'ltr'}
      onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}
      onChange={e=>useAppStore.getState().updateTextDraft(e.target.value,e.target.selectionStart,e.target.selectionEnd)}
      onSelect={e=>useAppStore.getState().selectTextDraft(e.currentTarget.selectionStart,e.currentTarget.selectionEnd)}
      onKeyDown={e=>{e.stopPropagation();if(e.nativeEvent.isComposing)return;if(e.key==='Escape'){e.preventDefault();useAppStore.getState().finishTextEdit(true);}else if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();useAppStore.getState().finishTextEdit();}}}
      onBlur={e=>{const related=e.relatedTarget instanceof Element?e.relatedTarget:null;if(!related?.closest('[data-text-control-panel]'))useAppStore.getState().finishTextEdit();}}
      style={{width:'100%',height:'100%',resize:'none',border:0,padding:0,margin:0,outline:'none',overflow:'auto',background:p.text.backgroundColor||'transparent',color:p.text.color,
        fontFamily:`"${p.text.fontFamily}", sans-serif`,fontWeight:p.text.bold?'bold':'normal',fontStyle:p.text.italic?'italic':'normal',textDecoration:p.text.underline?'underline':'none',
        textAlign:p.text.align,fontSize:p.text.fontSize*pxPerMm/MM_TO_PT,lineHeight:p.text.lineHeight??1.25,wordSpacing:`${(p.text.wordSpacingPt??0)*pxPerMm/MM_TO_PT}px`,letterSpacing:`${(p.text.letterSpacingPt??0)*pxPerMm/MM_TO_PT}px`,opacity:p.text.opacity,touchAction:'auto'}} />}
   {selected && enabled && !edit && HANDLES.map(h=><button key={h.id} type="button" aria-label={`${lang==='fa'?'تغییر اندازه متن':'Resize text'} ${h.id}`} data-text-resize={h.id}
      onPointerDown={e=>start(e,h.id)} onClick={e=>e.stopPropagation()} style={{position:'absolute',left:h.left,top:h.top,transform:'translate(-50%,-50%)',cursor:h.cursor,touchAction:'none'}}
      className="flex h-6 w-6 items-center justify-center"><span className="h-2.5 w-2.5 border border-white bg-sky-600"/></button>)}
 </div>;
}
export function TextOverlayLayer({sheet,totalSheets,pages,pageIndices,pxPerMm,enabled,previewOnly=false}:{sheet:ComputedSheetSide;totalSheets:number;pages:PageItem[];pageIndices:Map<string,number>;pxPerMm:number;enabled:boolean;previewOnly?:boolean}){
 const overlays=useAppStore(s=>s.overlays),selected=useAppStore(s=>s.selectedOverlayId);
 const placements=textPlacements(sheet,totalSheets,pages,overlays,pageIndices);
 return <div className="pointer-events-none absolute inset-0 z-10">{placements.map(p=>{
  const c=p.clip;
  const clip=c?`inset(${c.y*pxPerMm}px ${Math.max(0,(sheet.widthMm-c.x-c.width)*pxPerMm)}px ${Math.max(0,(sheet.heightMm-c.y-c.height)*pxPerMm)}px ${c.x*pxPerMm}px)`:undefined;
  return <div key={p.key} className="pointer-events-none absolute inset-0" style={{clipPath:clip}}>
    <div className="pointer-events-none absolute" style={{left:p.parentX*pxPerMm,top:p.parentY*pxPerMm,width:p.parentWidth*pxPerMm,height:p.parentHeight*pxPerMm,transform:`rotate(${p.parentRotation}deg)`}}>
      <TextOccurrence p={p} pxPerMm={pxPerMm} selected={selected===p.text.id} enabled={enabled && (!previewOnly || p.text.target==='page')}/>
    </div>
  </div>;
 })}</div>;
}
