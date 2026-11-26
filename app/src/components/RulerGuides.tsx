import React, { createContext, useContext, useEffect, useRef } from 'react';
import type { MeasurementUnit, RulerGuide } from '@shared/models';
import { convertMmToUnit } from '../engine/layoutEngine';
import { useAppStore } from '../store/useAppStore';

type Axis = 'x' | 'y';
interface Controller {
  widthMm:number; heightMm:number; widthPx:number; heightPx:number; unit:MeasurementUnit; language:string;
  rulersVisible:boolean; spaceDown:boolean; disabled:boolean; guides:RulerGuide[];
  paperRef:React.RefObject<HTMLDivElement | null>; rulerX:React.RefObject<HTMLDivElement | null>; rulerY:React.RefObject<HTMLDivElement | null>;
  ghostRef:React.RefObject<HTMLDivElement | null>;
  start:(event:React.PointerEvent<HTMLElement>,axis:Axis,guide?:RulerGuide)=>void;
  move:(event:React.PointerEvent<HTMLElement>)=>void;
  finish:(event:React.PointerEvent<HTMLElement>,cancel?:boolean)=>void;
}
const Ctx=createContext<Controller | null>(null);
function controller(){const c=useContext(Ctx);if(!c) throw new Error('Ruler guide context missing');return c;}
let fallbackId=0;
const newId=()=>globalThis.crypto?.randomUUID?.() ?? `ruler-${Date.now()}-${++fallbackId}`;
const inRect=(x:number,y:number,r:DOMRect | undefined)=>!!r && x>=r.left && x<=r.right && y>=r.top && y<=r.bottom;
const format=(mm:number,unit:MeasurementUnit)=>`${convertMmToUnit(mm,unit)} ${unit}`;

