import React, { useEffect, useMemo, useState } from 'react';
import type { OverlayScope, OverlayTarget, PageOverlayShape, ShapeType } from '@shared/models';
import { useAppStore } from '../store/useAppStore';
import { computeImpositionSheets } from '../engine/layoutEngine';
import { formatCoverageSelection, parseCoverageSelection } from '../engine/coverageSelection';
import { alignOverlay, overlayPanelFrame } from '../engine/overlayGeometry';
import { newOverlayId } from '../engine/imageOverlays';
import { normalizeShapeStyle, SHAPE_LINE_CAPS, SHAPE_NAMES, SHAPE_STROKE_STYLES, SHAPE_TYPES, shapeCapabilities, shapeHasFill } from '../engine/shapes';
import { ShapePreview, shapeLabel } from './ShapePreview';

/**
 * Every control a drawn shape has, in one side panel.
 *
 * The panel is deliberately blunt about units: sizes are millimetres, a stroke width is points — the unit
 * a print shop quotes in — and the X/Y fields accept values outside the page box, because a shape that
 * cannot hang over the edge cannot do a bleed. Colours go through `normalizeShapeStyle`, the same clamp
 * the store applies, so a pasted value cannot put anything but a hex colour in front of the renderer.
 */

const input = 'w-full rounded border border-slate-600 bg-slate-800 p-1 text-xs text-white';
const chip = 'rounded px-2 py-1 cursor-pointer';

const SWATCHES = ['#000000', '#ffffff', '#ef4444', '#f59e0b', '#22c55e', '#0ea5e9', '#6366f1', '#ec4899'];

