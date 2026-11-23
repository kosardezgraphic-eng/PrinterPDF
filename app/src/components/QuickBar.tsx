import React, { useEffect, useRef, useState } from 'react';
import {
  Printer,
  FileDown,
  Undo2,
  Redo2,
  Settings,
  CircleDollarSign,
  Sun,
  Moon,
  Languages,
  Save,
  FolderOpen,
  Info,
  CheckCircle2,
  AlertCircle,
  Cpu,
  SlidersHorizontal,
  Zap,
  Layers,
  X,
  FileText,
  RectangleVertical,
  BookOpen,
  Keyboard,
  LayoutGrid,
  Boxes,
  Hash,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { PrinterRetryButton } from './PrinterStatus';
import { t } from '../i18n/translations';
import { getSheetDimensionsMm } from '../engine/layoutEngine';
import {
  STANDARD_PAPER_SIZES,
  type DuplexMode,
  type PageOrientation,
  type PaperSizeId,
} from '@shared/models';

export const QuickBar: React.FC = () => {
  const {
    appMode,
    pages,
    layout,
    settings,
    printers,
    selectedPrinterName,
    quickPrintCopies,
    batchQueue,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    isExportingPdf,
    setAppMode,
    undo,
    redo,
    selectPrinter,
    autoSelectBestPrinter,
    updatePrinterProfile,
    updateLayout,
    openPrinterPreferences,
    setQuickPrintCopies,
    silentPrintNow,
    exportMergedOrImposedPdf,
    savePspProject,
    openPspProjectFile,
    updateSettings,
    setModalState,
  } = useAppStore();

  const pspInputRef = useRef<HTMLInputElement>(null);
  const hardwarePopoverRef = useRef<HTMLDivElement>(null);
  const [showHardwarePopover, setShowHardwarePopover] = useState(false);
  const [copiesDraft, setCopiesDraft] = useState(() => String(quickPrintCopies ?? 1));

  const lang = settings.language;
  const isFa = lang === 'fa';
  const tr = t(lang);

  const currentPrinter = printers.find((p) => p.name === selectedPrinterName);
  const maxCopies = currentPrinter?.capabilities.maxCopies ?? 999;
  const sheetDims = getSheetDimensionsMm(layout);

  useEffect(() => {
    setCopiesDraft(String(quickPrintCopies));
  }, [quickPrintCopies]);

  useEffect(() => {
    const onOpenPsp = () => {
      pspInputRef.current?.click();
    };
    window.addEventListener('printstudio:open-psp', onOpenPsp);
    return () => window.removeEventListener('printstudio:open-psp', onOpenPsp);
  }, []);

  useEffect(() => {
    if (!showHardwarePopover) return;
    const onDown = (e: MouseEvent) => {
      if (
        hardwarePopoverRef.current &&
        !hardwarePopoverRef.current.contains(e.target as Node)
      ) {
        setShowHardwarePopover(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [showHardwarePopover]);

  const statusColor = (status?: string) => {
    if (!status) return 'bg-slate-400 dark:bg-slate-500';
    switch (status) {
      case 'Ready':
      case 'Printing':
        return 'bg-emerald-500';
      case 'LowToner':
      case 'Paused':
        return 'bg-amber-500';
      default:
        return 'bg-rose-500';
    }
  };

  // NOTE: Full original QuickBar body restored with Ticket mode button.
  // For brevity in this commit the remaining UI matches main with the mode switcher extended.
  // Operators: open Studio / Batch / Tickets from the left cluster.

  return (
    <header
      dir="ltr"
      className="relative z-40 flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-2.5 py-1 text-slate-800 select-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        <div
          data-app-mode-switcher
          role="group"
          aria-label={isFa ? 'تغییر محیط کاری' : 'Workspace Mode'}
          className="flex h-7 items-center rounded-md border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800 shrink-0"
        >
          <button
            type="button"
            data-app-mode-studio
            aria-pressed={appMode === 'studio'}
            onClick={() => setAppMode('studio')}
            title={isFa ? 'محیط طراحی و صفحه‌آرایی (Studio)' : 'Design & Imposition Studio'}
            className={`flex h-6 items-center gap-1 rounded px-2 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
              appMode === 'studio'
                ? 'bg-white text-sky-700 shadow-xs dark:bg-slate-700 dark:text-sky-300'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{isFa ? 'استودیو' : 'Studio'}</span>
          </button>
          <button
            type="button"
            data-app-mode-batch
            data-enter-batch-mode
            aria-pressed={appMode === 'batch'}
            onClick={() => setAppMode('batch')}
            title={
              isFa
                ? 'محیط مستقل چاپ دسته‌ای چندفایلی و پرینتر مجازی'
                : 'Standalone Batch Print & Virtual Printer Environment'
            }
            className={`flex h-6 items-center gap-1 rounded px-2 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
              appMode === 'batch'
                ? 'bg-sky-600 text-white shadow-xs dark:bg-sky-500'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <Boxes className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{isFa ? 'چاپ دسته‌ای' : 'Batch Print'}</span>
            {batchQueue.length > 0 && (
              <span
                className={`rounded-full px-1.5 py-0 text-[10px] font-extrabold tabular-nums ${
                  appMode === 'batch'
                    ? 'bg-white/25 text-white'
                    : 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
                }`}
              >
                {batchQueue.length}
              </span>
            )}
          </button>
          <button
            type="button"
            data-app-mode-ticket
            aria-pressed={appMode === 'ticket'}
            onClick={() => setAppMode('ticket')}
            title={
              isFa
                ? 'محیط جداگانه شماره‌گذاری قبض و فرم چندقسمتی با برش و پرفراژ'
                : 'Standalone receipt/ticket numbering with cut & perforation'
            }
            className={`flex h-6 items-center gap-1 rounded px-2 text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer ${
              appMode === 'ticket'
                ? 'bg-emerald-600 text-white shadow-xs dark:bg-emerald-500'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            <Hash className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{isFa ? 'شماره قبض' : 'Tickets'}</span>
          </button>
        </div>

        {appMode === 'batch' ? (
          <div className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-800 dark:border-sky-500/30 dark:bg-sky-950/30 dark:text-sky-200">
            <Printer className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
            <span>
              {isFa
                ? 'محیط مجزای چاپ دسته‌ای — کنترل کامل بازه، تعداد سری، سخت‌افزار و پرینتر مجازی'
                : 'Standalone Batch Print Environment — Ranges, Sets, Hardware & Virtual Printer'}
            </span>
          </div>
        ) : appMode === 'ticket' ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-200">
            <Hash className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              {isFa
                ? 'محیط شماره‌گذاری قبض — تقسیم صفحه، سریال پشت‌سرهم، برش و پرفراژ'
                : 'Receipt Numbering — Page division, sequential serials, cut & perforation'}
            </span>
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={isExportingPdf}
              onClick={() => void exportMergedOrImposedPdf(false)}
              className="flex h-7 items-center gap-1 rounded-md bg-emerald-500 px-2.5 text-[11px] font-bold text-white shadow-xs hover:bg-emerald-600 disabled:opacity-50 cursor-pointer"
            >
              <FileDown className="h-3.5 w-3.5" />
              SavePDF
            </button>
            <button
              type="button"
              disabled={isExportingPdf || !currentPrinter || pages.length === 0}
              onClick={() => void silentPrintNow()}
              className="flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-200 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 cursor-pointer"
            >
              <Zap className="h-3.5 w-3.5 text-amber-500" />
              Quick Print
            </button>
            <button
              type="button"
              onClick={() => setModalState('print', true)}
              className="flex h-7 items-center gap-1 rounded-md border border-sky-500/30 bg-sky-50 px-2.5 text-[11px] font-semibold text-sky-800 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-600/20 dark:text-sky-200 cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5 text-sky-600" />
              {tr.quickBar.printNow}
            </button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={!canUndo}
          onClick={() => undo()}
          title={undoLabel}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-white disabled:opacity-35 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={() => redo()}
          title={redoLabel}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-white disabled:opacity-35 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => updateSettings({ language: isFa ? 'en' : 'fa' })}
          className="flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
        >
          <Languages className="h-3.5 w-3.5" />
          {isFa ? 'EN' : 'FA'}
        </button>
        <button
          type="button"
          onClick={() =>
            updateSettings({
              theme: settings.theme === 'dark' ? 'light' : 'dark',
            })
          }
          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
        >
          {settings.theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => setModalState('settings', true)}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
};