export function RulerGuideProvider({widthMm,heightMm,widthPx,heightPx,unit,language,rulersVisible,spaceDown,disabled,children}: {
  widthMm:number;heightMm:number;widthPx:number;heightPx:number;unit:MeasurementUnit;language:string;
  rulersVisible:boolean;spaceDown:boolean;disabled:boolean;children:React.ReactNode;
}) {
  const guides=useAppStore(s=>s.layout.rulerGuides) ?? [];
  const add=useAppStore(s=>s.addRulerGuide), moveGuide=useAppStore(s=>s.moveRulerGuide), remove=useAppStore(s=>s.removeRulerGuide);
  const paperRef=useRef<HTMLDivElement>(null),rulerX=useRef<HTMLDivElement>(null),rulerY=useRef<HTMLDivElement>(null),ghostRef=useRef<HTMLDivElement>(null);
  const dragging=useRef<{pointer:number;axis:Axis;guide?:RulerGuide;node:HTMLElement; captureTarget:HTMLElement; rect:DOMRect; x:number;y:number; offset:number; frame:number|null; unit:MeasurementUnit} | null>(null);
  const position=(d:NonNullable<typeof dragging.current>)=>{
    const raw=(d.axis==='x'?(d.x-d.rect.left)/d.rect.width*widthMm:(d.y-d.rect.top)/d.rect.height*heightMm)-d.offset;
    return Math.round(Math.max(0,Math.min(d.axis==='x'?widthMm:heightMm,raw))*10)/10;
  };
  const paint=(d:NonNullable<typeof dragging.current>)=>{
    const value=position(d), maximum=d.axis==='x'?widthMm:heightMm;
    d.node.style[d.axis==='x'?'left':'top']=`${value/maximum*100}%`;
    d.node.dataset.labelFlip=String(value/maximum*(d.axis==='x'?d.rect.width:d.rect.height)>(d.axis==='x'?d.rect.width-72:d.rect.height-28));
    const label=d.node.querySelector<HTMLElement>('[data-ruler-guide-label]');
    if(label){label.textContent=format(value,d.unit); if(d.axis==='x') label.style.top=`${Math.max(0,Math.min(d.rect.height-22,d.y-d.rect.top))}px`; else label.style.left=`${Math.max(0,Math.min(d.rect.width-64,d.x-d.rect.left))}px`;}
  };
  const clear=(d:NonNullable<typeof dragging.current>)=>{
    if(d.frame!==null) cancelAnimationFrame(d.frame);
    if(d.guide) {
      // An undo or another sheet can edit the guide during a gesture; restore the latest value.
      const current=(useAppStore.getState().layout.rulerGuides ?? []).find(g=>g.id===d.guide!.id) ?? d.guide;
      d.node.style[d.axis==='x'?'left':'top']=`${current.positionMm/(d.axis==='x'?widthMm:heightMm)*100}%`;d.node.removeAttribute('data-dragging');
      const dimension=d.axis==='x'?d.rect.width:d.rect.height;
      d.node.dataset.labelFlip=String(current.positionMm/(d.axis==='x'?widthMm:heightMm)*dimension>dimension-(d.axis==='x'?72:28));
      const label=d.node.querySelector<HTMLElement>('[data-ruler-guide-label]');if(label)label.textContent=format(current.positionMm,d.unit);
    } else d.node.style.display='none';
    dragging.current=null;
    if (d.captureTarget.hasPointerCapture?.(d.pointer)) d.captureTarget.releasePointerCapture(d.pointer);
  };
  useEffect(()=>{
    const cancel=()=>{if(dragging.current) clear(dragging.current);};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel();};
    window.addEventListener('blur',cancel);window.addEventListener('keydown',key);
    return ()=>{window.removeEventListener('blur',cancel);window.removeEventListener('keydown',key);cancel();};
  },[widthMm,heightMm,unit,spaceDown,disabled,rulersVisible]);
  const start:Controller['start']=(e,axis,guide)=>{
    if(disabled||spaceDown||dragging.current||(e.pointerType==='mouse'&&e.button!==0))return;
    const rect=paperRef.current?.getBoundingClientRect();const node=guide?e.currentTarget:ghostRef.current;
    if(!rect||!rect.width||!rect.height||!node)return;
    e.preventDefault();e.stopPropagation();
    const initial=axis==='x'?(e.clientX-rect.left)/rect.width*widthMm:(e.clientY-rect.top)/rect.height*heightMm;
    const d={pointer:e.pointerId,axis,guide,node,captureTarget:e.currentTarget,rect,x:e.clientX,y:e.clientY,offset:guide ? initial-guide.positionMm : 0,frame:null,unit};
    dragging.current=d;
    if(!guide){node.style.left='';node.style.top='';node.style.display='block';node.dataset.axis=axis;const label=node.querySelector<HTMLElement>('[data-ruler-guide-label]');if(label){label.style.left='';label.style.top='';}} else node.setAttribute('data-dragging','true');
    paint(d);e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move:Controller['move']=(e)=>{
    const d=dragging.current;if(!d||d.pointer!==e.pointerId)return;
    e.preventDefault();e.stopPropagation();d.x=e.clientX;d.y=e.clientY;
    if(d.frame===null)d.frame=requestAnimationFrame(()=>{d.frame=null;if(dragging.current===d)paint(d);});
  };
  const finish:Controller['finish']=(e,cancel=false)=>{
    const d=dragging.current;if(!d||d.pointer!==e.pointerId)return;
    e.preventDefault();e.stopPropagation();d.x=e.clientX;d.y=e.clientY;
    const value=position(d);const inPaper=inRect(d.x,d.y,d.rect);
    const onRuler=inRect(d.x,d.y,(d.axis==='x'?rulerX.current:rulerY.current)?.getBoundingClientRect());
    clear(d);
    if(cancel)return;
    if(d.guide && !(useAppStore.getState().layout.rulerGuides ?? []).some(g=>g.id===d.guide!.id && g.axis===d.guide!.axis && g.positionMm===d.guide!.positionMm)) return;
    if(d.guide && onRuler)remove(d.guide.id);
    else if(d.guide && inPaper)moveGuide(d.guide.id,value);
    else if(!d.guide && inPaper)add({id:newId(),axis:d.axis,positionMm:value});
  };
  const value:Controller={widthMm,heightMm,widthPx,heightPx,unit,language,rulersVisible,spaceDown,disabled,guides,paperRef,rulerX,rulerY,ghostRef,start,move,finish};
  return <Ctx.Provider value={value}><div dir="ltr" className="relative flex flex-col">{children}</div></Ctx.Provider>;
}

