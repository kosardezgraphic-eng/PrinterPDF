import { useId, useRef, useState, type PointerEvent } from 'react';
import type { ComputedSheetSide, LayoutSettings, MeasurementUnit } from '@shared/models';
import { convertMmToUnit } from '../engine/layoutEngine';
import { measurement, measureEndpoint, moveLayoutGuide, type Guide, type Point } from '../engine/sheetInteraction';

interface GuideProps {
  sheet: ComputedSheetSide; layout: LayoutSettings; pxPerMm: number; spaceDown: boolean;
  language: string; unit: MeasurementUnit; onDraft: (layout: LayoutSettings | null) => void;
  onCommit: (layout: LayoutSettings) => void;
}
/** Global, uniform gutters are changed by dragging the trailing edge of a gap. */
export function LayoutGuides({ sheet, layout, pxPerMm, spaceDown, language, unit, onDraft, onCommit }: GuideProps) {
  const guideId = useId();
  const dragging = useRef<{ pointer: number; x: number; y: number; scaleX: number; scaleY: number; guide: Guide; base: LayoutSettings } | null>(null);
  const rectRef = useRef<HTMLDivElement>(null);
  const begin = (e: PointerEvent<HTMLButtonElement>, guide: Guide) => {
    if (spaceDown || (e.pointerType === 'mouse' && e.button !== 0) || dragging.current) return;
    const rect = rectRef.current!.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    e.preventDefault(); e.stopPropagation();
    dragging.current = { pointer:e.pointerId, x:e.clientX, y:e.clientY, scaleX:sheet.widthMm/rect.width, scaleY:sheet.heightMm/rect.height, guide, base:layout };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const movedLayout = (e: PointerEvent<HTMLButtonElement>) => {
    const d = dragging.current;
    return d && d.pointer === e.pointerId ? moveLayoutGuide(d.base, sheet, d.guide, (e.clientX-d.x)*d.scaleX, (e.clientY-d.y)*d.scaleY) : null;
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => { const next = movedLayout(e); if (next) { e.preventDefault(); e.stopPropagation(); onDraft(next); } };
  const finish = (e: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const d = dragging.current;
    if (!d || d.pointer !== e.pointerId) return;
    const next = cancel ? null : movedLayout(e);
    dragging.current = null; onDraft(null); e.preventDefault(); e.stopPropagation();
    if (next && (JSON.stringify(next.marginsMm) !== JSON.stringify(d.base.marginsMm) || next.horizontalGutterMm !== d.base.horizontalGutterMm || next.verticalGutterMm !== d.base.verticalGutterMm)) onCommit(next);
  };
  const fa = language === 'fa';
  const margins = layout.marginsMm;
  const rows = Math.max(1,Math.min(10,Math.floor(layout.rows))), cols = Math.max(1,Math.min(10,Math.floor(layout.cols)));
  const cellW = Math.max(5, (Math.max(10,sheet.widthMm-margins.left-margins.right)-(cols-1)*Math.max(0,layout.horizontalGutterMm))/cols);
  const cellH = Math.max(5, (Math.max(10,sheet.heightMm-margins.top-margins.bottom)-(rows-1)*Math.max(0,layout.verticalGutterMm))/rows);
  const guides: { guide:Guide; x:number; y:number; label:string; cursor:string }[] = [
    {guide:{type:'margin',side:'left'},x:margins.left,y:sheet.heightMm/4,label:fa?'حاشیه چپ':'Left margin',cursor:'ew-resize'},
    {guide:{type:'margin',side:'right'},x:sheet.widthMm-margins.right,y:sheet.heightMm/4,label:fa?'حاشیه راست':'Right margin',cursor:'ew-resize'},
    {guide:{type:'margin',side:'top'},x:sheet.widthMm/4,y:margins.top,label:fa?'حاشیه بالا':'Top margin',cursor:'ns-resize'},
    {guide:{type:'margin',side:'bottom'},x:sheet.widthMm/4,y:sheet.heightMm-margins.bottom,label:fa?'حاشیه پایین':'Bottom margin',cursor:'ns-resize'},
    ...Array.from({length:cols-1},(_,index) => ({guide:{type:'gutter',axis:'horizontal',index} as Guide,
      x:margins.left+(index+1)*cellW+(index+1)*Math.max(0,layout.horizontalGutterMm),y:margins.top+(sheet.heightMm-margins.top-margins.bottom)*.35,
      label:fa?`فاصله ستون‌ها ${index+1} (همه ستون‌ها)`:`Column gutter ${index+1} (all columns)`,cursor:'ew-resize'})),
    ...Array.from({length:rows-1},(_,index) => ({guide:{type:'gutter',axis:'vertical',index} as Guide,
      x:margins.left+(sheet.widthMm-margins.left-margins.right)*.35,y:margins.top+(index+1)*cellH+(index+1)*Math.max(0,layout.verticalGutterMm),
      label:fa?`فاصله ردیف‌ها ${index+1} (همه ردیف‌ها)`:`Row gutter ${index+1} (all rows)`,cursor:'ns-resize'})),
  ];
  return <div ref={rectRef} data-layout-guides className="pointer-events-none absolute inset-0 z-[15]">
    <div className="absolute border border-dashed border-emerald-600" style={{ left:margins.left*pxPerMm, right:margins.right*pxPerMm, top:margins.top*pxPerMm, bottom:margins.bottom*pxPerMm }} />
    {guides.filter(item => item.guide.type === 'gutter').map(item => <div key={`line-${item.label}`} className="absolute border-violet-600/80 border-dashed"
      style={item.guide.type === 'gutter' && item.guide.axis === 'horizontal'
        ? {left:item.x*pxPerMm, top:margins.top*pxPerMm, bottom:margins.bottom*pxPerMm, borderLeftWidth:1}
        : {top:item.y*pxPerMm, left:margins.left*pxPerMm, right:margins.right*pxPerMm, borderTopWidth:1}} />)}
    {guides.map(({guide,x,y,label}, index) => {
      const mm = guide.type === 'margin' ? margins[guide.side] : guide.axis === 'horizontal' ? layout.horizontalGutterMm : layout.verticalGutterMm;
      const value = `${convertMmToUnit(mm,unit)} ${unit}`;
      return <span key={`value-${label}`} id={`${guideId}-${index}`} data-guide-value={label} dir="ltr"
        style={{left:Math.max(2,Math.min(sheet.widthMm*pxPerMm-56,x*pxPerMm+18)),top:Math.max(2,Math.min(sheet.heightMm*pxPerMm-20,y*pxPerMm-10))}}
        className="absolute whitespace-nowrap rounded bg-white/90 px-1 text-[10px] font-semibold text-slate-800 shadow-sm">{value}</span>;
    })}
    {guides.map(({guide,x,y,label,cursor}, index) => <button key={label} type="button" aria-describedby={`${guideId}-${index}`} title={`${label}: ${convertMmToUnit(guide.type === 'margin' ? margins[guide.side] : guide.axis === 'horizontal' ? layout.horizontalGutterMm : layout.verticalGutterMm,unit)} ${unit}`} aria-label={label}
      onClick={e => e.stopPropagation()} onPointerDown={e => begin(e,guide)} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e,true)}
      onLostPointerCapture={e => finish(e,true)}
      style={{ left:x*pxPerMm, top:y*pxPerMm, cursor, touchAction:'none', transform:'translate(-50%,-50%)' }}
      className="pointer-events-auto absolute flex h-10 w-10 items-center justify-center rounded-full">
      <span aria-hidden="true" className={`h-5 w-5 rounded-full border-2 border-white shadow-md ${guide.type === 'margin' ? 'bg-emerald-600' : 'bg-violet-600'}`} />
    </button>)}
  </div>;
}