export function ShapeControlPanel() {
  const settings = useAppStore(state => state.settings);
  const pages = useAppStore(state => state.pages);
  const layout = useAppStore(state => state.layout);
  const overlays = useAppStore(state => state.overlays);
  const selectedOverlayId = useAppStore(state => state.selectedOverlayId);
  const activePageId = useAppStore(state => state.activePageId);
  const activeSheetIndex = useAppStore(state => state.activeSheetIndex);
  const updateOverlay = useAppStore(state => state.updateOverlay);
  const removeOverlay = useAppStore(state => state.removeOverlay);
  const addOverlay = useAppStore(state => state.addOverlay);
  const selectOverlay = useAppStore(state => state.selectOverlay);
  const reorderOverlay = useAppStore(state => state.reorderOverlay);
  const item = overlays.find((o): o is PageOverlayShape => o.id === selectedOverlayId && o.kind === 'shape');
  const sheets = useMemo(() => computeImpositionSheets(pages, layout), [pages, layout]);
  const [range, setRange] = useState('');
  const [rangeError, setRangeError] = useState(false);
  const isFa = settings.language === 'fa';

  useEffect(() => {
    if (!item || item.targetScope !== 'selected') { setRange(''); return; }
    if (item.target === 'sheet' && item.targetSheetIndices) { setRange(formatCoverageSelection(item.targetSheetIndices)); return; }
    const ids = new Set(item.targetPageIds);
    setRange(formatCoverageSelection(pages.flatMap((page, index) => ids.has(page.id) ? [index + 1] : [])));
  }, [item?.id, item?.target, item?.targetScope, item?.targetPageIds, item?.targetSheetIndices, pages]);

  if (!item) return null;
  const caps = shapeCapabilities(item.type);
  const patch = (value: Partial<PageOverlayShape>) => updateOverlay(item.id, normalizeShapeStyle(value));
  const sheet = sheets[Math.min(activeSheetIndex, Math.max(0, sheets.length - 1))];
  // The box the percentages mean, and the area the shape may be moved inside — both from one place, so a
  // field and a drag cannot disagree about where the edge of the page is.
  const frame = overlayPanelFrame(sheet, item);
  const box = { width: frame.boxWidthMm, height: frame.boxHeightMm };
  const widthMm = item.widthPercent * box.width / 100, heightMm = item.heightPercent * box.height / 100;
  const ratio = heightMm > 0 ? widthMm / heightMm : 1;
  const setSize = (key: 'width' | 'height', value: number) => {
    if (!(value > 0)) return;
    if (item.lockAspect) {
      if (key === 'width') patch({ widthPercent: value / box.width * 100, heightPercent: value / ratio / box.height * 100 });
      else patch({ heightPercent: value / box.height * 100, widthPercent: value * ratio / box.width * 100 });
    } else patch(key === 'width' ? { widthPercent: value / box.width * 100 } : { heightPercent: value / box.height * 100 });
  };
  const setPosition = (key: 'x' | 'y', value: number) => {
    // Negative and over-the-edge values are allowed on purpose: that is the shape hanging off the page.
    // The drag stops when its centre leaves the printable area; a typed number is an explicit decision.
    if (!Number.isFinite(value)) return;
    patch(key === 'x' ? { xPercent: value / box.width * 100 } : { yPercent: value / box.height * 100 });
  };
  const setScope = (scope: OverlayScope, target: OverlayTarget = item.target) => {
    const side = Math.min(activeSheetIndex + 1, Math.max(1, sheets.length));
    const pageIds = scope === 'current' ? item.targetPageIds : scope === 'selected' ? pages.filter(p => p.selectedForPrint).map(p => p.id) : item.targetPageIds;
    const sheetIds = scope === 'selected' ? sheets.filter(s => s.cells.some(c => c.page?.selectedForPrint)).map(s => s.sideIndex) : [];
    patch({ target, targetScope: scope, targetPageIds: pageIds, targetSheetIndex: side, ...(target === 'sheet' ? { targetSheetIndices: sheetIds } : { targetSheetIndices: undefined }) });
    setRange(scope === 'selected' ? formatCoverageSelection(target === 'sheet' ? sheetIds : pages.flatMap((p, i) => pageIds.includes(p.id) ? [i + 1] : [])) : '');
    setRangeError(false);
  };
  const applyRange = () => {
    try {
      const numbers = parseCoverageSelection(range, item.target === 'page' ? pages.length : sheets.length);
      patch(item.target === 'page'
        ? { targetScope: 'selected', targetPageIds: numbers.map(n => pages[n - 1]?.id).filter(Boolean) as string[] }
        : { targetScope: 'selected', targetSheetIndices: numbers });
      setRangeError(false);
    } catch { setRangeError(true); }
  };
  const scopes: OverlayScope[] = ['current', 'all', 'odd', 'even', 'first', 'last', 'selected'];
  const scopeLabels = isFa
    ? ['صفحه جاری', 'همه صفحات', 'فرد', 'زوج', 'اول', 'آخر', 'انتخاب دلخواه']
    : ['Current page', 'All pages', 'Odd', 'Even', 'First', 'Last', 'Custom selection'];

  return (
    <aside data-shape-control-panel aria-label={isFa ? 'تنظیمات شکل هندسی' : 'Shape controls'}
      className="w-64 shrink-0 overflow-y-auto border-s border-slate-700 bg-slate-900 p-3 text-xs text-slate-200 space-y-2">
      <div className="flex items-center justify-between">
        <strong className="flex items-center gap-1.5">
          <ShapePreview type={item.type} size={18} shape={item} className="text-sky-300" />
          {isFa ? 'تنظیمات شکل' : 'Shape'}
        </strong>
        <button type="button" data-shape-duplicate
          title={isFa ? 'یک نسخه با همان تنظیمات کنارش گذاشته می‌شود' : 'Put a copy of this shape beside it'}
          onClick={() => addOverlay({ ...item, id: newOverlayId(), xPercent: Math.min(90, item.xPercent + 4), yPercent: Math.min(90, item.yPercent + 4) })}
          className={`${chip} bg-slate-700`}>{isFa ? '+ نسخه' : '+ Copy'}</button>
      </div>

      {/* 1. the outline itself */}
      <div>
        <p className="mb-1 text-slate-400">{isFa ? 'شکل' : 'Shape'}</p>
        <div className="grid grid-cols-5 gap-1" role="group" aria-label={isFa ? 'نوع شکل' : 'Shape type'}>
          {SHAPE_TYPES.map(type => (
            <button key={type} type="button" data-shape-type={type} aria-pressed={item.type === type}
              title={shapeLabel(type, isFa)}
              onClick={() => patch({ type, ...(type === 'rounded-rect' && !(item.borderRadius > 0) ? { borderRadius: 3 } : {}) })}
              className={`flex items-center justify-center rounded-lg border py-1.5 cursor-pointer ${item.type === type ? 'border-sky-400 bg-sky-600/30 text-white' : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>
              <ShapePreview type={type} size={20} />
            </button>
          ))}
        </div>
      </div>

      {/* 2. fill */}
      {caps.fill && (
        <div>
          <label className="flex items-center justify-between gap-1.5">
            <span className="text-slate-400">{isFa ? 'رنگ داخل' : 'Fill'}</span>
            <input data-shape-fill type="color" value={item.fillColor === 'transparent' ? '#000000' : item.fillColor}
              disabled={!shapeHasFill(item)} className="h-6 w-10 rounded border border-slate-600 bg-slate-800"
              onChange={e => patch({ fillColor: e.target.value })} />
          </label>
          <button type="button" data-shape-fill-none aria-pressed={!shapeHasFill(item)}
            onClick={() => patch({ fillColor: shapeHasFill(item) ? 'transparent' : (item.strokeColor || '#000000') })}
            className={`mt-1 w-full ${chip} ${shapeHasFill(item) ? 'bg-slate-700' : 'bg-sky-700 text-white'}`}>
            {shapeHasFill(item) ? (isFa ? 'بدون رنگ داخل' : 'No fill') : (isFa ? 'پر کردن با رنگ خط' : 'Fill with the stroke colour')}
          </button>
          <div className="mt-1 flex flex-wrap gap-1">
            {SWATCHES.map(color => (
              <button key={color} type="button" data-shape-swatch={color} aria-label={isFa ? `رنگ داخل ${color}` : `Fill ${color}`}
                onClick={() => patch({ fillColor: color })}
                className="h-4 w-4 rounded border border-slate-500 cursor-pointer" style={{ background: color }} />
            ))}
          </div>
        </div>
      )}

      {/* 3. stroke */}
      <div className="space-y-1">
        <label className="flex items-center justify-between gap-1.5">
          <span className="text-slate-400">{isFa ? 'رنگ خط' : 'Stroke'}</span>
          <input data-shape-stroke type="color" value={item.strokeColor} className="h-6 w-10 rounded border border-slate-600 bg-slate-800"
            onChange={e => patch({ strokeColor: e.target.value })} />
        </label>
        <label className="block">
          {isFa ? `ضخامت خط (${item.strokeWidth.toFixed(2)} نقطه)` : `Stroke width (${item.strokeWidth.toFixed(2)} pt)`}
          <input data-shape-stroke-width type="number" min="0" max="24" step="0.05" className={input} value={Number(item.strokeWidth.toFixed(2))}
            onChange={e => patch({ strokeWidth: Number(e.target.value) })} />
        </label>
        <input type="range" min="0" max="24" step="0.25" aria-label={isFa ? 'ضخامت خط' : 'Stroke width slider'}
          value={item.strokeWidth} onChange={e => patch({ strokeWidth: Number(e.target.value) })} className="w-full" />
        <label className="block">
          {isFa ? 'نوع خط' : 'Line style'}
          <select data-shape-stroke-style className={input} value={item.strokeStyle} onChange={e => patch({ strokeStyle: e.target.value as PageOverlayShape['strokeStyle'] })}>
            <option value="solid">{isFa ? 'مستقیم' : 'Solid'}</option>
            <option value="dashed">{isFa ? 'خط‌خطی' : 'Dashed'}</option>
            <option value="dotted">{isFa ? 'نقطه‌چین' : 'Dotted'}</option>
          </select>
        </label>
        {!shapeHasFill(item) || item.type === 'line' || item.type === 'arrow' ? (
          <label className="block">
            {isFa ? 'انتهای خط' : 'Line ends'}
            <select data-shape-line-cap className={input} value={item.lineCap ?? 'butt'} onChange={e => patch({ lineCap: e.target.value as PageOverlayShape['lineCap'] })}>
              {(SHAPE_LINE_CAPS).map(cap => <option key={cap} value={cap}>{cap === 'butt' ? (isFa ? 'مستقیم' : 'Butt') : cap === 'round' ? (isFa ? 'گرد' : 'Round') : (isFa ? 'مربعی' : 'Square')}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {/* 4. the parameters that belong to one shape only */}
      {caps.radius && (
        <label className="block">
          {isFa ? `گردی گوشه (${item.borderRadius.toFixed(1)} میلی‌متر)` : `Corner radius (${item.borderRadius.toFixed(1)} mm)`}
          <input data-shape-radius type="range" min="0" max="40" step="0.5" className="w-full" value={item.borderRadius}
            onChange={e => patch({ borderRadius: Number(e.target.value) })} />
        </label>
      )}
      {caps.sides && (
        <label className="block">
          {isFa ? `تعداد ${item.type === 'star' ? 'پر' : 'اضلاع'} (${item.sides ?? (item.type === 'star' ? 5 : 6)})` : `${item.type === 'star' ? 'Points' : 'Sides'} (${item.sides ?? (item.type === 'star' ? 5 : 6)})`}
          <input data-shape-sides type="range" min="3" max="16" step="1" className="w-full" value={item.sides ?? (item.type === 'star' ? 5 : 6)}
            onChange={e => patch({ sides: Number(e.target.value) })} />
        </label>
      )}
      {caps.inner && (
        <label className="block">
          {isFa ? `عمق ستاره (${Math.round(item.innerRadiusPercent ?? 45)}٪)` : `Star waist (${Math.round(item.innerRadiusPercent ?? 45)}%)`}
          <input data-shape-inner type="range" min="10" max="95" step="1" className="w-full" value={item.innerRadiusPercent ?? 45}
            onChange={e => patch({ innerRadiusPercent: Number(e.target.value) })} />
        </label>
      )}

      {/* 5. light and angle */}
      <label className="block">
        {isFa ? `شفافیت (${Math.round(item.opacity * 100)}٪)` : `Opacity (${Math.round(item.opacity * 100)}%)`}
        <input data-shape-opacity type="range" min="5" max="100" className="w-full" value={Math.round(item.opacity * 100)}
          onChange={e => patch({ opacity: Number(e.target.value) / 100 })} />
      </label>
      <label className="block">
        {isFa ? `چرخش (${item.rotation.toFixed(1)}°)` : `Rotation (${item.rotation.toFixed(1)}°)`}
        <input data-shape-rotation type="range" min="0" max="360" step="0.5" className="w-full" value={item.rotation}
          onChange={e => patch({ rotation: Number(e.target.value) })} />
      </label>
      <div className="flex gap-1">
        {[0, 90, 180, 270].map(deg => (
          <button key={deg} type="button" data-shape-rotation-snap={deg} onClick={() => patch({ rotation: deg })}
            className={`${chip} ${item.rotation === deg ? 'bg-sky-700 text-white' : 'bg-slate-700'}`}>{deg}°</button>
        ))}
      </div>

      {/* 6. size and place, in millimetres of the box it sits on */}
      <div className="flex gap-1">
        <label className="flex-1">{isFa ? 'عرض (م‌م)' : 'Width (mm)'}
          <input data-shape-width type="number" min="0.5" step="0.1" className={input} value={Number(widthMm.toFixed(2))} onChange={e => setSize('width', Number(e.target.value))} /></label>
        <label className="flex-1">{isFa ? 'ارتفاع (م‌م)' : 'Height (mm)'}
          <input data-shape-height type="number" min="0.5" step="0.1" className={input} value={Number(heightMm.toFixed(2))} onChange={e => setSize('height', Number(e.target.value))} /></label>
      </div>
      <label className="flex items-center gap-1.5">
        <input data-shape-lock-aspect type="checkbox" checked={!!item.lockAspect} onChange={e => patch({ lockAspect: e.target.checked })} />
        {isFa ? 'قفل نسبت ابعاد' : 'Lock aspect ratio'} <span className="text-slate-400">({isFa ? 'Shift هنگام کشیدن' : 'Shift while dragging'})</span>
      </label>
      <div className="flex gap-1">
        <label className="flex-1">X (م‌م)
          <input data-shape-x type="number" step="0.1" className={input} value={Number((item.xPercent * box.width / 100).toFixed(2))} onChange={e => setPosition('x', Number(e.target.value))} /></label>
        <label className="flex-1">Y (م‌م)
          <input data-shape-y type="number" step="0.1" className={input} value={Number((item.yPercent * box.height / 100).toFixed(2))} onChange={e => setPosition('y', Number(e.target.value))} /></label>
      </div>
      <p className="text-[10px] leading-4 text-slate-500">
        {isFa ? 'مقدار منفی یعنی بیرون از کادر محتوا — برای جا دادن شکل در حاشیه یا بلید.' : 'A negative value is outside the content box, which is how a margin or a bleed is placed.'}
      </p>
      <div className="grid grid-cols-3 gap-1">
        {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map(where => (
          <button key={where} type="button" data-shape-align={where}
            title={where}
            onClick={() => {
              const aligned = alignOverlay({ xPercent: item.xPercent, yPercent: item.yPercent, widthPercent: item.widthPercent, heightPercent: item.heightPercent }, where, frame.limits);
              patch({ xPercent: aligned.xPercent, yPercent: aligned.yPercent });
            }}
            className={`${chip} bg-slate-700 hover:bg-slate-600`}>
            {where === 'left' ? (isFa ? 'چپ' : 'Left') : where === 'hcenter' ? (isFa ? 'وسط' : 'Centre') : where === 'right' ? (isFa ? 'راست' : 'Right')
              : where === 'top' ? (isFa ? 'بالا' : 'Top') : where === 'vcenter' ? (isFa ? 'میانه' : 'Middle') : (isFa ? 'پایین' : 'Bottom')}
          </button>
        ))}
      </div>

      {/* 7. where it is printed */}
      <label className="block">{isFa ? 'مبنا' : 'Attach to'}
        <select data-shape-target className={input} value={item.target} onChange={e => setScope(item.targetScope, e.target.value as OverlayTarget)}>
          <option value="page">{isFa ? 'صفحه سند' : 'Document page'}</option>
          <option value="sheet">{isFa ? 'برگه خروجی' : 'Output sheet'}</option>
        </select>
      </label>
      <label className="block">{isFa ? 'دامنه' : 'Scope'}
        <select data-shape-scope className={input} value={item.targetScope} onChange={e => setScope(e.target.value as OverlayScope)}>
          {scopes.map((scope, index) => <option key={scope} value={scope}>{scopeLabels[index]}</option>)}
        </select>
      </label>
      {item.targetScope === 'selected' && (
        <>
          <label className="block">{item.target === 'page' ? (isFa ? 'شماره صفحات' : 'Chosen pages') : (isFa ? 'شماره برگه‌ها' : 'Chosen sheets')}
            <input data-shape-range dir="ltr" className={input} value={range} placeholder="1, 3-5" onChange={e => { setRange(e.target.value); setRangeError(false); }} /></label>
          <button type="button" data-shape-range-apply onClick={applyRange} className={`${chip} bg-slate-700`}>{isFa ? 'اعمال بازه' : 'Apply range'}</button>
          {rangeError && <p role="alert" className="text-rose-300">{isFa ? 'شماره یا بازه معتبر وارد کنید.' : 'Enter valid numbers or ranges.'}</p>}
        </>
      )}

      {/* 8. stacking, because a filled circle over a paragraph is not what was meant */}
      <div>
        <p className="mb-1 text-slate-400">{isFa ? 'ترتیب لایه' : 'Layer order'}</p>
        <div className="grid grid-cols-4 gap-1">
          {(['front', 'forward', 'backward', 'back'] as const).map(where => (
            <button key={where} type="button" data-shape-order={where} onClick={() => reorderOverlay(item.id, where)}
              title={(where === 'front' ? (isFa ? 'انتقال به روی همه اشکال' : 'Bring above the other shapes') : where === 'forward' ? (isFa ? 'یک لایه جلوتر' : 'Bring forward')
                : where === 'backward' ? (isFa ? 'یک لایه عقب‌تر' : 'Send backward') : (isFa ? 'انتقال به پشت همه اشکال' : 'Send below the other shapes'))
                // Said out loud, because the exporter paints each kind in its own pass: text and pictures
                // always land on top of shapes, and a tooltip that promises otherwise is a bug report late.
                + (isFa ? ' — متن و تصویر همیشه روی شکل‌ها چاپ می‌شوند' : ' — text and pictures always print above shapes')}
              className={`${chip} bg-slate-700 hover:bg-slate-600`}>
              {where === 'front' ? '⤒' : where === 'forward' ? '↑' : where === 'backward' ? '↓' : '⤓'}
            </button>
          ))}
        </div>
      </div>

      <p className="text-slate-400">
        {isFa
          ? 'شکل روی همان صفحه یا برگه‌هایی که دامنه‌اش را تعیین می‌کنید چاپ می‌شود؛ خطوط ویرایشگر روی کاغذ نمی‌افتند.'
          : 'A shape prints on the pages or sheets its scope selects; the editor outlines never reach the paper.'}
      </p>
      <button type="button" data-shape-delete onClick={() => removeOverlay(item.id)} className={`${chip} w-full bg-rose-900 text-rose-100 hover:bg-rose-800`}>
        {isFa ? 'حذف شکل' : 'Delete shape'}
      </button>
    </aside>
  );
}

/** The Insert-tab picker: every shape type at a glance, each one a click away. */
export function ShapePicker({ onPick }: { onPick: (type: ShapeType) => void }) {
  const isFa = useAppStore(state => state.settings.language) === 'fa';
  const hasPages = useAppStore(state => state.pages.length > 0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.('[data-shape-picker-root]')) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('pointerdown', onPointerDown); window.removeEventListener('keydown', onKeyDown); };
  }, [open]);
  return (
    <div data-shape-picker-root className="relative">
      <button type="button" data-shape-picker aria-expanded={open} disabled={!hasPages}
        title={isFa ? 'درج شکل هندسی روی صفحه' : 'Insert a geometric shape on the page'}
        onClick={() => setOpen(value => !value)}
        className="flex items-center gap-1 rounded-lg border border-violet-500 bg-violet-700 px-3 py-2 font-semibold text-white disabled:opacity-40">
        <ShapePreview type="star" size={16} className="text-white" />
        {isFa ? 'اشکال هندسی' : 'Shapes'}
      </button>
      {open && (
        <div data-shape-menu dir={isFa ? 'rtl' : 'ltr'}
          className="absolute z-50 mt-1 w-72 rounded-xl border border-slate-600 bg-slate-900 p-2 text-xs text-slate-100 shadow-2xl">
          <p className="mb-1 px-1 text-[10px] font-bold text-slate-400">
            {isFa ? 'یکی را بزنید؛ وسط صفحهٔ جاری گذاشته می‌شود و پنل تنظیماتش باز می‌شود.' : 'Pick one — it lands on the current page and its settings panel opens.'}
          </p>
          <div className="grid grid-cols-5 gap-1">
            {SHAPE_TYPES.map(type => (
              <button key={type} type="button" data-shape-tool={type} title={shapeLabel(type, isFa)} aria-label={shapeLabel(type, isFa)}
                onClick={() => { onPick(type); setOpen(false); }}
                className="flex flex-col items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-200 hover:bg-slate-700 hover:border-violet-400 cursor-pointer">
                <ShapePreview type={type} size={22} />
                <span className="text-[9px] leading-3">{SHAPE_NAMES[type][isFa ? 0 : 1]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