/** Major ticks adapt to zoom so labels remain legible; all positions use the same paper origin. */
export function rulerTicks(lengthMm:number,px:number,unit:MeasurementUnit):{mm:number;label:string}[] {
  if(!Number.isFinite(lengthMm)||lengthMm<=0||!Number.isFinite(px)||px<=0)return [];
  const base=unit==='inch'?25.4:10;
  const needed=lengthMm/px*36/base;
  const magnitude=Math.pow(10,Math.floor(Math.log10(Math.max(1,needed))));
  const step=([1,2,5,10].find(n=>n*magnitude>=Math.max(1,needed))??10)*magnitude*base;
  return Array.from({length:Math.min(1000,Math.floor(lengthMm/step)+1)},(_,i)=>({mm:i*step,label:String(convertMmToUnit(i*step,unit))}));
}

export function rulerMinorTicks(lengthMm:number,px:number,unit:MeasurementUnit):number[] {
  const major=rulerTicks(lengthMm,px,unit);
  if(major.length<2)return [];
  const majorStep=major[1].mm;
  const base=unit==='inch'?25.4:10;
  const candidates=[.01,.02,.05,.1,.2,.5,1,2,5,10,20,50,100].map(n=>n*base);
  const step=candidates.find(n=>n<majorStep && n*px/lengthMm>=4 && Math.abs(majorStep/n-Math.round(majorStep/n))<.00001);
  if(!step || Math.floor(lengthMm/step)>600)return [];
  return Array.from({length:Math.floor(lengthMm/step)+1},(_,i)=>i*step).filter(mm=>Math.abs(mm/majorStep-Math.round(mm/majorStep))>.00001);
}

export function SheetRuler({axis}:{axis:Axis}) {
  const c=controller();if(!c.rulersVisible)return null;
  const horizontal=axis==='x', length=horizontal?c.widthMm:c.heightMm, px=horizontal?c.widthPx:c.heightPx;
  return <div ref={horizontal?c.rulerX:c.rulerY} data-sheet-ruler={axis} role="button" tabIndex={c.disabled ? -1 : 0}
    aria-label={c.language==='fa'?(horizontal?'خط‌کش بالا؛ برای ایجاد خط عمودی بکشید':'خط‌کش کنار؛ برای ایجاد خط افقی بکشید'):(horizontal?'Top ruler: drag to create vertical guide':'Side ruler: drag to create horizontal guide')}
    title={c.language==='fa'?'برای ساخت خط راهنما به داخل برگه بکشید':'Drag onto the sheet to create a guide'}
    onKeyDown={e=>{if(!c.disabled && (e.key==='Enter'||e.key===' ')){e.preventDefault();useAppStore.getState().addRulerGuide({id:newId(),axis,positionMm:Math.round(length*5)/10});}}}
    onPointerDown={e=>c.start(e,axis)} onPointerMove={c.move} onPointerUp={e=>c.finish(e)} onPointerCancel={e=>c.finish(e,true)} onLostPointerCapture={e=>c.finish(e,true)}
    style={{...(horizontal?{width:px,marginLeft:28}:{height:px}),touchAction:'none',cursor:horizontal?'col-resize':'row-resize'}}
    className={`relative shrink-0 select-none overflow-hidden bg-slate-900/90 font-mono text-[9px] text-slate-300 ${horizontal?'mb-1 h-5 border-b border-slate-600':'mr-1 w-6 border-r border-slate-600'}`}>
    {rulerMinorTicks(length,px,c.unit).map(mm=><span key={mm} aria-hidden="true" className="absolute bg-slate-500" style={horizontal?{left:`${mm/length*100}%`,bottom:0,width:1,height:4}:{top:`${mm/length*100}%`,right:0,height:1,width:4}} />)}
    {rulerTicks(length,px,c.unit).map(tick=><div key={tick.mm} data-ruler-tick={tick.mm} className="absolute" style={horizontal?{left:`${tick.mm/length*100}%`,bottom:0}:{top:`${tick.mm/length*100}%`,right:0}}>
      <span className={horizontal?'block border-l border-slate-400 pl-0.5 leading-3':'block border-t border-slate-400 pt-0.5 leading-3'}>{tick.label}</span>
    </div>)}
  </div>;
}

