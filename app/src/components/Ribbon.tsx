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
  Boxes,
} from 'lucide-react';
import { MatrixSizeFields } from './MatrixSizeFields';
import { AutoPackPanel } from './AutoPackPanel';
import { SegmentedControl } from './SegmentedControl';
import { CrossMarginWidget } from './CrossMarginWidget';
import { SettingsPresetMenu } from './SettingsPresets';
import { MarginPresetsMenu } from './MarginPresetsMenu';
import { ShapePicker } from './ShapeControlPanel';
import { useAppStore, type RibbonTabId } from '../store/useAppStore';
import { resolvePrinterMinMargins } from '../engine/sheetInteraction';
import { getSheetDimensionsMm } from '../engine/layoutEngine';
import { t } from '../i18n/translations';
import { formatLocalizedNumber } from '../i18n/shamsi';
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
    pageNumbering,
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
    updatePageNumbering,
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
    setAppMode,
  } = useAppStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const lang = settings.language;
  const tr = t(lang);
  const selectedPrinter = printers.find((printer) => printer.name === selectedPrinterName);
  const sheetDims = getSheetDimensionsMm(layout);
  const marginMinimums = resolvePrinterMinMargins(printerMargins, selectedPrinter) ?? {
    top: 0, right: 0, bottom: 0, left: 0,
  };
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
      ? "psp-tool-panel-ribbon flex h-full min-h-0 min-w-0 flex-col bg-slate-50/70 text-slate-800 dark:bg-slate-900/90 dark:text-slate-100 select-none"
      : "shrink-0 border-b border-slate-200 bg-white text-slate-800 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-100 select-none"
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
        <div className="flex items-center justify-between border-b border-slate-200 px-3 pt-1 dark:border-slate-800/80">
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
                      ? 'border-t-2 border-sky-500 bg-sky-50 text-sky-700 dark:bg-slate-800 dark:text-sky-400'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.icon}
                  <span className="sr-only">{tab.label}</span>
                  {tab.id === 'effects' && effects.invert && (
                    <span className="h-2 w-2 rounded-full bg-fuchsia-500 dark:bg-fuchsia-400" />
                  )}
                  {tab.id === 'batch' && (
                    <span className="rounded-full bg-sky-100 px-1.5 text-[10px] text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
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
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
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
              <div className="flex items-center gap-2 border-e border-slate-200 pe-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title={lang === 'fa' ? 'افزودن فایل PDF / عکس' : 'Add PDF / Images'}
                  className="flex flex-col items-center gap-1 rounded-xl border border-sky-300 bg-sky-50 px-3.5 py-2 text-sky-700 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-600/20 dark:text-sky-300 dark:hover:bg-sky-600/30 cursor-pointer"
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
                  className="flex flex-col items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                >
                  <Copy className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <span className="sr-only">{tr.sidebar.insertBlank}</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void exportMergedOrImposedPdf(false)}
                  title={lang === 'fa' ? 'ذخیره خروجی PDF' : 'Export Final PDF'}
                  className="flex flex-col items-center gap-1 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-600/15 dark:text-emerald-300 dark:hover:bg-emerald-600/25 cursor-pointer"
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
                  className="flex flex-col items-center gap-1 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-rose-700 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20 cursor-pointer"
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

              <AutoPackPanel compact={!panelMode} />

              {/* Group D2: Compact placement controls */}
              <div className="flex min-w-0 flex-col gap-2 border-e border-slate-200 pe-3 dark:border-slate-800">
                <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                  {lang === 'fa' ? 'حالت چیدمان خانه‌ها' : 'Cell placement'}
                </span>
                <SegmentedControl
                  ariaLabel={lang === 'fa' ? 'حالت چیدمان خانه‌ها' : 'Cell placement mode'}
                  value={layout.placementMode}
                  onChange={(placementMode) => updateLayout({ placementMode })}
                  options={[
                    { value: 'sequential', label: lang === 'fa' ? 'ترتیبی' : 'Sequential', icon: <FileStack className="h-3.5 w-3.5" /> },
                    { value: 'step-and-repeat', label: lang === 'fa' ? 'تکرار' : 'Repeat', icon: <Copy className="h-3.5 w-3.5" /> },
                  ]}
                />
                <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={layout.uniqueScale}
                    onChange={(e) => updateLayout({ uniqueScale: e.target.checked })}
                    className="accent-sky-500"
                  />
                  <span>{lang === 'fa' ? 'مقیاس مستقل برای هر خانه' : 'Unique scale per cell'}</span>
                </label>
              </div>

              {/* Group D4: Paper Size & Orientation */}
              <div className="flex flex-col gap-1 border-e border-slate-200 pe-3 dark:border-slate-800">
                <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                  {lang === 'fa' ? 'سایز کاغذ و جهت (D4)' : 'Paper Size & Orientation'}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
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
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 tabular-nums"
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
                  <span className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[10px] font-mono text-sky-700 dark:border-slate-700/80 dark:bg-slate-950/70 dark:text-sky-300 tabular-nums whitespace-nowrap">
                    {Math.round(sheetDims.widthMm)}×{Math.round(sheetDims.heightMm)} mm
                  </span>
                  {layout.paperSize === 'Custom' && (['customWidthMm', 'customHeightMm'] as const).map((field) => (
                    <label key={field} className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
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
                        className="w-16 rounded border border-slate-300 bg-white px-1 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white tabular-nums" />
                    </label>
                  ))}

                  <SegmentedControl
                    ariaLabel={lang === 'fa' ? 'جهت کاغذ' : 'Paper orientation'}
                    value={layout.orientation}
                    onChange={(nextOrientation: PageOrientation) => {
                      updateLayout({ orientation: nextOrientation });
                      if (selectedPrinter) {
                        void updatePrinterProfile(selectedPrinter.name, { orientation: nextOrientation });
                      }
                    }}
                    options={[
                      { value: 'portrait', label: lang === 'fa' ? 'عمودی' : 'Portrait', icon: <FileStack className="h-3.5 w-3.5" /> },
                      { value: 'landscape', label: lang === 'fa' ? 'افقی' : 'Landscape', icon: <RotateCw className="h-3.5 w-3.5" /> },
                    ]}
                  />
                </div>
              </div>

              {/* Group D3: Cross margins, gutters and scale */}
              <div className="flex min-w-0 flex-col gap-2 border-e border-slate-200 pe-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                    {lang === 'fa' ? 'حاشیه و فاصله‌ها' : 'Margins & gutters'}
                  </span>
                  <MarginPresetsMenu compact />
                </div>
                <CrossMarginWidget
                  language={lang}
                  margins={layout.marginsMm}
                  minimums={marginMinimums}
                  step={layout.booklet?.enabled ? 0.5 : 1}
                  horizontalGutterMm={layout.booklet?.enabled ? layout.booklet.spineWidthMm : layout.horizontalGutterMm}
                  verticalGutterMm={layout.booklet?.enabled ? 0 : layout.verticalGutterMm}
                  bookletEnabled={!!layout.booklet?.enabled}
                  onMarginChange={(side, value) => {
                    updateMargins({ [side]: Math.max(marginMinimums[side], Math.min(200, value)) });
                  }}
                  onGutterChange={(field, value) => {
                    if (layout.booklet?.enabled && field === 'horizontalGutterMm') {
                      updateLayout({ booklet: { ...layout.booklet, spineWidthMm: Math.min(30, value) } });
                    } else {
                      updateLayout({ [field]: value });
                    }
                  }}
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                    {lang === 'fa' ? 'مقیاس محتوا' : 'Content scale'}
                  </span>
                  <SegmentedControl
                    ariaLabel={lang === 'fa' ? 'حالت مقیاس محتوا' : 'Content scale mode'}
                    value={layout.scaleMode}
                    onChange={(scaleMode: ScaleMode) => updateLayout({ scaleMode })}
                    options={[
                      { value: 'fit', label: lang === 'fa' ? 'جاگیری' : 'Fit', icon: <Maximize2 className="h-3.5 w-3.5" /> },
                      { value: 'fill', label: lang === 'fa' ? 'پرکردن' : 'Fill', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
                      { value: 'original', label: '100%' },
                      { value: 'custom', label: lang === 'fa' ? 'دلخواه' : 'Custom' },
                    ]}
                  />
                  {layout.scaleMode === 'custom' && (
                    <label className="flex items-center gap-2 text-[10px] text-slate-700 dark:text-slate-300">
                      <span>%</span>
                      <input
                        type="number"
                        min={10}
                        max={400}
                        aria-label={lang === 'fa' ? 'درصد مقیاس دلخواه' : 'Custom scale percentage'}
                        value={layout.customScalePercent}
                        onChange={(e) => updateLayout({ customScalePercent: Math.max(10, Math.min(400, Number(e.target.value) || 10)) })}
                        className="w-16 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Group D5: Duplex & sheet order */}
              <div className="flex min-w-0 flex-col gap-2">
                <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                  {lang === 'fa' ? 'چاپ دورو و ترتیب چیدمان' : 'Duplex & sheet order'}
                </span>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <SegmentedControl
                    ariaLabel={lang === 'fa' ? 'دکمه‌های حالت چاپ دورو' : 'Duplex mode buttons'}
                    value={layout.duplexMode}
                    onChange={(duplexMode: DuplexMode) => updateLayout({ duplexMode })}
                    options={[
                      { value: 'none', label: lang === 'fa' ? 'تک‌رو' : 'Simplex' },
                      { value: 'long-edge', label: lang === 'fa' ? 'لبه بلند' : 'Long edge', icon: <FlipHorizontal2 className="h-3.5 w-3.5" /> },
                      { value: 'short-edge', label: lang === 'fa' ? 'لبه کوتاه' : 'Short edge', icon: <RotateCw className="h-3.5 w-3.5" /> },
                    ]}
                  />
                  <select
                    aria-label="حالت چاپ دورو شیت"
                    aria-hidden="true"
                    tabIndex={-1}
                    value={layout.duplexMode}
                    onChange={(e) => updateLayout({ duplexMode: e.target.value as DuplexMode })}
                    className="sr-only"
                  >
                    <option value="none">Simplex</option>
                    <option value="long-edge">Long edge</option>
                    <option value="short-edge">Short edge</option>
                  </select>
                  <SegmentedControl
                    ariaLabel={lang === 'fa' ? 'ترتیب چیدمان برگه' : 'Sheet reading order'}
                    value={layout.sheetOrder}
                    onChange={(sheetOrder: SheetOrderMode) => updateLayout({ sheetOrder })}
                    options={[
                      { value: 'rtl', label: lang === 'fa' ? 'راست‌به‌چپ' : 'RTL' },
                      { value: 'ltr', label: lang === 'fa' ? 'چپ‌به‌راست' : 'LTR' },
                      { value: 'column', label: lang === 'fa' ? 'ستونی' : 'Column', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
                      { value: 'spiral', label: lang === 'fa' ? 'مارپیچی' : 'Spiral', icon: <RefreshCw className="h-3.5 w-3.5" /> },
                    ]}
                  />
                  <button
                    type="button"
                    onClick={() => setModalState('manualDuplex', true)}
                    className="flex items-center justify-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25 cursor-pointer"
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
              <div className="flex items-center gap-2 border-e border-slate-200 pe-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={toggleGlobalInvert}
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-4 py-2.5 font-bold transition cursor-pointer ${
                    effects.invert
                      ? 'border-fuchsia-400 bg-fuchsia-600 text-white shadow-lg shadow-fuchsia-600/30'
                      : 'border-slate-300 bg-white text-slate-800 hover:border-fuchsia-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-fuchsia-500/50'
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
              <div className="flex flex-wrap items-center gap-2 border-e border-slate-200 pe-4 dark:border-slate-800">
                <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 cursor-pointer">
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

                <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 cursor-pointer">
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
                    <span className="w-8 font-mono text-[11px] text-sky-700 dark:text-sky-300">
                      {effects.threshold}
                    </span>
                  </div>
                )}

                <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 cursor-pointer">
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

              {/* E2: compact icon-led brightness, contrast and gamma sliders */}
              <div data-icon-effect-sliders className="flex min-w-0 flex-col gap-2 border-e border-slate-200 pe-3 dark:border-slate-800">
                <label className="flex min-w-0 items-center gap-2 text-[10px] text-slate-700 dark:text-slate-300">
                  <SunMedium className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-300" aria-hidden="true" />
                  <span className="w-16 shrink-0">{lang === 'fa' ? 'روشنایی' : 'Brightness'}</span>
                  <input
                    aria-label={lang === 'fa' ? 'روشنایی' : 'Brightness'}
                    type="range" min={-60} max={60} value={effects.brightness}
                    onChange={(e) => updateEffects({ brightness: Number(e.target.value) })}
                    className="min-w-0 flex-1 accent-sky-500"
                  />
                  <output className="w-8 shrink-0 text-end font-mono tabular-nums text-sky-700 dark:text-sky-300">{effects.brightness}</output>
                </label>
                <label className="flex min-w-0 items-center gap-2 text-[10px] text-slate-700 dark:text-slate-300">
                  <Contrast className="h-4 w-4 shrink-0 text-violet-500 dark:text-violet-300" aria-hidden="true" />
                  <span className="w-16 shrink-0">{lang === 'fa' ? 'کنتراست' : 'Contrast'}</span>
                  <input
                    aria-label={lang === 'fa' ? 'کنتراست' : 'Contrast'}
                    type="range" min={-60} max={80} value={effects.contrast}
                    onChange={(e) => updateEffects({ contrast: Number(e.target.value) })}
                    className="min-w-0 flex-1 accent-sky-500"
                  />
                  <output className="w-8 shrink-0 text-end font-mono tabular-nums text-sky-700 dark:text-sky-300">{effects.contrast}</output>
                </label>
                <label className="flex min-w-0 items-center gap-2 text-[10px] text-slate-700 dark:text-slate-300">
                  <Droplets className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-300" aria-hidden="true" />
                  <span className="w-16 shrink-0">{lang === 'fa' ? 'گاما' : 'Gamma'}</span>
                  <input
                    aria-label={lang === 'fa' ? 'گاما' : 'Gamma'}
                    type="range" min={0.4} max={2.4} step={0.1} value={effects.gamma}
                    onChange={(e) => updateEffects({ gamma: Number(e.target.value) })}
                    className="min-w-0 flex-1 accent-sky-500"
                  />
                  <output className="w-8 shrink-0 text-end font-mono tabular-nums text-sky-700 dark:text-sky-300">{effects.gamma.toFixed(1)}</output>
                </label>
              </div>

              {/* Scope & Reset */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={lang === 'fa' ? 'دامنه افکت‌ها' : 'Effects scope'}
                  value={effects.scope}
                  onChange={(e) =>
                    updateEffects({ scope: e.target.value as 'all' | 'selected' })
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="all">
                    {lang === 'fa' ? 'اعمال روی کل سند' : 'Apply to Entire Document'}
                  </option>
                  <option value="selected">
                    {lang === 'fa' ? 'فقط صفحات انتخاب‌شده' : 'Selected Pages Only'}
                  </option>
                </select>
                {effects.scope === 'selected' && (() => {
                  const targetSet = new Set(
                    effects.targetPageIds !== undefined
                      ? effects.targetPageIds
                      : pages.filter((p) => p.isHighlighted).map((p) => p.id)
                  );
                  const targetNumbers = pages
                    .map((p, idx) => (targetSet.has(p.id) ? idx + 1 : -1))
                    .filter((n) => n > 0);
                  const highlightedIds = pages.filter((p) => p.isHighlighted).map((p) => p.id);
                  return (
                    <div className="flex flex-wrap items-center gap-1.5" data-effects-targets>
                      <span className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200">
                        {targetNumbers.length > 0
                          ? (lang === 'fa'
                              ? `صفحات هدف: ${targetNumbers.map((n) => `#${formatLocalizedNumber(n, lang)}`).join('، ')}`
                              : `Targets: ${targetNumbers.map((n) => `#${n}`).join(', ')}`)
                          : (lang === 'fa' ? 'هیچ صفحه‌ای هدف نیست' : 'No target pages')}
                      </span>
                      <button
                        type="button"
                        data-effects-retarget
                        disabled={highlightedIds.length === 0}
                        onClick={() => updateEffects({ targetPageIds: highlightedIds }, true)}
                        className="rounded-lg border border-sky-300 bg-white px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-40 dark:border-sky-700 dark:bg-slate-800 dark:text-sky-300 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        {lang === 'fa' ? 'اعمال روی انتخاب فعلی' : 'Use selected thumbnails'}
                      </button>
                    </div>
                  );
                })()}
                {effects.invert && (
                  <select
                    aria-label={lang === 'fa' ? 'روش خروجی PDF برای معکوس رنگ' : 'PDF invert method'}
                    value={effects.invertPdfStrategy}
                    onChange={(e) =>
                      updateEffects({ invertPdfStrategy: e.target.value as 'vector-blend' | 'raster' }, true)
                    }
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="vector-blend">
                      {lang === 'fa' ? 'PDF: برداری (Vector)' : 'PDF: Vector Blend'}
                    </option>
                    <option value="raster">
                      {lang === 'fa' ? 'PDF: تصویری (Raster 300 DPI)' : 'PDF: Raster Bake'}
                    </option>
                  </select>
                )}
                <button
                  type="button"
                  onClick={resetEffects}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
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
                onClick={addTextOverlay} className="flex items-center gap-1 rounded-lg border border-sky-500 bg-sky-600 px-3 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-40 cursor-pointer">
                <Type className="h-4 w-4" aria-hidden="true" />{lang==='fa'?'افزودن متن':'Add text'}
              </button>
              {/* Shapes: one click per outline, and the settings panel opens on what was inserted. */}
              <div className="flex items-center gap-1 border-e border-slate-200 pe-3 dark:border-slate-800">
                <ShapePicker onPick={(type) => { addShapeOverlay(type); }} />
              </div>
              <div className="flex flex-wrap items-center gap-1 border-e border-slate-200 pe-3 dark:border-slate-800" data-erase-tools>
                <button type="button" data-erase-tool="brush" aria-pressed={eraseTool === 'brush'}
                  onClick={() => setEraseTool(eraseTool === 'brush' ? 'off' : 'brush')}
                  title={lang === 'fa' ? 'با قلم‌مو روی صفحه PDF یا تصویر بکشید تا همان قسمت پاک شود' : 'Drag a brush over a PDF page or picture to erase that area'}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold cursor-pointer ${eraseTool === 'brush' ? 'bg-rose-600 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:border-rose-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-rose-500/50'}`}>
                  <Eraser className="h-4 w-4" aria-hidden="true" />
                  <span>{lang === 'fa' ? 'پاک‌کن: قلم‌مو' : 'Eraser: brush'}</span>
                </button>
                <button type="button" data-erase-tool="region" aria-pressed={eraseTool === 'region'}
                  onClick={() => setEraseTool(eraseTool === 'region' ? 'off' : 'region')}
                  title={lang === 'fa' ? 'روی صفحه PDF یا تصویر کادر بکشید؛ با Delete داخل آن پاک می‌شود' : 'Drag a rectangle on a PDF page or picture, then press Delete'}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold cursor-pointer ${eraseTool === 'region' ? 'bg-rose-600 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:border-rose-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-rose-500/50'}`}>
                  <SquareDashedMousePointer className="h-4 w-4" aria-hidden="true" />
                  <span>{lang === 'fa' ? 'پاک‌کن: ناحیه' : 'Eraser: region'}</span>
                </button>
                <button type="button" data-erase-tool="picker" aria-pressed={eraseTool === 'picker'}
                  onClick={() => setEraseTool(eraseTool === 'picker' ? 'off' : 'picker')}
                  title={lang === 'fa' ? 'روی صفحه PDF یا تصویر کلیک کنید تا رنگ همان نقطه قلم‌مو شود' : 'Click a PDF page or picture to pick its colour for the brush'}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold cursor-pointer ${eraseTool === 'picker' ? 'bg-amber-500 text-slate-950' : 'border border-slate-300 bg-white text-slate-700 hover:border-amber-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-amber-400/60'}`}>
                  <Pipette className="h-4 w-4" aria-hidden="true" />
                  <span>{lang === 'fa' ? 'قطره‌چکان' : 'Eyedropper'}</span>
                </button>
                {eraseTool !== 'off' && (
                  <label className="flex items-center gap-1 text-[10px] text-slate-700 dark:text-slate-300">
                    <span>{lang === 'fa' ? 'قطر (mm)' : 'Ø (mm)'}</span>
                    <input data-erase-size aria-label={lang === 'fa' ? 'قطر پاک‌کن بر حسب میلی‌متر' : 'Eraser diameter in millimetres'}
                      type="number" min="0.2" max="500" step="0.1" value={Number(eraseBrushMm.toFixed(2))}
                      onChange={(e) => setEraseBrushMm(Number(e.target.value))}
                      className="w-16 rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white" />
                  </label>
                )}
                {eraseTool !== 'off' && (
                  <label className="flex items-center gap-1 text-[10px] text-slate-700 dark:text-slate-300" title={lang === 'fa'
                    ? 'اگر رنگی انتخاب شود، قلم‌مو آن رنگ را می‌گذارد نه اینکه سوراخ کند'
                    : 'A colour makes the brush lay that colour down instead of cutting a hole'}>
                    <span>{lang === 'fa' ? 'رنگ' : 'Colour'}</span>
                    <input data-erase-color type="color" aria-label={lang === 'fa' ? 'رنگ قلم‌مو' : 'Brush colour'} value={eraseColor ?? '#ffffff'}
                      onChange={(e) => setEraseColor(e.target.value)}
                      className="h-6 w-8 cursor-pointer rounded border border-slate-300 bg-white p-0.5 dark:border-slate-600 dark:bg-slate-800" />
                    <button type="button" data-erase-color="hole" onClick={() => setEraseColor(null)}
                      className={`rounded px-1.5 py-0.5 cursor-pointer ${!eraseColor ? 'bg-rose-600 text-white' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}`}>
                      {lang === 'fa' ? 'بدون رنگ' : 'No colour'}
                    </button>
                  </label>
                )}
              </div>
              
              <button type="button" data-watermark-panel-trigger aria-pressed={watermark.enabled}
                onClick={onOpenWatermarkPanel}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 font-semibold transition-colors cursor-pointer ${watermark.enabled ? 'border-sky-400 bg-sky-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'}`}>
                <Droplets className="h-4 w-4" />
                {lang === 'fa' ? 'واترمارک' : 'Watermark'}
              </button>

              <button type="button" data-booklet-panel-trigger aria-pressed={!!layout.booklet?.enabled}
                onClick={onOpenBookletPanel}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 font-semibold transition-colors cursor-pointer ${layout.booklet?.enabled ? 'border-amber-400 bg-amber-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'}`}>
                <FileStack className="h-4 w-4" />
                {lang === 'fa' ? 'بوکلت' : 'Booklet'}
              </button>

              <div className="flex items-center gap-2">
                <button type="button" disabled={!pages.length} onClick={()=>imageInputRef.current?.click()} aria-label={lang==='fa'?'افزودن تصویر روی صفحه':'Add picture on the page'} className="rounded-lg border border-sky-500 bg-sky-600 px-3 py-2 font-semibold text-white hover:bg-sky-500 disabled:opacity-40 cursor-pointer">{lang==='fa'?'افزودن تصویر':'Add picture'}</button>
                <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e=>{const files=e.target.files?Array.from(e.target.files):[];if(files.length)void addImageOverlayFiles(files);e.target.value='';}}/>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{lang==='fa'?'یا فایل تصویر را مستقیم روی برگه در پیش‌نمایش رها کنید.' : 'Or drop an image file straight onto a sheet in the preview.'}</span>
              </div>
              <button type="button" disabled={!pages.length} onClick={()=>addNumberingOverlay()} aria-label={lang==='fa'?'افزودن شماره صفحه قابل ویرایش':'Add editable page number'} className="rounded-lg border border-emerald-500 bg-emerald-600 px-3 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 cursor-pointer">{lang==='fa'?'افزودن شماره صفحه':'Add page number'}</button>
              <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  aria-label={lang === 'fa' ? 'شماره‌گذاری قدیمی (خروجی ثابت)' : 'Legacy numbering (fixed output only)'}
                  checked={pageNumbering.enabled}
                  onChange={(e) => updatePageNumbering({ enabled: e.target.checked })}
                  className="accent-sky-500"
                />
                <span>{lang === 'fa' ? 'شماره قدیمی (Page / Bates)' : 'Page / Bates'}</span>
              </label>
              {pageNumbering.enabled && (
                <button
                  type="button"
                  disabled={!pages.length}
                  onClick={() => addNumberingOverlay(true)}
                  className="rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-1.5 font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-40 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300 cursor-pointer"
                >
                  {lang === 'fa' ? 'تبدیل شماره‌گذاری قدیمی به قابل ویرایش' : 'Convert legacy numbering to editable'}
                </button>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400">{lang === 'fa' ? 'شماره قابل ویرایش را روی صفحه بکشید و برای زوج/فرد و فرمول از پنل استفاده کنید.' : 'Drag the editable number on the page; use the panel for odd/even scopes and formulas.'}</p>

            </>
          )}

          {/* 5. CROP BOX & MARKS TAB */}
          {activeRibbonTab === 'crop' && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
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

              <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
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

              <div className="flex flex-col gap-1 border-e border-slate-200 pe-3 text-[11px] dark:border-slate-800">
                <span className="font-semibold text-slate-700 dark:text-slate-300">{lang === 'fa' ? 'حاشیه واقعی پرینتر' : 'Driver imageable margins'}</span>
                <span className={printerMargins.status === 'available' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>
                  {printerMargins.status === 'available'
                    ? (lang === 'fa'
                      ? `بالا ${printerMargins.marginsMm.top} · راست ${printerMargins.marginsMm.right} · پایین ${printerMargins.marginsMm.bottom} · چپ ${printerMargins.marginsMm.left} میلی‌متر`
                      : `T ${printerMargins.marginsMm.top} · R ${printerMargins.marginsMm.right} · B ${printerMargins.marginsMm.bottom} · L ${printerMargins.marginsMm.left} mm`)
                    : (printerMargins.status === 'loading'
                      ? (lang === 'fa' ? 'در حال دریافت از درایور...' : 'Reading driver...')
                      : (lang === 'fa' ? 'اطلاعات محدوده چاپ در دسترس نیست' : 'Driver imageable area unavailable'))}
                </span>
                <div className="flex gap-1">
                  <button type="button" onClick={refreshPrinterMargins} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer">
                    {lang === 'fa' ? 'به‌روزرسانی' : 'Refresh'}
                  </button>
                  <button type="button" disabled={printerMargins.status !== 'available'} onClick={resetMarginsToPrinter}
                    className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 dark:border-emerald-600/50 dark:bg-emerald-600/15 dark:text-emerald-300 cursor-pointer">
                    {lang === 'fa' ? 'اعمال حاشیه درایور' : 'Use driver margins'}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300">
                <span>{lang === 'fa' ? 'حاشیه‌های چهارگانه شیت (mm):' : 'Sheet Margins (mm):'}</span>
                {(['top', 'right', 'bottom', 'left'] as const).map((side) => {
                  const activePrinterObj = printers.find((p) => p.name === selectedPrinterName);
                  const minSide = Math.max(0, resolvePrinterMinMargins(printerMargins, activePrinterObj)?.[side] ?? 0);
                  return (
                    <label key={side} className="flex items-center gap-1" title={minSide > 0 ? (lang === 'fa' ? `حداقل پرینتر: ${minSide} mm` : `Printer min: ${minSide} mm`) : undefined}>
                      <span className="uppercase text-[10px] text-slate-500 dark:text-slate-400">{side}:</span>
                      <input
                        type="number"
                        min={minSide}
                        max={Math.max(minSide, 60)}
                        step={layout.booklet?.enabled ? 0.5 : 1}
                        value={Math.max(minSide, layout.marginsMm[side])}
                        onChange={(e) =>
                          updateMargins({ [side]: Math.max(minSide, Number(e.target.value) || 0) })
                        }
                        className="w-12 rounded border border-slate-300 bg-white px-1.5 py-1 text-center text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* 6. PDF MERGE & SPLIT TAB (C1 - C2, A4) */}
          {activeRibbonTab === 'pdf' && (
            <div className="flex flex-wrap items-center gap-3">
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
                className="flex items-center gap-2 rounded-xl border border-sky-300 bg-sky-50 px-3.5 py-2 font-semibold text-sky-700 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-300 dark:hover:bg-sky-500/25 cursor-pointer"
              >
                <Scissors className="h-4 w-4" />
                <span>{tr.sidebar.extractPdf}</span>
              </button>

              <button
                type="button"
                onClick={() => setModalState('split', true)}
                className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25 cursor-pointer"
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
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                <RotateCw className="h-4 w-4" />
                <span>{tr.sidebar.reverseOrder}</span>
              </button>
            </div>
          )}

          {/* 7. BATCH PRINT TAB (H1 - H2) */}
          {activeRibbonTab === 'batch' && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-ribbon-open-batch
                onClick={() => setAppMode('batch')}
                className="flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 font-bold text-white shadow-xs hover:bg-indigo-500 cursor-pointer"
              >
                <Boxes className="h-4 w-4" />
                <span>
                  {lang === 'fa'
                    ? 'باز کردن محیط مجزای چاپ دسته‌ای (Batch Print)'
                    : 'Open Standalone Batch Print Workspace'}
                </span>
              </button>

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
                className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
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
                className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-500/40 dark:bg-emerald-600/15 dark:text-emerald-300 dark:hover:bg-emerald-600/25 cursor-pointer whitespace-nowrap shrink-0"
              >
                {lang === 'fa' ? 'تنظیمات درایور ویندوز و همگام‌سازی شیت' : 'Windows Driver Preferences'}
              </button>
              {selectedPrinter && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300 tabular-nums">
                  <span className="font-bold text-sky-700 dark:text-sky-300">{selectedPrinter.activeProfile.paperName || selectedPrinter.activeProfile.paperSize}</span>
                  <span>({Math.round(sheetDims.widthMm)}×{Math.round(sheetDims.heightMm)} mm)</span>
                  <span className="text-slate-300 dark:text-slate-600">|</span>
                  <span>{lang === 'fa' ? 'سینی:' : 'Tray:'} <strong className="text-slate-900 dark:text-slate-100">{selectedPrinter.activeProfile.tray}</strong></span>
                  <span className="text-slate-300 dark:text-slate-600">|</span>
                  <span>{selectedPrinter.activeProfile.dpi} DPI</span>
                  <span className="text-slate-300 dark:text-slate-600">|</span>
                  <span>{selectedPrinter.activeProfile.duplexMode}</span>
                </div>
              )}
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'fa'
                  ? 'پنل کامل امکانات سخت‌افزاری، درایور و صف Spooler در پایین باز شده است.'
                  : 'Full Hardware & Driver Capabilities Inspector and Spooler Queue are open below.'}
              </span>
            </div>
          )}

          {/* 9. VIEW TAB (J1) */}
          {activeRibbonTab === 'view' && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-950">
                {(['single', 'continuous', 'double', 'grid'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setViewMode(m)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                      viewMode === m
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
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

              <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showRulers}
                  onChange={(e) => setShowRulers(e.target.checked)}
                  className="accent-sky-500"
                />
                <Ruler className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                <span>{lang === 'fa' ? 'نمایش خط‌کش دقیق' : 'Rulers'}</span>
              </label>

              <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={snapEnabled}
                  onChange={(e) => setSnapEnabled(e.target.checked)}
                  className="accent-purple-500"
                />
                <Magnet className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                <span>{lang === 'fa' ? 'چسبندگی آهن‌ربایی' : 'Magnetic Snap'}</span>
              </label>

              <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smartGuidesEnabled}
                  onChange={(e) => setSmartGuidesEnabled(e.target.checked)}
                  className="accent-purple-500"
                />
                <Sparkles className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                <span>{lang === 'fa' ? 'خطوط راهنمای بنفش' : 'Purple Smart Guides'}</span>
              </label>

              <label
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
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
                <VectorSquare className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{lang === 'fa' ? 'پیش‌نمایش دقیق وکتور' : 'Crisp vector preview'}</span>
              </label>

              <button
                type="button"
                data-clear-preview-cache
                title={lang === 'fa'
                  ? 'تصویرهای رندرشدهٔ پیش‌نمایش از حافظه پاک می‌شوند؛ صفحات دوباره در زمان لازم رندر می‌شوند.'
                  : 'Frees every preview bitmap held in memory; pages that are looked at again are re-rendered on demand.'}
                onClick={() => clearCrispPreviewCacheNow()}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
              >
                {lang === 'fa' ? 'خالی‌کردن کش پیش‌نمایش' : 'Free the preview cache'}
              </button>

              <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={loupeEnabled}
                  onChange={(e) => setLoupeEnabled(e.target.checked)}
                  className="accent-sky-500"
                />
                <Search className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span>{tr.preview.loupeMode}</span>
              </label>

              <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={transparentMode}
                  onChange={(e) => setTransparentMode(e.target.checked)}
                  className="accent-sky-500"
                />
                <SunMedium className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{tr.preview.transparentMode}</span>
              </label>


            </div>
          )}
        </div>
      )}
    </section>
  );
};
