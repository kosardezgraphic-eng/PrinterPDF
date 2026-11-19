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
  Play,
  Pause,
  RefreshCw,
  Ruler,
  Search,
  VectorSquare,
  Maximize2,
  FlipHorizontal2,
  Trash2,
  FileDown,
  Magnet,
  Eraser,
  SquareDashedMousePointer,
  Pipette,
} from 'lucide-react';
import { MatrixSizeFields } from './MatrixSizeFields';
import { SettingsPresetMenu } from './SettingsPresets';
import { MarginPresetsMenu } from './MarginPresetsMenu';
import { ShapePicker } from './ShapeControlPanel';
import { useAppStore, type RibbonTabId } from '../store/useAppStore';
import { resolvePrinterMinMargins } from '../engine/sheetInteraction';
import { getSheetDimensionsMm } from '../engine/layoutEngine';
import { t } from '../i18n/translations';
import {
  STANDARD_PAPER_SIZES,
  type DuplexMode,
  type PageOrientation,
  type PaperSizeId,
  type ScaleMode,
  type SheetOrderMode,
} from '@shared/models';

interface RibbonProps {
  onOpenWatermarkPanel: () => void;
  onOpenBookletPanel: () => void;
  panelMode?: boolean;
}

export const Ribbon: React.FC<RibbonProps> = ({
  onOpenWatermarkPanel,
  onOpenBookletPanel,
  panelMode = false,
}) => {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const {
    activeRibbonTab,
    ribbonCollapsed,
    layout,
    printers,
    selectedPrinterName,
    printerMargins,
    effects,
    watermark,
    settings,
    pages,
    batchQueue,
    isBatchRunning,
    viewMode,
    showRulers,
    snapEnabled,
    smartGuidesEnabled,
    loupeEnabled,
    transparentMode,
    zoomPercent,
    setActiveRibbonTab,
    setRibbonCollapsed,
    importFiles,
    clearWorkspace,
    updateLayout,
    setNUpMatrix,
    updateMargins,
    resetMarginsToPrinter,
    refreshPrinterMargins,
    updateEffects,
    toggleGlobalInvert,
    eraseTool,
    eraseBrushMm,
    eraseColor,
    setEraseTool,
    setEraseBrushMm,
    setEraseColor,
    resetEffects,
    updateSettings,
    clearCrispPreviewCacheNow,
    addTextOverlay,
    addShapeOverlay,
    addNumberingOverlay,
    addImageOverlayFiles,
    exportMergedOrImposedPdf,
    insertBlankPageAfter,
    reversePageOrder,
    setModalState,
    openPrinterPreferences,
    updatePrinterProfile,
    addCurrentWorkspaceToBatch,
    runBatchQueue,
    pauseBatchQueue,
    retryFailedBatchJobs,
    setViewMode,
    setShowRulers,
    setSnapEnabled,
    setSmartGuidesEnabled,
    setLoupeEnabled,
    setTransparentMode,
    setZoomPercent,
  } = useAppStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const lang = settings.language;
  const tr = t(lang);
  const selectedPrinter = printers.find((printer) => printer.name === selectedPrinterName);
  const sheetDims = getSheetDimensionsMm(layout);
  const driverPaperOptions = selectedPrinter?.capabilities.paperOptions?.length
    ? selectedPrinter.capabilities.paperOptions
    : (selectedPrinter?.capabilities.supportedPapers?.length
        ? selectedPrinter.capabilities.supportedPapers
        : (Object.keys(STANDARD_PAPER_SIZES) as PaperSizeId[])
      ).map((id) => {
        const dims = id !== 'Custom' ? STANDARD_PAPER_SIZES[id] : { widthMm: layout.customWidthMm, heightMm: layout.customHeightMm };
        return {
          id,
          name: id,
          widthMm: dims.widthMm,
          heightMm: dims.heightMm,
        };
      });
  const selectedPaperOptionValue = (() => {
    const activeName = selectedPrinter?.activeProfile.paperName;
    if (activeName) {
      const byName = driverPaperOptions.find((o) => o.name.toLowerCase() === activeName.toLowerCase());
      if (byName) return byName.name;
    }
    const byId = driverPaperOptions.find((o) => o.id === layout.paperSize);
    return byId?.name ?? layout.paperSize;
  })();

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
    <section className={panelMode
      ? "psp-tool-panel-ribbon flex h-full min-h-0 min-w-0 flex-col bg-slate-900/90 select-none"
      : "shrink-0 border-b border-slate-800 bg-slate-900/90 select-none"
    }>
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

      {!panelMode && (
        <>
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
  
        </>
        )}
      {/* Ribbon Body */}
      {!ribbonCollapsed && (
        <div className={panelMode
          ? "psp-tool-panel-ribbon__content flex min-h-0 flex-1 flex-col items-stretch gap-3 overflow-y-auto overflow-x-hidden px-3 py-3 text-xs"
          : "flex min-h-[82px] items-center gap-4 overflow-x-auto px-4 py-2.5 text-xs"
        }>
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
                <SettingsPresetMenu />
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
                    aria-label={lang === 'fa' ? 'سایز کاغذ شیت' : 'Sheet Paper Size'}
                    value={selectedPaperOptionValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'Custom') {
                        updateLayout({ paperSize: 'Custom' });
                        if (selectedPrinter) {
                          void updatePrinterProfile(selectedPrinter.name, {
                            paperSize: 'Custom',
                            paperName: 'Custom',
                            paperWidthMm: layout.customWidthMm,
                            paperHeightMm: layout.customHeightMm,
                          });
                        }
                        return;
                      }
                      const matched = driverPaperOptions.find((o) => o.name === val || o.id === val);
                      if (!matched) {
                        updateLayout({ paperSize: val as PaperSizeId });
                        return;
                      }
                      const minW = Math.min(matched.widthMm, matched.heightMm);
                      const maxH = Math.max(matched.widthMm, matched.heightMm);
                      updateLayout({
                        paperSize: matched.id,
                        customWidthMm: minW,
                        customHeightMm: maxH,
                      });
                      if (selectedPrinter) {
                        void updatePrinterProfile(selectedPrinter.name, {
                          paperSize: matched.id,
                          paperName: matched.name,
                          paperWidthMm: minW,
                          paperHeightMm: maxH,
                        });
                      }
                    }}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 tabular-nums"
                  >
                    {driverPaperOptions.map((opt) => (
                      <option key={`${opt.id}-${opt.name}`} value={opt.name}>
                        {opt.name} ({Math.round(opt.widthMm)}×{Math.round(opt.heightMm)} mm)
                      </option>
                    ))}
                    {!driverPaperOptions.some((o) => o.name === selectedPaperOptionValue || o.id === layout.paperSize) && (
                      <option value={layout.paperSize}>
                        {layout.paperSize} ({lang === 'fa' ? 'درایور فعلی گزارش نکرده' : 'not reported by driver'})
                      </option>
                    )}
                    {!driverPaperOptions.some((o) => o.id === 'Custom') && <option value="Custom">Custom</option>}
                  </select>
                  <span className="rounded border border-slate-700/80 bg-slate-950/70 px-1.5 py-1 text-[10px] font-mono text-sky-300 tabular-nums whitespace-nowrap">
                    {Math.round(sheetDims.widthMm)}×{Math.round(sheetDims.heightMm)} mm
                  </span>
                  {layout.paperSize === 'Custom' && (['customWidthMm', 'customHeightMm'] as const).map((field) => (
                    <label key={field} className="flex items-center gap-1 text-slate-300">
                      <span>{field === 'customWidthMm' ? (lang === 'fa' ? 'عرض' : 'W') : (lang === 'fa' ? 'ارتفاع' : 'H')} mm</span>
                      <input type="number" min={10} max={2000} value={layout[field]}
                        onChange={(e) => {
                          const nextVal = Math.max(10, Math.min(2000, Number(e.target.value) || 10));
                          updateLayout({ [field]: nextVal });
                          if (selectedPrinter) {
                            void updatePrinterProfile(selectedPrinter.name, {
                              paperSize: 'Custom',
                              paperName: 'Custom',
                              paperWidthMm: field === 'customWidthMm' ? nextVal : layout.customWidthMm,
                              paperHeightMm: field === 'customHeightMm' ? nextVal : layout.customHeightMm,
                            });
                          }
                        }}
                        className="w-16 rounded border border-slate-700 bg-slate-800 px-1 py-1 text-xs text-white tabular-nums" />
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const nextOrientation: PageOrientation =
                        layout.orientation === 'portrait' ? 'landscape' : 'portrait';
                      updateLayout({ orientation: nextOrientation });
                      if (selectedPrinter) {
                        void updatePrinterProfile(selectedPrinter.name, { orientation: nextOrientation });
                      }
                    }}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
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
                  <MarginPresetsMenu compact />
                  {(['top', 'right', 'bottom', 'left'] as const).map((side) => {
                    const activePrinterObj = printers.find((p) => p.name === selectedPrinterName);
                    const minSide = Math.max(0, resolvePrinterMinMargins(printerMargins, activePrinterObj)?.[side] ?? 0);
                    return (
                      <label key={side} className="flex items-center gap-1 text-slate-300" title={lang === 'fa' ? `حاشیه ${ { top: 'بالا', right: 'راست', bottom: 'پایین', left: 'چپ' }[side] } (mm)${minSide > 0 ? ` — حداقل پرینتر: ${minSide} mm` : ''}` : `${side} margin (mm)${minSide > 0 ? ` (min ${minSide} mm)` : ''}`}>
                        <span>{lang === 'fa' ? { top: 'بالا', right: 'راست', bottom: 'پایین', left: 'چپ' }[side] : side}</span>
                        <input type="number" min={minSide} max={Math.max(minSide, 200)} step={layout.booklet?.enabled ? 0.5 : 1}
                          value={Math.max(minSide, layout.marginsMm[side])}
                          onChange={(e) => updateMargins({ [side]: Math.max(minSide, Math.min(200, Number(e.target.value) || 0)) })}
                          className="w-12 rounded border border-slate-700 bg-slate-800 px-1 py-1 text-center text-xs text-white" />
                      </label>
                    );
                  })}
                  {(['horizontalGutterMm', 'verticalGutterMm'] as const).map((field) => (
                    <label key={field} className="flex items-center gap-1 text-slate-300">
                      <span>{field === 'horizontalGutterMm' ? (lang === 'fa' ? 'افقی' : 'Gap X') : (lang === 'fa' ? 'عمودی' : 'Gap Y')}</span>
                      <input type="number" min={0} max={layout.booklet?.enabled && field === 'horizontalGutterMm' ? 30 : 200}
                        step={layout.booklet?.enabled && field === 'horizontalGutterMm' ? 0.5 : 1}
                        disabled={!!layout.booklet?.enabled && field === 'verticalGutterMm'}
                        value={layout.booklet?.enabled ? (field === 'horizontalGutterMm' ? layout.booklet.spineWidthMm : 0) : layout[field]}
                        onChange={(e) => {
                          const val = Math.max(0, Math.min(200, Number(e.target.value) || 0));
                          if (layout.booklet?.enabled && field === 'horizontalGutterMm') {
                            updateLayout({ booklet: { ...layout.booklet, spineWidthMm: Math.min(30, val) } });
                          } else {
                            updateLayout({ [field]: val });
                          }
                        }}
                        className="w-12 rounded border border-slate-700 bg-slate-800 px-1 py-1 text-center text-xs text-white disabled:opacity-40" />
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
                    aria-label={lang === 'fa' ? 'حالت چاپ دورو شیت' : 'Sheet Duplex Mode'}
                    value={layout.duplexMode}
                    onChange={(e) => {
                      const nextDuplex = e.target.value as DuplexMode;
                      updateLayout({ duplexMode: nextDuplex });
                    }}
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
              {/* Shapes: one click per outline, and the settings panel opens on what was inserted. */}
              <div className="flex items-center gap-1 border-e border-slate-800 pe-3">
                <ShapePicker onPick={(type) => { addShapeOverlay(type); }} />
              </div>
              {/* The eraser belongs to the Insert tab because it edits what Insert puts on the sheet: pick a
                  mode, then drag on the picture. Pressing the lit button again is the way out — a tool that
                  could only be switched on would trap the pointer in a mode the operator has left. */}
              <div className="flex items-center gap-1 border-e border-slate-800 pe-3" data-erase-tools>
                <button type="button" data-erase-tool="brush" aria-pressed={eraseTool === 'brush'}
                  onClick={() => setEraseTool(eraseTool === 'brush' ? 'off' : 'brush')}
                  title={lang === 'fa' ? 'با قلم‌مو روی صفحه PDF یا تصویر بکشید تا همان قسمت پاک شود' : 'Drag a brush over a PDF page or picture to erase that area'}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold ${eraseTool === 'brush' ? 'bg-rose-600 text-white' : 'border border-slate-700 bg-slate-800 text-slate-200 hover:border-rose-500/50'}`}>
                  <Eraser className="h-4 w-4" aria-hidden="true" />
                  <span>{lang === 'fa' ? 'پاک‌کن: قلم‌مو' : 'Eraser: brush'}</span>
                </button>
                <button type="button" data-erase-tool="region" aria-pressed={eraseTool === 'region'}
                  onClick={() => setEraseTool(eraseTool === 'region' ? 'off' : 'region')}
                  title={lang === 'fa' ? 'روی صفحه PDF یا تصویر کادر بکشید؛ با Delete داخل آن پاک می‌شود' : 'Drag a rectangle on a PDF page or picture, then press Delete'}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold ${eraseTool === 'region' ? 'bg-rose-600 text-white' : 'border border-slate-700 bg-slate-800 text-slate-200 hover:border-rose-500/50'}`}>
                  <SquareDashedMousePointer className="h-4 w-4" aria-hidden="true" />
                  <span>{lang === 'fa' ? 'پاک‌کن: ناحیه' : 'Eraser: region'}</span>
                </button>
                {/* The eyedropper is not a mode you stay in: one click on the artwork, and the brush is armed
                    with that colour. That is the shortest path from "this exact grey" to "paint over there". */}
                <button type="button" data-erase-tool="picker" aria-pressed={eraseTool === 'picker'}
                  onClick={() => setEraseTool(eraseTool === 'picker' ? 'off' : 'picker')}
                  title={lang === 'fa' ? 'روی صفحه PDF یا تصویر کلیک کنید تا رنگ همان نقطه قلم‌مو شود' : 'Click a PDF page or picture to pick its colour for the brush'}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold ${eraseTool === 'picker' ? 'bg-amber-500 text-slate-950' : 'border border-slate-700 bg-slate-800 text-slate-200 hover:border-amber-400/60'}`}>
                  <Pipette className="h-4 w-4" aria-hidden="true" />
                  <span>{lang === 'fa' ? 'قطره‌چکان' : 'Eyedropper'}</span>
                </button>
                {eraseTool !== 'off' && (
                  <label className="flex items-center gap-1 text-[10px] text-slate-300">
                    <span>{lang === 'fa' ? 'قطر (mm)' : 'Ø (mm)'}</span>
                    <input data-erase-size aria-label={lang === 'fa' ? 'قطر پاک‌کن بر حسب میلی‌متر' : 'Eraser diameter in millimetres'}
                      type="number" min="0.2" max="500" step="0.1" value={Number(eraseBrushMm.toFixed(2))}
                      onChange={(e) => setEraseBrushMm(Number(e.target.value))}
                      className="w-16 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-xs text-white" />
                  </label>
                )}
                {eraseTool !== 'off' && (
                  <label className="flex items-center gap-1 text-[10px] text-slate-300" title={lang === 'fa'
                    ? 'اگر رنگی انتخاب شود، قلم‌مو آن رنگ را می‌گذارد نه اینکه سوراخ کند'
                    : 'A colour makes the brush lay that colour down instead of cutting a hole'}>
                    <span>{lang === 'fa' ? 'رنگ' : 'Colour'}</span>
                    <input data-erase-color type="color" aria-label={lang === 'fa' ? 'رنگ قلم‌مو' : 'Brush colour'} value={eraseColor ?? '#ffffff'}
                      onChange={(e) => setEraseColor(e.target.value)}
                      className="h-6 w-8 cursor-pointer rounded border border-slate-600 bg-slate-800 p-0.5" />
                    <button type="button" data-erase-color="hole" onClick={() => setEraseColor(null)}
                      className={`rounded px-1.5 py-0.5 ${!eraseColor ? 'bg-rose-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>
                      {lang === 'fa' ? 'بدون رنگ' : 'No colour'}
                    </button>
                  </label>
                )}
              </div>
              
              <button type="button" data-watermark-panel-trigger aria-pressed={watermark.enabled}
                onClick={onOpenWatermarkPanel}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 font-semibold transition-colors ${watermark.enabled ? 'border-sky-400 bg-sky-600 text-white' : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>
                <Droplets className="h-4 w-4" />
                {lang === 'fa' ? 'واترمارک' : 'Watermark'}
              </button>

              <button type="button" data-booklet-panel-trigger aria-pressed={!!layout.booklet?.enabled}
                onClick={onOpenBookletPanel}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 font-semibold transition-colors ${layout.booklet?.enabled ? 'border-amber-400 bg-amber-600 text-white' : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>
                <FileStack className="h-4 w-4" />
                {lang === 'fa' ? 'بوکلت' : 'Booklet'}
              </button>

              <div className="flex items-center gap-2">
                <button type="button" disabled={!pages.length} onClick={()=>imageInputRef.current?.click()} aria-label={lang==='fa'?'افزودن تصویر روی صفحه':'Add picture on the page'} className="rounded-lg border border-sky-500 bg-sky-700 px-3 py-2 font-semibold text-white disabled:opacity-40">{lang==='fa'?'افزودن تصویر':'Add picture'}</button>
                <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e=>{const files=e.target.files?Array.from(e.target.files):[];if(files.length)void addImageOverlayFiles(files);e.target.value='';}}/>
                <span className="text-[11px] text-slate-400">{lang==='fa'?'یا فایل تصویر را مستقیم روی برگه در پیش‌نمایش رها کنید.' : 'Or drop an image file straight onto a sheet in the preview.'}</span>
              </div>
              <button type="button" disabled={!pages.length} onClick={()=>addNumberingOverlay()} aria-label={lang==='fa'?'افزودن شماره صفحه قابل ویرایش':'Add editable page number'} className="rounded-lg border border-emerald-500 bg-emerald-700 px-3 py-2 font-semibold text-white disabled:opacity-40">{lang==='fa'?'افزودن شماره صفحه':'Add page number'}</button>
              <p className="text-xs text-slate-400">{lang === 'fa' ? 'شماره قابل ویرایش را روی صفحه بکشید و برای زوج/فرد و فرمول از پنل استفاده کنید.' : 'Drag the editable number on the page; use the panel for odd/even scopes and formulas.'}</p>

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

              <div className="flex flex-col gap-1 border-e border-slate-800 pe-3 text-[11px]">
                <span className="font-semibold text-slate-300">{lang === 'fa' ? 'حاشیه واقعی پرینتر' : 'Driver imageable margins'}</span>
                <span className={printerMargins.status === 'available' ? 'text-emerald-300' : 'text-amber-300'}>
                  {printerMargins.status === 'available'
                    ? (lang === 'fa'
                      ? `بالا ${printerMargins.marginsMm.top} · راست ${printerMargins.marginsMm.right} · پایین ${printerMargins.marginsMm.bottom} · چپ ${printerMargins.marginsMm.left} میلی‌متر`
                      : `T ${printerMargins.marginsMm.top} · R ${printerMargins.marginsMm.right} · B ${printerMargins.marginsMm.bottom} · L ${printerMargins.marginsMm.left} mm`)
                    : (printerMargins.status === 'loading'
                      ? (lang === 'fa' ? 'در حال دریافت از درایور...' : 'Reading driver...')
                      : (lang === 'fa' ? 'اطلاعات محدوده چاپ در دسترس نیست' : 'Driver imageable area unavailable'))}
                </span>
                <div className="flex gap-1">
                  <button type="button" onClick={refreshPrinterMargins} className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-200">
                    {lang === 'fa' ? 'به‌روزرسانی' : 'Refresh'}
                  </button>
                  <button type="button" disabled={printerMargins.status !== 'available'} onClick={resetMarginsToPrinter}
                    className="rounded border border-emerald-600/50 bg-emerald-600/15 px-2 py-1 text-emerald-300 disabled:opacity-40">
                    {lang === 'fa' ? 'اعمال حاشیه درایور' : 'Use driver margins'}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-slate-300">
                <span>{lang === 'fa' ? 'حاشیه‌های چهارگانه شیت (mm):' : 'Sheet Margins (mm):'}</span>
                {(['top', 'right', 'bottom', 'left'] as const).map((side) => {
                  const activePrinterObj = printers.find((p) => p.name === selectedPrinterName);
                  const minSide = Math.max(0, resolvePrinterMinMargins(printerMargins, activePrinterObj)?.[side] ?? 0);
                  return (
                    <label key={side} className="flex items-center gap-1" title={minSide > 0 ? (lang === 'fa' ? `حداقل پرینتر: ${minSide} mm` : `Printer min: ${minSide} mm`) : undefined}>
                      <span className="uppercase text-[10px] text-slate-400">{side}:</span>
                      <input
                        type="number"
                        min={minSide}
                        max={Math.max(minSide, 60)}
                        step={layout.booklet?.enabled ? 0.5 : 1}
                        value={Math.max(minSide, layout.marginsMm[side])}
                        onChange={(e) =>
                          updateMargins({ [side]: Math.max(minSide, Number(e.target.value) || 0) })
                        }
                        className="w-12 rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-center text-white"
                      />
                    </label>
                  );
                })}
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
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setModalState('print', true)}
                className="flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2 font-bold text-white hover:bg-sky-500 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Printer className="h-4 w-4" />
                <span>
                  {lang === 'fa'
                    ? 'پنجره تنظیمات کامل چاپ (Print Dialog)'
                    : 'Open Full Print Dialog'}
                </span>
              </button>
              <button
                type="button"
                disabled={!selectedPrinterName}
                onClick={() => void openPrinterPreferences(selectedPrinterName)}
                className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600/15 px-3.5 py-2 font-semibold text-emerald-300 hover:bg-emerald-600/25 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                {lang === 'fa' ? 'تنظیمات درایور ویندوز و همگام‌سازی شیت' : 'Windows Driver Preferences'}
              </button>
              {selectedPrinter && (
                <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-1.5 text-[11px] text-slate-300 tabular-nums">
                  <span className="font-bold text-sky-300">{selectedPrinter.activeProfile.paperName || selectedPrinter.activeProfile.paperSize}</span>
                  <span>({Math.round(sheetDims.widthMm)}×{Math.round(sheetDims.heightMm)} mm)</span>
                  <span className="text-slate-600">|</span>
                  <span>{lang === 'fa' ? 'سینی:' : 'Tray:'} <strong className="text-slate-100">{selectedPrinter.activeProfile.tray}</strong></span>
                  <span className="text-slate-600">|</span>
                  <span>{selectedPrinter.activeProfile.dpi} DPI</span>
                  <span className="text-slate-600">|</span>
                  <span>{selectedPrinter.activeProfile.duplexMode}</span>
                </div>
              )}
              <span className="text-xs text-slate-400">
                {lang === 'fa'
                  ? 'پنل کامل امکانات سخت‌افزاری، درایور و صف Spooler در پایین باز شده است.'
                  : 'Full Hardware & Driver Capabilities Inspector and Spooler Queue are open below.'}
              </span>
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
                  checked={snapEnabled}
                  onChange={(e) => setSnapEnabled(e.target.checked)}
                  className="accent-purple-500"
                />
                <Magnet className="h-3.5 w-3.5 text-purple-400" />
                <span>{lang === 'fa' ? 'چسبندگی آهن‌ربایی' : 'Magnetic Snap'}</span>
              </label>

              <label className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smartGuidesEnabled}
                  onChange={(e) => setSmartGuidesEnabled(e.target.checked)}
                  className="accent-purple-500"
                />
                <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                <span>{lang === 'fa' ? 'خطوط راهنمای بنفش' : 'Purple Smart Guides'}</span>
              </label>

              <label
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-slate-200 cursor-pointer"
                title={lang === 'fa'
                  ? 'صفحه‌های PDF را با رندر دوباره در اندازهٔ نمایش نشان می‌دهد تا خط‌های نازک و متن در زوم تار نشوند؛ فقط صفحات دیدنی رندر می‌شوند و کش، محدود است.'
                  : 'Re-renders each PDF page at the size it is displayed, so hairlines and small text stay sharp while zooming. Only visible pages are rendered and the cache is bounded.'}
              >
                <input
                  type="checkbox"
                  data-crisp-preview-toggle
                  checked={settings.previewFidelity === 'crisp'}
                  onChange={(e) => updateSettings({ previewFidelity: e.target.checked ? 'crisp' : 'fast' })}
                  className="accent-emerald-500"
                />
                <VectorSquare className="h-3.5 w-3.5 text-emerald-400" />
                <span>{lang === 'fa' ? 'پیش‌نمایش دقیق وکتور' : 'Crisp vector preview'}</span>
              </label>

              <button
                type="button"
                data-clear-preview-cache
                title={lang === 'fa'
                  ? 'تصویرهای رندرشدهٔ پیش‌نمایش از حافظه پاک می‌شوند؛ صفحات دوباره در زمان لازم رندر می‌شوند.'
                  : 'Frees every preview bitmap held in memory; pages that are looked at again are re-rendered on demand.'}
                onClick={() => clearCrispPreviewCacheNow()}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                {lang === 'fa' ? 'خالی‌کردن کش پیش‌نمایش' : 'Free the preview cache'}
              </button>

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
