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
  RotateCw,
  ChevronDown,
  ChevronUp,
  Move,
  Ruler,
  Hand,
  Maximize2,
  AlignCenterHorizontal,
  Lock,
  Unlock,
  X,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
  BUILT_IN_LITHO_PLATE_SIZES,
  OFFSET_ICC_PROFILES,
  buildSeparationBuffersFromRgba,
  computeFitPlacementOnForm,
  computeFormMeasurement,
  computeLithoArtworkOnFormMm,
  formatFormLength,
  normalizeLithoFormPlacement,
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

type RightTabId = 'preflight' | 'form' | 'color' | 'export';
type FormToolMode = 'transform' | 'pan' | 'measure';
type ResizeHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface PinnedMeasurement {
  id: string;
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
}

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
    updateLithoFormPlacement,
    resetLithoFormPlacement,
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
  const plateFrameRef = useRef<HTMLDivElement>(null);

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
  const [showFormRulers, setShowFormRulers] = useState(true);

  // Form interaction tool, drag/resize/measure states
  const [formTool, setFormTool] = useState<FormToolMode>('transform');
  const [pinnedMeasurements, setPinnedMeasurements] = useState<PinnedMeasurement[]>([]);
  const [activeMeasure, setActiveMeasure] = useState<{
    x1Mm: number;
    y1Mm: number;
    x2Mm: number;
    y2Mm: number;
  } | null>(null);
  const [formCursorMm, setFormCursorMm] = useState<{ xMm: number; yMm: number } | null>(null);
  const [snapGuide, setSnapGuide] = useState<{ cx: boolean; cy: boolean }>({ cx: false, cy: false });
  const [isFormTransforming, setIsFormTransforming] = useState(false);

  const transformDragRef = useRef<{
    kind: 'move' | 'resize';
    handle?: ResizeHandleId;
    startClientX: number;
    startClientY: number;
    pxPerMm: number;
    docW: number;
    docH: number;
    startOffsetX: number;
    startOffsetY: number;
    startScaleX: number;
    startScaleY: number;
    rotationDeg: number;
    lockAspect: boolean;
  } | null>(null);

  const measureDragRef = useRef<{
    x1Mm: number;
    y1Mm: number;
  } | null>(null);

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
      if (panDragRef.current || transformDragRef.current || measureDragRef.current) {
        return;
      }
      const canvas = previewCanvasRef.current;
      if (!canvas || !separationBuffers) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      // Map screen coordinates back into unrotated artwork coordinates
      const formRotDeg = normalizeLithoFormPlacement(lithoExportSettings.formPlacement).rotationDeg;
      let uFrac = (e.clientX - rect.left) / rect.width;
      let vFrac = (e.clientY - rect.top) / rect.height;
      if (Math.abs(formRotDeg) > 0.05) {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const rad = (formRotDeg * Math.PI) / 180;
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);
        const lx = dx * cosR + dy * sinR;
        const ly = -dx * sinR + dy * cosR;
        const docW = Math.max(20, activePageInfo?.widthMm ?? 210);
        const docH = Math.max(20, activePageInfo?.heightMm ?? 297);
        const absCos = Math.abs(cosR);
        const absSin = Math.abs(sinR);
        const unrotW = rect.width / Math.max(0.1, absCos + (docH / docW) * absSin);
        const unrotH = rect.height / Math.max(0.1, (docW / docH) * absSin + absCos);
        uFrac = lx / Math.max(1, unrotW) + 0.5;
        vFrac = ly / Math.max(1, unrotH) + 0.5;
      }

      const px = Math.max(
        0,
        Math.min(separationBuffers.width - 1, Math.floor(uFrac * separationBuffers.width))
      );
      const py = Math.max(
        0,
        Math.min(separationBuffers.height - 1, Math.floor(vFrac * separationBuffers.height))
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
    [separationBuffers, activePageInfo, lithoExportSettings.formPlacement]
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

  const formPlacement = useMemo(
    () => normalizeLithoFormPlacement(lithoExportSettings.formPlacement),
    [lithoExportSettings.formPlacement]
  );

  const resolvedPlate = useMemo(() => {
    const docW = activePageInfo?.widthMm ?? 210;
    const docH = activePageInfo?.heightMm ?? 297;
    return resolveLithoPlateSizeMm(lithoExportSettings, docW, docH, lithoSavedPlateSizes);
  }, [lithoExportSettings, activePageInfo, lithoSavedPlateSizes]);

  const docWidthMm = Math.max(20, activePageInfo?.widthMm ?? 210);
  const docHeightMm = Math.max(20, activePageInfo?.heightMm ?? 297);

  const artworkOnForm = useMemo(
    () =>
      computeLithoArtworkOnFormMm(
        resolvedPlate.widthMm,
        resolvedPlate.heightMm,
        docWidthMm,
        docHeightMm,
        formPlacement
      ),
    [resolvedPlate.widthMm, resolvedPlate.heightMm, docWidthMm, docHeightMm, formPlacement]
  );

  const basePxPerMm = useMemo(
    () => Math.min(480 / Math.max(20, resolvedPlate.widthMm), 410 / Math.max(20, resolvedPlate.heightMm)),
    [resolvedPlate.widthMm, resolvedPlate.heightMm]
  );

  const paperPresets = useMemo(
    () => BUILT_IN_LITHO_PLATE_SIZES.filter((p) => p.category === 'paper'),
    []
  );
  const pressPlatePresets = useMemo(
    () => BUILT_IN_LITHO_PLATE_SIZES.filter((p) => p.category === 'plate'),
    []
  );

  const selectPlatePresetById = useCallback(
    (id: string) => {
      const matched = [...BUILT_IN_LITHO_PLATE_SIZES, ...lithoSavedPlateSizes].find(
        (p) => p.id === id
      );
      updateLithoExportSettings({
        plateSizeId: id,
        ...(matched && matched.widthMm > 0
          ? { plateWidthMm: matched.widthMm, plateHeightMm: matched.heightMm }
          : {}),
      });
    },
    [lithoSavedPlateSizes, updateLithoExportSettings]
  );

  const getEffectivePxPerMm = useCallback(() => {
    const rect = plateFrameRef.current?.getBoundingClientRect();
    if (rect && rect.width > 8 && resolvedPlate.widthMm > 0) {
      return rect.width / resolvedPlate.widthMm;
    }
    return basePxPerMm * zoom;
  }, [basePxPerMm, zoom, resolvedPlate.widthMm]);

  const clientToFormMm = useCallback(
    (clientX: number, clientY: number) => {
      const rect = plateFrameRef.current?.getBoundingClientRect();
      const pxPerMm = getEffectivePxPerMm();
      const rawX = rect && rect.width > 0 ? (clientX - rect.left) / pxPerMm : clientX / pxPerMm;
      const rawY = rect && rect.height > 0 ? (clientY - rect.top) / pxPerMm : clientY / pxPerMm;
      return {
        xMm: Math.round(Math.max(0, Math.min(resolvedPlate.widthMm, rawX)) * 100) / 100,
        yMm: Math.round(Math.max(0, Math.min(resolvedPlate.heightMm, rawY)) * 100) / 100,
      };
    },
    [getEffectivePxPerMm, resolvedPlate.widthMm, resolvedPlate.heightMm]
  );

  const alignArtworkOnForm = useCallback(
    (
      target:
        | 'center'
        | 'left'
        | 'right'
        | 'top'
        | 'bottom'
        | 'top-left'
        | 'top-right'
        | 'bottom-left'
        | 'bottom-right'
    ) => {
      const margin = showPressMarks ? 6 : 0;
      const halfBboxW = artworkOnForm.bboxWidthMm / 2;
      const halfBboxH = artworkOnForm.bboxHeightMm / 2;
      const halfFormW = resolvedPlate.widthMm / 2;
      const halfFormH = resolvedPlate.heightMm / 2;

      let nextX = formPlacement.offsetXMm;
      let nextY = formPlacement.offsetYMm;

      if (target === 'center') {
        nextX = 0;
        nextY = 0;
      }
      if (target.includes('left')) nextX = -(halfFormW - halfBboxW - margin);
      if (target.includes('right')) nextX = halfFormW - halfBboxW - margin;
      if (target.includes('top')) nextY = -(halfFormH - halfBboxH - margin);
      if (target.includes('bottom')) nextY = halfFormH - halfBboxH - margin;

      updateLithoFormPlacement({ offsetXMm: nextX, offsetYMm: nextY });
    },
    [
      artworkOnForm.bboxWidthMm,
      artworkOnForm.bboxHeightMm,
      resolvedPlate.widthMm,
      resolvedPlate.heightMm,
      formPlacement.offsetXMm,
      formPlacement.offsetYMm,
      showPressMarks,
      updateLithoFormPlacement,
    ]
  );

  const handleViewportPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (panDragRef.current) {
        const dx = e.clientX - panDragRef.current.startX;
        const dy = e.clientY - panDragRef.current.startY;
        setPan({ x: panDragRef.current.origX + dx, y: panDragRef.current.origY + dy });
        return;
      }

      if (transformDragRef.current) {
        const tr = transformDragRef.current;
        const dxMm = (e.clientX - tr.startClientX) / tr.pxPerMm;
        const dyMm = (e.clientY - tr.startClientY) / tr.pxPerMm;

        if (tr.kind === 'move') {
          let nextX = tr.startOffsetX + dxMm;
          let nextY = tr.startOffsetY + dyMm;
          let snapX = false;
          let snapY = false;
          if (!e.altKey) {
            if (Math.abs(nextX) < 1.8) {
              nextX = 0;
              snapX = true;
            }
            if (Math.abs(nextY) < 1.8) {
              nextY = 0;
              snapY = true;
            }
          }
          setSnapGuide({ cx: snapX, cy: snapY });
          updateLithoFormPlacement({ offsetXMm: nextX, offsetYMm: nextY });
          return;
        }

        if (tr.kind === 'resize' && tr.handle) {
          const rad = (tr.rotationDeg * Math.PI) / 180;
          const cosT = Math.cos(rad);
          const sinT = Math.sin(rad);
          const du = dxMm * cosT + dyMm * sinT;
          const dv = -dxMm * sinT + dyMm * cosT;

          const sx = tr.handle.includes('e') ? 1 : tr.handle.includes('w') ? -1 : 0;
          const sy = tr.handle.includes('s') ? 1 : tr.handle.includes('n') ? -1 : 0;

          const startArtW = tr.docW * (tr.startScaleX / 100);
          const startArtH = tr.docH * (tr.startScaleY / 100);

          let nextW = sx !== 0 ? Math.max(5, startArtW + sx * du) : startArtW;
          let nextH = sy !== 0 ? Math.max(5, startArtH + sy * dv) : startArtH;

          let nextScaleX = (nextW / Math.max(1, tr.docW)) * 100;
          let nextScaleY = (nextH / Math.max(1, tr.docH)) * 100;

          const keepAspect = tr.lockAspect || e.shiftKey;
          if (keepAspect) {
            const aspectScaleRatio = tr.startScaleY / Math.max(1, tr.startScaleX);
            if (sx !== 0 && sy !== 0) {
              const rx = Math.abs(du) / Math.max(1, startArtW);
              const ry = Math.abs(dv) / Math.max(1, startArtH);
              if (rx >= ry) {
                nextScaleY = nextScaleX * aspectScaleRatio;
              } else {
                nextScaleX = nextScaleY / Math.max(0.05, aspectScaleRatio);
              }
            } else if (sx !== 0) {
              nextScaleY = nextScaleX * aspectScaleRatio;
            } else if (sy !== 0) {
              nextScaleX = nextScaleY / Math.max(0.05, aspectScaleRatio);
            }
          }

          nextScaleX = Math.min(500, Math.max(5, nextScaleX));
          nextScaleY = Math.min(500, Math.max(5, nextScaleY));
          nextW = tr.docW * (nextScaleX / 100);
          nextH = tr.docH * (nextScaleY / 100);

          const shiftU = sx !== 0 ? (sx * (nextW - startArtW)) / 2 : 0;
          const shiftV = sy !== 0 ? (sy * (nextH - startArtH)) / 2 : 0;
          const shiftX = shiftU * cosT - shiftV * sinT;
          const shiftY = shiftU * sinT + shiftV * cosT;

          updateLithoFormPlacement({
            scaleXPercent: nextScaleX,
            scaleYPercent: nextScaleY,
            offsetXMm: tr.startOffsetX + shiftX,
            offsetYMm: tr.startOffsetY + shiftY,
          });
        }
        return;
      }

      if (measureDragRef.current) {
        const pt = clientToFormMm(e.clientX, e.clientY);
        let x2 = pt.xMm;
        let y2 = pt.yMm;
        if (e.shiftKey) {
          const dx = x2 - measureDragRef.current.x1Mm;
          const dy = y2 - measureDragRef.current.y1Mm;
          const dist = Math.hypot(dx, dy);
          const snappedAngle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          x2 = Math.round((measureDragRef.current.x1Mm + dist * Math.cos(snappedAngle)) * 100) / 100;
          y2 = Math.round((measureDragRef.current.y1Mm + dist * Math.sin(snappedAngle)) * 100) / 100;
        }
        setActiveMeasure({
          x1Mm: measureDragRef.current.x1Mm,
          y1Mm: measureDragRef.current.y1Mm,
          x2Mm: x2,
          y2Mm: y2,
        });
      }
    },
    [clientToFormMm, updateLithoFormPlacement]
  );

  const handleViewportPointerUp = useCallback(() => {
    panDragRef.current = null;
    if (transformDragRef.current) {
      transformDragRef.current = null;
      setSnapGuide({ cx: false, cy: false });
      setIsFormTransforming(false);
    }
    if (measureDragRef.current && activeMeasure) {
      const m = computeFormMeasurement(
        activeMeasure.x1Mm,
        activeMeasure.y1Mm,
        activeMeasure.x2Mm,
        activeMeasure.y2Mm
      );
      if (m.distanceMm >= 0.3) {
        setPinnedMeasurements((prev) => [
          ...prev.slice(-9),
          {
            id: `meas-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            ...activeMeasure,
          },
        ]);
      }
      measureDragRef.current = null;
    } else {
      measureDragRef.current = null;
    }
  }, [activeMeasure]);

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

  const latestMeasurementSummary = useMemo(() => {
    const src = activeMeasure ?? pinnedMeasurements[pinnedMeasurements.length - 1] ?? null;
    if (!src) return null;
    return {
      ...src,
      ...computeFormMeasurement(src.x1Mm, src.y1Mm, src.x2Mm, src.y2Mm),
    };
  }, [activeMeasure, pinnedMeasurements]);

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

          {/* Form Layout & Measurement Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/90 px-3 py-1 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  {
                    id: 'transform',
                    icon: Move,
                    labelFa: 'جابجایی و اندازه فرم',
                    labelEn: 'Move & Resize',
                  },
                  {
                    id: 'pan',
                    icon: Hand,
                    labelFa: 'جا‌به‌جایی نما',
                    labelEn: 'Pan View',
                  },
                  {
                    id: 'measure',
                    icon: Ruler,
                    labelFa: 'اندازه‌گیری روی فرم',
                    labelEn: 'Measure',
                  },
                ] as const
              ).map((t) => {
                const Icon = t.icon;
                const active = formTool === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    data-litho-form-tool={t.id}
                    onClick={() => setFormTool(t.id)}
                    className={`flex h-6.5 items-center gap-1 rounded border px-2 text-[10.5px] font-bold transition-colors cursor-pointer ${
                      active
                        ? 'border-amber-500 bg-amber-500 text-slate-950 shadow-2xs dark:border-amber-400 dark:bg-amber-400'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    <span>{isFa ? t.labelFa : t.labelEn}</span>
                  </button>
                );
              })}

              <label className="flex h-6.5 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[10.5px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  data-litho-toggle-rulers
                  checked={showFormRulers}
                  onChange={(e) => setShowFormRulers(e.target.checked)}
                  className="accent-amber-600"
                />
                <span>{isFa ? 'خط‌کش فرم' : 'Rulers'}</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <select
                data-litho-quick-plate-size
                aria-label={isFa ? 'اندازه کاغذ یا پلیت فرم' : 'Form Paper or Plate Size'}
                value={lithoExportSettings.plateSizeId || 'fit-document'}
                onChange={(e) => selectPlatePresetById(e.target.value)}
                className="h-6.5 max-w-[215px] rounded border border-slate-300 bg-white px-1.5 text-[10.5px] font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="fit-document">
                  {isFa ? 'هم‌اندازه سند (خودکار)' : 'Auto Fit Document'}
                </option>
                <optgroup label={isFa ? 'کاغذهای استاندارد (A / B / SRA)' : 'Standard Paper Sizes'}>
                  {paperPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {isFa ? p.nameFa : p.nameEn}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={isFa ? 'پلیت‌های ماشین چاپ افست' : 'Offset Press Plates'}>
                  {pressPlatePresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {isFa ? p.nameFa : p.nameEn}
                    </option>
                  ))}
                </optgroup>
                {lithoSavedPlateSizes.length > 0 && (
                  <optgroup label={isFa ? 'اندازه‌های ذخیره‌شده شما' : 'Saved Custom Sizes'}>
                    {lithoSavedPlateSizes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {isFa ? p.nameFa : p.nameEn}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="custom">
                  {isFa ? 'اندازه سفارشی (mm)...' : 'Custom Size (mm)...'}
                </option>
              </select>

              <button
                type="button"
                data-litho-align="center"
                title={isFa ? 'مرکزچین در فرم' : 'Center on Form'}
                onClick={() => alignArtworkOnForm('center')}
                className="flex h-6.5 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 text-[10.5px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <AlignCenterHorizontal className="h-3 w-3" />
                <span>{isFa ? 'مرکز' : 'Center'}</span>
              </button>
              <button
                type="button"
                data-litho-fit-form
                title={isFa ? 'متناسب‌سازی در فرم' : 'Fit Artwork to Form'}
                onClick={() =>
                  updateLithoFormPlacement(
                    computeFitPlacementOnForm(
                      resolvedPlate.widthMm,
                      resolvedPlate.heightMm,
                      docWidthMm,
                      docHeightMm,
                      'fit',
                      formPlacement,
                      showPressMarks ? 8 : 2
                    )
                  )
                }
                className="flex h-6.5 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 text-[10.5px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <Maximize2 className="h-3 w-3" />
                <span>{isFa ? 'فیت فرم' : 'Fit'}</span>
              </button>
              <button
                type="button"
                data-litho-rotate-90
                title={isFa ? 'چرخش ۹۰ درجه ساعتگرد' : 'Rotate 90° CW'}
                onClick={() =>
                  updateLithoFormPlacement((prev) => ({
                    ...prev,
                    rotationDeg: prev.rotationDeg + 90,
                  }))
                }
                className="flex h-6.5 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 text-[10.5px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <RotateCw className="h-3 w-3" />
                <span>۹۰°</span>
              </button>
              <button
                type="button"
                data-litho-reset-placement
                title={isFa ? 'بازنشانی مکان و اندازه' : 'Reset Transform'}
                onClick={() => resetLithoFormPlacement()}
                className="flex h-6.5 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 text-[10.5px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <span>{isFa ? '۱۰۰٪' : '100%'}</span>
              </button>
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
            onPointerMove={handleViewportPointerMove}
            onPointerUp={handleViewportPointerUp}
            onPointerCancel={handleViewportPointerUp}
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
              const trim = activePageInfo?.trimBoxMm ?? activePageInfo?.mediaBoxMm;
              const media = activePageInfo?.mediaBoxMm;
              const trimLeftPct = trim && media && media.width > 0 ? Math.max(0, Math.min(20, ((trim.x - media.x) / media.width) * 100)) : 0;
              const trimRightPct = trim && media && media.width > 0 ? Math.max(0, Math.min(20, (((media.x + media.width) - (trim.x + trim.width)) / media.width) * 100)) : 0;
              const trimTopPct = trim && media && media.height > 0 ? Math.max(0, Math.min(20, (((media.y + media.height) - (trim.y + trim.height)) / media.height) * 100)) : 0;
              const trimBottomPct = trim && media && media.height > 0 ? Math.max(0, Math.min(20, ((trim.y - media.y) / media.height) * 100)) : 0;

              const formWpx = Math.max(90, Math.round(resolvedPlate.widthMm * basePxPerMm * 100) / 100);
              const formHpx = Math.max(90, Math.round(resolvedPlate.heightMm * basePxPerMm * 100) / 100);
              const artLeftPx = artworkOnForm.leftMm * basePxPerMm;
              const artTopPx = artworkOnForm.topMm * basePxPerMm;
              const artWpx = artworkOnForm.artWidthMm * basePxPerMm;
              const artHpx = artworkOnForm.artHeightMm * basePxPerMm;

              const tickStepMm = Math.max(resolvedPlate.widthMm, resolvedPlate.heightMm) > 600 ? 100 : 50;
              const xTicks: number[] = [];
              for (let x = 0; x <= resolvedPlate.widthMm; x += tickStepMm) xTicks.push(x);
              const yTicks: number[] = [];
              for (let y = 0; y <= resolvedPlate.heightMm; y += tickStepMm) yTicks.push(y);

              const handles: Array<{ id: ResizeHandleId; cls: string; cursor: string }> = [
                { id: 'nw', cls: '-top-1.5 -left-1.5', cursor: 'nwse-resize' },
                { id: 'n', cls: '-top-1.5 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
                { id: 'ne', cls: '-top-1.5 -right-1.5', cursor: 'nesw-resize' },
                { id: 'e', cls: 'top-1/2 -right-1.5 -translate-y-1/2', cursor: 'ew-resize' },
                { id: 'se', cls: '-bottom-1.5 -right-1.5', cursor: 'nwse-resize' },
                { id: 's', cls: '-bottom-1.5 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
                { id: 'sw', cls: '-bottom-1.5 -left-1.5', cursor: 'nesw-resize' },
                { id: 'w', cls: 'top-1/2 -left-1.5 -translate-y-1/2', cursor: 'ew-resize' },
              ];

              const startResizeHandle = (handle: ResizeHandleId, e: React.PointerEvent) => {
                e.stopPropagation();
                e.preventDefault();
                transformDragRef.current = {
                  kind: 'resize',
                  handle,
                  startClientX: e.clientX,
                  startClientY: e.clientY,
                  pxPerMm: getEffectivePxPerMm(),
                  docW: docWidthMm,
                  docH: docHeightMm,
                  startOffsetX: formPlacement.offsetXMm,
                  startOffsetY: formPlacement.offsetYMm,
                  startScaleX: formPlacement.scaleXPercent,
                  startScaleY: formPlacement.scaleYPercent,
                  rotationDeg: formPlacement.rotationDeg,
                  lockAspect: formPlacement.lockAspect,
                };
                setIsFormTransforming(true);
              };

              return (
                <div
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'center center',
                    width: `${formWpx}px`,
                    height: `${formHpx}px`,
                  }}
                  ref={plateFrameRef}
                  data-litho-plate-frame
                  data-form-width-mm={resolvedPlate.widthMm}
                  data-form-height-mm={resolvedPlate.heightMm}
                  onPointerDown={(e) => {
                    if (formTool === 'pan' && e.button === 0) {
                      panDragRef.current = {
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: pan.x,
                        origY: pan.y,
                      };
                    }
                  }}
                  className="relative shrink-0 shadow-2xl border border-slate-400 bg-slate-100/95 dark:border-slate-600 dark:bg-slate-200 overflow-visible"
                >
                  {/* Calibrated Form Edge Rulers (mm) */}
                  {showFormRulers && (
                    <div data-litho-form-rulers className="pointer-events-none">
                      <div className="absolute -top-4.5 left-0 right-0 h-4 border-b border-slate-400 bg-slate-200/90 text-[7.5px] font-mono text-slate-700">
                        {xTicks.map((xMm) => (
                          <div
                            key={xMm}
                            style={{ left: `${(xMm / resolvedPlate.widthMm) * 100}%` }}
                            className="absolute bottom-0 flex flex-col items-start"
                          >
                            <span className="h-1.5 w-px bg-slate-600" />
                            <span className="-translate-x-1/2 -translate-y-2.5 px-0.5 leading-none">
                              {Math.round(xMm)}
                            </span>
                          </div>
                        ))}
                        {formCursorMm && (
                          <span
                            style={{ left: `${(formCursorMm.xMm / resolvedPlate.widthMm) * 100}%` }}
                            className="absolute bottom-0 h-3 w-0.5 bg-amber-600"
                          />
                        )}
                      </div>
                      <div className="absolute -left-5 top-0 bottom-0 w-4.5 border-r border-slate-400 bg-slate-200/90 text-[7.5px] font-mono text-slate-700">
                        {yTicks.map((yMm) => (
                          <div
                            key={yMm}
                            style={{ top: `${(yMm / resolvedPlate.heightMm) * 100}%` }}
                            className="absolute right-0 flex items-center"
                          >
                            <span className="-translate-x-1 text-[7px] leading-none">
                              {Math.round(yMm)}
                            </span>
                            <span className="h-px w-1.5 bg-slate-600" />
                          </div>
                        ))}
                        {formCursorMm && (
                          <span
                            style={{ top: `${(formCursorMm.yMm / resolvedPlate.heightMm) * 100}%` }}
                            className="absolute right-0 h-0.5 w-3 bg-amber-600"
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Center Snap Guides when dragging near form center */}
                  {snapGuide.cx && (
                    <div className="pointer-events-none absolute top-0 bottom-0 left-1/2 w-px border-l border-dashed border-amber-500 z-20" />
                  )}
                  {snapGuide.cy && (
                    <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-px border-t border-dashed border-amber-500 z-20" />
                  )}

                  {/* Plate dimension tag, Color Bar, Registration Marks & Slug */}
                  {showPressMarks && (
                    <div
                      data-litho-press-marks
                      className="pointer-events-none absolute inset-0 z-10"
                    >
                      <div className="absolute top-1 left-2 right-2 flex items-center justify-between text-[8px] font-mono font-semibold text-slate-600">
                        <span>
                          {resolvedPlate.isFitDocument
                            ? `Sheet: ${Math.round(resolvedPlate.widthMm)}×${Math.round(resolvedPlate.heightMm)} mm`
                            : `Form: ${Math.round(resolvedPlate.widthMm)}×${Math.round(resolvedPlate.heightMm)} mm`}
                        </span>
                        <span className="truncate max-w-[60%] text-end">
                          {`${lithoExportSettings.jobNamePrefix || activeJob.fileName} · ${activePlatePreviewLabel} · P${lithoSelectedPageNumber}`}
                        </span>
                      </div>

                      {lithoExportSettings.includeColorBar && (
                        <div
                          data-litho-color-bar
                          className="absolute top-3.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-[2px] border border-slate-400/70 bg-white px-1 py-0.5 shadow-2xs"
                        >
                          {(
                            monochromeSinglePlate
                              ? ['#d1d5db', '#9ca3af', '#6b7280', '#374151', '#111827']
                              : ['#009fe3', '#7dd3fc', '#e5007d', '#f472b6', '#facc15', '#fef08a', '#111827', '#6b7280', '#dc2626', '#16a34a', '#1d4ed8']
                          ).map((hex, i) => (
                            <span
                              key={i}
                              className="h-1.5 w-2 border border-black/15"
                              style={{ backgroundColor: hex }}
                            />
                          ))}
                          {keptSpots.map((sp) => (
                            <span
                              key={sp.name}
                              title={sp.name}
                              className="h-1.5 w-2 border border-black/25"
                              style={{ backgroundColor: sp.previewHex }}
                            />
                          ))}
                        </div>
                      )}

                      {lithoExportSettings.includeRegistrationMarks && (
                        <>
                          {[
                            { cls: 'left-1/2 -translate-x-1/2 top-1' },
                            { cls: 'left-1/2 -translate-x-1/2 bottom-1' },
                            { cls: 'left-1 top-1/2 -translate-y-1/2' },
                            { cls: 'right-1 top-1/2 -translate-y-1/2' },
                          ].map((pos, idx) => (
                            <svg
                              key={idx}
                              viewBox="0 0 16 16"
                              className={`absolute h-3 w-3 text-slate-900 ${pos.cls}`}
                            >
                              <circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="1" />
                              <line x1="0" y1="8" x2="16" y2="8" stroke="currentColor" strokeWidth="0.9" />
                              <line x1="8" y1="0" x2="8" y2="16" stroke="currentColor" strokeWidth="0.9" />
                            </svg>
                          ))}
                        </>
                      )}

                      {lithoExportSettings.includeSlug && (
                        <div className="absolute bottom-1 left-2 right-2 flex items-center justify-between text-[7.5px] font-mono text-slate-700">
                          <span className="truncate">
                            {`${lithoColorSettings.iccProfile} · TAC≤${lithoTacThreshold}% · ${shamsiToday}`}
                          </span>
                          {!resolvedPlate.isFitDocument && (
                            <span className="font-bold text-slate-800 shrink-0">
                              {isFa ? '▲ لبه پنجه ماشین (Gripper)' : '▲ GRIPPER EDGE'}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Movable, Resizable & Rotatable Artwork Box Inside Form */}
                  <div
                    data-litho-artwork-box
                    data-art-offset-x={formPlacement.offsetXMm}
                    data-art-offset-y={formPlacement.offsetYMm}
                    data-art-width-mm={Math.round(artworkOnForm.artWidthMm * 100) / 100}
                    data-art-height-mm={Math.round(artworkOnForm.artHeightMm * 100) / 100}
                    data-art-rotation={formPlacement.rotationDeg}
                    style={{
                      left: `${artLeftPx}px`,
                      top: `${artTopPx}px`,
                      width: `${artWpx}px`,
                      height: `${artHpx}px`,
                      transform: `rotate(${formPlacement.rotationDeg}deg)`,
                      transformOrigin: 'center center',
                    }}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || formTool !== 'transform') return;
                      e.stopPropagation();
                      transformDragRef.current = {
                        kind: 'move',
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        pxPerMm: getEffectivePxPerMm(),
                        docW: docWidthMm,
                        docH: docHeightMm,
                        startOffsetX: formPlacement.offsetXMm,
                        startOffsetY: formPlacement.offsetYMm,
                        startScaleX: formPlacement.scaleXPercent,
                        startScaleY: formPlacement.scaleYPercent,
                        rotationDeg: formPlacement.rotationDeg,
                        lockAspect: formPlacement.lockAspect,
                      };
                      setIsFormTransforming(true);
                    }}
                    className={`absolute bg-white shadow-sm ${
                      formTool === 'transform'
                        ? 'ring-2 ring-amber-500 cursor-move'
                        : 'ring-1 ring-slate-300'
                    }`}
                  >
                    <canvas
                      ref={previewCanvasRef}
                      data-litho-preview-canvas
                      onPointerLeave={() => {
                        setHoverCoverage(null);
                      }}
                      onPointerMove={(e) => {
                        handleCanvasPointerMove(e);
                        setFormCursorMm(clientToFormMm(e.clientX, e.clientY));
                      }}
                      className={`block h-full w-full ${
                        formTool === 'transform'
                          ? 'cursor-move'
                          : formTool === 'measure'
                            ? 'cursor-crosshair'
                            : 'cursor-grab'
                      }`}
                    />

                    {/* Live Transform Badge */}
                    {isFormTransforming && (
                      <div className="pointer-events-none absolute -top-6 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900/90 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white shadow">
                        {`${Math.round(artworkOnForm.artWidthMm * 10) / 10}×${Math.round(artworkOnForm.artHeightMm * 10) / 10} mm · (${Math.round(formPlacement.offsetXMm)}, ${Math.round(formPlacement.offsetYMm)})`}
                      </div>
                    )}

                    {/* TrimBox, BleedBox & Corner Crop Marks over exact artwork bounds */}
                    {showPressMarks && (
                      <div className="pointer-events-none absolute inset-0">
                        <div className="absolute inset-0 border border-dashed border-pink-500/60" />
                        <div
                          style={{
                            left: `${trimLeftPct}%`,
                            right: `${trimRightPct}%`,
                            top: `${trimTopPct}%`,
                            bottom: `${trimBottomPct}%`,
                          }}
                          className="absolute border border-dashed border-sky-500/80"
                        >
                          {lithoExportSettings.includeCropMarks && (
                            <>
                              <span className="absolute -top-3 left-0 h-2.5 w-px bg-slate-900" />
                              <span className="absolute top-0 -left-3 h-px w-2.5 bg-slate-900" />
                              <span className="absolute -top-3 right-0 h-2.5 w-px bg-slate-900" />
                              <span className="absolute top-0 -right-3 h-px w-2.5 bg-slate-900" />
                              <span className="absolute -bottom-3 left-0 h-2.5 w-px bg-slate-900" />
                              <span className="absolute bottom-0 -left-3 h-px w-2.5 bg-slate-900" />
                              <span className="absolute -bottom-3 right-0 h-2.5 w-px bg-slate-900" />
                              <span className="absolute bottom-0 -right-3 h-px w-2.5 bg-slate-900" />
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 8 Interactive Resize Handles in Transform Mode */}
                    {formTool === 'transform' &&
                      handles.map((h) => (
                        <button
                          key={h.id}
                          type="button"
                          data-litho-handle={h.id}
                          aria-label={`Resize ${h.id}`}
                          onPointerDown={(e) => startResizeHandle(h.id, e)}
                          style={{ cursor: h.cursor }}
                          className={`absolute z-30 h-2.5 w-2.5 rounded-[2px] border border-slate-900 bg-amber-400 shadow ${h.cls}`}
                        />
                      ))}
                  </div>

                  {/* Interactive Form Measurement SVG & Pointer Overlay */}
                  <div
                    data-litho-measure-overlay
                    onPointerDown={(e) => {
                      if (formTool !== 'measure' || e.button !== 0) return;
                      e.stopPropagation();
                      const pt = clientToFormMm(e.clientX, e.clientY);
                      measureDragRef.current = { x1Mm: pt.xMm, y1Mm: pt.yMm };
                      setActiveMeasure({ x1Mm: pt.xMm, y1Mm: pt.yMm, x2Mm: pt.xMm, y2Mm: pt.yMm });
                    }}
                    onPointerMove={(e) => {
                      setFormCursorMm(clientToFormMm(e.clientX, e.clientY));
                    }}
                    onPointerLeave={() => {
                      setFormCursorMm(null);
                    }}
                    className={`absolute inset-0 z-20 ${
                      formTool === 'measure' ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'
                    }`}
                  >
                    <svg
                      viewBox={`0 0 ${resolvedPlate.widthMm} ${resolvedPlate.heightMm}`}
                      className="h-full w-full overflow-visible"
                      preserveAspectRatio="none"
                    >
                      {[
                        ...pinnedMeasurements.map((m) => ({ ...m, isDraft: false })),
                        ...(activeMeasure ? [{ id: 'draft', ...activeMeasure, isDraft: true }] : []),
                      ].map((line) => {
                        const res = computeFormMeasurement(
                          line.x1Mm,
                          line.y1Mm,
                          line.x2Mm,
                          line.y2Mm
                        );
                        const midX = (line.x1Mm + line.x2Mm) / 2;
                        const midY = (line.y1Mm + line.y2Mm) / 2;
                        const strokeW = Math.max(0.5, resolvedPlate.widthMm * 0.003);
                        const fontSize = Math.max(4, resolvedPlate.widthMm * 0.025);
                        return (
                          <g key={line.id} data-litho-measurement-item={line.id}>
                            {Math.abs(res.dxMm) > 1 && Math.abs(res.dyMm) > 1 && (
                              <polyline
                                points={`${line.x1Mm},${line.y1Mm} ${line.x2Mm},${line.y1Mm} ${line.x2Mm},${line.y2Mm}`}
                                fill="none"
                                stroke={line.isDraft ? '#0284c7' : '#0f766e'}
                                strokeWidth={strokeW * 0.65}
                                strokeDasharray={`${strokeW * 2} ${strokeW * 2}`}
                                opacity={0.75}
                              />
                            )}
                            <line
                              x1={line.x1Mm}
                              y1={line.y1Mm}
                              x2={line.x2Mm}
                              y2={line.y2Mm}
                              stroke={line.isDraft ? '#0284c7' : '#e11d48'}
                              strokeWidth={strokeW}
                            />
                            <circle
                              cx={line.x1Mm}
                              cy={line.y1Mm}
                              r={strokeW * 1.6}
                              fill={line.isDraft ? '#0284c7' : '#e11d48'}
                            />
                            <circle
                              cx={line.x2Mm}
                              cy={line.y2Mm}
                              r={strokeW * 1.6}
                              fill={line.isDraft ? '#0284c7' : '#e11d48'}
                            />
                            {res.distanceMm >= 0.3 && (
                              <text
                                x={midX}
                                y={midY - strokeW * 2}
                                textAnchor="middle"
                                fontSize={fontSize}
                                fontWeight="700"
                                fill={line.isDraft ? '#0369a1' : '#be123c'}
                                stroke="#ffffff"
                                strokeWidth={fontSize * 0.16}
                                paintOrder="stroke"
                              >
                                {formatFormLength(res.distanceMm, settings.unit)}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Bottom Ink Coverage & Form Measurement Inspector Bar */}
          <div
            data-litho-ink-inspector
            className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-center gap-3 tabular-nums">
              <span className="font-bold text-slate-700 dark:text-slate-200">
                {isFa ? 'سنجشگر مرکب:' : 'Ink Coverage:'}
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
                    ? 'ماوس را روی صفحه ببرید تا درصد مرکب و TAC نمایش داده شود.'
                    : 'Hover page to inspect ink % and TAC.'}
                </span>
              )}

              {latestMeasurementSummary && (
                <span
                  data-litho-measure-readout
                  className="flex items-center gap-1.5 rounded bg-rose-50 px-2 py-0.5 font-mono text-[10.5px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                >
                  <Ruler className="h-3 w-3" />
                  <span>
                    {`${formatFormLength(latestMeasurementSummary.distanceMm, settings.unit)} (ΔX ${latestMeasurementSummary.dxMm} · ΔY ${latestMeasurementSummary.dyMm} mm · ${latestMeasurementSummary.angleDeg}°)`}
                  </span>
                </span>
              )}
            </div>

            {separationBuffers && (
              <div className="text-[10.5px] text-slate-500 dark:text-slate-400 tabular-nums">
                {isFa
                  ? `فرم: ${Math.round(resolvedPlate.widthMm)}×${Math.round(resolvedPlate.heightMm)} mm · کار: ${Math.round(artworkOnForm.artWidthMm)}×${Math.round(artworkOnForm.artHeightMm)} mm · اوج TAC ${separationBuffers.averages.maxTacPercent}%`
                  : `Form: ${Math.round(resolvedPlate.widthMm)}×${Math.round(resolvedPlate.heightMm)} mm · Art: ${Math.round(artworkOnForm.artWidthMm)}×${Math.round(artworkOnForm.artHeightMm)} mm · Peak TAC ${separationBuffers.averages.maxTacPercent}%`}
              </div>
            )}
          </div>
        </main>

        {/* ====================================================================
            RIGHT INSPECTOR: Preflight | Color Management | Plates & Export
           ================================================================== */}
        <aside className="flex w-full lg:w-[390px] shrink-0 flex-col border-t lg:border-t-0 lg:border-s border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
          {/* Inspector Tabs */}
          <div className="grid grid-cols-4 border-b border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
            <button
              type="button"
              data-litho-tab="preflight"
              onClick={() => setRightTab('preflight')}
              className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[10.5px] font-bold transition-colors cursor-pointer ${
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
              data-litho-tab="form"
              onClick={() => setRightTab('form')}
              className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[10.5px] font-bold transition-colors cursor-pointer ${
                rightTab === 'form'
                  ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              <Ruler className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{isFa ? 'فرم و اندازه' : 'Form'}</span>
            </button>
            <button
              type="button"
              data-litho-tab="color"
              onClick={() => setRightTab('color')}
              className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[10.5px] font-bold transition-colors cursor-pointer ${
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
              className={`flex items-center justify-center gap-1 rounded-md py-1.5 text-[10.5px] font-bold transition-colors cursor-pointer ${
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
                TAB 2: FORM LAYOUT, TRANSFORM & MEASUREMENT
               ============================================================ */}
            {rightTab === 'form' && (
              <div className="space-y-3" data-litho-form-panel>
                {/* Paper / Plate Form Size */}
                <div className="rounded-lg border border-slate-200 p-2.5 space-y-2 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11.5px] font-bold text-slate-800 dark:text-slate-100">
                      {isFa ? 'قطع کاغذ یا پلیت فرم' : 'Output Form / Paper Size'}
                    </span>
                    <span className="font-mono text-[10px] font-semibold text-slate-500 tabular-nums">
                      {Math.round(resolvedPlate.widthMm)}×{Math.round(resolvedPlate.heightMm)} mm
                    </span>
                  </div>

                  <select
                    data-litho-form-plate-size
                    value={lithoExportSettings.plateSizeId || 'fit-document'}
                    onChange={(e) => selectPlatePresetById(e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-semibold dark:border-slate-700 dark:bg-slate-800"
                  >
                    <option value="fit-document">
                      {isFa ? 'هم‌اندازه سند + علائم برش (خودکار)' : 'Auto Fit Document + Marks'}
                    </option>
                    <optgroup label={isFa ? 'کاغذهای استاندارد (A3 / A4 / B3 / B4 / SRA3)' : 'Standard Paper Sizes'}>
                      {paperPresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {isFa ? p.nameFa : p.nameEn}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label={isFa ? 'پلیت‌های ماشین چاپ افست' : 'Offset Press Plates'}>
                      {pressPlatePresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {isFa ? p.nameFa : p.nameEn}
                        </option>
                      ))}
                    </optgroup>
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

                  {(lithoExportSettings.plateSizeId || 'fit-document') !== 'fit-document' && (
                    <div className="grid grid-cols-3 gap-1.5">
                      <label className="flex flex-col text-[10px] text-slate-600 dark:text-slate-400">
                        <span className="mb-0.5">{isFa ? 'عرض فرم (mm)' : 'Width'}</span>
                        <input
                          type="number"
                          min={20}
                          max={2500}
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
                        <span className="mb-0.5">{isFa ? 'ارتفاع فرم (mm)' : 'Height'}</span>
                        <input
                          type="number"
                          min={20}
                          max={2500}
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
                        <span className="mb-0.5">{isFa ? 'جهت' : 'Orientation'}</span>
                        <select
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
                  )}
                </div>

                {/* Move, Resize & Rotate Artwork Inside Form */}
                <div className="rounded-lg border border-slate-200 p-2.5 space-y-2.5 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-[11.5px] font-bold text-slate-800 dark:text-slate-100">
                      {isFa ? 'موقعیت و اندازه کار در فرم' : 'Artwork Transform on Form'}
                    </span>
                    <button
                      type="button"
                      onClick={() => resetLithoFormPlacement()}
                      className="text-[10.5px] font-semibold text-amber-700 hover:underline dark:text-amber-400 cursor-pointer"
                    >
                      {isFa ? 'بازنشانی' : 'Reset'}
                    </button>
                  </div>

                  {/* Position offsets (mm from form center) */}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col text-[10px] text-slate-600 dark:text-slate-400">
                      <span className="mb-0.5">{isFa ? 'جابجایی افقی X (mm)' : 'Offset X (mm)'}</span>
                      <input
                        type="number"
                        step={0.5}
                        data-litho-offset-x
                        value={formPlacement.offsetXMm}
                        onChange={(e) =>
                          updateLithoFormPlacement({ offsetXMm: Number(e.target.value) || 0 })
                        }
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                      />
                    </label>
                    <label className="flex flex-col text-[10px] text-slate-600 dark:text-slate-400">
                      <span className="mb-0.5">{isFa ? 'جابجایی عمودی Y (mm)' : 'Offset Y (mm)'}</span>
                      <input
                        type="number"
                        step={0.5}
                        data-litho-offset-y
                        value={formPlacement.offsetYMm}
                        onChange={(e) =>
                          updateLithoFormPlacement({ offsetYMm: Number(e.target.value) || 0 })
                        }
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                      />
                    </label>
                  </div>

                  {/* Quick Alignment Grid */}
                  <div>
                    <div className="mb-1 text-[10px] text-slate-500 dark:text-slate-400">
                      {isFa ? 'چیدمان سریع نسبت به فرم:' : 'Quick Form Alignment:'}
                    </div>
                    <div className="grid grid-cols-5 gap-1 text-[10px]">
                      {(
                        [
                          ['top-left', isFa ? 'بالا-چپ' : 'TL'],
                          ['top', isFa ? 'بالا' : 'Top'],
                          ['top-right', isFa ? 'بالا-راست' : 'TR'],
                          ['left', isFa ? 'چپ' : 'Left'],
                          ['center', isFa ? 'مرکز' : 'Center'],
                          ['right', isFa ? 'راست' : 'Right'],
                          ['bottom-left', isFa ? 'پایین-چپ' : 'BL'],
                          ['bottom', isFa ? 'پایین' : 'Bottom'],
                          ['bottom-right', isFa ? 'پایین-راست' : 'BR'],
                        ] as const
                      ).map(([pos, lbl]) => (
                        <button
                          key={pos}
                          type="button"
                          onClick={() => alignArtworkOnForm(pos)}
                          className="rounded border border-slate-200 bg-slate-50 py-1 font-semibold text-slate-700 hover:bg-amber-50 hover:border-amber-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Artwork Physical Width/Height & Scale % */}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col text-[10px] text-slate-600 dark:text-slate-400">
                      <span className="mb-0.5">{isFa ? 'عرض کار (mm)' : 'Art Width (mm)'}</span>
                      <input
                        type="number"
                        min={5}
                        max={2500}
                        step={0.5}
                        data-litho-art-width
                        value={Math.round(artworkOnForm.artWidthMm * 10) / 10}
                        onChange={(e) => {
                          const targetW = Math.max(5, Number(e.target.value) || 5);
                          const nextScaleX = (targetW / docWidthMm) * 100;
                          const ratio = formPlacement.scaleYPercent / Math.max(1, formPlacement.scaleXPercent);
                          updateLithoFormPlacement({
                            scaleXPercent: nextScaleX,
                            ...(formPlacement.lockAspect ? { scaleYPercent: nextScaleX * ratio } : {}),
                          });
                        }}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                      />
                    </label>
                    <label className="flex flex-col text-[10px] text-slate-600 dark:text-slate-400">
                      <span className="mb-0.5">{isFa ? 'ارتفاع کار (mm)' : 'Art Height (mm)'}</span>
                      <input
                        type="number"
                        min={5}
                        max={2500}
                        step={0.5}
                        data-litho-art-height
                        value={Math.round(artworkOnForm.artHeightMm * 10) / 10}
                        onChange={(e) => {
                          const targetH = Math.max(5, Number(e.target.value) || 5);
                          const nextScaleY = (targetH / docHeightMm) * 100;
                          const ratio = formPlacement.scaleXPercent / Math.max(1, formPlacement.scaleYPercent);
                          updateLithoFormPlacement({
                            scaleYPercent: nextScaleY,
                            ...(formPlacement.lockAspect ? { scaleXPercent: nextScaleY * ratio } : {}),
                          });
                        }}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col text-[10px] text-slate-600 dark:text-slate-400">
                      <span className="mb-0.5">{isFa ? 'مقیاس عرض (%)' : 'Scale X (%)'}</span>
                      <input
                        type="number"
                        min={5}
                        max={500}
                        step={1}
                        data-litho-scale-x
                        value={Math.round(formPlacement.scaleXPercent * 10) / 10}
                        onChange={(e) => {
                          const val = Math.max(5, Math.min(500, Number(e.target.value) || 100));
                          updateLithoFormPlacement({
                            scaleXPercent: val,
                            ...(formPlacement.lockAspect ? { scaleYPercent: val } : {}),
                          });
                        }}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                      />
                    </label>
                    <label className="flex flex-col text-[10px] text-slate-600 dark:text-slate-400">
                      <span className="mb-0.5">{isFa ? 'مقیاس ارتفاع (%)' : 'Scale Y (%)'}</span>
                      <input
                        type="number"
                        min={5}
                        max={500}
                        step={1}
                        data-litho-scale-y
                        value={Math.round(formPlacement.scaleYPercent * 10) / 10}
                        onChange={(e) => {
                          const val = Math.max(5, Math.min(500, Number(e.target.value) || 100));
                          updateLithoFormPlacement({
                            scaleYPercent: val,
                            ...(formPlacement.lockAspect ? { scaleXPercent: val } : {}),
                          });
                        }}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <button
                      type="button"
                      data-litho-lock-aspect
                      onClick={() =>
                        updateLithoFormPlacement({ lockAspect: !formPlacement.lockAspect })
                      }
                      className={`flex items-center gap-1 rounded border px-2 py-1 text-[10.5px] font-semibold cursor-pointer ${
                        formPlacement.lockAspect
                          ? 'border-sky-400 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-950/30 dark:text-sky-200'
                          : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {formPlacement.lockAspect ? (
                        <Lock className="h-3 w-3" />
                      ) : (
                        <Unlock className="h-3 w-3" />
                      )}
                      <span>{isFa ? 'قفل تناسب طول/عرض' : 'Lock Aspect'}</span>
                    </button>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          updateLithoFormPlacement(
                            computeFitPlacementOnForm(
                              resolvedPlate.widthMm,
                              resolvedPlate.heightMm,
                              docWidthMm,
                              docHeightMm,
                              'fit',
                              formPlacement,
                              showPressMarks ? 8 : 2
                            )
                          )
                        }
                        className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
                      >
                        {isFa ? 'فیت فرم' : 'Fit'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateLithoFormPlacement(
                            computeFitPlacementOnForm(
                              resolvedPlate.widthMm,
                              resolvedPlate.heightMm,
                              docWidthMm,
                              docHeightMm,
                              'fill',
                              formPlacement,
                              0
                            )
                          )
                        }
                        className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
                      >
                        {isFa ? 'پُرکردن' : 'Fill'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateLithoFormPlacement(
                            computeFitPlacementOnForm(
                              resolvedPlate.widthMm,
                              resolvedPlate.heightMm,
                              docWidthMm,
                              docHeightMm,
                              'actual',
                              formPlacement
                            )
                          )
                        }
                        className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
                      >
                        100%
                      </button>
                    </div>
                  </div>

                  {/* Rotation Controls */}
                  <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
                    <div className="mb-1 flex items-center justify-between text-[10.5px]">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {isFa ? 'چرخش در فرم (درجه):' : 'Rotation (deg):'}
                      </span>
                      <input
                        type="number"
                        min={-180}
                        max={180}
                        step={1}
                        data-litho-rotation
                        value={formPlacement.rotationDeg}
                        onChange={(e) =>
                          updateLithoFormPlacement({ rotationDeg: Number(e.target.value) || 0 })
                        }
                        className="w-16 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800"
                      />
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-[10px]">
                      {[0, 90, 180, -90].map((deg) => (
                        <button
                          key={deg}
                          type="button"
                          onClick={() => updateLithoFormPlacement({ rotationDeg: deg })}
                          className={`rounded border py-1 font-bold cursor-pointer ${
                            Math.abs(formPlacement.rotationDeg - deg) < 0.1
                              ? 'border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-400 dark:bg-amber-950/30 dark:text-amber-200'
                              : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {deg}°
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Margins readout inside form */}
                  <div className="rounded bg-slate-50 px-2 py-1.5 text-[10px] text-slate-600 tabular-nums dark:bg-slate-950/50 dark:text-slate-400">
                    {isFa
                      ? `فاصله از لبه‌های فرم — چپ: ${Math.round(artworkOnForm.bboxLeftMm * 10) / 10} · راست: ${Math.round((resolvedPlate.widthMm - (artworkOnForm.bboxLeftMm + artworkOnForm.bboxWidthMm)) * 10) / 10} · بالا: ${Math.round(artworkOnForm.bboxTopMm * 10) / 10} · پایین: ${Math.round((resolvedPlate.heightMm - (artworkOnForm.bboxTopMm + artworkOnForm.bboxHeightMm)) * 10) / 10} mm`
                      : `Margins — L: ${Math.round(artworkOnForm.bboxLeftMm * 10) / 10} · R: ${Math.round((resolvedPlate.widthMm - (artworkOnForm.bboxLeftMm + artworkOnForm.bboxWidthMm)) * 10) / 10} · T: ${Math.round(artworkOnForm.bboxTopMm * 10) / 10} · B: ${Math.round((resolvedPlate.heightMm - (artworkOnForm.bboxTopMm + artworkOnForm.bboxHeightMm)) * 10) / 10} mm`}
                  </div>
                </div>

                {/* Form Measurement Tool Panel */}
                <div className="rounded-lg border border-slate-200 p-2.5 space-y-2 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11.5px] font-bold text-slate-800 dark:text-slate-100">
                      <Ruler className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                      <span>{isFa ? 'ابزار اندازه‌گیری روی فرم' : 'Form Measurement Tool'}</span>
                    </div>
                    <button
                      type="button"
                      data-litho-activate-measure
                      onClick={() =>
                        setFormTool((prev) => (prev === 'measure' ? 'transform' : 'measure'))
                      }
                      className={`rounded px-2 py-0.5 text-[10.5px] font-bold cursor-pointer ${
                        formTool === 'measure'
                          ? 'bg-rose-600 text-white'
                          : 'bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-700'
                      }`}
                    >
                      {formTool === 'measure'
                        ? isFa
                          ? 'خط‌کش فعال'
                          : 'Active'
                        : isFa
                          ? 'فعال‌سازی خط‌کش'
                          : 'Activate'}
                    </button>
                  </div>

                  <div className="text-[10.5px] text-slate-500 dark:text-slate-400">
                    {isFa
                      ? 'ابزار اندازه‌گیری را فعال کنید و روی فرم بکشید (با Shift زاویه ۴۵°/۹۰° قفل می‌شود).'
                      : 'Activate Measure and drag across the form (hold Shift to snap 45°/90°).'}
                  </div>

                  {pinnedMeasurements.length === 0 ? (
                    <div className="rounded bg-slate-50 px-2 py-1.5 text-[10.5px] text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
                      {isFa
                        ? 'هنوز اندازه‌ای روی فرم ثبت نشده است.'
                        : 'No pinned measurements on the form yet.'}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-semibold text-slate-600 dark:text-slate-300">
                          {isFa
                            ? `اندازه‌های ثبت‌شده (${toPersianDigits(pinnedMeasurements.length)}):`
                            : `Pinned (${pinnedMeasurements.length}):`}
                        </span>
                        <button
                          type="button"
                          data-litho-clear-measurements
                          onClick={() => {
                            setPinnedMeasurements([]);
                            setActiveMeasure(null);
                          }}
                          className="text-rose-600 hover:underline dark:text-rose-400 cursor-pointer"
                        >
                          {isFa ? 'پاک‌کردن همه' : 'Clear All'}
                        </button>
                      </div>
                      <div className="max-h-36 space-y-1 overflow-y-auto">
                        {pinnedMeasurements.map((pm, idx) => {
                          const res = computeFormMeasurement(pm.x1Mm, pm.y1Mm, pm.x2Mm, pm.y2Mm);
                          return (
                            <div
                              key={pm.id}
                              className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10.5px] tabular-nums dark:border-slate-800 dark:bg-slate-950/60"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="font-bold text-slate-800 dark:text-slate-100">
                                  #{idx + 1}: {formatFormLength(res.distanceMm, settings.unit)}
                                </div>
                                <div className="text-[9.5px] text-slate-500 dark:text-slate-400">
                                  ΔX {res.dxMm} mm · ΔY {res.dyMm} mm · {res.angleDeg}°
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setPinnedMeasurements((prev) => prev.filter((x) => x.id !== pm.id))
                                }
                                className="rounded p-0.5 text-slate-400 hover:text-rose-600 cursor-pointer"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ==============================================================
                TAB 3: COLOR MANAGEMENT (ICC, Intent, GCR/TAC, Black Rule, Spot)
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
                        onChange={(e) => selectPlatePresetById(e.target.value)}
                        className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold dark:border-slate-700 dark:bg-slate-800"
                      >
                        <option value="fit-document">
                          {isFa ? 'هم‌اندازه سند + علائم برش (خودکار)' : 'Auto Fit Document + Marks'}
                        </option>
                        <optgroup label={isFa ? 'کاغذهای استاندارد (A3 / A4 / B3 / B4 / SRA3)' : 'Standard Paper Sizes'}>
                          {paperPresets.map((p) => (
                            <option key={p.id} value={p.id}>
                              {isFa ? p.nameFa : p.nameEn}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label={isFa ? 'پلیت‌های ماشین چاپ افست' : 'Offset Press Plates'}>
                          {pressPlatePresets.map((p) => (
                            <option key={p.id} value={p.id}>
                              {isFa ? p.nameFa : p.nameEn}
                            </option>
                          ))}
                        </optgroup>
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
