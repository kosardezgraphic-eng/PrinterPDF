import React,{useEffect,useMemo,useRef,useState} from 'react';
import {evaluateNumberScript} from '../engine/overlayRenderUtils';
import type {OverlayScope,OverlayTarget,PageOverlayNumbering} from '@shared/models';
import {computeImpositionSheets} from '../engine/layoutEngine';
import {numberingSequence} from '../engine/numberingSequence';
import {resolveNumberingTemplate} from '../engine/textOverlays';
import {parseCoverageSelection,formatCoverageSelection} from '../engine/coverageSelection';
import {useSystemFonts} from '../engine/systemFonts';
import {boxWithinLimits,overlayPanelFrame} from '../engine/overlayGeometry';
import {useAppStore} from '../store/useAppStore';

const input='w-full rounded border border-slate-300 bg-white p-1 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white';
export function NumberingControlPanel(){
 const {settings,pages,layout,activePageId,activeSheetIndex,overlays,selectedOverlayId,updateOverlay,removeOverlay,addOverlay,selectOverlay,addNumberingOverlay}=useAppStore();
 const fa=settings.language==='fa';
 const item=overlays.find((o):o is PageOverlayNumbering=>o.id===selectedOverlayId&&o.kind==='numbering');
 const {bundledFonts,systemFonts,isLoading:fontsLoading,refreshSystemFonts}=useSystemFonts(item?.fontFamily);
 const numbers=overlays.filter((o):o is PageOverlayNumbering=>o.kind==='numbering');
 const sheets=useMemo(()=>computeImpositionSheets(pages,layout),[pages,layout]);
 const [range,setRange]=useState('');const [rangeError,setRangeError]=useState(false);
 const [customFont,setCustomFont]=useState('');
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
 // The preview has to count the same way the sheet will, or the panel shows one number and the paper prints
 // another — the one failure a numbering panel must never have.
 const previewSheet=sheets[Math.min(Math.max(activeSheetIndex,0),Math.max(0,sheets.length-1))];
 const previewCell=previewSheet?.cells.find(c=>c.page?.id===page?.id)??previewSheet?.cells.find(c=>c.page);
 const previewWalk=numberingSequence({basis:item.sequenceBasis,direction:item.sequenceDirection,
   pageId:previewCell?.page?.id??page?.id??'',sheet:previewSheet??{sheetNumber:1,side:'front',sideIndex:1,widthMm:0,heightMm:0,cells:[]},
   pageIndex:Math.max(1,(page?pages.findIndex(p=>p.id===page.id):-1)+1),pageTotal:Math.max(1,pages.length),sheetTotal:Math.max(1,sheets.length)});
 const previewIndex=item.target==='sheet'?Math.min(Math.max(activeSheetIndex+1,1),Math.max(1,sheets.length)):previewWalk.index;
 const previewTotal=item.target==='sheet'?Math.max(1,sheets.length):previewWalk.total;
 let previewText:string|null=null,formulaError:string|undefined;
 try{previewText=resolveNumberingTemplate(item,previewIndex,previewTotal).text;}catch(error){formulaError=(error as Error).message;}
 const setScope=(scope:OverlayScope,target:OverlayTarget=item.target)=>{
   const sheet=Math.min(activeSheetIndex+1,Math.max(1,sheets.length));
   const pageIds=scope==='current'?(page?[page.id]:[]):scope==='selected'?pages.filter(p=>p.selectedForPrint).map(p=>p.id):[];
   const sheetIds=scope==='selected'?sheets.filter(s=>s.cells.some(c=>c.page?.selectedForPrint)).map(s=>s.sideIndex):[];
   patch({target,targetScope:scope,targetPageIds:pageIds,targetSheetIndex:sheet,targetSheetIndices:target==='sheet'?sheetIds:undefined});
   setRange(scope==='selected'?formatCoverageSelection(target==='sheet'?sheetIds:pages.flatMap((p,i)=>pageIds.includes(p.id)?[i+1]:[])):'');setRangeError(false);
 };
 const applyRange=()=>{try{const numbers=parseCoverageSelection(range,item.target==='sheet'?sheets.length:pages.length);
   patch(item.target==='sheet'?{targetScope:'selected',targetSheetIndices:numbers}:{targetScope:'selected',targetPageIds:numbers.map(n=>pages[n-1].id)});setRangeError(false);
 }catch{setRangeError(true);}};
  const boxFrame=overlayPanelFrame(previewSheet,{target:item.target==='sheet'?'sheet':'page',targetPageIds:item.targetPageIds});
  const boxWidthMm=Math.round((item.widthPercent/100)*boxFrame.boxWidthMm*10)/10;
  const boxHeightMm=Math.round((item.heightPercent/100)*boxFrame.boxHeightMm*10)/10;
  const updateBoxSizeMm=(axis:'w'|'h',mmValue:number)=>{
    if(!Number.isFinite(mmValue))return;
    const clampedMm=Math.max(4,mmValue);
    const nextWidthPct=axis==='w'&&boxFrame.boxWidthMm>0?(clampedMm/boxFrame.boxWidthMm)*100:item.widthPercent;
    const nextHeightPct=axis==='h'&&boxFrame.boxHeightMm>0?(clampedMm/boxFrame.boxHeightMm)*100:item.heightPercent;
    const bounded=boxWithinLimits({...item,widthPercent:Math.max(1,nextWidthPct),heightPercent:Math.max(1,nextHeightPct)},boxFrame.limits);
    patch({xPercent:bounded.xPercent,yPercent:bounded.yPercent,widthPercent:bounded.widthPercent,heightPercent:bounded.heightPercent});
  };
 const labels=fa?['همه','فرد','زوج','اول','آخر','صفحه / برگه جاری','انتخاب دلخواه']:['All','Odd','Even','First','Last','Current','Custom selection'];
 const scopes:OverlayScope[]=['all','odd','even','first','last','current','selected'];
 return <aside data-text-control-panel aria-label={fa?'تنظیمات شماره صفحه':'Page numbering controls'} className="w-full bg-white p-3 text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200 space-y-2">
   <div className="flex items-center justify-between"><strong>{fa?'تنظیمات شماره صفحه':'Page numbering'}</strong>
     <button type="button" disabled={!pages.length} onClick={()=>addNumberingOverlay()} className="rounded bg-sky-600 px-2 py-1 text-white hover:bg-sky-500 disabled:opacity-40 cursor-pointer">{fa?'+ شماره':'+ Number'}</button></div>
   <div role="tablist" aria-label={fa?'شماره‌های صفحه':'Page numbers'} className="flex gap-1 overflow-x-auto">{numbers.map((n,i)=><button key={n.id} role="tab" type="button" aria-selected={n.id===item.id} onClick={()=>selectOverlay(n.id)} className={`shrink-0 rounded px-2 py-1 cursor-pointer ${n.id===item.id?'bg-sky-600 text-white':'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}>{fa?`شماره ${i+1}`:`Number ${i+1}`}{n.enabled?'':' (پنهان)'}</button>)}</div>
   <p className="text-slate-500 dark:text-slate-400">{fa?'شماره را روی صفحه بکشید یا با دستگیره اندازه کادر را تغییر دهید.':'Drag the number on the page or resize its box using the handles.'}</p>
   <label className="block">{fa?'متن و قالب':'Text and template'}<textarea data-numbering-template ref={templateRef} aria-label={fa?'قالب شماره':'Number template'} dir="auto" className={input} rows={2} value={item.template} onChange={e=>patch({template:e.target.value})}/></label>
   <div className="flex flex-wrap gap-1">{['{page}','{total}','{serial}','{pad3}','{pad4}','{pad6}'].map(token=><button type="button" key={token} onClick={()=>insertToken(token)} className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 cursor-pointer">{token}</button>)}</div>
   <div className="flex flex-wrap gap-1">{([['super','Superscript','بالانویس','^{…}'],['sub','Subscript','زیرنویس','_{…}']] as const).map(([script,en,faLabel,syntax])=><button key={script} type="button" title={syntax} aria-label={fa?faLabel:en} onClick={()=>wrapSelection(script)} className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 cursor-pointer">{fa?faLabel:en}</button>)}</div>
   <p className="text-slate-500 dark:text-slate-400">{fa?'برای بالانویس/زیرنویس، بخشی از قالب را انتخاب کنید (مثلاً th در Page {page}^{th}).':'For superscript/subscript, select part of the template (for example th in Page {page}^{th}).'}</p>
   <label className="block">{fa?'فرمول شماره':'Number formula'}<input aria-label={fa?'فرمول شماره':'Number formula'} dir="ltr" className={input} maxLength={160} value={item.customScript} placeholder="page+1000" onChange={e=>patch({customScript:e.target.value})}/></label>
   <p className="text-slate-500 dark:text-slate-400">{fa?'مثلاً page+1000 یا page-2؛ فقط محاسبات محدود، بدون اجرای کد.':'For example page+1000 or page-2; bounded arithmetic only, not code execution.'}</p>
   {formulaError && <p role="alert" className="text-rose-600 dark:text-rose-300">{fa?`فرمول نامعتبر: ${formulaError}`:`Invalid formula: ${formulaError}`}</p>}
   {previewText ? <p className="text-slate-700 dark:text-slate-300">{fa
     ? ((item.sequenceBasis??'page')==='grid'?'پیش‌نمایش برای خانهٔ جاری روی شیت:':'پیش‌نمایش برای صفحهٔ جاری:')
     : ((item.sequenceBasis??'page')==='grid'?'Preview for the current cell on the sheet:':'Preview for the current page:')} <span dir="auto" className="font-semibold">{previewText}</span></p> : <p role="alert" className="text-amber-600 dark:text-amber-300">{fa?'قالب یا فرمول برای این صفحه قابل محاسبه نیست؛ شمارهٔ چاپی نشان داده نمی‌شود تا اصلاح شود.':'This template or formula cannot be computed for this page; nothing will print until it is fixed.'}</p>}
   <label className="block">{fa?'عدد شروع':'Starting number'}<input aria-label={fa?'عدد شروع':'Starting number'} type="number" min="-999999999" max="999999999" className={input} value={item.startOffset} onChange={e=>{if(e.target.value && Number.isSafeInteger(+e.target.value))patch({startOffset:+e.target.value});}}/></label>
   <label className="block">{fa?'نوع شماره':'Number format'}<select aria-label={fa?'نوع شماره':'Number format'} className={input} value={item.format} onChange={e=>patch({format:e.target.value as PageOverlayNumbering['format']})}>{['persian','english','roman','abjad'].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
   <label className="block">{fa?'تعداد رقم سریال (۰ بدون صفر)':'Serial padding (0 for none)'}<input aria-label={fa?'تعداد رقم سریال':'Serial padding'} type="number" min="0" max="10" className={input} value={item.padZeros} onChange={e=>patch({padZeros:Math.max(0,Math.min(10,Number(e.target.value)))})}/></label>
   <div className="space-y-1">
     <div className="flex items-center justify-between gap-1">
       <span>{fa?'فونت':'Font'}</span>
       <button type="button" data-refresh-system-fonts onClick={()=>{void refreshSystemFonts();}} disabled={fontsLoading} className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
         {fontsLoading ? (fa?'در حال خواندن...':'Scanning...') : (fa?`فونت‌های سیستم (${systemFonts.length})`:`System fonts (${systemFonts.length})`)}
       </button>
     </div>
     <select aria-label={fa?'فونت شماره':'Number font'} className={input} value={item.fontFamily} onChange={e=>patch({fontFamily:e.target.value})} style={{fontFamily:`"${item.fontFamily}", sans-serif`}}>
       <optgroup label={fa?'فونت‌های همراه برنامه':'Bundled fonts'}>
         {bundledFonts.map(f=><option key={`b:${f}`} value={f} style={{fontFamily:`"${f}", sans-serif`}}>{f}</option>)}
       </optgroup>
       {systemFonts.length > 0 && (
         <optgroup label={fa?'فونت‌های نصب‌شده سیستم':'Installed system fonts'}>
           {systemFonts.map(f=><option key={`s:${f}`} value={f} style={{fontFamily:`"${f}", sans-serif`}}>{f}</option>)}
         </optgroup>
       )}
     </select>
     <div className="flex items-center gap-1">
       <input type="text" dir="ltr" aria-label={fa?'نام دلخواه فونت سیستم برای شماره':'Custom system font name for number'} value={customFont} onChange={e=>setCustomFont(e.target.value)} placeholder={fa?'مثلاً B Nazanin یا Tahoma':'e.g. B Nazanin or Segoe UI'} className={input}/>
       <button type="button" disabled={!customFont.trim()} onClick={()=>{const f=customFont.trim();if(f){patch({fontFamily:f});setCustomFont('');}}} className="shrink-0 rounded border border-slate-300 bg-slate-100 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-200 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 cursor-pointer">{fa?'اعمال':'Use'}</button>
     </div>
   </div>
   <label className="block">{fa?'اندازه فونت':'Font size'} {item.fontSize} pt<input aria-label={fa?'اندازه فونت شماره':'Number font size'} type="range" min="8" max="80" value={item.fontSize} onChange={e=>patch({fontSize:+e.target.value})} className="w-full"/></label>
   <div className="grid grid-cols-2 gap-1.5">
     <label className="block">{fa?'عرض باکس (mm)':'Box width (mm)'}<input aria-label={fa?'عرض باکس شماره (mm)':'Number box width (mm)'} type="number" dir="ltr" min="4" step="0.5" value={boxWidthMm} onChange={e=>updateBoxSizeMm('w',+e.target.value)} className={input}/></label>
     <label className="block">{fa?'ارتفاع باکس (mm)':'Box height (mm)'}<input aria-label={fa?'ارتفاع باکس شماره (mm)':'Number box height (mm)'} type="number" dir="ltr" min="4" step="0.5" value={boxHeightMm} onChange={e=>updateBoxSizeMm('h',+e.target.value)} className={input}/></label>
   </div>
   <label className="block">{fa?'رنگ':'Color'}<input aria-label={fa?'رنگ شماره':'Number color'} type="color" value={/^#[0-9a-f]{6}$/i.test(item.color)?item.color:'#000000'} onChange={e=>patch({color:e.target.value})}/></label>
   <div className="flex flex-wrap gap-1">{(['bold','italic'] as const).map((k,i)=><button type="button" key={k} aria-label={(fa?['درشت','کج']:['Bold','Italic'])[i]} aria-pressed={item[k]} onClick={()=>patch({[k]:!item[k]})} className={`rounded px-2 py-1 cursor-pointer ${item[k]?'bg-sky-600 text-white':'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}>{k==='bold'?'B':'I'}</button>)}
   {(['left','center','right','justify'] as const).map(a=>{const label=fa?{left:'چپ',center:'وسط',right:'راست',justify:'جاستیفای'}[a]:{left:'Left',center:'Center',right:'Right',justify:'Justify'}[a];return <button type="button" key={a} title={label} aria-label={`${fa?'چینش':'Align'} ${a}`} aria-pressed={(item.align??'center')===a} onClick={()=>patch({align:a})} className={`rounded px-2 py-1 cursor-pointer ${(item.align??'center')===a?'bg-sky-600 text-white':'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}>{fa?label:a[0].toUpperCase()}</button>;})}</div>
   <label className="flex items-center gap-1.5"><input type="checkbox" aria-label={fa?'قفل نسبت ابعاد شماره':'Lock number aspect ratio'} checked={item.lockAspect ?? true} onChange={e=>patch({lockAspect:e.target.checked})}/>
     {fa?'قفل نسبت ابعاد در تغییر اندازه':'Lock aspect ratio while resizing'} <span className="text-slate-500 dark:text-slate-400">({fa?'Shift موقتاً باز می‌کند':'Shift unlocks it'})</span></label>
   <label className="block">{fa?'شفافیت':'Opacity'} {Math.round(item.opacity*100)}%<input aria-label={fa?'شفافیت شماره':'Number opacity'} type="range" min="10" max="100" value={item.opacity*100} onChange={e=>patch({opacity:+e.target.value/100})} className="w-full"/></label>
   <label className="block">{fa?'چرخش':'Rotation'} {item.rotation}°<input aria-label={fa?'چرخش شماره':'Number rotation'} type="range" min="0" max="360" value={item.rotation} onChange={e=>patch({rotation:+e.target.value})} className="w-full"/></label>
   <label className="block">{fa?'مبنا':'Attach to'}<select aria-label={fa?'مبنای شماره':'Number target'} className={input} value={item.target} onChange={e=>setScope(item.targetScope,e.target.value as OverlayTarget)}><option value="page">{fa?'داخل محتوای صفحه':'Inside document page'}</option><option value="cell">{fa?'هر سلول / خانه چاپی':'Each imposed cell'}</option><option value="sheet">{fa?'کل برگه خروجی':'Whole output sheet'}</option></select></label>
   <label className="block">{fa?'مبنای شمارش':'Counting basis'}<select data-numbering-basis aria-label={fa?'مبنای شمارش':'Numbering basis'} className={input} value={item.sequenceBasis??'page'}
     onChange={e=>patch({sequenceBasis:e.target.value as NonNullable<PageOverlayNumbering['sequenceBasis']>})}>
     <option value="page">{fa?'شماره صفحهٔ سند (مستقل از چیدمان)':'Document page number (independent of the layout)'}</option>
     <option value="grid">{fa?'ترتیب خانه‌ها روی شیت (جدول / بوکلت)':'Cell order on the printed sheet (grid / booklet)'}</option>
     <option value="cut-stack">{fa?'دسته‌بندی عمقی (برش و چیدمان پشت سر هم)':'Cut & Stack (pile serial across sheets)'}</option>
     <option value="sheet">{fa?'شمارهٔ برگهٔ خروجی':'Output sheet number'}</option>
   </select></label>
   {((item.sequenceBasis??'page')==='grid' || item.sequenceBasis==='cut-stack') && <label className="block">{fa?'جهت شمارش':'Counting direction'}<select data-numbering-direction aria-label={fa?'جهت شمارش':'Numbering direction'} className={input} value={item.sequenceDirection??'ltr'}
     onChange={e=>patch({sequenceDirection:e.target.value as NonNullable<PageOverlayNumbering['sequenceDirection']>})}>
     <option value="ltr">{fa?'ردیف‌ها، از چپ به راست':'Rows, left to right'}</option>
     <option value="rtl">{fa?'ردیف‌ها، از راست به چپ':'Rows, right to left'}</option>
     <option value="ttb">{fa?'ستون‌ها، از بالا به پایین':'Columns, top to bottom'}</option>
     <option value="btt">{fa?'ستون‌ها، از پایین به بالا':'Columns, bottom to top'}</option>
     <option value="zigzag">{fa?'زیگزاگ (مارپیچی)':'Zigzag (snake)'}</option>
   </select></label>}
   <label className="block">{fa?'دامنه':'Scope'}<select aria-label={fa?'دامنه شماره':'Number scope'} className={input} value={item.targetScope} onChange={e=>setScope(e.target.value as OverlayScope)}>{scopes.map((scope,i)=><option key={scope} value={scope}>{labels[i]}</option>)}</select></label>
   <label className="block">{item.target==='sheet'?(fa?'برگه‌های دلخواه':'Chosen output sheets'):(fa?'صفحات / سلول‌های دلخواه':'Chosen pages / cells')}<input aria-label={fa?'بازه شماره‌گذاری':'Numbering range'} dir="ltr" className={input} value={range} placeholder="1, 3-5" onChange={e=>{setRange(e.target.value);setRangeError(false);}}/></label>
   <button type="button" onClick={applyRange} className="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 cursor-pointer">{fa?'اعمال بازه':'Apply range'}</button>
   {rangeError && <p role="alert" className="text-rose-600 dark:text-rose-300">{fa?'شماره یا بازه معتبر وارد کنید.':'Enter valid numbers or ranges.'}</p>}
   <p className="text-slate-500 dark:text-slate-400">{fa?'زوج و فرد بر اساس ترتیب صفحه‌های فضای کار یا برگه‌های خروجی است؛ انتخاب بازه وضعیت چاپ را تغییر نمی‌دهد.':'Odd/even use workspace page order or output-side order. Ranges do not change print selection.'}</p>
   <div className="flex flex-wrap gap-1">
     <button type="button" aria-pressed={item.enabled} onClick={()=>patch({enabled:!item.enabled})} className={`rounded px-2 py-1 cursor-pointer ${item.enabled?'bg-sky-600 text-white':'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}>{fa?'فعال بودن':'Enabled'}</button>
     <button type="button" onClick={()=>addOverlay({...item,id:globalThis.crypto?.randomUUID?.()??`number-${Date.now()}`,targetScope:item.targetScope==='all'?'odd':item.targetScope==='odd'?'even':'all'})} className="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 cursor-pointer">{fa?'افزودن شمارهٔ مستقل دیگر':'Add another independent number'}</button>
   </div>
   <p className="text-slate-500 dark:text-slate-400">{fa?'برای صفحات زوج و فرد می‌توانید دو شمارهٔ مستقل با قالب و جای متفاوت بسازید؛ کلیدهای جهت‌نما شماره را جابه‌جا می‌کنند (Shift برای گام بزرگ‌تر).':'Create two independent numbers with different templates and positions for even and odd pages; arrow keys nudge the number (Shift for a bigger step).'}</p>
   <button type="button" onClick={()=>removeOverlay(item.id)} className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-900 dark:text-rose-100 cursor-pointer">{fa?'حذف شماره‌گذاری':'Delete numbering'}</button>
 </aside>;
}
