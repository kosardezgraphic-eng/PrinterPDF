import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  FileDown,
  FileUp,
  Grid2x2,
  Hash,
  Move,
  Plus,
  RotateCcw,
  Scissors,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  STANDARD_PAPER_SIZES,
  type PageOrientation,
  type PaperSizeId,
} from '@shared/models';
import { useAppStore } from '../store/useAppStore';
import {
  computeAutoGridCutLinesMm,
  getTicketGridMetrics,
  resolveTicketSlotText,
  ticketSequenceIndex,
  type TicketDirection,
  type TicketGuideKind,
  type TicketGuideLine,
  type TicketGuideOrientation,
  type TicketNumberSlot,
  type TicketOrderingMode,
} from '../engine/ticketNumbering';
import { useSystemFonts } from '../engine/systemFonts';
import { routeDroppedFiles } from '../engine/imageImport';

type TicketDrawTool = 'select' | 'perforation' | 'cut';

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function borderStyleFromStroke(style: 'solid' | 'dashed' | 'dotted'): 'solid' | 'dashed' | 'dotted' {
  return style === 'dotted' ? 'dotted' : style === 'dashed' ? 'dashed' : 'solid';
}

export const TicketNumberingWorkspace: React.FC = () => {
  const {
    settings,
    pages,
    isExportingPdf,
    exportProgress,
    ticketConfig,
    ticketSourceDocument,
    ticketSourcePages,
    ticketSelectedSourcePageId,
    setAppMode,
    updateTicketConfig,
    resetTicketConfig,
    setTicketSelectedSourcePageId,
    importTicketSourceFiles,
    useStudioActivePageAsTicketSource,
    clearTicketSource,
    generateTicketSheetsToStudio,
    exportTicketPdfDirect,
    importFromClipboard,
  } = useAppStore();

  const lang = settings.language;
  const isFa = lang === 'fa';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(
    () => ticketConfig.numberSlots[0]?.id ?? null
  );
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(
    () => ticketConfig.guideLines[0]?.id ?? null
  );
  const [drawTool, setDrawTool] = useState<TicketDrawTool>('select');
  const [drawOrientation, setDrawOrientation] = useState<TicketGuideOrientation>('vertical');
  const [previewSheetIndex, setPreviewSheetIndex] = useState(0);
  const [dragOverSource, setDragOverSource] = useState(false);

  const metrics = useMemo(() => getTicketGridMetrics(ticketConfig), [ticketConfig]);
  const autoGridLines = useMemo(() => computeAutoGridCutLinesMm(ticketConfig), [ticketConfig]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const width = el.clientWidth > 0 ? el.clientWidth : rect.width;
      const height = el.clientHeight > 0 ? el.clientHeight : rect.height;
      if (width > 40 && height > 40) {
        setStageSize((prev) =>
          prev && Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
            ? prev
            : { width, height }
        );
      }
    };

    measure();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const fittedSheetSize = useMemo(() => {
    if (!stageSize || stageSize.width <= 40 || stageSize.height <= 40) {
      return null;
    }
    const pad = 32; // matches p-4 stage padding (16px * 2)
    const availW = Math.max(120, stageSize.width - pad);
    const availH = Math.max(120, stageSize.height - pad);
    const pxPerMm = Math.min(availW / metrics.sheetWidthMm, availH / metrics.sheetHeightMm);
    return {
      width: round1(metrics.sheetWidthMm * pxPerMm),
      height: round1(metrics.sheetHeightMm * pxPerMm),
    };
  }, [stageSize, metrics.sheetWidthMm, metrics.sheetHeightMm]);

  useEffect(() => {
    setPreviewSheetIndex((prev) => clamp(prev, 0, Math.max(0, metrics.effectiveSheetCount - 1)));
  }, [metrics.effectiveSheetCount]);

  useEffect(() => {
    if (selectedSlotId && !ticketConfig.numberSlots.some((s) => s.id === selectedSlotId)) {
      setSelectedSlotId(ticketConfig.numberSlots[0]?.id ?? null);
    }
  }, [ticketConfig.numberSlots, selectedSlotId]);

  useEffect(() => {
    if (selectedGuideId && !ticketConfig.guideLines.some((g) => g.id === selectedGuideId)) {
      setSelectedGuideId(ticketConfig.guideLines[0]?.id ?? null);
    }
  }, [ticketConfig.guideLines, selectedGuideId]);

  const selectedSlot =
    ticketConfig.numberSlots.find((s) => s.id === selectedSlotId) ??
    ticketConfig.numberSlots[0] ??
    null;

  const selectedGuide =
    ticketConfig.guideLines.find((g) => g.id === selectedGuideId) ?? null;

  const selectedSourcePage =
    ticketSourcePages.find((p) => p.id === ticketSelectedSourcePageId) ??
    ticketSourcePages[0] ??
    null;

  const { bundledFonts, systemFonts } = useSystemFonts(selectedSlot?.fontFamily);

  const hGutter = Math.max(0, ticketConfig.horizontalGutterMm);
  const vGutter = Math.max(0, ticketConfig.verticalGutterMm);

  const updateSlot = (slotId: string, patch: Partial<TicketNumberSlot>) => {
    updateTicketConfig((prev) => ({
      ...prev,
      numberSlots: prev.numberSlots.map((s) => (s.id === slotId ? { ...s, ...patch } : s)),
    }));
  };

  const addNumberSlot = () => {
    const idx = ticketConfig.numberSlots.length + 1;
    const id = `slot-${Date.now().toString(36)}-${idx}`;
    const newSlot: TicketNumberSlot = {
      id,
      label: isFa ? `شماره ${idx}` : `Number ${idx}`,
      template: 'شماره {serial}',
      xPercent: clamp(10 + (idx - 1) * 12, 4, 68),
      yPercent: clamp(8 + (idx - 1) * 14, 4, 78),
      widthPercent: 28,
      heightPercent: 14,
      fontSize: 11,
      fontFamily: 'Vazirmatn',
      color: '#0f172a',
      backgroundColor: 'transparent',
      bold: true,
      italic: false,
      align: 'center',
      rotation: 0,
      slotOffset: 0,
    };
    updateTicketConfig((prev) => ({
      ...prev,
      numberSlots: [...prev.numberSlots, newSlot],
    }));
    setSelectedSlotId(id);
  };

  const removeSlot = (slotId: string) => {
    updateTicketConfig((prev) => ({
      ...prev,
      numberSlots: prev.numberSlots.filter((s) => s.id !== slotId),
    }));
  };

  const updateGuide = (guideId: string, patch: Partial<TicketGuideLine>) => {
    updateTicketConfig((prev) => ({
      ...prev,
      guideLines: prev.guideLines.map((g) => (g.id === guideId ? { ...g, ...patch } : g)),
    }));
  };

  const addGuideLine = (
    kind: TicketGuideKind,
    orientation: TicketGuideOrientation,
    positionPercent = 50
  ): string => {
    const id = `guide-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const count = ticketConfig.guideLines.length + 1;
    const isCut = kind === 'cut';
    const nextGuide: TicketGuideLine = {
      id,
      label: isFa
        ? `${isCut ? 'خط برش' : 'خط پرفراژ'} ${orientation === 'vertical' ? 'عمودی' : 'افقی'} ${count}`
        : `${isCut ? 'Cut' : 'Perforation'} ${orientation === 'vertical' ? 'V' : 'H'} ${count}`,
      kind,
      orientation,
      positionPercent: round1(clamp(positionPercent, 1, 99)),
      extendFullSheet: true,
      strokeColor: isCut ? '#e11d48' : '#0284c7',
      strokeStyle: isCut ? 'solid' : 'dashed',
      strokeWidth: isCut ? 0.9 : 0.85,
    };
    updateTicketConfig((prev) => ({
      ...prev,
      guideLines: [...prev.guideLines, nextGuide],
    }));
    setSelectedGuideId(id);
    return id;
  };

  const removeGuide = (guideId: string) => {
    updateTicketConfig((prev) => ({
      ...prev,
      guideLines: prev.guideLines.filter((g) => g.id !== guideId),
    }));
  };

  const getCellPercentBounds = (row: number, col: number) => {
    const leftMm = ticketConfig.marginsMm.left + col * (metrics.cellWidthMm + hGutter);
    const topMm = ticketConfig.marginsMm.top + row * (metrics.cellHeightMm + vGutter);
    return {
      leftPct: (leftMm / metrics.sheetWidthMm) * 100,
      topPct: (topMm / metrics.sheetHeightMm) * 100,
      widthPct: (metrics.cellWidthMm / metrics.sheetWidthMm) * 100,
      heightPct: (metrics.cellHeightMm / metrics.sheetHeightMm) * 100,
    };
  };

  const clientPointToSheetMm = (clientX: number, clientY: number) => {
    const el = sheetRef.current;
    const rect = el?.getBoundingClientRect();
    const w = rect && rect.width > 0 ? rect.width : 500;
    const h = rect && rect.height > 0 ? rect.height : 700;
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    const relX = clamp((clientX - left) / w, 0, 1);
    const relY = clamp((clientY - top) / h, 0, 1);
    return {
      xMm: relX * metrics.sheetWidthMm,
      yMm: relY * metrics.sheetHeightMm,
      sheetPxW: w,
      sheetPxH: h,
    };
  };

  const findNearestCellForMm = (xMm: number, yMm: number): { row: number; col: number } => {
    let bestRow = 0;
    let bestCol = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let r = 0; r < metrics.rows; r++) {
      const cy =
        ticketConfig.marginsMm.top +
        r * (metrics.cellHeightMm + vGutter) +
        metrics.cellHeightMm / 2;
      for (let c = 0; c < metrics.cols; c++) {
        const cx =
          ticketConfig.marginsMm.left +
          c * (metrics.cellWidthMm + hGutter) +
          metrics.cellWidthMm / 2;
        const d = (xMm - cx) ** 2 + (yMm - cy) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestRow = r;
          bestCol = c;
        }
      }
    }
    return { row: bestRow, col: bestCol };
  };

  const positionPercentInsideCell = (
    clientX: number,
    clientY: number,
    orientation: TicketGuideOrientation,
    fixedRow?: number,
    fixedCol?: number
  ): number => {
    const { xMm, yMm } = clientPointToSheetMm(clientX, clientY);
    const cell =
      fixedRow !== undefined && fixedCol !== undefined
        ? { row: fixedRow, col: fixedCol }
        : findNearestCellForMm(xMm, yMm);
    if (orientation === 'vertical') {
      const cellLeftMm = ticketConfig.marginsMm.left + cell.col * (metrics.cellWidthMm + hGutter);
      return round1(clamp(((xMm - cellLeftMm) / Math.max(1, metrics.cellWidthMm)) * 100, 0.5, 99.5));
    }
    const cellTopMm = ticketConfig.marginsMm.top + cell.row * (metrics.cellHeightMm + vGutter);
    return round1(clamp(((yMm - cellTopMm) / Math.max(1, metrics.cellHeightMm)) * 100, 0.5, 99.5));
  };

  const attachWindowDrag = (
    onMove: (ev: PointerEvent | MouseEvent) => void,
    onDone?: () => void
  ) => {
    const handleUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      onDone?.();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  };

  const startSlotDrag = (
    e: React.PointerEvent<HTMLElement>,
    slot: TicketNumberSlot,
    mode: 'move' | 'resize',
    row: number,
    col: number
  ) => {
    if (drawTool !== 'select' || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedSlotId(slot.id);

    const sheetBounds = sheetRef.current?.getBoundingClientRect();
    const cellEl = e.currentTarget.closest<HTMLElement>('[data-ticket-cell]');
    const cellRect = cellEl?.getBoundingClientRect();
    const bounds = getCellPercentBounds(row, col);

    const cellPxW =
      cellRect && cellRect.width > 0
        ? cellRect.width
        : sheetBounds && sheetBounds.width > 0
          ? (sheetBounds.width * bounds.widthPct) / 100
          : 240;
    const cellPxH =
      cellRect && cellRect.height > 0
        ? cellRect.height
        : sheetBounds && sheetBounds.height > 0
          ? (sheetBounds.height * bounds.heightPct) / 100
          : 120;

    const startX = e.clientX;
    const startY = e.clientY;
    const initX = slot.xPercent;
    const initY = slot.yPercent;
    const initW = slot.widthPercent;
    const initH = slot.heightPercent;

    attachWindowDrag((moveEv) => {
      const dxPct = ((moveEv.clientX - startX) / Math.max(1, cellPxW)) * 100;
      const dyPct = ((moveEv.clientY - startY) / Math.max(1, cellPxH)) * 100;
      if (mode === 'move') {
        updateSlot(slot.id, {
          xPercent: round1(clamp(initX + dxPct, 0, Math.max(0, 100 - initW))),
          yPercent: round1(clamp(initY + dyPct, 0, Math.max(0, 100 - initH))),
        });
      } else {
        updateSlot(slot.id, {
          widthPercent: round1(clamp(initW + dxPct, 6, Math.max(6, 100 - initX))),
          heightPercent: round1(clamp(initH + dyPct, 5, Math.max(5, 100 - initY))),
        });
      }
    });
  };

  const startGuideDrag = (
    e: React.PointerEvent<HTMLElement>,
    guide: TicketGuideLine,
    fixedRow?: number,
    fixedCol?: number
  ) => {
    if (drawTool !== 'select' || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedGuideId(guide.id);

    attachWindowDrag((moveEv) => {
      const nextPos = positionPercentInsideCell(
        moveEv.clientX,
        moveEv.clientY,
        guide.orientation,
        fixedRow,
        fixedCol
      );
      updateGuide(guide.id, { positionPercent: nextPos });
    });
  };

  const handleSheetPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drawTool === 'select' || e.button !== 0) return;
    e.preventDefault();
    const { xMm, yMm } = clientPointToSheetMm(e.clientX, e.clientY);
    const { row, col } = findNearestCellForMm(xMm, yMm);
    const initialPos = positionPercentInsideCell(e.clientX, e.clientY, drawOrientation, row, col);
    const newId = addGuideLine(drawTool, drawOrientation, initialPos);

    attachWindowDrag(
      (moveEv) => {
        const nextPos = positionPercentInsideCell(
          moveEv.clientX,
          moveEv.clientY,
          drawOrientation,
          row,
          col
        );
        updateGuide(newId, { positionPercent: nextPos });
      },
      () => {
        setDrawTool('select');
      }
    );
  };

  const handleExportPdf = async () => {
    await exportTicketPdfDirect();
  };

  const startSerial = ticketConfig.startNumber;
  const endSerial =
    startSerial + Math.max(0, metrics.totalTickets - 1) * (ticketConfig.step || 1);

  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
  const cardClass =
    'rounded-xl border border-slate-200 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900/90';

  return (
    <section
      data-ticket-workspace
      dir={isFa ? 'rtl' : 'ltr'}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
    >
      {/* Top Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAppMode('studio')}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          >
            {isFa ? <ArrowRight className="h-3.5 w-3.5" /> : <ArrowLeft className="h-3.5 w-3.5" />}
            <span>{isFa ? 'بازگشت به استودیو' : 'Back to Studio'}</span>
          </button>

          <div className="flex items-center gap-1.5 px-1">
            <Hash className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <h1 className="text-xs font-extrabold sm:text-sm">
              {isFa
                ? 'شماره‌گذاری قبض و فرم چندقسمتی (پرفراژ و برش)'
                : 'Ticket & Multi-Form Numbering (Cut & Perforation)'}
            </h1>
          </div>

          <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 tabular-nums">
            {metrics.rows}×{metrics.cols} · {metrics.effectiveSheetCount}{' '}
            {isFa ? 'شیت' : 'sheets'} · {metrics.totalTickets} {isFa ? 'قبض' : 'tickets'} ({startSerial}–{endSerial})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={resetTicketConfig}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{isFa ? 'بازنشانی' : 'Reset'}</span>
          </button>

          <button
            type="button"
            data-ticket-export-pdf
            disabled={isExportingPdf}
            onClick={() => void handleExportPdf()}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 dark:bg-emerald-600/20 dark:text-emerald-300 dark:hover:bg-emerald-600/30 cursor-pointer tabular-nums"
          >
            <FileDown className="h-3.5 w-3.5" />
            <span>
              {isExportingPdf
                ? isFa
                  ? `در حال ساخت PDF... ${exportProgress}%`
                  : `Exporting PDF... ${exportProgress}%`
                : isFa
                  ? 'ساخت و خروجی PDF'
                  : 'Generate & Export PDF'}
            </span>
          </button>

          <button
            type="button"
            data-ticket-generate-studio
            onClick={() => generateTicketSheetsToStudio()}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-sky-500 cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{isFa ? 'تولید شیت‌ها و نمایش در استودیو' : 'Generate Sheets to Studio'}</span>
          </button>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[380px_1fr]">
        {/* Left Scrollable Configuration Panel */}
        <aside className="min-h-0 space-y-3 overflow-y-auto pr-1">
          {/* 1. Sheet & Grid Division */}
          <div className={cardClass}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
              <Grid2x2 className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
              <span>{isFa ? '۱. ابعاد کاغذ و تقسیم‌بندی صفحه' : '1. Paper & Page Division'}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <label className="block">
                <span className="mb-0.5 block text-slate-600 dark:text-slate-400">
                  {isFa ? 'سایز کاغذ' : 'Paper size'}
                </span>
                <select
                  aria-label={isFa ? 'سایز کاغذ قبض' : 'Ticket paper size'}
                  value={ticketConfig.paperSize}
                  onChange={(e) => {
                    const size = e.target.value as PaperSizeId;
                    const dims = size !== 'Custom' ? STANDARD_PAPER_SIZES[size] : null;
                    updateTicketConfig({
                      paperSize: size,
                      ...(dims ? { customWidthMm: dims.widthMm, customHeightMm: dims.heightMm } : {}),
                    });
                  }}
                  className={inputClass}
                >
                  {(Object.keys(STANDARD_PAPER_SIZES) as Array<Exclude<PaperSizeId, 'Custom'>>).map((k) => (
                    <option key={k} value={k}>
                      {k} ({STANDARD_PAPER_SIZES[k].widthMm}×{STANDARD_PAPER_SIZES[k].heightMm})
                    </option>
                  ))}
                  <option value="Custom">{isFa ? 'سفارشی (Custom)' : 'Custom'}</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-0.5 block text-slate-600 dark:text-slate-400">
                  {isFa ? 'جهت برگه' : 'Orientation'}
                </span>
                <select
                  aria-label={isFa ? 'جهت برگه قبض' : 'Ticket orientation'}
                  value={ticketConfig.orientation}
                  onChange={(e) =>
                    updateTicketConfig({ orientation: e.target.value as PageOrientation })
                  }
                  className={inputClass}
                >
                  <option value="portrait">{isFa ? 'عمودی (Portrait)' : 'Portrait'}</option>
                  <option value="landscape">{isFa ? 'افقی (Landscape)' : 'Landscape'}</option>
                </select>
              </label>

              {ticketConfig.paperSize === 'Custom' && (
                <>
                  <label className="block">
                    <span className="mb-0.5 block text-slate-600 dark:text-slate-400">
                      {isFa ? 'عرض (mm)' : 'Width (mm)'}
                    </span>
                    <input
                      type="number"
                      min={20}
                      max={1500}
                      value={ticketConfig.customWidthMm}
                      onChange={(e) =>
                        updateTicketConfig({ customWidthMm: clamp(Number(e.target.value), 20, 1500) })
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-slate-600 dark:text-slate-400">
                      {isFa ? 'ارتفاع (mm)' : 'Height (mm)'}
                    </span>
                    <input
                      type="number"
                      min={20}
                      max={1500}
                      value={ticketConfig.customHeightMm}
                      onChange={(e) =>
                        updateTicketConfig({ customHeightMm: clamp(Number(e.target.value), 20, 1500) })
                      }
                      className={inputClass}
                    />
                  </label>
                </>
              )}
            </div>

            {/* Quick grid division presets */}
            <div className="mt-2 flex flex-wrap gap-1">
              {[
                { rows: 3, cols: 1, label: isFa ? '۳ تایی عمودی (3×1)' : '3×1' },
                { rows: 2, cols: 2, label: isFa ? '۴ تایی (2×2)' : '2×2' },
                { rows: 4, cols: 1, label: isFa ? '۴ تایی عمودی (4×1)' : '4×1' },
                { rows: 3, cols: 2, label: isFa ? '۶ تایی (3×2)' : '3×2' },
                { rows: 2, cols: 4, label: isFa ? '۸ تایی (2×4)' : '2×4' },
              ].map((preset) => {
                const active =
                  ticketConfig.rows === preset.rows && ticketConfig.cols === preset.cols;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => updateTicketConfig({ rows: preset.rows, cols: preset.cols })}
                    className={`rounded-md px-2 py-1 text-[10px] font-bold transition cursor-pointer ${
                      active
                        ? 'bg-sky-600 text-white'
                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 grid grid-cols-4 gap-1.5 text-[11px]">
              <label className="block">
                <span className="mb-0.5 block text-slate-500">{isFa ? 'ردیف' : 'Rows'}</span>
                <input
                  type="number"
                  aria-label={isFa ? 'تعداد ردیف' : 'Rows'}
                  min={1}
                  max={12}
                  value={ticketConfig.rows}
                  onChange={(e) =>
                    updateTicketConfig({ rows: clamp(Number(e.target.value), 1, 12) })
                  }
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-slate-500">{isFa ? 'ستون' : 'Cols'}</span>
                <input
                  type="number"
                  aria-label={isFa ? 'تعداد ستون' : 'Columns'}
                  min={1}
                  max={12}
                  value={ticketConfig.cols}
                  onChange={(e) =>
                    updateTicketConfig({ cols: clamp(Number(e.target.value), 1, 12) })
                  }
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-slate-500">{isFa ? 'فاصله افقی' : 'H-Gap'}</span>
                <input
                  type="number"
                  min={0}
                  max={40}
                  step={0.5}
                  value={ticketConfig.horizontalGutterMm}
                  onChange={(e) =>
                    updateTicketConfig({ horizontalGutterMm: clamp(Number(e.target.value), 0, 40) })
                  }
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-slate-500">{isFa ? 'فاصله عمودی' : 'V-Gap'}</span>
                <input
                  type="number"
                  min={0}
                  max={40}
                  step={0.5}
                  value={ticketConfig.verticalGutterMm}
                  onChange={(e) =>
                    updateTicketConfig({ verticalGutterMm: clamp(Number(e.target.value), 0, 40) })
                  }
                  className={inputClass}
                />
              </label>
            </div>

            <div className="mt-2 grid grid-cols-4 gap-1.5 text-[10px]">
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <label key={side} className="block">
                  <span className="mb-0.5 block text-slate-500">
                    {isFa
                      ? { top: 'حاشیه بالا', right: 'راست', bottom: 'پایین', left: 'چپ' }[side]
                      : side}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    step={0.5}
                    value={ticketConfig.marginsMm[side]}
                    onChange={(e) =>
                      updateTicketConfig((prev) => ({
                        ...prev,
                        marginsMm: {
                          ...prev.marginsMm,
                          [side]: clamp(Number(e.target.value), 0, 50),
                        },
                      }))
                    }
                    className={inputClass}
                  />
                </label>
              ))}
            </div>
          </div>

          {/* 2. Quantity, Ordering & Format */}
          <div className={cardClass}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
              <Hash className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{isFa ? '۲. ترتیب شماره‌گذاری و تیراژ چاپ' : '2. Numbering Sequence & Quantity'}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <label className="col-span-2 block">
                <span className="mb-0.5 block font-semibold text-slate-700 dark:text-slate-300">
                  {isFa ? 'الگوی چیدمان شماره‌ها در شیت‌ها' : 'Ticket Numbering Order'}
                </span>
                <select
                  data-ticket-ordering-mode
                  aria-label={isFa ? 'الگوی چیدمان شماره‌ها در شیت‌ها' : 'Ticket Numbering Order'}
                  value={ticketConfig.orderingMode}
                  onChange={(e) =>
                    updateTicketConfig({ orderingMode: e.target.value as TicketOrderingMode })
                  }
                  className={inputClass}
                >
                  <option value="cut-stack">
                    {isFa
                      ? 'روی هم / پشت‌سرهم پس از برش (Cut & Stack — پیش‌فرض)'
                      : 'Cut & Stack (Sequential per pile across sheets — Default)'}
                  </option>
                  <option value="per-sheet">
                    {isFa
                      ? 'صفحه‌ای (شماره‌های پشت‌سرهم داخل هر شیت)'
                      : 'Per Sheet (Consecutive within each sheet)'}
                  </option>
                </select>
              </label>

              <label className="block">
                <span className="mb-0.5 block text-slate-600 dark:text-slate-400">
                  {isFa ? 'مبنای تعداد' : 'Quantity mode'}
                </span>
                <select
                  value={ticketConfig.quantityMode}
                  onChange={(e) =>
                    updateTicketConfig({
                      quantityMode: e.target.value as 'sheets' | 'tickets',
                    })
                  }
                  className={inputClass}
                >
                  <option value="sheets">{isFa ? 'تعداد برگ کاغذ (شیت)' : 'Sheet count'}</option>
                  <option value="tickets">{isFa ? 'تعداد کل قبض' : 'Total ticket count'}</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-0.5 block text-slate-600 dark:text-slate-400">
                  {ticketConfig.quantityMode === 'sheets'
                    ? isFa
                      ? 'تعداد شیت'
                      : 'Sheets'
                    : isFa
                      ? 'تعداد قبض'
                      : 'Tickets'}
                </span>
                <input
                  type="number"
                  aria-label={
                    ticketConfig.quantityMode === 'sheets'
                      ? isFa
                        ? 'تعداد شیت چاپ'
                        : 'Sheet count'
                      : isFa
                        ? 'تعداد کل قبض'
                        : 'Ticket count'
                  }
                  min={1}
                  max={2000}
                  value={
                    ticketConfig.quantityMode === 'sheets'
                      ? ticketConfig.sheetCount
                      : ticketConfig.ticketCount
                  }
                  onChange={(e) => {
                    const val = clamp(Number(e.target.value), 1, 2000);
                    updateTicketConfig(
                      ticketConfig.quantityMode === 'sheets'
                        ? { sheetCount: val }
                        : { ticketCount: val }
                    );
                  }}
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-0.5 block text-slate-600 dark:text-slate-400">
                  {isFa ? 'شروع شماره از' : 'Start number'}
                </span>
                <input
                  type="number"
                  aria-label={isFa ? 'شروع شماره قبض' : 'Ticket start number'}
                  value={ticketConfig.startNumber}
                  onChange={(e) =>
                    updateTicketConfig({
                      startNumber: Number.isFinite(Number(e.target.value))
                        ? Math.trunc(Number(e.target.value))
                        : 1,
                    })
                  }
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-0.5 block text-slate-600 dark:text-slate-400">
                  {isFa ? 'گام افزایش' : 'Step'}
                </span>
                <input
                  type="number"
                  value={ticketConfig.step}
                  onChange={(e) => {
                    const v = Math.trunc(Number(e.target.value));
                    updateTicketConfig({ step: v === 0 || !Number.isFinite(v) ? 1 : v });
                  }}
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-0.5 block text-slate-600 dark:text-slate-400">
                  {isFa ? 'تعداد صفر پیشوند' : 'Zero padding'}
                </span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={ticketConfig.padZeros}
                  onChange={(e) =>
                    updateTicketConfig({ padZeros: clamp(Number(e.target.value), 0, 10) })
                  }
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-0.5 block text-slate-600 dark:text-slate-400">
                  {isFa ? 'نوع ارقام' : 'Digit script'}
                </span>
                <select
                  value={ticketConfig.format}
                  onChange={(e) =>
                    updateTicketConfig({ format: e.target.value as 'english' | 'persian' })
                  }
                  className={inputClass}
                >
                  <option value="english">{isFa ? 'انگلیسی (1001)' : 'English (1001)'}</option>
                  <option value="persian">{isFa ? 'فارسی (۱۰۰۱)' : 'Persian (۱۰۰۱)'}</option>
                </select>
              </label>

              <label className="col-span-2 block">
                <span className="mb-0.5 block text-slate-600 dark:text-slate-400">
                  {isFa ? 'جهت چیدمان در خانه‌ها' : 'Grid cell walk direction'}
                </span>
                <select
                  aria-label={isFa ? 'جهت چیدمان قبض' : 'Ticket cell direction'}
                  value={ticketConfig.direction}
                  onChange={(e) =>
                    updateTicketConfig({ direction: e.target.value as TicketDirection })
                  }
                  className={inputClass}
                >
                  <option value="rtl">{isFa ? 'راست به چپ (RTL)' : 'Right to Left (RTL)'}</option>
                  <option value="ltr">{isFa ? 'چپ به راست (LTR)' : 'Left to Right (LTR)'}</option>
                  <option value="ttb">{isFa ? 'ستونی بالا به پایین' : 'Top to Bottom columns'}</option>
                  <option value="zigzag">{isFa ? 'زیگزاگ رفت‌وبرگشتی' : 'Zigzag'}</option>
                </select>
              </label>
            </div>
          </div>

          {/* 3. Number Slots per Ticket */}
          <div className={cardClass}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                {isFa ? '۳. باکس‌های شماره روی هر قبض' : '3. Number Slots per Ticket'}
              </span>
              <button
                type="button"
                data-ticket-add-slot
                onClick={addNumberSlot}
                className="flex items-center gap-1 rounded-md bg-sky-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-sky-500 cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                <span>{isFa ? 'باکس شماره' : 'Add Slot'}</span>
              </button>
            </div>

            <div className="mb-2 flex flex-wrap gap-1">
              {ticketConfig.numberSlots.map((slot, idx) => (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => setSelectedSlotId(slot.id)}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition cursor-pointer ${
                    selectedSlot?.id === slot.id
                      ? 'bg-sky-600 text-white'
                      : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  {slot.label || `#${idx + 1}`}
                </button>
              ))}
            </div>

            {selectedSlot && (
              <div className="space-y-2 border-t border-slate-100 pt-2 text-[11px] dark:border-slate-800">
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="block">
                    <span className="mb-0.5 block text-slate-500">{isFa ? 'عنوان' : 'Label'}</span>
                    <input
                      type="text"
                      value={selectedSlot.label}
                      onChange={(e) => updateSlot(selectedSlot.id, { label: e.target.value })}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-slate-500">
                      {isFa ? 'الگو ({serial})' : 'Template ({serial})'}
                    </span>
                    <input
                      type="text"
                      aria-label={isFa ? 'الگوی متن شماره' : 'Number slot template'}
                      value={selectedSlot.template}
                      onChange={(e) => updateSlot(selectedSlot.id, { template: e.target.value })}
                      className={inputClass}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  <label className="block">
                    <span className="mb-0.5 block text-slate-500">X (%)</span>
                    <input
                      type="number"
                      step={0.5}
                      value={selectedSlot.xPercent}
                      onChange={(e) =>
                        updateSlot(selectedSlot.id, {
                          xPercent: clamp(Number(e.target.value), 0, 95),
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-slate-500">Y (%)</span>
                    <input
                      type="number"
                      step={0.5}
                      value={selectedSlot.yPercent}
                      onChange={(e) =>
                        updateSlot(selectedSlot.id, {
                          yPercent: clamp(Number(e.target.value), 0, 95),
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-slate-500">W (%)</span>
                    <input
                      type="number"
                      step={0.5}
                      value={selectedSlot.widthPercent}
                      onChange={(e) =>
                        updateSlot(selectedSlot.id, {
                          widthPercent: clamp(Number(e.target.value), 4, 100),
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-slate-500">H (%)</span>
                    <input
                      type="number"
                      step={0.5}
                      value={selectedSlot.heightPercent}
                      onChange={(e) =>
                        updateSlot(selectedSlot.id, {
                          heightPercent: clamp(Number(e.target.value), 4, 100),
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <label className="col-span-2 block">
                    <span className="mb-0.5 block text-slate-500">{isFa ? 'فونت' : 'Font'}</span>
                    <select
                      value={selectedSlot.fontFamily}
                      onChange={(e) => updateSlot(selectedSlot.id, { fontFamily: e.target.value })}
                      className={inputClass}
                    >
                      {bundledFonts.map((f) => (
                        <option key={`b:${f}`} value={f}>
                          {f}
                        </option>
                      ))}
                      {systemFonts.map((f) => (
                        <option key={`s:${f}`} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-slate-500">{isFa ? 'سایز (pt)' : 'Size'}</span>
                    <input
                      type="number"
                      min={6}
                      max={64}
                      value={selectedSlot.fontSize}
                      onChange={(e) =>
                        updateSlot(selectedSlot.id, {
                          fontSize: clamp(Number(e.target.value), 6, 64),
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      aria-label={isFa ? 'رنگ شماره' : 'Slot color'}
                      value={
                        /^#[0-9a-f]{6}$/i.test(selectedSlot.color) ? selectedSlot.color : '#0f172a'
                      }
                      onChange={(e) => updateSlot(selectedSlot.id, { color: e.target.value })}
                      className="h-6 w-7 cursor-pointer rounded border border-slate-300"
                    />
                    <button
                      type="button"
                      onClick={() => updateSlot(selectedSlot.id, { bold: !selectedSlot.bold })}
                      className={`rounded px-2 py-1 font-bold cursor-pointer ${
                        selectedSlot.bold
                          ? 'bg-sky-600 text-white'
                          : 'border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      B
                    </button>
                    {(['right', 'center', 'left'] as const).map((al) => (
                      <button
                        key={al}
                        type="button"
                        onClick={() => updateSlot(selectedSlot.id, { align: al })}
                        className={`rounded px-1.5 py-1 text-[10px] cursor-pointer ${
                          selectedSlot.align === al
                            ? 'bg-sky-600 text-white'
                            : 'border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {isFa ? { right: 'راست', center: 'وسط', left: 'چپ' }[al] : al[0].toUpperCase()}
                      </button>
                    ))}
                  </div>

                  {ticketConfig.numberSlots.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSlot(selectedSlot.id)}
                      className="flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>{isFa ? 'حذف' : 'Delete'}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 4. Cut & Perforation Lines */}
          <div className={cardClass}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                <Scissors className="h-3.5 w-3.5 text-rose-500" />
                <span>{isFa ? '۴. خطوط برش و پرفراژ' : '4. Cut & Perforation Lines'}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => addGuideLine('perforation', 'vertical', 36)}
                  className="rounded bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-sky-500 cursor-pointer"
                >
                  + {isFa ? 'پرفراژ' : 'Perf'}
                </button>
                <button
                  type="button"
                  onClick={() => addGuideLine('cut', 'horizontal', 50)}
                  className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-rose-500 cursor-pointer"
                >
                  + {isFa ? 'برش' : 'Cut'}
                </button>
              </div>
            </div>

            <label className="mb-2 flex items-center gap-2 text-[11px] font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={ticketConfig.autoGridCutLines}
                onChange={(e) => updateTicketConfig({ autoGridCutLines: e.target.checked })}
                className="accent-sky-600"
              />
              <span>
                {isFa ? 'خطوط برش خودکار بین خانه‌های جدول' : 'Automatic grid cut lines between cells'}
              </span>
            </label>

            <div className="mb-2 flex flex-wrap gap-1">
              {ticketConfig.guideLines.map((guide) => (
                <button
                  key={guide.id}
                  type="button"
                  onClick={() => setSelectedGuideId(guide.id)}
                  className={`rounded-md px-2 py-1 text-[10px] font-semibold transition cursor-pointer ${
                    selectedGuide?.id === guide.id
                      ? 'bg-sky-600 text-white'
                      : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  {guide.label} ({Math.round(guide.positionPercent)}%)
                </button>
              ))}
            </div>

            {selectedGuide && (
              <div className="space-y-2 border-t border-slate-100 pt-2 text-[11px] dark:border-slate-800">
                <div className="grid grid-cols-3 gap-1.5">
                  <label className="block">
                    <span className="mb-0.5 block text-slate-500">{isFa ? 'نوع' : 'Kind'}</span>
                    <select
                      value={selectedGuide.kind}
                      onChange={(e) =>
                        updateGuide(selectedGuide.id, { kind: e.target.value as TicketGuideKind })
                      }
                      className={inputClass}
                    >
                      <option value="perforation">{isFa ? 'پرفراژ' : 'Perforation'}</option>
                      <option value="cut">{isFa ? 'برش' : 'Cut'}</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-slate-500">{isFa ? 'جهت' : 'Axis'}</span>
                    <select
                      value={selectedGuide.orientation}
                      onChange={(e) =>
                        updateGuide(selectedGuide.id, {
                          orientation: e.target.value as TicketGuideOrientation,
                        })
                      }
                      className={inputClass}
                    >
                      <option value="vertical">{isFa ? 'عمودی' : 'Vertical'}</option>
                      <option value="horizontal">{isFa ? 'افقی' : 'Horizontal'}</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-slate-500">
                      {isFa ? 'موقعیت (%)' : 'Pos (%)'}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={selectedGuide.positionPercent}
                      onChange={(e) =>
                        updateGuide(selectedGuide.id, {
                          positionPercent: clamp(Number(e.target.value), 0, 100),
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedGuide.extendFullSheet}
                      onChange={(e) =>
                        updateGuide(selectedGuide.id, { extendFullSheet: e.target.checked })
                      }
                      className="accent-sky-600"
                    />
                    <span className="text-[10px]">
                      {isFa ? 'سرتاسری در شیت' : 'Extend across full sheet'}
                    </span>
                  </label>

                  <div className="flex items-center gap-1.5">
                    <select
                      value={selectedGuide.strokeStyle}
                      onChange={(e) =>
                        updateGuide(selectedGuide.id, {
                          strokeStyle: e.target.value as 'solid' | 'dashed' | 'dotted',
                        })
                      }
                      className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value="dashed">{isFa ? 'خط‌چین' : 'Dashed'}</option>
                      <option value="dotted">{isFa ? 'نقطه‌چین' : 'Dotted'}</option>
                      <option value="solid">{isFa ? 'ممتد' : 'Solid'}</option>
                    </select>
                    <input
                      type="color"
                      value={
                        /^#[0-9a-f]{6}$/i.test(selectedGuide.strokeColor)
                          ? selectedGuide.strokeColor
                          : '#0284c7'
                      }
                      onChange={(e) =>
                        updateGuide(selectedGuide.id, { strokeColor: e.target.value })
                      }
                      className="h-6 w-7 cursor-pointer rounded border border-slate-300"
                    />
                    <button
                      type="button"
                      onClick={() => removeGuide(selectedGuide.id)}
                      className="rounded border border-rose-200 bg-rose-50 px-1.5 py-1 text-[10px] font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Right Interactive Canvas & Form Source */}
        <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
          {/* Form Source Bar */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverSource(true);
            }}
            onDragLeave={() => setDragOverSource(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverSource(false);
              const files = Array.from(e.dataTransfer.files);
              const { documents } = routeDroppedFiles(files, false);
              if (documents.length) void importTicketSourceFiles(documents);
            }}
            className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs transition ${
              dragOverSource
                ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/30'
                : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*,.tif,.tiff,.psd,.webp,.heic,.heif,.bmp,.svg"
              className="hidden"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                if (files.length) void importTicketSourceFiles(files);
                e.target.value = '';
              }}
            />

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 cursor-pointer"
              >
                <FileUp className="h-3.5 w-3.5 text-sky-600" />
                <span>{isFa ? 'بارگذاری طرح قبض (PDF / تصویر)' : 'Load Form (PDF / Image)'}</span>
              </button>

              <button
                type="button"
                onClick={() => void importFromClipboard()}
                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <ClipboardPaste className="h-3.5 w-3.5 text-indigo-500" />
                <span>{isFa ? 'چسباندن از کلیپ‌بورد' : 'Paste Image'}</span>
              </button>

              <button
                type="button"
                disabled={pages.length === 0}
                onClick={() => useStudioActivePageAsTicketSource()}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer disabled:cursor-not-allowed"
              >
                {isFa ? 'استفاده از صفحه استودیو' : 'Use Studio Page'}
              </button>

              {ticketSourceDocument && (
                <button
                  type="button"
                  onClick={clearTicketSource}
                  className="flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300 cursor-pointer"
                >
                  <X className="h-3 w-3" />
                  <span>{isFa ? 'فرم سفید خام' : 'Clear Form'}</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400">
              <span>
                {ticketSourceDocument
                  ? `${isFa ? 'طرح فعال:' : 'Form:'} ${ticketSourceDocument.name}`
                  : isFa
                    ? 'حالت فعلی: فرم سفید خام'
                    : 'Current base: Clean blank card'}
              </span>
              {ticketSourcePages.length > 1 && (
                <select
                  aria-label={isFa ? 'انتخاب صفحه فرم' : 'Select form page'}
                  value={selectedSourcePage?.id ?? ''}
                  onChange={(e) => setTicketSelectedSourcePageId(e.target.value)}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-800"
                >
                  {ticketSourcePages.map((p, idx) => (
                    <option key={p.id} value={p.id}>
                      {isFa ? `صفحه ${idx + 1}` : `Page ${idx + 1}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Interactive Drawing & Preview Navigation Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                data-draw-ticket-guide="select"
                onClick={() => setDrawTool('select')}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
                  drawTool === 'select'
                    ? 'bg-sky-600 text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                <Move className="h-3.5 w-3.5" />
                <span>{isFa ? 'انتخاب و جابجایی با موس' : 'Move & Drag'}</span>
              </button>

              <button
                type="button"
                data-draw-ticket-guide="perforation"
                onClick={() => setDrawTool((prev) => (prev === 'perforation' ? 'select' : 'perforation'))}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
                  drawTool === 'perforation'
                    ? 'bg-sky-600 text-white'
                    : 'border border-slate-200 bg-slate-50 text-sky-700 hover:bg-sky-50 dark:border-slate-700 dark:bg-slate-800 dark:text-sky-300'
                }`}
              >
                <Scissors className="h-3.5 w-3.5" />
                <span>{isFa ? 'رسم خط پرفراژ با موس' : 'Draw Perforation'}</span>
              </button>

              <button
                type="button"
                data-draw-ticket-guide="cut"
                onClick={() => setDrawTool((prev) => (prev === 'cut' ? 'select' : 'cut'))}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
                  drawTool === 'cut'
                    ? 'bg-rose-600 text-white'
                    : 'border border-slate-200 bg-slate-50 text-rose-700 hover:bg-rose-50 dark:border-slate-700 dark:bg-slate-800 dark:text-rose-300'
                }`}
              >
                <Scissors className="h-3.5 w-3.5" />
                <span>{isFa ? 'رسم خط برش با موس' : 'Draw Cut Line'}</span>
              </button>

              {drawTool !== 'select' && (
                <button
                  type="button"
                  data-draw-guide-orientation
                  onClick={() =>
                    setDrawOrientation((prev) => (prev === 'vertical' ? 'horizontal' : 'vertical'))
                  }
                  className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 font-bold text-amber-800 dark:border-amber-600/40 dark:bg-amber-950/40 dark:text-amber-200 cursor-pointer"
                >
                  {drawOrientation === 'vertical'
                    ? isFa
                      ? 'جهت: عمودی'
                      : 'Axis: Vertical'
                    : isFa
                      ? 'جهت: افقی'
                      : 'Axis: Horizontal'}
                </button>
              )}
            </div>

            {/* Preview Sheet Switcher */}
            <div className="flex items-center gap-1.5">
              <span
                data-ticket-sheet-dimensions
                className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 tabular-nums dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {round1(metrics.sheetWidthMm)} × {round1(metrics.sheetHeightMm)} mm
              </span>
              <button
                type="button"
                data-ticket-preview-prev
                disabled={previewSheetIndex <= 0}
                onClick={() => setPreviewSheetIndex((v) => Math.max(0, v - 1))}
                aria-label={isFa ? 'شیت قبلی' : 'Previous sheet'}
                className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-35 dark:border-slate-700 dark:hover:bg-slate-800 cursor-pointer"
              >
                {isFa ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
              </button>
              <span
                data-ticket-preview-sheet-label
                className="min-w-24 text-center font-bold text-slate-700 dark:text-slate-200 tabular-nums"
              >
                {isFa
                  ? `شیت ${previewSheetIndex + 1} از ${metrics.effectiveSheetCount}`
                  : `Sheet ${previewSheetIndex + 1} of ${metrics.effectiveSheetCount}`}
              </span>
              <button
                type="button"
                data-ticket-preview-next
                disabled={previewSheetIndex >= metrics.effectiveSheetCount - 1}
                onClick={() =>
                  setPreviewSheetIndex((v) => Math.min(metrics.effectiveSheetCount - 1, v + 1))
                }
                aria-label={isFa ? 'شیت بعدی' : 'Next sheet'}
                className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-35 dark:border-slate-700 dark:hover:bg-slate-800 cursor-pointer"
              >
                {isFa ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* Live Sheet Stage */}
          <div
            ref={stageRef}
            data-ticket-sheet-stage
            className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-xl border border-slate-200 bg-slate-200/70 p-4 dark:border-slate-800 dark:bg-slate-900/60"
          >
            <div
              ref={sheetRef}
              dir="ltr"
              data-ticket-sheet-preview
              onPointerDown={handleSheetPointerDown}
              style={{
                aspectRatio: `${metrics.sheetWidthMm} / ${metrics.sheetHeightMm}`,
                ...(fittedSheetSize
                  ? {
                      width: `${fittedSheetSize.width}px`,
                      height: `${fittedSheetSize.height}px`,
                    }
                  : metrics.sheetWidthMm >= metrics.sheetHeightMm
                    ? { width: '100%', height: 'auto' }
                    : { height: '100%', width: 'auto' }),
                cursor: drawTool !== 'select' ? 'crosshair' : 'default',
                touchAction: 'none',
              }}
              className="relative shrink-0 select-none bg-white shadow-xl ring-1 ring-slate-300 dark:ring-slate-700 overflow-hidden"
            >
              {/* Margin box */}
              <div
                style={{
                  left: `${(ticketConfig.marginsMm.left / metrics.sheetWidthMm) * 100}%`,
                  top: `${(ticketConfig.marginsMm.top / metrics.sheetHeightMm) * 100}%`,
                  right: `${(ticketConfig.marginsMm.right / metrics.sheetWidthMm) * 100}%`,
                  bottom: `${(ticketConfig.marginsMm.bottom / metrics.sheetHeightMm) * 100}%`,
                }}
                className="pointer-events-none absolute border border-dashed border-slate-300/80"
              />

              {/* Ticket Grid Cells */}
              {Array.from({ length: metrics.rows }, (_, r) =>
                Array.from({ length: metrics.cols }, (__, c) => {
                  const seqIndex = ticketSequenceIndex(ticketConfig, r, c, previewSheetIndex);
                  const bounds = getCellPercentBounds(r, c);
                  return (
                    <div
                      key={`${r}-${c}`}
                      data-ticket-cell={`${r}-${c}`}
                      data-ticket-seq={seqIndex}
                      style={{
                        left: `${bounds.leftPct}%`,
                        top: `${bounds.topPct}%`,
                        width: `${bounds.widthPct}%`,
                        height: `${bounds.heightPct}%`,
                      }}
                      className="absolute overflow-hidden border border-slate-200/90 bg-white"
                    >
                      {seqIndex > 0 ? (
                        <>
                          {selectedSourcePage?.thumbnailDataUrl ? (
                            <img
                              src={selectedSourcePage.thumbnailDataUrl}
                              alt=""
                              draggable={false}
                              className="pointer-events-none h-full w-full object-contain"
                            />
                          ) : (
                            <div className="pointer-events-none flex h-full w-full items-center justify-center border border-slate-200/70 bg-white" />
                          )}

                          {/* Cell-local guides (when extendFullSheet is false) */}
                          {ticketConfig.guideLines
                            .filter((g) => !g.extendFullSheet)
                            .map((guide) => {
                              const isVert = guide.orientation === 'vertical';
                              const active = selectedGuide?.id === guide.id;
                              return (
                                <div
                                  key={`${guide.id}-${r}-${c}`}
                                  data-ticket-guide-id={guide.id}
                                  onPointerDown={(ev) => startGuideDrag(ev, guide, r, c)}
                                  style={
                                    isVert
                                      ? {
                                          left: `${guide.positionPercent}%`,
                                          top: 0,
                                          bottom: 0,
                                          width: '12px',
                                          transform: 'translateX(-50%)',
                                          cursor: 'ew-resize',
                                        }
                                      : {
                                          top: `${guide.positionPercent}%`,
                                          left: 0,
                                          right: 0,
                                          height: '12px',
                                          transform: 'translateY(-50%)',
                                          cursor: 'ns-resize',
                                        }
                                  }
                                  className="absolute z-20 flex items-center justify-center"
                                >
                                  <div
                                    style={
                                      isVert
                                        ? {
                                            height: '100%',
                                            borderLeft: `${Math.max(1, guide.strokeWidth)}px ${borderStyleFromStroke(guide.strokeStyle)} ${guide.strokeColor}`,
                                          }
                                        : {
                                            width: '100%',
                                            borderTop: `${Math.max(1, guide.strokeWidth)}px ${borderStyleFromStroke(guide.strokeStyle)} ${guide.strokeColor}`,
                                          }
                                    }
                                    className={active ? 'ring-2 ring-sky-400/50' : ''}
                                  />
                                </div>
                              );
                            })}

                          {/* Draggable Number Slots */}
                          {ticketConfig.numberSlots.map((slot) => {
                            const labelText = resolveTicketSlotText(
                              slot,
                              seqIndex,
                              metrics.totalTickets,
                              ticketConfig
                            );
                            const isSelected = selectedSlot?.id === slot.id;
                            return (
                              <div
                                key={`${slot.id}-${r}-${c}`}
                                data-ticket-slot-id={slot.id}
                                onPointerDown={(ev) => startSlotDrag(ev, slot, 'move', r, c)}
                                style={{
                                  left: `${slot.xPercent}%`,
                                  top: `${slot.yPercent}%`,
                                  width: `${slot.widthPercent}%`,
                                  height: `${slot.heightPercent}%`,
                                  color: slot.color,
                                  backgroundColor:
                                    slot.backgroundColor && slot.backgroundColor !== 'transparent'
                                      ? slot.backgroundColor
                                      : 'rgba(255,255,255,0.72)',
                                  fontFamily: `"${slot.fontFamily}", sans-serif`,
                                  fontSize: `${Math.max(9, Math.min(20, slot.fontSize))}px`,
                                  fontWeight: slot.bold ? 700 : 400,
                                  fontStyle: slot.italic ? 'italic' : 'normal',
                                  textAlign: slot.align,
                                  cursor: drawTool === 'select' ? 'move' : 'crosshair',
                                }}
                                className={`absolute z-30 flex items-center justify-center rounded px-1 leading-none transition-shadow ${
                                  isSelected
                                    ? 'border border-sky-600 ring-2 ring-sky-400/40'
                                    : 'border border-dashed border-sky-500/60 hover:border-sky-600'
                                }`}
                              >
                                <span
                                  dir="auto"
                                  className="pointer-events-none w-full truncate"
                                  style={{ textAlign: slot.align }}
                                >
                                  {labelText}
                                </span>

                                {/* Resize handle */}
                                {drawTool === 'select' && (
                                  <span
                                    data-ticket-slot-resize={slot.id}
                                    onPointerDown={(ev) => startSlotDrag(ev, slot, 'resize', r, c)}
                                    title={isFa ? 'تغییر اندازه باکس' : 'Resize slot'}
                                    className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-nwse-resize rounded-xs border border-white bg-sky-600 shadow-xs"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-slate-50/70 text-[10px] text-slate-400">
                          {isFa ? 'خالی' : 'Empty'}
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {/* Auto Grid Cut Lines */}
              {ticketConfig.autoGridCutLines && (
                <>
                  {autoGridLines.horizontalMm.map((yMm, idx) => (
                    <div
                      key={`auto-h-${idx}`}
                      style={{
                        top: `${(yMm / metrics.sheetHeightMm) * 100}%`,
                        left: 0,
                        right: 0,
                        borderTop: `${Math.max(1, ticketConfig.gridCutLineWidthPt)}px ${borderStyleFromStroke(ticketConfig.gridCutLineStyle)} ${ticketConfig.gridCutLineColor}`,
                      }}
                      className="pointer-events-none absolute z-10"
                    />
                  ))}
                  {autoGridLines.verticalMm.map((xMm, idx) => (
                    <div
                      key={`auto-v-${idx}`}
                      style={{
                        left: `${(xMm / metrics.sheetWidthMm) * 100}%`,
                        top: 0,
                        bottom: 0,
                        borderLeft: `${Math.max(1, ticketConfig.gridCutLineWidthPt)}px ${borderStyleFromStroke(ticketConfig.gridCutLineStyle)} ${ticketConfig.gridCutLineColor}`,
                      }}
                      className="pointer-events-none absolute z-10"
                    />
                  ))}
                </>
              )}

              {/* Sheet-wide Custom Cut / Perforation Guides */}
              {ticketConfig.guideLines
                .filter((g) => g.extendFullSheet)
                .flatMap((guide) => {
                  const active = selectedGuide?.id === guide.id;
                  if (guide.orientation === 'vertical') {
                    return Array.from({ length: metrics.cols }, (_, colIdx) => {
                      const xMm =
                        ticketConfig.marginsMm.left +
                        colIdx * (metrics.cellWidthMm + hGutter) +
                        (guide.positionPercent / 100) * metrics.cellWidthMm;
                      return (
                        <div
                          key={`${guide.id}-col-${colIdx}`}
                          data-ticket-guide-id={guide.id}
                          onPointerDown={(ev) => startGuideDrag(ev, guide, undefined, colIdx)}
                          style={{
                            left: `${(xMm / metrics.sheetWidthMm) * 100}%`,
                            top: 0,
                            bottom: 0,
                            width: '12px',
                            transform: 'translateX(-50%)',
                            cursor: drawTool === 'select' ? 'ew-resize' : 'crosshair',
                          }}
                          className="absolute z-20 flex justify-center"
                        >
                          <div
                            style={{
                              height: '100%',
                              borderLeft: `${Math.max(1, guide.strokeWidth)}px ${borderStyleFromStroke(guide.strokeStyle)} ${guide.strokeColor}`,
                            }}
                            className={active ? 'ring-2 ring-sky-400/50' : ''}
                          />
                        </div>
                      );
                    });
                  }
                  return Array.from({ length: metrics.rows }, (_, rowIdx) => {
                    const yMm =
                      ticketConfig.marginsMm.top +
                      rowIdx * (metrics.cellHeightMm + vGutter) +
                      (guide.positionPercent / 100) * metrics.cellHeightMm;
                    return (
                      <div
                        key={`${guide.id}-row-${rowIdx}`}
                        data-ticket-guide-id={guide.id}
                        onPointerDown={(ev) => startGuideDrag(ev, guide, rowIdx, undefined)}
                        style={{
                          top: `${(yMm / metrics.sheetHeightMm) * 100}%`,
                          left: 0,
                          right: 0,
                          height: '12px',
                          transform: 'translateY(-50%)',
                          cursor: drawTool === 'select' ? 'ns-resize' : 'crosshair',
                        }}
                        className="absolute z-20 flex items-center"
                      >
                        <div
                          style={{
                            width: '100%',
                            borderTop: `${Math.max(1, guide.strokeWidth)}px ${borderStyleFromStroke(guide.strokeStyle)} ${guide.strokeColor}`,
                          }}
                          className={active ? 'ring-2 ring-sky-400/50' : ''}
                        />
                      </div>
                    );
                  });
                })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
