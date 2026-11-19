import React, { useEffect, useRef, useState } from 'react';
import {
  Printer,
  FileDown,
  Undo2,
  Redo2,
  Settings,
  Calculator,
  Sun,
  Moon,
  Languages,
  Save,
  FolderOpen,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
  Cpu,
  SlidersHorizontal,
  Zap,
  Layers,
  X,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { PrinterRetryButton } from './PrinterStatus';
import { t } from '../i18n/translations';
import { computeCounterSummary } from '../engine/counterEngine';
import { getSheetDimensionsMm } from '../engine/layoutEngine';
import { formatLocalizedNumber } from '../i18n/shamsi';
import {
  STANDARD_PAPER_SIZES,
  type DuplexMode,
  type PageOrientation,
  type PaperSizeId,
} from '@shared/models';

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
    updatePrinterProfile,
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

  const summary = computeCounterSummary(documents, pages, layout, settings);
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
    if (!status) return 'bg-slate-500';
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
    if (!currentPrinter) return layout.paperSize;
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
    if (!currentPrinter || !matched) return;
    void updatePrinterProfile(currentPrinter.name, {
      paperSize: matched.id,
      paperName: matched.name,
      paperWidthMm: Math.min(matched.widthMm, matched.heightMm),
      paperHeightMm: Math.max(matched.widthMm, matched.heightMm),
    });
  };

  const handleTrayChange = (tray: string) => {
    if (!currentPrinter) return;
    void updatePrinterProfile(currentPrinter.name, { tray });
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

  return (
    <header className="relative z-40 flex h-11 shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-2.5 select-none">
      {/* Start: Brand + Quick Print Hardware Cluster + Save PDF + Counter + Undo/Redo */}
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="hidden 2xl:flex items-center gap-2 rounded-xl bg-gradient-to-l from-sky-600/20 to-indigo-600/20 border border-sky-500/30 px-2.5 py-1 shrink-0">
          <Printer className="h-4 w-4 text-sky-400" />
          <div className="leading-tight">
            <div className="flex items-center gap-1">
              <span className="text-xs font-black tracking-tight text-white whitespace-nowrap">
                PrintStudio Pro
              </span>
              <span className="rounded bg-sky-500/20 px-1 py-0.5 text-[9px] font-bold text-sky-300">
                v1.0
              </span>
            </div>
          </div>
        </div>

        {/* Quick Print + Direct Spooler Print + Tray + Paper Size + Hardware Settings Popover */}
        <div
          ref={hardwarePopoverRef}
          className="relative flex items-center gap-1 rounded-xl border border-slate-700/90 bg-slate-950/90 p-0.5 shrink-0"
        >
          {/* Open Print Modal (G1/G2) */}
          <button
            type="button"
            onClick={() => setModalState('print', true)}
            title={
              isFa
                ? 'پنجره چاپ با پیش‌نمایش و تنظیمات کامل پرینتر (Ctrl+P)'
                : 'Open Full Print Dialog (Ctrl+P)'
            }
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-sky-500 active:scale-[0.99] transition whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="h-3.5 w-3.5 shrink-0" />
            <span>{tr.quickBar.printNow}</span>
          </button>

          {/* 1-Click Direct Silent Print using active tray/paper/hardware profile */}
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
            className="flex items-center gap-1 rounded-lg bg-indigo-600/85 px-2 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
          >
            <Zap className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">{isFa ? 'ارسال آنی' : 'Quick'}</span>
          </button>

          {/* Paper Tray Selector right beside Quick Print (populated from printer driver) */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-1.5 py-1">
            <Layers className="h-3 w-3 text-amber-400 shrink-0" />
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
              className="bg-transparent text-[11px] font-semibold text-slate-100 focus:outline-none max-w-[115px] truncate cursor-pointer disabled:opacity-50"
            >
              {trays.map((trayName) => (
                <option key={trayName} value={trayName} className="bg-slate-900 text-slate-100">
                  {trayName}
                </option>
              ))}
            </select>
          </div>

          {/* Driver Paper Size + exact mm badge beside Quick Print */}
          <div className="hidden sm:flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-1.5 py-1">
            <select
              dir="ltr"
              aria-label={isFa ? 'سایز کاغذ پرینتر' : 'Printer Paper Size'}
              title={
                isFa
                  ? 'اندازه کاغذ پرینتر (شیت‌ها بر همین اساس چیده می‌شوند)'
                  : 'Printer Paper Size (sheets size to this paper)'
              }
              disabled={!currentPrinter}
              value={selectedPaperValue}
              onChange={(e) => handleQuickPaperChange(e.target.value)}
              className="bg-transparent text-[11px] font-semibold text-sky-300 focus:outline-none max-w-[140px] truncate cursor-pointer disabled:opacity-50"
            >
              {paperOptions.map((opt) => (
                <option
                  key={`${opt.name}-${opt.widthMm}x${opt.heightMm}`}
                  value={opt.name}
                  className="bg-slate-900 text-slate-100"
                >
                  {opt.name} ({Math.round(opt.widthMm)}×{Math.round(opt.heightMm)} mm)
                </option>
              ))}
            </select>
            <span className="hidden xl:inline font-mono tabular-nums text-[10px] text-slate-400 whitespace-nowrap">
              {Math.round(sheetDims.widthMm)}×{Math.round(sheetDims.heightMm)}mm
            </span>
          </div>

          {/* Hardware Driver Settings Popover Toggle */}
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
            className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold whitespace-nowrap shrink-0 transition cursor-pointer ${
              showHardwarePopover
                ? 'bg-sky-500/25 text-sky-200 border border-sky-500/50'
                : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            <span className="hidden md:inline">{isFa ? 'سخت‌افزار' : 'Hardware'}</span>
          </button>

          {/* Hardware & Driver Settings Popover */}
          {showHardwarePopover && (
            <div className="absolute top-full start-0 mt-2 w-[360px] sm:w-[430px] rounded-2xl border border-slate-700 bg-slate-900 p-4 text-xs text-slate-100 shadow-2xl z-50">
              <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <SlidersHorizontal className="h-4 w-4 text-sky-400 shrink-0" />
                  <span className="font-bold truncate">
                    {isFa
                      ? 'تنظیمات سخت‌افزاری پرینتر (چاپ فوری)'
                      : 'Printer Hardware Settings (Quick Print)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHardwarePopover(false)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-800 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {!currentPrinter ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 text-amber-200">
                  {isFa
                    ? 'ابتدا یک پرینتر ویندوز را از لیست مرکزی انتخاب کنید.'
                    : 'Select an installed Windows printer first.'}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-[11px]">
                    <div className="font-bold text-sky-300 truncate">{currentPrinter.name}</div>
                    <div className="text-slate-400 truncate">
                      {currentPrinter.driverName} • {currentPrinter.portName}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
                        {isFa ? 'اندازه کاغذ درایور:' : 'Paper Size:'}
                      </label>
                      <select
                        dir="ltr"
                        value={selectedPaperValue}
                        onChange={(e) => handleQuickPaperChange(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-white"
                      >
                        {paperOptions.map((opt) => (
                          <option key={opt.name} value={opt.name}>
                            {opt.name} ({Math.round(opt.widthMm)}×{Math.round(opt.heightMm)} mm)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
                        {isFa ? 'سینی کاغذ (Tray):' : 'Paper Tray:'}
                      </label>
                      <select
                        value={currentPrinter.activeProfile.tray}
                        onChange={(e) => handleTrayChange(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-white"
                      >
                        {trays.map((tName) => (
                          <option key={tName} value={tName}>
                            {tName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
                        {isFa ? 'جنس کاغذ (Media Type):' : 'Media Type:'}
                      </label>
                      <select
                        value={currentPrinter.activeProfile.mediaType}
                        onChange={(e) =>
                          void updatePrinterProfile(currentPrinter.name, {
                            mediaType: e.target.value,
                          })
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-white"
                      >
                        {mediaTypes.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
                        {isFa ? 'جهت چاپ:' : 'Orientation:'}
                      </label>
                      <select
                        value={currentPrinter.activeProfile.orientation}
                        onChange={(e) =>
                          void updatePrinterProfile(currentPrinter.name, {
                            orientation: e.target.value as PageOrientation,
                          })
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-white"
                      >
                        <option value="portrait">{isFa ? 'عمودی (Portrait)' : 'Portrait'}</option>
                        <option value="landscape">{isFa ? 'افقی (Landscape)' : 'Landscape'}</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
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
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-white"
                      >
                        <option value="none">{isFa ? 'تک‌رو (Simplex)' : 'Simplex'}</option>
                        <option value="long-edge">{isFa ? 'دورو لبه بلند' : 'Long-Edge'}</option>
                        <option value="short-edge">{isFa ? 'دورو لبه کوتاه' : 'Short-Edge'}</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
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
                          className="w-1/2 rounded-lg border border-slate-700 bg-slate-800 px-1.5 py-1.5 text-white"
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
                          className="w-1/2 rounded-lg border border-slate-700 bg-slate-800 px-1.5 py-1.5 text-white disabled:opacity-50"
                        >
                          <option value="color">{isFa ? 'رنگی' : 'Color'}</option>
                          <option value="monochrome">{isFa ? 'سیاه‌وسفید' : 'Mono'}</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
                        {isFa ? 'کیفیت چاپ:' : 'Quality:'}
                      </label>
                      <select
                        value={currentPrinter.activeProfile.quality}
                        onChange={(e) =>
                          void updatePrinterProfile(currentPrinter.name, {
                            quality: e.target.value as 'draft' | 'normal' | 'high',
                          })
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-white"
                      >
                        <option value="draft">{isFa ? 'سریع (Draft)' : 'Draft'}</option>
                        <option value="normal">{isFa ? 'معمولی (Normal)' : 'Normal'}</option>
                        <option value="high">{isFa ? 'عالی (High)' : 'High'}</option>
                      </select>
                    </div>

                    {currentPrinter.capabilities.supportedStapleModes?.length ? (
                      <div>
                        <label className="mb-1 block text-[11px] text-slate-400">
                          {isFa ? 'منگنه (Staple):' : 'Stapling:'}
                        </label>
                        <select
                          value={currentPrinter.activeProfile.staple ?? ''}
                          onChange={(e) =>
                            void updatePrinterProfile(currentPrinter.name, {
                              staple: e.target.value || undefined,
                            })
                          }
                          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-white"
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
                        <label className="mb-1 block text-[11px] text-slate-400">
                          {isFa ? 'پانچ (Hole Punch):' : 'Hole Punch:'}
                        </label>
                        <select
                          value={currentPrinter.activeProfile.holePunch ?? ''}
                          onChange={(e) =>
                            void updatePrinterProfile(currentPrinter.name, {
                              holePunch: e.target.value || undefined,
                            })
                          }
                          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-white"
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
                        <label className="mb-1 block text-[11px] text-slate-400">
                          {isFa ? 'سینی خروجی (Output Bin):' : 'Output Bin:'}
                        </label>
                        <select
                          value={currentPrinter.activeProfile.outputBin ?? ''}
                          onChange={(e) =>
                            void updatePrinterProfile(currentPrinter.name, {
                              outputBin: e.target.value || undefined,
                            })
                          }
                          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-white"
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
                        className="accent-sky-500"
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
                          className="accent-sky-500"
                        />
                        <span>{isFa ? 'چاپ بدون حاشیه (Borderless)' : 'Borderless'}</span>
                      </label>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
                    <button
                      type="button"
                      onClick={() => void openPrinterPreferences(currentPrinter.name)}
                      className="rounded-lg border border-emerald-500/40 bg-emerald-600/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-600/25 whitespace-nowrap cursor-pointer"
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

        {/* Save As PDF (C1/C2) */}
        <button
          type="button"
          disabled={isExportingPdf}
          onClick={() => void exportMergedOrImposedPdf(false)}
          title={
            isFa
              ? 'ادغام و ساخت فایل PDF نهایی مطابق چیدمان و افکت‌ها (Ctrl+S)'
              : 'Export imposed PDF (Ctrl+S)'
          }
          className="flex items-center gap-1.5 rounded-xl bg-emerald-600/90 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 transition whitespace-nowrap shrink-0 cursor-pointer"
        >
          <FileDown className="h-4 w-4 shrink-0" />
          <span className="hidden xl:inline">{tr.quickBar.saveAsPdf}</span>
        </button>

        {/* Counter & Cost Dashboard (B1/B2) */}
        <button
          data-counter-trigger
          type="button"
          onClick={() => setModalState('counter', true)}
          className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-sky-500/50 hover:bg-slate-800 transition whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Calculator className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="hidden xl:inline">{tr.quickBar.counterDashboard}</span>
          <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-amber-300">
            {formatLocalizedNumber(summary.totalPhysicalSheets, lang)}{' '}
            {lang === 'fa' ? 'برگ' : 'sh'}
          </span>
        </button>

        {/* Undo / Redo (A5) */}
        <div className="hidden sm:flex items-center gap-1 shrink-0">
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
      <div className="hidden lg:flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 px-2 py-1 min-w-0">
        <span
          className={`h-2.5 w-2.5 rounded-full shrink-0 ${statusColor(currentPrinter?.status)}`}
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
          className="bg-transparent text-xs font-medium text-slate-200 focus:outline-none max-w-[190px] xl:max-w-[240px] truncate cursor-pointer"
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
            isFa
              ? 'انتخاب هوشمند بهترین پرینتر آماده بر اساس سایز کاغذ و رنگی/سیاه‌وسفید بودن سند'
              : 'Smart auto-select optimal Ready printer by paper size & color'
          }
          className="flex items-center gap-1 rounded-lg bg-sky-500/15 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/25 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Cpu className="h-3 w-3 shrink-0" />
          <span>{isFa ? 'خودکار' : 'Auto'}</span>
        </button>
      </div>

      {/* End: Project .psp, Language, Theme, Tour, Settings */}
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
          onClick={savePspProject}
          title={tr.quickBar.saveProject}
          className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-800/70 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
        >
          <Save className="h-3.5 w-3.5 text-sky-400" />
          <span className="hidden 2xl:inline">.psp</span>
        </button>
        <button
          type="button"
          onClick={() => pspInputRef.current?.click()}
          title={isFa ? 'باز کردن فایل پروژه .psp' : 'Open .psp Project'}
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
          className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-800/70 px-2 py-1.5 text-xs font-bold text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Languages className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
          <span>{settings.language === 'fa' ? 'FA' : 'EN'}</span>
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
