/**
 * PrintStudio Pro — Standalone Ticket / Receipt Numbering Environment
 *
 * Separate workspace for multi-part forms on a sheet (e.g. A4 into 3 slips),
 * sequential serial numbers per slip, cut/perforation marks, quantity,
 * then auto-generate all sheets and open them in Studio for live preview and edit.
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  LayoutGrid,
  Hash,
  Scissors,
  Plus,
  Trash2,
  Upload,
  FileImage,
  FileDown,
  Play,
  RotateCcw,
  ArrowLeft,
  Rows3,
  Columns3,
  Settings2,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  getTicketGridMetrics,
  resolveTicketSlotText,
  ticketSequenceIndex,
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
    exportMergedOrImposedPdf,
    setPdfExportOptions,
    setAppMode,
    addToast,
  } = useAppStore();

  const isFa = settings.language === 'fa';
  const fileRef = useRef<HTMLInputElement>(null);
  const metrics = useMemo(() => getTicketGridMetrics(ticketConfig), [ticketConfig]);
  const [guideTool, setGuideTool] = useState<TicketGuideLine['kind'] | null>(null);
  const [guideOrientation, setGuideOrientation] = useState<TicketGuideLine['orientation']>('vertical');
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; kind: 'slot' | 'guide' | 'new-guide'; id: string; row: number; col: number; orientation: TicketGuideLine['orientation']; offsetX: number; offsetY: number; cell: { left: number; top: number; width: number; height: number } } | null>(null);

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

  const addGuide = (kind: TicketGuideLine['kind'] = 'perforation', orientation: TicketGuideLine['orientation'] = 'vertical', positionPercent = 40) => {
    const next: TicketGuideLine = {
      id: newId('guide'),
      label: kind === 'perforation' ? (isFa ? 'خط پرفراژ' : 'Perforation') : isFa ? 'خط برش' : 'Cut line',
      kind,
      orientation,
      positionPercent: Math.max(0, Math.min(100, positionPercent)),
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

  const cellFrame = (row: number, col: number) => ({
    left: ticketConfig.marginsMm.left + col * (metrics.cellWidthMm + ticketConfig.horizontalGutterMm),
    top: ticketConfig.marginsMm.top + row * (metrics.cellHeightMm + ticketConfig.verticalGutterMm),
    width: metrics.cellWidthMm,
    height: metrics.cellHeightMm,
  });

  const guidePositionAt = (orientation: TicketGuideLine['orientation'], clientX: number, clientY: number, row: number, col: number) => {
    const sheet = previewRef.current?.getBoundingClientRect();
    if (!sheet) return 40;
    const frame = cellFrame(row, col);
    const localMm = orientation === 'vertical'
      ? (clientX - sheet.left) / sheet.width * metrics.sheetWidthMm - frame.left
      : (clientY - sheet.top) / sheet.height * metrics.sheetHeightMm - frame.top;
    return Math.max(0, Math.min(100, localMm / (orientation === 'vertical' ? frame.width : frame.height) * 100));
  };

  const beginSlotDrag = (event: React.PointerEvent<HTMLElement>, id: string, row: number, col: number) => {
    if (event.button !== 0) return;
    const sheet = previewRef.current;
    const cell = event.currentTarget.closest<HTMLElement>('[data-ticket-cell]');
    const rect = cell?.getBoundingClientRect();
    if (!sheet || !rect) return;
    const slot = ticketConfig.numberSlots.find(item => item.id === id);
    if (!slot) return;
    const pointerX = (event.clientX - rect.left) / Math.max(1, rect.width) * 100;
    const pointerY = (event.clientY - rect.top) / Math.max(1, rect.height) * 100;
    event.preventDefault(); event.stopPropagation(); sheet.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, kind: 'slot', id, row, col, orientation: 'vertical',
      offsetX: pointerX - slot.xPercent, offsetY: pointerY - slot.yPercent,
      cell: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
  };

  const beginGuideDrag = (event: React.PointerEvent<HTMLElement>, id: string, row: number, col: number, orientation: TicketGuideLine['orientation']) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); previewRef.current?.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, kind: 'guide', id, row, col, orientation, offsetX: 0, offsetY: 0, cell: { left: 0, top: 0, width: 0, height: 0 } };
  };

  const beginManualGuide = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!guideTool || event.button !== 0) return;
    const sheet = previewRef.current, rect = sheet?.getBoundingClientRect();
    if (!sheet || !rect) return;
    const xMm = (event.clientX - rect.left) / rect.width * metrics.sheetWidthMm;
    const yMm = (event.clientY - rect.top) / rect.height * metrics.sheetHeightMm;
    const col = Math.max(0, Math.min(metrics.cols - 1, Math.floor((xMm - ticketConfig.marginsMm.left) / (metrics.cellWidthMm + ticketConfig.horizontalGutterMm))));
    const row = Math.max(0, Math.min(metrics.rows - 1, Math.floor((yMm - ticketConfig.marginsMm.top) / (metrics.cellHeightMm + ticketConfig.verticalGutterMm))));
    const position = guidePositionAt(guideOrientation, event.clientX, event.clientY, row, col);
    const id = newId('guide');
    const next: TicketGuideLine = {
      id, label: guideTool === 'perforation' ? (isFa ? 'خط پرفراژ' : 'Perforation') : (isFa ? 'خط برش' : 'Cut line'),
      kind: guideTool, orientation: guideOrientation, positionPercent: position, extendFullSheet: true,
      strokeColor: guideTool === 'perforation' ? '#0284c7' : '#dc2626',
      strokeStyle: guideTool === 'perforation' ? 'dashed' : 'solid', strokeWidth: 0.9,
    };
    patch({ guideLines: [...ticketConfig.guideLines, next] });
    event.preventDefault(); event.stopPropagation(); sheet.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, kind: 'new-guide', id, row, col, orientation: guideOrientation, offsetX: 0, offsetY: 0, cell: { left: 0, top: 0, width: 0, height: 0 } };
    setGuideTool(null);
  };

  const movePreviewPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === 'slot') {
      const slot = ticketConfig.numberSlots.find(item => item.id === drag.id);
      if (!slot) return;
      const x = (event.clientX - drag.cell.left) / Math.max(1, drag.cell.width) * 100;
      const y = (event.clientY - drag.cell.top) / Math.max(1, drag.cell.height) * 100;
      updateSlot(drag.id, { xPercent: Math.max(0, Math.min(100 - slot.widthPercent, x - drag.offsetX)),
        yPercent: Math.max(0, Math.min(100 - slot.heightPercent, y - drag.offsetY)) });
      return;
    }
    updateGuide(drag.id, { positionPercent: guidePositionAt(drag.orientation, event.clientX, event.clientY, drag.row, drag.col) });
  };

  const finishPreviewPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (previewRef.current?.hasPointerCapture?.(event.pointerId)) previewRef.current.releasePointerCapture(event.pointerId);
  };

  const handleGenerate = () => {
    const count = generateTicketSheetsToStudio();
    if (count > 0) {
      addToast({
        type: 'success',
        title: isFa ? 'شیت‌ها ساخته شد' : 'Sheets generated',
        message: isFa
          ? `${metrics.effectiveSheetCount} شیت (${metrics.totalTickets} قبض) در استودیو باز شد`
          : `${metrics.effectiveSheetCount} sheets (${metrics.totalTickets} tickets) opened in Studio`,
      });
    }
  };

  const handleExportPdf = async () => {
    const count = generateTicketSheetsToStudio();
    if (count <= 0) return;
    // Prefer a compact 300-DPI image profile while retaining vector text and line art.
    setPdfExportOptions({ imageHandling: 'downsample-300', compression: 'compact' });
    // Ticket generation updates the Zustand store synchronously; the normal PDF
    // pipeline then exports the exact same vector overlays and source artwork.
    await exportMergedOrImposedPdf(false);
  };

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
                {isFa ? 'شماره گذاری قبض و فرم چندقسمتی' : 'Receipt / Ticket Numbering'}
              </h1>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {isFa
                  ? 'تقسیم صفحه، شماره سریال، محل برش و پرفراژ — تولید خودکار شیت ها'
                  : 'Page division, sequential serials, cut and perforation — auto-generate sheets'}
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
            onClick={() => void handleExportPdf()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-600/15 dark:text-emerald-300 cursor-pointer"
            title={isFa ? 'ساخت PDF نهایی با حفظ متن و خطوط برداری' : 'Export final vector PDF'}
          >
            <FileDown className="h-3.5 w-3.5" />
            {isFa ? 'خروجی PDF' : 'Export PDF'}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            className="flex h-8 items-center gap-1.5 rounded-md bg-sky-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-sky-500 cursor-pointer"
          >
            <Play className="h-3.5 w-3.5" />
            {isFa
              ? `تولید ${metrics.effectiveSheetCount} شیت و باز کردن در استودیو`
              : `Generate ${metrics.effectiveSheetCount} sheets to Studio`}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-[380px] shrink-0 flex-col gap-3 overflow-y-auto border-e border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/50">
          <section className={sectionCls}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
              <LayoutGrid className="h-3.5 w-3.5 text-sky-600" />
              {isFa ? '1. تقسیم بندی برگه' : '1. Sheet division'}
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
                  onChange={(e) => {
                    patch({ orientation: e.target.value as TicketConfig['orientation'] });
                  }}
                >
                  <option value="portrait">{isFa ? 'عمودی' : 'Portrait'}</option>
                  <option value="landscape">{isFa ? 'افقی' : 'Landscape'}</option>
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>
                  <Rows3 className="mr-1 inline h-3 w-3" />
                  {isFa ? 'ردیف' : 'Rows'}
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
                ? `هر برگه به ${metrics.rows}x${metrics.cols} = ${metrics.ticketsPerSheet} قسمت · اندازه قسمت حدود ${metrics.cellWidthMm.toFixed(1)}x${metrics.cellHeightMm.toFixed(1)} mm`
                : `Each sheet: ${metrics.rows}x${metrics.cols} = ${metrics.ticketsPerSheet} parts · part about ${metrics.cellWidthMm.toFixed(1)}x${metrics.cellHeightMm.toFixed(1)} mm`}
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

          <section className={sectionCls}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
              <Settings2 className="h-3.5 w-3.5 text-sky-600" />
              {isFa ? '2. تعداد و شماره گذاری' : '2. Quantity and numbering'}
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
                  <span className={labelCls}>{isFa ? 'تعداد شیت های چاپی' : 'Number of sheets'}</span>
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
                  <span className={labelCls}>{isFa ? 'تعداد کل قبض ها' : 'Total tickets'}</span>
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
                  onChange={(e) => {
                    const nextFormat = e.target.value as TicketConfig['format'];
                    patch({ format: nextFormat });
                  }}
                >
                  <option value="english">English digits</option>
                  <option value="persian">Persian digits</option>
                </select>
              </label>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className={labelCls}>{isFa ? 'ترتیب شمارش' : 'Ordering'}</span>
                <select
                  className={inputCls}
                  value={ticketConfig.orderingMode}
                  onChange={(e) => {
                    patch({ orderingMode: e.target.value as TicketConfig['orderingMode'] });
                  }}
                >
                  <option value="per-sheet">{isFa ? 'شیت به شیت' : 'Per sheet'}</option>
                  <option value="cut-stack">{isFa ? 'برش و چیدمان عمقی' : 'Cut and stack'}</option>
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>{isFa ? 'جهت شمارش' : 'Direction'}</span>
                <select
                  className={inputCls}
                  value={ticketConfig.direction}
                  onChange={(e) => {
                    patch({ direction: e.target.value as TicketConfig['direction'] });
                  }}
                >
                  <option value="rtl">{isFa ? 'راست به چپ' : 'RTL'}</option>
                  <option value="ltr">{isFa ? 'چپ به راست' : 'LTR'}</option>
                  <option value="ttb">{isFa ? 'بالا به پایین' : 'Top to bottom'}</option>
                  <option value="zigzag">{isFa ? 'زیگزاگ' : 'Zigzag'}</option>
                </select>
              </label>
            </div>
            <p className="mt-2 rounded bg-sky-50 px-2 py-1.5 text-[10px] font-medium text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
              {isFa
                ? `جمع: ${metrics.effectiveSheetCount} شیت · ${metrics.totalTickets} قبض · از ${ticketConfig.startNumber}`
                : `Total: ${metrics.effectiveSheetCount} sheets · ${metrics.totalTickets} tickets · from ${ticketConfig.startNumber}`}
            </p>
          </section>

          <section className={sectionCls}>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                <Hash className="h-3.5 w-3.5 text-sky-600" />
                {isFa ? '3. جایگاه شماره ها' : '3. Number positions'}
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
                    />
                    <button
                      type="button"
                      onClick={() => removeSlot(slot.id)}
                      className="rounded p-1 text-rose-500 hover:bg-rose-50 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <label className="mb-1 block">
                    <span className={labelCls}>{isFa ? 'قالب متن' : 'Template'}</span>
                    <input
                      className={inputCls}
                      dir="auto"
                      value={slot.template}
                      onChange={(e) => updateSlot(slot.id, { template: e.target.value })}
                    />
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {(['xPercent', 'yPercent', 'widthPercent', 'heightPercent'] as const).map((key, i) => (
                      <label key={key} className="block">
                        <span className={labelCls}>{['X%', 'Y%', 'W%', 'H%'][i]}</span>
                        <input
                          type="number"
                          className={inputCls}
                          value={slot[key]}
                          onChange={(e) => updateSlot(slot.id, { [key]: +e.target.value })}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {isFa ? 'پیش نمایش:' : 'Preview:'}{' '}
                    <span className="font-semibold text-slate-800 dark:text-slate-200" dir="auto">
                      {previewSerials[idx]?.text ?? '—'}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className={sectionCls}>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                <Scissors className="h-3.5 w-3.5 text-sky-600" />
                {isFa ? '4. محل برش و پرفراژ' : '4. Cut and perforation'}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => addGuide('perforation')}
                  className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-800 cursor-pointer"
                >
                  + {isFa ? 'پرفراژ' : 'Perf'}
                </button>
                <button
                  type="button"
                  onClick={() => addGuide('cut')}
                  className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800 cursor-pointer"
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
              {isFa ? 'خطوط برش خودکار بین خانه ها' : 'Auto cut lines between cells'}
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
                        onChange={(e) => {
                          updateGuide(guide.id, {
                            kind: e.target.value as TicketGuideLine['kind'],
                          });
                        }}
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
                        onChange={(e) => {
                          updateGuide(guide.id, {
                            orientation: e.target.value as TicketGuideLine['orientation'],
                          });
                        }}
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
            </div>
          </section>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <section className={sectionCls}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
              <FileImage className="h-3.5 w-3.5 text-sky-600" />
              {isFa ? 'فرم پایه (اختیاری)' : 'Base form (optional)'}
            </div>
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
                      title: isFa ? 'صفحه ای در استودیو انتخاب نشده' : 'No active Studio page',
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
                  className="flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 cursor-pointer"
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
                    className="h-20 w-auto rounded border border-slate-200 object-contain"
                  />
                ) : (
                  <div className="flex h-20 w-16 items-center justify-center rounded border border-dashed border-slate-300 text-[10px] text-slate-400">
                    {isFa ? 'بدون پیش نمایش' : 'No preview'}
                  </div>
                )}
                <div className="min-w-0 flex-1 text-[11px] text-slate-600 dark:text-slate-300">
                  <div className="truncate font-semibold text-slate-800 dark:text-slate-100">
                    {ticketSourceDocument?.name ?? selectedSource.documentName}
                  </div>
                  <div>
                    {selectedSource.widthMm.toFixed(1)} x {selectedSource.heightMm.toFixed(1)} mm
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className={`${sectionCls} flex-1`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                {isFa ? 'پیش نمایش شماتیک یک شیت' : 'Schematic preview of one sheet'}
              </div>
              <div className="flex items-center gap-1"><span className="text-[10px] text-slate-500">{metrics.sheetWidthMm.toFixed(0)} x {metrics.sheetHeightMm.toFixed(0)} mm</span><select aria-label={isFa ? 'جهت خط دستی' : 'Manual line orientation'} className={inputCls + ' !w-auto'} value={guideOrientation} onChange={e => setGuideOrientation(e.target.value as TicketGuideLine['orientation'])}><option value="vertical">{isFa ? 'عمودی' : 'Vertical'}</option><option value="horizontal">{isFa ? 'افقی' : 'Horizontal'}</option></select><button type="button" data-draw-ticket-guide="perforation" aria-pressed={guideTool === 'perforation'} onClick={() => setGuideTool(guideTool === 'perforation' ? null : 'perforation')} className={'rounded px-2 py-1 text-[10px] font-bold ' + (guideTool === 'perforation' ? 'bg-sky-600 text-white' : 'bg-sky-100 text-sky-800')}>{isFa ? 'رسم پرفراژ' : 'Draw perf.'}</button><button type="button" data-draw-ticket-guide="cut" aria-pressed={guideTool === 'cut'} onClick={() => setGuideTool(guideTool === 'cut' ? null : 'cut')} className={'rounded px-2 py-1 text-[10px] font-bold ' + (guideTool === 'cut' ? 'bg-rose-600 text-white' : 'bg-rose-100 text-rose-800')}>{isFa ? 'رسم برش' : 'Draw cut'}</button></div>
            </div>
            <div className="flex justify-center">
              <div ref={previewRef} data-ticket-sheet-preview onPointerDown={beginManualGuide} onPointerMove={movePreviewPointer} onPointerUp={finishPreviewPointer} onPointerCancel={finishPreviewPointer} className={'relative border border-slate-300 bg-white shadow-md dark:border-slate-600 ' + (guideTool ? 'cursor-crosshair' : '')}
                style={{
                  width: Math.min(420, metrics.sheetWidthMm * 1.6),
                  aspectRatio: `${metrics.sheetWidthMm} / ${metrics.sheetHeightMm}`,
                }}
              >
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
                    const sequenceIndex = ticketSequenceIndex(ticketConfig, r, c, 0);
                    return (
                      <div key={`${r}-${c}`} data-ticket-cell={`${r}-${c}`} className="absolute box-border border border-dashed border-slate-300 bg-slate-50/80"
                        style={{ left: `${left}%`, top: `${top}%`, width: `${w}%`, height: `${h}%` }}
                      >
                        {selectedSource?.thumbnailDataUrl && (
                          <img
                            src={selectedSource.thumbnailDataUrl}
                            alt={isFa ? 'تصویر فرم اصلی قبض' : 'Receipt source artwork'}
                            draggable={false}
                            className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
                          />
                        )}
                        {ticketConfig.numberSlots.map((slot) => (
                          <div key={slot.id} data-ticket-slot-id={slot.id} onPointerDown={event => beginSlotDrag(event, slot.id, r, c)} title={isFa ? 'برای جابه‌جایی شماره با ماوس بکشید' : 'Drag to move this number'} className="absolute flex items-center justify-center overflow-hidden text-[9px] font-bold leading-tight cursor-move select-none" style={{ touchAction: 'none',
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
                            {resolveTicketSlotText(slot, sequenceIndex, metrics.totalTickets, ticketConfig)}
                          </div>
                        ))}
                      </div>
                    );
                  })
                )}
                {ticketConfig.guideLines.flatMap(guide => {
                  const cells = guide.extendFullSheet
                    ? (guide.orientation === 'vertical'
                      ? Array.from({ length: metrics.cols }, (_, col) => ({ row: 0, col }))
                      : Array.from({ length: metrics.rows }, (_, row) => ({ row, col: 0 })))
                    : Array.from({ length: metrics.rows * metrics.cols }, (_, index) => ({ row: Math.floor(index / metrics.cols), col: index % metrics.cols }));
                  return cells.map(({ row, col }) => {
                    const frame = cellFrame(row, col);
                    const left = frame.left / metrics.sheetWidthMm * 100;
                    const top = frame.top / metrics.sheetHeightMm * 100;
                    const width = frame.width / metrics.sheetWidthMm * 100;
                    const height = frame.height / metrics.sheetHeightMm * 100;
                    const lineLeft = left + (guide.orientation === 'vertical' ? width * guide.positionPercent / 100 : 0);
                    const lineTop = top + (guide.orientation === 'horizontal' ? height * guide.positionPercent / 100 : 0);
                    const gradient = guide.strokeStyle === 'dotted'
                      ? (guide.orientation === 'vertical' ? `repeating-linear-gradient(to bottom, ${guide.strokeColor} 0 1px, transparent 1px 4px)` : `repeating-linear-gradient(to right, ${guide.strokeColor} 0 1px, transparent 1px 4px)`)
                      : guide.strokeStyle === 'dashed'
                        ? (guide.orientation === 'vertical' ? `repeating-linear-gradient(to bottom, ${guide.strokeColor} 0 5px, transparent 5px 9px)` : `repeating-linear-gradient(to right, ${guide.strokeColor} 0 5px, transparent 5px 9px)`)
                        : guide.strokeColor;
                    return <button key={guide.id + '-' + row + '-' + col} type="button"
                      data-ticket-guide-id={guide.id} data-ticket-guide-row={row} data-ticket-guide-col={col}
                      aria-label={guide.label} title={guide.label + (isFa ? '؛ برای جابه‌جایی بکشید' : '; drag to move')}
                      onPointerDown={event => beginGuideDrag(event, guide.id, row, col, guide.orientation)}
                      className="absolute z-20 p-0"
                      style={guide.orientation === 'vertical'
                        ? { left: `${lineLeft}%`, top: guide.extendFullSheet ? 0 : `${top}%`, height: guide.extendFullSheet ? '100%' : `${height}%`, width: 4, transform: 'translateX(-50%)', background: gradient, cursor: 'ew-resize', touchAction: 'none' }
                        : { left: guide.extendFullSheet ? 0 : `${left}%`, top: `${lineTop}%`, width: guide.extendFullSheet ? '100%' : `${width}%`, height: 4, transform: 'translateY(-50%)', background: gradient, cursor: 'ns-resize', touchAction: 'none' }} />;
                  });
                })}
              </div>
            </div>
            <p className="mt-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
              {isFa
                ? 'پس از تولید، تمام شیت ها در استودیو باز می شوند و قابل ویرایش هستند.'
                : 'After generate, all sheets open in Studio and can be edited.'}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default TicketNumberingWorkspace;
