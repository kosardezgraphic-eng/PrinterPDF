import React from 'react';
import { Contrast, Calendar, ZoomIn, ZoomOut, Boxes, Hash } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { t } from '../i18n/translations';
import { computeCounterSummary } from '../engine/counterEngine';
import { estimateBatchJobMetrics } from '../engine/batchService';
import { getSheetDimensionsMm } from '../engine/layoutEngine';
import { getTicketGridMetrics } from '../engine/ticketNumbering';
import {
  formatGregorianDate,
  formatLocalizedNumber,
  formatShamsiDate,
} from '../i18n/shamsi';

interface StatusBarProps {
  cursorPos: { x: number; y: number } | null;
}

export const StatusBar: React.FC<StatusBarProps> = ({ cursorPos }) => {
  const {
    appMode,
    documents,
    pages,
    layout,
    effects,
    settings,
    printers,
    selectedPrinterName,
    batchQueue,
    ticketConfig,
    activeSheetIndex,
    zoomPercent,
    setZoomPercent,
  } = useAppStore();

  const lang = settings.language;
  const isFa = lang === 'fa';
  const tr = t(lang);
  const summary = computeCounterSummary(documents, pages, layout, settings);
  const sheetDims = getSheetDimensionsMm(layout);
  const selectedPrinter = printers.find((p) => p.name === selectedPrinterName);

  const highlightedIdx = pages.findIndex((p) => p.isHighlighted);
  const currentPageNum = highlightedIdx >= 0 ? highlightedIdx + 1 : 1;

  if (appMode === 'batch') {
    const queuedCount = batchQueue.filter(
      (b) => b.status === 'queued' || b.status === 'paused' || b.status === 'processing'
    ).length;
    const completedCount = batchQueue.filter((b) => b.status === 'completed').length;
    const totalBatchSheets = batchQueue.reduce(
      (sum, j) => sum + estimateBatchJobMetrics(j).totalSheets,
      0
    );

    return (
      <footer
        data-status-bar-info
        data-status-bar-mode="batch"
        dir="ltr"
        className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-100 px-3 text-[11px] text-slate-700 select-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
      >
        <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 text-[10px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
            <Calendar className="h-3 w-3 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">
              {settings.calendar === 'shamsi'
                ? formatShamsiDate(new Date(), isFa)
                : formatGregorianDate(new Date())}
            </span>
          </div>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <div
            dir={isFa ? 'rtl' : 'ltr'}
            className="flex items-center gap-1.5 rounded bg-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-700 border border-slate-200 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 whitespace-nowrap tabular-nums"
          >
            <Boxes className="h-3 w-3 text-sky-600 dark:text-sky-400 shrink-0" />
            {isFa ? (
              <span>
                صف چاپ دسته‌ای: {formatLocalizedNumber(batchQueue.length, lang)} فایل •{' '}
                {formatLocalizedNumber(queuedCount, lang)} در انتظار •{' '}
                {formatLocalizedNumber(completedCount, lang)} ارسال‌شده •{' '}
                {formatLocalizedNumber(totalBatchSheets, lang)} برگ کاغذ
              </span>
            ) : (
              <span>
                Batch Queue: {batchQueue.length} files · {queuedCount} pending · {completedCount} completed · {totalBatchSheets} sheets
              </span>
            )}
          </div>
        </div>

        <div dir={isFa ? 'rtl' : 'ltr'} className="flex items-center gap-2 text-[10px] whitespace-nowrap">
          <span className="text-slate-500 dark:text-slate-400">
            {isFa ? 'پرینتر فعال:' : 'Active Printer:'}
          </span>
          <span className="font-bold text-sky-700 dark:text-sky-300">
            {selectedPrinter?.name || tr.quickBar.noPrinter}
          </span>
        </div>
      </footer>
    );
  }

  if (appMode === 'ticket') {
    const ticketMetrics = getTicketGridMetrics(ticketConfig);
    return (
      <footer
        data-status-bar-info
        data-status-bar-mode="ticket"
        dir="ltr"
        className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-100 px-3 text-[11px] text-slate-700 select-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
      >
        <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 text-[10px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
            <Calendar className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">
              {settings.calendar === 'shamsi'
                ? formatShamsiDate(new Date(), isFa)
                : formatGregorianDate(new Date())}
            </span>
          </div>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <div
            dir={isFa ? 'rtl' : 'ltr'}
            className="flex items-center gap-1.5 rounded bg-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-700 border border-slate-200 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 whitespace-nowrap tabular-nums"
          >
            <Hash className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
            {isFa ? (
              <span>
                تقسیم‌بندی {formatLocalizedNumber(ticketMetrics.rows, lang)}×{formatLocalizedNumber(ticketMetrics.cols, lang)} •{' '}
                {formatLocalizedNumber(ticketMetrics.effectiveSheetCount, lang)} شیت •{' '}
                {formatLocalizedNumber(ticketMetrics.totalTickets, lang)} قبض •{' '}
                {ticketConfig.orderingMode === 'cut-stack' ? 'روی هم (پشت‌سرهم پس از برش)' : 'صفحه‌ای'}
              </span>
            ) : (
              <span>
                Grid {ticketMetrics.rows}×{ticketMetrics.cols} · {ticketMetrics.effectiveSheetCount} sheets ·{' '}
                {ticketMetrics.totalTickets} tickets ·{' '}
                {ticketConfig.orderingMode === 'cut-stack' ? 'Cut & Stack' : 'Per Sheet'}
              </span>
            )}
          </div>
        </div>

        <div dir={isFa ? 'rtl' : 'ltr'} className="flex items-center gap-2 text-[10px] whitespace-nowrap">
          <span className="text-slate-500 dark:text-slate-400">
            {isFa ? 'کاغذ خروجی:' : 'Output Paper:'}
          </span>
          <span dir="ltr" className="font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
            {ticketConfig.paperSize} ({Math.round(ticketMetrics.sheetWidthMm)}×{Math.round(ticketMetrics.sheetHeightMm)} mm ·{' '}
            {ticketConfig.orientation})
          </span>
        </div>
      </footer>
    );
  }

  return (
    <footer
      data-status-bar-info
      dir="ltr"
      className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-100 px-3 text-[11px] text-slate-700 select-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
    >
      {/* Left Side: Zoom Toolbar + Shamsi/Gregorian Date + Document/Sheet Summary */}
      <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar">
        <div
          data-zoom-toolbar
          className="flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800"
        >
          <span className="min-w-8 text-center font-mono text-[10px] font-bold text-sky-700 dark:text-sky-400 tabular-nums">
            {zoomPercent}%
          </span>
          <button
            type="button"
            aria-label={isFa ? 'کوچک‌نمایی' : 'Zoom out'}
            title={isFa ? 'کوچک‌نمایی' : 'Zoom out'}
            onClick={() => setZoomPercent(Math.max(5, zoomPercent - 15))}
            className="rounded p-0.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
          >
            <ZoomOut className="h-3 w-3" aria-hidden="true" />
          </button>
          <input
            aria-label={isFa ? 'درصد بزرگ‌نمایی' : 'Zoom percentage'}
            type="range"
            min={5}
            max={400}
            value={zoomPercent}
            onChange={(e) => setZoomPercent(Number(e.target.value))}
            className="h-1.5 w-16 accent-sky-600 dark:accent-sky-500 cursor-pointer"
          />
          <button
            type="button"
            aria-label={isFa ? 'بزرگ‌نمایی' : 'Zoom in'}
            title={isFa ? 'بزرگ‌نمایی' : 'Zoom in'}
            onClick={() => setZoomPercent(Math.min(400, zoomPercent + 15))}
            className="rounded p-0.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
          >
            <ZoomIn className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>

        <span className="text-slate-300 dark:text-slate-700">|</span>

        <div className="flex items-center gap-1 text-[10px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
          <Calendar className="h-3 w-3 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
          <span className="tabular-nums">
            {settings.calendar === 'shamsi'
              ? formatShamsiDate(new Date(), isFa)
              : formatGregorianDate(new Date())}
          </span>
        </div>

        <span className="hidden lg:inline text-slate-300 dark:text-slate-700">|</span>

        <div
          dir={isFa ? 'rtl' : 'ltr'}
          className="hidden lg:flex items-center gap-1 rounded bg-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-700 border border-slate-200 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 whitespace-nowrap tabular-nums"
        >
          {isFa ? (
            <span>
              {formatLocalizedNumber(summary.totalFiles, lang)} فایل •{' '}
              {formatLocalizedNumber(summary.selectedPages, lang)} صفحه فعال •{' '}
              {formatLocalizedNumber(summary.totalPhysicalSheets, lang)} برگ کاغذ (
              {formatLocalizedNumber(summary.estimatedCostRials, lang)} ریال)
            </span>
          ) : (
            <span>
              {summary.totalFiles} files · {summary.selectedPages} active pages ·{' '}
              {summary.totalPhysicalSheets} sheets (
              {summary.estimatedCostRials.toLocaleString()} IRR)
            </span>
          )}
        </div>
      </div>

      {/* Right Side: Tray + Paper + Output Sheet + Page + Cursor + Invert */}
      <div
        dir={isFa ? 'rtl' : 'ltr'}
        className="flex items-center gap-2.5 overflow-x-auto no-scrollbar"
      >
        {selectedPrinter?.activeProfile.tray && (
          <span
            data-testid="status-tray"
            className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-sky-300 whitespace-nowrap"
          >
            {isFa ? 'سینی' : 'Tray'}: {selectedPrinter.activeProfile.tray}
          </span>
        )}

        <div className="flex items-center gap-1 whitespace-nowrap">
          <span className="text-slate-500 dark:text-slate-400">{tr.statusBar.paper}:</span>
          <span
            dir="ltr"
            className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums"
          >
            {selectedPrinter?.activeProfile.paperName || layout.paperSize} (
            {Math.round(sheetDims.widthMm)}×{Math.round(sheetDims.heightMm)} mm ·{' '}
            {layout.orientation}) • {layout.rows}×{layout.cols}
          </span>
        </div>

        <span className="text-slate-300 dark:text-slate-700">|</span>

        <div className="flex items-center gap-1 whitespace-nowrap">
          <span className="text-slate-500 dark:text-slate-400">{tr.statusBar.sheet}:</span>
          <span className="font-bold text-sky-700 dark:text-sky-400 tabular-nums">
            {formatLocalizedNumber(
              summary.totalImpressions > 0 ? activeSheetIndex + 1 : 0,
              lang
            )}{' '}
            {tr.preview.of}{' '}
            {formatLocalizedNumber(summary.totalImpressions, lang)}
          </span>
        </div>

        <span className="text-slate-300 dark:text-slate-700">|</span>

        <div className="flex items-center gap-1 whitespace-nowrap">
          <span className="text-slate-500 dark:text-slate-400">{tr.statusBar.page}:</span>
          <span className="font-bold text-slate-900 dark:text-white tabular-nums">
            {formatLocalizedNumber(pages.length > 0 ? currentPageNum : 0, lang)} /{' '}
            {formatLocalizedNumber(pages.length, lang)}
          </span>
        </div>

        {cursorPos && (
          <>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <div dir="ltr" className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
              X: {cursorPos.x} {settings.unit} , Y: {cursorPos.y} {settings.unit}
            </div>
          </>
        )}

        {effects.invert && (
          <>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <span className="inline-flex items-center gap-1 rounded bg-fuchsia-100 px-1.5 py-0.5 text-[10px] font-bold text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300 whitespace-nowrap">
              <Contrast className="h-3 w-3" aria-hidden="true" />
              {tr.statusBar.invertActive}
            </span>
          </>
        )}
      </div>
    </footer>
  );
};
