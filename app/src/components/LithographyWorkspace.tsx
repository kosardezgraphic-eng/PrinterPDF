import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileCheck2,
  FilePlus2,
  FileText,
  FolderInput,
  FolderOpen,
  Layers,
  Palette,
  Play,
  RefreshCw,
  Save,
  ScanSearch,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  XCircle,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  BUILT_IN_LITHO_PLATE_SIZES,
  OFFSET_ICC_PROFILES,
  buildSeparationBuffersFromRgba,
  renderSeparationPreviewRgba,
  resolveLithoPlateSizeMm,
  type SeparationBuffers,
} from '../engine/lithographyColor';
import { renderPdfPageToRgba } from '../engine/lithographyPreflight';
import { ACCEPTED_DOCUMENT_INPUT_ACCEPT } from '../engine/universalImageDecoder';
import { formatShamsiDate, toPersianDigits } from '../i18n/shamsi';
import type {
  LithoExportDpi,
  LithoGcrLevel,
  LithoIccProfileId,
  LithoOutputFormat,
  LithoPlateOrientation,
  LithoRenderingIntent,
} from '@shared/models';

type RightTabId = 'preflight' | 'color' | 'export';

interface HoverCoverage {
  c: number;
  m: number;
  y: number;
  k: number;
  spots: Record<string, number>;
  tac: number;
  xMm: number;
  yMm: number;
}

function formatBytesReadable(bytes: number, isFa: boolean): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) {
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    return isFa ? `${toPersianDigits(mb)} MB` : `${mb} MB`;
  }
  const kb = Math.max(1, Math.round(bytes / 1024));
  return isFa ? `${toPersianDigits(kb)} KB` : `${kb} KB`;
}

