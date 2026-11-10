import React,{useEffect,useMemo,useRef,useState} from 'react';
import {evaluateNumberScript} from '../engine/overlayRenderUtils';
import type {OverlayScope,OverlayTarget,PageOverlayNumbering} from '@shared/models';
import {computeImpositionSheets} from '../engine/layoutEngine';
import {resolveNumberingTemplate} from '../engine/textOverlays';
import {parseCoverageSelection,formatCoverageSelection} from '../engine/coverageSelection';
import {useAppStore} from '../store/useAppStore';

const input='w-full rounded border border-slate-600 bg-slate-800 p-1 text-xs text-white';
export function NumberingControlPanel(){
 const {settings,pages,layout,activePageId,activeSheetIndex,overlays,selectedOverlayId,updateOverlay,removeOverlay,addOverlay,selectOverlay,addNumberingOverlay}=useAppStore();
 const fa=settings.language==='fa';
 const item=overlays.find((o):o is PageOverlayNumbering=>o.id===selectedOverlayId&&o.kind==='numbering');
 const numbers=overlays.filter((o):o is PageOverlayNumbering=>o.kind==='numbering');
 const sheets=useMemo(()=>computeImpositionSheets(pages,layout),[pages,layout]);
 const [range,setRange]=useState('');const [rangeError,setRangeError]=useState(false);
 const templateRef=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{
   if(!item || item.targetScope!=='selected'){setRange('');return;}
   if(item.target==='sheet' && item.targetSheetIndices){setRange(formatCoverageSelection(item.targetSheetIndices));return;}
   const ids=new Set(item.targetPageIds);
   setRange(formatCoverageSelection(pages.flatMap((p,i)=>ids.has(p.id)?[i+1]:[])));
 },[item?.id,item?.target,item?.targetScope,item?.targetPageIds,item?.targetSheetIndices,pages]);
 if(!item)return null;
 const page=pages.find(p=>p.id===activePageId)??sheets[activeSheetIndex]?.cells.find(c=>c.page)?.page??pages[0];
 const patch=(value:Partial<PageOverlayNumbering>)=>updateOverlay(item.id,value);
 const insertToken=(token:string)=>{const el=templateRef.current;const start=el?.selectionStart??item.template.length,end=el?.selectionEnd??start;
   const next=item.template.slice(0,start)+token+item.template.slice(end);patch({template:next});
   requestAnimationFrame(()=>{el?.focus();el?.setSelectionRange(start+token.length,start+token.length);});};
 const wrapSelection=(script:'super'|'sub')=>{const el=templateRef.current;if(!el)return;const start=el.selectionStart,end=el.selectionEnd;
   const inner=end>start?item.template.slice(start,end):'…';const opener=script==='super'?'^{':'_{';const next=`${item.template.slice(0,start)}${opener}${inner}}${item.template.slice(end)}`;
   patch({template:next});requestAnimationFrame(()=>{el.focus();el.setSelectionRange(start+opener.length,start+opener.length+inner.length);});};
 const previewIndex=item.target==='sheet'?Math.min(Math.max(activeSheetIndex+1,1),Math.max(1,sheets.length)):Math.max(1,(page?pages.findIndex(p=>p.id===page.id):-1)+1);
 const previewTotal=item.target==='sheet'?Math.max(1,sheets.length):pages.length;
 let previewText:string|null=null,formulaError:string|undefined;
 try{previewText=resolveNumberingTemplate(item,previewIndex,previewTotal).text;}catch(error){formulaError=(error as Error).message;}
 const setScope=(scope:OverlayScope,target:OverlayTarget=item.target)=>{
   const sheet=Math.min(activeSheetIndex+1,Math.max(1,sheets.length));
   const pageIds=scope==='current'?(page?[page.id]:[]):scope==='selected'?pages.filter(p=>p.selectedForPrint).map(p=>p.id):[];
   const sheetIds=scope==='selected'?sheets.filter(s=>s.cells.some(c=>c.page?.selectedForPrint)).map(s=>s.sideIndex):[];
   patch({target,targetScope:scope,targetPageIds:pageIds,targetSheetIndex:sheet,targetSheetIndices:target==='sheet'?sheetIds:undefined});
   setRange(scope==='selected'?formatCoverageSelection(target==='sheet'?sheetIds:pages.flatMap((p,i)=>pageIds.includes(p.id)?[i+1]:[])):'');setRangeError(false);
 };
 const applyRange=()=>{try{const numbers=parseCoverageSelection(range,item.target==='page'?pages.length:sheets.length);
   patch(item.target==='page'?{targetScope:'selected',targetPageIds:numbers.map(n=>pages[n-1].id)}:{targetScope:'selected',targetSheetIndices:numbers});setRangeError(false);
 }catch{setRangeError(true);}};
 const labels=fa?['همه','فرد','زوج','اول','آخر','صفحه / برگه جاری','انتخاب دلخواه']:['All','Odd','Even','First','Last','Current','Custom selection'];
 const scopes:OverlayScope[]=['all','odd','even','first','last','current','selected'];
 return <aside data-text-control-panel aria-label={fa?'تنظیمات شماره صفحه':'Page numbering controls'} className="w-64 shrink-0 overflow-y-auto border-s border-slate-700 bg-slate-900 p-3 text-xs text-slate-200 space-y-2">
   <div className="flex items-center justify-between"><strong>{fa?'تنظیمات شماره صفحه':'Page numbering'}</strong>
     <button type="button" disabled={!pages.length} onClick={()=>addNumberingOverlay()} className="rounded bg-sky-700 px-2 py-1 disabled:opacity-40">{fa?'+ شماره':'+ Number'}</button></div>
   <div role="tablist" aria-label={fa?'شماره‌های صفحه':'Page numbers'} className="flex gap-1 overflow-x-auto">{numbers.map((n,i)=><button key={n.id} role="tab" type="button" aria-selected={n.id===item.id} onClick={()=>selectOverlay(n.id)} className={`shrink-0 rounded px-2 py-1 ${n.id===item.id?'bg-sky-700':'bg-slate-700'}`}>{fa?`شماره ${i+1}`:`Number ${i+1}`}{n.enabled?'':' (پنهان)'}</button>)}</div>
   <p className="text-slate-400">{fa?'شماره را روی صفحه بکشید یا با دستگیره اندازه کادر را تغییر دهید.':'Drag the number on the page or resize its box using the handles.'}</p>
   <label className="block">{fa?'متن و قالب':'Text and template'}<textarea data-numbering-template ref={templateRef} aria-label={fa?'قالب شماره':'Number template'} dir="auto" className={input} rows={2} value={item.template} onChange={e=>patch({template:e.target.value})}/></label>
   <div className="flex flex-wrap gap-1">{['{page}','{total}','{serial}','{pad3}','{pad4}','{pad6}'].map(token=><button type="button" key={token} onClick={()=>insertToken(token)} className="rounded bg-slate-700 px-1.5 py-0.5 font-mono text-[11px]">{token}</button>)}</div>
   <div className="flex flex-wrap gap-1">{([['super','Superscript','بالانویس','^{…}'],['sub','Subscript','زیرنویس','_{…}']] as const).map(([script,en,faLabel,syntax])=><button key={script} type="button" title={syntax} aria-label={fa?faLabel:en} onClick={()=>wrapSelection(script)} className="rounded bg-slate-700 px-1.5 py-0.5 text-[11px]">{fa?faLabel:en}</button>)}</div>
   <p className="text-slate-400">{fa?'برای بالانویس/زیرنویس، بخشی از قالب را انتخاب کنید (مثلاً th در Page {page}^{th}).':'For superscript/subscript, select part of the template (for example th in Page {page}^{th}).'}</p>
   <label className="block">{fa?'فرمول شماره':'Number formula'}<input aria-label={fa?'فرمول شماره':'Number formula'} dir="ltr" className={input} maxLength={160} value={item.customScript} placeholder="page+1000" onChange={e=>patch({customScript:e.target.value})}/></label>
   <p className="text-slate-400">{fa?'مثلاً page+1000 یا page-2؛ فقط محاسبات محدود، بدون اجرای کد.':'For example page+1000 or page-2; bounded arithmetic only, not code execution.'}</p>
   {formulaError && <p role="alert" className="text-rose-300">{fa?`فرمول نامعتبر: ${formulaError}`:`Invalid formula: ${formulaError}`}</p>}
   {previewText ? <p className="text-slate-300">{fa?'پیش‌نمایش برای صفحهٔ جاری:':'Preview for the current page:'} <span dir="auto" className="font-semibold">{previewText}</span></p> : <p role="alert" className="text-amber-300">{fa?'قالب یا فرمول برای این صفحه قابل محاسبه نیست؛ شمارهٔ چاپی نشان داده نمی‌شود تا اصلاح شود.':'This template or formula cannot be computed for this page; nothing will print until it is fixed.'}</p>}
   <label className="block">{fa?'عدد شروع':'Starting number'}<input aria-label={fa?'عدد شروع':'Starting number'} type="number" min="-999999999" max="999999999" className={input} value={item.startOffset} onChange={e=>{if(e.target.value && Number.isSafeInteger(+e.target.value))patch({startOffset:+e.target.value});}}/></label>
   <label className="block">{fa?'نوع شماره':'Number format'}<select aria-label={fa?'نوع شماره':'Number format'} className={input} value={item.format} onChange={e=>patch({format:e.target.value as PageOverlayNumbering['format']})}>{['persian','english','roman','abjad'].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
   <label className="block">{fa?'تعداد رقم سریال (۰ بدون صفر)':'Serial padding (0 for none)'}<input aria-label={fa?'تعداد رقم سریال':'Serial padding'} type="number" min="0" max="10" className={input} value={item.padZeros} onChange={e=>patch({padZeros:Math.max(0,Math.min(10,Number(e.target.value)))})}/></label>
   <label className="block">{fa?'فونت':'Font'}<select aria-label={fa?'فونت شماره':'Number font'} className={input} value={item.fontFamily} onChange={e=>patch({fontFamily:e.target.value})}>{['Vazirmatn','Shabnam','Sahel','Titr','Mitra','Nastaliq','Tahoma','Arial','Times New Roman'].map(f=><option key={f}>{f}</option>)}</select></label>
   <label className="block">{fa?'اندازه فونت':'Font size'} {item.fontSize} pt<input aria-label={fa?'اندازه فونت شماره':'Number font size'} type="range" min="8" max="80" value={item.fontSize} onChange={e=>patch({fontSize:+e.target.value})} className="w-full"/></label>
   <label className="block">{fa?'رنگ':'Color'}<input aria-label={fa?'رنگ شماره':'Number color'} type="color" value={/^#[0-9a-f]{6}$/i.test(item.color)?item.color:'#000000'} onChange={e=>patch({color:e.target.value})}/></label>
   <div className="flex gap-1">{(['bold','italic'] as const).map((k,i)=><button type="button" key={k} aria-label={(fa?['درشت','کج']:['Bold','Italic'])[i]} aria-pressed={item[k]} onClick={()=>patch({[k]:!item[k]})} className={`rounded px-2 py-1 ${item[k]?'bg-sky-700':'bg-slate-700'}`}>{k==='bold'?'B':'I'}</button>)}
   {(['left','center','right'] as const).map(a=><button type="button" key={a} aria-label={`${fa?'چینش':'Align'} ${a}`} aria-pressed={(item.align??'center')===a} onClick={()=>patch({align:a})} className={`rounded px-2 py-1 ${(item.align??'center')===a?'bg-sky-700':'bg-slate-700'}`}>{a[0].toUpperCase()}</button>)}</div>
   <label className="block">{fa?'شفافیت':'Opacity'} {Math.round(item.opacity*100)}%<input aria-label={fa?'شفافیت شماره':'Number opacity'} type="range" min="10" max="100" value={item.opacity*100} onChange={e=>patch({opacity:+e.target.value/100})} className="w-full"/></label>
   <label className="block">{fa?'چرخش':'Rotation'} {item.rotation}°<input aria-label={fa?'چرخش شماره':'Number rotation'} type="range" min="0" max="360" value={item.rotation} onChange={e=>patch({rotation:+e.target.value})} className="w-full"/></label>
   <label className="block">{fa?'مبنا':'Attach to'}<select aria-label={fa?'مبنای شماره':'Number target'} className={input} value={item.target} onChange={e=>setScope(item.targetScope,e.target.value as OverlayTarget)}><option value="page">{fa?'صفحه سند':'Document page'}</option><option value="sheet">{fa?'برگه خروجی':'Output sheet'}</option></select></label>
   <label className="block">{fa?'دامنه':'Scope'}<select aria-label={fa?'دامنه شماره':'Number scope'} className={input} value={item.targetScope} onChange={e=>setScope(e.target.value as OverlayScope)}>{scopes.map((scope,i)=><option key={scope} value={scope}>{labels[i]}</option>)}</select></label>
   <label className="block">{item.target==='page'?(fa?'صفحات دلخواه':'Chosen pages'):(fa?'برگه‌های دلخواه':'Chosen output sheets')}<input aria-label={fa?'بازه شماره‌گذاری':'Numbering range'} dir="ltr" className={input} value={range} placeholder="1, 3-5" onChange={e=>{setRange(e.target.value);setRangeError(false);}}/></label>
   <button type="button" onClick={applyRange} className="rounded bg-slate-700 px-2 py-1">{fa?'اعمال بازه':'Apply range'}</button>
   {rangeError && <p role="alert" className="text-rose-300">{fa?'شماره یا بازه معتبر وارد کنید.':'Enter valid numbers or ranges.'}</p>}
   <p className="text-slate-400">{fa?'زوج و فرد بر اساس ترتیب صفحه‌های فضای کار یا برگه‌های خروجی است؛ انتخاب بازه وضعیت چاپ را تغییر نمی‌دهد.':'Odd/even use workspace page order or output-side order. Ranges do not change print selection.'}</p>
   <div className="flex gap-1">
     <button type="button" aria-pressed={item.enabled} onClick={()=>patch({enabled:!item.enabled})} className={`rounded px-2 py-1 ${item.enabled?'bg-sky-700':'bg-slate-700'}`}>{fa?'فعال بودن':'Enabled'}</button>
     <button type="button" onClick={()=>addOverlay({...item,id:globalThis.crypto?.randomUUID?.()??`number-${Date.now()}`,targetScope:item.targetScope==='all'?'odd':item.targetScope==='odd'?'even':'all'})} className="rounded bg-slate-700 px-2 py-1">{fa?'افزودن شمارهٔ مستقل دیگر':'Add another independent number'}</button>
   </div>
   <p className="text-slate-400">{fa?'برای صفحات زوج و فرد می‌توانید دو شمارهٔ مستقل با قالب و جای متفاوت بسازید؛ کلیدهای جهت‌نما شماره را جابه‌جا می‌کنند (Shift برای گام بزرگ‌تر).':'Create two independent numbers with different templates and positions for even and odd pages; arrow keys nudge the number (Shift for a bigger step).'}</p>
   <button type="button" onClick={()=>removeOverlay(item.id)} className="rounded bg-rose-900 px-2 py-1">{fa?'حذف شماره‌گذاری':'Delete numbering'}</button>
 </aside>;
}
