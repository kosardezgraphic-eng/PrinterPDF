import { useEffect, useState } from 'react';

/** Only the two matrix dimensions are editable; preserve an empty draft while typing. */
export function MatrixSizeFields({ rows, cols, language, onChange }: {
  rows:number; cols:number; language:string; onChange:(rows:number,cols:number)=>void;
}) {
  const [rowDraft,setRowDraft] = useState(String(rows));
  const [colDraft,setColDraft] = useState(String(cols));
  useEffect(() => setRowDraft(String(rows)),[rows]);
  useEffect(() => setColDraft(String(cols)),[cols]);
  const fa = language === 'fa';
  const fields = [
    { id:'rows', label:fa?'تعداد ردیف':'Rows', value:rowDraft, set:setRowDraft, current:rows },
    { id:'cols', label:fa?'تعداد ستون':'Columns', value:colDraft, set:setColDraft, current:cols },
  ] as const;
  return <div className="flex items-center gap-2 border-e border-slate-800 pe-3" aria-label={fa?'اندازه ماتریس':'Matrix size'}>
    {fields.map(field => {
      const commit = (value:number) => {
        const v = Math.max(1,Math.min(10,Math.floor(value)));
        if (field.id === 'rows') { field.set(String(v)); if (v !== rows) onChange(v,cols); }
        else { field.set(String(v)); if (v !== cols) onChange(rows,v); }
      };
      return <label key={field.id} className="flex flex-col gap-1 text-[10px] font-semibold text-slate-400">
        <span>{field.label}</span>
        <input aria-label={field.label} type="number" inputMode="numeric" min={1} max={10} step={1} value={field.value}
          onChange={e => {
            const raw=e.target.value; field.set(raw); const number=Number(raw);
            if (raw !== '' && Number.isInteger(number) && number>=1 && number<=10 && number!==field.current) commit(number);
          }}
          onBlur={() => { const v=Number(field.value); if (field.value === '' || !Number.isFinite(v)) field.set(String(field.current)); else commit(v); }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          className="w-16 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white" />
      </label>;
    })}
  </div>;
}
