import React,{useEffect,useMemo,useState} from 'react';
import type {OverlayScope,OverlayTarget,PageOverlayImage} from '@shared/models';
import {computeImpositionSheets} from '../engine/layoutEngine';
import {parseCoverageSelection,formatCoverageSelection} from '../engine/coverageSelection';
import {isImageFile,measureImage,readFileAsDataUrl} from '../engine/imageImport';
import {newOverlayId} from '../engine/imageOverlays';
import {useAppStore} from '../store/useAppStore';

const input='w-full rounded border border-slate-600 bg-slate-800 p-1 text-xs text-white';
const MM_TO_PT=72/25.4;
export function ImageControlPanel(){
 const {settings,pages,layout,activePageId,activeSheetIndex,overlays,selectedOverlayId,updateOverlay,removeOverlay,addOverlay}=useAppStore();
 const fa=settings.language==='fa';
 const item=overlays.find((o):o is PageOverlayImage=>o.id===selectedOverlayId&&o.kind==='image');
 const numbers=overlays.filter((o):o is PageOverlayImage=>o.kind==='image');
 const sheets=useMemo(()=>computeImpositionSheets(pages,layout),[pages,layout]);
 const [range,setRange]=useState('');const [rangeError,setRangeError]=useState(false);
 useEffect(()=>{
   if(!item || item.targetScope!=='selected'){setRange('');return;}
   if(item.target==='sheet'&&item.targetSheetIndices){setRange(formatCoverageSelection(item.targetSheetIndices));return;}
   const ids=new Set(item.targetPageIds);
   setRange(formatCoverageSelection(pages.flatMap((p,i)=>ids.has(p.id)?[i+1]:[])));
 },[item?.id,item?.target,item?.targetScope,item?.targetPageIds,item?.targetSheetIndices,pages]);
 if(!item)return null;
 const patch=(value:Partial<PageOverlayImage>)=>updateOverlay(item.id,value);
 const sheet=sheets[Math.min(activeSheetIndex,Math.max(0,sheets.length-1))];
 const page=pages.find(p=>p.id===activePageId)??sheet?.cells.find(c=>c.page)?.page??pages[0];
 const cell=item.target==='page' ? sheet?.cells.find(c=>c.page?.id===item.targetPageIds[0]) : undefined;
 const box=item.target==='sheet'
   ? {width:sheet?.widthMm ?? 210,height:sheet?.heightMm ?? 297}
   : cell ? {width:cell.contentWidthMm,height:cell.contentHeightMm}
     : {width:page?.widthMm ?? 210,height:page?.heightMm ?? 297};
 const widthMm=item.widthPercent*box.width/100, heightMm=item.heightPercent*box.height/100;
 const ratio=heightMm>0?widthMm/heightMm:1;
 const setMm=(key:'width'|'height',value:number)=>{
   if(!(value>0))return;
   if(item.lockAspect){
     if(key==='width')patch({widthPercent:value/box.width*100,heightPercent:value/ratio/box.height*100});
     else patch({heightPercent:value/box.height*100,widthPercent:value*ratio/box.width*100});
   } else patch(key==='width'?{widthPercent:value/box.width*100}:{heightPercent:value/box.height*100});
 };
 const setScope=(scope:OverlayScope,target:OverlayTarget=item.target)=>{
   const side=Math.min(activeSheetIndex+1,Math.max(1,sheets.length));
   const pageIds=scope==='current'?(page?[page.id]:[]):scope==='selected'?pages.filter(p=>p.selectedForPrint).map(p=>p.id):[];
   const sheetIds=scope==='selected'?sheets.filter(s=>s.cells.some(c=>c.page?.selectedForPrint)).map(s=>s.sideIndex):[];
   patch({target,targetScope:scope,targetPageIds:pageIds,targetSheetIndex:side,...(target==='sheet'?{targetSheetIndices:sheetIds}:{targetSheetIndices:undefined})});
   setRange(scope==='selected'?formatCoverageSelection(target==='sheet'?sheetIds:pages.flatMap((p,i)=>pageIds.includes(p.id)?[i+1]:[])):'');setRangeError(false);
 };
 const applyRange=()=>{
   try{const numbers=parseCoverageSelection(range,item.target==='page'?pages.length:sheets.length);
     patch(item.target==='page'?{targetScope:'selected',targetPageIds:numbers.map(n=>pages[n-1].id)}:{targetScope:'selected',targetSheetIndices:numbers});setRangeError(false);
   }catch{setRangeError(true);}
 };
 const replace=async(file?:File|null)=>{
   if(!file||!isImageFile(file))return;
   const src=await readFileAsDataUrl(file);const natural=await measureImage(src);
   patch({src,name:file.name.replace(/\.[^.]+$/,'')||item.name,naturalWidth:natural.width,naturalHeight:natural.height});
 };
 const labels=fa?['همه','فرد','زوج','اول','آخر','صفحه / برگه جاری','انتخاب دلخواه']:['All','Odd','Even','First','Last','Current','Custom selection'];
 const scopes:OverlayScope[]=['all','odd','even','first','last','current','selected'];
 return <aside data-text-control-panel aria-label={fa?'تنظیمات تصویر روی صفحه':'Picture overlay controls'} className="w-64 shrink-0 overflow-y-auto border-s border-slate-700 bg-slate-900 p-3 text-xs text-slate-200 space-y-2">
   <div className="flex items-center justify-between"><strong>{fa?'تنظیمات تصویر':'Picture'}</strong>
     <button type="button" onClick={()=>addOverlay({...item,id:newOverlayId(),xPercent:Math.min(60,item.xPercent+5),yPercent:Math.min(60,item.yPercent+5)})} className="rounded bg-slate-700 px-2 py-1">{fa?'+ نسخه':'+ Copy'}</button></div>
   <div role="tablist" aria-label={fa?'تصویرها':'Pictures'} className="flex gap-1 overflow-x-auto">{numbers.map((n,i)=><button key={n.id} role="tab" type="button" aria-selected={n.id===item.id} onClick={()=>useAppStore.getState().selectOverlay(n.id)} className={`shrink-0 rounded px-2 py-1 ${n.id===item.id?'bg-sky-700':'bg-slate-700'}`}>{fa?`تصویر ${i+1}`:`Picture ${i+1}`}</button>)}</div>
   <p className="truncate text-slate-400" title={item.name}>{item.name} · {item.naturalWidth}×{item.naturalHeight}px</p>
   <label className="block">{fa?'جایگزینی تصویر':'Replace picture'}<input data-image-source type="file" accept="image/*" className={input} onChange={e=>void replace(e.target.files?.[0])}/></label>
   <div className="flex gap-1">
     <label className="flex-1">{fa?'عرض (میلی‌متر)':'Width (mm)'}<input aria-label={fa?'عرض تصویر':'Image width'} type="number" min="1" max="2000" step="0.1" className={input} value={Number(widthMm.toFixed(2))} onChange={e=>setMm('width',Number(e.target.value))}/></label>
     <label className="flex-1">{fa?'ارتفاع (میلی‌متر)':'Height (mm)'}<input aria-label={fa?'ارتفاع تصویر':'Image height'} type="number" min="1" max="2000" step="0.1" className={input} value={Number(heightMm.toFixed(2))} onChange={e=>setMm('height',Number(e.target.value))}/></label>
   </div>
   <label className="flex items-center gap-1.5"><input type="checkbox" aria-label={fa?'قفل نسبت ابعاد':'Lock aspect ratio'} checked={!!item.lockAspect} onChange={e=>patch({lockAspect:e.target.checked})}/>
     {fa?'قفل نسبت ابعاد':'Lock aspect ratio'} <span className="text-slate-400">({fa?'Shift هنگام کشیدن':'Shift while dragging'})</span></label>
   <label className="block">{fa?'نحوهٔ پر کردن کادر':'Fit'}<select aria-label={fa?'نحوهٔ پر کردن':'Fit'} className={input} value={item.fit??'fill'} onChange={e=>patch({fit:e.target.value as 'fill'|'contain'})}>
     <option value="fill">{fa?'کشیدن به اندازهٔ کادر':'Stretch to the box'}</option><option value="contain">{fa?'جای دادن با حفظ نسبت':'Contain (letterbox)'}</option></select></label>
   <div className="flex gap-1">
     <button type="button" aria-pressed={!!item.flipHorizontal} onClick={()=>patch({flipHorizontal:!item.flipHorizontal})} className={`rounded px-2 py-1 ${item.flipHorizontal?'bg-sky-700':'bg-slate-700'}`}>{fa?'آینه افقی':'Flip H'}</button>
     <button type="button" aria-pressed={!!item.flipVertical} onClick={()=>patch({flipVertical:!item.flipVertical})} className={`rounded px-2 py-1 ${item.flipVertical?'bg-sky-700':'bg-slate-700'}`}>{fa?'آینه عمودی':'Flip V'}</button>
     {([0,90,180,270] as const).map(deg=><button key={deg} type="button" onClick={()=>patch({rotation:deg})} className={`rounded px-2 py-1 ${item.rotation===deg?'bg-sky-700':'bg-slate-700'}`}>{deg}°</button>)}
   </div>
   <label className="block">{fa?'چرخش':'Rotation'} {item.rotation}°<input aria-label={fa?'چرخش تصویر':'Image rotation'} type="range" min="0" max="360" step="0.1" value={item.rotation} onChange={e=>patch({rotation:+e.target.value})} className="w-full"/></label>
   <label className="block">{fa?'شفافیت':'Opacity'} {Math.round(item.opacity*100)}%<input aria-label={fa?'شفافیت تصویر':'Image opacity'} type="range" min="10" max="100" value={item.opacity*100} onChange={e=>patch({opacity:+e.target.value/100})} className="w-full"/></label>
   <label className="block">{fa?'مبنا':'Attach to'}<select aria-label={fa?'مبنای تصویر':'Image target'} className={input} value={item.target} onChange={e=>setScope(item.targetScope,e.target.value as OverlayTarget)}>
     <option value="page">{fa?'صفحه سند':'Document page'}</option><option value="sheet">{fa?'برگه خروجی':'Output sheet'}</option></select></label>
   <label className="block">{fa?'دامنه':'Scope'}<select aria-label={fa?'دامنه تصویر':'Image scope'} className={input} value={item.targetScope} onChange={e=>setScope(e.target.value as OverlayScope)}>{scopes.map((scope,i)=><option key={scope} value={scope}>{labels[i]}</option>)}</select></label>
   {item.targetScope==='selected' && <>
     <label className="block">{item.target==='page'?(fa?'شماره صفحات':'Chosen pages'):(fa?'شماره برگه‌ها':'Chosen sheets')}
       <input aria-label={fa?'بازه تصویر':'Image range'} dir="ltr" className={input} value={range} placeholder="1, 3-5" onChange={e=>{setRange(e.target.value);setRangeError(false);}}/></label>
     <button type="button" onClick={applyRange} className="rounded bg-slate-700 px-2 py-1">{fa?'اعمال بازه':'Apply range'}</button>
     {rangeError && <p role="alert" className="text-rose-300">{fa?'شماره یا بازه معتبر وارد کنید.':'Enter valid numbers or ranges.'}</p>}
   </>}
   <p className="text-slate-400">{fa?'کشیدن روی کادر، اندازهٔ کادر را عوض می‌کند؛ برای تصویرِ بدون کشیدگی، قفل نسبت ابعاد را روشن نگه دارید.':'Dragging a handle resizes the box; keep the ratio locked to avoid stretching the picture.'}</p>
   <button type="button" onClick={()=>removeOverlay(item.id)} className="rounded bg-rose-900 px-2 py-1">{fa?'حذف تصویر':'Delete picture'}</button>
   <p className="text-slate-500">{fa?'حجم تصویر در فایل پروژه نگه داشته می‌شود؛ برای پروژه‌های سنگین، تصویر را کوچک کنید.':'The picture is stored inside the project file; downscale large images to keep projects small.'}</p>
 </aside>;
}
