import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import type { ComputedSheetSide, LayoutSettings, MarginsMm, MeasurementUnit } from '@shared/models';
import { convertMmToUnit, getDuplexFlipAxis, getEffectiveSideMarginsMm } from '../engine/layoutEngine';
import { clampMarginsToMin, measurement, measureEndpoint, moveLayoutGuide, type Guide, type Point } from '../engine/sheetInteraction';

interface GuideProps {
  sheet: ComputedSheetSide; layout: LayoutSettings; pxPerMm: number; spaceDown: boolean;
  language: string; unit: MeasurementUnit; minMargins?: MarginsMm; onDraft: (layout: LayoutSettings | null) => void;
  onCommit: (layout: LayoutSettings) => void;
}
/** Global, uniform gutters are centered in each gap and expand or shrink symmetrically toward both sides. */
export function LayoutGuides({ sheet, layout, pxPerMm, spaceDown, language, unit, minMargins, onDraft, onCommit }: GuideProps) {
  const guideId = useId();
  const dragging = useRef<{ pointer: number; x: number; y: number; scaleX: number; scaleY: number; guide: Guide; base: LayoutSettings } | null>(null);
  const [activeGuideLabel, setActiveGuideLabel] = useState<string | null>(null);
  const rectRef = useRef<HTMLDivElement>(null);
  const effectiveMinMarginsForSide = (source: LayoutSettings): MarginsMm | undefined => {
    if (!minMargins) return undefined;
    if (sheet.side !== 'back') return minMargins;
    const mirrored = getEffectiveSideMarginsMm({ ...source, marginsMm: minMargins }, 'back');
    return {
      top: Math.max(minMargins.top, mirrored.top),
      right: Math.max(minMargins.right, mirrored.right),
      bottom: Math.max(minMargins.bottom, mirrored.bottom),
      left: Math.max(minMargins.left, mirrored.left),
    };
  };
  const toEffectiveLayout = (source: LayoutSettings): LayoutSettings => {
    const sideMin = effectiveMinMarginsForSide(source);
    const clampedMargins = clampMarginsToMin(getEffectiveSideMarginsMm(source, sheet.side), sideMin);
    if (!source.booklet?.enabled) {
      return { ...source, marginsMm: clampedMargins };
    }
    const spine = Math.max(0, source.booklet.spineWidthMm);
    return {
      ...source,
      rows: 1,
      cols: 2,
      marginsMm: clampedMargins,
      horizontalGutterMm: spine,
      verticalGutterMm: 0,
    };
  };
  const effectiveLayout = toEffectiveLayout(layout);
  const begin = (e: PointerEvent<HTMLButtonElement>, guide: Guide, label: string) => {
    if (spaceDown || (e.pointerType === 'mouse' && e.button !== 0) || dragging.current) return;
    const rect = rectRef.current!.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    e.preventDefault(); e.stopPropagation();
    let resolvedGuide: Guide = guide;
    if (guide.type === 'gutter') {
      const btnRect = e.currentTarget.getBoundingClientRect();
      if (guide.axis === 'horizontal' && btnRect.width >= 16) {
        const relX = (e.clientX - btnRect.left) / btnRect.width;
        resolvedGuide = { ...guide, edge: relX <= 0.35 ? 'leading' : relX >= 0.65 ? 'trailing' : 'center' };
      } else if (guide.axis === 'vertical' && btnRect.height >= 16) {
        const relY = (e.clientY - btnRect.top) / btnRect.height;
        resolvedGuide = { ...guide, edge: relY <= 0.35 ? 'leading' : relY >= 0.65 ? 'trailing' : 'center' };
      } else {
        resolvedGuide = { ...guide, edge: 'center' };
      }
    }
    dragging.current = { pointer:e.pointerId, x:e.clientX, y:e.clientY, scaleX:sheet.widthMm/rect.width, scaleY:sheet.heightMm/rect.height, guide:resolvedGuide, base:layout };
    setActiveGuideLabel(label);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const movedLayout = (e: PointerEvent<HTMLButtonElement>) => {
    const d = dragging.current;
    if (!d || d.pointer !== e.pointerId) return null;
    const baseEffective = toEffectiveLayout(d.base);
    const sideMin = effectiveMinMarginsForSide(d.base);
    const dxMm = (e.clientX - d.x) * d.scaleX;
    const dyMm = (e.clientY - d.y) * d.scaleY;
    const moved = moveLayoutGuide(baseEffective, sheet, d.guide, dxMm, dyMm, sideMin);
    if (!d.base.booklet?.enabled) {
      return {
        ...moved,
        marginsMm: getEffectiveSideMarginsMm({ ...d.base, marginsMm: moved.marginsMm }, sheet.side),
      };
    }
    if (d.guide.type === 'margin') {
      const nextSide = Math.max(0, Math.round(moved.marginsMm[d.guide.side] * 10) / 10);
      const axis = getDuplexFlipAxis(d.base);
      const targetSide =
        sheet.side !== 'back'
          ? d.guide.side
          : axis === 'horizontal'
            ? d.guide.side === 'left'
              ? 'right'
              : d.guide.side === 'right'
                ? 'left'
                : d.guide.side
            : axis === 'vertical'
              ? d.guide.side === 'top'
                ? 'bottom'
                : d.guide.side === 'bottom'
                  ? 'top'
                  : d.guide.side
              : d.guide.side;
      return {
        ...d.base,
        marginsMm: { ...d.base.marginsMm, [targetSide]: nextSide },
      };
    }
    const nextSpine = Math.max(0, Math.min(30, Math.round(moved.horizontalGutterMm * 10) / 10));
    return {
      ...d.base,
      booklet: { ...d.base.booklet, spineWidthMm: nextSpine },
    };
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => { const next = movedLayout(e); if (next) { e.preventDefault(); e.stopPropagation(); onDraft(next); } };
  const finish = (e: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const d = dragging.current;
    if (!d || d.pointer !== e.pointerId) return;
    const next = cancel ? null : movedLayout(e);
    dragging.current = null; setActiveGuideLabel(null); onDraft(null); e.preventDefault(); e.stopPropagation();
    if (next && (JSON.stringify(next.marginsMm) !== JSON.stringify(d.base.marginsMm) || next.horizontalGutterMm !== d.base.horizontalGutterMm || next.verticalGutterMm !== d.base.verticalGutterMm || JSON.stringify(next.booklet) !== JSON.stringify(d.base.booklet))) onCommit(next);
  };
  const fa = language === 'fa';
  const margins = effectiveLayout.marginsMm;
  const rows = Math.max(1,Math.min(100,Math.floor(effectiveLayout.rows))), cols = Math.max(1,Math.min(100,Math.floor(effectiveLayout.cols)));
  const hGutterMm = Math.max(0, effectiveLayout.horizontalGutterMm);
  const vGutterMm = Math.max(0, effectiveLayout.verticalGutterMm);
  const minCell = rows > 20 || cols > 20 ? 0.5 : 5;
  const cellW = Math.max(minCell, (Math.max(10,sheet.widthMm-margins.left-margins.right)-(cols-1)*hGutterMm)/cols);
  const cellH = Math.max(minCell, (Math.max(10,sheet.heightMm-margins.top-margins.bottom)-(rows-1)*vGutterMm)/rows);
  const guides: { guide:Guide; x:number; y:number; startMm?:number; endMm?:number; label:string; cursor:'col-resize'|'row-resize'; horizontal:boolean }[] = [
    {guide:{type:'margin',side:'left'},x:margins.left,y:sheet.heightMm/4,label:fa?'حاشیه چپ':'Left margin',cursor:'col-resize',horizontal:false},
    {guide:{type:'margin',side:'right'},x:sheet.widthMm-margins.right,y:sheet.heightMm/4,label:fa?'حاشیه راست':'Right margin',cursor:'col-resize',horizontal:false},
    {guide:{type:'margin',side:'top'},x:sheet.widthMm/4,y:margins.top,label:fa?'حاشیه بالا':'Top margin',cursor:'row-resize',horizontal:true},
    {guide:{type:'margin',side:'bottom'},x:sheet.widthMm/4,y:sheet.heightMm-margins.bottom,label:fa?'حاشیه پایین':'Bottom margin',cursor:'row-resize',horizontal:true},
    ...Array.from({length:cols-1},(_,index) => {
      const startMm = margins.left + (index + 1) * cellW + index * hGutterMm;
      const endMm = startMm + hGutterMm;
      const centerMm = startMm + hGutterMm / 2;
      return {
        guide:{type:'gutter',axis:'horizontal',index} as Guide,
        x:centerMm,
        y:margins.top+(sheet.heightMm-margins.top-margins.bottom)*.35,
        startMm,
        endMm,
        label:fa?`فاصله ستون‌ها ${index+1} (همه ستون‌ها)`:`Column gutter ${index+1} (all columns)`,
        cursor:'col-resize' as const,
        horizontal:false,
      };
    }),
    ...Array.from({length:rows-1},(_,index) => {
      const startMm = margins.top + (index + 1) * cellH + index * vGutterMm;
      const endMm = startMm + vGutterMm;
      const centerMm = startMm + vGutterMm / 2;
      return {
        guide:{type:'gutter',axis:'vertical',index} as Guide,
        x:margins.left+(sheet.widthMm-margins.left-margins.right)*.35,
        y:centerMm,
        startMm,
        endMm,
        label:fa?`فاصله ردیف‌ها ${index+1} (همه ردیف‌ها)`:`Row gutter ${index+1} (all rows)`,
        cursor:'row-resize' as const,
        horizontal:true,
      };
    }),
  ];
  const hatchPattern = 'repeating-linear-gradient(135deg, rgba(100,116,139,0.34) 0px, rgba(100,116,139,0.34) 2px, rgba(148,163,184,0.12) 2px, rgba(148,163,184,0.12) 6px)';
  const innerWidthPx = Math.max(16, (sheet.widthMm - margins.left - margins.right) * pxPerMm);
  const innerHeightPx = Math.max(16, (sheet.heightMm - margins.top - margins.bottom) * pxPerMm);
  return <div ref={rectRef} data-layout-guides className="pointer-events-none absolute inset-0 z-[15]">
    <div className="absolute border border-dashed border-slate-500/80" style={{ left:margins.left*pxPerMm, right:margins.right*pxPerMm, top:margins.top*pxPerMm, bottom:margins.bottom*pxPerMm }} />
    {guides.filter(item => item.guide.type === 'gutter').flatMap(item => {
      const isColGutter = item.guide.type === 'gutter' && item.guide.axis === 'horizontal';
      const startMm = item.startMm ?? (isColGutter ? item.x : item.y);
      const endMm = item.endMm ?? startMm;
      const positions = endMm - startMm > 0.05 ? [startMm, endMm] : [isColGutter ? item.x : item.y];
      return positions.map((posMm, edgeIdx) => (
        <div
          key={`line-${item.label}-${edgeIdx}`}
          className="absolute border-slate-500/80 border-dashed"
          style={isColGutter
            ? { left: posMm * pxPerMm, top: margins.top * pxPerMm, bottom: margins.bottom * pxPerMm, borderLeftWidth: 1 }
            : { top: posMm * pxPerMm, left: margins.left * pxPerMm, right: margins.right * pxPerMm, borderTopWidth: 1 }}
        />
      ));
    })}
    {guides.map(({guide,x,y,label}, index) => {
      const mm = guide.type === 'margin' ? margins[guide.side] : guide.axis === 'horizontal' ? (effectiveLayout.booklet?.enabled ? effectiveLayout.booklet.spineWidthMm : effectiveLayout.horizontalGutterMm) : effectiveLayout.verticalGutterMm;
      const value = `${convertMmToUnit(mm,unit)} ${unit}`;
      const isActive = activeGuideLabel === label;
      const bandCenterStyle = isActive
        ? guide.type === 'margin'
          ? guide.side === 'left'
            ? { left: (margins.left * pxPerMm) / 2, top: (margins.top + (sheet.heightMm - margins.top - margins.bottom) / 2) * pxPerMm, transform: 'translate(-50%, -50%)' }
            : guide.side === 'right'
              ? { left: (sheet.widthMm - margins.right / 2) * pxPerMm, top: (margins.top + (sheet.heightMm - margins.top - margins.bottom) / 2) * pxPerMm, transform: 'translate(-50%, -50%)' }
              : guide.side === 'top'
                ? { left: (margins.left + (sheet.widthMm - margins.left - margins.right) / 2) * pxPerMm, top: (margins.top * pxPerMm) / 2, transform: 'translate(-50%, -50%)' }
                : { left: (margins.left + (sheet.widthMm - margins.left - margins.right) / 2) * pxPerMm, top: (sheet.heightMm - margins.bottom / 2) * pxPerMm, transform: 'translate(-50%, -50%)' }
          : guide.axis === 'horizontal'
            ? { left: x * pxPerMm, top: (margins.top + (sheet.heightMm - margins.top - margins.bottom) / 2) * pxPerMm, transform: 'translate(-50%, -50%)' }
            : { left: (margins.left + (sheet.widthMm - margins.left - margins.right) / 2) * pxPerMm, top: y * pxPerMm, transform: 'translate(-50%, -50%)' }
        : guide.type === 'gutter'
          ? { left: Math.max(24, Math.min(sheet.widthMm * pxPerMm - 24, x * pxPerMm)), top: Math.max(12, Math.min(sheet.heightMm * pxPerMm - 12, y * pxPerMm)), transform: 'translate(-50%, -50%)' }
          : { left: Math.max(2, Math.min(sheet.widthMm * pxPerMm - 56, x * pxPerMm + 14)), top: Math.max(2, Math.min(sheet.heightMm * pxPerMm - 20, y * pxPerMm - 10)) };
      return <span key={`value-${label}`} id={`${guideId}-${index}`} data-guide-value={label} dir="ltr"
        style={bandCenterStyle}
        className={`absolute z-[16] whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold shadow-sm ${isActive ? 'bg-slate-900/90 text-white' : 'bg-white/90 text-slate-800'}`}>{value}</span>;
    })}
    {guides.map(({guide,x,y,label,cursor,horizontal}, index) => {
      const mm = guide.type === 'margin' ? margins[guide.side] : guide.axis === 'horizontal' ? (effectiveLayout.booklet?.enabled ? effectiveLayout.booklet.spineWidthMm : effectiveLayout.horizontalGutterMm) : effectiveLayout.verticalGutterMm;
      const bandThicknessPx = guide.type === 'gutter' ? Math.max(10, Math.max(0, mm) * pxPerMm) : 10;
      const stripStyle = horizontal
        ? { left: margins.left * pxPerMm, top: y * pxPerMm, width: innerWidthPx, height: bandThicknessPx, cursor, touchAction: 'none' as const, transform: 'translateY(-50%)', backgroundImage: hatchPattern }
        : { left: x * pxPerMm, top: margins.top * pxPerMm, width: bandThicknessPx, height: innerHeightPx, cursor, touchAction: 'none' as const, transform: 'translateX(-50%)', backgroundImage: hatchPattern };
      return <button key={label} type="button" aria-describedby={`${guideId}-${index}`} title={`${label}: ${convertMmToUnit(mm,unit)} ${unit}`} aria-label={label}
      onClick={e => e.stopPropagation()} onPointerDown={e => begin(e,guide,label)} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e,true)}
      onLostPointerCapture={e => finish(e,true)}
      style={stripStyle}
      className={`pointer-events-auto absolute flex items-center justify-center border-dashed border-slate-500/80 transition-colors hover:bg-slate-500/20 ${horizontal ? 'border-y' : 'border-x'}`}>
      <span aria-hidden="true" className={horizontal ? 'h-0.5 w-8 rounded-sm bg-slate-600/85' : 'h-8 w-0.5 rounded-sm bg-slate-600/85'} />
    </button>;
    })}
  </div>;
}