export function MeasurementTool({ sheet, unit, language, spaceDown }: { sheet: ComputedSheetSide; unit: MeasurementUnit; language: string; spaceDown: boolean }) {
  const [line,setLine] = useState<{ start:Point; end:Point } | null>(null);
  const drag = useRef<{ pointer:number; start:Point } | null>(null);
  const getPoint = (e: PointerEvent<HTMLDivElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0,Math.min(sheet.widthMm,(e.clientX-rect.left)/Math.max(1,rect.width)*sheet.widthMm)),
      y: Math.max(0,Math.min(sheet.heightMm,(e.clientY-rect.top)/Math.max(1,rect.height)*sheet.heightMm)) };
  };
  const update = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointer !== e.pointerId) return;
    e.preventDefault(); e.stopPropagation();
    setLine({ start:drag.current.start, end:measureEndpoint(drag.current.start,getPoint(e),e.shiftKey) });
  };
  const m = line && measurement(line.start,line.end);
  return <div data-measurement-overlay className="absolute inset-0 z-30 cursor-crosshair" style={{touchAction:spaceDown?'auto':'none'}}
    aria-label={language === 'fa' ? 'خط‌کش اندازه‌گیری' : 'Measurement ruler'}
    onPointerDown={e => { if (spaceDown || (e.pointerType === 'mouse' && e.button !== 0) || drag.current) return;
      e.preventDefault(); e.stopPropagation(); const start=getPoint(e); drag.current={pointer:e.pointerId,start}; setLine({start,end:start}); e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={update} onPointerUp={e => { update(e); if (drag.current?.pointer === e.pointerId) drag.current=null; }}
    onPointerCancel={e => { if (drag.current?.pointer === e.pointerId) { drag.current=null; setLine(null); } }}
    onLostPointerCapture={e => { if (drag.current?.pointer === e.pointerId) { drag.current=null; setLine(null); } }}>
    {line && m && <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${sheet.widthMm} ${sheet.heightMm}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} stroke="#e11d48" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <circle cx={line.start.x} cy={line.start.y} r="1.3" fill="#e11d48"/><circle cx={line.end.x} cy={line.end.y} r="1.3" fill="#e11d48"/>
      </svg>
      <div role="status" className="pointer-events-none absolute left-2 top-2 rounded bg-slate-900/90 px-2 py-1 text-xs text-white" dir="ltr">
        {convertMmToUnit(m.distance,unit)} {unit} · ΔX {convertMmToUnit(Math.abs(m.dx),unit)} · ΔY {convertMmToUnit(Math.abs(m.dy),unit)}
      </div>
    </>}
  </div>;
}
