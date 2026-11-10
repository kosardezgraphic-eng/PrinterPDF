import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  MousePointer2,
  Crop,
  PanelsTopLeft,
  Ruler,
  Maximize2,
} from 'lucide-react';
import { useAppStore, type PageEditScope } from '../store/useAppStore';
import { PageCanvasCell, type CanvasTool } from './PageCanvasCell';
import { LayoutGuides, MeasurementTool } from './SheetTools';
import { RulerGuideProvider, SheetRuler, GuidePaperRef, UserGuideLines } from './RulerGuides';
import { TextOverlayLayer } from './TextOverlayLayer';
import { AspectCropControls } from './AspectCropControls';
import { t } from '../i18n/translations';
import {
  computeImpositionSheets,
  sortCellsByLayer,
  convertMmToUnit,
} from '../engine/layoutEngine';
import { checkPreflight } from '../engine/preflight';
import { fitPageZoom, isAtWheelEdge, PREVIEW_PX_PER_MM, wheelSheetStep } from '../engine/viewNavigation';
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
    overlays,
    selectedOverlayId,
    selectOverlay,
    settings,
    activeSheetIndex,
    previewPageRequest,
    zoomPercent,
    viewMode,
    showRulers,
    loupeEnabled,
    transparentMode,
    activeRibbonTab,
    printers,
    selectedPrinterName,
    printerMargins,
    resetMarginsToPrinter,
    spoolerJobs,
    batchQueue,
    setActiveSheetIndex,
    setShowRulers,
    focusPageFromPreview,
    setZoomPercent,
    importFiles,
    loadSampleWorkspace,
    applyPageGeometry,
    applyAspectRatioCrop,
    resetCellGeometry,
    commitLayoutGuides,
    updateSettings,
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
  const pendingWheelEntry = useRef<{index:number; edge:'top'|'bottom'} | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const suppressClick = useRef(false);
  const handledPreviewRequest = useRef<typeof previewPageRequest>(null);
  const suppressNavigationScroll = useRef(false);
  const scrollSuppressionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returnSheetIndex = useRef(0);
  const [spaceDown, setSpaceDown] = useState(false);
  const [canvasTool, setCanvasTool] = useState<CanvasTool>('move');
  const [draftLayout, setDraftLayout] = useState<LayoutSettings | null>(null);
  const [editScope, setEditScope] = useState<PageEditScope>('current');
  const [currentEditPageId, setCurrentEditPageId] = useState<string | null>(null);
  const [currentOccurrenceKey, setCurrentOccurrenceKey] = useState<string | null>(null);
  const [activeGuideSheet, setActiveGuideSheet] = useState<number | null>(null);
  const [previewOnlyPageId, setPreviewOnlyPageId] = useState<string | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<{pageId: string; sheetIndex: number; previewOnly: boolean} | null>(null);
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

  const outputSheets = useMemo(() => computeImpositionSheets(pages, layout), [pages, layout]);
  const previewOnlyPage = pages.find(page => page.id === previewOnlyPageId && !page.selectedForPrint);
  const sheets = useMemo(() => previewOnlyPage
    ? computeImpositionSheets([{ ...previewOnlyPage, selectedForPrint: true }], { ...layout, duplexMode:'none' })
    : outputSheets, [previewOnlyPage, layout, outputSheets]);
  const pageNumbers = useMemo(() => new Map(pages.map((page, index) => [page.id, index + 1])), [pages]);
  const textEditing = useAppStore(s => !!s.textEdit || s.overlays.some(o=>o.id===s.selectedOverlayId && o.kind==='numbering'));
  useEffect(() => { if (textEditing) setCanvasTool('move'); }, [textEditing]);
  const hasTextOverlays = useMemo(() => overlays.some(item => item.kind === 'text' || item.kind === 'numbering' && item.enabled), [overlays]);
  useEffect(() => {
    if (!selectedOverlayId) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('[data-overlay-id],[data-text-control-panel]')) selectOverlay(null);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [selectedOverlayId, selectOverlay]);
  const preflight = useMemo(() => checkPreflight(pages, documents, outputSheets, effects), [pages, documents, outputSheets, effects]);
  const safeSheetIdx = Math.min(
    Math.max(0, activeSheetIndex),
    Math.max(0, sheets.length - 1)
  );

  // Sidebar navigation is separate from highlighting and print selection.
  useEffect(() => {
    if (!previewPageRequest || handledPreviewRequest.current === previewPageRequest) return;
    handledPreviewRequest.current = previewPageRequest;
    useAppStore.setState(state => state.previewPageRequest === previewPageRequest ? {previewPageRequest:null} : state);
    const page = pages.find(item => item.id === previewPageRequest.pageId);
    if (!page) return;
    const only = !page.selectedForPrint;
    const index = only ? 0 : outputSheets.findIndex(sheet => sheet.cells.some(cell => cell.page?.id === page.id));
    if (index < 0) return;
    if (only && !previewOnlyPageId) returnSheetIndex.current = activeSheetIndex;
    setPreviewOnlyPageId(only ? page.id : null);
    setActiveSheetIndex(index);
    setCurrentEditPageId(page.id);
    setCurrentOccurrenceKey(null);
    setActiveGuideSheet(null);
    setPan({x:0,y:0});
    setNavigationTarget({pageId:page.id,sheetIndex:index,previewOnly:only});
  }, [previewPageRequest, pages, outputSheets, activeSheetIndex, previewOnlyPageId, setActiveSheetIndex]);

  // If a preview-only page is subsequently enabled for printing, navigate to its real sheet.
  useEffect(() => {
    if (!previewOnlyPageId) return;
    const page = pages.find(item => item.id === previewOnlyPageId);
    if (!page) { setPreviewOnlyPageId(null); return; }
    if (!page.selectedForPrint) return;
    const index = outputSheets.findIndex(sheet => sheet.cells.some(cell => cell.page?.id === page.id));
    if (index < 0) return;
    setPreviewOnlyPageId(null); setActiveSheetIndex(index);
    setNavigationTarget({pageId:page.id,sheetIndex:index,previewOnly:false});
  }, [previewOnlyPageId, pages, outputSheets, setActiveSheetIndex]);

  useLayoutEffect(() => {
    if (!navigationTarget || navigationTarget.previewOnly !== !!previewOnlyPage || safeSheetIdx !== navigationTarget.sheetIndex) return;
    const viewport = viewportRef.current;
    const sheet = viewport?.querySelector<HTMLElement>(`[data-sheet-index="${navigationTarget.sheetIndex}"]`);
    const cell = Array.from(sheet?.querySelectorAll<HTMLElement>('[data-canvas-page-id]') ?? [])
      .find(element => element.dataset.canvasPageId === navigationTarget.pageId);
    const target = cell?.querySelector<HTMLElement>('[data-page-content]') ?? sheet;
    if (!viewport || !target) return;
    const viewRect = viewport.getBoundingClientRect(), targetRect = target.getBoundingClientRect();
    if (viewRect.width && viewRect.height && targetRect.width && targetRect.height) {
      suppressNavigationScroll.current = true;
      if (scrollSuppressionTimer.current) clearTimeout(scrollSuppressionTimer.current);
      scrollSuppressionTimer.current = setTimeout(() => { suppressNavigationScroll.current = false; }, 200);
      viewport.scrollTop += targetRect.top + targetRect.height / 2 - (viewRect.top + viewport.clientHeight / 2);
      viewport.scrollLeft += targetRect.left + targetRect.width / 2 - (viewRect.left + viewport.clientWidth / 2);
    }
    setNavigationTarget(null);
  }, [navigationTarget, safeSheetIdx, previewOnlyPage, sheets, viewMode]);
  useEffect(() => () => { if (scrollSuppressionTimer.current) clearTimeout(scrollSuppressionTimer.current); }, []);

  // The new sheet must be laid out before its scroll range can be measured.
  useLayoutEffect(() => {
    const pending = pendingWheelEntry.current;
    if (!pending) return;
    pendingWheelEntry.current = null;
    const viewport = viewportRef.current;
    if (!viewport || pending.index !== safeSheetIdx || (viewMode !== 'single' && viewMode !== 'double')) return;
    viewport.scrollTop = pending.edge === 'top' ? 0 : Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  }, [safeSheetIdx, viewMode, sheets.length]);

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
    setCurrentOccurrenceKey(null);
    setActiveGuideSheet(null);
  }, [sheets, safeSheetIdx, setActiveSheetIndex, focusPageFromPreview]);

  useEffect(() => {
    if (!currentOccurrenceKey) return;
    // Dismiss only the canvas handles; thumbnail multi-selection remains intact.
    const dismiss = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const cell = target?.closest<HTMLElement>('[data-occurrence-key]');
      if (cell?.dataset.occurrenceKey === currentOccurrenceKey || target?.closest('[data-layer-menu]')) return;
      setCurrentOccurrenceKey(null);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [currentOccurrenceKey]);

  useEffect(() => {
    if (activeGuideSheet === null) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('[data-sheet-canvas-index]') && !target?.closest('[data-layer-menu]')) setActiveGuideSheet(null);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [activeGuideSheet]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      suppressNavigationScroll.current = false;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        if (event.deltaY !== 0) setZoomPercent(useAppStore.getState().zoomPercent + (event.deltaY < 0 ? 10 : -10));
      } else if ((viewMode === 'single' || viewMode === 'double') && sheets.length && !event.shiftKey && !event.altKey &&
        Math.abs(event.deltaY) > Math.abs(event.deltaX) && isAtWheelEdge(event.deltaY,viewport.scrollTop,viewport.scrollHeight,viewport.clientHeight)) {
        const direction = event.deltaY > 0 ? 1 : -1;
        const next = safeSheetIdx + direction;
        if (next < 0 || next >= sheets.length) return;
        // Keep the default wheel behavior inside a sheet; only consume it at an edge.
        event.preventDefault();
        const now = performance.now();
        const step = wheelSheetStep(event.deltaY, now, lastWheelStep.current);
        if (step) {
          lastWheelStep.current = now;
          pendingWheelEntry.current = {index:next, edge:step > 0 ? 'top' : 'bottom'};
          setPan({x:0,y:0});
          activateSheet(next);
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

        {/* Rulers use a left/top origin even in RTL, matching the sheet coordinates. */}
        <RulerGuideProvider widthMm={sheetSide.widthMm} heightMm={sheetSide.heightMm} widthPx={widthPx} heightPx={heightPx}
          unit={settings.unit} language={lang} rulersVisible={showRulers && viewMode !== 'grid'} spaceDown={spaceDown} disabled={!!previewOnlyPage}>
          <SheetRuler axis="x" />
          <div className="flex items-start">
            <SheetRuler axis="y" />
            <GuidePaperRef>
            {/* Actual Sheet Canvas */}
            <div
              data-sheet-canvas-index={sheetSide.sideIndex - 1}
              data-color-accurate
              onClick={e => {
                if ((canvasTool === 'move' || canvasTool === 'layout') && !previewOnlyPage) {
                  e.stopPropagation(); setActiveGuideSheet(sheetSide.sideIndex - 1); setCurrentOccurrenceKey(null);
                }
              }}
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
              {/* The shaded area is the configured layout margin, not a measured printer hard margin. */}
              <div data-layout-margin-shading aria-label={lang === 'fa' ? 'حاشیه تنظیم‌شدهٔ چیدمان' : 'Configured layout margin'}
                className="pointer-events-none absolute inset-0 z-10">
                <div className="absolute inset-x-0 top-0 bg-slate-500/15" style={{height:layout.marginsMm.top*basePxPerMm}} />
                <div className="absolute inset-x-0 bottom-0 bg-slate-500/15" style={{height:layout.marginsMm.bottom*basePxPerMm}} />
                <div className="absolute left-0 bg-slate-500/15" style={{top:layout.marginsMm.top*basePxPerMm,bottom:layout.marginsMm.bottom*basePxPerMm,width:layout.marginsMm.left*basePxPerMm}} />
                <div className="absolute right-0 bg-slate-500/15" style={{top:layout.marginsMm.top*basePxPerMm,bottom:layout.marginsMm.bottom*basePxPerMm,width:layout.marginsMm.right*basePxPerMm}} />
                <div style={{left:layout.marginsMm.left*basePxPerMm,top:layout.marginsMm.top*basePxPerMm,right:layout.marginsMm.right*basePxPerMm,bottom:layout.marginsMm.bottom*basePxPerMm}}
                  className="absolute border border-dashed border-slate-500/70" />
              </div>

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
              {sortCellsByLayer(sheetSide.cells).map((cell) => {
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

                    {cell.page && <PageCanvasCell cell={cell} sheetIndex={sheetSide.sideIndex - 1} readOnly={!!previewOnlyPage} isActive={currentOccurrenceKey === cell.occurrenceKey} pxPerMm={basePxPerMm} tool={canvasTool} scope={editScope} spaceDown={spaceDown} onCurrentPage={(id, preserveSelection, occurrenceKey) => {
                      setCurrentEditPageId(id);
                      setCurrentOccurrenceKey(occurrenceKey);
                      if (canvasTool === 'move' && !previewOnlyPage) setActiveGuideSheet(sheetSide.sideIndex - 1);
                      setActiveSheetIndex(sheetSide.sideIndex - 1);
                      focusPageFromPreview(id, preserveSelection, occurrenceKey);
                    }} />}
                  </React.Fragment>
                );
              })}

              {hasTextOverlays && <TextOverlayLayer sheet={sheetSide} totalSheets={outputSheets.length} pages={pages} pageIndices={pageNumbers} pxPerMm={basePxPerMm} enabled={canvasTool==='move' && !spaceDown} previewOnly={!!previewOnlyPage}/>}

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

              {(canvasTool === 'layout' || canvasTool === 'move') && activeGuideSheet === sheetSide.sideIndex - 1 && !previewOnlyPage && <LayoutGuides sheet={sheetSide} layout={layout} pxPerMm={basePxPerMm} spaceDown={spaceDown} language={lang} unit={settings.unit}
                onDraft={setDraftLayout} onCommit={next => commitLayoutGuides({ marginsMm:next.marginsMm, horizontalGutterMm:next.horizontalGutterMm, verticalGutterMm:next.verticalGutterMm })} />}
              {canvasTool === 'measure' && <MeasurementTool sheet={sheetSide} unit={settings.unit} language={lang} spaceDown={spaceDown} />}
              <UserGuideLines />

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
            </GuidePaperRef>
          </div>
        </RulerGuideProvider>
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
              aria-label={lang === 'fa' ? 'شیت قبلی' : 'Prev Sheet'} title={lang === 'fa' ? 'شیت قبلی' : 'Prev Sheet'}
              onClick={() => navigateSheet(safeSheetIdx - 1)}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="sr-only">{lang === 'fa' ? 'شیت قبلی' : 'Prev Sheet'}</span>
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
              aria-label={lang === 'fa' ? 'شیت بعدی' : 'Next Sheet'} title={lang === 'fa' ? 'شیت بعدی' : 'Next Sheet'}
              onClick={() => navigateSheet(safeSheetIdx + 1)}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
            >
              <span className="sr-only">{lang === 'fa' ? 'شیت بعدی' : 'Next Sheet'}</span>
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <button type="button" aria-expanded={showPreflight} aria-label={lang === 'fa' ? 'پیش‌بررسی' : 'Preflight'} title={lang === 'fa' ? 'پیش‌بررسی' : 'Preflight'} onClick={() => setShowPreflight(!showPreflight)} className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-100 hover:bg-slate-700">
              <FileWarning className="h-4 w-4" aria-hidden="true" />{preflight.length > 0 && <span aria-hidden="true">{preflight.length}</span>}
            </button>
            <button type="button" aria-label={lang === 'fa' ? 'جاگیری کامل' : 'Fit page'} title={lang === 'fa' ? 'جاگیری کامل' : 'Fit page'} onClick={fitPage} className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-100 hover:bg-slate-700">
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {sheets.length > 0 && <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-200">
        {(['move', 'crop', 'layout', 'measure'] as const).map(tool => {
          const label = lang === 'fa' ? { move:'انتخاب / جابه‌جایی / اندازه', crop:'برش', layout:'حاشیه / فاصله', measure:'خط‌کش' }[tool] : { move:'Select / move / resize', crop:'Crop', layout:'Margins / gutters', measure:'Measure' }[tool];
          const Icon = {move:MousePointer2, crop:Crop, layout:PanelsTopLeft, measure:Ruler}[tool];
          return <button key={tool} type="button" aria-label={label} title={label} aria-pressed={canvasTool === tool} disabled={!!previewOnlyPage}
            onClick={() => { setDraftLayout(null); setCanvasTool(tool); }} className={`rounded-lg px-3 py-1.5 disabled:opacity-40 ${canvasTool === tool ? 'bg-sky-600 text-white' : 'bg-slate-800 hover:bg-slate-700'}`}>
            <Icon className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{label}</span>
          </button>;
        })}
        <button type="button" aria-pressed={showRulers} aria-label={lang === 'fa' ? 'نمایش خط‌کش‌ها' : 'Show rulers'}
          title={lang === 'fa' ? 'نمایش یا پنهان کردن خط‌کش‌ها' : 'Show or hide rulers'} onClick={()=>setShowRulers(!showRulers)}
          className={`rounded border px-2 py-1 ${showRulers?'border-sky-500 text-sky-300':'border-slate-700 text-slate-300'}`}>
          {lang === 'fa' ? 'خط‌کش' : 'Rulers'}
        </button>
        <label title={lang === 'fa' ? 'واحد اندازه‌گیری کل برنامه را تغییر می‌دهد' : 'Changes the measurement unit throughout the app'} className="flex items-center gap-1">{lang === 'fa' ? 'واحد خط‌کش:' : 'Ruler unit:'}
          <select aria-label={lang === 'fa' ? 'واحد خط‌کش' : 'Ruler unit'} value={settings.unit} onChange={e=>updateSettings({unit:e.target.value as typeof settings.unit})} className="rounded bg-slate-800 px-1 py-1 text-slate-100">
            <option value="mm">mm</option><option value="cm">cm</option><option value="inch">inch</option>
          </select>
        </label>
        <span className="text-[10px] text-slate-400">{viewMode === 'grid' ? (lang === 'fa' ? 'خط‌کش در نمای شبکه مخفی است' : 'Rulers hidden in grid view') : !showRulers ? (lang === 'fa' ? 'برای افزودن راهنما خط‌کش را روشن کنید' : 'Show rulers to add guides') : (lang === 'fa' ? 'راهنما: از خط‌کش به برگه بکشید' : 'Guides: drag from a ruler onto the sheet')}</span>
        <label className="flex items-center gap-1">{lang === 'fa' ? 'اعمال روی:' : 'Apply to:'}
          <select value={editScope} onChange={e => setEditScope(e.target.value as PageEditScope)} className="rounded border border-slate-700 bg-slate-800 px-2 py-1">
            <option value="current">{canvasTool === 'crop' ? (lang === 'fa' ? 'این صفحه (همه تکرارها)' : 'This page (all repeats)') : (lang === 'fa' ? 'فقط این خانه' : 'This cell')}</option>
            <option value="selected">{lang === 'fa' ? 'صفحات انتخاب‌شده در پنل' : 'Selected thumbnails'}</option>
            <option value="all">{lang === 'fa' ? 'همه صفحات' : 'All pages'}</option>
          </select>
        </label>
        {canvasTool === 'crop' && <AspectCropControls language={lang} disabled={!!previewOnlyPage || !pages.some(page => page.isHighlighted)} onApply={ratio => {
          const page = pages.find(item => item.id === currentEditPageId && item.isHighlighted) ?? pages.find(item => item.isHighlighted);
          return !!page && applyAspectRatioCrop(page.id, editScope, ratio);
        }} />}
        <button type="button" disabled={!!previewOnlyPage || printerMargins.status !== 'available'} onClick={resetMarginsToPrinter}
          title={lang === 'fa' ? 'بازنشانی به حاشیه چاپگر انتخاب‌شده' : 'Reset to selected printer margins'}
          className="rounded bg-slate-800 px-2 py-1.5 hover:bg-slate-700 disabled:opacity-50">{lang === 'fa' ? 'بازنشانی حاشیه چاپگر' : 'Reset printer margins'}</button>
        <span role="status" className="text-xs text-slate-300">{printerMargins.status === 'loading' ? (lang === 'fa' ? 'در حال دریافت حاشیه چاپگر…' : 'Loading printer margins…') : printerMargins.status === 'unavailable' ? (lang === 'fa' ? 'حاشیه چاپگر نامشخص؛ مقدار فعلی تأیید نشده است' : 'Printer margins unavailable; current values are unverified') : savedLayout.marginMode !== 'printer' ? (lang === 'fa' ? 'حاشیه دستی؛ حاشیه چاپگر قابل دریافت است' : 'Custom margins; printer margins available') : printerMargins.source === 'hardware' ? (lang === 'fa' ? 'حاشیه از درایور چاپگر' : 'Margins from printer driver') : printerMargins.source === 'virtual' ? (lang === 'fa' ? 'چاپگر مجازی: حاشیه صفر' : 'Virtual printer: zero margins') : (lang === 'fa' ? 'چاپگر مجازی شبیه‌سازی‌شده: حاشیه صفر' : 'Simulated virtual printer: zero margins')}</span>
        <button type="button" aria-label={lang === 'fa' ? 'بازنشانی برش و اندازه' : 'Reset crop and size'} title={lang === 'fa' ? 'بازنشانی برش و اندازه' : 'Reset crop and size'} disabled={!!previewOnlyPage || !pages.some(page => page.isHighlighted)} onClick={() => {
          const page = pages.find(item => item.id === currentEditPageId && item.isHighlighted) ?? pages.find(item => item.isHighlighted);
          if (!page) return;
          if (editScope === 'current') {
            const cell = sheets[safeSheetIdx]?.cells.find(item => item.page?.id === page.id && item.occurrenceKey === currentOccurrenceKey)
              ?? sheets[safeSheetIdx]?.cells.find(item => item.page?.id === page.id);
            if (cell?.occurrenceKey) resetCellGeometry(page.id, cell.occurrenceKey);
          } else applyPageGeometry(page.id, editScope, { kind:'reset' });
        }} className="rounded bg-slate-800 px-3 py-1.5 hover:bg-slate-700 disabled:opacity-50"><RotateCcw className="h-4 w-4" aria-hidden="true" /></button>
        {canvasTool === 'move' && <span className="sr-only">{lang === 'fa' ? 'روی تصویر کلیک کنید؛ برای ترتیب لایه راست‌کلیک کنید یا انگشت را نگه دارید.' : 'Click an image to edit it. Right-click or touch and hold for layer order.'}</span>}
        {canvasTool === 'crop' && <span className="sr-only">{lang === 'fa' ? 'برش صفحه روی همه تکرارهای آن اعمال و اندازه‌های اختصاصی آن صفحه بازنشانی می‌شود.' : 'Cropping a page affects all repeats and resets their individual sizes.'}</span>}
        {canvasTool === 'layout' && <span className="sr-only">{lang === 'fa' ? 'سبز: حاشیه؛ بنفش: فاصلهٔ یکسان همهٔ ستون‌ها یا ردیف‌ها. با موس یا لمس بکشید.' : 'Drag green margin or purple uniform gutter handles with mouse or touch.'}</span>}
        {canvasTool === 'measure' && <span className="sr-only">{lang === 'fa' ? 'برای اندازه‌گیری بکشید؛ Shift جهت افقی یا عمودی را قفل می‌کند.' : 'Drag to measure; hold Shift to lock horizontally or vertically.'}</span>}
      </div>}

      {previewOnlyPage && <div role="status" className="flex items-center gap-3 border-b border-amber-700 bg-amber-950 px-4 py-2 text-xs text-amber-100">
        <span>{lang === 'fa' ? 'این صفحه برای چاپ انتخاب نشده است؛ نمایش موقت و فقط‌خواندنی است و خروجی چاپ را تغییر نمی‌دهد.' : 'This page is excluded from printing. This is a temporary read-only preview and does not change output.'}</span>
        <button type="button" onClick={() => { setPreviewOnlyPageId(null); setActiveSheetIndex(returnSheetIndex.current); setNavigationTarget(null); }} className="rounded border border-amber-600 px-2 py-1">{lang === 'fa' ? 'بازگشت به پیش‌نمایش چاپ' : 'Return to print preview'}</button>
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
        className={`min-h-0 min-w-0 flex-1 overflow-auto p-6 ${spaceDown ? (panning ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
        onPointerDown={(e) => {
          suppressNavigationScroll.current = false;
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
        onClick={() => { setCurrentOccurrenceKey(null); setActiveGuideSheet(null); }}
        onScroll={(e) => {
          if (suppressNavigationScroll.current || (viewMode !== 'continuous' && viewMode !== 'grid')) return;
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
            data-preview-sheet-container
            style={{ transform: `translate(${pan.x}px, ${pan.y}px)`, alignItems:'safe center', justifyContent:'safe center' }}
            className={`flex min-h-full min-w-full gap-8 ${
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
