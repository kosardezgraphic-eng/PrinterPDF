import React, { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  BookOpen,
  FileText,
  Layers,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  STANDARD_PAPER_SIZES,
  type BookletSettings,
  type DuplexMode,
  type LayoutSettings,
  type MarginsMm,
  type PageOrientation,
  type PaperSizeId,
  type ScaleMode,
  type SheetOrderMode,
} from '@shared/models';
import { useAppStore } from '../store/useAppStore';
import {
  buildMarginPresets,
  formatMarginValue,
  marginsRoughlyEqual,
} from '../engine/marginPresets';
import {
  getDuplexFlipAxis,
  getEffectiveSideMarginsMm,
  getSheetDimensionsMm,
} from '../engine/layoutEngine';
import { clampMarginsToMin, resolvePrinterMinMargins } from '../engine/sheetInteraction';

const DEFAULT_BOOKLET: BookletSettings = {
  enabled: false,
  direction: 'rtl',
  signatureSize: 0,
  spineWidthMm: 4,
  creepMm: 0.2,
  duplexMode: 'short-edge',
  outerMarginMm: 10,
  compensateCreep: true,
};

export const PageSetupModal: React.FC = () => {
  const showPageSetupModal = useAppStore((s) => s.showPageSetupModal);
  const pageSetupInitialTab = useAppStore((s) => s.pageSetupInitialTab);
  const layout = useAppStore((s) => s.layout);
  const settings = useAppStore((s) => s.settings);
  const printers = useAppStore((s) => s.printers);
  const selectedPrinterName = useAppStore((s) => s.selectedPrinterName);
  const printerMargins = useAppStore((s) => s.printerMargins);
  const lastCustomMarginsMm = useAppStore((s) => s.lastCustomMarginsMm);
  const setModalState = useAppStore((s) => s.setModalState);
  const updateLayout = useAppStore((s) => s.updateLayout);
  const updatePrinterProfile = useAppStore((s) => s.updatePrinterProfile);

  const isFa = settings.language === 'fa';
  const activePrinter = printers.find((p) => p.name === selectedPrinterName);
  const minMargins = resolvePrinterMinMargins(printerMargins, activePrinter);
  const hardwareAvailable = printerMargins.status === 'available' && Boolean(minMargins);

  const [activeTab, setActiveTab] = useState<'margins' | 'paper'>(pageSetupInitialTab);
  const [draft, setDraft] = useState<LayoutSettings>(layout);
  const [selectedDriverPaperName, setSelectedDriverPaperName] = useState<string>(layout.paperSize);
  const [customMarginsEdited, setCustomMarginsEdited] = useState(false);

  const driverPaperOptions = activePrinter?.capabilities.paperOptions?.length
    ? activePrinter.capabilities.paperOptions
    : (activePrinter?.capabilities.supportedPapers?.length
        ? activePrinter.capabilities.supportedPapers
        : (Object.keys(STANDARD_PAPER_SIZES) as PaperSizeId[])
      ).map((id) => {
        const dims =
          id !== 'Custom'
            ? STANDARD_PAPER_SIZES[id]
            : { widthMm: layout.customWidthMm, heightMm: layout.customHeightMm };
        return { id, name: String(id), widthMm: dims.widthMm, heightMm: dims.heightMm };
      });

  useEffect(() => {
    if (!showPageSetupModal) return;
    setActiveTab(pageSetupInitialTab);
    setCustomMarginsEdited(false);
    setDraft({
      ...layout,
      marginsMm: clampMarginsToMin(layout.marginsMm, minMargins),
      booklet: { ...DEFAULT_BOOKLET, ...layout.booklet },
    });
    const activeName = activePrinter?.activeProfile.paperName;
    const matchedByName = activeName
      ? driverPaperOptions.find((o) => o.name.toLowerCase() === activeName.toLowerCase())
      : undefined;
    const matchedById = driverPaperOptions.find((o) => o.id === layout.paperSize);
    setSelectedDriverPaperName(matchedByName?.name ?? matchedById?.name ?? layout.paperSize);
  }, [showPageSetupModal, pageSetupInitialTab]);

  useEffect(() => {
    if (!showPageSetupModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModalState('pageSetup', false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showPageSetupModal, setModalState]);

  if (!showPageSetupModal) return null;

  const booklet = draft.booklet ?? DEFAULT_BOOKLET;
  const presets = buildMarginPresets({
    lastCustomMarginsMm,
    minMargins,
    hardwareAvailable,
  });
  const dims = getSheetDimensionsMm(draft);

  const updateDraftMargin = (side: 'top' | 'right' | 'bottom' | 'left', rawVal: number) => {
    const minSide = Math.max(0, minMargins?.[side] ?? 0);
    const maxSide = Math.max(minSide, 200);
    const clamped = Math.max(minSide, Math.min(maxSide, Number.isFinite(rawVal) ? rawVal : minSide));
    setCustomMarginsEdited(true);
    setDraft((prev) => ({
      ...prev,
      marginMode: 'custom',
      marginsMm: {
        ...prev.marginsMm,
        [side]: Math.round(clamped * 100) / 100,
      },
    }));
  };

  const updateDraftBooklet = (patch: Partial<BookletSettings>) => {
    setDraft((prev) => {
      const nextBooklet: BookletSettings = { ...(prev.booklet ?? DEFAULT_BOOKLET), ...patch };
      const nextDuplex: DuplexMode =
        patch.duplexMode !== undefined
          ? patch.duplexMode
          : patch.enabled && prev.duplexMode === 'none'
            ? nextBooklet.duplexMode
            : prev.duplexMode;
      return {
        ...prev,
        duplexMode: nextDuplex,
        booklet: nextBooklet,
      };
    });
  };

  const handleApply = () => {
    const clampedMargins = clampMarginsToMin(draft.marginsMm, minMargins);
    const nextBooklet: BookletSettings = {
      ...DEFAULT_BOOKLET,
      ...draft.booklet,
      duplexMode:
        draft.duplexMode === 'long-edge' || draft.duplexMode === 'short-edge'
          ? draft.duplexMode
          : draft.booklet?.duplexMode ?? 'short-edge',
    };

    const nextPatch: Partial<LayoutSettings> = {
      paperSize: draft.paperSize,
      customWidthMm: draft.customWidthMm,
      customHeightMm: draft.customHeightMm,
      orientation: draft.orientation,
      rows: draft.rows,
      cols: draft.cols,
      placementMode: draft.placementMode,
      uniqueScale: draft.uniqueScale,
      ...(customMarginsEdited ||
      !marginsRoughlyEqual(clampedMargins, layout.marginsMm) ||
      draft.marginMode !== layout.marginMode
        ? {
            marginsMm: clampedMargins,
            marginMode: draft.marginMode ?? 'custom',
          }
        : {}),
      horizontalGutterMm: draft.horizontalGutterMm,
      verticalGutterMm: draft.verticalGutterMm,
      scaleMode: draft.scaleMode,
      customScalePercent: draft.customScalePercent,
      autoRotateToFit: draft.autoRotateToFit,
      duplexMode: draft.duplexMode,
      sheetOrder: draft.sheetOrder,
      showCellBorders: draft.showCellBorders,
      showCropMarks: draft.showCropMarks,
      booklet: nextBooklet,
    };

    const prevLastCustom = lastCustomMarginsMm;
    updateLayout(nextPatch, true);
    if (!customMarginsEdited) {
      useAppStore.setState({ lastCustomMarginsMm: prevLastCustom });
    }

    if (activePrinter) {
      const matched = driverPaperOptions.find(
        (o) => o.name === selectedDriverPaperName || o.id === draft.paperSize
      );
      const wMm =
        draft.paperSize === 'Custom'
          ? draft.customWidthMm
          : matched
            ? Math.min(matched.widthMm, matched.heightMm)
            : dims.widthMm;
      const hMm =
        draft.paperSize === 'Custom'
          ? draft.customHeightMm
          : matched
            ? Math.max(matched.widthMm, matched.heightMm)
            : dims.heightMm;

      void updatePrinterProfile(activePrinter.name, {
        paperSize: draft.paperSize,
        paperName: draft.paperSize === 'Custom' ? 'Custom' : matched?.name ?? draft.paperSize,
        paperWidthMm: wMm,
        paperHeightMm: hMm,
        orientation: draft.orientation,
        duplexMode: draft.duplexMode,
      });
    }

    setModalState('pageSetup', false);
  };

  // Schematic preview proportions (supports side-by-side Front/Back sheets in Duplex mode)
  const flipAxis = getDuplexFlipAxis(draft);
  const duplexActive = flipAxis !== 'none';
  const bindingDir: 'rtl' | 'ltr' = booklet.enabled
    ? booklet.direction
    : draft.sheetOrder === 'ltr'
      ? 'ltr'
      : 'rtl';
  const frontMargins = getEffectiveSideMarginsMm(draft, 'front');
  const backMargins = getEffectiveSideMarginsMm(draft, 'back');
  const previewMaxW = duplexActive ? 108 : 168;
  const previewMaxH = duplexActive ? 152 : 196;
  const previewScale = Math.min(previewMaxW / Math.max(1, dims.widthMm), previewMaxH / Math.max(1, dims.heightMm));
  const pvW = Math.max(40, dims.widthMm * previewScale);
  const pvH = Math.max(40, dims.heightMm * previewScale);

  const marginFields: Array<{ side: 'top' | 'right' | 'bottom' | 'left'; fa: string; en: string }> = [
    { side: 'top', fa: 'بالا (Top)', en: 'Top' },
    { side: 'bottom', fa: 'پایین (Bottom)', en: 'Bottom' },
    { side: 'left', fa: 'چپ (Left)', en: 'Left' },
    { side: 'right', fa: 'راست (Right)', en: 'Right' },
  ];

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white tabular-nums';

  return (
    <div
      data-page-setup-modal
      role="dialog"
      aria-modal="true"
      aria-label={isFa ? 'تنظیمات کامل صفحه و چیدمان' : 'Page Setup'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs dark:bg-black/75"
      onClick={() => setModalState('pageSetup', false)}
    >
      <div
        dir={isFa ? 'rtl' : 'ltr'}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="h-5 w-5 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                {isFa ? 'تنظیمات کامل صفحه (Page Setup)' : 'Page Setup'}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {isFa
                  ? 'تنظیم حاشیه‌ها، پریست‌ها، شیرازه و عطف بوکلت، اندازه کاغذ و چیدمان شیت'
                  : 'Configure margins, presets, booklet spine & fold, paper size, orientation, and imposition'}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={isFa ? 'بستن تنظیمات صفحه' : 'Close Page Setup'}
            onClick={() => setModalState('pageSetup', false)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-5 pt-2 text-xs dark:border-slate-800 dark:bg-slate-950/60">
          <button
            type="button"
            data-page-setup-tab="margins"
            onClick={() => setActiveTab('margins')}
            className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-4 py-2 font-bold transition whitespace-nowrap cursor-pointer ${
              activeTab === 'margins'
                ? 'border-sky-500 bg-white text-sky-700 dark:border-sky-400 dark:bg-slate-900 dark:text-sky-300'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isFa ? 'حاشیه‌ها، پریست‌ها و شیرازه' : 'Margins, Presets & Spine'}</span>
          </button>
          <button
            type="button"
            data-page-setup-tab="paper"
            onClick={() => setActiveTab('paper')}
            className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-4 py-2 font-bold transition whitespace-nowrap cursor-pointer ${
              activeTab === 'paper'
                ? 'border-sky-500 bg-white text-sky-700 dark:border-sky-400 dark:bg-slate-900 dark:text-sky-300'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isFa ? 'اندازه کاغذ، جهت و چیدمان' : 'Paper, Orientation & Sheet'}</span>
          </button>
        </div>

        {/* Body */}
        <div className="grid flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[1fr_276px]">
          {/* Controls Column */}
          <div className="space-y-5 text-xs">
            {activeTab === 'margins' && (
              <>
                {/* Quick Presets Strip */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {isFa ? 'پریست‌های سریع حاشیه' : 'Quick Margin Presets'}
                    </span>
                    <button
                      type="button"
                      disabled={!hardwareAvailable}
                      onClick={() => {
                        if (!minMargins) return;
                        setCustomMarginsEdited(false);
                        setDraft((prev) => ({
                          ...prev,
                          marginMode: 'printer',
                          marginsMm: { ...minMargins },
                        }));
                      }}
                      className="flex items-center gap-1 rounded-lg border border-orange-300 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-40 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-300 dark:hover:bg-orange-500/20 cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                      <span>{isFa ? 'حاشیه سخت‌افزاری پرینتر' : 'Use Hardware Margins'}</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {presets.map((preset) => {
                      const isSelected =
                        preset.id === 'hardware'
                          ? draft.marginMode === 'printer' &&
                            Boolean(preset.marginsMm && marginsRoughlyEqual(draft.marginsMm, preset.marginsMm))
                          : Boolean(
                              preset.marginsMm &&
                                marginsRoughlyEqual(draft.marginsMm, preset.marginsMm) &&
                                !(preset.id === 'last-custom' && draft.marginMode === 'printer')
                            );
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          disabled={!preset.available}
                          data-page-setup-preset={preset.id}
                          onClick={() => {
                            if (!preset.marginsMm) return;
                            setCustomMarginsEdited(false);
                            setDraft((prev) => ({
                              ...prev,
                              marginMode: preset.id === 'hardware' ? 'printer' : 'custom',
                              marginsMm: { ...preset.marginsMm! },
                            }));
                          }}
                          className={`rounded-xl border px-2.5 py-2 text-start transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                            isSelected
                              ? 'border-sky-500 bg-sky-50 text-sky-900 dark:bg-sky-500/15 dark:text-white'
                              : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 dark:border-slate-700/80 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:border-slate-600'
                          }`}
                        >
                          <div className="truncate font-bold">
                            {isFa ? preset.titleFa : preset.titleEn}
                          </div>
                          {preset.marginsMm ? (
                            <div dir="ltr" className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                              T:{formatMarginValue(preset.marginsMm.top, settings.unit)} · B:{formatMarginValue(preset.marginsMm.bottom, settings.unit)} · L:{formatMarginValue(preset.marginsMm.left, settings.unit)} · R:{formatMarginValue(preset.marginsMm.right, settings.unit)}
                            </div>
                          ) : (
                            <div className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-300/80">
                              {isFa ? 'نامشخص' : 'Unavailable'}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 4-Side Margins Inputs */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/50">
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {isFa ? 'حاشیه‌های چهارگانه صفحه (mm)' : 'Page Margins (mm)'}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-page-setup-swap-lr
                        onClick={() => {
                          setCustomMarginsEdited(true);
                          setDraft((prev) => ({
                            ...prev,
                            marginMode: 'custom',
                            marginsMm: {
                              ...prev.marginsMm,
                              left: prev.marginsMm.right,
                              right: prev.marginsMm.left,
                            },
                          }));
                        }}
                        className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:border-sky-500/60 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        <ArrowLeftRight className="h-3 w-3 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                        <span>{isFa ? 'جابجایی چپ ↔ راست' : 'Swap Left ↔ Right'}</span>
                      </button>
                      {minMargins && (
                        <span className="text-[10px] text-rose-600 dark:text-rose-300 tabular-nums">
                          {isFa
                            ? `حداقل پرینتر: بالا ${minMargins.top} · راست ${minMargins.right} · پایین ${minMargins.bottom} · چپ ${minMargins.left} mm`
                            : `Printer min: T ${minMargins.top} · R ${minMargins.right} · B ${minMargins.bottom} · L ${minMargins.left} mm`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {marginFields.map(({ side, fa, en }) => {
                      const minSide = Math.max(0, minMargins?.[side] ?? 0);
                      const maxSide = Math.max(minSide, 200);
                      const currentVal = Math.max(minSide, draft.marginsMm[side]);
                      return (
                        <label key={side} className="block space-y-1">
                          <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                            <span>{isFa ? fa : en}</span>
                            {settings.unit !== 'mm' && (
                              <span dir="ltr" className="text-[10px] text-sky-600 dark:text-sky-300 tabular-nums">
                                {formatMarginValue(currentVal, settings.unit)}
                              </span>
                            )}
                          </span>
                          <input
                            type="number"
                            data-page-setup-margin={side}
                            min={minSide}
                            max={maxSide}
                            step={0.5}
                            value={currentVal}
                            onChange={(e) => updateDraftMargin(side, Number(e.target.value))}
                            className={inputClass}
                          />
                        </label>
                      );
                    })}
                  </div>

                  {/* Binding & Duplex Mirroring Summary */}
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-200 pt-3 dark:border-slate-800/80">
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'چاپ پشت و رو (آینه‌ای شدن در زوج و فرد)' : 'Duplex Mode (Odd / Even Mirror)'}
                      </span>
                      <select
                        data-page-setup-margins-duplex
                        value={draft.duplexMode}
                        onChange={(e) => {
                          const d = e.target.value as DuplexMode;
                          setDraft((prev) => ({
                            ...prev,
                            duplexMode: d,
                            ...(prev.booklet && (d === 'long-edge' || d === 'short-edge')
                              ? { booklet: { ...prev.booklet, duplexMode: d } }
                              : {}),
                          }));
                        }}
                        className={inputClass}
                      >
                        <option value="none">{isFa ? 'تک‌رو (Simplex)' : 'Simplex (1-Sided)'}</option>
                        <option value="long-edge">{isFa ? 'دورو - لبه بلند' : 'Duplex Long-Edge'}</option>
                        <option value="short-edge">{isFa ? 'دورو - لبه کوتاه' : 'Duplex Short-Edge'}</option>
                      </select>
                    </label>
                    <div className="space-y-1">
                      <span className="block text-[11px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'جهت صحافی / چیدمان زوج و فرد' : 'Binding Direction'}
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        {(['rtl', 'ltr'] as const).map((dirOption) => (
                          <button
                            key={dirOption}
                            type="button"
                            data-page-setup-binding={dirOption}
                            onClick={() => {
                              setDraft((prev) => ({
                                ...prev,
                                sheetOrder: prev.booklet?.enabled ? prev.sheetOrder : dirOption,
                                booklet: { ...(prev.booklet ?? DEFAULT_BOOKLET), direction: dirOption },
                              }));
                            }}
                            className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition cursor-pointer ${
                              bindingDir === dirOption
                                ? 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-400/70 dark:bg-amber-500/15 dark:text-amber-200'
                                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                            }`}
                          >
                            {dirOption === 'rtl'
                              ? isFa ? 'راست‌چین (RTL)' : 'RTL Binding'
                              : isFa ? 'چپ‌چین (LTR)' : 'LTR Binding'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Spine & Fold (Booklet) + Sheet Gutters */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3 dark:border-slate-800 dark:bg-slate-950/50">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200">
                      <BookOpen className="h-4 w-4 text-amber-500 dark:text-amber-400" aria-hidden="true" />
                      <span>{isFa ? 'شیرازه، عطف و فاصله بین صفحات' : 'Spine, Fold & Gutters'}</span>
                    </span>
                    <label className="flex items-center gap-2 cursor-pointer font-semibold text-amber-700 dark:text-amber-200">
                      <input
                        type="checkbox"
                        data-page-setup-booklet-toggle
                        checked={booklet.enabled}
                        onChange={(e) => updateDraftBooklet({ enabled: e.target.checked })}
                        className="accent-amber-500"
                      />
                      <span>{isFa ? 'فعال‌سازی چیدمان بوکلت' : 'Enable Booklet Mode'}</span>
                    </label>
                  </div>

                  {booklet.enabled ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <label className="block space-y-1">
                        <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                          <span>{isFa ? 'عرض فضای شیرازه و عطف (mm)' : 'Spine & fold gap (mm)'}</span>
                          <span className="font-mono text-amber-700 dark:text-amber-300 tabular-nums">{booklet.spineWidthMm} mm</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={0}
                            max={30}
                            step={0.5}
                            value={booklet.spineWidthMm}
                            onChange={(e) => updateDraftBooklet({ spineWidthMm: Number(e.target.value) })}
                            className="flex-1 accent-amber-500"
                          />
                          <input
                            type="number"
                            data-page-setup-spine
                            min={0}
                            max={30}
                            step={0.5}
                            value={booklet.spineWidthMm}
                            onChange={(e) =>
                              updateDraftBooklet({
                                spineWidthMm: Math.max(0, Math.min(30, Number(e.target.value) || 0)),
                              })
                            }
                            className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 text-center text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white tabular-nums"
                          />
                        </div>
                      </label>

                      <label className="block space-y-1">
                        <span className="text-[11px] text-slate-600 dark:text-slate-400">
                          {isFa ? 'جهت صحافی بوکلت' : 'Binding direction'}
                        </span>
                        <select
                          value={booklet.direction}
                          onChange={(e) =>
                            updateDraftBooklet({
                              direction: e.target.value as BookletSettings['direction'],
                            })
                          }
                          className={inputClass}
                        >
                          <option value="rtl">{isFa ? 'راست‌به‌چپ (فارسی)' : 'Right-to-Left'}</option>
                          <option value="ltr">{isFa ? 'چپ‌به‌راست (لاتین)' : 'Left-to-Right'}</option>
                        </select>
                      </label>

                      <label className="block space-y-1">
                        <span className="text-[11px] text-slate-600 dark:text-slate-400">
                          {isFa ? 'جبران ضخامت کاغذ / Creep (mm)' : 'Creep compensation (mm)'}
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={5}
                          step={0.05}
                          value={booklet.creepMm}
                          onChange={(e) =>
                            updateDraftBooklet({
                              creepMm: Math.max(0, Math.min(5, Number(e.target.value) || 0)),
                            })
                          }
                          className={inputClass}
                        />
                      </label>

                      <label className="block space-y-1">
                        <span className="text-[11px] text-slate-600 dark:text-slate-400">
                          {isFa ? 'تعداد صفحات در هر دسته صحافی' : 'Pages per signature'}
                        </span>
                        <select
                          value={booklet.signatureSize}
                          onChange={(e) =>
                            updateDraftBooklet({
                              signatureSize: Number(e.target.value) as BookletSettings['signatureSize'],
                            })
                          }
                          className={inputClass}
                        >
                          <option value={0}>{isFa ? 'خودکار؛ کل سند' : 'Automatic; whole document'}</option>
                          {[4, 8, 12, 16, 24, 32].map((sz) => (
                            <option key={sz} value={sz}>
                              {sz} {isFa ? 'صفحه' : 'pages'}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex items-center gap-2 sm:col-span-2 cursor-pointer text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={booklet.compensateCreep}
                          onChange={(e) => updateDraftBooklet({ compensateCreep: e.target.checked })}
                          className="accent-amber-500"
                        />
                        <span>{isFa ? 'اعمال جبران شیفت صفحات داخلی (Creep)' : 'Apply progressive creep shift'}</span>
                      </label>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <label className="block space-y-1">
                        <span className="text-[11px] text-slate-600 dark:text-slate-400">
                          {isFa ? 'فاصله افقی خانه‌ها / ستون‌ها (mm)' : 'Horizontal Gutter (mm)'}
                        </span>
                        <input
                          type="number"
                          data-page-setup-gutter-x
                          min={0}
                          max={200}
                          step={0.5}
                          value={draft.horizontalGutterMm}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              horizontalGutterMm: Math.max(0, Math.min(200, Number(e.target.value) || 0)),
                            }))
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-[11px] text-slate-600 dark:text-slate-400">
                          {isFa ? 'فاصله عمودی خانه‌ها / ردیف‌ها (mm)' : 'Vertical Gutter (mm)'}
                        </span>
                        <input
                          type="number"
                          data-page-setup-gutter-y
                          min={0}
                          max={200}
                          step={0.5}
                          value={draft.verticalGutterMm}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              verticalGutterMm: Math.max(0, Math.min(200, Number(e.target.value) || 0)),
                            }))
                          }
                          className={inputClass}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === 'paper' && (
              <>
                {/* Paper Size & Orientation */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3 dark:border-slate-800 dark:bg-slate-950/50">
                  <div className="font-bold text-slate-800 dark:text-slate-200">
                    {isFa ? 'اندازه کاغذ و جهت صفحه' : 'Paper Size & Orientation'}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'اندازه کاغذ شیت' : 'Paper Size'}
                      </span>
                      <select
                        dir="ltr"
                        data-page-setup-paper
                        value={selectedDriverPaperName}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedDriverPaperName(val);
                          if (val === 'Custom') {
                            setDraft((prev) => ({ ...prev, paperSize: 'Custom' }));
                            return;
                          }
                          const matched = driverPaperOptions.find((o) => o.name === val || o.id === val);
                          if (!matched) {
                            setDraft((prev) => ({ ...prev, paperSize: val as PaperSizeId }));
                            return;
                          }
                          setDraft((prev) => ({
                            ...prev,
                            paperSize: matched.id,
                            customWidthMm: Math.min(matched.widthMm, matched.heightMm),
                            customHeightMm: Math.max(matched.widthMm, matched.heightMm),
                          }));
                        }}
                        className={inputClass}
                      >
                        {driverPaperOptions.map((opt) => (
                          <option key={`${opt.id}-${opt.name}`} value={opt.name}>
                            {opt.name} ({Math.round(opt.widthMm)}×{Math.round(opt.heightMm)} mm)
                          </option>
                        ))}
                        {!driverPaperOptions.some((o) => o.id === 'Custom') && (
                          <option value="Custom">{isFa ? 'ابعاد سفارشی (Custom)' : 'Custom Size'}</option>
                        )}
                      </select>
                    </label>

                    <div className="space-y-1">
                      <span className="block text-[11px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'جهت صفحه' : 'Orientation'}
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        {(['portrait', 'landscape'] as PageOrientation[]).map((ori) => (
                          <button
                            key={ori}
                            type="button"
                            disabled={booklet.enabled}
                            data-page-setup-orientation={ori}
                            onClick={() => setDraft((prev) => ({ ...prev, orientation: ori }))}
                            className={`rounded-lg border px-3 py-1.5 font-semibold transition cursor-pointer disabled:opacity-50 ${
                              (booklet.enabled ? 'landscape' : draft.orientation) === ori
                                ? 'border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200'
                                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                            }`}
                          >
                            {ori === 'portrait'
                              ? isFa ? 'عمودی (Portrait)' : 'Portrait'
                              : isFa ? 'افقی (Landscape)' : 'Landscape'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {draft.paperSize === 'Custom' && (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <label className="block space-y-1">
                        <span className="text-[11px] text-slate-600 dark:text-slate-400">{isFa ? 'عرض کاغذ (mm)' : 'Width (mm)'}</span>
                        <input
                          type="number"
                          min={10}
                          max={2000}
                          value={draft.customWidthMm}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              customWidthMm: Math.max(10, Math.min(2000, Number(e.target.value) || 10)),
                            }))
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-[11px] text-slate-600 dark:text-slate-400">{isFa ? 'ارتفاع کاغذ (mm)' : 'Height (mm)'}</span>
                        <input
                          type="number"
                          min={10}
                          max={2000}
                          value={draft.customHeightMm}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              customHeightMm: Math.max(10, Math.min(2000, Number(e.target.value) || 10)),
                            }))
                          }
                          className={inputClass}
                        />
                      </label>
                    </div>
                  )}
                </div>

                {/* Grid, Scale & Duplex */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3 dark:border-slate-800 dark:bg-slate-950/50">
                  <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200">
                    <Layers className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                    <span>{isFa ? 'ماتریس چیدمان، مقیاس و چاپ دورو' : 'Matrix Grid, Scaling & Duplex'}</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">{isFa ? 'ردیف‌ها (Rows)' : 'Rows'}</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        disabled={booklet.enabled}
                        value={booklet.enabled ? 1 : draft.rows}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            rows: Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1))),
                          }))
                        }
                        className={inputClass}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">{isFa ? 'ستون‌ها (Cols)' : 'Columns'}</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        disabled={booklet.enabled}
                        value={booklet.enabled ? 2 : draft.cols}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            cols: Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1))),
                          }))
                        }
                        className={inputClass}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">{isFa ? 'حالت مقیاس (Scale)' : 'Scale Mode'}</span>
                      <select
                        value={draft.scaleMode}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, scaleMode: e.target.value as ScaleMode }))
                        }
                        className={inputClass}
                      >
                        <option value="fit">{isFa ? 'Fit (جاگذاری کامل)' : 'Fit'}</option>
                        <option value="fill">{isFa ? 'Fill (پر کردن کادر)' : 'Fill'}</option>
                        <option value="original">{isFa ? '100% واقعی' : 'Original 100%'}</option>
                        <option value="custom">{isFa ? 'درصد دلخواه' : 'Custom %'}</option>
                      </select>
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">{isFa ? 'ترتیب چیدمان' : 'Reading Order'}</span>
                      <select
                        value={draft.sheetOrder}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            sheetOrder: e.target.value as SheetOrderMode,
                          }))
                        }
                        className={inputClass}
                      >
                        <option value="rtl">{isFa ? 'راست‌به‌چپ' : 'RTL'}</option>
                        <option value="ltr">{isFa ? 'چپ‌به‌راست' : 'LTR'}</option>
                        <option value="column">{isFa ? 'ستونی' : 'Column'}</option>
                        <option value="spiral">{isFa ? 'مارپیچی' : 'Spiral'}</option>
                      </select>
                    </label>
                  </div>

                  {draft.scaleMode === 'custom' && (
                    <label className="block max-w-[180px] space-y-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">{isFa ? 'درصد مقیاس (%)' : 'Scale (%)'}</span>
                      <input
                        type="number"
                        min={10}
                        max={400}
                        value={draft.customScalePercent}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            customScalePercent: Math.max(10, Math.min(400, Number(e.target.value) || 100)),
                          }))
                        }
                        className={inputClass}
                      />
                    </label>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'چاپ دورو (یکپارچه با پرینتر)' : 'Duplex Mode (Synced)'}
                      </span>
                      <select
                        data-page-setup-duplex
                        value={draft.duplexMode}
                        onChange={(e) => {
                          const d = e.target.value as DuplexMode;
                          setDraft((prev) => ({
                            ...prev,
                            duplexMode: d,
                            ...(prev.booklet && (d === 'long-edge' || d === 'short-edge')
                              ? { booklet: { ...prev.booklet, duplexMode: d } }
                              : {}),
                          }));
                        }}
                        className={inputClass}
                      >
                        <option value="none">{isFa ? 'تک‌رو (Simplex)' : 'Simplex (1-Sided)'}</option>
                        <option value="long-edge">{isFa ? 'دورو - لبه بلند' : 'Duplex Long-Edge'}</option>
                        <option value="short-edge">{isFa ? 'دورو - لبه کوتاه' : 'Duplex Short-Edge'}</option>
                      </select>
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">{isFa ? 'نحوه چیدمان خانه‌ها' : 'Placement Mode'}</span>
                      <select
                        value={draft.placementMode}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            placementMode: e.target.value as LayoutSettings['placementMode'],
                          }))
                        }
                        className={inputClass}
                      >
                        <option value="sequential">{isFa ? 'متوالی (Sequential)' : 'Sequential'}</option>
                        <option value="step-and-repeat">{isFa ? 'تکرار یک صفحه (Step & Repeat)' : 'Step & Repeat'}</option>
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 pt-1 text-slate-700 dark:text-slate-300">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.autoRotateToFit}
                        onChange={(e) => setDraft((prev) => ({ ...prev, autoRotateToFit: e.target.checked }))}
                        className="accent-sky-500"
                      />
                      <span>{isFa ? 'چرخش خودکار برای بهترین جاگیری' : 'Auto-rotate to fit'}</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.uniqueScale}
                        onChange={(e) => setDraft((prev) => ({ ...prev, uniqueScale: e.target.checked }))}
                        className="accent-sky-500"
                      />
                      <span>{isFa ? 'مقیاس یکسان (Unique Scale)' : 'Unique Scale'}</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.showCropMarks}
                        onChange={(e) => setDraft((prev) => ({ ...prev, showCropMarks: e.target.checked }))}
                        className="accent-sky-500"
                      />
                      <span>{isFa ? 'علائم برش (Crop Marks)' : 'Crop Marks'}</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draft.showCellBorders}
                        onChange={(e) => setDraft((prev) => ({ ...prev, showCellBorders: e.target.checked }))}
                        className="accent-sky-500"
                      />
                      <span>{isFa ? 'کادر دور خانه‌ها' : 'Cell Borders'}</span>
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Live Schematic Preview Column */}
          <div className="flex flex-col items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/70">
            <div className="w-full text-center text-[11px] font-bold text-slate-700 dark:text-slate-300">
              {duplexActive
                ? isFa
                  ? 'پیش‌نمایش برگه‌های فرد و زوج (پشت و رو)'
                  : 'Odd (Front) & Even (Back) Preview'
                : isFa
                  ? 'پیش‌نمایش ساختار شیت'
                  : 'Live Sheet Preview'}
            </div>

            <div
              dir="ltr"
              className="my-4 flex items-center justify-center gap-3"
            >
              {(duplexActive
                ? bindingDir === 'rtl'
                  ? (['back', 'front'] as const)
                  : (['front', 'back'] as const)
                : (['front'] as const)
              ).map((sheetSide) => {
                const sm = sheetSide === 'front' ? frontMargins : backMargins;
                const sTop = Math.min(pvH * 0.45, sm.top * previewScale);
                const sRight = Math.min(pvW * 0.45, sm.right * previewScale);
                const sBottom = Math.min(pvH * 0.45, sm.bottom * previewScale);
                const sLeft = Math.min(pvW * 0.45, sm.left * previewScale);
                const spineOnRight =
                  flipAxis === 'horizontal' &&
                  ((bindingDir === 'rtl' && sheetSide === 'front') ||
                    (bindingDir === 'ltr' && sheetSide === 'back'));
                const spineOnLeft =
                  flipAxis === 'horizontal' &&
                  ((bindingDir === 'ltr' && sheetSide === 'front') ||
                    (bindingDir === 'rtl' && sheetSide === 'back'));

                return (
                  <div
                    key={sheetSide}
                    data-page-setup-preview={sheetSide}
                    className="flex flex-col items-center gap-1.5"
                  >
                    {duplexActive && (
                      <span
                        className={`text-[10px] font-bold ${
                          sheetSide === 'front' ? 'text-sky-600 dark:text-sky-300' : 'text-amber-600 dark:text-amber-300'
                        }`}
                      >
                        {sheetSide === 'front'
                          ? isFa
                            ? 'برگه فرد (رو)'
                            : 'Odd (Front)'
                          : isFa
                            ? 'برگه زوج (پشت)'
                            : 'Even (Back)'}
                      </span>
                    )}
                    <div
                      style={{ width: pvW, height: pvH }}
                      className="relative overflow-hidden rounded-xs border border-slate-400 bg-white shadow-lg"
                    >
                      {/* Margin Shading */}
                      <div
                        style={{ height: sTop }}
                        className="absolute inset-x-0 top-0 bg-slate-400/35"
                      />
                      <div
                        style={{ height: sBottom }}
                        className="absolute inset-x-0 bottom-0 bg-slate-400/35"
                      />
                      <div
                        style={{ top: sTop, bottom: sBottom, width: sLeft }}
                        className="absolute left-0 bg-slate-400/35"
                      />
                      <div
                        style={{ top: sTop, bottom: sBottom, width: sRight }}
                        className="absolute right-0 bg-slate-400/35"
                      />

                      {/* Binding Edge Highlight */}
                      {spineOnRight && (
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 right-0 w-1 bg-amber-500/80"
                        />
                      )}
                      {spineOnLeft && (
                        <div
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 w-1 bg-amber-500/80"
                        />
                      )}

                      {/* Hardware minimum margin outline */}
                      {minMargins && (
                        <div
                          style={{
                            top: minMargins.top * previewScale,
                            right: minMargins.right * previewScale,
                            bottom: minMargins.bottom * previewScale,
                            left: minMargins.left * previewScale,
                          }}
                          className="absolute border border-dashed border-rose-500/70"
                        />
                      )}

                      {/* Content cells or Booklet spine */}
                      <div
                        style={{
                          top: sTop,
                          right: sRight,
                          bottom: sBottom,
                          left: sLeft,
                        }}
                        className="absolute flex items-stretch justify-stretch border border-dashed border-slate-500/70 p-0.5"
                      >
                        {booklet.enabled ? (
                          <div className="flex h-full w-full items-stretch">
                            <div className="flex-1 border border-sky-500/50 bg-sky-500/10" />
                            <div
                              style={{ width: Math.max(2, booklet.spineWidthMm * previewScale) }}
                              className="bg-amber-500/40 border-x border-amber-600/60"
                            />
                            <div className="flex-1 border border-sky-500/50 bg-sky-500/10" />
                          </div>
                        ) : (
                          <div
                            style={{
                              gridTemplateRows: `repeat(${draft.rows}, minmax(0, 1fr))`,
                              gridTemplateColumns: `repeat(${draft.cols}, minmax(0, 1fr))`,
                              gap: `${Math.min(8, draft.verticalGutterMm * previewScale)}px ${Math.min(8, draft.horizontalGutterMm * previewScale)}px`,
                            }}
                            className="grid h-full w-full"
                          >
                            {Array.from({ length: Math.min(25, draft.rows * draft.cols) }, (_, idx) => (
                              <div key={idx} className="border border-sky-500/50 bg-sky-500/10" />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <span dir="ltr" className="text-[9px] text-slate-500 dark:text-slate-400 tabular-nums">
                      L:{formatMarginValue(sm.left, settings.unit)} · R:{formatMarginValue(sm.right, settings.unit)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="w-full space-y-1 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-700 dark:border-slate-800 dark:text-slate-300 tabular-nums">
              <div className="font-mono font-bold text-sky-700 dark:text-sky-300">
                {Math.round(dims.widthMm)} × {Math.round(dims.heightMm)} mm
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                {booklet.enabled
                  ? isFa
                    ? `بوکلت ${bindingDir === 'rtl' ? 'راست‌چین' : 'چپ‌چین'} · شیرازه ${booklet.spineWidthMm} mm`
                    : `Booklet ${bindingDir.toUpperCase()} · Spine ${booklet.spineWidthMm} mm`
                  : `${draft.rows}×${draft.cols}-Up · ${draft.orientation}`}
              </div>
              {duplexActive && (
                <div className="text-[10px] text-amber-700 dark:text-amber-300/90">
                  {flipAxis === 'horizontal'
                    ? isFa
                      ? `آینه چپ ↔ راست در برگه‌های زوج و فرد (${bindingDir === 'rtl' ? 'صحافی راست‌چین' : 'صحافی چپ‌چین'})`
                      : `L ↔ R mirrored on odd/even sheets (${bindingDir.toUpperCase()})`
                    : isFa
                      ? 'آینه بالا ↔ پایین در برگه‌های زوج و فرد (چرخش لبه بالا)'
                      : 'T ↔ B mirrored on odd/even sheets (top-edge flip)'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/60">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {activePrinter
              ? isFa
                ? `پرینتر فعال: ${activePrinter.name}`
                : `Active printer: ${activePrinter.name}`
              : isFa
                ? 'بدون پرینتر متصل (تغییرات روی شیت اعمال می‌شود)'
                : 'No active printer (applied to sheet layout)'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setModalState('pageSetup', false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 whitespace-nowrap cursor-pointer"
            >
              {isFa ? 'انصراف' : 'Cancel'}
            </button>
            <button
              type="button"
              data-page-setup-apply
              onClick={handleApply}
              className="rounded-xl bg-sky-600 px-5 py-2 font-bold text-white hover:bg-sky-500 whitespace-nowrap cursor-pointer"
            >
              {isFa ? 'اعمال تنظیمات صفحه' : 'Apply Page Setup'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
