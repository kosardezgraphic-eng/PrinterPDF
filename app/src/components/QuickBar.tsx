import React, { useRef } from 'react';
import {
  Printer,
  FileDown,
  Undo2,
  Redo2,
  Settings,
  Calculator,
  Sparkles,
  Sun,
  Moon,
  Languages,
  Save,
  FolderOpen,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
  Cpu,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { PrinterRetryButton } from './PrinterStatus';
import { t } from '../i18n/translations';
import { computeCounterSummary } from '../engine/counterEngine';
import { formatLocalizedNumber } from '../i18n/shamsi';

export const QuickBar: React.FC = () => {
  const {
    documents,
    pages,
    layout,
    settings,
    printers,
    selectedPrinterName,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    isExportingPdf,
    undo,
    redo,
    selectPrinter,
    autoSelectBestPrinter,
    exportMergedOrImposedPdf,
    savePspProject,
    openPspProjectFile,
    updateSettings,
    setModalState,
  } = useAppStore();

  const pspInputRef = useRef<HTMLInputElement>(null);
  const lang = settings.language;
  const tr = t(lang);

  const summary = computeCounterSummary(documents, pages, layout, settings);
  const currentPrinter = printers.find((p) => p.name === selectedPrinterName);

  const statusColor = (status?: string) => {
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

  return (
    <header className="flex h-13 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/95 px-3 select-none">
      {/* Left / Start Brand + Primary Actions */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl bg-gradient-to-l from-sky-600/20 to-indigo-600/20 border border-sky-500/30 px-3 py-1.5">
          <Printer className="h-5 w-5 text-sky-400" />
          <div className="leading-tight">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-black tracking-tight text-white">
                PrintStudio Pro
              </span>
              <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-bold text-sky-300">
                v1.0
              </span>
            </div>
            <p className="text-[10px] text-slate-400 hidden sm:block">
              {tr.appSubtitle}
            </p>
          </div>
        </div>

        {/* Print Now (G1/G2) */}
        <button
          type="button"
          onClick={() => setModalState('print', true)}
          title="چاپ با پیش‌نمایش و تنظیمات کامل پرینتر (Ctrl+P)"
          className="flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-sky-500 active:scale-[0.99] transition cursor-pointer"
        >
          <Printer className="h-4 w-4" />
          <span>{tr.quickBar.printNow}</span>
        </button>

        {/* Save As PDF (C1/C2) */}
        <button
          type="button"
          disabled={isExportingPdf}
          onClick={() => void exportMergedOrImposedPdf(false)}
          title="ادغام و ساخت فایل PDF نهایی مطابق چیدمان و افکت‌ها (Ctrl+S)"
          className="flex items-center gap-1.5 rounded-xl bg-emerald-600/90 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 transition cursor-pointer"
        >
          <FileDown className="h-4 w-4" />
          <span>{tr.quickBar.saveAsPdf}</span>
        </button>

        {/* Counter & Cost Dashboard (B1/B2) */}
        <button
          type="button"
          onClick={() => setModalState('counter', true)}
          className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-sky-500/50 hover:bg-slate-800 transition cursor-pointer"
        >
          <Calculator className="h-4 w-4 text-amber-400" />
          <span>{tr.quickBar.counterDashboard}</span>
          <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-bold text-amber-300">
            {formatLocalizedNumber(summary.totalPhysicalSheets, lang)}{' '}
            {lang === 'fa' ? 'برگ' : 'sh'}
          </span>
        </button>

        <div className="mx-1 h-5 w-px bg-slate-800" />

        {/* Undo / Redo (A5) */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canUndo}
            onClick={undo}
            title={undoLabel ? `${tr.quickBar.undo}: ${undoLabel}` : tr.quickBar.undo}
            className="rounded-lg border border-slate-800 bg-slate-800/60 p-1.5 text-slate-300 hover:bg-slate-700 disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={redo}
            title={redoLabel ? `${tr.quickBar.redo}: ${redoLabel}` : tr.quickBar.redo}
            className="rounded-lg border border-slate-800 bg-slate-800/60 p-1.5 text-slate-300 hover:bg-slate-700 disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
          >
            <Redo2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Center: Live Printer Selector + Auto-Select (I1) */}
      <div className="hidden lg:flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-2.5 py-1">
        <span
          className={`h-2.5 w-2.5 rounded-full ${statusColor(currentPrinter?.status)}`}
          title={`وضعیت پرینتر: ${currentPrinter?.status ?? 'Ready'}`}
        />
        <select
          aria-label="انتخاب پرینتر"
          value={selectedPrinterName}
          onChange={(e) => selectPrinter(e.target.value)}
          className="bg-transparent text-xs font-medium text-slate-200 focus:outline-none max-w-[250px] truncate cursor-pointer"
        >
          {printers.length === 0 && (
            <option value="" className="bg-slate-900 text-slate-400">
              {tr.quickBar.noPrinter}
            </option>
          )}
          {printers.map((p) => (
            <option key={p.name} value={p.name} className="bg-slate-900 text-slate-100">
              {p.name} [{p.status}]
            </option>
          ))}
        </select>

        <PrinterRetryButton compact />

        {currentPrinter?.status === 'Ready' ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        )}

        <button
          type="button"
          onClick={autoSelectBestPrinter}
          title={
            lang === 'fa'
              ? 'انتخاب هوشمند بهترین پرینتر آماده بر اساس سایز کاغذ و رنگی/سیاه‌وسفید بودن سند'
              : 'Smart auto-select optimal Ready printer by paper size & color'
          }
          className="flex items-center gap-1 rounded-lg bg-sky-500/15 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/25 cursor-pointer"
        >
          <Cpu className="h-3 w-3" />
          <span>{lang === 'fa' ? 'خودکار' : 'Auto'}</span>
        </button>
      </div>

      {/* Right / End: Project .psp, Language, Theme, Tour, Settings */}
      <div className="flex items-center gap-1.5">
        <input
          ref={pspInputRef}
          type="file"
          accept=".psp,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openPspProjectFile(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={savePspProject}
          title={tr.quickBar.saveProject}
          className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-800/70 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
        >
          <Save className="h-3.5 w-3.5 text-sky-400" />
          <span className="hidden xl:inline">.psp</span>
        </button>
        <button
          type="button"
          onClick={() => pspInputRef.current?.click()}
          title={lang === 'fa' ? 'باز کردن فایل پروژه .psp' : 'Open .psp Project'}
          className="rounded-lg border border-slate-800 bg-slate-800/70 p-1.5 text-slate-300 hover:bg-slate-700 cursor-pointer"
        >
          <FolderOpen className="h-3.5 w-3.5 text-amber-400" />
        </button>

        {/* Live RTL/LTR Language Switcher */}
        <button
          type="button"
          onClick={() =>
            updateSettings({ language: settings.language === 'fa' ? 'en' : 'fa' })
          }
          title="تغییر زنده زبان فارسی (RTL) / انگلیسی (LTR)"
          className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-800/70 px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 cursor-pointer"
        >
          <Languages className="h-3.5 w-3.5 text-indigo-400" />
          <span>{settings.language === 'fa' ? 'FA / فارسی' : 'EN / English'}</span>
        </button>

        {/* Theme Switcher */}
        <button
          type="button"
          onClick={() =>
            updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
          }
          title="تغییر تم روشن / تیره"
          className="rounded-lg border border-slate-800 bg-slate-800/70 p-1.5 text-slate-300 hover:bg-slate-700 cursor-pointer"
        >
          {settings.theme === 'dark' ? (
            <Sun className="h-4 w-4 text-amber-400" />
          ) : (
            <Moon className="h-4 w-4 text-sky-400" />
          )}
        </button>

        {/* Onboarding Tour */}
        <button
          type="button"
          onClick={() => setModalState('tour', true)}
          title={tr.quickBar.tour}
          className="rounded-lg border border-slate-800 bg-slate-800/70 p-1.5 text-slate-300 hover:bg-slate-700 cursor-pointer"
        >
          <HelpCircle className="h-4 w-4 text-emerald-400" />
        </button>

        {/* Settings (K1) */}
        <button
          type="button"
          onClick={() => setModalState('settings', true)}
          title={tr.quickBar.settings}
          className="rounded-lg border border-slate-800 bg-slate-800/70 p-1.5 text-slate-300 hover:bg-slate-700 cursor-pointer"
        >
          <Settings className="h-4 w-4 text-slate-300" />
        </button>
      </div>
    </header>
  );
};
