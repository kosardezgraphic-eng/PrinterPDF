import { useState } from 'react';

/** Applies a centered crop; this does not lock subsequent freehand drags. */
export function AspectCropControls({ language, disabled, onApply }: {
  language:string; disabled:boolean; onApply:(ratio:number) => boolean;
}) {
  const [width,setWidth] = useState('1');
  const [height,setHeight] = useState('1');
  const [error,setError] = useState(false);
  const fa = language === 'fa';
  const w=Number(width), h=Number(height);
  const valid=width.trim() !== '' && height.trim() !== '' && Number.isFinite(w) && Number.isFinite(h) && w>0 && h>0;
  return <div className="flex flex-wrap items-center gap-1.5 text-slate-700 dark:text-slate-200" data-aspect-crop>
    <span title={fa?'نسبت عرض به ارتفاع صفحه منبع، پیش از چرخش؛ برش از مرکز':'Source width to height before rotation; centered crop'}>{fa?'نسبت برش (منبع):':'Crop ratio (source):'}</span>
    <input aria-label={fa?'عرض نسبت برش':'Crop ratio width'} type="number" min="0.01" step="any" value={width} onChange={e=>{setWidth(e.target.value);setError(false);}} className="w-14 rounded border border-slate-300 bg-white px-1 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
    <span aria-hidden="true">:</span>
    <input aria-label={fa?'ارتفاع نسبت برش':'Crop ratio height'} type="number" min="0.01" step="any" value={height} onChange={e=>{setHeight(e.target.value);setError(false);}} className="w-14 rounded border border-slate-300 bg-white px-1 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
    <button type="button" disabled={disabled || !valid} onClick={()=>setError(!onApply(w/h))} className="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-slate-800 hover:bg-slate-200 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600 cursor-pointer">{fa?'اعمال برش مرکزی':'Apply centered crop'}</button>
    {error && <span role="alert" className="text-amber-600 dark:text-amber-300">{fa?'این نسبت برای محدودهٔ برش فعلی ممکن نیست.':'Ratio cannot fit within the current crop.'}</span>}
  </div>;
}
