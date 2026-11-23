/**
 * PrintStudio Pro — Standalone Ticket / Receipt (قبض) Numbering Environment
 *
 * Separate workspace for multi-part forms on a sheet (e.g. A4 → 3 slips),
 * sequential serial numbers per slip, cut/perforation marks, quantity,
 * then auto-generate all sheets and open them in Studio for live preview & edit.
 */

import React, { useMemo, useRef } from 'react';
import {
  LayoutGrid,
  Hash,
  Scissors,
  Plus,
  Trash2,
  Upload,
  FileImage,
  Play,
  RotateCcw,
  ArrowLeft,
  Rows3,
  Columns3,
  Settings2,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  createDefaultTicketConfig,
  getTicketGridMetrics,
  resolveTicketSlotText,
  type TicketConfig,
  type TicketGuideLine,
  type TicketNumberSlot,
} from '../engine/ticketNumbering';
import { STANDARD_PAPER_SIZES, type PaperSizeId } from '@shared/models';

const inputCls =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white';
const labelCls = 'block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-0.5';
const sectionCls =
  'rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900';

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const TicketNumberingWorkspace: React.FC = () => {
  const {
    settings,
    ticketConfig,
    ticketSourceDocument,
    ticketSourcePages,
    ticketSelectedSourcePageId,
    updateTicketConfig,
    resetTicketConfig,
    setTicketSelectedSourcePageId,
    importTicketSourceFiles,
    useStudioActivePageAsTicketSource,
    clearTicketSource,
    generateTicketSheetsToStudio,
    setAppMode,
    addToast,
  } = useAppStore();

  const isFa = settings.language === 'fa';
  const fileRef = useRef<HTMLInputElement>(null);
  const metrics = useMemo(() => getTicketGridMetrics(ticketConfig), [ticketConfig]);

  const selectedSource =
    ticketSourcePages.find((p) => p.id === ticketSelectedSourcePageId) ?? ticketSourcePages[0] ?? null;

  const patch = (partial: Partial<TicketConfig>) => updateTicketConfig(partial);

  const addNumberSlot = () => {
    const next: TicketNumberSlot = {
      id: newId('slot'),
      label: isFa ? `شماره ${ticketConfig.numberSlots.length + 1}` : `Number ${ticketConfig.numberSlots.length + 1}`,
      template: 'شماره {serial}',
      xPercent: 10 + ticketConfig.numberSlots.length * 8,
      yPercent: 8,
      widthPercent: 28,
      heightPercent: 12,
      fontSize: 11,
      fontFamily: 'Vazirmatn',
      color: '#0f172a',
      backgroundColor: 'transparent',
      bold: true,
      italic: false,
      align: 'center',
      rotation: 0,
      slotOffset: 0,
    };
    patch({ numberSlots: [...ticketConfig.numberSlots, next] });
  };

  const updateSlot = (id: string, changes: Partial<TicketNumberSlot>) => {
    patch({
      numberSlots: ticketConfig.numberSlots.map((s) => (s.id === id ? { ...s, ...changes } : s)),
    });
  };

  const removeSlot = (id: string) => {
    if (ticketConfig.numberSlots.length <= 1) {
      addToast({
        type: 'warning',
        title: isFa ? 'حداقل یک جایگاه شماره لازم است' : 'At least one number slot is required',
      });
      return;
    }
    patch({ numberSlots: ticketConfig.numberSlots.filter((s) => s.id !== id) });
  };

  const addGuide = (kind: TicketGuideLine['kind'] = 'perforation') => {
    const next: TicketGuideLine = {
      id: newId('guide'),
      label: kind === 'perforation' ? (isFa ? 'خط پرفراژ' : 'Perforation') : isFa ? 'خط برش' : 'Cut line',
      kind,
      orientation: 'vertical',
      positionPercent: 40,
      extendFullSheet: true,
      strokeColor: kind === 'perforation' ? '#0284c7' : '#dc2626',
      strokeStyle: kind === 'perforation' ? 'dashed' : 'solid',
      strokeWidth: 0.9,
    };
    patch({ guideLines: [...ticketConfig.guideLines, next] });
  };

  const updateGuide = (id: string, changes: Partial<TicketGuideLine>) => {
    patch({
      guideLines: ticketConfig.guideLines.map((g) => (g.id === id ? { ...g, ...changes } : g)),
    });
  };

  const removeGuide = (id: string) => {
    patch({ guideLines: ticketConfig.guideLines.filter((g) => g.id !== id) });
  };

  const handleGenerate = () => {
    const count = generateTicketSheetsToStudio();
    if (count > 0) {
      addToast({
        type: 'success',
        title: isFa ? 'شیت‌ها ساخته شد' : 'Sheets generated',
        message: isFa
          ? `${metrics.effectiveSheetCount} شیت (${metrics.totalTickets} قبض) در استودیو باز شد — قابل ویرایش و پیش‌نمایش`
          : `${metrics.effectiveSheetCount} sheets (${metrics.totalTickets} tickets) opened in Studio — editable preview`,
      });
    }
  };

  // Live preview of first few serials on first ticket
  const previewSerials = useMemo(() => {
    return ticketConfig.numberSlots.map((slot) => ({
      id: slot.id,
      label: slot.label,
      text: resolveTicketSlotText(slot, 1, metrics.totalTickets, ticketConfig),
    }));
  }, [ticketConfig, metrics.totalTickets]);

  return (
    <div
      dir={isFa ? 'rtl' : 'ltr'}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-slate-950"
      data-ticket-numbering-workspace
    >
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAppMode('studio')}
            className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {isFa ? 'بازگشت به استودیو' : 'Back to Studio'}
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
              <Hash className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900 dark:text-white">
                {isFa ? 'شماره‌گذاری قبض و فرم چندقسمتی' : 'Receipt / Ticket Numbering'}
              </h1>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {isFa
                  ? 'تقسیم صفحه، شماره سریال پشت‌سرهم، محل برش و پرفراژ — تولید خودکار شیت‌ها'
                  : 'Page division, sequential serials, cut & perforation — auto-generate sheets'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              resetTicketConfig();
              clearTicketSource();
            }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {isFa ? 'بازنشانی' : 'Reset'}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            className="flex h-8 items-center gap-1.5 rounded-md bg-sky-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-sky-500 cursor-pointer"
          >
            <Play className="h-3.5 w-3.5" />
            {isFa
              ? `تولید ${metrics.effectiveSheetCount} شیت و باز کردن در استودیو`
              : `Generate ${metrics.effectiveSheetCount} sheets → Studio`}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: configuration panels */}
        <div className="flex w-[380px] shrink-0 flex-col gap-3 overflow-y-auto border-e border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/50">
          {/* 1. Paper & grid division */}
          <section className={sectionCls}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
              <LayoutGrid className="h-3.5 w-3.5 text-sky-600" />
              {isFa ? '۱. تقسیم‌بندی برگه' : '1. Sheet division'}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={labelCls}>{isFa ? 'اندازه کاغذ' : 'Paper size'}</span>
                <select
                  className={inputCls}
                  value={ticketConfig.paperSize}
                  onChange={(e) => {
                    const id = e.target.value as PaperSizeId;
                    const std = id !== 'Custom' ? STANDARD_PAPER_SIZES[id] : null;
                    patch({
                      paperSize: id,
                      ...(std
                        ? { customWidthMm: std.widthMm, customHeightMm: std.heightMm }
                        : {}),
                    });
                  }}
                >
                  {(Object.keys(STANDARD_PAPER_SIZES) as PaperSizeId[]).map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                  <option value="Custom">{isFa ? 'سفارشی' : 'Custom'}</option>
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>{isFa ? 'جهت' : 'Orientation'}</span>
                <select
                  className={inputCls}
                  value={ticketConfig.orientation}
                  onChange={(e) =>
                    patch({ orientation: e.target.value as TicketConfig['orientation'] })
                  }
                >
                  <option value="portrait">{isFa ? 'عمودی' : 'Portrait'}</option>
                  <option value="landscape">{isFa ? 'افقی' : 'Landscape'}</option>
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>
                  <Rows3 className="mr-1 inline h-3 w-3" />
                  {isFa ? 'ردیف (قسمت‌ها)' : 'Rows (parts)'}
                </span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  className={inputCls}
                  value={ticketConfig.rows}
                  onChange={(e) => patch({ rows: Math.max(1, Math.min(12, +e.target.value || 1)) })}
                />
              </label>
              <label className="block">
                <span className={labelCls}>
                  <Columns3 className="mr-1 inline h-3 w-3" />
                  {isFa ? 'ستون' : 'Columns'}
                </span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  className={inputCls}
                  value={ticketConfig.cols}
                  onChange={(e) => patch({ cols: Math.max(1, Math.min(12, +e.target.value || 1)) })}
                />
              </label>
            </div>
            <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
              {isFa
                ? `هر برگه به ${metrics.rows}×${metrics.cols} = ${metrics.ticketsPerSheet} قسمت تقسیم می‌شود · اندازه هر قسمت ≈ ${metrics.cellWidthMm.toFixed(1)}×${metrics.cellHeightMm.toFixed(1)} mm`
                : `Each sheet splits into ${metrics.rows}×${metrics.cols} = ${metrics.ticketsPerSheet} parts · part size ≈ ${metrics.cellWidthMm.toFixed(1)}×${metrics.cellHeightMm.toFixed(1)} mm`}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className={labelCls}>{isFa ? 'فاصله افقی (mm)' : 'H gutter (mm)'}</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className={inputCls}
                  value={ticketConfig.horizontalGutterMm}
                  onChange={(e) => patch({ horizontalGutterMm: Math.max(0, +e.target.value || 0) })}
                />
              </label>
              <label className="block">
                <span className={labelCls}>{isFa ? 'فاصله عمودی (mm)' : 'V gutter (mm)'}</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className={inputCls}
                  value={ticketConfig.verticalGutterMm}
                  onChange={(e) => patch({ verticalGutterMm: Math.max(0, +e.target.value || 0) })}
                />
              </label>
            </div>
          </section>

          {/* 2. Quantity & sequence */}
          <section className={sectionCls}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
              <Settings2 className="h-3.5 w-3.5 text-sky-600" />
              {isFa ? '۲. تعداد و شماره‌گذاری' : '2. Quantity & numbering'}
            </div>
            <div className="mb-2 flex gap-1">
              {(['sheets', 'tickets'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => patch({ quantityMode: mode })}
                  className={`flex-1 rounded px-2 py-1 text-[11px] font-semibold cursor-pointer ${
                    ticketConfig.quantityMode === mode
                      ? 'bg-sky-600 text-white'
                      : 'border border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  {mode === 'sheets'
                    ? isFa
                      ? 'بر اساس تعداد شیت'
                      : 'By sheet count'
                    : isFa
                      ? 'بر اساس تعداد قبض'
                      : 'By ticket count'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ticketConfig.quantityMode === 'sheets' ? (
                <label className="block col-span-2">
                  <span className={labelCls}>{isFa ? 'تعداد شیت‌های چاپی' : 'Number of sheets'}</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    className={inputCls}
                    value={ticketConfig.sheetCount}
                    onChange={(e) =>
                      patch({ sheetCount: Math.max(1, Math.min(500, +e.target.value || 1)) })
                    }
                  />
                </label>
              ) : (
                <label className="block col-span-2">
                  <span className={labelCls}>{isFa ? 'تعداد کل قبض‌ها' : 'Total tickets'}</span>
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    className={inputCls}
                    value={ticketConfig.ticketCount}
                    onChange={(e) =>
                      patch({ ticketCount: Math.max(1, Math.min(2000, +e.target.value || 1)) })
                    }
                  />
                </label>
              )}
              <label className="block">
                <span className={labelCls}>{isFa ? 'شروع از شماره' : 'Start number'}</span>
                <input
                  type="number"
                  className={inputCls}
                  value={ticketConfig.startNumber}
                  onChange={(e) => patch({ startNumber: Math.trunc(+e.target.value || 0) })}
                />
              </label>
              <label className="block">
                <span className={labelCls}>{isFa ? 'گام (step)' : 'Step'}</span>
                <input
                  type="number"
                  className={inputCls}
                  value={ticketConfig.step}
                  onChange={(e) => patch({ step: Math.trunc(+e.target.value || 1) || 1 })}
                />
              </label>
              <label className="block">
                <span className={labelCls}>{isFa ? 'صفر پرکننده' : 'Pad zeros'}</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  className={inputCls}
                  value={ticketConfig.padZeros}
                  onChange={(e) => patch({ padZeros: Math.max(0, Math.min(10, +e.target.value || 0)) })}
                />
              </label>
              <label className="block">
                <span className={labelCls}>{isFa ? 'فرمت رقم' : 'Digit format'}</span>
                <select
                  className={inputCls}
                  value={ticketConfig.format}
                  onChange={(e) =>
                    patch({ format: e.target.value as TicketConfig['format'] })
                  }
                >
                  <option value="english">{English 0-9</option>
                  <option value="persian">{فارسی ۰-۹</option>
                </select>
              </label>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className={labelCls}>{isFa ? 'ترتیب شمارش' : 'Ordering'}</span>
                <select
                  className={inputCls}
                  value={ticketConfig.orderingMode}
                  onChange={(e) =>
                    patch({ orderingMode: e.target.value as TicketConfig['orderingMode'] })
                  }
                >
                  <option value="per-sheet">{isFa ? 'شیت به شیت' : 'Per sheet'}</option>
                  <option value="cut-stack">{isFa ? 'برش و چیدمان عمقی' : 'Cut & stack'}</option>
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>{isFa ? 'جهت شمارش' : 'Direction'}</span>
                <select
                  className={inputCls}
                  value={ticketConfig.direction}
                  onChange={(e) =>
                    patch({ direction: e.target.value as TicketConfig['direction'] })
                  }
                >
                  <option value="rtl">{isFa ? 'راست → چپ' : 'RTL'}</option>
                  <option value="ltr">{isFa ? 'چپ → راست' : 'LTR'}</option>
                  <option value="ttb">{isFa ? 'بالا → پایین' : 'Top → bottom'}</option>
                  <option value="zigzag">{isFa ? 'زیگزاگ' : 'Zigzag'}</option>
                </select>
              </label>
            </div>
            <p className="mt-2 rounded bg-sky-50 px-2 py-1.5 text-[10px] font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
              {isFa
                ? `جمع: ${metrics.effectiveSheetCount} شیت · ${metrics.totalTickets} قبض · شماره‌ها پشت‌سرهم از ${ticketConfig.startNumber}`
                : `Total: ${metrics.effectiveSheetCount} sheets · ${metrics.totalTickets} tickets · serials from ${ticketConfig.startNumber}`}
            </p>
          </section>

          {/* 3. Number slots */}
          <section className={sectionCls}>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                <Hash className="h-3.5 w-3.5 text-sky-600" />
                {isFa ? '۳. جایگاه شماره‌ها روی هر قسمت' : '3. Number positions on each part'}
              </div>
              <button
                type="button"
                onClick={addNumberSlot}
                className="flex items-center gap-1 rounded bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-sky-500 cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                {isFa ? 'جایگاه' : 'Slot'}
              </button>
            </div>
            <div className="space-y-2">
              {ticketConfig.numberSlots.map((slot, idx) => (
                <div
                  key={slot.id}
                  className="rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60"
                >
                  <div className="mb-1 flex items-center justify-between gap-1">
                    <input
                      className={`${inputCls} flex-1`}
                      value={slot.label}
                      onChange={(e) => updateSlot(slot.id, { label: e.target.value })}
                      placeholder={isFa ? 'برچسب' : 'Label'}
                    />
                    <button
                      type="button"
                      onClick={() => removeSlot(slot.id)}
                      className="rounded p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                      title={isFa ? 'حذف' : 'Remove'}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <label className="block mb-1">
                    <span className={labelCls}>{isFa ? 'قالب متن' : 'Template'}</span>
                    <input
                      className={inputCls}
                      dir="auto"
                      value={slot.template}
                      onChange={(e) => updateSlot(slot.id, { template: e.target.value })}
                      placeholder="شماره {serial}"
                    />
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    <label className="block">
                      <span className={labelCls}>X%</span>
                      <input
                        type="number"
                        min={0}
                        max={95}
                        className={inputCls}
                        value={slot.xPercent}
                        onChange={(e) => updateSlot(slot.id, { xPercent: +e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>Y%</span>
                      <input
                        type="number"
                        min={0}
                        max={95}
                        className={inputCls}
                        value={slot.yPercent}
                        onChange={(e) => updateSlot(slot.id, { yPercent: +e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>W%</span>
                      <input
                        type="number"
                        min={4}
                        max={100}
                        className={inputCls}
                        value={slot.widthPercent}
                        onChange={(e) => updateSlot(slot.id, { widthPercent: +e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>H%</span>
                      <input
                        type="number"
                        min={4}
                        max={100}
                        className={inputCls}
                        value={slot.heightPercent}
                        onChange={(e) => updateSlot(slot.id, { heightPercent: +e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-1">
                    <label className="block">
                      <span className={labelCls}>{isFa ? 'اندازه' : 'Size'}</span>
                      <input
                        type="number"
                        min={6}
                        max={72}
                        className={inputCls}
                        value={slot.fontSize}
                        onChange={(e) => updateSlot(slot.id, { fontSize: +e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{isFa ? 'آفست' : 'Offset'}</span>
                      <input
                        type="number"
                        className={inputCls}
                        value={slot.slotOffset}
                        onChange={(e) => updateSlot(slot.id, { slotOffset: Math.trunc(+e.target.value || 0) })}
                        title={isFa ? 'اختلاف نسبت به شماره اصلی' : 'Offset from main serial'}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{isFa ? 'رنگ' : 'Color'}</span>
                      <input
                        type="color"
                        className="h-8 w-full cursor-pointer rounded border border-slate-300 dark:border-slate-600"
                        value={/^#[0-9a-f]{6}$/i.test(slot.color) ? slot.color : '#0f172a'}
                        onChange={(e) => updateSlot(slot.id, { color: e.target.value })}
                      />
                    </label>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {isFa ? 'پیش‌نمایش:' : 'Preview:'}{' '}
                    <span className="font-semibold text-slate-800 dark:text-slate-200" dir="auto">
                      {previewSerials[idx]?.text ?? '—'}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* 4. Cut & perforation */}
          <section className={sectionCls}>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                <Scissors className="h-3.5 w-3.5 text-sky-600" />
                {isFa ? '۴. محل برش و پرفراژ' : '4. Cut & perforation'}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => addGuide('perforation')}
                  className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800 dark:bg-sky-900/40 dark:text-sky-200 cursor-pointer"
                >
                  + {isFa ? 'پرفراژ' : 'Perf'}
                </button>
                <button
                  type="button"
                  onClick={() => addGuide('cut')}
                  className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-900/40 dark:text-rose-200 cursor-pointer"
                >
                  + {isFa ? 'برش' : 'Cut'}
                </button>
              </div>
            </div>
            <label className="mb-2 flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={ticketConfig.autoGridCutLines}
                onChange={(e) => patch({ autoGridCutLines: e.target.checked })}
              />
              {isFa ? 'خطوط برش خودکار بین خانه‌ها' : 'Auto cut lines between cells'}
            </label>
            <div className="space-y-2">
              {ticketConfig.guideLines.map((guide) => (
                <div
                  key={guide.id}
                  className="rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60"
                >
                  <div className="mb-1 flex items-center justify-between gap-1">
                    <input
                      className={`${inputCls} flex-1`}
                      value={guide.label}
                      onChange={(e) => updateGuide(guide.id, { label: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => removeGuide(guide.id)}
                      className="rounded p-1 text-rose-500 hover:bg-rose-50 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <label className="block">
                      <span className={labelCls}>{isFa ? 'نوع' : 'Kind'}</span>
                      <select
                        className={inputCls}
                        value={guide.kind}
                        onChange={(e) =>
                          updateGuide(guide.id, {
                            kind: e.target.value as TicketGuideLine['kind'],
                          })
                        }
                      >
                        <option value="perforation">{isFa ? 'پرفراژ' : 'Perforation'}</option>
                        <option value="cut">{isFa ? 'برش' : 'Cut'}</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className={labelCls}>{isFa ? 'جهت' : 'Orient.'}</span>
                      <select
                        className={inputCls}
                        value={guide.orientation}
                        onChange={(e) =>
                          updateGuide(guide.id, {
                            orientation: e.target.value as TicketGuideLine['orientation'],
                          })
                        }
                      >
                        <option value="vertical">{isFa ? 'عمودی' : 'Vertical'}</option>
                        <option value="horizontal">{isFa ? 'افقی' : 'Horizontal'}</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className={labelCls}>{isFa ? 'موقعیت %' : 'Pos %'}</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className={inputCls}
                        value={guide.positionPercent}
                        onChange={(e) =>
                          updateGuide(guide.id, { positionPercent: +e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <label className="mt-1 flex items-center gap-2 text-[10px] text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={guide.extendFullSheet}
                      onChange={(e) => updateGuide(guide.id, { extendFullSheet: e.target.checked })}
                    />
                    {isFa ? 'امتداد روی کل شیت' : 'Extend across full sheet'}
                  </label>
                </div>
              ))}
              {ticketConfig.guideLines.length === 0 && (
                <p className="text-[10px] text-slate-400">
                  {isFa
                    ? 'هنوز خطی تعریف نشده — با دکمه‌های بالا اضافه کنید.'
                    : 'No guide lines yet — add with the buttons above.'}
                </p>
              )}
            </div>
          </section>
        </div>

        {/* Right: source form + live sheet preview */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {/* Source form */}
          <section className={sectionCls}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
              <FileImage className="h-3.5 w-3.5 text-sky-600" />
              {isFa ? 'فرم پایه (اختیاری)' : 'Base form (optional)'}
            </div>
            <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
              {isFa
                ? 'یک PDF یا تصویر از فرم خالی قبض بارگذاری کنید. اگر خالی بماند، شیت‌ها با پس‌زمینه سفید ساخته می‌شوند.'
                : 'Upload a blank receipt PDF/image. If empty, sheets are generated with a white background.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  if (files.length) void importTicketSourceFiles(files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5" />
                {isFa ? 'بارگذاری فرم' : 'Upload form'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const ok = useStudioActivePageAsTicketSource();
                  if (!ok) {
                    addToast({
                      type: 'warning',
                      title: isFa ? 'صفحه‌ای در استودیو انتخاب نشده' : 'No active Studio page',
                    });
                  }
                }}
                className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
              >
                {isFa ? 'استفاده از صفحه فعال استودیو' : 'Use active Studio page'}
              </button>
              {ticketSourceDocument && (
                <button
                  type="button"
                  onClick={clearTicketSource}
                  className="flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {isFa ? 'پاک کردن منبع' : 'Clear source'}
                </button>
              )}
            </div>
            {selectedSource && (
              <div className="mt-3 flex items-start gap-3 rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/50">
                {selectedSource.thumbnailDataUrl ? (
                  <img
                    src={selectedSource.thumbnailDataUrl}
                    alt=""
                    className="h-20 w-auto rounded border border-slate-200 object-contain dark:border-slate-600"
                  />
                ) : (
                  <div className="flex h-20 w-16 items-center justify-center rounded border border-dashed border-slate-300 text-[10px] text-slate-400">
                    {isFa ? 'بدون پیش‌نمایش' : 'No preview'}
                  </div>
                )}
                <div className="min-w-0 flex-1 text-[11px] text-slate-600 dark:text-slate-300">
                  <div className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {ticketSourceDocument?.name ?? selectedSource.documentName}
                  </div>
                  <div>
                    {selectedSource.widthMm.toFixed(1)} × {selectedSource.heightMm.toFixed(1)} mm
                  </div>
                  {ticketSourcePages.length > 1 && (
                    <select
                      className={`${inputCls} mt-1`}
                      value={ticketSelectedSourcePageId ?? ''}
                      onChange={(e) => setTicketSelectedSourcePageId(e.target.value || null)}
                    >
                      {ticketSourcePages.map((p, i) => (
                        <option key={p.id} value={p.id}>
                          {isFa ? `صفحه ${i + 1}` : `Page ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Live schematic preview of one sheet */}
          <section className={`${sectionCls} flex-1`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                {isFa ? 'پیش‌نمایش شماتیک یک شیت' : 'Schematic preview of one sheet'}
              </div>
              <span className="text-[10px] text-slate-500">
                {metrics.sheetWidthMm.toFixed(0)} × {metrics.sheetHeightMm.toFixed(0)} mm
              </span>
            </div>
            <div className="flex justify-center">
              <div
                className="relative border border-slate-300 bg-white shadow-md dark:border-slate-600"
                style={{
                  width: Math.min(420, metrics.sheetWidthMm * 1.6),
                  height: Math.min(594, metrics.sheetHeightMm * 1.6),
                  aspectRatio: `${metrics.sheetWidthMm} / ${metrics.sheetHeightMm}`,
                }}
              >
                {/* cells */}
                {Array.from({ length: metrics.rows }).map((_, r) =>
                  Array.from({ length: metrics.cols }).map((_, c) => {
                    const left =
                      ((ticketConfig.marginsMm.left +
                        c * (metrics.cellWidthMm + ticketConfig.horizontalGutterMm)) /
                        metrics.sheetWidthMm) *
                      100;
                    const top =
                      ((ticketConfig.marginsMm.top +
                        r * (metrics.cellHeightMm + ticketConfig.verticalGutterMm)) /
                        metrics.sheetHeightMm) *
                      100;
                    const w = (metrics.cellWidthMm / metrics.sheetWidthMm) * 100;
                    const h = (metrics.cellHeightMm / metrics.sheetHeightMm) * 100;
                    const cellIndex =
                      ticketConfig.direction === 'rtl'
                        ? r * metrics.cols + (metrics.cols - 1 - c)
                        : r * metrics.cols + c;
                    const serial =
                      ticketConfig.startNumber + cellIndex * (ticketConfig.step || 1);
                    return (
                      <div
                        key={`${r}-${c}`}
                        className="absolute box-border border border-dashed border-slate-300 bg-slate-50/80"
                        style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` }}
                      >
                        {ticketConfig.numberSlots.map((slot) => (
                          <div
                            key={slot.id}
                            className="absolute flex items-center justify-center overflow-hidden text-[9px] font-bold leading-tight"
                            style={{
                              left: `${slot.xPercent}%`,
                              top: `${slot.yPercent}%`,
                              width: `${slot.widthPercent}%`,
                              height: `${slot.heightPercent}%`,
                              color: slot.color,
                              fontSize: Math.max(7, slot.fontSize * 0.55),
                              textAlign: slot.align,
                            }}
                            dir="auto"
                          >
                            {slot.template.replace(
                              /\{serial\}/g,
                              String(serial + (slot.slotOffset || 0))
                            )}
                          </div>
                        ))}
                        {ticketConfig.guideLines
                          .filter((g) => !g.extendFullSheet)
                          .map((g) =>
                            g.orientation === 'vertical' ? (
                              <div
                                key={g.id}
                                className="absolute top-0 bottom-0 w-px"
                                style={{
                                  left: `${g.positionPercent}%`,
                                  borderLeft: `1px ${g.strokeStyle} ${g.strokeColor}`,
                                }}
                              />
                            ) : (
                              <div
                                key={g.id}
                                className="absolute left-0 right-0 h-px"
                                style={{
                                  top: `${g.positionPercent}%`,
                                  borderTop: `1px ${g.strokeStyle} ${g.strokeColor}`,
                                }}
                              />
                            )
                          )}
                      </div>
                    );
                  })
                )}
                {/* sheet-wide guides */}
                {ticketConfig.guideLines
                  .filter((g) => g.extendFullSheet)
                  .map((g) => {
                    if (g.orientation === 'vertical') {
                      return Array.from({ length: metrics.cols }).map((_, c) => {
                        const left =
                          ((ticketConfig.marginsMm.left +
                            c * (metrics.cellWidthMm + ticketConfig.horizontalGutterMm) +
                            (g.positionPercent / 100) * metrics.cellWidthMm) /
                            metrics.sheetWidthMm) *
                          100;
                        return (
                          <div
                            key={`${g.id}-c${c}`}
                            className="pointer-events-none absolute top-0 bottom-0"
                            style={{
                              left: `${left}%`,
                              width: 0,
                              borderLeft: `1.5px ${g.strokeStyle} ${g.strokeColor}`,
                            }}
                          />
                        );
                      });
                    }
                    return Array.from({ length: metrics.rows }).map((_, r) => {
                      const top =
                        ((ticketConfig.marginsMm.top +
                          r * (metrics.cellHeightMm + ticketConfig.verticalGutterMm) +
                          (g.positionPercent / 100) * metrics.cellHeightMm) /
                          metrics.sheetHeightMm) *
                        100;
                      return (
                        <div
                          key={`${g.id}-r${r}`}
                          className="pointer-events-none absolute left-0 right-0"
                          style={{
                            top: `${top}%`,
                            height: 0,
                            borderTop: `1.5px ${g.strokeStyle} ${g.strokeColor}`,
                          }}
                        />
                      );
                    });
                  })}
              </div>
            </div>
            <p className="mt-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
              {isFa
                ? 'پس از تولید، تمام شیت‌ها در استودیو باز می‌شوند و می‌توانید جای شماره‌ها، خطوط و محتوا را ویرایش کنید.'
                : 'After generate, all sheets open in Studio where you can edit number positions, guides and content.'}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default TicketNumberingWorkspace;
