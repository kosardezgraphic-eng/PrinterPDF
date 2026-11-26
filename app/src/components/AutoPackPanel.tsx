import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Grid2x2Plus, Link2, Link2Off, Lock, RotateCw, Unlock } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  computeAutoPackPlan,
  convertUnitToMm,
  getPageDisplayDimensionsMm,
  resolveAutoPackTargetDimensions,
} from '../engine/autoPack';
import { convertMmToUnit, getSheetDimensionsMm } from '../engine/layoutEngine';
import { resolvePrinterMinMargins } from '../engine/sheetInteraction';
import { formatLocalizedNumber } from '../i18n/shamsi';

interface AutoPackPanelProps {
  compact?: boolean;
}

export const AutoPackPanel: React.FC<AutoPackPanelProps> = ({ compact = false }) => {
  const {
    pages,
    activePageId,
    layout,
    settings,
    printers,
    selectedPrinterName,
    printerMargins,
    autoPackPageOnSheet,
  } = useAppStore();

  const lang = settings.language;
  const isFa = lang === 'fa';
  const unit = settings.unit;

  const targetPage = useMemo(
    () =>
      (activePageId ? pages.find((p) => p.id === activePageId) : undefined) ??
      pages.find((p) => p.isHighlighted) ??
      pages.find((p) => p.selectedForPrint) ??
      pages[0],
    [activePageId, pages]
  );

  const [selectedTargetId, setSelectedTargetId] = useState<string | undefined>(undefined);
  const resolvedTarget = useMemo(
    () => (selectedTargetId ? pages.find((p) => p.id === selectedTargetId) : undefined) ?? targetPage,
    [pages, selectedTargetId, targetPage]
  );

  useEffect(() => {
    setSelectedTargetId(targetPage?.id);
  }, [targetPage?.id]);

  const baseTarget = useMemo(
    () =>
      resolvedTarget
        ? {
            ...resolvedTarget,
            rotation: resolvedTarget.overrides?.autoPackBaseRotation ?? resolvedTarget.rotation,
          }
        : undefined,
    [resolvedTarget]
  );

  const sourceDims = useMemo(
    () =>
      baseTarget
        ? getPageDisplayDimensionsMm(baseTarget)
        : { widthMm: 30, heightMm: 40, aspectRatio: 0.75 },
    [baseTarget]
  );

  const activePrinter = printers.find((p) => p.name === selectedPrinterName);
  const minPrinterMargins = useMemo(
    () =>
      resolvePrinterMinMargins(printerMargins, activePrinter) ?? {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
    [activePrinter, printerMargins]
  );
  const minPrinterMax = Math.max(
    minPrinterMargins.top,
    minPrinterMargins.right,
    minPrinterMargins.bottom,
    minPrinterMargins.left
  );

  const [lockAspect, setLockAspect] = useState(true);
  const [syncGaps, setSyncGaps] = useState(true);
  const [allowRotateForMax, setAllowRotateForMax] = useState(true);
  const [centerOnSheet, setCenterOnSheet] = useState(true);
  const [maximizeSpacing, setMaximizeSpacing] = useState(false);
  const [addCutLines, setAddCutLines] = useState(Boolean(layout.showCropMarks));
  const [onlySelectedPage, setOnlySelectedPage] = useState(true);

  const [widthMm, setWidthMm] = useState<number>(sourceDims.widthMm);
  const [heightMm, setHeightMm] = useState<number>(sourceDims.heightMm);
  const [widthDraft, setWidthDraft] = useState<string>(() =>
    String(convertMmToUnit(sourceDims.widthMm, unit))
  );
  const [heightDraft, setHeightDraft] = useState<string>(() =>
    String(convertMmToUnit(sourceDims.heightMm, unit))
  );

  const initialGapH = Math.max(0, layout.horizontalGutterMm);
  const initialGapV = Math.max(0, layout.verticalGutterMm);
  const [gapHMm, setGapHMm] = useState<number>(initialGapH);
  const [gapVMm, setGapVMm] = useState<number>(initialGapV);
  const [gapHDraft, setGapHDraft] = useState<string>(() =>
    String(initialGapH)
  );
  const [gapVDraft, setGapVDraft] = useState<string>(() =>
    String(initialGapV)
  );

  const initialOuterMarginMm = Math.max(
    minPrinterMax,
    Math.min(
      10,
      layout.marginsMm.top,
      layout.marginsMm.right,
      layout.marginsMm.bottom,
      layout.marginsMm.left
    )
  );
  const [outerMarginMm, setOuterMarginMm] = useState<number>(initialOuterMarginMm);
  const [outerMarginDraft, setOuterMarginDraft] = useState<string>(() =>
    String(convertMmToUnit(initialOuterMarginMm, unit))
  );

  const seededPageRef = useRef<string | null>(null);
  const lastUnitRef = useRef(unit);

  // Seed dimensions when a different page is selected (do not overwrite if the user already typed a custom target size on the same page)
  useEffect(() => {
    if (!baseTarget) return;
    if (seededPageRef.current === baseTarget.id) return;
    seededPageRef.current = baseTarget.id;
    const dims = getPageDisplayDimensionsMm(baseTarget);
    setWidthMm(dims.widthMm);
    setHeightMm(dims.heightMm);
    setWidthDraft(String(convertMmToUnit(dims.widthMm, unit)));
    setHeightDraft(String(convertMmToUnit(dims.heightMm, unit)));
  }, [baseTarget, unit]);

  // Reformat drafts when measurement unit changes
  useEffect(() => {
    if (lastUnitRef.current === unit) return;
    lastUnitRef.current = unit;
    if (widthDraft.trim() !== '') {
      setWidthDraft(String(convertMmToUnit(widthMm, unit)));
    }
    if (heightDraft.trim() !== '') {
      setHeightDraft(String(convertMmToUnit(heightMm, unit)));
    }
    setOuterMarginDraft(String(convertMmToUnit(outerMarginMm, unit)));
  }, [unit, widthMm, heightMm, gapHMm, gapVMm, outerMarginMm, widthDraft, heightDraft]);

  const widthParsed = widthDraft.trim() === '' ? NaN : Number(widthDraft);
  const heightParsed = heightDraft.trim() === '' ? NaN : Number(heightDraft);
  const widthBlank = !Number.isFinite(widthParsed) || widthParsed <= 0;
  const heightBlank = !Number.isFinite(heightParsed) || heightParsed <= 0;

  const { effectiveWidthMm, effectiveHeightMm } = useMemo(() => {
    if (!widthBlank && heightBlank) {
      const next = resolveAutoPackTargetDimensions({
        sourceWidthMm: sourceDims.widthMm,
        sourceHeightMm: sourceDims.heightMm,
        driver: 'width',
        targetWidthMm: widthMm,
        lockAspect: true,
      });
      return { effectiveWidthMm: next.widthMm, effectiveHeightMm: next.heightMm };
    }
    if (widthBlank && !heightBlank) {
      const next = resolveAutoPackTargetDimensions({
        sourceWidthMm: sourceDims.widthMm,
        sourceHeightMm: sourceDims.heightMm,
        driver: 'height',
        targetHeightMm: heightMm,
        lockAspect: true,
      });
      return { effectiveWidthMm: next.widthMm, effectiveHeightMm: next.heightMm };
    }
    return { effectiveWidthMm: widthMm, effectiveHeightMm: heightMm };
  }, [widthBlank, heightBlank, widthMm, heightMm, sourceDims.widthMm, sourceDims.heightMm]);

  const sheetDims = useMemo(() => {
    const cleanLayout = layout.booklet?.enabled
      ? { ...layout, booklet: { ...layout.booklet, enabled: false } }
      : layout;
    return getSheetDimensionsMm(cleanLayout);
  }, [layout]);

  const effectiveBaseMargins = useMemo(
    () => ({
      top: Math.max(minPrinterMargins.top, outerMarginMm),
      right: Math.max(minPrinterMargins.right, outerMarginMm),
      bottom: Math.max(minPrinterMargins.bottom, outerMarginMm),
      left: Math.max(minPrinterMargins.left, outerMarginMm),
    }),
    [minPrinterMargins, outerMarginMm]
  );

  const plan = useMemo(
    () =>
      computeAutoPackPlan({
        sheetWidthMm: sheetDims.widthMm,
        sheetHeightMm: sheetDims.heightMm,
        baseMarginsMm: effectiveBaseMargins,
        itemWidthMm: effectiveWidthMm,
        itemHeightMm: effectiveHeightMm,
        horizontalGapMm: gapHMm,
        verticalGapMm: gapVMm,
        allowRotateForMax,
        centerOnSheet,
        maximizeSpacing,
      }),
    [
      sheetDims.widthMm,
      sheetDims.heightMm,
      effectiveBaseMargins,
      effectiveWidthMm,
      effectiveHeightMm,
      gapHMm,
      gapVMm,
      allowRotateForMax,
      centerOnSheet,
      maximizeSpacing,
    ]
  );

  const handleWidthInput = (raw: string) => {
    setWidthDraft(raw);
    const parsed = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) return;
    const rawMm = convertUnitToMm(parsed, unit);
    const next = resolveAutoPackTargetDimensions({
      sourceWidthMm: sourceDims.widthMm,
      sourceHeightMm: sourceDims.heightMm,
      driver: 'width',
      targetWidthMm: rawMm,
      targetHeightMm: heightMm,
      lockAspect,
    });
    setWidthMm(next.widthMm);
    setHeightMm(next.heightMm);
    if (lockAspect && heightDraft.trim() !== '') {
      setHeightDraft(String(convertMmToUnit(next.heightMm, unit)));
    }
  };

  const handleHeightInput = (raw: string) => {
    setHeightDraft(raw);
    const parsed = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) return;
    const rawMm = convertUnitToMm(parsed, unit);
    const next = resolveAutoPackTargetDimensions({
      sourceWidthMm: sourceDims.widthMm,
      sourceHeightMm: sourceDims.heightMm,
      driver: 'height',
      targetWidthMm: widthMm,
      targetHeightMm: rawMm,
      lockAspect,
    });
    setWidthMm(next.widthMm);
    setHeightMm(next.heightMm);
    if (lockAspect && widthDraft.trim() !== '') {
      setWidthDraft(String(convertMmToUnit(next.widthMm, unit)));
    }
  };

  const toggleLockAspect = () => {
    const nextLock = !lockAspect;
    setLockAspect(nextLock);
    if (nextLock) {
      const driver: 'width' | 'height' = widthBlank && !heightBlank ? 'height' : 'width';
      const next = resolveAutoPackTargetDimensions({
        sourceWidthMm: sourceDims.widthMm,
        sourceHeightMm: sourceDims.heightMm,
        driver,
        targetWidthMm: effectiveWidthMm,
        targetHeightMm: effectiveHeightMm,
        lockAspect: true,
      });
      setWidthMm(next.widthMm);
      setHeightMm(next.heightMm);
      if (!widthBlank || heightBlank) {
        setWidthDraft(String(convertMmToUnit(next.widthMm, unit)));
      }
      if (!heightBlank || widthBlank) {
        setHeightDraft(String(convertMmToUnit(next.heightMm, unit)));
      }
    }
  };

  const handleGapHInput = (raw: string) => {
    setGapHDraft(raw);
    if (raw.trim() === '') {
      setGapHMm(0);
      if (syncGaps) {
        setGapVMm(0);
        setGapVDraft('');
      }
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const mm = Math.max(0, Math.min(200, parsed));
    setGapHMm(mm);
    if (syncGaps) {
      setGapVMm(mm);
      setGapVDraft(raw);
    }
  };

  const handleGapVInput = (raw: string) => {
    setGapVDraft(raw);
    if (raw.trim() === '') {
      setGapVMm(0);
      if (syncGaps) {
        setGapHMm(0);
        setGapHDraft('');
      }
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const mm = Math.max(0, Math.min(200, parsed));
    setGapVMm(mm);
    if (syncGaps) {
      setGapHMm(mm);
      setGapHDraft(raw);
    }
  };

  const handleOuterMarginInput = (raw: string) => {
    setOuterMarginDraft(raw);
    if (raw.trim() === '') {
      setOuterMarginMm(minPrinterMax);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const mm = Math.max(minPrinterMax, Math.min(150, convertUnitToMm(parsed, unit)));
    setOuterMarginMm(mm);
  };

  const handleApply = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    autoPackPageOnSheet({
      pageId: resolvedTarget?.id,
      widthMm: effectiveWidthMm,
      heightMm: effectiveHeightMm,
      lockAspect: lockAspect || widthBlank || heightBlank,
      horizontalGapMm: gapHMm,
      verticalGapMm: gapVMm,
      outerMarginMm,
      allowRotateForMax,
      centerOnSheet,
      maximizeSpacing,
      addCutLines,
      onlySelectedPage,
    });
  };

  const inputClass =
    'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-mono text-slate-900 tabular-nums focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

  return (
    <form
      data-auto-pack-panel
      onSubmit={handleApply}
      className={
        compact
          ? 'flex min-w-[290px] flex-col gap-1.5 rounded-xl border border-sky-200 bg-sky-50/50 p-2.5 dark:border-sky-500/30 dark:bg-slate-800/70'
          : 'flex flex-col gap-2 rounded-xl border border-sky-200/90 bg-white p-2.5 shadow-2xs dark:border-sky-500/30 dark:bg-slate-800/70'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Grid2x2Plus className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          <span className="text-[11px] font-bold text-slate-800 dark:text-slate-100">
            {isFa ? 'چیدمان خودکار با اندازه دلخواه' : 'Auto-Pack by Size'}
          </span>
        </div>
        <span
          data-auto-pack-preview-badge
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
            plan.fits
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
          }`}
        >
          {plan.fits
            ? plan.isHybrid
              ? isFa
                ? `${formatLocalizedNumber(plan.totalPerSheet, lang)} عدد (مختلط ۰°+۹۰°)`
                : `${plan.totalPerSheet}/sheet (Mixed 0°+90°)`
              : isFa
                ? `${formatLocalizedNumber(plan.cols, lang)}×${formatLocalizedNumber(plan.rows, lang)} = ${formatLocalizedNumber(plan.totalPerSheet, lang)} عدد`
                : `${plan.cols}×${plan.rows} = ${plan.totalPerSheet}/sheet`
            : isFa
              ? 'جا نمی‌شود'
              : 'Does not fit'}
        </span>
      </div>

      {pages.length > 1 && (
        <label className="flex flex-col gap-0.5 text-[10px] text-slate-600 dark:text-slate-400">
          <span>{isFa ? 'تصویر / صفحه انتخابی:' : 'Target image / page:'}</span>
          <select
            aria-label={isFa ? 'انتخاب تصویر برای چیدمان خودکار' : 'Target image for auto-pack'}
            value={resolvedTarget?.id ?? ''}
            onChange={(e) => {
              seededPageRef.current = null;
              setSelectedTargetId(e.target.value);
            }}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {pages.map((p, idx) => (
              <option key={p.id} value={p.id}>
                #{idx + 1} · {p.documentName} ({Math.round(p.widthMm)}×{Math.round(p.heightMm)}mm)
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Target Width & Height + Aspect Lock */}
      <div className="flex items-end gap-1.5">
        <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-400">
          <span>{isFa ? `عرض (${unit})` : `Width (${unit})`}</span>
          <input
            type="number"
            step="any"
            min={0.1}
            max={2000}
            aria-label={isFa ? 'عرض هدف تصویر' : 'Auto-pack target width'}
            data-auto-pack-width
            value={widthDraft}
            placeholder={widthBlank ? `~${convertMmToUnit(effectiveWidthMm, unit)}` : undefined}
            onChange={(e) => handleWidthInput(e.target.value)}
            onBlur={() => {
              if (widthDraft.trim() === '' && !heightBlank) return;
              setWidthDraft(String(convertMmToUnit(effectiveWidthMm, unit)));
            }}
            className={inputClass}
          />
        </label>

        <button
          type="button"
          data-auto-pack-lock-aspect
          aria-pressed={lockAspect}
          onClick={toggleLockAspect}
          title={
            isFa
              ? 'قفل نسبت طول و عرض (تغییر یک بُعد، بُعد دیگر را متناسب تنظیم می‌کند)'
              : 'Lock aspect ratio'
          }
          aria-label={isFa ? 'قفل نسبت ابعاد' : 'Lock aspect ratio'}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition cursor-pointer ${
            lockAspect
              ? 'border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-400 dark:bg-sky-500/20 dark:text-sky-300'
              : 'border-slate-300 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          {lockAspect ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
        </button>

        <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-400">
          <span>{isFa ? `طول / ارتفاع (${unit})` : `Length / H (${unit})`}</span>
          <input
            type="number"
            step="any"
            min={0.1}
            max={2000}
            aria-label={isFa ? 'طول هدف تصویر' : 'Auto-pack target height'}
            data-auto-pack-height
            value={heightDraft}
            placeholder={heightBlank ? `~${convertMmToUnit(effectiveHeightMm, unit)}` : undefined}
            onChange={(e) => handleHeightInput(e.target.value)}
            onBlur={() => {
              if (heightDraft.trim() === '' && !widthBlank) return;
              setHeightDraft(String(convertMmToUnit(effectiveHeightMm, unit)));
            }}
            className={inputClass}
          />
        </label>
      </div>

      {/* Spacing / Gaps & Outer Margin */}
      <div className="flex items-end gap-1.5">
        <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-400">
          <span>{isFa ? `فاصله افقی (mm)` : 'Gap H (mm)'}</span>
          <input
            type="number"
            step="any"
            min={0}
            max={200}
            aria-label={isFa ? 'فاصله افقی بین عکس‌ها' : 'Auto-pack horizontal gap'}
            data-auto-pack-gap-h
            value={gapHDraft}
            placeholder="0"
            onChange={(e) => handleGapHInput(e.target.value)}
            onBlur={() => setGapHDraft(String(gapHMm))}
            className={inputClass}
          />
        </label>

        <button
          type="button"
          data-auto-pack-sync-gaps
          aria-pressed={syncGaps}
          onClick={() => {
            const next = !syncGaps;
            setSyncGaps(next);
            if (next) {
              setGapVMm(gapHMm);
              setGapVDraft(String(gapHMm));
            }
          }}
          title={isFa ? 'همسان‌سازی فاصله افقی و عمودی' : 'Sync horizontal & vertical gaps'}
          aria-label={isFa ? 'همسان‌سازی فاصله‌ها' : 'Sync gaps'}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition cursor-pointer ${
            syncGaps
              ? 'border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-400 dark:bg-sky-500/20 dark:text-sky-300'
              : 'border-slate-300 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          {syncGaps ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
        </button>

        <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-400">
          <span>{isFa ? `فاصله عمودی (mm)` : 'Gap V (mm)'}</span>
          <input
            type="number"
            step="any"
            min={0}
            max={200}
            aria-label={isFa ? 'فاصله عمودی بین عکس‌ها' : 'Auto-pack vertical gap'}
            data-auto-pack-gap-v
            value={gapVDraft}
            placeholder="0"
            onChange={(e) => handleGapVInput(e.target.value)}
            onBlur={() => setGapVDraft(String(gapVMm))}
            className={inputClass}
          />
        </label>

        <label className="flex w-20 shrink-0 flex-col gap-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-400">
          <span>{isFa ? `حاشیه (${unit})` : `Margin (${unit})`}</span>
          <input
            type="number"
            step="any"
            min={0}
            max={150}
            aria-label={isFa ? 'حاشیه بیرونی شیت' : 'Auto-pack outer margin'}
            data-auto-pack-margin
            value={outerMarginDraft}
            placeholder={String(convertMmToUnit(minPrinterMax, unit))}
            onChange={(e) => handleOuterMarginInput(e.target.value)}
            onBlur={() => setOuterMarginDraft(String(convertMmToUnit(outerMarginMm, unit)))}
            className={inputClass}
          />
        </label>
      </div>

      {/* Options */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-700 dark:text-slate-300">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={allowRotateForMax}
            onChange={(e) => setAllowRotateForMax(e.target.checked)}
            className="accent-sky-500"
          />
          <span>{isFa ? 'چرخش ۹۰° برای بیشترین تعداد' : 'Auto-rotate 90°'}</span>
        </label>

        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={centerOnSheet}
            onChange={(e) => setCenterOnSheet(e.target.checked)}
            className="accent-sky-500"
          />
          <span>{isFa ? 'وسط‌چین شیت' : 'Center'}</span>
        </label>

        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            data-auto-pack-max-spacing
            checked={maximizeSpacing}
            onChange={(e) => setMaximizeSpacing(e.target.checked)}
            className="accent-sky-500"
          />
          <span>{isFa ? 'بیشترین فاصله از هم' : 'Max spacing'}</span>
        </label>

        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            data-auto-pack-cut-lines
            checked={addCutLines}
            onChange={(e) => setAddCutLines(e.target.checked)}
            className="accent-sky-500"
          />
          <span>{isFa ? 'خط برش' : 'Cut lines'}</span>
        </label>

        {pages.length > 1 && (
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={onlySelectedPage}
              onChange={(e) => setOnlySelectedPage(e.target.checked)}
              className="accent-sky-500"
            />
            <span>{isFa ? 'فقط همین تصویر' : 'This image only'}</span>
          </label>
        )}
      </div>

      {/* Summary line + Apply button */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400 tabular-nums">
          {plan.fits ? (
            <>
              <span>
                {convertMmToUnit(plan.isHybrid ? effectiveWidthMm : plan.cellWidthMm, unit)}×
                {convertMmToUnit(plan.isHybrid ? effectiveHeightMm : plan.cellHeightMm, unit)} {unit}
              </span>
              {plan.isHybrid ? (
                <span className="inline-flex items-center gap-0.5 rounded bg-sky-100 px-1 py-0.5 text-[9px] font-semibold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
                  <RotateCw className="h-2.5 w-2.5" aria-hidden="true" />
                  {isFa ? 'ترکیبی ۰°+۹۰°' : '0°+90° mix'}
                </span>
              ) : plan.rotated90 ? (
                <span className="inline-flex items-center gap-0.5 rounded bg-sky-100 px-1 py-0.5 text-[9px] font-semibold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
                  <RotateCw className="h-2.5 w-2.5" aria-hidden="true" />
                  {isFa ? '۹۰°' : '90°'}
                </span>
              ) : null}
              <span>· {formatLocalizedNumber(plan.utilizationPercent, lang)}%</span>
            </>
          ) : (
            <span className="text-amber-700 dark:text-amber-300">
              {isFa
                ? 'ابعاد از فضای قابل چاپ بزرگ‌تر است'
                : 'Exceeds printable sheet area'}
            </span>
          )}
        </div>

        <button
          type="submit"
          data-auto-pack-apply
          disabled={!resolvedTarget || !plan.fits}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-xs transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
        >
          <Grid2x2Plus className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{isFa ? 'چیدمان بیشینه در صفحه' : 'Pack Max on Sheet'}</span>
        </button>
      </div>
    </form>
  );
};
