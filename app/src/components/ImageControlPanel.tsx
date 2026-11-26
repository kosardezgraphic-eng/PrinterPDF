import React,{useEffect,useMemo,useState} from 'react';
import type {OverlayScope,OverlayTarget,PageOverlayImage} from '@shared/models';
import {computeImpositionSheets} from '../engine/layoutEngine';
import {parseCoverageSelection,formatCoverageSelection} from '../engine/coverageSelection';
import {isImageFile,measureImage,readFileAsDataUrl} from '../engine/imageImport';
import {newOverlayId} from '../engine/imageOverlays';
import {alignOverlay, overlayPanelFrame} from '../engine/overlayGeometry';
import {popEraseShape} from '../engine/imageErase';
import {sanitizeEraseShapes} from '@shared/models';
import {useAppStore} from '../store/useAppStore';
import { describePictureFormat, planPictureEmbedding } from '../engine/imageFormat';
import {
  collectStudioSheetPeers,
  resolveStudioOverlayAlignPercent,
  type AlignDirection,
  type AlignReferenceMode,
} from '../engine/alignEngine';

type PanelAlignRef = 'auto' | AlignReferenceMode;

const input='w-full rounded border border-slate-300 bg-white p-1 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white';
const MM_TO_PT=72/25.4;
export function ImageControlPanel(){
 const {settings,pages,layout,activePageId,activeSheetIndex,overlays,selectedOverlayId,updateOverlay,removeOverlay,addOverlay,eraseTool,eraseBrushMm,setEraseTool,setEraseBrushMm,setOverlayErase,toggleOverlayInvert}=useAppStore();
 const fa=settings.language==='fa';
 // The brush's paint and the marquee that waits for `Delete` are tool state, so they are read before the
 // early return below — a hook that appears only when a picture is selected would move every hook after it.
 const eraseColor=useAppStore(s=>s.eraseColor);
 const setEraseColor=useAppStore(s=>s.setEraseColor);
 const setErasePending=useAppStore(s=>s.setErasePending);
 const commitErasePending=useAppStore(s=>s.commitErasePending);
 const pendingOverlayId=useAppStore(s=>s.erasePending?.overlayId);
 const item=overlays.find((o):o is PageOverlayImage=>o.id===selectedOverlayId&&o.kind==='image');
 const numbers=overlays.filter((o):o is PageOverlayImage=>o.kind==='image');
 const sheets=useMemo(()=>computeImpositionSheets(pages,layout),[pages,layout]);
 const [range,setRange]=useState('');const [rangeError,setRangeError]=useState(false);
 const [alignRef,setAlignRef]=useState<PanelAlignRef>('auto');
 const [alignPeerId,setAlignPeerId]=useState<string>('all');
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
 // The box the percentages mean and the area the picture may travel in, from the same helper the drag
 // uses: a field that disagrees with the mouse is what makes an operator think the picture is stuck.
 const frame=overlayPanelFrame(sheet,item);
 const box={width:frame.boxWidthMm,height:frame.boxHeightMm};
 const eraseCount=sanitizeEraseShapes(item.erase??[]).length;
 const pendingHere=pendingOverlayId===item.id;
 const widthMm=item.widthPercent*box.width/100, heightMm=item.heightPercent*box.height/100;
 const ratio=heightMm>0?widthMm/heightMm:1;
 const setMm=(key:'width'|'height',value:number)=>{
   if(!(value>0))return;
   if(item.lockAspect){
     if(key==='width')patch({widthPercent:value/box.width*100,heightPercent:value/ratio/box.height*100});
     else patch({heightPercent:value/box.height*100,widthPercent:value*ratio/box.width*100});
   } else patch(key==='width'?{widthPercent:value/box.width*100}:{heightPercent:value/box.height*100});
 };
 const setPosition=(key:'x'|'y',value:number)=>{
   // Negative and over-the-edge numbers are allowed on purpose: that is the picture hanging into the
   // margin or past the trim line for a bleed. Only the drag is limited (to its centre staying printable).
   if(!Number.isFinite(value))return;
   patch(key==='x'?{xPercent:value/box.width*100}:{yPercent:value/box.height*100});
 };
 const pageIndices=new Map(pages.map((p,i)=>[p.id,i]));
 const peers=collectStudioSheetPeers(sheet,sheets.length,pages,overlays,pageIndices,`overlay:${item.id}`,settings.language);
 const effAlignRef:PanelAlignRef=alignRef==='others'&&peers.length===0?'auto':alignRef;
 const selectedPeer=alignPeerId!=='all'?peers.find(p=>p.id===alignPeerId)??null:null;
 const otherBoxes=selectedPeer?[selectedPeer.box]:peers.map(p=>p.box);
 const align=(where:AlignDirection)=>{
   if(effAlignRef==='auto'||!sheet){
     const moved=alignOverlay({xPercent:item.xPercent,yPercent:item.yPercent,widthPercent:item.widthPercent,heightPercent:item.heightPercent},where,frame.limits);
     patch({xPercent:moved.xPercent,yPercent:moved.yPercent});
     return;
   }
   const moved=resolveStudioOverlayAlignPercent(sheet,item,where,effAlignRef,otherBoxes);
   if(moved)patch({xPercent:moved.xPercent,yPercent:moved.yPercent});
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
 return <aside data-text-control-panel aria-label={fa?'تنظیمات تصویر روی صفحه':'Picture overlay controls'} className="w-full bg-white p-3 text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200 space-y-2">
   <div className="flex items-center justify-between"><strong>{fa?'تنظیمات تصویر':'Picture'}</strong>
     <button type="button" onClick={()=>addOverlay({...item,id:newOverlayId(),xPercent:item.xPercent+5,yPercent:item.yPercent+5})} className="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 cursor-pointer">{fa?'+ نسخه':'+ Copy'}</button></div>
   <div role="tablist" aria-label={fa?'تصویرها':'Pictures'} className="flex gap-1 overflow-x-auto">{numbers.map((n,i)=><button key={n.id} role="tab" type="button" aria-selected={n.id===item.id} onClick={()=>useAppStore.getState().selectOverlay(n.id)} className={`shrink-0 rounded px-2 py-1 cursor-pointer ${n.id===item.id?'bg-sky-600 text-white':'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}>{fa?`تصویر ${i+1}`:`Picture ${i+1}`}</button>)}</div>
   <p className="truncate text-slate-500 dark:text-slate-400" title={item.name}>{item.name} · {item.naturalWidth}×{item.naturalHeight}px</p>
   <label className="block">{fa?'جای تصویر':'Placement'}<select data-image-placement aria-label={fa?'جای تصویر':'Image placement'} className={input}
     value={item.target==='sheet'&&item.sheetFill==='each-cell'?'each-cell':'whole'}
     onChange={e=>{
       // Two different questions in one control because they are one decision for the operator: is this
       // picture on the printed side, or on every cell of it? `whole` puts it on the side; `each-cell` asks
       // for the repetition explicitly, which is the only way it is allowed to happen.
       if(e.target.value==='each-cell'){
         const currentSheet=sheets[Math.min(activeSheetIndex,Math.max(0,sheets.length-1))];
         patch({target:'sheet',targetScope:'all',sheetFill:'each-cell',targetSheetIndices:undefined,
           ...(currentSheet?{targetSheetIndex:currentSheet.sideIndex}:{})});
       } else patch({target:'sheet',targetScope:'all',sheetFill:'whole',targetSheetIndices:undefined});
     }}>
     <option value="whole">{fa?'روی کل شیت (یک‌بار)':'Across the whole sheet (once)'}</option>
     <option value="each-cell">{fa?'در همهٔ خانه‌ها (تکرار)':'In every cell (repeat)'}</option>
   </select></label>
   {item.target!=='sheet' && <p className="text-[10px] leading-4 text-amber-600 dark:text-amber-300">{fa
     ? 'این تصویر روی یک خانه است، نه کل شیت. برای اینکه روی همهٔ خانه‌ها بیاید، «در همهٔ خانه‌ها» را انتخاب کنید.'
     : 'This picture sits in one cell, not on the sheet. Choose “In every cell” to repeat it across the sheet.'}</p>}
   {item.target==='sheet' && item.sheetFill!=='each-cell' && <p className="text-[10px] leading-4 text-slate-500 dark:text-slate-400">{fa
     ? 'روی شیت چیده شده و به همان یک شکل چاپ می‌شود؛ در ماتریس تکرار نمی‌شود.'
     : 'Placed once on the sheet and printed once — it is not repeated by the matrix.'}</p>}
   <label className="block">{fa?'جایگزینی تصویر':'Replace picture'}<input data-image-source type="file" accept="image/*,.tif,.tiff,.psd,.webp,.heic,.heif,.bmp,.svg" className={input} onChange={e=>void replace(e.target.files?.[0])}/></label>
   <div className="flex gap-1">
     <label className="flex-1">{fa?'عرض (میلی‌متر)':'Width (mm)'}<input aria-label={fa?'عرض تصویر':'Image width'} type="number" min="1" max="2000" step="0.1" className={input} value={Number(widthMm.toFixed(2))} onChange={e=>setMm('width',Number(e.target.value))}/></label>
     <label className="flex-1">{fa?'ارتفاع (میلی‌متر)':'Height (mm)'}<input aria-label={fa?'ارتفاع تصویر':'Image height'} type="number" min="1" max="2000" step="0.1" className={input} value={Number(heightMm.toFixed(2))} onChange={e=>setMm('height',Number(e.target.value))}/></label>
   </div>
   <label className="flex items-center gap-1.5"><input type="checkbox" aria-label={fa?'قفل نسبت ابعاد':'Lock aspect ratio'} checked={!!item.lockAspect} onChange={e=>patch({lockAspect:e.target.checked})}/>
     {fa?'قفل نسبت ابعاد':'Lock aspect ratio'} <span className="text-slate-500 dark:text-slate-400">({fa?'Shift هنگام کشیدن':'Shift while dragging'})</span></label>
   <div className="flex gap-1">
     <label className="flex-1">{fa?'X (میلی‌متر)':'X (mm)'}<input aria-label={fa?'مختصاف X تصویر':'Image X'} data-image-x type="number" step="0.1" className={input} value={Number((item.xPercent*box.width/100).toFixed(2))} onChange={e=>setPosition('x',Number(e.target.value))}/></label>
     <label className="flex-1">{fa?'Y (میلی‌متر)':'Y (mm)'}<input aria-label={fa?'مختصاف Y تصویر':'Image Y'} data-image-y type="number" step="0.1" className={input} value={Number((item.yPercent*box.height/100).toFixed(2))} onChange={e=>setPosition('y',Number(e.target.value))}/></label>
   </div>
   <div className="space-y-1">
     <label className="block">{fa?'مبنای تراز':'Align reference'}
       <select data-image-align-reference aria-label={fa?'مبنای تراز تصویر':'Image align reference'} className={input} value={effAlignRef} onChange={e=>setAlignRef(e.target.value as PanelAlignRef)}>
         <option value="auto">{fa?'کادر جاری (پیش‌فرض)':'Current container (default)'}</option>
         <option value="sheet">{fa?'نسبت به کل شیت':'To whole sheet'}</option>
         <option value="margins">{fa?'نسبت به حاشیه چاپ':'To margins'}</option>
         <option value="cell">{fa?'نسبت به خانه':'To cell'}</option>
         <option value="others" disabled={peers.length===0}>{fa?`نسبت به دیگر تصاویر (${peers.length})`:`To other images (${peers.length})`}</option>
       </select>
     </label>
     {effAlignRef==='others' && peers.length>1 && (
       <select data-image-align-peer aria-label={fa?'تصویر مرجع':'Reference image'} className={input} value={selectedPeer?selectedPeer.id:'all'} onChange={e=>setAlignPeerId(e.target.value)}>
         <option value="all">{fa?'مجموعه دیگر تصاویر شیت':'All other items on sheet'}</option>
         {peers.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
       </select>
     )}
     <div className="grid grid-cols-3 gap-1">
       {(['left','hcenter','right','top','vcenter','bottom'] as const).map(where=>
         <button key={where} type="button" data-image-align={where} title={where} onClick={()=>align(where)}
           className="rounded border border-slate-300 bg-slate-100 px-1 py-1 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 cursor-pointer">{where==='left'?(fa?'چپ':'Left'):where==='hcenter'?(fa?'وسط':'Centre'):where==='right'?(fa?'راست':'Right')
           :where==='top'?(fa?'بالا':'Top'):where==='vcenter'?(fa?'میانه':'Middle'):(fa?'پایین':'Bottom')}</button>)}
     </div>
   </div>
   <p className="text-[10px] leading-4 text-slate-500">
     {fa
       ? 'مقدار منفی یعنی بیرون از کادر محتوا؛ تصویر تا جایی که مرکزش روی برگه بماند می‌تواند از لبه بیرون بزند (برای بلید).'
       : 'A negative value is outside the content box. A picture may hang over the edge as far as its centre stays on the sheet — that is how a bleed is placed.'}
   </p>
   <label className="block">{fa?'نحوهٔ پر کردن کادر':'Fit'}<select aria-label={fa?'نحوهٔ پر کردن':'Fit'} className={input} value={item.fit??'fill'} onChange={e=>patch({fit:e.target.value as 'fill'|'contain'})}>
     <option value="fill">{fa?'کشیدن به اندازهٔ کادر':'Stretch to the box'}</option><option value="contain">{fa?'جای دادن با حفظ نسبت':'Contain (letterbox)'}</option></select></label>
   <div className="flex flex-wrap gap-1">
     <button type="button" aria-pressed={!!item.flipHorizontal} onClick={()=>patch({flipHorizontal:!item.flipHorizontal})} className={`rounded px-2 py-1 cursor-pointer ${item.flipHorizontal?'bg-sky-600 text-white':'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}>{fa?'آینه افقی':'Flip H'}</button>
     <button type="button" aria-pressed={!!item.flipVertical} onClick={()=>patch({flipVertical:!item.flipVertical})} className={`rounded px-2 py-1 cursor-pointer ${item.flipVertical?'bg-sky-600 text-white':'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}>{fa?'آینه عمودی':'Flip V'}</button>
     {([0,90,180,270] as const).map(deg=><button key={deg} type="button" onClick={()=>patch({rotation:deg})} className={`rounded px-2 py-1 cursor-pointer ${item.rotation===deg?'bg-sky-600 text-white':'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}>{deg}°</button>)}
   </div>
   <label className="block">{fa?'چرخش':'Rotation'} {item.rotation}°<input aria-label={fa?'چرخش تصویر':'Image rotation'} type="range" min="0" max="360" step="0.1" value={item.rotation} onChange={e=>patch({rotation:+e.target.value})} className="w-full"/></label>
   <label className="block">{fa?'شفافیت':'Opacity'} {Math.round(item.opacity*100)}%<input aria-label={fa?'شفافیت تصویر':'Image opacity'} type="range" min="10" max="100" value={item.opacity*100} onChange={e=>patch({opacity:+e.target.value/100})} className="w-full"/></label>
   <div className="space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700" data-erase-panel>
     <div className="flex items-center justify-between"><strong>{fa?'پاک‌کن':'Eraser'}</strong>
       <span className="text-slate-500 dark:text-slate-400" data-erase-count>{fa?`${eraseCount} حرکت`:`${eraseCount} stroke(s)`}</span></div>
     <p className="text-[10px] leading-4 text-slate-500">{fa
       ? 'روی هر جای تصویر که دکمهٔ ماوس گرفته شود قلم‌مو کار می‌کند؛ اگر رنگی انتخاب کرده باشید به‌جای سوراخ کردن، همان رنگ را می‌گذارد. دو بار کلیک روی دکمهٔ روشن، پاک‌کن را خاموش می‌کند.'
       : 'The brush works wherever the mouse button is held down on the picture; with a colour chosen it lays that colour instead of cutting a hole. Pressing the lit button again turns the eraser off.'}</p>
     <div className="flex gap-1">
       <button type="button" data-erase-tool="brush" aria-pressed={eraseTool==='brush'} onClick={()=>setEraseTool(eraseTool==='brush'?'off':'brush')} title={fa?'با کشیدن قلم‌مو، بخشی از تصویر پاک می‌شود':'Drag a brush over the picture to erase it'} className={`flex-1 rounded px-2 py-1 cursor-pointer ${eraseTool==='brush'?'bg-rose-600 text-white':'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}>{fa?'قلم‌مو':'Brush'}</button>
       <button type="button" data-erase-tool="region" aria-pressed={eraseTool==='region'} onClick={()=>setEraseTool(eraseTool==='region'?'off':'region')} title={fa?'یک کادر بکشید، بعد Delete بزنید':'Drag a rectangle, then press Delete to apply it'} className={`flex-1 rounded px-2 py-1 cursor-pointer ${eraseTool==='region'?'bg-rose-600 text-white':'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}>{fa?'ناحیه':'Region'}</button>
       <button type="button" data-erase-tool="picker" aria-pressed={eraseTool==='picker'} onClick={()=>setEraseTool(eraseTool==='picker'?'off':'picker')} title={fa?'روی تصویر کلیک کنید تا رنگ آن نقطه، رنگ قلم‌مو شود':'Click on the picture to make its colour the brush colour'} className={`flex-1 rounded px-2 py-1 cursor-pointer ${eraseTool==='picker'?'bg-amber-500 text-slate-950':'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}>{fa?'قطره‌چکان':'Pick'}</button>
     </div>
     {eraseTool!=='off' && <label className="block">{fa?`قطر قلم (میلی‌متر) = ${eraseBrushMm}`:`Brush diameter (mm) = ${eraseBrushMm}`}
       <input data-erase-size aria-label={fa?'قطر پاک‌کن':'Eraser size'} type="number" min="0.2" max="500" step="0.1" className={input} value={Number(eraseBrushMm.toFixed(2))} onChange={e=>setEraseBrushMm(Number(e.target.value))}/></label>}
     {eraseTool!=='off' && <label className="flex items-center gap-1.5">
       <span className="text-[10px] text-slate-500 dark:text-slate-400">{fa?'رنگ قلم':'Brush colour'}</span>
       <input data-erase-color type="color" aria-label={fa?'رنگ قلم پاک‌کن':'Eraser brush colour'} value={eraseColor??'#ffffff'} onChange={e=>setEraseColor(e.target.value)} className="h-6 w-9 cursor-pointer rounded border border-slate-300 bg-white p-0.5 dark:border-slate-600 dark:bg-slate-800"/>
       <button type="button" data-erase-color="hole" onClick={()=>setEraseColor(null)} className={`rounded px-1.5 py-0.5 cursor-pointer ${!eraseColor?'bg-rose-600 text-white':'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'}`}>{fa?'سوراخ':'Hole'}</button>
     </label>}
     {pendingHere && <div className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 p-1.5 dark:border-slate-700 dark:bg-slate-800" data-erase-pending>
       <span className="flex-1 text-[10px] leading-4 text-amber-800 dark:text-amber-300">{fa
         ? 'کادر انتخاب شد؛ برای اعمال روی تصویر Delete را بزنید (Esc بی‌اثرش می‌کند).'
         : 'Region selected — press Delete to apply it to the picture (Esc throws it away).'}</span>
       <button type="button" data-erase-apply onClick={commitErasePending} className="rounded bg-rose-600 px-1.5 py-0.5 text-white cursor-pointer">{fa?'اعمال':'Apply'}</button>
       <button type="button" data-erase-discard onClick={()=>setErasePending(null)} className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 cursor-pointer">{fa?'بی‌خیال':'Discard'}</button>
     </div>}
     <div className="flex gap-1">
       <button type="button" data-erase-undo disabled={!eraseCount} onClick={()=>setOverlayErase(item.id,popEraseShape(item.erase))} className={`flex-1 rounded px-2 py-1 ${eraseCount?'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 cursor-pointer':'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'}`}>{fa?'یک حرکت برگرد':'Undo one stroke'}</button>
       <button type="button" data-erase-restore disabled={!eraseCount} onClick={()=>setOverlayErase(item.id,[])} className={`flex-1 rounded px-2 py-1 ${eraseCount?'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 cursor-pointer':'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'}`}>{fa?'بازگرداندن تصویر':'Restore picture'}</button>
     </div>
     {eraseCount>0 && <p className="text-[10px] leading-4 text-amber-700 dark:text-amber-300">{fa
       ? 'فایل اصلی دست‌نخورده است: پاک‌کن فقط شکلِ پاک‌شده را کنار می‌گذارد، پس هر حرکت با Ctrl+Z هم برگشت‌پذیر است.'
       : 'The file itself is untouched — an erase is stored beside it, so every stroke is also reversible with Ctrl+Z.'}</p>}
   </div>
   <button type="button" data-image-invert aria-pressed={!!item.invert} onClick={()=>toggleOverlayInvert([item.id])} title={fa?'بار دوم همان قبلی را برمی‌گرداند، نه یک معکوس دیگر':'Pressing it again returns the previous look, it does not invert twice'} className={`w-full rounded px-2 py-1 cursor-pointer ${item.invert?'bg-fuchsia-600 text-white':'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'}`}>{item.invert?(fa?'لغو معکوس رنگ تصویر':'Undo picture inversion'):(fa?'معکوس رنگ تصویر':'Invert picture colours')}</button>
   {(() => {
     const plan = planPictureEmbedding(item.src);
     return <p className="text-slate-500 dark:text-slate-400" data-picture-format="">{fa ? 'فایل' : 'File'}: {describePictureFormat(item.src, { width: item.naturalWidth, height: item.naturalHeight })}
       {plan.notes.length ? <span className="text-amber-600 dark:text-amber-300"> · {plan.notes.join(' · ')}</span> : null}</p>;
   })()}
   <label className="block">{fa?'مبنا':'Attach to'}<select aria-label={fa?'مبنای تصویر':'Image target'} className={input} value={item.target} onChange={e=>setScope(item.targetScope,e.target.value as OverlayTarget)}>
     <option value="page">{fa?'صفحه سند':'Document page'}</option><option value="sheet">{fa?'برگه خروجی':'Output sheet'}</option></select></label>
   <label className="block">{fa?'دامنه':'Scope'}<select aria-label={fa?'دامنه تصویر':'Image scope'} className={input} value={item.targetScope} onChange={e=>setScope(e.target.value as OverlayScope)}>{scopes.map((scope,i)=><option key={scope} value={scope}>{labels[i]}</option>)}</select></label>
   {item.targetScope==='selected' && <>
     <label className="block">{item.target==='page'?(fa?'شماره صفحات':'Chosen pages'):(fa?'شماره برگه‌ها':'Chosen sheets')}
       <input aria-label={fa?'بازه تصویر':'Image range'} dir="ltr" className={input} value={range} placeholder="1, 3-5" onChange={e=>{setRange(e.target.value);setRangeError(false);}}/></label>
     <button type="button" onClick={applyRange} className="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 cursor-pointer">{fa?'اعمال بازه':'Apply range'}</button>
     {rangeError && <p role="alert" className="text-rose-600 dark:text-rose-300">{fa?'شماره یا بازه معتبر وارد کنید.':'Enter valid numbers or ranges.'}</p>}
   </>}
   <p className="text-slate-500 dark:text-slate-400">{fa?'کشیدن روی کادر، اندازهٔ کادر را عوض می‌کند؛ برای تصویرِ بدون کشیدگی، قفل نسبت ابعاد را روشن نگه دارید.':'Dragging a handle resizes the box; keep the ratio locked to avoid stretching the picture.'}</p>
   <button type="button" onClick={()=>removeOverlay(item.id)} className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-900 dark:text-rose-100 cursor-pointer">{fa?'حذف تصویر':'Delete picture'}</button>
   <p className="text-slate-500">{fa?'حجم تصویر در فایل پروژه نگه داشته می‌شود؛ برای پروژه‌های سنگین، تصویر را کوچک کنید.':'The picture is stored inside the project file; downscale large images to keep projects small.'}</p>
 </aside>;
}
