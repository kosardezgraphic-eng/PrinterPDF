import React,{useEffect,useLayoutEffect,useRef} from 'react';
import type {ComputedSheetSide,PageItem,PageOverlay,PageOverlayImage,PageOverlayText} from '@shared/models';
import {drawOverlayText} from '../engine/textOverlays';
import {imageDrawRect,overlayPlacements,type OverlayPlacement} from '../engine/overlayPlacements';
import {moveOverlay,resizeOverlay,resizeOverlayKeepingAspect,rotationFromPointer,pointerAngle,type OverlayHandle} from '../engine/overlayGeometry';
import {rotateVector} from '../engine/pageGeometry';
import {useAppStore} from '../store/useAppStore';
const MM_TO_PT=72/25.4;
const newId=()=>globalThis.crypto?.randomUUID?.()??`overlay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
/** The editable geometry lives on the overlay itself for every kind. */
const targetOf=(p:OverlayPlacement)=>'text' in p ? p.text : p.image;

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
/** Pictures are shown unscaled-by-JavaScript: the browser scales the same mm box the exporter rasterizes. */
function ImagePicture({item,width,height}:{item:PageOverlayImage;width:number;height:number}) {
 const rect=imageDrawRect(item,width,height);
 const fit=rect.width>0&&rect.height>0?{left:`${rect.x/width*100}%`,top:`${rect.y/height*100}%`,width:`${rect.width/width*100}%`,height:`${rect.height/height*100}%`}:{left:'0%',top:'0%',width:'100%',height:'100%'};
 return <img src={item.src} alt={item.name} draggable={false} style={{position:'absolute',...fit,maxWidth:'100%',maxHeight:'100%',
   transform:`scaleX(${item.flipHorizontal?-1:1}) scaleY(${item.flipVertical?-1:1})`,opacity:item.opacity,pointerEvents:'none',userSelect:'none'}}/>;
}
const HANDLES: {id:OverlayHandle;left:string;top:string;cursor:string}[]=[
 {id:'nw',left:'0%',top:'0%',cursor:'nwse-resize'},{id:'n',left:'50%',top:'0%',cursor:'ns-resize'},
 {id:'ne',left:'100%',top:'0%',cursor:'nesw-resize'},{id:'e',left:'100%',top:'50%',cursor:'ew-resize'},
 {id:'se',left:'100%',top:'100%',cursor:'nwse-resize'},{id:'s',left:'50%',top:'100%',cursor:'ns-resize'},
 {id:'sw',left:'0%',top:'100%',cursor:'nesw-resize'},{id:'w',left:'0%',top:'50%',cursor:'ew-resize'}];
type Gesture={pointer:number;x:number;y:number;node:HTMLDivElement;visual:HTMLElement;copy:boolean;handle:OverlayHandle|'move'|'rotate';frame:number|null;dx:number;dy:number;
 startRotation:number;startAngle:number;centerX:number;centerY:number;lock?:boolean};
function OverlayOccurrence({p,pxPerMm,selected,enabled}:{p:OverlayPlacement;pxPerMm:number;selected:boolean;enabled:boolean}){
 const item=targetOf(p);
 const select=useAppStore(s=>s.selectOverlay),update=useAppStore(s=>s.updateOverlay),add=useAppStore(s=>s.addOverlay),beginEdit=useAppStore(s=>s.beginTextEdit);
 const edit=useAppStore(s=>s.textEdit?.occurrenceKey===p.key?s.textEdit:null);
 const textarea=useRef<HTMLTextAreaElement>(null);
 const mounted=useRef(false);
 const gesture=useRef<Gesture|null>(null);
 const isImage='image' in p;
 /** Images and text are free by default; page numbers keep their ratio unless Shift is held. */
 const lockedDefault=item.lockAspect ?? item.kind==='numbering';
 const cleanup=(g:Gesture)=>{if(g.frame!==null)cancelAnimationFrame(g.frame);g.node.style.cursor='move';
  if(g.visual!==g.node)g.visual.remove();
  else{g.node.style.left=`${item.xPercent}%`;g.node.style.top=`${item.yPercent}%`;g.node.style.width=`${item.widthPercent}%`;g.node.style.height=`${item.heightPercent}%`;g.node.style.transform=`rotate(${item.rotation}deg)`;}
  gesture.current=null;};
 useEffect(()=>{const cancel=()=>{if(gesture.current)cleanup(gesture.current);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel();};window.addEventListener('blur',cancel);window.addEventListener('keydown',key);return()=>{window.removeEventListener('blur',cancel);window.removeEventListener('keydown',key);cancel();};},[item.id,p.parentWidth,p.parentHeight,p.parentRotation,pxPerMm,enabled]);
 useLayoutEffect(()=>{if(edit&&textarea.current){textarea.current.focus();textarea.current.setSelectionRange(edit.selectionStart,edit.selectionEnd);}},[!!edit]);
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;const pending=useAppStore.getState().textEdit;
  if(pending?.occurrenceKey===p.key)queueMicrotask(()=>{if(!mounted.current && useAppStore.getState().textEdit===pending)useAppStore.getState().finishTextEdit();});};},[p.key]);
 const geometry=(g:Gesture)=>{
  const angle=p.parentRotation+(g.handle==='move'?0:item.rotation);
  const delta=rotateVector(g.dx,g.dy,-angle),pw=p.parentWidth*pxPerMm,ph=p.parentHeight*pxPerMm;
  if(g.handle==='move')return moveOverlay(item,delta.x/pw*100,delta.y/ph*100);
  const handle=g.handle as OverlayHandle;
  const next=(g.lock ?? lockedDefault)
    ? resizeOverlayKeepingAspect(item,handle,delta.x/pw*100,delta.y/ph*100,{parentWidth:p.parentWidth,parentHeight:p.parentHeight})
    : resizeOverlay(item,handle,delta.x/pw*100,delta.y/ph*100);
  const dx=((next.xPercent+next.widthPercent/2)-(item.xPercent+item.widthPercent/2))*pw/100;
  const dy=((next.yPercent+next.heightPercent/2)-(item.yPercent+item.heightPercent/2))*ph/100;
  const shifted=rotateVector(dx,dy,item.rotation);
  return {...next,xPercent:Math.max(0,Math.min(100-next.widthPercent,item.xPercent+item.widthPercent/2+shifted.x/pw*100-next.widthPercent/2)),
   yPercent:Math.max(0,Math.min(100-next.heightPercent,item.yPercent+item.heightPercent/2+shifted.y/ph*100-next.heightPercent/2))};
 };
 const paint=(g:Gesture)=>{
  if(g.handle==='rotate'){g.node.style.transform=`rotate(${rotationFromPointer(g.centerX,g.centerY,g.x+g.dx,g.y+g.dy,g.startRotation,g.startAngle,g.lock?15:undefined)}deg)`;return;}
  const next=geometry(g);g.visual.style.left=`${next.xPercent}%`;g.visual.style.top=`${next.yPercent}%`;g.visual.style.width=`${next.widthPercent}%`;g.visual.style.height=`${next.heightPercent}%`;
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
 const move=(e:React.PointerEvent<HTMLElement>)=>{const g=gesture.current;if(!g){if(enabled&&e.currentTarget instanceof HTMLDivElement)e.currentTarget.style.cursor=e.ctrlKey||e.metaKey?'copy':'move';return;}
  if(g.pointer!==e.pointerId)return;e.preventDefault();e.stopPropagation();g.dx=e.clientX-g.x;g.dy=e.clientY-g.y;
  if(g.handle!=='rotate')g.lock=e.shiftKey?!lockedDefault:lockedDefault;else g.lock=e.shiftKey;
  ensureCopy(g);if(g.frame===null)g.frame=requestAnimationFrame(()=>{g.frame=null;if(gesture.current===g)paint(g);});};
 const finish=(e:React.PointerEvent<HTMLElement>,cancel=false)=>{const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;
  e.preventDefault();e.stopPropagation();g.dx=e.clientX-g.x;g.dy=e.clientY-g.y;
  const moved=Math.hypot(g.dx,g.dy)>=3;
  const patch:Partial<PageOverlay>=g.handle==='rotate'
    ? {rotation:rotationFromPointer(g.centerX,g.centerY,g.x+g.dx,g.y+g.dy,g.startRotation,g.startAngle,g.lock?15:undefined)}
    : geometry(g);
  cleanup(g);if(cancel||!moved)return;
  const live=useAppStore.getState().overlays.find(o=>o.id===item.id);if(!live || live!==item)return;
  if(g.copy)add({...item,...patch,id:newId()} as PageOverlay);else update(item.id,patch);
 };
 const lang=useAppStore(s=>s.settings.language);
 const editable=!isImage && item.kind==='text' ? item as PageOverlayText : null;
 const label=isImage?(p as {image:PageOverlayImage}).image.name:('renderText' in p ? p.renderText.text : '')||(lang==='fa'?'نوشته':'Overlay');
 return <div data-overlay-id={item.id} role="button" tabIndex={enabled?0:-1} aria-label={label || (lang==='fa'?'لایه':'Overlay')}
   onDoubleClick={e=>{if(!enabled)return;e.stopPropagation();activate();if(editable)beginEdit(item.id,p.key);else{select(item.id);const el=document.querySelector<HTMLTextAreaElement>('[data-numbering-template],[data-image-source]');if(el){el.focus();el.select();}}}}
   onKeyDown={e=>{if(!enabled)return;
   const arrows:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
   const step=arrows[e.key];
   if(step){e.preventDefault();e.stopPropagation();activate();
     // One millimetre on the sheet, five with Shift; the delta is rotated back into the parent box's own axes.
     const mm=(e.shiftKey?5:1),delta=rotateVector(step[0]*mm*pxPerMm,step[1]*mm*pxPerMm,-(p.parentRotation+item.rotation));
     update(item.id,{xPercent:Math.max(0,Math.min(100-item.widthPercent,item.xPercent+delta.x/(p.parentWidth*pxPerMm)*100)),yPercent:Math.max(0,Math.min(100-item.heightPercent,item.yPercent+delta.y/(p.parentHeight*pxPerMm)*100))});return;}
   if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();activate();if(editable)beginEdit(item.id,p.key);else select(item.id);}}}
   onPointerDown={e=>{if(!edit)start(e,'move');}} onPointerMove={move} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)} onLostPointerCapture={e=>finish(e,true)} onClick={e=>e.stopPropagation()}
   style={{position:'absolute',left:`${item.xPercent}%`,top:`${item.yPercent}%`,width:`${item.widthPercent}%`,height:`${item.heightPercent}%`,transform:`rotate(${item.rotation}deg)`,outline:selected?'2px solid #0ea5e9':'none',cursor:enabled?'move':'default',touchAction:'none',pointerEvents:enabled?'auto':'none'}}>
   {!edit && (isImage
     ? <ImagePicture item={(p as {image:PageOverlayImage}).image} width={p.width} height={p.height}/>
     : <TextCanvas item={(p as {renderText:PageOverlayText}).renderText} width={p.width} height={p.height} pxPerMm={pxPerMm}/>)}
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
   {selected && enabled && !edit && HANDLES.map(h=><button key={h.id} type="button" aria-label={`${isImage?(lang==='fa'?'تغییر اندازه تصویر':'Resize image'):item.kind==='numbering'?(lang==='fa'?'تغییر اندازه شماره':'Resize number'):(lang==='fa'?'تغییر اندازه متن':'Resize text')} ${h.id}`} data-text-resize={h.id}
      onPointerDown={e=>start(e,h.id)} onClick={e=>e.stopPropagation()} style={{position:'absolute',left:h.left,top:h.top,transform:'translate(-50%,-50%)',cursor:h.cursor,touchAction:'none'}}
      className="flex h-6 w-6 items-center justify-center"><span className="h-2.5 w-2.5 border border-white bg-sky-600"/></button>)}
   {selected && enabled && !edit && <button type="button" aria-label={lang==='fa'?'چرخش':'Rotate'} data-text-rotate
      title={lang==='fa'?'برای چرخش آزاد بکشید؛ Shift گام ۱۵ درجه است.':'Drag to rotate; Shift snaps to 15°.'}
      onPointerDown={e=>start(e,'rotate')} onClick={e=>e.stopPropagation()}
      style={{position:'absolute',left:'50%',top:'-24px',transform:'translate(-50%,-50%)',cursor:'grab',touchAction:'none'}}
      className="flex h-6 w-6 items-center justify-center rounded-full border border-white bg-sky-700"/>}
 </div>;
}
export function TextOverlayLayer({sheet,totalSheets,pages,pageIndices,pxPerMm,enabled,previewOnly=false}:{sheet:ComputedSheetSide;totalSheets:number;pages:PageItem[];pageIndices:Map<string,number>;pxPerMm:number;enabled:boolean;previewOnly?:boolean}){
 const overlays=useAppStore(s=>s.overlays),selected=useAppStore(s=>s.selectedOverlayId);
 const placements=overlayPlacements(sheet,totalSheets,pages,overlays,pageIndices);
 return <div className="pointer-events-none absolute inset-0 z-10">{placements.map(p=>{
  const item=targetOf(p);
  const c=p.clip;
  const clip=c?`inset(${c.y*pxPerMm}px ${Math.max(0,(sheet.widthMm-c.x-c.width)*pxPerMm)}px ${Math.max(0,(sheet.heightMm-c.y-c.height)*pxPerMm)}px ${c.x*pxPerMm}px)`:undefined;
  return <div key={p.key} className="pointer-events-none absolute inset-0" style={{clipPath:clip}}>
    <div className="pointer-events-none absolute" style={{left:p.parentX*pxPerMm,top:p.parentY*pxPerMm,width:p.parentWidth*pxPerMm,height:p.parentHeight*pxPerMm,transform:`rotate(${p.parentRotation}deg)`}}>
      <OverlayOccurrence p={p} pxPerMm={pxPerMm} selected={selected===item.id} enabled={enabled && (!previewOnly || item.target==='page')}/>
    </div>
  </div>;
 })}</div>;
}
