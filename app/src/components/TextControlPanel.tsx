import React, {useMemo} from 'react';
import type {OverlayScope,OverlayTarget,PageOverlayText} from '@shared/models';
import {computeImpositionSheets} from '../engine/layoutEngine';
import {useAppStore} from '../store/useAppStore';
const id=()=>globalThis.crypto?.randomUUID?.() ?? `text-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const input='w-full rounded border border-slate-600 bg-slate-800 p-1 text-xs text-white';

export function TextControlPanel(){
 const {settings,pages,layout,overlays,selectedOverlayId,activeSheetIndex,addOverlay,updateOverlay,removeOverlay,selectOverlay}=useAppStore();
 const lang=settings.language,fa=lang==='fa';
 const texts=overlays.filter((o):o is PageOverlayText=>o.kind==='text');
 const selected=texts.find(t=>t.id===selectedOverlayId);
 const sheets=useMemo(()=>computeImpositionSheets(pages,layout),[pages,layout]);
 const sheet=sheets[Math.min(activeSheetIndex,Math.max(0,sheets.length-1))];
 const current=sheet?.cells.find(c=>c.page?.isHighlighted)?.page ?? sheet?.cells.find(c=>c.page)?.page;
 const scopePatch=(scope:OverlayScope,target:OverlayTarget)=>({targetScope:scope,target,targetSheetIndex:(sheet?.sideIndex ?? 1),
   targetPageIds:scope==='current' ? (current?[current.id]:[]) : scope==='selected'?pages.filter(p=>p.selectedForPrint).map(p=>p.id):[]});
 const add=()=>{const text:PageOverlayText={id:id(),kind:'text',...scopePatch('current','sheet'),xPercent:25,yPercent:25,widthPercent:50,heightPercent:15,
   opacity:1,rotation:0,text:fa?'متن جدید':'New text',fontSize:18,fontFamily:'Vazirmatn',color:'#000000',bold:false,italic:false,underline:false,align:fa?'right':'left'};addOverlay(text);};
 const patch=(value:Partial<PageOverlayText>)=>{if(selected)updateOverlay(selected.id,value);};
 const scopes:OverlayScope[]=['current','all','even','odd','first','last','selected'];
 const scopeLabels=fa?['صفحه / برگه جاری','همه','زوج','فرد','اول','آخر','صفحات تیک‌خورده']:['Current','All','Even','Odd','First','Last','Checked pages'];
 return <aside data-text-control-panel className="w-64 shrink-0 overflow-y-auto border-s border-slate-700 bg-slate-900 p-3 text-xs text-slate-200" aria-label={fa?'تنظیمات متن':'Text controls'}>
  <div className="mb-2 flex items-center justify-between"><strong>{fa?'درج نوشته':'Text overlays'}</strong><button type="button" disabled={!sheet} onClick={add} className="rounded bg-sky-700 px-2 py-1 disabled:opacity-40">{fa?'+ متن':'+ Text'}</button></div>
  <div role="tablist" className="mb-2 flex gap-1 overflow-x-auto">{texts.map((t,i)=><button role="tab" aria-selected={selected?.id===t.id} key={t.id} onClick={()=>selectOverlay(t.id)} className={`shrink-0 rounded px-2 py-1 ${selected?.id===t.id?'bg-sky-700':'bg-slate-700'}`}>{fa?'متن':'Text'} {i+1}</button>)}</div>
  {selected ? <div className="space-y-2">
    <label className="block">{fa?'متن':'Text'}<textarea data-text-editor-input aria-label={fa?'متن نوشته':'Overlay text'} value={selected.text} onChange={e=>patch({text:e.target.value})} rows={3} className={input}/></label>
    <label className="block">{fa?'فونت':'Font'}<select aria-label={fa?'فونت نوشته':'Text font'} value={selected.fontFamily} onChange={e=>patch({fontFamily:e.target.value})} className={input}>
      {['Vazirmatn','Shabnam','Sahel','Titr','Mitra','Nastaliq','Tahoma','Arial','Times New Roman'].map(font=><option key={font} value={font}>{font}{['Titr','Mitra','Nastaliq','Tahoma','Arial','Times New Roman'].includes(font)?(fa?' (در صورت نصب)':' (if installed)'):''}</option>)}
    </select></label>
    <label className="block">{fa?'اندازه':'Size'} {selected.fontSize} pt<input aria-label={fa?'اندازه فونت':'Font size'} type="range" min="8" max="80" value={selected.fontSize} onChange={e=>patch({fontSize:+e.target.value})} className="w-full"/></label>
    <label className="block">{fa?'رنگ متن':'Text color'} <input aria-label={fa?'انتخاب رنگ متن':'Pick text color'} type="color" value={/^#[0-9a-f]{6}$/i.test(selected.color)?selected.color:'#000000'} onChange={e=>patch({color:e.target.value})}/><input aria-label={fa?'مقدار رنگ متن':'Text color value'} className={input} value={selected.color} onChange={e=>patch({color:e.target.value})} /></label>
    <label className="block">{fa?'رنگ پس‌زمینه (اختیاری)':'Background (optional)'} <input type="color" aria-label={fa?'انتخاب رنگ پس‌زمینه':'Pick background color'} value={/^#[0-9a-f]{6}$/i.test(selected.backgroundColor??'')?selected.backgroundColor:'#ffffff'} onChange={e=>patch({backgroundColor:e.target.value})}/><input aria-label={fa?'مقدار رنگ پس‌زمینه':'Background color value'} className={input} placeholder="transparent" value={selected.backgroundColor??''} onChange={e=>patch({backgroundColor:e.target.value||undefined})}/></label>
    <div className="flex gap-1">{(['bold','italic','underline'] as const).map((key,i)=><button type="button" key={key} aria-label={(fa?['درشت','کج','زیرخط']:['Bold','Italic','Underline'])[i]} aria-pressed={selected[key]} onClick={()=>patch({[key]:!selected[key]})} className={`rounded px-2 py-1 ${selected[key]?'bg-sky-700':'bg-slate-700'}`}>{['B','I','U'][i]}</button>)}
    {(['left','center','right'] as const).map(a=>{const label=fa?{left:'چپ',center:'وسط',right:'راست'}[a]:{left:'Left',center:'Center',right:'Right'}[a];return <button type="button" key={a} title={label} aria-label={`${fa?'چینش':'Align'} ${label}`} aria-pressed={selected.align===a} onClick={()=>patch({align:a})} className={`rounded px-2 py-1 ${selected.align===a?'bg-sky-700':'bg-slate-700'}`}>{fa?label:label[0]}</button>;})}</div>
    <label className="block">{fa?'شفافیت':'Opacity'} {Math.round(selected.opacity*100)}%<input aria-label={fa?'شفافیت':'Opacity'} type="range" min="10" max="100" value={selected.opacity*100} onChange={e=>patch({opacity:+e.target.value/100})} className="w-full"/></label>
    <label className="block">{fa?'چرخش':'Rotation'} {selected.rotation}°<input aria-label={fa?'چرخش متن':'Text rotation'} type="range" min="0" max="360" value={selected.rotation} onChange={e=>patch({rotation:+e.target.value})} className="w-full"/></label>
    <label className="block">{fa?'مبنای مختصات':'Attach to'}<select aria-label={fa?'مبنای متن':'Text target'} value={selected.target} onChange={e=>patch(scopePatch(selected.targetScope,e.target.value as OverlayTarget))} className={input}><option value="sheet">{fa?'برگه خروجی':'Output sheet'}</option><option value="page">{fa?'صفحه سند':'Document page'}</option></select></label>
    <label className="block">{fa?'دامنه':'Scope'}<select aria-label={fa?'دامنه متن':'Text scope'} value={selected.targetScope} onChange={e=>patch(scopePatch(e.target.value as OverlayScope,selected.target))} className={input}>{scopes.map((s,i)=><option key={s} value={s}>{scopeLabels[i]}</option>)}</select></label>
    <div className="flex flex-wrap gap-1"><button type="button" className="rounded bg-slate-700 px-2 py-1" onClick={()=>patch(scopePatch('all',selected.target))}>{fa?'اعمال روی تمام صفحات':'Apply to all'}</button><button type="button" className="rounded bg-slate-700 px-2 py-1" onClick={()=>patch(scopePatch('selected',selected.target))}>{fa?'اعمال روی انتخاب‌ها':'Apply to checked'}</button></div>
    <p className="text-slate-400">{fa?'انتخاب‌ها هنگام اعمال ثبت می‌شوند. قلم‌های خارج از بسته باید روی سیستم نصب باشند.':'Checked pages are captured when applied. Other fonts must be installed locally.'}</p>
    <button type="button" onClick={()=>removeOverlay(selected.id)} className="rounded bg-rose-900 px-2 py-1">{fa?'حذف متن':'Delete text'}</button>
   </div> : <p className="text-slate-400">{fa?'متنی اضافه یا انتخاب کنید.':'Add or select a text.'}</p>}
 </aside>;
}
