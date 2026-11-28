import React, { useEffect, useMemo, useState } from 'react';
import type { OverlayScope, OverlayTarget, PageOverlayShape, ShapeType } from '@shared/models';
import {
  ArrowLeftRight,
  Copy,
  Lock,
  Maximize2,
  Move,
  Plus,
  RotateCw,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { computeImpositionSheets } from '../engine/layoutEngine';
import { formatCoverageSelection, parseCoverageSelection } from '../engine/coverageSelection';
import { alignOverlay, overlayPanelFrame } from '../engine/overlayGeometry';
import { newOverlayId } from '../engine/imageOverlays';
import {
  normalizeShapeStyle,
  sanitizeShapeColor,
  SHAPE_LINE_CAPS,
  SHAPE_NAMES,
  SHAPE_TYPES,
  shapeCapabilities,
  shapeHasFill,
} from '../engine/shapes';
import { ShapePreview, shapeLabel } from './ShapePreview';
import {
  collectStudioSheetPeers,
  resolveStudioOverlayAlignPercent,
  type AlignDirection,
  type AlignReferenceMode,
} from '../engine/alignEngine';

type PanelAlignRef = 'auto' | AlignReferenceMode;

const fieldCls =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 tabular-nums transition-colors focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const btnCls =
  'inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer whitespace-nowrap';
const activeBtnCls =
  'inline-flex items-center justify-center gap-1 rounded-md border border-sky-500 bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white dark:border-sky-400 dark:bg-sky-600 cursor-pointer whitespace-nowrap';
const sectionCls = 'border-t border-slate-200/90 pt-2.5 dark:border-slate-800 space-y-2';
const sectionTitleCls = 'text-[11px] font-semibold text-slate-600 dark:text-slate-300';

const SWATCHES = ['#000000', '#ffffff', '#ef4444', '#f59e0b', '#22c55e', '#0ea5e9', '#6366f1', '#ec4899'];
const STROKE_SWATCHES = ['#000000', '#64748b', '#dc2626', '#d97706', '#16a34a', '#0284c7', '#6366f1', '#ffffff'];
const STROKE_WIDTH_PRESETS = [0.25, 0.5, 1, 2, 4];

const SHORT_SHAPE_LABELS: Record<ShapeType, [string, string]> = {
  rectangle: ['مستطیل', 'Rect'],
  square: ['مربع', 'Square'],
  'rounded-rect': ['مستطیل گرد', 'Rounded'],
  circle: ['دایره', 'Circle'],
  badge: ['حلقه', 'Ring'],
  triangle: ['مثلث', 'Triangle'],
  diamond: ['لوزی', 'Diamond'],
  polygon: ['چندضلعی', 'Polygon'],
  star: ['ستاره', 'Star'],
  line: ['خط', 'Line'],
  arrow: ['پیکان', 'Arrow'],
};

/**
 * Every control a drawn shape has, in one structured prepress side panel.
 *
 * Units stay explicit: sizes & corner radius in millimetres, stroke widths in points (`pt`), and X/Y accept
 * negative/overflow values for margin and bleed placement. All style mutations flow through `normalizeShapeStyle`.
 */
export function ShapeControlPanel() {
  const settings = useAppStore((state) => state.settings);
  const pages = useAppStore((state) => state.pages);
  const layout = useAppStore((state) => state.layout);
  const overlays = useAppStore((state) => state.overlays);
  const selectedOverlayId = useAppStore((state) => state.selectedOverlayId);
  const activeSheetIndex = useAppStore((state) => state.activeSheetIndex);
  const updateOverlay = useAppStore((state) => state.updateOverlay);
  const removeOverlay = useAppStore((state) => state.removeOverlay);
  const addOverlay = useAppStore((state) => state.addOverlay);
  const addShapeOverlay = useAppStore((state) => state.addShapeOverlay);
  const selectOverlay = useAppStore((state) => state.selectOverlay);
  const reorderOverlay = useAppStore((state) => state.reorderOverlay);

  const shapeOverlays = useMemo(
    () => overlays.filter((o): o is PageOverlayShape => o.kind === 'shape'),
    [overlays]
  );
  const item = shapeOverlays.find((o) => o.id === selectedOverlayId);
  const sheets = useMemo(() => computeImpositionSheets(pages, layout), [pages, layout]);

  const [range, setRange] = useState('');
  const [rangeError, setRangeError] = useState(false);
  const [alignRef, setAlignRef] = useState<PanelAlignRef>('auto');
  const [alignPeerId, setAlignPeerId] = useState<string>('all');
  const [fillHexDraft, setFillHexDraft] = useState('');
  const [strokeHexDraft, setStrokeHexDraft] = useState('');
  const isFa = settings.language === 'fa';

  useEffect(() => {
    if (!item) return;
    setFillHexDraft(item.fillColor === 'transparent' ? '' : item.fillColor);
    setStrokeHexDraft(item.strokeColor);
  }, [item?.id, item?.fillColor, item?.strokeColor]);

  useEffect(() => {
    if (!item || item.targetScope !== 'selected') {
      setRange('');
      return;
    }
    if (item.target === 'sheet' && item.targetSheetIndices) {
      setRange(formatCoverageSelection(item.targetSheetIndices));
      return;
    }
    const ids = new Set(item.targetPageIds);
    setRange(formatCoverageSelection(pages.flatMap((page, index) => (ids.has(page.id) ? [index + 1] : []))));
  }, [item?.id, item?.target, item?.targetScope, item?.targetPageIds, item?.targetSheetIndices, pages]);

  if (!item) return null;

  const caps = shapeCapabilities(item.type);
  const patch = (value: Partial<PageOverlayShape>) => updateOverlay(item.id, normalizeShapeStyle(value));
  const sheet = sheets[Math.min(activeSheetIndex, Math.max(0, sheets.length - 1))];
  const frame = overlayPanelFrame(sheet, item);
  const box = { width: frame.boxWidthMm, height: frame.boxHeightMm };
  const pageIndices = new Map(pages.map((p, idx) => [p.id, idx]));
  const peers = collectStudioSheetPeers(sheet, sheets.length, pages, overlays, pageIndices, `overlay:${item.id}`, settings.language);
  const effAlignRef: PanelAlignRef = alignRef === 'others' && peers.length === 0 ? 'auto' : alignRef;
  const selectedPeer = alignPeerId !== 'all' ? peers.find((p) => p.id === alignPeerId) ?? null : null;
  const otherBoxes = selectedPeer ? [selectedPeer.box] : peers.map((p) => p.box);

  const handleAlign = (where: AlignDirection) => {
    if (effAlignRef === 'auto' || !sheet) {
      const aligned = alignOverlay(
        { xPercent: item.xPercent, yPercent: item.yPercent, widthPercent: item.widthPercent, heightPercent: item.heightPercent },
        where,
        frame.limits
      );
      patch({ xPercent: aligned.xPercent, yPercent: aligned.yPercent });
      return;
    }
    const moved = resolveStudioOverlayAlignPercent(sheet, item, where, effAlignRef, otherBoxes);
    if (moved) patch({ xPercent: moved.xPercent, yPercent: moved.yPercent });
  };

  const widthMm = (item.widthPercent * box.width) / 100;
  const heightMm = (item.heightPercent * box.height) / 100;
  const ratio = heightMm > 0 ? widthMm / heightMm : 1;

  const setSize = (key: 'width' | 'height', value: number) => {
    if (!(value > 0)) return;
    if (item.lockAspect) {
      if (key === 'width') {
        patch({ widthPercent: (value / box.width) * 100, heightPercent: (value / ratio / box.height) * 100 });
      } else {
        patch({ heightPercent: (value / box.height) * 100, widthPercent: ((value * ratio) / box.width) * 100 });
      }
    } else {
      patch(key === 'width' ? { widthPercent: (value / box.width) * 100 } : { heightPercent: (value / box.height) * 100 });
    }
  };

  const setPosition = (key: 'x' | 'y', value: number) => {
    if (!Number.isFinite(value)) return;
    patch(key === 'x' ? { xPercent: (value / box.width) * 100 } : { yPercent: (value / box.height) * 100 });
  };

  const setScope = (scope: OverlayScope, target: OverlayTarget = item.target) => {
    const side = Math.min(activeSheetIndex + 1, Math.max(1, sheets.length));
    const pageIds =
      scope === 'current'
        ? item.targetPageIds
        : scope === 'selected'
          ? pages.filter((p) => p.selectedForPrint).map((p) => p.id)
          : item.targetPageIds;
    const sheetIds =
      scope === 'selected' ? sheets.filter((s) => s.cells.some((c) => c.page?.selectedForPrint)).map((s) => s.sideIndex) : [];
    patch({
      target,
      targetScope: scope,
      targetPageIds: pageIds,
      targetSheetIndex: side,
      ...(target === 'sheet' ? { targetSheetIndices: sheetIds } : { targetSheetIndices: undefined }),
    });
    setRange(
      scope === 'selected'
        ? formatCoverageSelection(target === 'sheet' ? sheetIds : pages.flatMap((p, i) => (pageIds.includes(p.id) ? [i + 1] : [])))
        : ''
    );
    setRangeError(false);
  };

  const applyRange = () => {
    try {
      const numbers = parseCoverageSelection(range, item.target === 'page' ? pages.length : sheets.length);
      patch(
        item.target === 'page'
          ? { targetScope: 'selected', targetPageIds: numbers.map((n) => pages[n - 1]?.id).filter(Boolean) as string[] }
          : { targetScope: 'selected', targetSheetIndices: numbers }
      );
      setRangeError(false);
    } catch {
      setRangeError(true);
    }
  };

  const commitHex = (field: 'fillColor' | 'strokeColor', raw: string) => {
    const trimmed = raw.trim();
    if (field === 'fillColor' && (trimmed === '' || trimmed.toLowerCase() === 'none' || trimmed.toLowerCase() === 'transparent')) {
      patch({ fillColor: 'transparent' });
      return;
    }
    const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(candidate)) {
      patch({ [field]: sanitizeShapeColor(candidate) });
    } else {
      setFillHexDraft(item.fillColor === 'transparent' ? '' : item.fillColor);
      setStrokeHexDraft(item.strokeColor);
    }
  };

  const applyStylePreset = (preset: 'outline' | 'solid' | 'cutbox' | 'highlight') => {
    if (preset === 'outline') {
      patch({
        ...(caps.fill ? { fillColor: 'transparent' } : {}),
        strokeColor: '#0f172a',
        strokeWidth: 1,
        strokeStyle: 'solid',
        opacity: 1,
      });
    } else if (preset === 'solid') {
      patch({
        ...(caps.fill ? { fillColor: '#0284c7', strokeWidth: 0 } : { strokeColor: '#0284c7', strokeWidth: 2 }),
        strokeStyle: 'solid',
        opacity: 1,
      });
    } else if (preset === 'cutbox') {
      patch({
        ...(caps.fill ? { fillColor: 'transparent' } : {}),
        strokeColor: '#dc2626',
        strokeWidth: 0.75,
        strokeStyle: 'dashed',
        opacity: 1,
      });
    } else if (preset === 'highlight') {
      patch({
        ...(caps.fill ? { fillColor: '#fde047', strokeWidth: 0 } : { strokeColor: '#f59e0b', strokeWidth: 4 }),
        strokeStyle: 'solid',
        opacity: 0.4,
      });
    }
  };

  const swapFillAndStroke = () => {
    if (!caps.fill) return;
    const prevFill = shapeHasFill(item) ? item.fillColor : 'transparent';
    const prevStroke = item.strokeWidth > 0 ? item.strokeColor : '#000000';
    patch({
      fillColor: prevStroke,
      strokeColor: prevFill === 'transparent' ? item.strokeColor : prevFill,
      strokeWidth: prevFill === 'transparent' ? 0 : Math.max(0.5, item.strokeWidth || 1),
    });
  };

  const scopes: OverlayScope[] = ['current', 'all', 'odd', 'even', 'first', 'last', 'selected'];
  const scopeLabels = isFa
    ? ['صفحه جاری', 'همه صفحات', 'فرد', 'زوج', 'اول', 'آخر', 'انتخاب دلخواه']
    : ['Current page', 'All pages', 'Odd', 'Even', 'First', 'Last', 'Custom selection'];

  return (
    <aside
      data-shape-control-panel
      aria-label={isFa ? 'تنظیمات شکل هندسی' : 'Shape controls'}
      className="w-full space-y-3 bg-white p-3 text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200"
    >
      {/* Header + quick copy & add */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-sky-600 dark:border-slate-700 dark:bg-slate-800 dark:text-sky-300">
            <ShapePreview type={item.type} size={18} shape={item} showColors />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
              {shapeLabel(item.type, isFa)}
            </div>
            <div className="text-[10px] text-slate-500 tabular-nums dark:text-slate-400">
              {widthMm.toFixed(1)} × {heightMm.toFixed(1)} {isFa ? 'م‌م' : 'mm'}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title={isFa ? 'افزودن شکل جدید' : 'Add another shape'}
            onClick={() => addShapeOverlay(item.type)}
            className={btnCls}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-shape-duplicate
            title={isFa ? 'یک نسخه با همان تنظیمات کنارش گذاشته می‌شود' : 'Put a copy of this shape beside it'}
            onClick={() =>
              addOverlay({
                ...item,
                id: newOverlayId(),
                xPercent: Math.min(90, item.xPercent + 4),
                yPercent: Math.min(90, item.yPercent + 4),
              })
            }
            className={btnCls}
          >
            <Copy className="h-3 w-3" aria-hidden="true" />
            <span>{isFa ? '+ نسخه' : '+ Copy'}</span>
          </button>
        </div>
      </div>

      {/* Multi-shape layer switcher when multiple shapes exist */}
      {shapeOverlays.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-0.5" role="tablist" aria-label={isFa ? 'لایه‌های شکل' : 'Shape layers'}>
          {shapeOverlays.map((sh, idx) => {
            const active = sh.id === item.id;
            return (
              <button
                key={sh.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectOverlay(sh.id)}
                className={active ? activeBtnCls : btnCls}
              >
                <ShapePreview type={sh.type} size={13} shape={sh} />
                <span className="tabular-nums">#{idx + 1}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 1. Shape Type Grid */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={sectionTitleCls}>{isFa ? 'نوع شکل' : 'Shape'}</span>
          <span className="text-[10px] text-slate-400 tabular-nums dark:text-slate-500">
            {SHAPE_TYPES.length} {isFa ? 'مدل' : 'types'}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={isFa ? 'نوع شکل' : 'Shape type'}>
          {SHAPE_TYPES.map((type) => {
            const selected = item.type === type;
            return (
              <button
                key={type}
                type="button"
                data-shape-type={type}
                aria-pressed={selected}
                title={shapeLabel(type, isFa)}
                onClick={() =>
                  patch({
                    type,
                    ...(type === 'rounded-rect' && !(item.borderRadius > 0) ? { borderRadius: 3 } : {}),
                  })
                }
                className={`flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-md border px-1 py-1.5 transition-colors cursor-pointer ${
                  selected
                    ? 'border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-400 dark:bg-sky-500/15 dark:text-sky-200'
                    : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800'
                }`}
              >
                <ShapePreview type={type} size={20} />
                <span className="max-w-full truncate text-[9.5px] font-medium leading-none">
                  {SHORT_SHAPE_LABELS[type][isFa ? 0 : 1]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick Print Style Presets */}
      <div className={sectionCls}>
        <span className={sectionTitleCls}>{isFa ? 'سبک سریع چاپ' : 'Quick style presets'}</span>
        <div className="grid grid-cols-4 gap-1">
          {(
            [
              { id: 'outline', label: isFa ? 'خطی' : 'Outline', dot: 'border-2 border-slate-900 bg-transparent dark:border-slate-200' },
              { id: 'solid', label: isFa ? 'پر' : 'Solid', dot: 'bg-sky-600' },
              { id: 'cutbox', label: isFa ? 'خط برش' : 'Cut box', dot: 'border-2 border-dashed border-rose-600 bg-transparent' },
              { id: 'highlight', label: isFa ? 'هایلایت' : 'Tint', dot: 'bg-amber-300/80 border border-amber-400' },
            ] as const
          ).map((preset) => (
            <button
              key={preset.id}
              type="button"
              data-shape-preset={preset.id}
              onClick={() => applyStylePreset(preset.id)}
              className={`${btnCls} flex-col gap-1 py-1.5`}
            >
              <span className={`h-3.5 w-5 rounded-[2px] ${preset.dot}`} aria-hidden="true" />
              <span className="text-[10px] leading-none">{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Fill */}
      {caps.fill && (
        <div className={sectionCls}>
          <div className="flex items-center justify-between gap-1.5">
            <span className={sectionTitleCls}>{isFa ? 'رنگ داخل' : 'Fill'}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-shape-swap-colors
                title={isFa ? 'جابه جایی رنگ داخل و خط' : 'Swap fill & stroke colours'}
                onClick={swapFillAndStroke}
                className={`${btnCls} px-1.5 py-0.5 text-[10px]`}
              >
                <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                data-shape-fill-none
                aria-pressed={!shapeHasFill(item)}
                onClick={() => patch({ fillColor: shapeHasFill(item) ? 'transparent' : item.strokeColor || '#000000' })}
                className={!shapeHasFill(item) ? activeBtnCls : btnCls}
              >
                {shapeHasFill(item) ? (isFa ? 'بدون رنگ' : 'No fill') : isFa ? 'پرکردن با خط' : 'Fill with stroke'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              data-shape-fill
              type="color"
              aria-label={isFa ? 'انتخاب رنگ داخل' : 'Pick fill color'}
              value={item.fillColor === 'transparent' ? '#000000' : item.fillColor}
              disabled={!shapeHasFill(item)}
              className="h-7 w-9 shrink-0 cursor-pointer rounded-md border border-slate-300 bg-white p-0.5 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
              onChange={(e) => patch({ fillColor: e.target.value })}
            />
            <input
              type="text"
              dir="ltr"
              aria-label={isFa ? 'کد رنگ داخل' : 'Fill hex color'}
              value={fillHexDraft}
              placeholder="transparent"
              onChange={(e) => setFillHexDraft(e.target.value)}
              onBlur={() => commitHex('fillColor', fillHexDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitHex('fillColor', fillHexDraft);
              }}
              className={`${fieldCls} font-mono`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {SWATCHES.map((color) => {
              const active = item.fillColor.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={color}
                  type="button"
                  data-shape-swatch={color}
                  aria-label={isFa ? `رنگ داخل ${color}` : `Fill ${color}`}
                  aria-pressed={active}
                  onClick={() => patch({ fillColor: color })}
                  className={`h-5 w-5 rounded border border-slate-300 transition-transform hover:scale-105 dark:border-slate-600 cursor-pointer ${
                    active ? 'ring-2 ring-sky-500 ring-offset-1 dark:ring-offset-slate-900' : ''
                  }`}
                  style={{ background: color }}
                />
              );
            })}
            <button
              type="button"
              title={isFa ? 'شفاف (بدون رنگ داخل)' : 'Transparent (no fill)'}
              aria-label={isFa ? 'شفاف (بدون رنگ داخل)' : 'Transparent fill'}
              onClick={() => patch({ fillColor: 'transparent' })}
              className={`relative h-5 w-5 overflow-hidden rounded border border-slate-300 bg-white dark:border-slate-600 cursor-pointer ${
                !shapeHasFill(item) ? 'ring-2 ring-sky-500 ring-offset-1 dark:ring-offset-slate-900' : ''
              }`}
            >
              <span className="absolute inset-0 bg-[linear-gradient(135deg,transparent_45%,#ef4444_45%,#ef4444_55%,transparent_55%)]" />
            </button>
          </div>
        </div>
      )}

      {/* 3. Stroke */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between gap-1.5">
          <span className={sectionTitleCls}>{isFa ? 'خط دور' : 'Stroke'}</span>
          <button
            type="button"
            onClick={() => patch({ strokeWidth: item.strokeWidth > 0 ? 0 : 1 })}
            className={item.strokeWidth === 0 ? activeBtnCls : btnCls}
          >
            {item.strokeWidth === 0 ? (isFa ? 'بازگردانی ۱pt' : 'Enable 1 pt') : isFa ? 'بدون خط (0pt)' : 'No stroke'}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <input
            data-shape-stroke
            type="color"
            aria-label={isFa ? 'انتخاب رنگ خط' : 'Pick stroke color'}
            value={item.strokeColor}
            className="h-7 w-9 shrink-0 cursor-pointer rounded-md border border-slate-300 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800"
            onChange={(e) => patch({ strokeColor: e.target.value })}
          />
          <input
            type="text"
            dir="ltr"
            aria-label={isFa ? 'کد رنگ خط' : 'Stroke hex color'}
            value={strokeHexDraft}
            onChange={(e) => setStrokeHexDraft(e.target.value)}
            onBlur={() => commitHex('strokeColor', strokeHexDraft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitHex('strokeColor', strokeHexDraft);
            }}
            className={`${fieldCls} font-mono`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {STROKE_SWATCHES.map((color) => {
            const active = item.strokeColor.toLowerCase() === color.toLowerCase() && item.strokeWidth > 0;
            return (
              <button
                key={color}
                type="button"
                data-shape-stroke-swatch={color}
                aria-label={isFa ? `رنگ خط ${color}` : `Stroke ${color}`}
                onClick={() => patch({ strokeColor: color, ...(item.strokeWidth === 0 ? { strokeWidth: 1 } : {}) })}
                className={`h-4 w-4 rounded border border-slate-300 dark:border-slate-600 cursor-pointer ${
                  active ? 'ring-2 ring-sky-500 ring-offset-1 dark:ring-offset-slate-900' : ''
                }`}
                style={{ background: color }}
              />
            );
          })}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="shape-stroke-width-input" className="text-[11px] text-slate-600 dark:text-slate-400">
              {isFa ? 'ضخامت خط (pt)' : 'Width (pt)'}
            </label>
            <input
              id="shape-stroke-width-input"
              data-shape-stroke-width
              type="number"
              dir="ltr"
              min="0"
              max="24"
              step="0.05"
              className={`${fieldCls} w-20 text-end`}
              value={Number(item.strokeWidth.toFixed(2))}
              onChange={(e) => patch({ strokeWidth: Number(e.target.value) })}
            />
          </div>
          <input
            type="range"
            min="0"
            max="24"
            step="0.25"
            aria-label={isFa ? 'اسلایدر ضخامت خط' : 'Stroke width slider'}
            value={item.strokeWidth}
            onChange={(e) => patch({ strokeWidth: Number(e.target.value) })}
            className="w-full accent-sky-600"
          />
          <div className="grid grid-cols-5 gap-1">
            {STROKE_WIDTH_PRESETS.map((pt) => (
              <button
                key={pt}
                type="button"
                onClick={() => patch({ strokeWidth: pt })}
                className={`${Math.abs(item.strokeWidth - pt) < 0.01 ? activeBtnCls : btnCls} px-1 py-0.5 text-[10px] tabular-nums`}
              >
                {pt}pt
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <label className="block space-y-0.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">{isFa ? 'نوع خط' : 'Line style'}</span>
            <select
              data-shape-stroke-style
              className={fieldCls}
              value={item.strokeStyle}
              onChange={(e) => patch({ strokeStyle: e.target.value as PageOverlayShape['strokeStyle'] })}
            >
              <option value="solid">{isFa ? 'ممتد' : 'Solid'}</option>
              <option value="dashed">{isFa ? 'خط‌چین' : 'Dashed'}</option>
              <option value="dotted">{isFa ? 'نقطه‌چین' : 'Dotted'}</option>
              <option value="dash-dot">{isFa ? 'خط‌نقطه' : 'Dash-dot'}</option>
            </select>
          </label>
          {!shapeHasFill(item) || caps.cap ? (
            <label className="block space-y-0.5">
              <span className="text-[10px] text-slate-500 dark:text-slate-400">{isFa ? 'انتهای خط' : 'Line ends'}</span>
              <select
                data-shape-line-cap
                className={fieldCls}
                value={item.lineCap ?? 'butt'}
                onChange={(e) => patch({ lineCap: e.target.value as PageOverlayShape['lineCap'] })}
              >
                {SHAPE_LINE_CAPS.map((cap) => (
                  <option key={cap} value={cap}>
                    {cap === 'butt' ? (isFa ? 'تخت' : 'Butt') : cap === 'round' ? (isFa ? 'گرد' : 'Round') : isFa ? 'مربعی' : 'Square'}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {/* Line & Arrow specific options */}
        {(caps.orientation || caps.arrow) && (
          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
            {caps.orientation && (
              <div className="space-y-0.5">
                <span className="text-[10px] text-slate-500 dark:text-slate-400">{isFa ? 'جهت خط' : 'Axis'}</span>
                <div className="grid grid-cols-2 gap-1">
                  {(['horizontal', 'vertical'] as const).map((axis) => {
                    const active = (item.lineOrientation ?? 'horizontal') === axis;
                    return (
                      <button
                        key={axis}
                        type="button"
                        data-shape-orientation={axis}
                        aria-pressed={active}
                        onClick={() => patch({ lineOrientation: axis })}
                        className={active ? activeBtnCls : btnCls}
                      >
                        {axis === 'horizontal' ? (isFa ? 'افقی' : 'Horiz') : isFa ? 'عمودی' : 'Vert'}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {caps.arrow && (
              <div className="space-y-0.5">
                <span className="text-[10px] text-slate-500 dark:text-slate-400">{isFa ? 'نوک پیکان' : 'Arrowheads'}</span>
                <div className="grid grid-cols-2 gap-1">
                  {(['single', 'double'] as const).map((styleMode) => {
                    const active = (item.arrowStyle ?? 'single') === styleMode;
                    return (
                      <button
                        key={styleMode}
                        type="button"
                        data-shape-arrow-style={styleMode}
                        aria-pressed={active}
                        onClick={() => patch({ arrowStyle: styleMode })}
                        className={active ? activeBtnCls : btnCls}
                      >
                        {styleMode === 'single' ? (isFa ? 'تک →' : '1 →') : isFa ? 'دو ↔' : '2 ↔'}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Shape-specific geometry parameters */}
      {(caps.radius || caps.sides || caps.inner) && (
        <div className={sectionCls}>
          <span className={sectionTitleCls}>{isFa ? 'پارامترهای هندسی' : 'Geometry'}</span>
          {caps.radius && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-600 dark:text-slate-400">
                  {isFa ? 'گردی گوشه (م‌م)' : 'Corner radius (mm)'}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-slate-700 dark:text-slate-200">
                  {item.borderRadius.toFixed(1)} mm
                </span>
              </div>
              <input
                data-shape-radius
                type="range"
                min="0"
                max="40"
                step="0.5"
                className="w-full accent-sky-600"
                value={item.borderRadius}
                onChange={(e) => patch({ borderRadius: Number(e.target.value) })}
              />
            </div>
          )}
          {caps.sides && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-600 dark:text-slate-400">
                  {item.type === 'star' ? (isFa ? 'تعداد پر ستاره' : 'Star points') : isFa ? 'تعداد اضلاع' : 'Polygon sides'}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={isFa ? 'کم کردن ضلع' : 'Decrease sides'}
                    onClick={() => patch({ sides: Math.max(3, (item.sides ?? (item.type === 'star' ? 5 : 6)) - 1) })}
                    className={`${btnCls} px-1.5 py-0.5`}
                  >
                    -
                  </button>
                  <span className="min-w-[2ch] text-center font-mono text-[11px] font-semibold tabular-nums">
                    {item.sides ?? (item.type === 'star' ? 5 : 6)}
                  </span>
                  <button
                    type="button"
                    aria-label={isFa ? 'افزودن ضلع' : 'Increase sides'}
                    onClick={() => patch({ sides: Math.min(16, (item.sides ?? (item.type === 'star' ? 5 : 6)) + 1) })}
                    className={`${btnCls} px-1.5 py-0.5`}
                  >
                    +
                  </button>
                </div>
              </div>
              <input
                data-shape-sides
                type="range"
                min="3"
                max="16"
                step="1"
                className="w-full accent-sky-600"
                value={item.sides ?? (item.type === 'star' ? 5 : 6)}
                onChange={(e) => patch({ sides: Number(e.target.value) })}
              />
            </div>
          )}
          {caps.inner && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-600 dark:text-slate-400">
                  {isFa ? 'عمق ستاره' : 'Star waist'}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-slate-700 dark:text-slate-200">
                  {Math.round(item.innerRadiusPercent ?? 45)}%
                </span>
              </div>
              <input
                data-shape-inner
                type="range"
                min="10"
                max="95"
                step="1"
                className="w-full accent-sky-600"
                value={item.innerRadiusPercent ?? 45}
                onChange={(e) => patch({ innerRadiusPercent: Number(e.target.value) })}
              />
            </div>
          )}
        </div>
      )}

      {/* 5. Opacity & Rotation */}
      <div className={sectionCls}>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-600 dark:text-slate-400">{isFa ? 'شفافیت' : 'Opacity'}</span>
            <span className="font-mono text-[11px] tabular-nums text-slate-700 dark:text-slate-200">
              {Math.round(item.opacity * 100)}%
            </span>
          </div>
          <input
            data-shape-opacity
            type="range"
            min="5"
            max="100"
            className="w-full accent-sky-600"
            value={Math.round(item.opacity * 100)}
            onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-600 dark:text-slate-400">{isFa ? 'چرخش' : 'Rotation'}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title={isFa ? 'چرخش ۹۰ درجه' : 'Rotate +90°'}
                onClick={() => patch({ rotation: (item.rotation + 90) % 360 })}
                className={`${btnCls} px-1.5 py-0.5 text-[10px]`}
              >
                <RotateCw className="h-3 w-3" aria-hidden="true" />
              </button>
              <span className="font-mono text-[11px] tabular-nums text-slate-700 dark:text-slate-200">
                {item.rotation.toFixed(1)}°
              </span>
            </div>
          </div>
          <input
            data-shape-rotation
            type="range"
            min="0"
            max="360"
            step="0.5"
            className="w-full accent-sky-600"
            value={item.rotation}
            onChange={(e) => patch({ rotation: Number(e.target.value) })}
          />
          <div className="grid grid-cols-4 gap-1">
            {[0, 90, 180, 270].map((deg) => (
              <button
                key={deg}
                type="button"
                data-shape-rotation-snap={deg}
                onClick={() => patch({ rotation: deg })}
                className={`${Math.abs(item.rotation - deg) < 0.1 ? activeBtnCls : btnCls} tabular-nums`}
              >
                {deg}°
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 6. Size, Position & Alignment */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between gap-1">
          <span className={sectionTitleCls}>{isFa ? 'ابعاد و موقعیت (م‌م)' : 'Size & position (mm)'}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-shape-center
              title={isFa ? 'قرار دادن در مرکز' : 'Center in container'}
              onClick={() => {
                handleAlign('hcenter');
                const nextAligned = alignOverlay(
                  { xPercent: (100 - item.widthPercent) / 2, yPercent: item.yPercent, widthPercent: item.widthPercent, heightPercent: item.heightPercent },
                  'vcenter',
                  frame.limits
                );
                patch({ xPercent: (100 - item.widthPercent) / 2, yPercent: nextAligned.yPercent });
              }}
              className={`${btnCls} px-1.5 py-0.5 text-[10px]`}
            >
              <Move className="h-3 w-3" aria-hidden="true" />
              <span>{isFa ? 'مرکز' : 'Center'}</span>
            </button>
            <button
              type="button"
              data-shape-fit-box
              title={isFa ? 'تنظیم به اندازه کل کادر' : 'Fit to container bounds'}
              onClick={() => patch({ xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100, lockAspect: false })}
              className={`${btnCls} px-1.5 py-0.5 text-[10px]`}
            >
              <Maximize2 className="h-3 w-3" aria-hidden="true" />
              <span>{isFa ? 'تمام کادر' : 'Fit'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
          <label className="block space-y-0.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">{isFa ? 'عرض' : 'Width'}</span>
            <input
              data-shape-width
              type="number"
              dir="ltr"
              min="0.5"
              step="0.1"
              className={fieldCls}
              value={Number(widthMm.toFixed(2))}
              onChange={(e) => setSize('width', Number(e.target.value))}
            />
          </label>
          <label
            title={isFa ? 'قفل نسبت ابعاد (Shift هنگام کشیدن)' : 'Lock aspect ratio (Shift while dragging)'}
            className={`mb-0.5 flex h-7 w-7 items-center justify-center rounded-md border cursor-pointer ${
              item.lockAspect
                ? 'border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-400 dark:bg-sky-500/20 dark:text-sky-200'
                : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            <input
              data-shape-lock-aspect
              type="checkbox"
              checked={!!item.lockAspect}
              onChange={(e) => patch({ lockAspect: e.target.checked })}
              className="sr-only"
            />
            {item.lockAspect ? <Lock className="h-3.5 w-3.5" aria-hidden="true" /> : <Unlock className="h-3.5 w-3.5" aria-hidden="true" />}
          </label>
          <label className="block space-y-0.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">{isFa ? 'ارتفاع' : 'Height'}</span>
            <input
              data-shape-height
              type="number"
              dir="ltr"
              min="0.5"
              step="0.1"
              className={fieldCls}
              value={Number(heightMm.toFixed(2))}
              onChange={(e) => setSize('height', Number(e.target.value))}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <label className="block space-y-0.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">X (mm)</span>
            <input
              data-shape-x
              type="number"
              dir="ltr"
              step="0.1"
              className={fieldCls}
              value={Number(((item.xPercent * box.width) / 100).toFixed(2))}
              onChange={(e) => setPosition('x', Number(e.target.value))}
            />
          </label>
          <label className="block space-y-0.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Y (mm)</span>
            <input
              data-shape-y
              type="number"
              dir="ltr"
              step="0.1"
              className={fieldCls}
              value={Number(((item.yPercent * box.height) / 100).toFixed(2))}
              onChange={(e) => setPosition('y', Number(e.target.value))}
            />
          </label>
        </div>

        <div className="space-y-1.5 pt-1">
          <label className="block space-y-0.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">{isFa ? 'مبنای تراز' : 'Align reference'}</span>
            <select
              data-shape-align-reference
              aria-label={isFa ? 'مبنای تراز شکل' : 'Shape align reference'}
              className={fieldCls}
              value={effAlignRef}
              onChange={(e) => setAlignRef(e.target.value as PanelAlignRef)}
            >
              <option value="auto">{isFa ? 'کادر جاری (پیش‌فرض)' : 'Current container (default)'}</option>
              <option value="sheet">{isFa ? 'نسبت به کل شیت' : 'To whole sheet'}</option>
              <option value="margins">{isFa ? 'نسبت به حاشیه چاپ' : 'To margins'}</option>
              <option value="cell">{isFa ? 'نسبت به خانه' : 'To cell'}</option>
              <option value="others" disabled={peers.length === 0}>
                {isFa ? `نسبت به دیگر تصاویر (${peers.length})` : `To other items (${peers.length})`}
              </option>
            </select>
          </label>
          {effAlignRef === 'others' && peers.length > 1 && (
            <select
              data-shape-align-peer
              aria-label={isFa ? 'تصویر مرجع' : 'Reference item'}
              className={fieldCls}
              value={selectedPeer ? selectedPeer.id : 'all'}
              onChange={(e) => setAlignPeerId(e.target.value)}
            >
              <option value="all">{isFa ? 'مجموعه دیگر تصاویر شیت' : 'All other items on sheet'}</option>
              {peers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          <div className="grid grid-cols-3 gap-1">
            {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((where) => (
              <button
                key={where}
                type="button"
                data-shape-align={where}
                title={where}
                onClick={() => handleAlign(where)}
                className={btnCls}
              >
                {where === 'left'
                  ? isFa ? 'چپ' : 'Left'
                  : where === 'hcenter'
                    ? isFa ? 'وسط' : 'Centre'
                    : where === 'right'
                      ? isFa ? 'راست' : 'Right'
                      : where === 'top'
                        ? isFa ? 'بالا' : 'Top'
                        : where === 'vcenter'
                          ? isFa ? 'میانه' : 'Middle'
                          : isFa ? 'پایین' : 'Bottom'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 7. Print Scope & Layer Stacking */}
      <div className={sectionCls}>
        <div className="grid grid-cols-2 gap-1.5">
          <label className="block space-y-0.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">{isFa ? 'مبنا' : 'Attach to'}</span>
            <select
              data-shape-target
              className={fieldCls}
              value={item.target}
              onChange={(e) => setScope(item.targetScope, e.target.value as OverlayTarget)}
            >
              <option value="page">{isFa ? 'صفحه سند' : 'Document page'}</option>
              <option value="sheet">{isFa ? 'برگه خروجی' : 'Output sheet'}</option>
            </select>
          </label>
          <label className="block space-y-0.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">{isFa ? 'دامنه' : 'Scope'}</span>
            <select
              data-shape-scope
              className={fieldCls}
              value={item.targetScope}
              onChange={(e) => setScope(e.target.value as OverlayScope)}
            >
              {scopes.map((scope, index) => (
                <option key={scope} value={scope}>
                  {scopeLabels[index]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {item.targetScope === 'selected' && (
          <div className="flex items-end gap-1.5">
            <label className="flex-1 space-y-0.5">
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {item.target === 'page' ? (isFa ? 'شماره صفحات' : 'Chosen pages') : isFa ? 'شماره برگه‌ها' : 'Chosen sheets'}
              </span>
              <input
                data-shape-range
                dir="ltr"
                className={`${fieldCls} font-mono`}
                value={range}
                placeholder="1, 3-5"
                onChange={(e) => {
                  setRange(e.target.value);
                  setRangeError(false);
                }}
              />
            </label>
            <button type="button" data-shape-range-apply onClick={applyRange} className={btnCls}>
              {isFa ? 'اعمال' : 'Apply'}
            </button>
          </div>
        )}
        {rangeError && (
          <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-300">
            {isFa ? 'شماره یا بازه معتبر وارد کنید.' : 'Enter valid numbers or ranges.'}
          </p>
        )}

        <div className="space-y-1 pt-0.5">
          <span className="text-[10px] text-slate-500 dark:text-slate-400">{isFa ? 'ترتیب لایه' : 'Layer order'}</span>
          <div className="grid grid-cols-4 gap-1">
            {(['front', 'forward', 'backward', 'back'] as const).map((where) => (
              <button
                key={where}
                type="button"
                data-shape-order={where}
                onClick={() => reorderOverlay(item.id, where)}
                title={
                  (where === 'front'
                    ? isFa ? 'انتقال به روی همه اشکال' : 'Bring above the other shapes'
                    : where === 'forward'
                      ? isFa ? 'یک لایه جلوتر' : 'Bring forward'
                      : where === 'backward'
                        ? isFa ? 'یک لایه عقب‌تر' : 'Send backward'
                        : isFa ? 'انتقال به پشت همه اشکال' : 'Send below the other shapes') +
                  (isFa ? ' — متن و تصویر همیشه روی شکل‌ها چاپ می‌شوند' : ' — text and pictures always print above shapes')
                }
                className={btnCls}
              >
                {where === 'front' ? '⤒' : where === 'forward' ? '↑' : where === 'backward' ? '↓' : '⤓'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Delete action */}
      <div className="border-t border-slate-200/90 pt-2.5 dark:border-slate-800">
        <button
          type="button"
          data-shape-delete
          onClick={() => removeOverlay(item.id)}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200 dark:hover:bg-rose-900 cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{isFa ? 'حذف شکل' : 'Delete shape'}</span>
        </button>
      </div>
    </aside>
  );
}

/** The Insert-tab picker: every shape type at a glance, each one a click away. */
export function ShapePicker({ onPick }: { onPick: (type: ShapeType) => void }) {
  const isFa = useAppStore((state) => state.settings.language) === 'fa';
  const hasPages = useAppStore((state) => state.pages.length > 0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.('[data-shape-picker-root]')) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div data-shape-picker-root className="relative">
      <button
        type="button"
        data-shape-picker
        aria-expanded={open}
        disabled={!hasPages}
        title={isFa ? 'درج شکل هندسی روی صفحه' : 'Insert a geometric shape on the page'}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 rounded-lg border border-violet-500 bg-violet-700 px-3 py-2 font-semibold text-white transition-colors hover:bg-violet-600 disabled:opacity-40 cursor-pointer"
      >
        <ShapePreview type="star" size={16} className="text-white" />
        <span>{isFa ? 'اشکال هندسی' : 'Shapes'}</span>
      </button>
      {open && (
        <div
          data-shape-menu
          dir={isFa ? 'rtl' : 'ltr'}
          className="absolute z-50 mt-1.5 w-80 rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <p className="mb-2 px-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {isFa
              ? 'یکی را بزنید؛ وسط صفحهٔ جاری گذاشته می‌شود و پنل تنظیماتش باز می‌شود.'
              : 'Pick one — it lands on the current page and its settings panel opens.'}
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {SHAPE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                data-shape-tool={type}
                title={shapeLabel(type, isFa)}
                aria-label={shapeLabel(type, isFa)}
                onClick={() => {
                  onPick(type);
                  setOpen(false);
                }}
                className="flex min-h-[52px] flex-col items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/70 p-1.5 text-slate-700 transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-500 dark:hover:bg-slate-700 cursor-pointer"
              >
                <ShapePreview type={type} size={22} />
                <span className="max-w-full truncate text-[9.5px] font-medium leading-none">
                  {SHAPE_NAMES[type][isFa ? 0 : 1]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