export function MeasurementTool({ sheet, unit, language, spaceDown }: { sheet: ComputedSheetSide; unit: MeasurementUnit; language: string; spaceDown: boolean }) {
  const [line,setLine] = useState<{ start:Point; end:Point } | null>(null);
  const drag = useRef<{ pointer:number; start:Point } | null>(null);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!line) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape' || e.key === 'Delete' || e.key === 'Backspace') {
        drag.current = null;
        setLine(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [line]);
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
      <div role="status" className="pointer-events-auto absolute left-2 top-2 flex items-center gap-2 rounded bg-slate-900/90 px-2 py-1 text-xs text-white shadow" dir="ltr"
        onPointerDown={(e) => e.stopPropagation()}>
        <span>{convertMmToUnit(m.distance,unit)} {unit} · ΔX {convertMmToUnit(Math.abs(m.dx),unit)} · ΔY {convertMmToUnit(Math.abs(m.dy),unit)}</span>
        <button
          type="button"
          data-measurement-clear
          aria-label={language === 'fa' ? 'پاک کردن اندازه' : 'Clear measurement'}
          title={language === 'fa' ? 'پاک کردن اندازه (Esc / Delete)' : 'Clear measurement (Esc / Delete)'}
          onClick={(e) => { e.stopPropagation(); drag.current = null; setLine(null); }}
          className="rounded bg-rose-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-rose-500 cursor-pointer"
        >
          ×
        </button>
      </div>
    </>}
  </div>;
}
