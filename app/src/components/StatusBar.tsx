import React from 'react';
import {
  ZoomIn,
  ZoomOut,
  Contrast,
  Calculator,
  FileSpreadsheet,
  Calendar,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { t } from '../i18n/translations';
import { computeCounterSummary } from '../engine/counterEngine';
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
    documents,
    pages,
    layout,
    effects,
    settings,
    activeSheetIndex,
    zoomPercent,
    setZoomPercent,
    setModalState,
  } = useAppStore();

  const lang = settings.language;
  const tr = t(lang);
  const summary = computeCounterSummary(documents, pages, layout, settings);

  const highlightedIdx = pages.findIndex((p) => p.isHighlighted);
  const currentPageNum = highlightedIdx >= 0 ? highlightedIdx + 1 : 1;

  return (
    <footer className="flex h-8 shrink-0 items-center justify-between border-t border-slate-800 bg-slate-900 px-3 text-[11px] text-slate-300 select-none">
      {/* Start: Page x/y, Sheet x of y, Paper Size, Cursor */}
      <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1">
          <span className="text-slate-400">{tr.statusBar.page}:</span>
          <span className="font-bold text-white">
            {formatLocalizedNumber(pages.length > 0 ? currentPageNum : 0, lang)} /{' '}
            {formatLocalizedNumber(pages.length, lang)}
          </span>
        </div>

        <span className="text-slate-700">|</span>

        <div className="flex items-center gap-1">
          <span className="text-slate-400">{tr.statusBar.sheet}:</span>
          <span className="font-bold text-sky-400">
            {formatLocalizedNumber(
              summary.totalImpressions > 0 ? activeSheetIndex + 1 : 0,
              lang
            )}{' '}
            {tr.preview.of}{' '}
            {formatLocalizedNumber(summary.totalImpressions, lang)}
          </span>
        </div>

        <span className="text-slate-700">|</span>

        <div className="flex items-center gap-1">
          <span className="text-slate-400">{tr.statusBar.paper}:</span>
          <span className="font-semibold text-slate-200">
            {layout.paperSize} ({layout.orientation}) • {layout.rows}×{layout.cols}
          </span>
        </div>

        {cursorPos && (
          <>
            <span className="text-slate-700">|</span>
            <div className="font-mono text-[10px] text-slate-400">
              X: {cursorPos.x} {settings.unit} , Y: {cursorPos.y} {settings.unit}
            </div>
          </>
        )}

        {effects.invert && (
          <>
            <span className="text-slate-700">|</span>
            <span className="inline-flex items-center gap-1 rounded bg-fuchsia-500/20 px-1.5 py-0.5 text-[10px] font-bold text-fuchsia-300">
              <Contrast className="h-3 w-3" />
              {tr.statusBar.invertActive}
            </span>
          </>
        )}
      </div>

      {/* End: Live Counter Summary + Calendar + Zoom Slider */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setModalState('counter', true)}
          className="hidden md:flex items-center gap-2 rounded-md bg-slate-800/90 px-2.5 py-0.5 text-[11px] hover:bg-slate-700 cursor-pointer"
        >
          <Calculator className="h-3 w-3 text-amber-400" />
          <span>
            {lang === 'fa'
              ? `${formatLocalizedNumber(summary.totalFiles, lang)} فایل • ${formatLocalizedNumber(
                  summary.selectedPages,
                  lang
                )} صفحه فعال • ${formatLocalizedNumber(
                  summary.totalPhysicalSheets,
                  lang
                )} برگ کاغذ (${formatLocalizedNumber(
                  summary.estimatedCostRials,
                  lang
                )} ریال)`
              : `${summary.totalFiles} files • ${summary.selectedPages} pages • ${summary.totalPhysicalSheets} physical sheets`}
          </span>
        </button>

        <div className="hidden xl:flex items-center gap-1 text-[10px] text-slate-400">
          <Calendar className="h-3 w-3 text-sky-400" />
          <span>
            {settings.calendar === 'shamsi'
              ? formatShamsiDate(new Date(), lang === 'fa')
              : formatGregorianDate(new Date())}
          </span>
        </div>

        {/* Zoom Slider */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoomPercent(zoomPercent - 15)}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <input
            type="range"
            min={35}
            max={250}
            value={zoomPercent}
            onChange={(e) => setZoomPercent(Number(e.target.value))}
            className="w-20 accent-sky-500 cursor-pointer"
          />
          <button
            type="button"
            onClick={() => setZoomPercent(zoomPercent + 15)}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-end font-mono text-[10px] font-bold text-sky-400">
            {zoomPercent}%
          </span>
        </div>
      </div>
    </footer>
  );
};
