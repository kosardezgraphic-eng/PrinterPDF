import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  UploadCloud,
  ChevronRight,
  ChevronLeft,
  BookOpen,
  Layers,
  Printer,
  Play,
  Pause,
  Trash2,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  WifiOff,
  FileWarning,
} from 'lucide-react';
import { useAppStore, type PageEditScope } from '../store/useAppStore';
import { PageCanvasCell, type CanvasTool } from './PageCanvasCell';
import { LayoutGuides, MeasurementTool } from './SheetTools';
import { t } from '../i18n/translations';
import {
  computeImpositionSheets,
  convertMmToUnit,
} from '../engine/layoutEngine';
import { checkPreflight } from '../engine/preflight';
import { fitPageZoom, PREVIEW_PX_PER_MM, wheelSheetStep } from '../engine/viewNavigation';
import {
  formatPageNumberLabel,
  resolveTextMacros,
} from '../engine/watermarkEngine';
import { formatLocalizedNumber } from '../i18n/shamsi';
import type { ComputedSheetSide, LayoutSettings, PrinterInfo } from '@shared/models';

interface PreviewWorkspaceProps {
  onCursorMoveMm: (pos: { x: number; y: number } | null) => void;
}

export const PreviewWorkspace: React.FC<PreviewWorkspaceProps> = ({
  onCursorMoveMm,
}) => {
  const {
    pages,
    documents,
    layout: savedLayout,
    effects,
    watermark,
    pageNumbering,
    settings,
    activeSheetIndex,
    zoomPercent,
    viewMode,
    showRulers,
    loupeEnabled,
    transparentMode,
    activeRibbonTab,
    printers,
    selectedPrinterName,
    spoolerJobs,
    batchQueue,
    setActiveSheetIndex,
    focusPageFromPreview,
    setZoomPercent,
    importFiles,
    loadSampleWorkspace,
    applyPageGeometry,
    commitLayoutGuides,
    selectPrinter,
    setDefaultPrinter,
    simulatePrinterStatusChange,
    controlSpoolerJob,
    purgePrinterQueue,
    removeBatchJob,
  } = useAppStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastWheelStep = useRef(-Infinity);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const suppressClick = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [canvasTool, setCanvasTool] = useState<CanvasTool>('select');
  const [draftLayout, setDraftLayout] = useState<LayoutSettings | null>(null);
  const [editScope, setEditScope] = useState<PageEditScope>('selected');
  const [currentEditPageId, setCurrentEditPageId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [showPreflight, setShowPreflight] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [loupeCoords, setLoupeCoords] = useState<{
    xPercent: number;
    yPercent: number;
  } | null>(null);

  const layout = draftLayout ?? savedLayout;
  const lang = settings.language;
  const tr = t(lang);

  const sheets = useMemo(() => computeImpositionSheets(pages, layout), [pages, layout]);
  const pageNumbers = useMemo(() => new Map(pages.map((page, index) => [page.id, index + 1])), [pages]);
  const preflight = useMemo(() => checkPreflight(pages, documents, sheets, effects), [pages, documents, sheets, effects]);
  const safeSheetIdx = Math.min(
    Math.max(0, activeSheetIndex),
    Math.max(0, sheets.length - 1)
  );

  // Determine which sheets to render based on viewMode
  const visibleSheets: ComputedSheetSide[] =
    viewMode === 'grid' || viewMode === 'continuous'
      ? sheets
      : viewMode === 'double'
        ? sheets.slice(safeSheetIdx, safeSheetIdx + 2)
        : sheets.slice(safeSheetIdx, safeSheetIdx + 1);

  const basePxPerMm = PREVIEW_PX_PER_MM * (zoomPercent / 100);

  const activateSheet = useCallback((index: number) => {
    if (!sheets.length) return;
    const next = Math.max(0, Math.min(sheets.length - 1, index));
    if (next === safeSheetIdx) return;
    setActiveSheetIndex(next);
    const page = sheets[next].cells.find(cell => cell.page)?.page;
    focusPageFromPreview(page?.id ?? null);
    setCurrentEditPageId(page?.id ?? null);
  }, [sheets, safeSheetIdx, setActiveSheetIndex, focusPageFromPreview]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        if (event.deltaY !== 0) setZoomPercent(useAppStore.getState().zoomPercent + (event.deltaY < 0 ? 10 : -10));
      } else if (viewMode === 'single' && sheets.length) {
        event.preventDefault();
        const now = performance.now();
        const step = wheelSheetStep(event.deltaY, now, lastWheelStep.current);
        if (step) {
          lastWheelStep.current = now;
          activateSheet(safeSheetIdx + step);
        }
      }
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [viewMode, sheets.length, safeSheetIdx, setZoomPercent, activateSheet]);

  useEffect(() => {
    const editable = (target: EventTarget | null) => target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName));
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !editable(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); setSpaceDown(true);
      }
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') { setSpaceDown(false); drag.current = null; setPanning(false); } };
    const blur = () => { setSpaceDown(false); drag.current = null; setPanning(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  const navigateSheet = (index: number) => {
    const next = Math.max(0, Math.min(sheets.length - 1, index));
    activateSheet(next);
    if (viewMode === 'continuous') {
      viewportRef.current?.querySelector(`[data-sheet-index="${next}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  const fitPage = () => {
    const viewport = viewportRef.current;
    const sheet = sheets[safeSheetIdx];
    if (!viewport || !sheet) return;
    setZoomPercent(fitPageZoom(viewport.clientWidth, viewport.clientHeight, sheet.widthMm, sheet.heightMm, showRulers));
    setPan({ x: 0, y: 0 });
  };

  const renderSingleSheet = (sheetSide: ComputedSheetSide, idxInList: number) => {
    const widthPx = Math.round(sheetSide.widthMm * basePxPerMm);
    const heightPx = Math.round(sheetSide.heightMm * basePxPerMm);

    // Optional back-side sheet for Light Table Transparent Mode (J2)
    const pairedBackSide =
      transparentMode &&
      sheetSide.side === 'front' &&
      sheets[sheetSide.sideIndex]
        ? sheets[sheetSide.sideIndex]
        : null;

    const firstPopulatedPage = sheetSide.cells.find((c) => c.page !== null)?.page;
    const resolvedWatermarkText = watermark.enabled
      ? resolveTextMacros(watermark.text, {
          pageNumber: firstPopulatedPage?.sourcePageNumber ?? sheetSide.sideIndex,
          totalPages: pages.length,
          sheetNumber: sheetSide.sheetNumber,
          totalSheets: sheets.length,
          fileName: firstPopulatedPage?.documentName ?? 'PrintStudio',
          userName: settings.userName,
        })
      : '';

    const pageNumText = pageNumbering.enabled
      ? formatPageNumberLabel(
          pageNumbering,
          sheetSide.sideIndex,
          sheets.length
        )
      : '';

    return (
      <div
        key={`${sheetSide.sheetNumber}-${sheetSide.side}-${idxInList}`}
        data-sheet-index={sheetSide.sideIndex - 1}
        className="flex shrink-0 flex-col items-center gap-2"
      >
        {/* Sheet Header Badge */}
        <div className="flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/90 px-3 py-1 text-[11px] font-semibold text-slate-300 shadow">
          <span>
            {tr.preview.sheet}{' '}
            {formatLocalizedNumber(sheetSide.sheetNumber, lang)}
          </span>
          <span>•</span>
          <span
            className={
              sheetSide.side === 'front' ? 'text-sky-400' : 'text-amber-400'
            }
          >
            {sheetSide.side === 'front'
              ? tr.preview.frontSide
              : tr.preview.backSide}
          </span>
          <span>•</span>
          <span className="text-slate-300" dir="auto">
            {lang === 'fa' ? 'صفحات: ' : 'Pages: '}
            {[...new Set(sheetSide.cells.map(cell => cell.page ? pageNumbers.get(cell.page.id) : undefined).filter((n): n is number => n !== undefined))].map(n => formatLocalizedNumber(n, lang)).join('، ') || '—'}
          </span>
          <span>•</span>
          <span className="font-mono text-[10px] text-slate-400">
            {convertMmToUnit(sheetSide.widthMm, settings.unit)}×
            {convertMmToUnit(sheetSide.heightMm, settings.unit)} {settings.unit}
          </span>
        </div>

        {/* Physical Paper Sheet Container with optional Rulers */}
        <div className="relative flex flex-col">
          {/* Horizontal Top Ruler */}
          {showRulers && viewMode !== 'grid' && (
            <div
              style={{ width: widthPx }}
              className="mb-1 flex h-5 items-end justify-between border-b border-slate-700 bg-slate-900/90 px-1 font-mono text-[9px] text-slate-400"
            >
              {Array.from({ length: 6 }, (_, tickIdx) => {
                const mmVal = Math.round((sheetSide.widthMm / 5) * tickIdx);
                return (
                  <span key={tickIdx}>
                    {convertMmToUnit(mmVal, settings.unit)}
                  </span>
                );
              })}
            </div>
          )}

          <div className="flex items-start">
            {/* Vertical Side Ruler */}
            {showRulers && viewMode !== 'grid' && (
              <div
                style={{ height: heightPx }}
                className="me-1 flex w-6 flex-col justify-between border-e border-slate-700 bg-slate-900/90 py-1 text-center font-mono text-[9px] text-slate-400"
              >
                {Array.from({ length: 6 }, (_, tickIdx) => {
                  const mmVal = Math.round((sheetSide.heightMm / 5) * tickIdx);
                  return (
                    <span key={tickIdx}>
                      {convertMmToUnit(mmVal, settings.unit)}
                    </span>
                  );
                })}
              </div>
            )}

            {/* Actual Sheet Canvas */}
            <div
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const relX = Math.max(0, e.clientX - rect.left);
                const relY = Math.max(0, e.clientY - rect.top);
                const xMm = (relX / rect.width) * sheetSide.widthMm;
                const yMm = (relY / rect.height) * sheetSide.heightMm;
                onCursorMoveMm({
                  x: convertMmToUnit(xMm, settings.unit),
                  y: convertMmToUnit(yMm, settings.unit),
                });
                if (loupeEnabled) {
                  setLoupeCoords({
                    xPercent: (relX / rect.width) * 100,
                    yPercent: (relY / rect.height) * 100,
                  });
                }
              }}
              onMouseLeave={() => {
                onCursorMoveMm(null);
                setLoupeCoords(null);
              }}
              style={{
                width: widthPx,
                height: heightPx,
              }}
              className="relative overflow-hidden rounded-sm bg-white shadow-[0_20px_50px_rgba(0,0,0,0.65)] ring-1 ring-slate-300 transition-all duration-150"
            >
              {/* Margin Guide Dashed Box */}
              <div
                style={{
                  left: layout.marginsMm.left * basePxPerMm,
                  top: layout.marginsMm.top * basePxPerMm,
                  right: layout.marginsMm.right * basePxPerMm,
                  bottom: layout.marginsMm.bottom * basePxPerMm,
                }}
                className="pointer-events-none absolute border border-dashed border-sky-500/35"
              />

              {/* Transparent Mode Back-Side Ghost Overlay (J2) */}
              {pairedBackSide &&
                pairedBackSide.cells.map((backCell) => {
                  if (!backCell.page?.thumbnailDataUrl) return null;
                  return (
                    <div
                      key={`ghost-${backCell.cellIndex}`}
                      style={{
                        left: backCell.contentXMm * basePxPerMm,
                        top: backCell.contentYMm * basePxPerMm,
                        width: backCell.contentWidthMm * basePxPerMm,
                        height: backCell.contentHeightMm * basePxPerMm,
                        transform: 'scaleX(-1)',
                        opacity: 0.18,
                      }}
                      className="pointer-events-none absolute overflow-hidden"
                    >
                      <img
                        src={backCell.page.thumbnailDataUrl}
                        alt="Back Ghost"
                        className="h-full w-full object-fill"
                      />
                    </div>
                  );
                })}

              {/* Imposed Cells (D1 - D5) */}
              {sheetSide.cells.map((cell) => {
                const cellLeft = cell.cellXMm * basePxPerMm;
                const cellTop = cell.cellYMm * basePxPerMm;
                const cellW = cell.cellWidthMm * basePxPerMm;
                const cellH = cell.cellHeightMm * basePxPerMm;

                return (
                  <React.Fragment key={cell.cellIndex}>
                    {/* Cell Bounding Frame & Crop Marks */}
                    <div
                      style={{
                        left: cellLeft,
                        top: cellTop,
                        width: cellW,
                        height: cellH,
                      }}
                      className={`pointer-events-none absolute ${
                        layout.showCellBorders
                          ? 'border border-slate-300/80'
                          : ''
                      }`}
                    >
                      {layout.showCropMarks && (
                        <>
                          <span className="absolute -top-2 -left-2 h-2 w-2 border-r border-b border-slate-800" />
                          <span className="absolute -top-2 -right-2 h-2 w-2 border-l border-b border-slate-800" />
                          <span className="absolute -bottom-2 -left-2 h-2 w-2 border-r border-t border-slate-800" />
                          <span className="absolute -bottom-2 -right-2 h-2 w-2 border-l border-t border-slate-800" />
                        </>
                      )}
                    </div>

                    {cell.page && <PageCanvasCell cell={cell} pxPerMm={basePxPerMm} tool={canvasTool} scope={editScope} spaceDown={spaceDown} onCurrentPage={(id, preserveSelection) => {
                      setCurrentEditPageId(id);
                      setActiveSheetIndex(sheetSide.sideIndex - 1);
                      focusPageFromPreview(id, preserveSelection);
                    }} />}
                  </React.Fragment>
                );
              })}

              {/* F1: Watermark Overlay (Single or Tiled) */}
              {watermark.enabled && resolvedWatermarkText && (
                <div
                  style={{ opacity: watermark.opacity }}
                  className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
                >
                  {watermark.tiled ? (
                    <div className="grid grid-cols-3 gap-10 p-4">
                      {Array.from({ length: 9 }, (_, tIdx) => (
                        <span
                          key={tIdx}
                          style={{
                            color: watermark.colorHex,
                            transform: `rotate(${watermark.rotationDeg}deg)`,
                            fontSize: `${Math.max(11, watermark.fontSizePt * 0.55)}px`,
                          }}
                          className="font-black whitespace-nowrap select-none"
                        >
                          {resolvedWatermarkText}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span
                      style={{
                        color: watermark.colorHex,
                        transform: `rotate(${watermark.rotationDeg}deg)`,
                        fontSize: `${Math.max(16, watermark.fontSizePt * 0.9)}px`,
                      }}
                      className="font-black tracking-wide whitespace-nowrap select-none"
                    >
                      {resolvedWatermarkText}
                    </span>
                  )}
                </div>
              )}

              {/* F2: Page / Bates Numbering Overlay */}
              {pageNumbering.enabled && pageNumText && (
                <div
                  style={{
                    bottom: Math.max(4, pageNumbering.marginMm * basePxPerMm * 0.6),
                  }}
                  className="pointer-events-none absolute inset-x-0 flex justify-center"
                >
                  <span className="rounded bg-white/85 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-700 shadow-xs">
                    {pageNumText}
                  </span>
                </div>
              )}

              {canvasTool === 'layout' && <LayoutGuides sheet={sheetSide} layout={layout} pxPerMm={basePxPerMm} spaceDown={spaceDown} language={lang}
                onDraft={setDraftLayout} onCommit={next => commitLayoutGuides({ marginsMm:next.marginsMm, horizontalGutterMm:next.horizontalGutterMm, verticalGutterMm:next.verticalGutterMm })} />}
              {canvasTool === 'measure' && <MeasurementTool sheet={sheetSide} unit={settings.unit} language={lang} spaceDown={spaceDown} />}

              {/* Precision Loupe Magnifier (J1 / F6) */}
              {loupeEnabled && loupeCoords && (
                <div
                  style={{
                    left: `${Math.min(82, Math.max(8, loupeCoords.xPercent))}%`,
                    top: `${Math.min(82, Math.max(8, loupeCoords.yPercent))}%`,
                  }}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-500 bg-slate-950/90 px-3 py-2 text-[10px] font-bold text-sky-300 shadow-2xl"
                >
                  🔍 250% • X:{loupeCoords.xPercent.toFixed(0)}% Y:
                  {loupeCoords.yPercent.toFixed(0)}%
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderPrinterStatusBadge = (status: PrinterInfo['status']) => {
    switch (status) {
      case 'Ready':
      case 'Printing':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> {status}
          </span>
        );
      case 'LowToner':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">
            <AlertTriangle className="h-3 w-3" /> Low Toner
          </span>
        );
      case 'PaperJam':
      case 'OutOfPaper':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-400">
            <FileWarning className="h-3 w-3" /> {status}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-slate-300">
            <WifiOff className="h-3 w-3" /> {status}
          </span>
        );
    }
  };

  return (
    <main
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingOver(false);
        const droppedFiles = e.dataTransfer.files
          ? Array.from(e.dataTransfer.files)
          : [];
        if (droppedFiles.length > 0) {
          void importFiles(droppedFiles);
        }
      }}
      className="relative flex flex-1 flex-col overflow-hidden bg-slate-950"
    >
      {/* Hidden File Input for Empty State */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const list = e.target.files ? Array.from(e.target.files) : [];
          if (list.length > 0) void importFiles(list);
          e.target.value = '';
        }}
      />

      {/* Drag & Drop Full-Window Overlay */}
      {isDraggingOver && (
        <div className="absolute inset-3 z-50 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-sky-400 bg-sky-950/85 backdrop-blur-md">
          <UploadCloud className="mb-3 h-16 w-16 text-sky-400 animate-bounce" />
          <h2 className="text-2xl font-black text-white">
            {tr.preview.dropOverlayTitle}
          </h2>
          <p className="mt-1 text-sm text-sky-200">
            {tr.preview.dropOverlaySubtitle}
          </p>
        </div>
      )}

      {/* Top Floating Sheet Navigation Bar */}
      {sheets.length > 0 && (
        <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/60 px-4 py-1.5 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safeSheetIdx <= 0}
              onClick={() => navigateSheet(safeSheetIdx - 1)}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="h-3.5 w-3.5" />
              <span>{lang === 'fa' ? 'شیت قبلی' : 'Prev Sheet'}</span>
            </button>

            <span className="font-bold text-slate-200">
              {lang === 'fa'
                ? `نمایش شیت ${formatLocalizedNumber(safeSheetIdx + 1, lang)} از ${formatLocalizedNumber(
                    sheets.length,
                    lang
                  )}`
                : `Sheet ${safeSheetIdx + 1} of ${sheets.length}`}
            </span>

            <button
              type="button"
              disabled={safeSheetIdx >= sheets.length - 1}
              onClick={() => navigateSheet(safeSheetIdx + 1)}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
            >
              <span>{lang === 'fa' ? 'شیت بعدی' : 'Next Sheet'}</span>
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <button type="button" aria-expanded={showPreflight} onClick={() => setShowPreflight(!showPreflight)} className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-100 hover:bg-slate-700">
              {lang === 'fa' ? 'پیش‌بررسی' : 'Preflight'}{preflight.length > 0 ? ` (${preflight.length})` : ''}
            </button>
            <button type="button" onClick={fitPage} className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-100 hover:bg-slate-700">
              {lang === 'fa' ? 'جاگیری کامل' : 'Fit page'}
            </button>
          </div>
        </div>
      )}

      {sheets.length > 0 && <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200">
        {(['select', 'move', 'crop', 'layout', 'measure'] as const).map(tool => <button key={tool} type="button" aria-pressed={canvasTool === tool}
          onClick={() => { setDraftLayout(null); setCanvasTool(tool); }} className={`rounded-lg px-3 py-1.5 ${canvasTool === tool ? 'bg-sky-600 text-white' : 'bg-slate-800 hover:bg-slate-700'}`}>
          {lang === 'fa' ? { select:'انتخاب', move:'جابجایی / اندازه', crop:'برش', layout:'حاشیه / فاصله', measure:'خط‌کش' }[tool] : { select:'Select', move:'Move / resize', crop:'Crop', layout:'Margins / gutters', measure:'Measure' }[tool]}
        </button>)}
        <label className="flex items-center gap-1">{lang === 'fa' ? 'اعمال روی:' : 'Apply to:'}
          <select value={editScope} onChange={e => setEditScope(e.target.value as PageEditScope)} className="rounded border border-slate-700 bg-slate-800 px-2 py-1">
            <option value="current">{lang === 'fa' ? 'فقط این صفحه' : 'This page'}</option>
            <option value="selected">{lang === 'fa' ? 'صفحات انتخاب‌شده در پنل' : 'Selected thumbnails'}</option>
            <option value="all">{lang === 'fa' ? 'همه صفحات' : 'All pages'}</option>
          </select>
        </label>
        <button type="button" disabled={!pages.some(page => page.isHighlighted)} onClick={() => {
          const page = pages.find(item => item.id === currentEditPageId && item.isHighlighted) ?? pages.find(item => item.isHighlighted);
          if (page) applyPageGeometry(page.id, editScope, { kind:'reset' });
        }} className="rounded bg-slate-800 px-3 py-1.5 hover:bg-slate-700 disabled:opacity-50">{lang === 'fa' ? 'بازنشانی برش و اندازه' : 'Reset crop and size'}</button>
        {(canvasTool === 'move' || canvasTool === 'crop') && <span className="text-slate-400">{lang === 'fa' ? 'ابتدا صفحه‌ها را از بندانگشتی‌ها انتخاب کنید؛ دستگیره‌ها را با موس یا لمس بکشید.' : 'Select thumbnails first, then drag the handles with mouse or touch.'}</span>}
        {canvasTool === 'layout' && <span className="text-slate-400">{lang === 'fa' ? 'سبز: حاشیه؛ بنفش: فاصلهٔ یکسان همهٔ ستون‌ها یا ردیف‌ها. با موس یا لمس بکشید.' : 'Drag green margin or purple uniform gutter handles with mouse or touch.'}</span>}
        {canvasTool === 'measure' && <span className="text-slate-400">{lang === 'fa' ? 'برای اندازه‌گیری بکشید؛ Shift جهت افقی یا عمودی را قفل می‌کند.' : 'Drag to measure; hold Shift to lock horizontally or vertically.'}</span>}
      </div>}

      {showPreflight && (
        <div role="status" className="border-b border-slate-700 bg-slate-900 px-4 py-2 text-xs text-slate-200">
          {preflight.length === 0 ? (lang === 'fa' ? 'مشکل ظاهری در شیت‌ها یافت نشد.' : 'No sheet issues found.') : preflight.map(issue => {
            const labels = lang === 'fa' ? {
              'no-pages': 'صفحه‌ای انتخاب نشده', 'missing-source': 'فایل منبع موجود نیست', 'empty-page': 'صفحه سفید',
              'out-of-bounds': 'خانه خارج از ابعاد کاغذ', 'effects-not-exported': 'بعضی افکت‌ها در PDF خروجی اعمال نمی‌شوند',
            } : {
              'no-pages': 'No pages selected', 'missing-source': 'Source file missing', 'empty-page': 'Blank page',
              'out-of-bounds': 'Cell outside the paper', 'effects-not-exported': 'Some effects are not applied to PDF export',
            };
            return <div key={issue.code} className={issue.severity === 'error' ? 'text-rose-300' : 'text-amber-300'}>{labels[issue.code]}{issue.count > 0 ? ` (${issue.count})` : ''}</div>;
          })}
          <div className="mt-1 text-slate-400">{lang === 'fa' ? 'این بررسی اتصال یا قابلیت چاپگر را تأیید نمی‌کند.' : 'This check does not verify the printer or driver.'}</div>
        </div>
      )}

      {/* Main Sheet Preview Canvas Area */}
      <div
        ref={viewportRef}
        data-preview-viewport
        className={`flex-1 overflow-auto p-6 ${spaceDown ? (panning ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
        onPointerDown={(e) => {
          if (!spaceDown || e.button !== 0) return;
          e.preventDefault(); e.stopPropagation();
          drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
          suppressClick.current = true;
          setPanning(true); e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPan({ x: drag.current.panX + e.clientX - drag.current.x, y: drag.current.panY + e.clientY - drag.current.y });
        }}
        onPointerUp={() => { drag.current = null; setPanning(false); setTimeout(() => { suppressClick.current = false; }, 0); }}
        onPointerCancel={() => { drag.current = null; setPanning(false); suppressClick.current = false; }}
        onClickCapture={(e) => { if (suppressClick.current) { suppressClick.current = false; e.preventDefault(); e.stopPropagation(); } }}
        onScroll={(e) => {
          if (viewMode !== 'continuous' && viewMode !== 'grid') return;
          const viewport = e.currentTarget;
          const bounds = viewport.getBoundingClientRect();
          const midY = bounds.top + viewport.clientHeight / 2;
          const midX = bounds.left + viewport.clientWidth / 2;
          let closest = safeSheetIdx, distance = Infinity;
          viewport.querySelectorAll<HTMLElement>('[data-sheet-index]').forEach(element => {
            const rect = element.getBoundingClientRect();
            const dy = (rect.top + rect.bottom) / 2 - midY;
            const dx = viewMode === 'grid' ? (rect.left + rect.right) / 2 - midX : 0;
            const d = dx * dx + dy * dy;
            if (d < distance) { distance = d; closest = Number(element.dataset.sheetIndex); }
          });
          if (closest !== safeSheetIdx) activateSheet(closest);
        }}
      >
        {sheets.length === 0 ? (
          /* Empty State */
          <div className="flex h-full flex-col items-center justify-center">
            <div className="max-w-lg rounded-3xl border border-dashed border-slate-700 bg-slate-900/60 p-10 text-center shadow-2xl">
              <UploadCloud className="mx-auto mb-4 h-14 w-14 text-sky-400" />
              <h2 className="text-lg font-extrabold text-white">
                {tr.preview.emptyTitle}
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                {tr.preview.emptyDesc}
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-sky-500 cursor-pointer"
                >
                  <UploadCloud className="h-4 w-4" />
                  <span>{tr.preview.browseFiles}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void loadSampleWorkspace()}
                  className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 py-2.5 text-xs font-bold text-amber-300 hover:bg-amber-500/25 cursor-pointer"
                >
                  <BookOpen className="h-4 w-4" />
                  <span>{tr.preview.loadSample}</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
            className={`flex min-h-full min-w-full items-center justify-center gap-8 ${
              viewMode === 'grid' ? 'flex-wrap' : viewMode === 'continuous' ? 'flex-col' : 'flex-col md:flex-row'
            }`}
          >
            {visibleSheets.map((sheet, idx) => renderSingleSheet(sheet, idx))}
          </div>
        )}
      </div>

      {/* Contextual Bottom Dock for Batch Queue (H1-H2) */}
      {activeRibbonTab === 'batch' && (
        <div className="h-64 shrink-0 border-t border-slate-800 bg-slate-900/95 p-4 overflow-y-auto">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-sky-400" />
              <h3 className="text-sm font-bold text-white">
                {lang === 'fa'
                  ? 'صف چاپ دسته‌ای و اتوماسیون (Batch Print Queue — H1/H2)'
                  : 'Batch Print Queue Manager (H1/H2)'}
              </h3>
            </div>
            <span className="text-xs text-slate-400">
              {lang === 'fa'
                ? 'در صورت بروز خطا در یک فایل، صف به‌صورت خودکار به فایل بعدی ادامه می‌دهد'
                : 'Fault-isolated batch execution with automatic retry'}
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-start text-xs text-slate-200">
              <thead className="bg-slate-950/80 text-[11px] text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-start">
                    {lang === 'fa' ? 'نام فایل / پروژه' : 'File / Job'}
                  </th>
                  <th className="px-3 py-2 text-start">
                    {lang === 'fa' ? 'صفحات' : 'Pages'}
                  </th>
                  <th className="px-3 py-2 text-start">
                    {lang === 'fa' ? 'پرینتر مقصد' : 'Target Printer'}
                  </th>
                  <th className="px-3 py-2 text-start">
                    {lang === 'fa' ? 'تنظیمات الگو' : 'Template'}
                  </th>
                  <th className="px-3 py-2 text-start">
                    {lang === 'fa' ? 'پیشرفت و وضعیت' : 'Progress & Status'}
                  </th>
                  <th className="px-3 py-2 text-end">
                    {lang === 'fa' ? 'عملیات' : 'Actions'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 bg-slate-900/60">
                {batchQueue.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/40">
                    <td className="px-3 py-2 font-semibold">{item.fileName}</td>
                    <td className="px-3 py-2">
                      {formatLocalizedNumber(item.pageCount, lang)}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {item.printerName}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="rounded bg-slate-800 px-1.5 py-0.5">
                          {item.nUp}-Up
                        </span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5">
                          {item.copies}×
                        </span>
                        {item.invert && (
                          <span className="rounded bg-fuchsia-500/20 px-1.5 py-0.5 text-fuchsia-300">
                            Invert
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-800">
                          <div
                            style={{ width: `${item.progressPercent}%` }}
                            className={`h-full transition-all ${
                              item.status === 'completed'
                                ? 'bg-emerald-500'
                                : 'bg-sky-500'
                            }`}
                          />
                        </div>
                        <span className="text-[11px] font-semibold">
                          {item.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-end">
                      <button
                        type="button"
                        onClick={() => removeBatchJob(item.id)}
                        className="rounded p-1 text-rose-400 hover:bg-rose-500/15 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Contextual Bottom Dock for Windows Printers & Spooler Queue Manager (I1-I3) */}
      {activeRibbonTab === 'printers' && (
        <div className="h-72 shrink-0 border-t border-slate-800 bg-slate-900/95 p-4 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* I1 & I2: Windows Printers & Live Status */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <Printer className="h-4 w-4 text-sky-400" />
                  <span>
                    {lang === 'fa'
                      ? 'پرینترهای ویندوز و وضعیت زنده (Win32 Spooler — I1/I2)'
                      : 'Windows Printers & Live Status (I1/I2)'}
                  </span>
                </h4>
              </div>

              <div className="space-y-2">
                {printers.map((p) => (
                  <div
                    key={p.name}
                    onClick={() => selectPrinter(p.name)}
                    className={`flex items-center justify-between rounded-xl border p-2.5 text-xs transition cursor-pointer ${
                      selectedPrinterName === p.name
                        ? 'border-sky-500 bg-sky-500/10'
                        : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-bold text-slate-100">
                          {p.name}
                        </span>
                        {p.isDefault && (
                          <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-bold text-sky-300">
                            Default
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                        <span>{p.location}</span>
                        <span>•</span>
                        <span>
                          {p.activeProfile.paperSize} / {p.activeProfile.dpi} DPI
                        </span>
                        {p.tonerLevelPercent !== undefined && (
                          <>
                            <span>•</span>
                            <span>Toner: {p.tonerLevelPercent}%</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {renderPrinterStatusBadge(p.status)}
                      <select
                        value={p.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          void simulatePrinterStatusChange(
                            p.name,
                            e.target.value as PrinterInfo['status']
                          )
                        }
                        title="شبیه‌سازی تغییر وضعیت سخت‌افزار پرینتر"
                        className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300"
                      >
                        <option value="Ready">Ready</option>
                        <option value="Offline">Offline</option>
                        <option value="PaperJam">PaperJam</option>
                        <option value="OutOfPaper">OutOfPaper</option>
                        <option value="LowToner">LowToner</option>
                      </select>
                      {!p.isDefault && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void setDefaultPrinter(p.name);
                          }}
                          className="rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-700 cursor-pointer"
                        >
                          {lang === 'fa' ? 'پیش‌فرض' : 'Set Default'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* I3: Live Print Queue Manager (Spooler Jobs) */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-bold text-white">
                  {lang === 'fa'
                    ? `مدیریت صف چاپ ویندوز (Print Queue Manager — ${spoolerJobs.length} Job)`
                    : `Print Queue Manager (${spoolerJobs.length} Jobs)`}
                </h4>
                {selectedPrinterName && (
                  <button
                    type="button"
                    onClick={() => void purgePrinterQueue(selectedPrinterName)}
                    className="rounded-lg bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/25 cursor-pointer"
                  >
                    {lang === 'fa' ? 'پاک‌سازی کل صف (Purge)' : 'Purge Queue'}
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {spoolerJobs.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    {lang === 'fa'
                      ? 'صف چاپ خالی است'
                      : 'No active jobs in Windows Spooler queue'}
                  </div>
                ) : (
                  spoolerJobs.map((job) => (
                    <div
                      key={job.jobId}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-sky-400">
                            #{job.jobId}
                          </span>
                          <span className="truncate font-bold text-slate-200">
                            {job.documentTitle}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                          <span>{job.printerName}</span>
                          <span>•</span>
                          <span>
                            {job.pagesPrinted}/{job.totalPages}{' '}
                            {lang === 'fa' ? 'صفحه' : 'p'}
                          </span>
                          <span>•</span>
                          <span className="font-semibold text-amber-300">
                            {job.status}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        {job.status === 'Paused' ? (
                          <button
                            type="button"
                            onClick={() =>
                              void controlSpoolerJob(
                                job.printerName,
                                job.jobId,
                                'resume'
                              )
                            }
                            title="ادامه چاپ (Resume)"
                            className="rounded bg-emerald-500/20 p-1.5 text-emerald-300 hover:bg-emerald-500/30 cursor-pointer"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              void controlSpoolerJob(
                                job.printerName,
                                job.jobId,
                                'pause'
                              )
                            }
                            title="توقف موقت (Pause)"
                            className="rounded bg-amber-500/20 p-1.5 text-amber-300 hover:bg-amber-500/30 cursor-pointer"
                          >
                            <Pause className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            void controlSpoolerJob(
                              job.printerName,
                              job.jobId,
                              'restart'
                            )
                          }
                          title="چاپ مجدد از ابتدا (Restart)"
                          className="rounded bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 cursor-pointer"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void controlSpoolerJob(
                              job.printerName,
                              job.jobId,
                              'cancel'
                            )
                          }
                          title="لغو و حذف از صف (Cancel)"
                          className="rounded bg-rose-500/20 p-1.5 text-rose-300 hover:bg-rose-500/30 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
