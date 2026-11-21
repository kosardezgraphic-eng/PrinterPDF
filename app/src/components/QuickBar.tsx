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
  GitMerge,
  FileText,
  RectangleVertical,
  BookOpen,
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
    updatePrinterProfile,
    updateLayout,
    openPrinterPreferences,
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

  const lang = settings.language;
  const isFa = lang === 'fa';
  const tr = t(lang);

  const currentPrinter = printers.find((p) => p.name === selectedPrinterName);
  const sheetDims = getSheetDimensionsMm(layout);

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

  const paperOptions = currentPrinter?.capabilities.paperOptions?.length
    ? currentPrinter.capabilities.paperOptions
    : (currentPrinter?.capabilities.supportedPapers ?? (Object.keys(STANDARD_PAPER_SIZES) as PaperSizeId[])).map(
        (id) => {
          const dims = id !== 'Custom' ? STANDARD_PAPER_SIZES[id] : { widthMm: 210, heightMm: 297 };
          return {
            id,
            name: id,
            widthMm: dims.widthMm,
            heightMm: dims.heightMm,
          };
        }
      );

  const selectedPaperValue = (() => {
    if (!currentPrinter) {
      const matchLayout = paperOptions.find((o) => o.id === layout.paperSize);
      return matchLayout?.name ?? paperOptions[0]?.name ?? layout.paperSize;
    }
    const matchByName = paperOptions.find(
      (o) =>
        currentPrinter.activeProfile.paperName &&
        o.name.toLowerCase() === currentPrinter.activeProfile.paperName.toLowerCase()
    );
    if (matchByName) return matchByName.name;
    const matchById = paperOptions.find((o) => o.id === currentPrinter.activeProfile.paperSize);
    return matchById?.name ?? paperOptions[0]?.name ?? layout.paperSize;
  })();

  const handleQuickPaperChange = (paperNameOrId: string) => {
    const matched = paperOptions.find(
      (o) => o.name === paperNameOrId || o.id === paperNameOrId
    );
    if (!matched) return;
    if (currentPrinter) {
      void updatePrinterProfile(currentPrinter.name, {
        paperSize: matched.id,
        paperName: matched.name,
        paperWidthMm: Math.min(matched.widthMm, matched.heightMm),
        paperHeightMm: Math.max(matched.widthMm, matched.heightMm),
      });
    } else {
      updateLayout({
        paperSize: matched.id,
        customWidthMm: Math.min(matched.widthMm, matched.heightMm),
        customHeightMm: Math.max(matched.widthMm, matched.heightMm),
      });
    }
  };

  const handleTrayChange = (tray: string) => {
    if (!currentPrinter) return;
    void updatePrinterProfile(currentPrinter.name, { tray });
  };

  const handleOrientationChange = (nextOrientation: PageOrientation) => {
    if (currentPrinter) {
      void updatePrinterProfile(currentPrinter.name, { orientation: nextOrientation });
    } else {
      updateLayout({ orientation: nextOrientation });
    }
  };

  const handleDuplexChange = (nextDuplex: DuplexMode) => {
    if (currentPrinter) {
      void updatePrinterProfile(currentPrinter.name, { duplexMode: nextDuplex });
    } else {
      updateLayout({ duplexMode: nextDuplex });
    }
  };

  const trays = currentPrinter?.capabilities.supportedTrays?.length
    ? currentPrinter.capabilities.supportedTrays
    : ['Auto Select'];
  const mediaTypes = currentPrinter?.capabilities.supportedMediaTypes?.length
    ? currentPrinter.capabilities.supportedMediaTypes
    : ['Plain Paper'];
  const dpis = currentPrinter?.capabilities.supportedDpi?.length
    ? currentPrinter.capabilities.supportedDpi
    : [300, 600];

  const activeOrientation = currentPrinter?.activeProfile.orientation ?? layout.orientation;
  const activeDuplex = currentPrinter?.activeProfile.duplexMode ?? layout.duplexMode;

  const chipSelectWrapClass =
    'flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 text-[11px] font-medium text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-200 shrink-0';
  const iconBtnClass =
    'flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white disabled:opacity-35 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer shrink-0 transition-colors';

  return (
    <header
      dir="ltr"
      className="relative z-40 flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-2.5 py-1 text-slate-800 select-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      {/* Left Cluster: SavePDF -> Quick Print -> PrintNow -> Printer & Hardware -> Tray -> Paper -> Orientation -> Duplex -> Counter ($) -> Merge */}
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        {/* SavePDF */}
        <button
          type="button"
          disabled={isExportingPdf}
          onClick={() => void exportMergedOrImposedPdf(false)}
          title={
            isFa
              ? 'ادغام و ذخیره مستقیم خروجی PDF (Ctrl+S)'
              : 'Save imposed PDF directly (Ctrl+S)'
          }
          className="flex h-7 items-center gap-1 rounded-md bg-emerald-500 px-2.5 text-[11px] font-bold text-white shadow-xs hover:bg-emerald-600 active:scale-[0.99] disabled:opacity-50 transition whitespace-nowrap shrink-0 cursor-pointer"
        >
          <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{isFa ? 'SavePDF' : 'SavePDF'}</span>
        </button>

        {/* Quick Print */}
        <button
          type="button"
          disabled={isExportingPdf || !currentPrinter || pages.length === 0}
          onClick={() => void silentPrintNow()}
          aria-label={isFa ? 'ارسال مستقیم چاپ فوری' : 'Direct Quick Print'}
          title={
            isFa
              ? 'ارسال مستقیم به اسپولر ویندوز با تنظیمات سخت‌افزاری فعلی'
              : 'Send directly to Windows Spooler with active hardware settings'
          }
          className="flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-200 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed transition-colors"
        >
          <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden="true" />
          <span>{isFa ? 'Quick Print' : 'Quick Print'}</span>
        </button>

        {/* PrintNow (Full Print Modal) */}
        <button
          type="button"
          onClick={() => setModalState('print', true)}
          title={
            isFa
              ? 'پنجره چاپ با پیش‌نمایش و تنظیمات کامل پرینتر (Ctrl+P)'
              : 'Open Full Print Dialog (Ctrl+P)'
          }
          className="flex h-7 items-center gap-1 rounded-md border border-sky-500/30 bg-sky-50 px-2.5 text-[11px] font-semibold text-sky-800 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-600/20 dark:text-sky-200 dark:hover:bg-sky-600/30 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
        >
          <Printer className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
          <span>{tr.quickBar.printNow}</span>
        </button>

        {/* Printer selector + Hardware gear popover */}
        <div
          ref={hardwarePopoverRef}
          className="relative flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 dark:border-slate-700 dark:bg-slate-800/90 shrink-0"
        >
          <span
            className={`h-2 w-2 rounded-full shrink-0 ${statusColor(currentPrinter?.status)}`}
            title={
              currentPrinter
                ? `${isFa ? 'وضعیت پرینتر:' : 'Printer status:'} ${currentPrinter.status}`
                : isFa
                  ? 'پرینتر ویندوز متصل نیست'
                  : 'No Windows printer connected'
            }
          />
          <select
            aria-label="انتخاب پرینتر"
            value={selectedPrinterName}
            onChange={(e) => selectPrinter(e.target.value)}
            className="bg-transparent text-[11px] font-semibold text-slate-800 dark:text-slate-100 focus:outline-none max-w-[140px] xl:max-w-[185px] truncate cursor-pointer"
          >
            {printers.length === 0 && (
              <option value="" className="bg-white text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                {tr.quickBar.noPrinter}
              </option>
            )}
            {printers.map((p) => (
              <option key={p.name} value={p.name} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
                {p.name}
              </option>
            ))}
          </select>

          <PrinterRetryButton compact />

          {currentPrinter?.status === 'Ready' ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden="true" />
          )}

          <button
            type="button"
            onClick={autoSelectBestPrinter}
            title={
              isFa
                ? 'انتخاب هوشمند بهترین پرینتر آماده'
                : 'Auto-select optimal Ready printer'
            }
            className="hidden 2xl:flex items-center gap-0.5 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 hover:bg-sky-200 dark:bg-sky-500/20 dark:text-sky-300 dark:hover:bg-sky-500/30 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Cpu className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{isFa ? 'خودکار' : 'Auto'}</span>
          </button>

          {/* Hardware Settings Popover Toggle */}
          <button
            type="button"
            aria-expanded={showHardwarePopover}
            aria-label={isFa ? 'تنظیمات سخت‌افزاری پرینتر' : 'Printer Hardware Settings'}
            title={
              isFa
                ? 'تنظیمات سخت‌افزاری و درایور پرینتر برای چاپ فوری'
                : 'Printer Hardware & Driver Settings for Quick Print'
            }
            onClick={() => setShowHardwarePopover((v) => !v)}
            className={`flex h-5 items-center justify-center rounded px-1 transition cursor-pointer ${
              showHardwarePopover
                ? 'bg-sky-500/20 text-sky-700 dark:text-sky-200'
                : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </button>

          {/* Hardware & Driver Settings Popover */}
          {showHardwarePopover && (
            <div
              dir={isFa ? 'rtl' : 'ltr'}
              className="absolute top-full left-0 mt-1.5 w-[360px] sm:w-[430px] rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-800 shadow-2xl z-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2 dark:border-slate-800">
                <div className="flex items-center gap-2 min-w-0">
                  <SlidersHorizontal className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0" />
                  <span className="font-bold truncate">
                    {isFa
                      ? 'تنظیمات سخت‌افزاری پرینتر (چاپ فوری)'
                      : 'Printer Hardware Settings (Quick Print)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHardwarePopover(false)}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {!currentPrinter ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                  {isFa
                    ? 'ابتدا یک پرینتر ویندوز را انتخاب کنید.'
                    : 'Select an installed Windows printer first.'}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] dark:border-slate-800 dark:bg-slate-950/70">
                    <div className="font-bold text-sky-700 dark:text-sky-300 truncate">{currentPrinter.name}</div>
                    <div className="text-slate-500 dark:text-slate-400 truncate">
                      {currentPrinter.driverName} • {currentPrinter.portName}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'اندازه کاغذ درایور:' : 'Paper Size:'}
                      </label>
                      <select
                        dir="ltr"
                        value={selectedPaperValue}
                        onChange={(e) => handleQuickPaperChange(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {paperOptions.map((opt) => (
                          <option key={opt.name} value={opt.name}>
                            {opt.name} ({Math.round(opt.widthMm)}×{Math.round(opt.heightMm)} mm)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'سینی کاغذ (Tray):' : 'Paper Tray:'}
                      </label>
                      <select
                        value={currentPrinter.activeProfile.tray}
                        onChange={(e) => handleTrayChange(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {trays.map((tName) => (
                          <option key={tName} value={tName}>
                            {tName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'جنس کاغذ (Media Type):' : 'Media Type:'}
                      </label>
                      <select
                        value={currentPrinter.activeProfile.mediaType}
                        onChange={(e) =>
                          void updatePrinterProfile(currentPrinter.name, {
                            mediaType: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {mediaTypes.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'جهت چاپ:' : 'Orientation:'}
                      </label>
                      <select
                        value={currentPrinter.activeProfile.orientation}
                        onChange={(e) =>
                          void updatePrinterProfile(currentPrinter.name, {
                            orientation: e.target.value as PageOrientation,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="portrait">{isFa ? 'عمودی (Portrait)' : 'Portrait'}</option>
                        <option value="landscape">{isFa ? 'افقی (Landscape)' : 'Landscape'}</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'چاپ دورو (Duplex):' : 'Duplex Mode:'}
                      </label>
                      <select
                        aria-label={isFa ? 'چاپ دورو سخت‌افزاری' : 'Hardware Duplex Mode'}
                        value={currentPrinter.activeProfile.duplexMode}
                        onChange={(e) =>
                          void updatePrinterProfile(currentPrinter.name, {
                            duplexMode: e.target.value as DuplexMode,
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="none">{isFa ? 'تک‌رو (Simplex)' : 'Simplex'}</option>
                        <option value="long-edge">{isFa ? 'دورو لبه بلند' : 'Long-Edge'}</option>
                        <option value="short-edge">{isFa ? 'دورو لبه کوتاه' : 'Short-Edge'}</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'رزولوشن و رنگ:' : 'DPI & Color:'}
                      </label>
                      <div className="flex gap-1">
                        <select
                          value={currentPrinter.activeProfile.dpi}
                          onChange={(e) =>
                            void updatePrinterProfile(currentPrinter.name, {
                              dpi: Number(e.target.value),
                            })
                          }
                          className="w-1/2 rounded-lg border border-slate-300 bg-white px-1.5 py-1.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          {dpis.map((d) => (
                            <option key={d} value={d}>
                              {d} DPI
                            </option>
                          ))}
                        </select>
                        <select
                          disabled={!currentPrinter.capabilities.supportsColor}
                          value={
                            currentPrinter.capabilities.supportsColor
                              ? currentPrinter.activeProfile.colorMode
                              : 'monochrome'
                          }
                          onChange={(e) =>
                            void updatePrinterProfile(currentPrinter.name, {
                              colorMode: e.target.value as 'color' | 'grayscale' | 'monochrome',
                            })
                          }
                          className="w-1/2 rounded-lg border border-slate-300 bg-white px-1.5 py-1.5 text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="color">{isFa ? 'رنگی' : 'Color'}</option>
                          <option value="monochrome">{isFa ? 'سیاه‌وسفید' : 'Mono'}</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'کیفیت چاپ:' : 'Quality:'}
                      </label>
                      <select
                        value={currentPrinter.activeProfile.quality}
                        onChange={(e) =>
                          void updatePrinterProfile(currentPrinter.name, {
                            quality: e.target.value as 'draft' | 'normal' | 'high',
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="draft">{isFa ? 'سریع (Draft)' : 'Draft'}</option>
                        <option value="normal">{isFa ? 'معمولی (Normal)' : 'Normal'}</option>
                        <option value="high">{isFa ? 'عالی (High)' : 'High'}</option>
                      </select>
                    </div>

                    {currentPrinter.capabilities.supportedStapleModes?.length ? (
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-600 dark:text-slate-400">
                          {isFa ? 'منگنه (Staple):' : 'Stapling:'}
                        </label>
                        <select
                          value={currentPrinter.activeProfile.staple ?? ''}
                          onChange={(e) =>
                            void updatePrinterProfile(currentPrinter.name, {
                              staple: e.target.value || undefined,
                            })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">{isFa ? 'بدون منگنه' : 'None'}</option>
                          {currentPrinter.capabilities.supportedStapleModes.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    {currentPrinter.capabilities.supportedHolePunchModes?.length ? (
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-600 dark:text-slate-400">
                          {isFa ? 'پانچ (Hole Punch):' : 'Hole Punch:'}
                        </label>
                        <select
                          value={currentPrinter.activeProfile.holePunch ?? ''}
                          onChange={(e) =>
                            void updatePrinterProfile(currentPrinter.name, {
                              holePunch: e.target.value || undefined,
                            })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">{isFa ? 'بدون پانچ' : 'None'}</option>
                          {currentPrinter.capabilities.supportedHolePunchModes.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    {currentPrinter.capabilities.supportedOutputBins?.length ? (
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-600 dark:text-slate-400">
                          {isFa ? 'سینی خروجی (Output Bin):' : 'Output Bin:'}
                        </label>
                        <select
                          value={currentPrinter.activeProfile.outputBin ?? ''}
                          onChange={(e) =>
                            void updatePrinterProfile(currentPrinter.name, {
                              outputBin: e.target.value || undefined,
                            })
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">{isFa ? 'پیش‌فرض' : 'Default'}</option>
                          {currentPrinter.capabilities.supportedOutputBins.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={currentPrinter.activeProfile.collate ?? true}
                        onChange={(e) =>
                          void updatePrinterProfile(currentPrinter.name, {
                            collate: e.target.checked,
                          })
                        }
                        className="accent-sky-600"
                      />
                      <span>{isFa ? 'مرتب‌سازی (Collate)' : 'Collate'}</span>
                    </label>
                    {currentPrinter.capabilities.supportsBorderless && (
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(currentPrinter.activeProfile.borderless)}
                          onChange={(e) =>
                            void updatePrinterProfile(currentPrinter.name, {
                              borderless: e.target.checked,
                            })
                          }
                          className="accent-sky-600"
                        />
                        <span>{isFa ? 'چاپ بدون حاشیه (Borderless)' : 'Borderless'}</span>
                      </label>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => void openPrinterPreferences(currentPrinter.name)}
                      className="rounded-lg border border-emerald-500/40 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-600/15 dark:text-emerald-300 dark:hover:bg-emerald-600/25 whitespace-nowrap cursor-pointer"
                    >
                      {isFa ? 'تنظیمات کامل درایور ویندوز' : 'Windows Driver UI'}
                    </button>
                    <button
                      type="button"
                      disabled={isExportingPdf || pages.length === 0}
                      onClick={() => {
                        setShowHardwarePopover(false);
                        void silentPrintNow();
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-40 whitespace-nowrap cursor-pointer"
                    >
                      <Zap className="h-3.5 w-3.5" />
                      <span>{isFa ? 'ارسال مستقیم به پرینتر' : 'Print Directly Now'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tray dropdown */}
        <div className={chipSelectWrapClass}>
          <Layers className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden="true" />
          <select
            aria-label={isFa ? 'سینی کاغذ چاپ فوری' : 'Quick Print Paper Tray'}
            title={
              isFa
                ? 'انتخاب سینی کاغذ از درایور پرینتر'
                : 'Select Paper Tray from printer driver'
            }
            disabled={!currentPrinter}
            value={currentPrinter?.activeProfile.tray ?? trays[0]}
            onChange={(e) => handleTrayChange(e.target.value)}
            className="bg-transparent text-[11px] font-medium text-slate-800 dark:text-slate-100 focus:outline-none max-w-[110px] truncate cursor-pointer disabled:opacity-50"
          >
            {trays.map((trayName) => (
              <option key={trayName} value={trayName} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
                {trayName}
              </option>
            ))}
          </select>
        </div>

        {/* Paper Size dropdown */}
        <div className={chipSelectWrapClass}>
          <FileText className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
          <select
            dir="ltr"
            aria-label={isFa ? 'سایز کاغذ پرینتر' : 'Printer Paper Size'}
            title={
              isFa
                ? 'اندازه کاغذ پرینتر (شیت‌ها بر همین اساس چیده می‌شوند)'
                : 'Printer Paper Size (sheets size to this paper)'
            }
            value={selectedPaperValue}
            onChange={(e) => handleQuickPaperChange(e.target.value)}
            className="bg-transparent text-[11px] font-medium text-slate-800 dark:text-sky-300 focus:outline-none max-w-[135px] truncate cursor-pointer"
          >
            {paperOptions.map((opt) => (
              <option
                key={`${opt.name}-${opt.widthMm}x${opt.heightMm}`}
                value={opt.name}
                className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100"
              >
                {opt.name} ({Math.round(opt.widthMm)}×{Math.round(opt.heightMm)} mm)
              </option>
            ))}
          </select>
          <span className="hidden 2xl:inline font-mono tabular-nums text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
            {Math.round(sheetDims.widthMm)}×{Math.round(sheetDims.heightMm)}
          </span>
        </div>

        {/* Orientation dropdown */}
        <div className={chipSelectWrapClass}>
          <RectangleVertical className="h-3.5 w-3.5 text-indigo-500 shrink-0" aria-hidden="true" />
          <select
            aria-label={isFa ? 'جهت صفحه چاپ فوری' : 'Quick Print Orientation'}
            title={isFa ? 'تغییر جهت برگه (عمودی / افقی)' : 'Page Orientation'}
            value={activeOrientation}
            onChange={(e) => handleOrientationChange(e.target.value as PageOrientation)}
            className="bg-transparent text-[11px] font-medium text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer"
          >
            <option value="portrait" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
              {isFa ? 'عمودی (Portrait)' : 'Portrait'}
            </option>
            <option value="landscape" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
              {isFa ? 'افقی (Landscape)' : 'Landscape'}
            </option>
          </select>
        </div>

        {/* Duplex dropdown */}
        <div className={chipSelectWrapClass}>
          <BookOpen className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400 shrink-0" aria-hidden="true" />
          <select
            aria-label={isFa ? 'حالت دورو چاپ فوری' : 'Quick Print Duplex Mode'}
            title={isFa ? 'تک‌رو یا پشت و رو (Duplex)' : 'Simplex or Duplex printing'}
            value={activeDuplex}
            onChange={(e) => handleDuplexChange(e.target.value as DuplexMode)}
            className="bg-transparent text-[11px] font-medium text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer"
          >
            <option value="none" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
              {isFa ? '1 Side (تک‌رو)' : '1 Side'}
            </option>
            <option value="long-edge" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
              {isFa ? '2 Side (لبه بلند)' : '2 Side (Long)'}
            </option>
            <option value="short-edge" className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
              {isFa ? '2 Side (لبه کوتاه)' : '2 Side (Short)'}
            </option>
          </select>
        </div>

        {/* Counter trigger ($) */}
        <button
          data-counter-trigger
          type="button"
          onClick={() => setModalState('counter', true)}
          title={tr.quickBar.counterDashboard}
          aria-label={tr.quickBar.counterDashboard}
          className={iconBtnClass}
        >
          <CircleDollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        </button>

        {/* Merge trigger */}
        <button
          data-quick-merge
          type="button"
          disabled={isExportingPdf}
          onClick={() => void exportMergedOrImposedPdf(false)}
          title={tr.quickBar.merge}
          aria-label={tr.quickBar.merge}
          className="flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-medium text-slate-700 hover:border-slate-300 hover:bg-white disabled:opacity-45 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
        >
          <GitMerge className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
          <span className="hidden xl:inline">{tr.quickBar.merge}</span>
        </button>
      </div>

      {/* Right Cluster: Undo, Redo, Save .psp, Open .psp, FA/EN, Theme, Tour (i), Settings, Brand */}
      <div className="flex items-center gap-1 shrink-0">
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
          disabled={!canUndo}
          onClick={undo}
          title={undoLabel ? `${tr.quickBar.undo}: ${undoLabel}` : tr.quickBar.undo}
          aria-label={tr.quickBar.undo}
          className={iconBtnClass}
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={redo}
          title={redoLabel ? `${tr.quickBar.redo}: ${redoLabel}` : tr.quickBar.redo}
          aria-label={tr.quickBar.redo}
          className={iconBtnClass}
        >
          <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={savePspProject}
          title={tr.quickBar.saveProject}
          aria-label={tr.quickBar.saveProject}
          className={iconBtnClass}
        >
          <Save className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => pspInputRef.current?.click()}
          title={isFa ? 'باز کردن فایل پروژه .psp' : 'Open .psp Project'}
          aria-label={isFa ? 'باز کردن فایل پروژه .psp' : 'Open .psp Project'}
          className={iconBtnClass}
        >
          <FolderOpen className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() =>
            updateSettings({ language: settings.language === 'fa' ? 'en' : 'fa' })
          }
          title={isFa ? 'تغییر زنده زبان فارسی (RTL) / انگلیسی (LTR)' : 'Switch language (FA / EN)'}
          className="flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-bold text-slate-800 hover:bg-white dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
        >
          <Languages className="h-3.5 w-3.5 text-indigo-500 shrink-0" aria-hidden="true" />
          <span>{settings.language === 'fa' ? 'FA' : 'EN'}</span>
        </button>

        <button
          type="button"
          onClick={() =>
            updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
          }
          title={isFa ? 'تغییر تم روشن / تیره' : 'Toggle Light / Dark theme'}
          aria-label={isFa ? 'تغییر تم روشن / تیره' : 'Toggle Light / Dark theme'}
          className={iconBtnClass}
        >
          {settings.theme === 'dark' ? (
            <Sun className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
          ) : (
            <Moon className="h-3.5 w-3.5 text-slate-700" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setModalState('tour', true)}
          title={tr.quickBar.tour}
          aria-label={tr.quickBar.tour}
          className={iconBtnClass}
        >
          <Info className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => setModalState('settings', true)}
          title={tr.quickBar.settings}
          aria-label={tr.quickBar.settings}
          className={iconBtnClass}
        >
          <Settings className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" aria-hidden="true" />
        </button>

        <div className="hidden xl:flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800/70 shrink-0">
          <Printer className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          <span className="text-[11px] font-black tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
            PrintStudioPro
          </span>
        </div>
      </div>
    </header>
  );
};
