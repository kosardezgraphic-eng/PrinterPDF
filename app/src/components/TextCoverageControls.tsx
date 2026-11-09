import React, {useEffect, useState} from 'react';
import type {PageItem, PageOverlayText} from '@shared/models';
import {formatCoverageSelection, parseCoverageSelection} from '../engine/coverageSelection';

interface Props {
  text: PageOverlayText;
  pages: PageItem[];
  sheetCount: number;
  fa: boolean;
  update: (patch: Partial<PageOverlayText>) => void;
}

export function TextCoverageControls({text,pages,sheetCount,fa,update}:Props) {
  const target=text.target;
  const indices=()=>{
    if(target==='sheet')return text.coverageSheetIndices??[];
    const ids=new Set(text.coveragePageIds??[]);
    return pages.flatMap((page,index)=>ids.has(page.id)?[index+1]:[]);
  };
  const [selection,setSelection]=useState(()=>formatCoverageSelection(indices()));
  const [error,setError]=useState(false);
  // Only saved selections or the target type reset the draft, not unrelated style edits.
  useEffect(()=>{setSelection(formatCoverageSelection(indices()));setError(false);},[text.id,target,text.coveragePageIds,text.coverageSheetIndices]);
  const isAll=text.coverageMode==='all', isSelected=text.coverageMode==='selected';
  const applySelection=()=>{
    try {
      const numbers=parseCoverageSelection(selection,target==='page'?pages.length:sheetCount);
      update(target==='page'?{coverageMode:'selected',coveragePageIds:numbers.map(n=>pages[n-1].id)}:{coverageMode:'selected',coverageSheetIndices:numbers});
      setError(false);
    } catch {setError(true);}
  };
  return <fieldset className="space-y-2 rounded border border-slate-600 p-2">
    <legend>{fa?'گسترش دامنه متن':'Extend text coverage'}</legend>
    <p className="text-slate-400">{fa?'علاوه بر دامنه اصلی؛ با خاموش‌کردن به دامنه اصلی برمی‌گردد.':'Adds to the base scope; turning it off restores the base scope.'}</p>
    <button type="button" aria-pressed={isAll} onClick={()=>update({coverageMode:isAll?undefined:'all'})} className={`rounded px-2 py-1 ${isAll?'bg-sky-700':'bg-slate-700'}`}>
      {fa?'اعمال روی تمام صفحات':'Apply to all'}
    </button>
    <label className="block">{target==='page'?(fa?'شماره صفحات دلخواه':'Chosen page numbers'):(fa?'شماره برگه‌های خروجی دلخواه':'Chosen output sheet numbers')}
      <input aria-label={target==='page'?(fa?'شماره صفحات دلخواه':'Chosen page numbers'):(fa?'شماره برگه‌های خروجی دلخواه':'Chosen output sheet numbers')} dir="ltr" value={selection} onChange={e=>{setSelection(e.target.value);setError(false);}} placeholder="1, 3-5" className="mt-1 w-full rounded border border-slate-600 bg-slate-800 p-1 text-xs text-white"/>
    </label>
    <p className="text-slate-400">{target==='page'?(fa?'شماره‌ها بر اساس ترتیب تمام صفحات سندها هستند.':'Numbers use the order of all workspace pages.'):(fa?'شماره‌ها بر اساس ترتیب برگه‌های خروجی هستند.':'Numbers use output-side order.')}</p>
    {error && <p role="alert" className="text-rose-300">{fa?`شماره یا بازه معتبر از ۱ تا ${target==='page'?pages.length:sheetCount} وارد کنید.`:`Enter valid numbers or ranges from 1 to ${target==='page'?pages.length:sheetCount}.`}</p>}
    <div className="flex flex-wrap gap-1">
      <button type="button" aria-pressed={isSelected} onClick={()=>isSelected?update({coverageMode:undefined}):applySelection()} className={`rounded px-2 py-1 ${isSelected?'bg-sky-700':'bg-slate-700'}`}>
        {fa?'اعمال روی صفحات دلخواه':'Apply to chosen'}
      </button>
      {isSelected && <button type="button" onClick={applySelection} className="rounded bg-slate-700 px-2 py-1">{fa?'به‌روزرسانی انتخاب':'Update selection'}</button>}
    </div>
  </fieldset>;
}