export function GuidePaperRef({children}:{children:React.ReactNode}) {
  const c=controller();return <div ref={c.paperRef} className="relative shrink-0">{children}</div>;
}

export function UserGuideLines() {
  const c=controller();const moveGuide=useAppStore(s=>s.moveRulerGuide),remove=useAppStore(s=>s.removeRulerGuide);
  return <div data-user-guides className="pointer-events-none absolute inset-0 z-20">
    <div ref={c.ghostRef} data-guide-ghost className="ruler-guide-ghost" style={{display:'none'}}><span data-ruler-guide-label className="ruler-guide-label" /></div>
    {c.guides.filter(g=>g.positionMm>=0 && g.positionMm<=(g.axis==='x'?c.widthMm:c.heightMm)).map(g=>{
      const name=c.language==='fa'?(g.axis==='x'?'خط راهنمای عمودی':'خط راهنمای افقی'):(g.axis==='x'?'Vertical guide':'Horizontal guide');
      return <button key={g.id} type="button" disabled={c.disabled} data-ruler-guide={g.id} data-axis={g.axis} data-label-flip={String(g.positionMm/(g.axis==='x'?c.widthMm:c.heightMm)*(g.axis==='x'?c.widthPx:c.heightPx)>(g.axis==='x'?c.widthPx-72:c.heightPx-28))} className="ruler-guide group pointer-events-auto" style={{[g.axis==='x'?'left':'top']:`${g.positionMm/(g.axis==='x'?c.widthMm:c.heightMm)*100}%`,touchAction:'none'}}
        aria-label={`${name}: ${format(g.positionMm,c.unit)}`} title={`${name}: ${format(g.positionMm,c.unit)}`}
        onPointerDown={e=>c.start(e,g.axis,g)} onPointerMove={e=>{c.move(e);const label=e.currentTarget.querySelector<HTMLElement>('[data-ruler-guide-label]');const rect=c.paperRef.current?.getBoundingClientRect();if(label&&rect){if(g.axis==='x')label.style.top=`${Math.max(0,Math.min(rect.height-22,e.clientY-rect.top))}px`;else label.style.left=`${Math.max(0,Math.min(rect.width-64,e.clientX-rect.left))}px`;}}}
        onPointerUp={e=>c.finish(e)} onPointerCancel={e=>c.finish(e,true)} onLostPointerCapture={e=>c.finish(e,true)} onClick={e=>e.stopPropagation()}
        onKeyDown={e=>{if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();remove(g.id);}else if((g.axis==='x'&&['ArrowLeft','ArrowRight'].includes(e.key))||(g.axis==='y'&&['ArrowUp','ArrowDown'].includes(e.key))){e.preventDefault();e.stopPropagation();const delta=e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1;moveGuide(g.id,Math.max(0,Math.min(g.axis==='x'?c.widthMm:c.heightMm,Math.round((g.positionMm+delta*(e.shiftKey?10:1))*10)/10)));}}}>
        <span aria-hidden="true" data-ruler-guide-label className="ruler-guide-label">{format(g.positionMm,c.unit)}</span>
      </button>;
    })}
  </div>;
}
