import React from 'react';
import { Contrast, Calendar } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { t } from '../i18n/translations';
import { computeCounterSummary } from '../engine/counterEngine';
import { getSheetDimensionsMm } from '../engine/layoutEngine';
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
    printers,
    selectedPrinterName,
    activeSheetIndex,
  } = useAppStore();

  const lang = settings.language;
  const tr = t(lang);
  const summary = computeCounterSummary(documents, pages, layout, settings);
  const sheetDims = getSheetDimensionsMm(layout);
  const selectedPrinter = printers.find((p) => p.name === selectedPrinterName);

  const highlightedIdx = pages.findIndex((p) => p.isHighlighted);
  const currentPageNum = highlightedIdx >= 0 ? highlightedIdx + 1 : 1;

  return (
    <footer data-status-bar-info className="flex h-7 shrink-0 items-center justify-between border-t border-slate-800 bg-slate-900 px-3 text-[11px] text-slate-300 select-none">
      {/* Start: Page x/y, Sheet x of y, Paper Size, Cursor */}
      <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1">
          <span className="text-slate-400">{tr.statusBar.page}:</span>
          <span className="font-bold text-white tabular-nums">
            {formatLocalizedNumber(pages.length > 0 ? currentPageNum : 0, lang)} /{' '}
            {formatLocalizedNumber(pages.length, lang)}
          </span>
        </div>

        <span className="text-slate-700">|</span>

        <div className="flex items-center gap-1">
          <span className="text-slate-400">{tr.statusBar.sheet}:</span>
          <span className="font-bold text-sky-400 tabular-nums">
            {formatLocalizedNumber(
              summary.totalImpressions > 0 ? activeSheetIndex + 1 : 0,
              lang
            )}{' '}
            {tr.preview.of}{' '}
            {formatLocalizedNumber(summary.totalImpressions, lang)}
          </span>
        </div>

        <span className="text-slate-700">|</span>

        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">{tr.statusBar.paper}:</span>
          <span className="font-semibold text-slate-200 tabular-nums whitespace-nowrap">
            {selectedPrinter?.activeProfile.paperName || layout.paperSize} ({Math.round(sheetDims.widthMm)}×{Math.round(sheetDims.heightMm)} mm · {layout.orientation}) • {layout.rows}×{layout.cols}
          </span>
          {selectedPrinter?.activeProfile.tray && (
            <span
              data-testid="status-tray"
              className="rounded border border-slate-700 bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-sky-300 whitespace-nowrap"
            >
              {lang === 'fa' ? 'سینی' : 'Tray'}: {selectedPrinter.activeProfile.tray}
            </span>
          )}
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

      {/* Date information only; counters live in QuickBar and zoom lives above the canvas. */}
      <div className="hidden xl:flex items-center gap-1 text-[10px] text-slate-400">
          <Calendar className="h-3 w-3 text-sky-400" />
          <span>
            {settings.calendar === 'shamsi'
              ? formatShamsiDate(new Date(), lang === 'fa')
              : formatGregorianDate(new Date())}
          </span>
      </div>
    </footer>
  );
};
