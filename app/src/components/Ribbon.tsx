import React, { useRef } from 'react';
import {
  FilePlus2,
  FolderOpen,
  LayoutGrid,
  Sparkles,
  Type,
  Crop,
  FileStack,
  Layers,
  Printer,
  Eye,
  ChevronUp,
  ChevronDown,
  RotateCw,
  Copy,
  Scissors,
  Contrast,
  SunMedium,
  Droplets,
  Hash,
  Play,
  Pause,
  RefreshCw,
  Ruler,
  Search,
  Maximize2,
  BookOpen,
  FlipHorizontal2,
  Trash2,
  FileDown,
} from 'lucide-react';
import { MatrixSizeFields } from './MatrixSizeFields';
import { useAppStore, type RibbonTabId } from '../store/useAppStore';
import { t } from '../i18n/translations';
import {
  STANDARD_PAPER_SIZES,
  type DuplexMode,
  type PageNumberFormat,
  type PaperSizeId,
  type ScaleMode,
  type SheetOrderMode,
} from '@shared/models';

export const Ribbon: React.FC = () => {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const {
    activeRibbonTab,
    ribbonCollapsed,
    layout,
    printers,
    selectedPrinterName,
    effects,
    watermark,
    pageNumbering,
    settings,
    pages,
    batchQueue,
    isBatchRunning,
    viewMode,
    showRulers,
    loupeEnabled,
    transparentMode,
    zoomPercent,
    setActiveRibbonTab,
    setRibbonCollapsed,
    importFiles,
    loadSampleWorkspace,
    clearWorkspace,
    updateLayout,
    setNUpMatrix,
    updateMargins,
    updateEffects,
    toggleGlobalInvert,
    resetEffects,
    updateWatermark,
    updatePageNumbering,
    addTextOverlay,
    addNumberingOverlay,
    addImageOverlayFiles,
    exportMergedOrImposedPdf,
    insertBlankPageAfter,
    reversePageOrder,
    setModalState,
    openPrinterPreferences,
    addCurrentWorkspaceToBatch,
    runBatchQueue,
    pauseBatchQueue,
    retryFailedBatchJobs,
    setViewMode,
    setShowRulers,
    setLoupeEnabled,
    setTransparentMode,
    setZoomPercent,
  } = useAppStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const lang = settings.language;
  const tr = t(lang);
  const selectedPrinter = printers.find((printer) => printer.name === selectedPrinterName);
  const driverPaperOptions = selectedPrinter?.capabilities.supportedPapers?.length
    ? selectedPrinter.capabilities.supportedPapers
    : Object.keys(STANDARD_PAPER_SIZES);

  const tabs: Array<{ id: RibbonTabId; label: string; icon: React.ReactNode }> = [
    { id: 'file', label: tr.ribbonTabs.file, icon: <FolderOpen className="h-3.5 w-3.5" /> },
    { id: 'layout', label: tr.ribbonTabs.layout, icon: <LayoutGrid className="h-3.5 w-3.5" /> },
    { id: 'effects', label: tr.ribbonTabs.effects, icon: <Sparkles className="h-3.5 w-3.5" /> },
    { id: 'insert', label: tr.ribbonTabs.insert, icon: <Type className="h-3.5 w-3.5" /> },
    { id: 'crop', label: tr.ribbonTabs.crop, icon: <Crop className="h-3.5 w-3.5" /> },
    { id: 'pdf', label: tr.ribbonTabs.pdf, icon: <FileStack className="h-3.5 w-3.5" /> },
    { id: 'batch', label: tr.ribbonTabs.batch, icon: <Layers className="h-3.5 w-3.5" /> },
    { id: 'printers', label: tr.ribbonTabs.printers, icon: <Printer className="h-3.5 w-3.5" /> },
    { id: 'view', label: tr.ribbonTabs.view, icon: <Eye className="h-3.5 w-3.5" /> },
  ];

  return (
    <section className="shrink-0 border-b border-slate-800 bg-slate-900/90 select-none">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,image/*,.tiff,.tif,.heic"
        className="hidden"
        onChange={(e) => {
          const fileList = e.target.files ? Array.from(e.target.files) : [];
          if (fileList.length > 0) void importFiles(fileList);
          e.target.value = '';
        }}
      />

      {/* Ribbon Tab Header Strip */}
      <div className="flex items-center justify-between border-b border-slate-800/80 px-3 pt-1">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {tabs.map((tab) => {
            const active = activeRibbonTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-label={tab.label}
                title={tab.label}
                aria-pressed={active}
                onClick={() => {
                  setActiveRibbonTab(tab.id);
                  if (ribbonCollapsed) setRibbonCollapsed(false);
                }}
                className={`flex items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  active
                    ? 'bg-slate-800 text-sky-400 border-t-2 border-sky-500'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
              >
                {tab.icon}
                <span className="sr-only">{tab.label}</span>
                {tab.id === 'effects' && effects.invert && (
                  <span className="h-2 w-2 rounded-full bg-fuchsia-400" />
                )}
                {tab.id === 'batch' && (
                  <span className="rounded-full bg-sky-500/20 px-1.5 text-[10px] text-sky-300">
                    {batchQueue.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setRibbonCollapsed(!ribbonCollapsed)}
          title={lang === 'fa' ? 'جمع‌کردن / بازکردن ریبون ابزارها' : 'Collapse / Expand Ribbon'}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
        >
          {ribbonCollapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Ribbon Body */}
      {!ribbonCollapsed && (
        <div className="flex min-h-[82px] items-center gap-4 overflow-x-auto px-4 py-2.5 text-xs">
          {/* 1. FILE TAB */}
          {activeRibbonTab === 'file' && (
            <>
              <div className="flex items-center gap-2 border-e border-slate-800 pe-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title={lang === 'fa' ? 'افزودن فایل PDF / عکس' : 'Add PDF / Images'}
                  className="flex flex-col items-center gap-1 rounded-xl bg-sky-600/20 border border-sky-500/40 px-3.5 py-2 text-sky-300 hover:bg-sky-600/30 cursor-pointer"
                >
                  <FilePlus2 className="h-5 w-5" />
                  <span className="sr-only">
                    {lang === 'fa' ? 'افزودن فایل PDF / عکس' : 'Add PDF / Images'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void loadSampleWorkspace()}
                  title={tr.quickBar.loadDemoJob}
                  className="flex flex-col items-center gap-1 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  <BookOpen className="h-5 w-5 text-amber-400" />
                  <span className="sr-only">{tr.quickBar.loadDemoJob}</span>
                </button>
                <button
                  type="button"
                  onClick={() => insertBlankPageAfter()}
                  title={tr.sidebar.insertBlank}
                  className="flex flex-col items-center gap-1 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  <Copy className="h-5 w-5 text-emerald-400" />
                  <span className="sr-only">{tr.sidebar.insertBlank}</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void exportMergedOrImposedPdf(false)}
                  title={lang === 'fa' ? 'ذخیره خروجی PDF' : 'Export Final PDF'}
                  className="flex flex-col items-center gap-1 rounded-xl border border-emerald-500/40 bg-emerald-600/15 px-3.5 py-2 text-emerald-300 hover:bg-emerald-600/25 cursor-pointer"
                >
                  <FileDown className="h-5 w-5" />
                  <span className="sr-only">
                    {lang === 'fa' ? 'ذخیره خروجی PDF' : 'Export Final PDF'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={clearWorkspace}
                  title={lang === 'fa' ? 'بستن همه اسناد' : 'Close All'}
                  className="flex flex-col items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-300 hover:bg-rose-500/20 cursor-pointer"
                >
                  <Trash2 className="h-5 w-5" />
                  <span className="sr-only">{lang === 'fa' ? 'بستن همه اسناد' : 'Close All'}</span>
                </button>
              </div>
            </>
          )}

          {/* 2. PAGE LAYOUT / IMPOSITION TAB (D1 - D5) */}
          {activeRibbonTab === 'layout' && (
            <>
              <MatrixSizeFields rows={layout.rows} cols={layout.cols} language={lang} onChange={setNUpMatrix} />

              {/* Group D2: Placement Mode (Sequential vs Step & Repeat) + Unique Scale */}
              <div className="flex flex-col gap-1 border-e border-slate-800 pe-3">
                <span className="text-[10px] font-semibold text-slate-400">
                  {lang === 'fa' ? 'حالت چیدمان خانه‌ها (D2)' : 'Cell Placement Mode'}
                </span>
                <div className="flex items-center gap-1.5">
                  <select
                    value={layout.placementMode}
                    onChange={(e) =>
                      updateLayout({
                        placementMode: e.target.value as 'sequential' | 'step-and-repeat',
                      })
                    }
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="sequential">
                      {lang === 'fa'
                        ? 'هر صفحه در یک خانه (Sequential)'
                        : 'Each page in one cell'}
                    </option>
                    <option value="step-and-repeat">
                      {lang === 'fa'
                        ? 'تکرار یک صفحه در همه خانه‌ها (Step & Repeat)'
                        : 'Repeat page across all cells (Step & Repeat)'}
                    </option>
                  </select>
                  <label className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/70 px-2 py-1.5 text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={layout.uniqueScale}
                      onChange={(e) => updateLayout({ uniqueScale: e.target.checked })}
                      className="accent-sky-500"
                    />
                    <span>{lang === 'fa' ? 'مقیاس یکسان (Unique Scale)' : 'Unique Scale'}</span>
                  </label>
                </div>
              </div>

              {/* Group D4: Paper Size & Orientation */}
              <div className="flex flex-col gap-1 border-e border-slate-800 pe-3">
                <span className="text-[10px] font-semibold text-slate-400">
                  {lang === 'fa' ? 'سایز کاغذ و جهت (D4)' : 'Paper Size & Orientation'}
                </span>
                <div className="flex items-center gap-1.5">
                  <select
                    value={layout.paperSize}
                    onChange={(e) =>
                      updateLayout({ paperSize: e.target.value as PaperSizeId })
                    }
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100"
                  >
                    {driverPaperOptions.map((sizeKey) => (
                      <option key={sizeKey} value={sizeKey}>
                        {sizeKey}
                      </option>
                    ))}
                    {!driverPaperOptions.includes(layout.paperSize) && (
                      <option value={layout.paperSize}>{layout.paperSize} ({lang === 'fa' ? 'درایور فعلی گزارش نکرده' : 'not reported by driver'})</option>
                    )}
                    {!driverPaperOptions.includes('Custom') && <option value="Custom">Custom</option>}
                  </select>
                  {layout.paperSize === 'Custom' && (['customWidthMm', 'customHeightMm'] as const).map((field) => (
                    <label key={field} className="flex items-center gap-1 text-slate-300">
                      <span>{field === 'customWidthMm' ? (lang === 'fa' ? 'عرض' : 'W') : (lang === 'fa' ? 'ارتفاع' : 'H')} mm</span>
                      <input type="number" min={10} max={2000} value={layout[field]}
                        onChange={(e) => updateLayout({ [field]: Math.max(10, Math.min(2000, Number(e.target.value) || 10)) })}
                        className="w-16 rounded border border-slate-700 bg-slate-800 px-1 py-1 text-xs text-white" />
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      updateLayout({
                        orientation:
                          layout.orientation === 'portrait' ? 'landscape' : 'portrait',
                      })
                    }
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
                  >
                    {layout.orientation === 'portrait'
                      ? lang === 'fa'
                        ? 'عمودی (Portrait)'
                        : 'Portrait'
                      : lang === 'fa'
                        ? 'افقی (Landscape)'
                        : 'Landscape'}
                  </button>
                </div>
              </div>

              {/* Group D3: Margins, Gutters & Scale */}
              <div className="flex flex-col gap-1 border-e border-slate-800 pe-3">
                <span className="text-[10px] font-semibold text-slate-400">
                  {lang === 'fa' ? 'حاشیه، فاصله (Gutter) و مقیاس (D3)' : 'Margins, Gutter & Scale'}
                </span>
                <div className="flex items-center gap-1.5">
                  {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                    <label key={side} className="flex items-center gap-1 text-slate-300" title={lang === 'fa' ? `حاشیه ${ { top: 'بالا', right: 'راست', bottom: 'پایین', left: 'چپ' }[side] } (mm)` : `${side} margin (mm)`}>
                      <span>{lang === 'fa' ? { top: 'بالا', right: 'راست', bottom: 'پایین', left: 'چپ' }[side] : side}</span>
                      <input type="number" min={0} max={200} value={layout.marginsMm[side]}
                        onChange={(e) => updateMargins({ [side]: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })}
                        className="w-12 rounded border border-slate-700 bg-slate-800 px-1 py-1 text-center text-xs text-white" />
                    </label>
                  ))}
                  {(['horizontalGutterMm', 'verticalGutterMm'] as const).map((field) => (
                    <label key={field} className="flex items-center gap-1 text-slate-300">
                      <span>{field === 'horizontalGutterMm' ? (lang === 'fa' ? 'افقی' : 'Gap X') : (lang === 'fa' ? 'عمودی' : 'Gap Y')}</span>
                      <input type="number" min={0} max={200} value={layout[field]}
                        onChange={(e) => updateLayout({ [field]: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })}
                        className="w-12 rounded border border-slate-700 bg-slate-800 px-1 py-1 text-center text-xs text-white" />
                    </label>
                  ))}
                  <select
                    value={layout.scaleMode}
                    onChange={(e) =>
                      updateLayout({ scaleMode: e.target.value as ScaleMode })
                    }
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="fit">{lang === 'fa' ? 'Fit (جاگذاری کامل)' : 'Fit'}</option>
                    <option value="fill">{lang === 'fa' ? 'Fill (پر کردن کادر)' : 'Fill'}</option>
                    <option value="original">{lang === 'fa' ? '100% واقعی' : 'Original 100%'}</option>
                    <option value="custom">{lang === 'fa' ? 'درصد دلخواه' : 'Custom %'}</option>
                  </select>
                  {layout.scaleMode === 'custom' && (
                    <label className="text-slate-300">%
                      <input type="number" min={10} max={400} value={layout.customScalePercent}
                        onChange={(e) => updateLayout({ customScalePercent: Math.max(10, Math.min(400, Number(e.target.value) || 10)) })}
                        className="w-14 rounded border border-slate-700 bg-slate-800 px-1 py-1 text-xs text-white" />
                    </label>
                  )}
                </div>
              </div>

              {/* Group D5: Duplex & Sheet Reading Order */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold text-slate-400">
                  {lang === 'fa' ? 'چاپ دورو (Duplex) و ترتیب چیدمان (D5)' : 'Duplex & Reading Order'}
                </span>
                <div className="flex items-center gap-1.5">
                  <select
                    value={layout.duplexMode}
                    onChange={(e) =>
                      updateLayout({ duplexMode: e.target.value as DuplexMode })
                    }
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="none">{lang === 'fa' ? 'تک‌رو (Simplex)' : 'Simplex (1-Sided)'}</option>
                    <option value="long-edge">
                      {lang === 'fa' ? 'دورو - لبه بلند (Long Edge)' : 'Duplex Long-Edge'}
                    </option>
                    <option value="short-edge">
                      {lang === 'fa' ? 'دورو - لبه کوتاه (Short Edge)' : 'Duplex Short-Edge'}
                    </option>
                  </select>

                  <select
                    value={layout.sheetOrder}
                    onChange={(e) =>
                      updateLayout({ sheetOrder: e.target.value as SheetOrderMode })
                    }
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100"
                  >
                    <option value="rtl">{lang === 'fa' ? 'راست‌به‌چپ (فارسی)' : 'Right-to-Left'}</option>
                    <option value="ltr">{lang === 'fa' ? 'چپ‌به‌راست (LTR)' : 'Left-to-Right'}</option>
                    <option value="column">{lang === 'fa' ? 'ستونی (Column)' : 'Column-wise'}</option>
                    <option value="spiral">{lang === 'fa' ? 'مارپیچی (Spiral)' : 'Spiral'}</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => setModalState('manualDuplex', true)}
                    className="flex items-center gap-1 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/25 cursor-pointer"
                  >
                    <FlipHorizontal2 className="h-3.5 w-3.5" />
                    <span>{lang === 'fa' ? 'راهنمای ۳بعدی دوروی دستی' : '3D Manual Duplex'}</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* 3. EFFECTS & FILTERS TAB (E1 - E2) */}
          {activeRibbonTab === 'effects' && (
            <>
              {/* E1: Prominent Invert Toggle */}
              <div className="flex items-center gap-2 border-e border-slate-800 pe-4">
                <button
                  type="button"
                  onClick={toggleGlobalInvert}
                  className={`flex items-center gap-2.5 rounded-xl border px-4 py-2.5 font-bold transition cursor-pointer ${
                    effects.invert
                      ? 'border-fuchsia-400 bg-fuchsia-600 text-white shadow-lg shadow-fuchsia-600/30'
                      : 'border-slate-700 bg-slate-800 text-slate-200 hover:border-fuchsia-500/50'
                  }`}
                >
                  <Contrast className="h-5 w-5" />
                  <div className="text-start leading-tight">
                    <div className="text-xs font-extrabold">
                      {lang === 'fa' ? 'معکوس کردن رنگ‌ها (Invert)' : 'Invert Colors (Ctrl+I)'}
                    </div>
                    <div className="text-[10px] opacity-80">
                      {effects.invert
                        ? lang === 'fa'
                          ? 'فعال در پیش‌نمایش (GPU)، چاپ و خروجی PDF (Vector)'
                          : 'Active in Preview, Print & Vector PDF'
                        : lang === 'fa'
                          ? 'مناسب اسلایدهای تیره و نقشه‌های نگاتیو'
                          : 'Ideal for dark slides & blueprints'}
                    </div>
                  </div>
                </button>
              </div>

              {/* E2: Grayscale, B&W Threshold, Black Text */}
              <div className="flex items-center gap-2 border-e border-slate-800 pe-4">
                <label className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={effects.grayscale}
                    onChange={(e) =>
                      updateEffects({ grayscale: e.target.checked }, true)
                    }
                    className="accent-sky-500"
                  />
                  <span>{lang === 'fa' ? 'سیاه‌وسفید (Grayscale)' : 'Grayscale'}</span>
                </label>

                <label className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={effects.blackAndWhite}
                    onChange={(e) =>
                      updateEffects({ blackAndWhite: e.target.checked }, true)
                    }
                    className="accent-sky-500"
                  />
                  <span>{lang === 'fa' ? 'آستانه تک‌بیتی (Threshold)' : 'B&W Threshold'}</span>
                </label>

                {effects.blackAndWhite && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="range"
                      min={30}
                      max={230}
                      value={effects.threshold}
                      onChange={(e) =>
                        updateEffects({ threshold: Number(e.target.value) })
                      }
                      className="w-20 accent-sky-500"
                    />
                    <span className="w-8 font-mono text-[11px] text-sky-300">
                      {effects.threshold}
                    </span>
                  </div>
                )}

                <label className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={effects.blackText}
                    onChange={(e) =>
                      updateEffects({ blackText: e.target.checked }, true)
                    }
                    className="accent-sky-500"
                  />
                  <span>{lang === 'fa' ? 'تثبیت متن مشکی (Black Text)' : 'Black Text'}</span>
                </label>
              </div>

              {/* E2: Brightness, Contrast, Gamma */}
              <div className="flex items-center gap-3 border-e border-slate-800 pe-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-slate-400">
                    {lang === 'fa' ? `روشنایی (${effects.brightness})` : `Brightness (${effects.brightness})`}
                  </span>
                  <input
                    type="range"
                    min={-60}
                    max={60}
                    value={effects.brightness}
                    onChange={(e) =>
                      updateEffects({ brightness: Number(e.target.value) })
                    }
                    className="w-24 accent-sky-500"
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-slate-400">
                    {lang === 'fa' ? `کنتراست (${effects.contrast})` : `Contrast (${effects.contrast})`}
                  </span>
                  <input
                    type="range"
                    min={-60}
                    max={80}
                    value={effects.contrast}
                    onChange={(e) =>
                      updateEffects({ contrast: Number(e.target.value) })
                    }
                    className="w-24 accent-sky-500"
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-slate-400">
                    {lang === 'fa' ? `گاما (${effects.gamma.toFixed(1)})` : `Gamma (${effects.gamma.toFixed(1)})`}
                  </span>
                  <input
                    type="range"
                    min={0.4}
                    max={2.4}
                    step={0.1}
                    value={effects.gamma}
                    onChange={(e) =>
                      updateEffects({ gamma: Number(e.target.value) })
                    }
                    className="w-20 accent-sky-500"
                  />
                </div>
              </div>

              {/* Scope & Reset */}
              <div className="flex items-center gap-2">
                <select
                  value={effects.scope}
                  onChange={(e) =>
                    updateEffects({ scope: e.target.value as 'all' | 'selected' })
                  }
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100"
                >
                  <option value="all">
                    {lang === 'fa' ? 'اعمال روی کل سند' : 'Apply to Entire Document'}
                  </option>
                  <option value="selected">
                    {lang === 'fa' ? 'فقط صفحات انتخاب‌شده' : 'Selected Pages Only'}
                  </option>
                </select>
                <button
                  type="button"
                  onClick={resetEffects}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  {lang === 'fa' ? 'بازنشانی افکت‌ها' : 'Reset'}
                </button>
              </div>
            </>
          )}

          {/* 4. INSERT TAB: WATERMARK & PAGE/BATES NUMBERING (F1 - F2) */}
          {activeRibbonTab === 'insert' && (
            <>
              <button type="button" aria-label={lang==='fa'?'افزودن متن':'Add text'} disabled={!pages.length}
                onClick={addTextOverlay} className="flex items-center gap-1 rounded-lg border border-sky-500 bg-sky-700 px-3 py-2 font-semibold text-white disabled:opacity-40">
                <Type className="h-4 w-4" aria-hidden="true" />{lang==='fa'?'افزودن متن':'Add text'}
              </button>
              {/* F1: Watermark */}
              <div className="flex items-center gap-2.5 border-e border-slate-800 pe-4">
                <label className="flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 font-bold text-sky-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={watermark.enabled}
                    onChange={(e) => updateWatermark({ enabled: e.target.checked })}
                    className="accent-sky-500"
                  />
                  <Droplets className="h-4 w-4" />
                  <span>{lang === 'fa' ? 'واترمارک زنده (F1)' : 'Watermark'}</span>
                </label>

                <input
                  type="text"
                  value={watermark.text}
                  onChange={(e) =>
                    updateWatermark({ enabled: true, text: e.target.value })
                  }
                  placeholder="متن واترمارک با ماکرو {shamsi_date}..."
                  className="w-60 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-white"
                />

                <div className="flex items-center gap-1">
                  {['{shamsi_date}', '{page}', '{pages}', '{file}', '{user}'].map(
                    (macro) => (
                      <button
                        key={macro}
                        type="button"
                        onClick={() =>
                          updateWatermark({
                            enabled: true,
                            text: `${watermark.text} ${macro}`.trim(),
                          })
                        }
                        className="rounded bg-slate-800 px-1.5 py-1 font-mono text-[10px] text-sky-300 hover:bg-slate-700 cursor-pointer"
                      >
                        {macro}
                      </button>
                    )
                  )}
                </div>

                <label className="flex items-center gap-1 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={watermark.tiled}
                    onChange={(e) =>
                      updateWatermark({ enabled: true, tiled: e.target.checked })
                    }
                    className="accent-sky-500"
                  />
                  <span>{lang === 'fa' ? 'کاشی‌کاری (Tile)' : 'Tile'}</span>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button type="button" disabled={!pages.length} onClick={()=>imageInputRef.current?.click()} aria-label={lang==='fa'?'افزودن تصویر روی صفحه':'Add picture on the page'} className="rounded-lg border border-sky-500 bg-sky-700 px-3 py-2 font-semibold text-white disabled:opacity-40">{lang==='fa'?'افزودن تصویر':'Add picture'}</button>
                <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e=>{const files=e.target.files?Array.from(e.target.files):[];if(files.length)void addImageOverlayFiles(files);e.target.value='';}}/>
                <span className="text-[11px] text-slate-400">{lang==='fa'?'یا فایل تصویر را مستقیم روی برگه در پیش‌نمایش رها کنید.' : 'Or drop an image file straight onto a sheet in the preview.'}</span>
              </div>
              <button type="button" disabled={!pages.length} onClick={()=>addNumberingOverlay()} aria-label={lang==='fa'?'افزودن شماره صفحه قابل ویرایش':'Add editable page number'} className="rounded-lg border border-emerald-500 bg-emerald-700 px-3 py-2 font-semibold text-white disabled:opacity-40">{lang==='fa'?'افزودن شماره صفحه':'Add page number'}</button>
              {pageNumbering.enabled && <button type="button" disabled={!pages.length} onClick={()=>addNumberingOverlay(true)} className="rounded-lg border border-amber-500 bg-amber-800 px-3 py-2 text-white disabled:opacity-40">{lang==='fa'?'تبدیل شماره‌گذاری قدیمی به قابل ویرایش':'Convert legacy numbering to editable'}</button>}
              <p className="text-xs text-slate-400">{lang === 'fa' ? 'شماره قابل ویرایش را روی صفحه بکشید و برای زوج/فرد و فرمول از پنل استفاده کنید.' : 'Drag the editable number on the page; use the panel for odd/even scopes and formulas.'}</p>
              {/* F2: Legacy Page & Bates Numbering */}
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 font-bold text-emerald-300 cursor-pointer">
                  <input
                    type="checkbox"
                    aria-label={lang === 'fa' ? 'شماره‌گذاری قدیمی (فقط خروجی ثابت)' : 'Legacy numbering (fixed output only)'}
                    checked={pageNumbering.enabled}
                    onChange={(e) =>
                      updatePageNumbering({ enabled: e.target.checked })
                    }
                    className="accent-emerald-500"
                  />
                  <Hash className="h-4 w-4" />
                  <span>{lang === 'fa' ? 'شماره‌گذاری قدیمی' : 'Page / Bates # (legacy)'}</span>
                </label>

                <select
                  value={pageNumbering.format}
                  onChange={(e) =>
                    updatePageNumbering({
                      enabled: true,
                      format: e.target.value as PageNumberFormat,
                    })
                  }
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100"
                >
                  <option value="persian">
                    {lang === 'fa' ? 'فارسی (صفحه ۱ از ۱۰)' : 'Persian Digits'}
                  </option>
                  <option value="english">
                    {lang === 'fa' ? 'انگلیسی (Page 1 of 10)' : 'English (Page 1 of 10)'}
                  </option>
                  <option value="roman">
                    {lang === 'fa' ? 'رومی (I, II, III)' : 'Roman Numerals'}
                  </option>
                  <option value="bates">
                    {lang === 'fa' ? 'شماره‌گذاری حقوقی (Bates)' : 'Bates Numbering'}
                  </option>
                </select>
              </div>
            </>
          )}

          {/* 5. CROP BOX & MARKS TAB */}
          {activeRibbonTab === 'crop' && (
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={layout.showCellBorders}
                  onChange={(e) =>
                    updateLayout({ showCellBorders: e.target.checked })
                  }
                  className="accent-sky-500"
                />
                <span>{lang === 'fa' ? 'نمایش خطوط کادر هر خانه (Cell Borders)' : 'Show Cell Borders'}</span>
              </label>

              <label className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={layout.showCropMarks}
                  onChange={(e) =>
                    updateLayout({ showCropMarks: e.target.checked })
                  }
                  className="accent-sky-500"
                />
                <span>{lang === 'fa' ? 'علائم برش چاپخانه (Crop Marks)' : 'Print Crop Marks'}</span>
              </label>

              <div className="flex items-center gap-2 text-slate-300">
                <span>{lang === 'fa' ? 'حاشیه‌های چهارگانه شیت (mm):' : 'Sheet Margins (mm):'}</span>
                {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                  <label key={side} className="flex items-center gap-1">
                    <span className="uppercase text-[10px] text-slate-400">{side}:</span>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={layout.marginsMm[side]}
                      onChange={(e) =>
                        updateMargins({ [side]: Math.max(0, Number(e.target.value)) })
                      }
                      className="w-12 rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-center text-white"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* 6. PDF MERGE & SPLIT TAB (C1 - C2, A4) */}
          {activeRibbonTab === 'pdf' && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void exportMergedOrImposedPdf(false)}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-500 cursor-pointer"
              >
                <FileDown className="h-4 w-4" />
                <span>
                  {lang === 'fa'
                    ? `ادغام و خروجی PDF همه صفحات فعال (${
                        pages.filter((p) => p.selectedForPrint).length
                      } صفحه)`
                    : 'Merge All Selected to PDF'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => void exportMergedOrImposedPdf(true)}
                className="flex items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/15 px-3.5 py-2 font-semibold text-sky-300 hover:bg-sky-500/25 cursor-pointer"
              >
                <Scissors className="h-4 w-4" />
                <span>{tr.sidebar.extractPdf}</span>
              </button>

              <button
                type="button"
                onClick={() => setModalState('split', true)}
                className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 font-semibold text-amber-300 hover:bg-amber-500/25 cursor-pointer"
              >
                <FileStack className="h-4 w-4" />
                <span>
                  {lang === 'fa'
                    ? 'تفکیک خودکار هر N صفحه / تکرار آرایه‌ای'
                    : 'Split PDF / Make Array'}
                </span>
              </button>

              <button
                type="button"
                onClick={reversePageOrder}
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                <RotateCw className="h-4 w-4" />
                <span>{tr.sidebar.reverseOrder}</span>
              </button>
            </div>
          )}

          {/* 7. BATCH PRINT TAB (H1 - H2) */}
          {activeRibbonTab === 'batch' && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={addCurrentWorkspaceToBatch}
                className="flex items-center gap-2 rounded-xl bg-sky-600 px-3.5 py-2 font-bold text-white hover:bg-sky-500 cursor-pointer"
              >
                <FilePlus2 className="h-4 w-4" />
                <span>
                  {lang === 'fa'
                    ? 'افزودن پروژه فعلی به صف چاپ دسته‌ای'
                    : 'Add Current Workspace to Batch'}
                </span>
              </button>

              {!isBatchRunning ? (
                <button
                  type="button"
                  onClick={() => void runBatchQueue()}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 font-bold text-white hover:bg-emerald-500 cursor-pointer"
                >
                  <Play className="h-4 w-4" />
                  <span>{lang === 'fa' ? 'شروع چاپ دسته‌ای (Run Batch)' : 'Start Batch Queue'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pauseBatchQueue}
                  className="flex items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-2 font-bold text-white hover:bg-amber-500 cursor-pointer"
                >
                  <Pause className="h-4 w-4" />
                  <span>{lang === 'fa' ? 'توقف موقت صف (Pause)' : 'Pause Batch'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={retryFailedBatchJobs}
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                <RefreshCw className="h-4 w-4" />
                <span>{lang === 'fa' ? 'تلاش مجدد خطاها (Retry)' : 'Retry Failed'}</span>
              </button>
            </div>
          )}

          {/* 8. PRINTERS & SPOOLER TAB (I1 - I3) */}
          {activeRibbonTab === 'printers' && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setModalState('print', true)}
                className="flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 font-bold text-white hover:bg-sky-500 cursor-pointer"
              >
                <Printer className="h-4 w-4" />
                <span>
                  {lang === 'fa'
                    ? 'پنجره تنظیمات کامل چاپ (Print Dialog)'
                    : 'Open Full Print Dialog'}
                </span>
              </button>
              <span className="text-xs text-slate-400">
                {lang === 'fa'
                  ? 'پنل کامل مدیریت پرینترهای ویندوز و صف Spooler در پایین همین بخش باز شده است.'
                  : 'Full Windows Printer & Spooler Queue Manager is displayed below.'}
              </span>
              <button
                type="button"
                disabled={!selectedPrinterName}
                onClick={() => void openPrinterPreferences(selectedPrinterName)}
                className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600/15 px-3.5 py-2 font-semibold text-emerald-300 hover:bg-emerald-600/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {lang === 'fa' ? 'تنظیمات درایور ویندوز و همگام‌سازی شیت' : 'Windows Driver Preferences'}
              </button>
            </div>
          )}

          {/* 9. VIEW TAB (J1) */}
          {activeRibbonTab === 'view' && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
                {(['single', 'continuous', 'double', 'grid'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setViewMode(m)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                      viewMode === m
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m === 'single'
                      ? lang === 'fa'
                        ? 'تک‌برگ'
                        : 'Single'
                      : m === 'continuous'
                        ? lang === 'fa' ? 'پیوسته' : 'Continuous'
                        : m === 'double'
                        ? lang === 'fa'
                          ? 'دوبرگ کنار هم (رو/پشت)'
                          : 'Two-Sheet Spread'
                        : lang === 'fa'
                          ? 'نمای شبکه‌ای (Grid)'
                          : 'Grid View'}
                  </button>
                ))}
              </div>

              <label className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showRulers}
                  onChange={(e) => setShowRulers(e.target.checked)}
                  className="accent-sky-500"
                />
                <Ruler className="h-3.5 w-3.5 text-sky-400" />
                <span>{lang === 'fa' ? 'نمایش خط‌کش دقیق' : 'Rulers'}</span>
              </label>

              <label className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={loupeEnabled}
                  onChange={(e) => setLoupeEnabled(e.target.checked)}
                  className="accent-sky-500"
                />
                <Search className="h-3.5 w-3.5 text-amber-400" />
                <span>{tr.preview.loupeMode}</span>
              </label>

              <label className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={transparentMode}
                  onChange={(e) => setTransparentMode(e.target.checked)}
                  className="accent-sky-500"
                />
                <SunMedium className="h-3.5 w-3.5 text-emerald-400" />
                <span>{tr.preview.transparentMode}</span>
              </label>

              <div className="flex items-center gap-1">
                {[75, 100, 125, 150].map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setZoomPercent(z)}
                    className={`rounded-lg px-2 py-1 text-xs cursor-pointer ${
                      zoomPercent === z
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {z}%
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