export const LithographyWorkspace: React.FC = () => {
  const {
    settings,
    pages,
    lithoJobs,
    lithoSelectedJobId,
    lithoSelectedPageNumber,
    lithoColorSettings,
    lithoExportSettings,
    lithoTacThreshold,
    lithoPresets,
    lithoSavedPlateSizes,
    lithoActivePresetId,
    lithoHotFolder,
    lithoBusy,
    lithoProgress,
    lithoLastExportFiles,
    initializeLithoPresets,
    importLithoFiles,
    loadSampleLithoJob,
    selectLithoJob,
    setLithoSelectedPage,
    removeLithoJob,
    clearLithoJobs,
    updateLithoColorSettings,
    setLithoSpotHandling,
    updateLithoExportSettings,
    setLithoTacThreshold,
    uploadCustomIccProfile,
    runPreflightForJob,
    autoFixLithoJob,
    exportLithoJobOutputs,
    downloadLithoPreflightReport,
    saveLithoPreset,
    applyLithoPreset,
    deleteLithoPreset,
    saveLithoPlateSize,
    deleteLithoPlateSize,
    selectLithoOutputFolder,
    configureLithoHotFolder,
    processAllLithoJobs,
    sendStudioSheetsToLithography,
  } = useAppStore();

  const isFa = settings.language === 'fa';
  const hasStudioSelection = useMemo(
    () => (pages ?? []).some((p) => p.selectedForPrint),
    [pages]
  );
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const iccInputRef = useRef<HTMLInputElement>(null);
  const hotFolderFileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const [rightTab, setRightTab] = useState<RightTabId>('preflight');
  const [presetNameInput, setPresetNameInput] = useState('');
  const [plateNameInput, setPlateNameInput] = useState('');
  const [showTechNotes, setShowTechNotes] = useState(false);

  // Plate view toggles
  const [enabledC, setEnabledC] = useState(true);
  const [enabledM, setEnabledM] = useState(true);
  const [enabledY, setEnabledY] = useState(true);
  const [enabledK, setEnabledK] = useState(true);
  const [enabledSpots, setEnabledSpots] = useState<Record<string, boolean>>({});
  const [monochromeSinglePlate, setMonochromeSinglePlate] = useState(false);
  const [highlightTacExceed, setHighlightTacExceed] = useState(false);
  const [showPressMarks, setShowPressMarks] = useState(true);

  // Viewport Zoom / Pan / Hover Coverage
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const panDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [hoverCoverage, setHoverCoverage] = useState<HoverCoverage | null>(null);

  // Rendered page raster & separation cache
  const [baseRaster, setBaseRaster] = useState<{
    key: string;
    width: number;
    height: number;
    rgba: Uint8ClampedArray;
  } | null>(null);
  const [renderingPage, setRenderingPage] = useState(false);

  useEffect(() => {
    void initializeLithoPresets();
  }, [initializeLithoPresets]);

  const activeJob = useMemo(
    () => lithoJobs.find((j) => j.id === lithoSelectedJobId) ?? lithoJobs[0] ?? null,
    [lithoJobs, lithoSelectedJobId]
  );
  const activeBytes = activeJob?.fixedBytes ?? activeJob?.sourceBytes ?? null;
  const activeMeta = activeJob?.metadata ?? null;
  const activePreflight = activeJob?.preflight ?? null;
  const activePageInfo = useMemo(
    () =>
      activeMeta?.pages.find((p) => p.pageNumber === lithoSelectedPageNumber) ??
      activeMeta?.pages[0] ??
      null,
    [activeMeta, lithoSelectedPageNumber]
  );

  // Render active PDF page once into RGBA surface
  useEffect(() => {
    if (!activeJob || !activeBytes) {
      setBaseRaster(null);
      return;
    }
    const renderKey = `${activeJob.id}:${activeJob.fixedBytes ? 'fixed' : 'src'}:${lithoSelectedPageNumber}`;
    let cancelled = false;
    setRenderingPage(true);

    void renderPdfPageToRgba(activeBytes, lithoSelectedPageNumber, 960)
      .then((res) => {
        if (cancelled) return;
        if (res) {
          setBaseRaster({ key: renderKey, ...res });
        } else {
          setBaseRaster(null);
        }
      })
      .catch(() => {
        if (!cancelled) setBaseRaster(null);
      })
      .finally(() => {
        if (!cancelled) setRenderingPage(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeJob, activeBytes, lithoSelectedPageNumber]);

  // Compute C/M/Y/K + Spot separation buffers whenever raster or ICC/GCR/TAC/Black settings change
  const separationBuffers: SeparationBuffers | null = useMemo(() => {
    if (!baseRaster || !activeMeta) return null;
    return buildSeparationBuffersFromRgba(
      baseRaster.rgba,
      baseRaster.width,
      baseRaster.height,
      lithoColorSettings,
      activeMeta.detectedSpots,
      lithoTacThreshold
    );
  }, [baseRaster, activeMeta, lithoColorSettings, lithoTacThreshold]);

  // Paint separated plates onto preview canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !separationBuffers || !activeMeta) return;
    canvas.width = separationBuffers.width;
    canvas.height = separationBuffers.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const previewRgba = renderSeparationPreviewRgba(separationBuffers, {
      enabledC,
      enabledM,
      enabledY,
      enabledK,
      enabledSpots,
      spotChannels: activeMeta.detectedSpots,
      simulateOverprint: lithoColorSettings.simulateOverprint,
      highlightTacExceed,
      tacThresholdPercent: lithoTacThreshold,
      monochromeSinglePlate,
      settings: lithoColorSettings,
    });

    const imgData = ctx.createImageData(separationBuffers.width, separationBuffers.height);
    imgData.data.set(previewRgba);
    ctx.putImageData(imgData, 0, 0);
  }, [
    separationBuffers,
    activeMeta,
    enabledC,
    enabledM,
    enabledY,
    enabledK,
    enabledSpots,
    lithoColorSettings,
    highlightTacExceed,
    lithoTacThreshold,
    monochromeSinglePlate,
  ]);

  const toggleAllPlatesOn = () => {
    setEnabledC(true);
    setEnabledM(true);
    setEnabledY(true);
    setEnabledK(true);
    const nextSpots: Record<string, boolean> = {};
    for (const sp of activeMeta?.detectedSpots ?? []) nextSpots[sp.name] = true;
    setEnabledSpots(nextSpots);
  };

  const soloPlate = (plate: 'C' | 'M' | 'Y' | 'K' | string) => {
    setEnabledC(plate === 'C');
    setEnabledM(plate === 'M');
    setEnabledY(plate === 'Y');
    setEnabledK(plate === 'K');
    const nextSpots: Record<string, boolean> = {};
    for (const sp of activeMeta?.detectedSpots ?? []) {
      nextSpots[sp.name] = plate === sp.name;
    }
    setEnabledSpots(nextSpots);
  };

  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (panDragRef.current) {
        const dx = e.clientX - panDragRef.current.startX;
        const dy = e.clientY - panDragRef.current.startY;
        setPan({ x: panDragRef.current.origX + dx, y: panDragRef.current.origY + dy });
        return;
      }
      const canvas = previewCanvasRef.current;
      if (!canvas || !separationBuffers) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const px = Math.max(
        0,
        Math.min(
          separationBuffers.width - 1,
          Math.floor(((e.clientX - rect.left) / rect.width) * separationBuffers.width)
        )
      );
      const py = Math.max(
        0,
        Math.min(
          separationBuffers.height - 1,
          Math.floor(((e.clientY - rect.top) / rect.height) * separationBuffers.height)
        )
      );
      const idx = py * separationBuffers.width + px;
      const spotVals: Record<string, number> = {};
      for (const [sName, sBuf] of separationBuffers.spots.entries()) {
        spotVals[sName] = sBuf[idx] ?? 0;
      }
      const pageW = activePageInfo?.mediaBoxMm.width ?? 210;
      const pageH = activePageInfo?.mediaBoxMm.height ?? 297;
      setHoverCoverage({
        c: separationBuffers.c[idx] ?? 0,
        m: separationBuffers.m[idx] ?? 0,
        y: separationBuffers.y[idx] ?? 0,
        k: separationBuffers.k[idx] ?? 0,
        spots: spotVals,
        tac: separationBuffers.tac[idx] ?? 0,
        xMm: Math.round(((px / Math.max(1, separationBuffers.width)) * pageW) * 10) / 10,
        yMm: Math.round(((py / Math.max(1, separationBuffers.height)) * pageH) * 10) / 10,
      });
    },
    [separationBuffers, activePageInfo]
  );

  const keptSpots = useMemo(
    () =>
      (activeMeta?.detectedSpots ?? []).filter(
        (sp) => (lithoColorSettings.spotChannels[sp.name] ?? sp.handling) === 'keep-spot'
      ),
    [activeMeta, lithoColorSettings.spotChannels]
  );

  const allPlatesActive =
    enabledC &&
    enabledM &&
    enabledY &&
    enabledK &&
    keptSpots.every((sp) => enabledSpots[sp.name] ?? true);

  const resolvedPlate = useMemo(() => {
    const docW = activePageInfo?.widthMm ?? 210;
    const docH = activePageInfo?.heightMm ?? 297;
    return resolveLithoPlateSizeMm(lithoExportSettings, docW, docH, lithoSavedPlateSizes);
  }, [lithoExportSettings, activePageInfo, lithoSavedPlateSizes]);

  const activePlatePreviewLabel = useMemo(() => {
    const activeSpots = keptSpots.filter((sp) => enabledSpots[sp.name] ?? true);
    const parts: string[] = [];
    if (enabledC) parts.push('C');
    if (enabledM) parts.push('M');
    if (enabledY) parts.push('Y');
    if (enabledK) parts.push('K');
    for (const sp of activeSpots) parts.push(sp.name);
    return parts.length > 0 ? parts.join('+') : 'NONE';
  }, [enabledC, enabledM, enabledY, enabledK, keptSpots, enabledSpots]);

  const shamsiToday = useMemo(() => formatShamsiDate(new Date()), []);

  return (
    <div
      dir={isFa ? 'rtl' : 'ltr'}
      data-lithography-workspace
      className="flex min-h-0 flex-1 flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 overflow-hidden"
    >
      {/* Hidden File Inputs */}
      <input
        ref={pdfInputRef}
        type="file"
        accept={ACCEPTED_DOCUMENT_INPUT_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          if (files.length) void importLithoFiles(files);
          e.target.value = '';
        }}
      />
      <input
        ref={iccInputRef}
        type="file"
        accept=".icc,.icm"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void uploadCustomIccProfile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={hotFolderFileInputRef}
        type="file"
        accept={ACCEPTED_DOCUMENT_INPUT_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          if (files.length) {
            void importLithoFiles(files, { fromHotFolder: true }).then(() => {
              if (lithoHotFolder.autoExportOnDrop) {
                void processAllLithoJobs();
              }
            });
          }
          e.target.value = '';
        }}
      />

      {/* Main 3-Pane Prepress Workbench */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row overflow-hidden">
        {/* ====================================================================
            LEFT RAIL: File Intake, Queue, Multi-Page, Presets & Hot Folder
           ================================================================== */}
        <aside className="flex w-full lg:w-72 shrink-0 flex-col border-b lg:border-b-0 lg:border-e border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-y-auto">
          {/* File Drop & Action Buttons */}
          <div className="border-b border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                <ScanSearch className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span>{isFa ? 'ورود فایل کارها' : 'Job Intake'}</span>
              </div>
              {lithoJobs.length > 0 && (
                <button
                  type="button"
                  onClick={clearLithoJobs}
                  className="text-[11px] font-medium text-rose-600 hover:underline dark:text-rose-400 cursor-pointer"
                >
                  {isFa ? 'پاک‌سازی صف' : 'Clear'}
                </button>
              )}
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(e) => {
                e.preventDefault();
                const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
                if (files.length) void importLithoFiles(files);
              }}
              onClick={() => pdfInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-center transition-colors hover:border-amber-500 hover:bg-amber-50/40 dark:border-slate-700 dark:bg-slate-950/50 dark:hover:border-amber-400"
            >
              <Upload className="mb-1 h-4 w-4 text-amber-600 dark:text-amber-400" />
              <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                {isFa ? 'فایل را اینجا رها یا انتخاب کنید' : 'Drop or select file for Lithography'}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                {isFa ? 'PDF، PSD، TIFF، HEIC، WebP، PNG و JPG' : 'PDF, PSD, TIFF, HEIC, WebP, PNG & JPG'}
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                data-litho-pick-pdf
                onClick={() => pdfInputRef.current?.click()}
                className="flex h-7 items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                <FilePlus2 className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                <span>{isFa ? 'انتخاب فایل' : 'Add File'}</span>
              </button>
              <button
                type="button"
                data-litho-sample-pdf
                onClick={() => void loadSampleLithoJob()}
                className="flex h-7 items-center justify-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-300 cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{isFa ? 'فایل تست ۴رنگ' : 'Sample 4C PDF'}</span>
              </button>
            </div>

            <button
              type="button"
              data-litho-from-studio
              disabled={!hasStudioSelection || lithoBusy}
              onClick={() => void sendStudioSheetsToLithography('all')}
              className="mt-1.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-sky-300 bg-sky-50 px-2 text-[11px] font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-45 dark:border-sky-500/40 dark:bg-sky-950/30 dark:text-sky-300 cursor-pointer"
            >
              <Layers className="h-3.5 w-3.5" />
              <span>{isFa ? 'ارسال شیت‌های استادیو به لیتوگرافی' : 'Import Composed Studio Sheets'}</span>
            </button>
          </div>

          {/* Job Queue List */}
          <div className="border-b border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                {isFa
                  ? `صف کارهای لیتوگرافی (${toPersianDigits(lithoJobs.length)})`
                  : `Job Queue (${lithoJobs.length})`}
              </span>
              {lithoJobs.length > 1 && (
                <button
                  type="button"
                  disabled={lithoBusy}
                  onClick={() => void processAllLithoJobs()}
                  className="flex items-center gap-1 rounded bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-amber-500 dark:text-slate-950 cursor-pointer"
                >
                  <Play className="h-2.5 w-2.5" />
                  <span>{isFa ? 'خروجی همه' : 'Run All'}</span>
                </button>
              )}
            </div>

            {lithoJobs.length === 0 ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
                {isFa
                  ? 'هنوز کاری در صف نیست. یک فایل PDF اضافه کنید یا از دکمه «فایل تست ۴رنگ» استفاده نمایید.'
                  : 'No jobs queued yet.'}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto">
                {lithoJobs.map((job) => {
                  const selected = activeJob?.id === job.id;
                  const errCnt = job.preflight?.errorCount ?? 0;
                  const warnCnt = job.preflight?.warningCount ?? 0;
                  const statusText =
                    job.status === 'processing'
                      ? isFa
                        ? 'در حال بررسی...'
                        : 'Processing...'
                      : job.status === 'error'
                        ? isFa
                          ? 'خطا'
                          : 'Error'
                        : job.status === 'queued'
                          ? isFa
                            ? 'در انتظار'
                            : 'Queued'
                          : errCnt > 0
                            ? isFa
                              ? `${toPersianDigits(errCnt)} خطا`
                              : `${errCnt} err`
                            : warnCnt > 0
                              ? isFa
                                ? `${toPersianDigits(warnCnt)} هشدار`
                                : `${warnCnt} warn`
                              : isFa
                                ? 'تأیید شده'
                                : 'Ready';

                  return (
                    <div
                      key={job.id}
                      onClick={() => selectLithoJob(job.id)}
                      className={`group flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[11px] cursor-pointer transition-colors ${
                        selected
                          ? 'border-amber-500 bg-amber-50/70 dark:border-amber-400 dark:bg-amber-950/25'
                          : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/70'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-slate-800 dark:text-slate-100">
                          {job.fileName}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                          <span>
                            {job.metadata
                              ? isFa
                                ? `${toPersianDigits(job.metadata.pageCount)} ص`
                                : `${job.metadata.pageCount}p`
                              : formatBytesReadable(job.fileSizeBytes, isFa)}
                          </span>
                          <span>·</span>
                          <span
                            className={
                              job.status === 'error' || errCnt > 0
                                ? 'font-bold text-rose-600 dark:text-rose-400'
                                : warnCnt > 0
                                  ? 'font-semibold text-amber-600 dark:text-amber-400'
                                  : 'font-semibold text-emerald-600 dark:text-emerald-400'
                            }
                          >
                            {statusText}
                          </span>
                          {job.outputFilesCount ? (
                            <>
                              <span>·</span>
                              <span className="text-sky-700 dark:text-sky-300">
                                {isFa
                                  ? `${toPersianDigits(job.outputFilesCount)} خروجی`
                                  : `${job.outputFilesCount} files`}
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={isFa ? 'حذف کار' : 'Remove job'}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeLithoJob(job.id);
                        }}
                        className="rounded p-1 text-slate-400 opacity-70 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 dark:hover:bg-rose-950/40 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Multi-page selector when PDF has pages */}
          {activeMeta && activeMeta.pages.length > 0 && (
            <div className="border-b border-slate-200 p-3 dark:border-slate-800">
              <div className="mb-2 text-[11px] font-bold text-slate-700 dark:text-slate-200">
                {isFa
                  ? `صفحات سند (${toPersianDigits(activeMeta.pageCount)})`
                  : `Pages (${activeMeta.pageCount})`}
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto">
                {activeMeta.pages.map((pg) => {
                  const active = pg.pageNumber === lithoSelectedPageNumber;
                  return (
                    <button
                      key={pg.pageNumber}
                      type="button"
                      onClick={() => setLithoSelectedPage(pg.pageNumber)}
                      className={`flex flex-col items-start rounded-md border px-2 py-1.5 text-start text-[10px] transition-colors cursor-pointer ${
                        active
                          ? 'border-sky-500 bg-sky-50 text-sky-900 dark:border-sky-400 dark:bg-sky-950/35 dark:text-sky-100'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-300'
                      }`}
                    >
                      <span className="font-bold tabular-nums">
                        {isFa ? `صفحه ${toPersianDigits(pg.pageNumber)}` : `Page ${pg.pageNumber}`}
                      </span>
                      <span className="text-[9.5px] text-slate-500 dark:text-slate-400 tabular-nums">
                        {Math.round(pg.widthMm)}×{Math.round(pg.heightMm)} mm
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Job Presets ("قالب کار") */}
          <div className="border-b border-slate-200 p-3 dark:border-slate-800">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-200">
              <Save className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{isFa ? 'قالب‌های کار (Job Presets)' : 'Job Presets'}</span>
            </div>
            <div className="flex gap-1">
              <select
                aria-label={isFa ? 'انتخاب قالب کار' : 'Select Lithography Preset'}
                value={lithoActivePresetId}
                onChange={(e) => applyLithoPreset(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {lithoPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {lithoPresets.length > 1 && (
                <button
                  type="button"
                  title={isFa ? 'حذف قالب انتخابی' : 'Delete preset'}
                  onClick={() => deleteLithoPreset(lithoActivePresetId)}
                  className="rounded-md border border-slate-200 px-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:hover:bg-rose-950/30 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex gap-1">
              <input
                type="text"
                value={presetNameInput}
                onChange={(e) => setPresetNameInput(e.target.value)}
                placeholder={isFa ? 'نام قالب جدید...' : 'New preset name...'}
                className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => {
                  if (saveLithoPreset(presetNameInput)) {
                    setPresetNameInput('');
                  }
                }}
                className="rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 cursor-pointer shrink-0"
              >
                {isFa ? 'ذخیره' : 'Save'}
              </button>
            </div>
          </div>

          {/* Hot Folder Automation */}
          <div className="p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-200">
                <FolderInput className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{isFa ? 'پوشه خودکار (Hot Folder)' : 'Hot Folder'}</span>
              </div>
              <label className="flex items-center gap-1 text-[10px] font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={lithoHotFolder.enabled}
                  onChange={(e) =>
                    void configureLithoHotFolder({ enabled: e.target.checked })
                  }
                  className="accent-emerald-600"
                />
                <span>{lithoHotFolder.enabled ? (isFa ? 'فعال' : 'Active') : (isFa ? 'خاموش' : 'Off')}</span>
              </label>
            </div>

            <div className="space-y-1.5 text-[10.5px]">
              <select
                value={lithoHotFolder.presetId}
                onChange={(e) =>
                  void configureLithoHotFolder({ presetId: e.target.value })
                }
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {lithoPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {isFa ? `قالب: ${p.name}` : `Preset: ${p.name}`}
                  </option>
                ))}
              </select>

              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    void selectLithoOutputFolder().then((folder) => {
                      if (folder) {
                        void configureLithoHotFolder({ folderPath: folder, enabled: true });
                      } else {
                        hotFolderFileInputRef.current?.click();
                      }
                    });
                  }}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10.5px] font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-300 cursor-pointer"
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {lithoHotFolder.folderPath
                      ? lithoHotFolder.folderPath
                      : isFa
                        ? 'انتخاب پوشه یا ورود دسته PDF'
                        : 'Select Watch Folder / Batch Drop'}
                  </span>
                </button>
              </div>

              <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lithoHotFolder.autoExportOnDrop}
                  onChange={(e) =>
                    void configureLithoHotFolder({ autoExportOnDrop: e.target.checked })
                  }
                  className="accent-emerald-600"
                />
                <span>
                  {isFa
                    ? 'رفع خطا و خروجی خودکار به محض ورود PDF'
                    : 'Auto-fix & export on PDF drop'}
                </span>
              </label>

              {lithoHotFolder.lastError && (
                <div className="rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  {lithoHotFolder.lastError}
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* ====================================================================
            CENTER VIEWPORT: Separation Plates, Overprint, Zoom/Pan, Ink Probe
           ================================================================== */}
        <main className="flex min-w-0 min-h-0 flex-1 flex-col bg-slate-100 dark:bg-slate-950 overflow-hidden">
          {/* Plate Control Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900">
            {/* CMYK + Spot Plate Toggles */}
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={toggleAllPlatesOn}
                className={`h-7 rounded-md border px-2 text-[11px] font-bold transition-colors cursor-pointer ${
                  allPlatesActive
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                {isFa ? 'همه پلیت‌ها' : 'Composite'}
              </button>

              {(
                [
                  { id: 'C', label: 'C', color: '#009fe3', active: enabledC, toggle: () => setEnabledC((v) => !v) },
                  { id: 'M', label: 'M', color: '#e5007d', active: enabledM, toggle: () => setEnabledM((v) => !v) },
                  { id: 'Y', label: 'Y', color: '#eab308', active: enabledY, toggle: () => setEnabledY((v) => !v) },
                  { id: 'K', label: 'K', color: '#111827', active: enabledK, toggle: () => setEnabledK((v) => !v) },
                ] as const
              ).map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  data-plate-toggle={pl.id}
                  onClick={pl.toggle}
                  onDoubleClick={() => soloPlate(pl.id)}
                  title={
                    isFa
                      ? `کلیک: روشن/خاموش پلیت ${pl.id} · دوبار کلیک: نمایش تکی`
                      : `Click: toggle ${pl.id} · Double-click: solo`
                  }
                  className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-bold tabular-nums transition-colors cursor-pointer ${
                    pl.active
                      ? 'border-slate-300 bg-white text-slate-900 shadow-2xs dark:border-slate-600 dark:bg-slate-800 dark:text-white'
                      : 'border-slate-200 bg-slate-100 text-slate-400 line-through dark:border-slate-800 dark:bg-slate-900 dark:text-slate-600'
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-sm border border-black/15 shrink-0"
                    style={{ backgroundColor: pl.color }}
                  />
                  <span>{pl.label}</span>
                </button>
              ))}

              {keptSpots.map((sp) => {
                const isOn = enabledSpots[sp.name] ?? true;
                return (
                  <button
                    key={sp.name}
                    type="button"
                    data-plate-toggle={sp.name}
                    onClick={() =>
                      setEnabledSpots((prev) => ({
                        ...prev,
                        [sp.name]: !(prev[sp.name] ?? true),
                      }))
                    }
                    onDoubleClick={() => soloPlate(sp.name)}
                    title={
                      isFa
                        ? `پلیت اسپات ${sp.name} (دوبار کلیک برای نمایش تکی)`
                        : `Spot plate ${sp.name}`
                    }
                    className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-bold transition-colors cursor-pointer ${
                      isOn
                        ? 'border-emerald-400 bg-emerald-50 text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : 'border-slate-200 bg-slate-100 text-slate-400 line-through dark:border-slate-800 dark:bg-slate-900 dark:text-slate-600'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-sm border border-black/20 shrink-0"
                      style={{ backgroundColor: sp.previewHex }}
                    />
                    <span className="max-w-[90px] truncate">{sp.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Simulation & Zoom Controls */}
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lithoColorSettings.simulateOverprint}
                  onChange={(e) =>
                    updateLithoColorSettings({ simulateOverprint: e.target.checked })
                  }
                  className="accent-amber-600"
                />
                <span>{isFa ? 'شبیه‌سازی Overprint' : 'Overprint'}</span>
              </label>

              <label
                title={
                  isFa
                    ? 'نمایش پلیت منفرد به‌صورت فیلم سیاه‌وسفید زینک'
                    : 'View solo plate as black-and-white plate film'
                }
                className="flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={monochromeSinglePlate}
                  onChange={(e) => setMonochromeSinglePlate(e.target.checked)}
                  className="accent-slate-700"
                />
                <span>{isFa ? 'فیلم سیاه‌وسفید' : 'Mono Plate'}</span>
              </label>

              <label className="flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  data-litho-toggle-marks
                  checked={showPressMarks}
                  onChange={(e) => setShowPressMarks(e.target.checked)}
                  className="accent-emerald-600"
                />
                <span>{isFa ? 'علائم لیتوگرافی و پلیت' : 'Press Marks'}</span>
              </label>

              <button
                type="button"
                onClick={() => setHighlightTacExceed((v) => !v)}
                className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-colors cursor-pointer ${
                  highlightTacExceed
                    ? 'border-rose-500 bg-rose-600 text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>{isFa ? `هشدار TAC > ${toPersianDigits(lithoTacThreshold)}٪` : `TAC > ${lithoTacThreshold}%`}</span>
              </button>

              <div className="flex h-7 items-center rounded-md border border-slate-200 bg-slate-50 px-1 dark:border-slate-700 dark:bg-slate-800">
                <button
                  type="button"
                  aria-label="Zoom Out"
                  onClick={() => setZoom((z) => Math.max(0.3, Math.round((z - 0.2) * 10) / 10))}
                  className="p-1 text-slate-600 hover:text-slate-900 dark:text-slate-300 cursor-pointer"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-[42px] text-center text-[11px] font-bold tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  aria-label="Zoom In"
                  onClick={() => setZoom((z) => Math.min(5, Math.round((z + 0.2) * 10) / 10))}
                  className="p-1 text-slate-600 hover:text-slate-900 dark:text-slate-300 cursor-pointer"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title={isFa ? 'تنظیم بزرگ‌نمایی و مکان پیش‌فرض' : 'Reset View'}
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                  className="p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Canvas Area */}
          <div
            onWheel={(e) => {
              if (e.ctrlKey || Math.abs(e.deltaY) > 0) {
                const factor = e.deltaY < 0 ? 1.1 : 0.9;
                setZoom((z) => Math.max(0.3, Math.min(5, Math.round(z * factor * 100) / 100)));
              }
            }}
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 select-none"
          >
            {lithoBusy && (
              <div className="absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-md border border-amber-300 bg-white/95 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm dark:border-amber-500/40 dark:bg-slate-900/95 dark:text-amber-300">
                {isFa
                  ? `در حال پردازش پیش‌چاپ... ${lithoProgress > 0 ? `${toPersianDigits(lithoProgress)}٪` : ''}`
                  : `Processing prepress... ${lithoProgress > 0 ? `${lithoProgress}%` : ''}`}
              </div>
            )}

            {!activeJob ? (
              <div className="flex max-w-md flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
                <Layers className="mb-3 h-10 w-10 text-amber-500" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {isFa ? 'محیط پیش‌چاپ و لیتوگرافی افست' : 'Offset Prepress & Lithography'}
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {isFa
                    ? 'فایل مشتری (PDF، PSD، TIFF، HEIC، WebP، JPG یا PNG) را بکشید و رها کنید یا شیت ساخته‌شده استادیو را مستقیماً وارد کنید تا پیش‌کنترل، نمایش علائم برش و تفکیک پلیت انجام شود.'
                    : 'Drop a customer file (PDF, PSD, TIFF, HEIC, WebP, PNG, JPG) or import Studio sheets for Preflight, live press marks preview, and plate export.'}
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => pdfInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-950 cursor-pointer"
                  >
                    <FilePlus2 className="h-3.5 w-3.5" />
                    <span>{isFa ? 'انتخاب فایل (PDF / عکس / PSD)' : 'Open File'}</span>
                  </button>
                  {hasStudioSelection && (
                    <button
                      type="button"
                      onClick={() => void sendStudioSheetsToLithography('all')}
                      className="flex items-center gap-1.5 rounded-md border border-sky-400 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-800 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-950/30 dark:text-sky-200 cursor-pointer"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      <span>{isFa ? 'ورود شیت از استادیو' : 'Import from Studio'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void loadSampleLithoJob()}
                    className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    <span>{isFa ? 'باز کردن نمونه تست ۴ رنگ' : 'Load 2-Page 4C Sample'}</span>
                  </button>
                </div>
              </div>
            ) : !separationBuffers ? (
              <div className="rounded-lg border border-slate-200 bg-white px-6 py-5 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                {renderingPage
                  ? isFa
                    ? 'در حال رندر و تفکیک پلیت‌های رنگی صفحه...'
                    : 'Rendering & separating page plates...'
                  : isFa
                    ? 'پیش‌نمایش پیکسلی در این محیط در دسترس نیست؛ کنترل ساختاری و خروجی پلیت آماده است.'
                    : 'Canvas raster preview unavailable; structural inspection & export ready.'}
              </div>
            ) : (() => {
              const docW = Math.max(20, activePageInfo?.widthMm ?? 210);
              const docH = Math.max(20, activePageInfo?.heightMm ?? 297);
              const trim = activePageInfo?.trimBoxMm ?? activePageInfo?.mediaBoxMm;
              const media = activePageInfo?.mediaBoxMm;
              const trimLeftPct = trim && media && media.width > 0 ? Math.max(0, Math.min(20, ((trim.x - media.x) / media.width) * 100)) : 0;
              const trimRightPct = trim && media && media.width > 0 ? Math.max(0, Math.min(20, (((media.x + media.width) - (trim.x + trim.width)) / media.width) * 100)) : 0;
              const trimTopPct = trim && media && media.height > 0 ? Math.max(0, Math.min(20, (((media.y + media.height) - (trim.y + trim.height)) / media.height) * 100)) : 0;
              const trimBottomPct = trim && media && media.height > 0 ? Math.max(0, Math.min(20, ((trim.y - media.y) / media.height) * 100)) : 0;

              const extraXRatio = resolvedPlate.isFitDocument ? 0.08 : Math.max(0.06, Math.min(0.65, (resolvedPlate.widthMm - docW) / docW / 2));
              const extraYRatio = resolvedPlate.isFitDocument ? 0.09 : Math.max(0.07, Math.min(0.65, (resolvedPlate.heightMm - docH) / docH / 2));
              const padX = showPressMarks ? Math.round(Math.max(24, Math.min(84, extraXRatio * 220))) : 8;
              const padY = showPressMarks ? Math.round(Math.max(28, Math.min(84, extraYRatio * 220))) : 8;

              return (
                <div
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'center center',
                    paddingLeft: `${padX}px`,
                    paddingRight: `${padX}px`,
                    paddingTop: `${padY}px`,
                    paddingBottom: `${padY + (showPressMarks && !resolvedPlate.isFitDocument ? 10 : 0)}px`,
                  }}
                  data-litho-plate-frame
                  className="relative shadow-2xl border border-slate-400 bg-slate-100/95 dark:border-slate-600 dark:bg-slate-200"
                >
                  {/* Plate dimension tag at top */}
                  {showPressMarks && (
                    <div
                      data-litho-press-marks
                      className="pointer-events-none absolute inset-0"
                    >
                      <div className="absolute top-1 left-2 right-2 flex items-center justify-between text-[8.5px] font-mono font-semibold text-slate-600">
                        <span>
                          {resolvedPlate.isFitDocument
                            ? `Sheet: ${Math.round(resolvedPlate.widthMm)}×${Math.round(resolvedPlate.heightMm)} mm`
                            : `Plate: ${Math.round(resolvedPlate.widthMm)}×${Math.round(resolvedPlate.heightMm)} mm`}
                        </span>
                        <span>
                          {`${lithoExportSettings.jobNamePrefix || activeJob.fileName} · ${activePlatePreviewLabel} · P${lithoSelectedPageNumber}`}
                        </span>
                      </div>

                      {/* Color Control Bar in Top Margin */}
                      {lithoExportSettings.includeColorBar && (
                        <div
                          data-litho-color-bar
                          className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-[2px] border border-slate-400/70 bg-white px-1 py-0.5 shadow-2xs"
                        >
                          {(
                            monochromeSinglePlate
                              ? ['#d1d5db', '#9ca3af', '#6b7280', '#374151', '#111827']
                              : ['#009fe3', '#7dd3fc', '#e5007d', '#f472b6', '#facc15', '#fef08a', '#111827', '#6b7280', '#dc2626', '#16a34a', '#1d4ed8']
                          ).map((hex, i) => (
                            <span
                              key={i}
                              className="h-2 w-2.5 border border-black/15"
                              style={{ backgroundColor: hex }}
                            />
                          ))}
                          {keptSpots.map((sp) => (
                            <span
                              key={sp.name}
                              title={sp.name}
                              className="h-2 w-2.5 border border-black/25"
                              style={{ backgroundColor: sp.previewHex }}
                            />
                          ))}
                        </div>
                      )}

                      {/* Registration Bullseyes (Top, Bottom, Left, Right) */}
                      {lithoExportSettings.includeRegistrationMarks && (
                        <>
                          {[
                            { cls: 'left-1/2 -translate-x-1/2 top-1.5' },
                            { cls: 'left-1/2 -translate-x-1/2 bottom-1.5' },
                            { cls: 'left-1.5 top-1/2 -translate-y-1/2' },
                            { cls: 'right-1.5 top-1/2 -translate-y-1/2' },
                          ].map((pos, idx) => (
                            <svg
                              key={idx}
                              viewBox="0 0 16 16"
                              className={`absolute h-3.5 w-3.5 text-slate-900 ${pos.cls}`}
                            >
                              <circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="1" />
                              <line x1="0" y1="8" x2="16" y2="8" stroke="currentColor" strokeWidth="0.9" />
                              <line x1="8" y1="0" x2="8" y2="16" stroke="currentColor" strokeWidth="0.9" />
                            </svg>
                          ))}
                        </>
                      )}

                      {/* Slug Line & Gripper indicator at Bottom Margin */}
                      {lithoExportSettings.includeSlug && (
                        <div className="absolute bottom-1 left-2 right-2 flex items-center justify-between text-[8px] font-mono text-slate-700">
                          <span>
                            {`${lithoColorSettings.iccProfile} · TAC≤${lithoTacThreshold}% · ${shamsiToday}`}
                          </span>
                          {!resolvedPlate.isFitDocument && (
                            <span className="font-bold text-slate-800">
                              {isFa ? '▲ لبه پنجه ماشین (Gripper)' : '▲ GRIPPER EDGE'}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Artwork + TrimBox/Crop Marks Wrapper */}
                  <div className="relative bg-white shadow-sm ring-1 ring-slate-300">
                    <canvas
                      ref={previewCanvasRef}
                      data-litho-preview-canvas
                      onPointerDown={(e) => {
                        if (e.button === 0) {
                          panDragRef.current = {
                            startX: e.clientX,
                            startY: e.clientY,
                            origX: pan.x,
                            origY: pan.y,
                          };
                        }
                      }}
                      onPointerUp={() => {
                        panDragRef.current = null;
                      }}
                      onPointerLeave={() => {
                        panDragRef.current = null;
                        setHoverCoverage(null);
                      }}
                      onPointerMove={handleCanvasPointerMove}
                      className="block max-h-[calc(100vh-270px)] max-w-full cursor-crosshair object-contain"
                    />

                    {/* TrimBox, BleedBox & Corner Crop Marks over exact artwork bounds */}
                    {showPressMarks && (
                      <div className="pointer-events-none absolute inset-0">
                        {/* Outer BleedBox border */}
                        <div className="absolute inset-0 border border-dashed border-pink-500/60" />

                        {/* Inner TrimBox guide */}
                        <div
                          style={{
                            left: `${trimLeftPct}%`,
                            right: `${trimRightPct}%`,
                            top: `${trimTopPct}%`,
                            bottom: `${trimBottomPct}%`,
                          }}
                          className="absolute border border-dashed border-sky-500/80"
                        >
                          {/* 4-corner L-shaped Crop Marks */}
                          {lithoExportSettings.includeCropMarks && (
                            <>
                              <span className="absolute -top-3.5 left-0 h-3 w-px bg-slate-900" />
                              <span className="absolute top-0 -left-3.5 h-px w-3 bg-slate-900" />
                              <span className="absolute -top-3.5 right-0 h-3 w-px bg-slate-900" />
                              <span className="absolute top-0 -right-3.5 h-px w-3 bg-slate-900" />
                              <span className="absolute -bottom-3.5 left-0 h-3 w-px bg-slate-900" />
                              <span className="absolute bottom-0 -left-3.5 h-px w-3 bg-slate-900" />
                              <span className="absolute -bottom-3.5 right-0 h-3 w-px bg-slate-900" />
                              <span className="absolute bottom-0 -right-3.5 h-px w-3 bg-slate-900" />
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Bottom Ink Coverage Inspector Bar */}
          <div
            data-litho-ink-inspector
            className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-center gap-3 tabular-nums">
              <span className="font-bold text-slate-700 dark:text-slate-200">
                {isFa ? 'سنجشگر درصد مرکب (Ink Coverage):' : 'Ink Coverage Inspector:'}
              </span>
              {hoverCoverage ? (
                <>
                  <span className="font-semibold text-sky-700 dark:text-sky-300">
                    C: {hoverCoverage.c}%
                  </span>
                  <span className="font-semibold text-pink-700 dark:text-pink-300">
                    M: {hoverCoverage.m}%
                  </span>
                  <span className="font-semibold text-amber-600 dark:text-amber-300">
                    Y: {hoverCoverage.y}%
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    K: {hoverCoverage.k}%
                  </span>
                  {Object.entries(hoverCoverage.spots).map(([sName, val]) => (
                    <span key={sName} className="font-semibold text-emerald-700 dark:text-emerald-300">
                      {sName}: {val}%
                    </span>
                  ))}
                  <span
                    className={`font-extrabold ${
                      hoverCoverage.tac > lithoTacThreshold
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    TAC: {hoverCoverage.tac}%
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    ({hoverCoverage.xMm}×{hoverCoverage.yMm} mm)
                  </span>
                </>
              ) : (
                <span className="text-slate-500 dark:text-slate-400">
                  {isFa
                    ? 'ماوس را روی صفحه حرکت دهید تا درصد دقیق هر مرکب و TAC همان نقطه نمایش داده شود.'
                    : 'Move cursor over the page to inspect exact ink % and TAC.'}
                </span>
              )}
            </div>

            {separationBuffers && (
              <div className="text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums">
                {isFa
                  ? `میانگین پوشش صفحه: C ${separationBuffers.averages.c}% · M ${separationBuffers.averages.m}% · Y ${separationBuffers.averages.y}% · K ${separationBuffers.averages.k}% · اوج TAC ${separationBuffers.averages.maxTacPercent}%`
                  : `Avg coverage: C ${separationBuffers.averages.c}% · M ${separationBuffers.averages.m}% · Y ${separationBuffers.averages.y}% · K ${separationBuffers.averages.k}% · Peak TAC ${separationBuffers.averages.maxTacPercent}%`}
              </div>
            )}
          </div>
        </main>

        {/* ====================================================================
            RIGHT INSPECTOR: Preflight | Color Management | Plates & Export
           ================================================================== */}
        <aside className="flex w-full lg:w-[390px] shrink-0 flex-col border-t lg:border-t-0 lg:border-s border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          {/* Inspector Tabs */}
          <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
            <button
              type="button"
              data-litho-tab="preflight"
              onClick={() => setRightTab('preflight')}
              className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-bold transition-colors cursor-pointer ${
                rightTab === 'preflight'
                  ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              <FileCheck2 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <span>{isFa ? 'پیش‌کنترل' : 'Preflight'}</span>
            </button>
            <button
              type="button"
              data-litho-tab="color"
              onClick={() => setRightTab('color')}
              className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-bold transition-colors cursor-pointer ${
                rightTab === 'color'
                  ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              <Palette className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
              <span>{isFa ? 'مدیریت رنگ' : 'Color'}</span>
            </button>
            <button
              type="button"
              data-litho-tab="export"
              onClick={() => setRightTab('export')}
              className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-bold transition-colors cursor-pointer ${
                rightTab === 'export'
                  ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              <Download className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{isFa ? 'خروجی پلیت' : 'Export'}</span>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3 text-xs">
            {/* Document Metadata Strip */}
            {activeMeta && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-bold text-slate-800 dark:text-slate-100">
                    {activeMeta.fileName}
                  </span>
                  <span className="shrink-0 text-[10.5px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                    {activeMeta.sourceFormat && activeMeta.sourceFormat !== 'PDF'
                      ? `${activeMeta.sourceFormat} → PDF ${activeMeta.pdfVersion}`
                      : `PDF ${activeMeta.pdfVersion}`}{' '}
                    · {activeMeta.overallColorMode}
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 text-[10.5px] text-slate-600 dark:text-slate-300 tabular-nums">
                  <div>
                    {isFa ? 'تعداد صفحه:' : 'Pages:'}{' '}
                    <strong>{toPersianDigits(activeMeta.pageCount)}</strong>
                  </div>
                  <div>
                    {isFa ? 'ابعاد صفحه:' : 'Size:'}{' '}
                    <strong>
                      {activePageInfo
                        ? `${Math.round(activePageInfo.widthMm)}×${Math.round(activePageInfo.heightMm)} mm`
                        : '—'}
                    </strong>
                  </div>
                  <div>
                    TrimBox:{' '}
                    <strong>
                      {activePageInfo?.trimBoxMm
                        ? `${Math.round(activePageInfo.trimBoxMm.width)}×${Math.round(activePageInfo.trimBoxMm.height)} mm`
                        : isFa
                          ? 'تعریف نشده'
                          : 'Missing'}
                    </strong>
                  </div>
                  <div>
                    BleedBox:{' '}
                    <strong>
                      {activePageInfo?.bleedBoxMm
                        ? `${Math.round(activePageInfo.bleedBoxMm.width)}×${Math.round(activePageInfo.bleedBoxMm.height)} mm`
                        : isFa
                          ? 'تعریف نشده'
                          : 'Missing'}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {/* ==============================================================
                TAB 1: PREFLIGHT
               ============================================================ */}
            {rightTab === 'preflight' && (
              <div className="space-y-3">
                {/* TAC Threshold Slider */}
                <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span>{isFa ? 'آستانه مجاز مجموع جوهر (TAC)' : 'TAC Warning Threshold'}</span>
                    <span className="tabular-nums text-amber-700 dark:text-amber-400">
                      {toPersianDigits(lithoTacThreshold)}٪
                    </span>
                  </div>
                  <input
                    type="range"
                    min={220}
                    max={360}
                    step={5}
                    value={lithoTacThreshold}
                    onChange={(e) => setLithoTacThreshold(Number(e.target.value))}
                    className="mt-1.5 w-full accent-amber-600 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 tabular-nums">
                    <span>۲۲۰٪ (تحریر)</span>
                    <span>۳۰۰٪ (گلاسه FOGRA39)</span>
                    <span>۳۶۰٪</span>
                  </div>
                </div>

                {!activePreflight ? (
                  <div className="rounded-lg border border-slate-200 p-4 text-center text-[11px] text-slate-500 dark:border-slate-800">
                    {isFa
                      ? 'برای مشاهده گزارش پیش‌کنترل، یک فایل PDF انتخاب کنید.'
                      : 'Load a PDF to inspect Preflight results.'}
                  </div>
                ) : (
                  <>
                    {/* Summary & Action Buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-950/60">
                      <div className="flex items-center gap-2 text-[11px] font-bold tabular-nums">
                        <span className="text-rose-600 dark:text-rose-400">
                          {isFa
                            ? `${toPersianDigits(activePreflight.errorCount)} خطا`
                            : `${activePreflight.errorCount} Errors`}
                        </span>
                        <span>·</span>
                        <span className="text-amber-600 dark:text-amber-400">
                          {isFa
                            ? `${toPersianDigits(activePreflight.warningCount)} هشدار`
                            : `${activePreflight.warningCount} Warnings`}
                        </span>
                        <span>·</span>
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {isFa
                            ? `${toPersianDigits(activePreflight.passCount)} تأیید`
                            : `${activePreflight.passCount} Pass`}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {activePreflight.shamsiDate}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        data-litho-autofix
                        disabled={lithoBusy || !activeJob}
                        onClick={() => activeJob && void autoFixLithoJob(activeJob.id)}
                        className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-amber-600 px-2.5 text-[11px] font-bold text-white hover:bg-amber-500 disabled:opacity-40 cursor-pointer"
                      >
                        <Wand2 className="h-3.5 w-3.5" />
                        <span>{isFa ? 'رفع خودکار موارد ممکن' : 'Auto-Fix Issues'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={lithoBusy || !activeJob}
                        onClick={() => activeJob && void runPreflightForJob(activeJob.id)}
                        className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>{isFa ? 'بررسی مجدد' : 'Re-check'}</span>
                      </button>
                    </div>

                    {/* Preflight Items */}
                    <div className="space-y-2">
                      {activePreflight.items.map((item) => {
                        const Icon =
                          item.severity === 'error'
                            ? XCircle
                            : item.severity === 'warning'
                              ? AlertTriangle
                              : CheckCircle2;
                        const iconClass =
                          item.severity === 'error'
                            ? 'text-rose-600 dark:text-rose-400'
                            : item.severity === 'warning'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-emerald-600 dark:text-emerald-400';

                        return (
                          <div
                            key={item.id}
                            data-preflight-item={item.id}
                            data-preflight-severity={item.severity}
                            className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900"
                          >
                            <div className="flex items-start gap-2">
                              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11.5px] font-bold text-slate-900 dark:text-slate-100">
                                    {isFa ? item.titleFa : item.titleEn}
                                  </span>
                                  {item.autoFixable && item.severity !== 'pass' && (
                                    <span className="shrink-0 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                                      {isFa ? 'قابل رفع خودکار' : 'Auto-fixable'}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                                  {isFa ? item.summaryFa : item.summaryEn}
                                </div>
                                <div className="mt-1 text-[10.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                                  {isFa ? item.explanationFa : item.explanationEn}
                                </div>
                                {(item.affectedPages.length > 0 || item.detailMetrics) && (
                                  <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                                    {item.affectedPages.length > 0
                                      ? isFa
                                        ? `صفحات: ${toPersianDigits(item.affectedPages.join('، '))}`
                                        : `Pages: ${item.affectedPages.join(', ')}`
                                      : ''}
                                    {item.affectedPages.length > 0 && item.detailMetrics ? ' · ' : ''}
                                    {item.detailMetrics ?? ''}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Export Report Buttons */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => activeJob && void downloadLithoPreflightReport(activeJob.id, 'pdf')}
                        className="flex h-8 items-center justify-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-2 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                      >
                        <FileText className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                        <span>{isFa ? 'خروجی گزارش PDF' : 'Report PDF'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => activeJob && void downloadLithoPreflightReport(activeJob.id, 'html')}
                        className="flex h-8 items-center justify-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-2 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                      >
                        <FileText className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                        <span>{isFa ? 'خروجی گزارش HTML' : 'Report HTML'}</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ==============================================================
                TAB 2: COLOR MANAGEMENT (ICC, Intent, GCR/TAC, Black Rule, Spot)
               ============================================================ */}
            {rightTab === 'color' && (
              <div className="space-y-3">
                {/* ICC Profile Section */}
                <div className="rounded-lg border border-slate-200 p-2.5 space-y-2 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11.5px] font-bold text-slate-800 dark:text-slate-100">
                      {isFa ? 'پروفایل رنگ ماشین چاپ (ICC)' : 'Press ICC Profile'}
                    </span>
                    <button
                      type="button"
                      onClick={() => iccInputRef.current?.click()}
                      className="text-[10.5px] font-semibold text-sky-700 hover:underline dark:text-sky-400 cursor-pointer"
                    >
                      {isFa ? '+ پروفایل سفارشی (.icc/.icm)' : '+ Custom ICC'}
                    </button>
                  </div>

                  <select
                    aria-label={isFa ? 'انتخاب پروفایل ICC' : 'Select ICC Profile'}
                    value={lithoColorSettings.iccProfile}
                    onChange={(e) =>
                      updateLithoColorSettings({
                        iccProfile: e.target.value as LithoIccProfileId,
                      })
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-medium dark:border-slate-700 dark:bg-slate-800"
                  >
                    {(Object.keys(OFFSET_ICC_PROFILES) as Array<Exclude<LithoIccProfileId, 'custom'>>).map(
                      (key) => (
                        <option key={key} value={key}>
                          {isFa
                            ? OFFSET_ICC_PROFILES[key].titleFa
                            : OFFSET_ICC_PROFILES[key].titleEn}
                        </option>
                      )
                    )}
                    {lithoColorSettings.customIcc && (
                      <option value="custom">
                        {isFa
                          ? `سفارشی: ${lithoColorSettings.customIcc.name}`
                          : `Custom: ${lithoColorSettings.customIcc.name}`}
                      </option>
                    )}
                  </select>

                  {lithoColorSettings.iccProfile === 'custom' && lithoColorSettings.customIcc && (
                    <div className="rounded bg-slate-50 px-2 py-1.5 text-[10px] text-slate-600 dark:bg-slate-950/60 dark:text-slate-400">
                      {lithoColorSettings.customIcc.fileName} · {lithoColorSettings.customIcc.colorSpace} · PCS {lithoColorSettings.customIcc.pcs} · v{lithoColorSettings.customIcc.version}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-2 pt-1">
                    <div>
                      <label className="mb-1 block text-[10.5px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'نحوه تبدیل رنگ (Rendering Intent):' : 'Rendering Intent:'}
                      </label>
                      <select
                        value={lithoColorSettings.renderingIntent}
                        onChange={(e) =>
                          updateLithoColorSettings({
                            renderingIntent: e.target.value as LithoRenderingIntent,
                          })
                        }
                        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-800"
                      >
                        <option value="relative-colorimetric">
                          {isFa ? 'Relative Colorimetric (پیشنهادی چاپ)' : 'Relative Colorimetric'}
                        </option>
                        <option value="perceptual">
                          {isFa ? 'Perceptual (عکس‌ها و طیف رنگ)' : 'Perceptual'}
                        </option>
                        <option value="saturation">
                          {isFa ? 'Saturation (وکتور و لوگوهای پررنگ)' : 'Saturation'}
                        </option>
                        <option value="absolute-colorimetric">
                          {isFa ? 'Absolute Colorimetric (نمونه‌گیری رنگ کاغذ)' : 'Absolute Colorimetric'}
                        </option>
                      </select>
                    </div>
                    <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lithoColorSettings.blackPointCompensation}
                        onChange={(e) =>
                          updateLithoColorSettings({
                            blackPointCompensation: e.target.checked,
                          })
                        }
                        className="accent-sky-600"
                      />
                      <span>
                        {isFa
                          ? 'جبران نقطه مشکی (Black Point Compensation)'
                          : 'Black Point Compensation (BPC)'}
                      </span>
                    </label>
                  </div>
                </div>

                {/* GCR / UCR & TAC Control */}
                <div className="rounded-lg border border-slate-200 p-2.5 space-y-2 dark:border-slate-800">
                  <div className="flex items-center gap-1.5 text-[11.5px] font-bold">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    <span>{isFa ? 'کنترل مجموع جوهر (TAC) و جایگزینی مشکی (GCR)' : 'TAC & GCR / UCR'}</span>
                  </div>

                  <div>
                    <div className="flex justify-between text-[10.5px]">
                      <span>{isFa ? 'سقف مجاز مرکب خروجی (Max TAC):' : 'Max Output TAC:'}</span>
                      <strong className="tabular-nums">{toPersianDigits(lithoColorSettings.maxTacPercent)}٪</strong>
                    </div>
                    <input
                      type="range"
                      min={220}
                      max={350}
                      step={5}
                      value={lithoColorSettings.maxTacPercent}
                      onChange={(e) =>
                        updateLithoColorSettings({ maxTacPercent: Number(e.target.value) })
                      }
                      className="mt-1 w-full accent-amber-600 cursor-pointer"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[10.5px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'سطح GCR:' : 'GCR Level:'}
                      </label>
                      <select
                        value={lithoColorSettings.gcrLevel}
                        onChange={(e) =>
                          updateLithoColorSettings({
                            gcrLevel: e.target.value as LithoGcrLevel,
                          })
                        }
                        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-800"
                      >
                        <option value="none">{isFa ? 'خاموش (None)' : 'None'}</option>
                        <option value="light">{isFa ? 'سبک (Light)' : 'Light'}</option>
                        <option value="medium">{isFa ? 'متعادل (Medium)' : 'Medium'}</option>
                        <option value="heavy">{isFa ? 'سنگین (Heavy)' : 'Heavy'}</option>
                        <option value="max-k">{isFa ? 'حداکثر مشکی (Max K)' : 'Max K'}</option>
                      </select>
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-[10.5px] text-slate-600 dark:text-slate-400">
                        <span>{isFa ? 'قدرت UCR:' : 'UCR:'}</span>
                        <span className="tabular-nums">{toPersianDigits(lithoColorSettings.ucrStrengthPercent)}٪</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={lithoColorSettings.ucrStrengthPercent}
                        onChange={(e) =>
                          updateLithoColorSettings({
                            ucrStrengthPercent: Number(e.target.value),
                          })
                        }
                        className="mt-1.5 w-full accent-sky-600 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* Black Rule Settings */}
                <div className="rounded-lg border border-slate-200 p-2.5 space-y-2 dark:border-slate-800">
                  <div className="text-[11.5px] font-bold">
                    {isFa ? 'قانون مشکی (متن کوچک و مشکی غنی)' : 'Black Rule & Rich Black'}
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={lithoColorSettings.blackRule.blackTextMaxPtToKOnly}
                      onChange={(e) =>
                        updateLithoColorSettings((prev) => ({
                          ...prev,
                          blackRule: {
                            ...prev.blackRule,
                            blackTextMaxPtToKOnly: e.target.checked,
                          },
                        }))
                      }
                      className="accent-slate-800"
                    />
                    <span>
                      {isFa
                        ? `متن مشکی ≤ ${toPersianDigits(lithoColorSettings.blackRule.blackTextPtThreshold)}pt فقط روی پلیت K`
                        : `Black text <= ${lithoColorSettings.blackRule.blackTextPtThreshold}pt K-only`}
                    </span>
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={lithoColorSettings.blackRule.preservePureBlack}
                      onChange={(e) =>
                        updateLithoColorSettings((prev) => ({
                          ...prev,
                          blackRule: {
                            ...prev.blackRule,
                            preservePureBlack: e.target.checked,
                          },
                        }))
                      }
                      className="accent-slate-800"
                    />
                    <span>
                      {isFa
                        ? 'جلوگیری از ۴رنگ شدن مشکی خالص (Pure Black)'
                        : 'Preserve Pure Black (0/0/0/K)'}
                    </span>
                  </label>
                  <div className="pt-1">
                    <div className="mb-1 text-[10.5px] text-slate-600 dark:text-slate-400">
                      {isFa ? 'فرمول مشکی غنی (Rich Black C/M/Y/K %):' : 'Rich Black Target (C/M/Y/K %):'}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(
                        [
                          ['C', 'richBlackC'],
                          ['M', 'richBlackM'],
                          ['Y', 'richBlackY'],
                          ['K', 'richBlackK'],
                        ] as const
                      ).map(([lbl, field]) => (
                        <label key={field} className="flex flex-col text-[10px] text-slate-500">
                          <span className="mb-0.5 font-bold">{lbl}%</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={lithoColorSettings.blackRule[field]}
                            onChange={(e) =>
                              updateLithoColorSettings((prev) => ({
                                ...prev,
                                blackRule: {
                                  ...prev.blackRule,
                                  [field]: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                                },
                              }))
                            }
                            className="rounded border border-slate-300 bg-white px-1.5 py-1 text-center text-[11px] font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Spot Colors */}
                <div className="rounded-lg border border-slate-200 p-2.5 space-y-2 dark:border-slate-800">
                  <div className="text-[11.5px] font-bold">
                    {isFa ? 'رنگ‌های ساختگی / پنتون (Spot Colors)' : 'Spot / Pantone Channels'}
                  </div>
                  {!activeMeta || activeMeta.detectedSpots.length === 0 ? (
                    <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
                      {isFa
                        ? 'هیچ کانال اسپات جداگانه‌ای در این PDF شناسایی نشد (کار تماماً CMYK/مرکب اصلی است).'
                        : 'No dedicated Spot channels detected in this PDF.'}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {activeMeta.detectedSpots.map((sp) => {
                        const handling =
                          lithoColorSettings.spotChannels[sp.name] ?? sp.handling;
                        return (
                          <div
                            key={sp.name}
                            className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-800 dark:bg-slate-950/60"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="h-4 w-4 rounded border border-black/20 shrink-0"
                                style={{ backgroundColor: sp.previewHex }}
                              />
                              <div className="min-w-0">
                                <div className="truncate text-[11px] font-bold">{sp.name}</div>
                                <div className="text-[9.5px] text-slate-500 tabular-nums">
                                  CMYK ≈ {sp.alternateCmyk.join('/')}
                                </div>
                              </div>
                            </div>
                            <select
                              value={handling}
                              onChange={(e) =>
                                setLithoSpotHandling(
                                  sp.name,
                                  e.target.value as 'keep-spot' | 'convert-cmyk'
                                )
                              }
                              className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[10.5px] font-semibold dark:border-slate-700 dark:bg-slate-800"
                            >
                              <option value="keep-spot">
                                {isFa ? 'پلیت جدا (Spot)' : 'Separate Plate'}
                              </option>
                              <option value="convert-cmyk">
                                {isFa ? 'تبدیل به CMYK' : 'Convert to CMYK'}
                              </option>
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ==============================================================
                TAB 3: PLATES & PDF/X OUTPUT
               ============================================================ */}
            {rightTab === 'export' && (
              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 p-2.5 space-y-2.5 dark:border-slate-800">
                  <div>
                    <label className="mb-1 block text-[11px] font-bold">
                      {isFa ? 'فرمت خروجی پلیت و فایل چاپی:' : 'Output Format:'}
                    </label>
                    <select
                      data-litho-output-format
                      value={lithoExportSettings.format}
                      onChange={(e) =>
                        updateLithoExportSettings({
                          format: e.target.value as LithoOutputFormat,
                        })
                      }
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-semibold dark:border-slate-700 dark:bg-slate-800"
                    >
                      <option value="plate-pdf">
                        {isFa
                          ? 'PDF جداگانه برای هر پلیت (سیاه‌وسفید C/M/Y/K + Spot)'
                          : 'Separate Grayscale PDF per Plate'}
                      </option>
                      <option value="tiff-1bit">
                        {isFa
                          ? 'TIFF تک‌بیتی ترام‌خورده (1-Bit Screened)'
                          : '1-Bit Screened TIFF per Plate'}
                      </option>
                      <option value="pdf-x1a">
                        {isFa
                          ? 'PDF/X-1a:2001 (ترکیبی تخت‌شده CMYK)'
                          : 'PDF/X-1a:2001 (Flattened CMYK)'}
                      </option>
                      <option value="pdf-x4">
                        {isFa
                          ? 'PDF/X-4 (ترکیبی استاندارد با شفافیت و پروفایل)'
                          : 'PDF/X-4 (Press Standard)'}
                      </option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[10.5px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'رزولوشن خروجی (DPI):' : 'Resolution (DPI):'}
                      </label>
                      <select
                        data-litho-dpi
                        value={lithoExportSettings.dpi}
                        onChange={(e) =>
                          updateLithoExportSettings({
                            dpi: Number(e.target.value) as LithoExportDpi,
                          })
                        }
                        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                      >
                        <option value={300}>300 DPI</option>
                        <option value={600}>600 DPI</option>
                        <option value={1200}>1200 DPI</option>
                        <option value={2400}>2400 DPI</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10.5px] text-slate-600 dark:text-slate-400">
                        {isFa ? 'نام کار (پیشوند فایل‌ها):' : 'Job Prefix:'}
                      </label>
                      <input
                        type="text"
                        value={lithoExportSettings.jobNamePrefix}
                        onChange={(e) =>
                          updateLithoExportSettings({ jobNamePrefix: e.target.value })
                        }
                        placeholder="job"
                        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-800"
                      />
                    </div>
                  </div>

                  {/* Plate / Press Sheet Size (Pre-saved + Custom + User-saved) */}
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2 space-y-2 dark:border-slate-800 dark:bg-slate-950/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-slate-800 dark:text-slate-100">
                        {isFa ? 'اندازه پلیت و زینک خروجی:' : 'Output Plate Size:'}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 tabular-nums">
                        {Math.round(resolvedPlate.widthMm)}×{Math.round(resolvedPlate.heightMm)} mm
                      </span>
                    </div>

                    <div className="flex gap-1">
                      <select
                        data-litho-plate-size
                        aria-label={isFa ? 'انتخاب اندازه پلیت' : 'Plate Size Preset'}
                        value={lithoExportSettings.plateSizeId || 'fit-document'}
                        onChange={(e) => {
                          const id = e.target.value;
                          const matched = [...BUILT_IN_LITHO_PLATE_SIZES, ...lithoSavedPlateSizes].find(
                            (p) => p.id === id
                          );
                          updateLithoExportSettings({
                            plateSizeId: id,
                            ...(matched && matched.widthMm > 0
                              ? { plateWidthMm: matched.widthMm, plateHeightMm: matched.heightMm }
                              : {}),
                          });
                        }}
                        className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold dark:border-slate-700 dark:bg-slate-800"
                      >
                        {BUILT_IN_LITHO_PLATE_SIZES.map((p) => (
                          <option key={p.id} value={p.id}>
                            {isFa ? p.nameFa : p.nameEn}
                          </option>
                        ))}
                        {lithoSavedPlateSizes.length > 0 && (
                          <optgroup label={isFa ? 'پلیت‌های ذخیره‌شده شما' : 'Saved Custom Plates'}>
                            {lithoSavedPlateSizes.map((p) => (
                              <option key={p.id} value={p.id}>
                                {isFa ? p.nameFa : p.nameEn}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <option value="custom">
                          {isFa ? 'اندازه سفارشی (Custom mm)...' : 'Custom Size (mm)...'}
                        </option>
                      </select>

                      {lithoSavedPlateSizes.some((p) => p.id === lithoExportSettings.plateSizeId) && (
                        <button
                          type="button"
                          data-litho-plate-delete
                          title={isFa ? 'حذف این اندازه پلیت' : 'Delete saved plate size'}
                          onClick={() =>
                            lithoExportSettings.plateSizeId &&
                            deleteLithoPlateSize(lithoExportSettings.plateSizeId)
                          }
                          className="rounded-md border border-slate-300 px-1.5 text-rose-600 hover:bg-rose-50 dark:border-slate-700 dark:hover:bg-rose-950/30 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {(lithoExportSettings.plateSizeId || 'fit-document') !== 'fit-document' && (
                      <div className="space-y-1.5 pt-0.5">
                        <div className="grid grid-cols-3 gap-1.5">
                          <label className="flex flex-col text-[10px] text-slate-600 dark:text-slate-400">
                            <span className="mb-0.5">{isFa ? 'عرض (mm)' : 'Width (mm)'}</span>
                            <input
                              type="number"
                              min={20}
                              max={2500}
                              data-litho-plate-width
                              value={Math.round(lithoExportSettings.plateWidthMm || resolvedPlate.widthMm)}
                              onChange={(e) =>
                                updateLithoExportSettings({
                                  plateSizeId: 'custom',
                                  plateWidthMm: Math.max(20, Number(e.target.value) || 20),
                                })
                              }
                              className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                            />
                          </label>
                          <label className="flex flex-col text-[10px] text-slate-600 dark:text-slate-400">
                            <span className="mb-0.5">{isFa ? 'ارتفاع (mm)' : 'Height (mm)'}</span>
                            <input
                              type="number"
                              min={20}
                              max={2500}
                              data-litho-plate-height
                              value={Math.round(lithoExportSettings.plateHeightMm || resolvedPlate.heightMm)}
                              onChange={(e) =>
                                updateLithoExportSettings({
                                  plateSizeId: 'custom',
                                  plateHeightMm: Math.max(20, Number(e.target.value) || 20),
                                })
                              }
                              className="rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                            />
                          </label>
                          <label className="flex flex-col text-[10px] text-slate-600 dark:text-slate-400">
                            <span className="mb-0.5">{isFa ? 'جهت پلیت' : 'Orientation'}</span>
                            <select
                              data-litho-plate-orientation
                              value={lithoExportSettings.plateOrientation || 'auto'}
                              onChange={(e) =>
                                updateLithoExportSettings({
                                  plateOrientation: e.target.value as LithoPlateOrientation,
                                })
                              }
                              className="rounded border border-slate-300 bg-white px-1 py-1 text-[10.5px] font-semibold dark:border-slate-700 dark:bg-slate-800"
                            >
                              <option value="auto">{isFa ? 'خودکار' : 'Auto'}</option>
                              <option value="portrait">{isFa ? 'عمودی' : 'Portrait'}</option>
                              <option value="landscape">{isFa ? 'افقی' : 'Landscape'}</option>
                            </select>
                          </label>
                        </div>

                        <div className="flex gap-1">
                          <input
                            type="text"
                            data-litho-plate-save-name
                            value={plateNameInput}
                            onChange={(e) => setPlateNameInput(e.target.value)}
                            placeholder={isFa ? 'نام برای ذخیره پلیت سفارشی...' : 'Name to save custom plate...'}
                            className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[10.5px] dark:border-slate-700 dark:bg-slate-800"
                          />
                          <button
                            type="button"
                            data-litho-plate-save-btn
                            onClick={() => {
                              const w = Number(lithoExportSettings.plateWidthMm || resolvedPlate.widthMm);
                              const h = Number(lithoExportSettings.plateHeightMm || resolvedPlate.heightMm);
                              if (saveLithoPlateSize(plateNameInput, w, h)) {
                                setPlateNameInput('');
                              }
                            }}
                            className="shrink-0 rounded bg-slate-800 px-2 py-1 text-[10.5px] font-semibold text-white hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 cursor-pointer"
                          >
                            {isFa ? 'ذخیره پلیت' : 'Save Plate'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Press Marks */}
                  <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lithoExportSettings.includeCropMarks}
                        onChange={(e) =>
                          updateLithoExportSettings({ includeCropMarks: e.target.checked })
                        }
                        className="accent-emerald-600"
                      />
                      <span>{isFa ? 'علائم برش (Crop Marks)' : 'Crop Marks'}</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lithoExportSettings.includeRegistrationMarks}
                        onChange={(e) =>
                          updateLithoExportSettings({
                            includeRegistrationMarks: e.target.checked,
                          })
                        }
                        className="accent-emerald-600"
                      />
                      <span>{isFa ? 'علائم رجیستری' : 'Registration Marks'}</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lithoExportSettings.includeColorBar}
                        onChange={(e) =>
                          updateLithoExportSettings({ includeColorBar: e.target.checked })
                        }
                        className="accent-emerald-600"
                      />
                      <span>{isFa ? 'نوار کنترل رنگ' : 'Color Bar'}</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lithoExportSettings.includeSlug}
                        onChange={(e) =>
                          updateLithoExportSettings({ includeSlug: e.target.checked })
                        }
                        className="accent-emerald-600"
                      />
                      <span>{isFa ? 'اسلاگ و تاریخ شمسی' : 'Slug & Shamsi Date'}</span>
                    </label>
                  </div>

                  {/* Output Folder */}
                  <div className="pt-1">
                    <div className="mb-1 flex items-center justify-between text-[10.5px] text-slate-600 dark:text-slate-400">
                      <span>{isFa ? 'محل ذخیره خروجی:' : 'Output Destination:'}</span>
                      <button
                        type="button"
                        onClick={() => void selectLithoOutputFolder()}
                        className="font-semibold text-sky-700 hover:underline dark:text-sky-400 cursor-pointer"
                      >
                        {isFa ? 'انتخاب پوشه' : 'Choose Folder'}
                      </button>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10.5px] text-slate-600 truncate dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                      {lithoExportSettings.outputFolder ||
                        (isFa
                          ? 'ذخیره خودکار در فایل ZIP (در نسخه دسکتاپ امکان ذخیره مستقیم در پوشه هم فعال است)'
                          : 'Download ZIP archive (or choose native folder in Desktop app)')}
                    </div>
                  </div>
                </div>

                {/* Primary Export CTA */}
                <button
                  type="button"
                  data-litho-export-btn
                  disabled={lithoBusy || !activeJob}
                  onClick={() => activeJob && void exportLithoJobOutputs(activeJob.id)}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40 cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span>
                    {isFa
                      ? 'تولید و خروجی پلیت‌های پرفروش / آماده زینک'
                      : 'Generate & Export Plates'}
                  </span>
                </button>

                {/* Generated File List */}
                {lithoLastExportFiles.length > 0 && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-2.5 dark:border-emerald-500/30 dark:bg-emerald-950/25">
                    <div className="mb-1 text-[11px] font-bold text-emerald-900 dark:text-emerald-200">
                      {isFa
                        ? `فایل‌های تولیدشده (${toPersianDigits(lithoLastExportFiles.length)} فایل):`
                        : `Generated Files (${lithoLastExportFiles.length}):`}
                    </div>
                    <ul className="max-h-32 space-y-0.5 overflow-y-auto font-mono text-[10px] text-emerald-800 dark:text-emerald-300">
                      {lithoLastExportFiles.map((f) => (
                        <li key={f} className="truncate">
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Technical Limits & Extensible Architecture Hooks Info */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/50">
                  <button
                    type="button"
                    onClick={() => setShowTechNotes((v) => !v)}
                    className="flex w-full items-center justify-between px-2.5 py-2 text-[11px] font-bold text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    <span>
                      {isFa ? 'محدودیت‌های فنی و ساختار توسعه آینده' : 'Technical Limits & Extension Hooks'}
                    </span>
                    {showTechNotes ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {showTechNotes && (
                    <div className="border-t border-slate-200 px-2.5 py-2 text-[10.5px] leading-relaxed text-slate-600 space-y-1.5 dark:border-slate-800 dark:text-slate-400">
                      <p>
                        {isFa
                          ? 'تفکیک رنگ، شبیه‌سازی Overprint و تولید PDF/X در این نسخه با موتور پیش‌چاپ جاوااسکریپتی انجام می‌شود؛ برای تله‌گذاری (Trapping) و جدول‌های چندبعدی ICC CLUT با سرعت بومی، قلاب‌های اتصال RIP بومی طراحی شده‌اند.'
                          : 'Separation & screening run natively in TypeScript/WebCanvas; browser heap caps raster dimensions cleanly while stamping exact selected DPI headers.'}
                      </p>
                      <p>
                        {isFa
                          ? 'معماری ماژول‌های بعدی (خارج از این فاز): Imposition، Trapping، Halftone RIP پیشرفته، JDF/CIP3 و اسپکتروفتومتر آماده اتصال در هسته هستند.'
                          : 'Prepared architecture hooks: Imposition, Trapping, Halftone RIP, JDF/CIP3 & Spectrophotometer.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
