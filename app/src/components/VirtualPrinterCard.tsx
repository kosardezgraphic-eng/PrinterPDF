import React from 'react';
import {
  Printer,
  CheckCircle2,
  AlertCircle,
  Download,
  Trash2,
  RefreshCw,
  FileInput,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  STANDARD_PAPER_SIZES,
  type PageOrientation,
  type PaperSizeId,
} from '@shared/models';

const VIRTUAL_PAPER_CHOICES: PaperSizeId[] = [
  'A3',
  'A4',
  'A5',
  'B4',
  'B5',
  'Letter',
  'Legal',
  'Custom',
];

const VIRTUAL_DPI_CHOICES = [150, 300, 600, 1200];

interface VirtualPrinterCardProps {
  compact?: boolean;
}

export const VirtualPrinterCard: React.FC<VirtualPrinterCardProps> = ({
  compact = false,
}) => {
  const {
    settings,
    virtualPrinterStatus,
    virtualPrinterBusy,
    refreshVirtualPrinterStatus,
    updateVirtualPrinterConfig,
    installVirtualPrinter,
    uninstallVirtualPrinter,
  } = useAppStore();

  const lang = settings.language;
  const isFa = lang === 'fa';
  const cfg = virtualPrinterStatus?.config;

  const installed = Boolean(virtualPrinterStatus?.installedInWindows);
  const supportedOnOs = Boolean(virtualPrinterStatus?.supportedOnOs);

  const handlePaperSizeChange = (nextPaper: PaperSizeId) => {
    if (!cfg) return;
    if (nextPaper !== 'Custom' && nextPaper in STANDARD_PAPER_SIZES) {
      const dims =
        STANDARD_PAPER_SIZES[nextPaper as Exclude<PaperSizeId, 'Custom'>];
      void updateVirtualPrinterConfig({
        paperSize: nextPaper,
        paperWidthMm: dims.widthMm,
        paperHeightMm: dims.heightMm,
      });
    } else {
      void updateVirtualPrinterConfig({ paperSize: nextPaper });
    }
  };

  return (
    <div
      data-testid="virtual-printer-card"
      dir={isFa ? 'rtl' : 'ltr'}
      className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 text-xs text-slate-800 dark:border-indigo-500/30 dark:bg-indigo-950/20 dark:text-slate-100"
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shrink-0">
            <FileInput className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="font-bold text-slate-900 dark:text-white truncate">
                {isFa ? 'پرینتر مجازی ویندوز' : 'Windows Virtual Printer'}
              </h4>
              {installed ? (
                <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  {isFa ? 'نصب و فعال' : 'Installed'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                  <AlertCircle className="h-3 w-3" />
                  {isFa ? 'نصب نشده' : 'Not Installed'}
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              {cfg?.printerName || 'PrintStudio Pro Virtual Printer'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={virtualPrinterBusy}
            onClick={() => void refreshVirtualPrinterStatus()}
            title={isFa ? 'بررسی وضعیت پرینتر مجازی' : 'Refresh status'}
            className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>

          {!installed ? (
            <button
              type="button"
              data-install-virtual-printer
              disabled={virtualPrinterBusy || !supportedOnOs}
              onClick={() => void installVirtualPrinter()}
              title={
                supportedOnOs
                  ? isFa
                    ? 'نصب در لیست پرینترهای ویندوز'
                    : 'Install in Windows Printers list'
                  : isFa
                    ? 'نصب درایور ویندوز در نسخه دسکتاپ ویندوز فعال است'
                    : 'Requires Windows desktop app'
              }
              className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>
                {isFa ? 'نصب در ویندوز' : 'Install Printer'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              data-uninstall-virtual-printer
              disabled={virtualPrinterBusy}
              onClick={() => void uninstallVirtualPrinter()}
              className="flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-40 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-300 cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{isFa ? 'حذف از ویندوز' : 'Uninstall'}</span>
            </button>
          )}
        </div>
      </div>

      {!compact && (
        <p className="mb-2.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
          {isFa
            ? 'با انتخاب «PrintStudio Pro Virtual Printer» در هر نرم‌افزار ویندوز (Word، مرورگر، اتوکد و...) فایل مستقیماً و بدون دیالوگ ذخیره وارد محیط برنامه می‌شود.'
            : 'Print to "PrintStudio Pro Virtual Printer" from any Windows app to capture PDFs silently into your studio workspace.'}
        </p>
      )}

      {cfg && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-slate-600 dark:text-slate-400">
                {isFa ? 'اندازه صفحه (Paper Size)' : 'Paper Size'}
              </span>
              <select
                aria-label={isFa ? 'اندازه صفحه پرینتر مجازی' : 'Virtual Printer Paper Size'}
                value={cfg.paperSize}
                onChange={(e) =>
                  handlePaperSizeChange(e.target.value as PaperSizeId)
                }
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                {VIRTUAL_PAPER_CHOICES.map((id) => {
                  const dims =
                    id !== 'Custom'
                      ? STANDARD_PAPER_SIZES[id]
                      : { widthMm: cfg.paperWidthMm, heightMm: cfg.paperHeightMm };
                  return (
                    <option key={id} value={id}>
                      {id} ({Math.round(dims.widthMm)}×{Math.round(dims.heightMm)} mm)
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-slate-600 dark:text-slate-400">
                {isFa ? 'جهت صفحه (Orientation)' : 'Page Orientation'}
              </span>
              <select
                aria-label={isFa ? 'جهت صفحه پرینتر مجازی' : 'Virtual Printer Orientation'}
                value={cfg.orientation}
                onChange={(e) =>
                  void updateVirtualPrinterConfig({
                    orientation: e.target.value as PageOrientation,
                  })
                }
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="portrait">
                  {isFa ? 'عمودی (Portrait)' : 'Portrait'}
                </option>
                <option value="landscape">
                  {isFa ? 'افقی (Landscape)' : 'Landscape'}
                </option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-slate-600 dark:text-slate-400">
                {isFa ? 'رزولوشن چاپ (DPI)' : 'Print Resolution (DPI)'}
              </span>
              <select
                aria-label={isFa ? 'رزولوشن چاپ پرینتر مجازی' : 'Virtual Printer DPI'}
                value={cfg.dpi}
                onChange={(e) =>
                  void updateVirtualPrinterConfig({
                    dpi: Number(e.target.value),
                  })
                }
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white tabular-nums"
              >
                {VIRTUAL_DPI_CHOICES.map((d) => (
                  <option key={d} value={d}>
                    {d} DPI
                  </option>
                ))}
              </select>
            </label>
          </div>

          {cfg.paperSize === 'Custom' && (
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-slate-600 dark:text-slate-400">
                  {isFa ? 'عرض سفارشی (mm)' : 'Custom Width (mm)'}
                </span>
                <input
                  type="number"
                  min={50}
                  max={2000}
                  value={cfg.paperWidthMm}
                  onChange={(e) =>
                    void updateVirtualPrinterConfig({
                      paperWidthMm: Math.max(50, Math.min(2000, Number(e.target.value) || 210)),
                    })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white tabular-nums"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-slate-600 dark:text-slate-400">
                  {isFa ? 'ارتفاع سفارشی (mm)' : 'Custom Height (mm)'}
                </span>
                <input
                  type="number"
                  min={50}
                  max={2000}
                  value={cfg.paperHeightMm}
                  onChange={(e) =>
                    void updateVirtualPrinterConfig({
                      paperHeightMm: Math.max(50, Math.min(2000, Number(e.target.value) || 297)),
                    })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white tabular-nums"
                />
              </label>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[11px]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.autoImportToStudio}
                onChange={(e) =>
                  void updateVirtualPrinterConfig({
                    autoImportToStudio: e.target.checked,
                  })
                }
                className="accent-indigo-600"
              />
              <span>
                {isFa ? 'افزودن خودکار به فضای کار' : 'Auto-import into studio'}
              </span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.switchToStudioOnReceive}
                onChange={(e) =>
                  void updateVirtualPrinterConfig({
                    switchToStudioOnReceive: e.target.checked,
                  })
                }
                className="accent-indigo-600"
              />
              <span>
                {isFa ? 'نمایش استودیو هنگام دریافت' : 'Switch to studio on capture'}
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-indigo-200/80 pt-2 text-[10px] text-slate-500 dark:border-indigo-500/20 dark:text-slate-400 tabular-nums">
            <span className="flex items-center gap-1">
              <Printer className="h-3 w-3 text-indigo-500" />
              {cfg.paperSize} ({cfg.paperWidthMm}×{cfg.paperHeightMm} mm ·{' '}
              {cfg.orientation === 'landscape'
                ? isFa
                  ? 'افقی'
                  : 'Landscape'
                : isFa
                  ? 'عمودی'
                  : 'Portrait'}{' '}
              · {cfg.dpi} DPI)
            </span>
            <span>
              {isFa
                ? `فایل‌های دریافت‌شده: ${virtualPrinterStatus?.recentJobs.length ?? 0}`
                : `Captured jobs: ${virtualPrinterStatus?.recentJobs.length ?? 0}`}
            </span>
          </div>

          {virtualPrinterStatus?.lastError && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-1 text-[10px] text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/30 dark:text-rose-300">
              {virtualPrinterStatus.lastError}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
