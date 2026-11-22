import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  UploadCloud,
  ChevronRight,
  ChevronLeft,
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
  Maximize2,
  SlidersHorizontal,
  Zap,
  Boxes,
  ClipboardPaste,
} from 'lucide-react';
import { useAppStore, type CanvasTool, type PageEditScope } from '../store/useAppStore';
import { VirtualPrinterCard } from './VirtualPrinterCard';
import { PageCanvasCell } from './PageCanvasCell';
import { PrinterRetryButton, PrinterServiceStatus } from './PrinterStatus';
import { LayoutGuides, MeasurementTool } from './SheetTools';
import { RulerGuideProvider, SheetRuler, GuidePaperRef, UserGuideLines } from './RulerGuides';
import { SmartGuideProvider } from './SmartGuidesOverlay';
import { TextOverlayLayer } from './TextOverlayLayer';
import { hasImageTransfer, routeDroppedFiles } from '../engine/imageImport';
import { AspectCropControls } from './AspectCropControls';
import { t } from '../i18n/translations';
import {
  computeImpositionSheets,
  getDuplexFlipAxis,
  getEffectiveSideMarginsMm,
  sortCellsByLayer,
  convertMmToUnit,
} from '../engine/layoutEngine';
import { checkPreflight } from '../engine/preflight';
import { moveLayoutGuide, resolvePrinterMinMargins } from '../engine/sheetInteraction';
import { fitPageZoom, isAtWheelEdge, PREVIEW_PX_PER_MM, wheelSheetStep } from '../engine/viewNavigation';
import {
  formatPageNumberLabel,
  resolveTextMacros,
} from '../engine/watermarkEngine';
import { formatLocalizedNumber } from '../i18n/shamsi';
import {
  STANDARD_PAPER_SIZES,
  type ComputedSheetSide,
  type DuplexMode,
  type LayoutSettings,
  type PageOrientation,
  type PaperSizeId,
  type PrinterInfo,
  type RulerGuide,
} from '@shared/models';

const EMPTY_RULER_GUIDES: RulerGuide[] = [];

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
    snapEnabled,
    smartGuidesEnabled,
    loupeEnabled,
    transparentMode,
    activeRibbonTab,
    workspaceDrawer,
    setWorkspaceDrawer,
    printers,
    selectedPrinterName,
    printerMargins,
    resetMarginsToPrinter,
    spoolerJobs,
    batchQueue,
    canvasTool,
    setCanvasTool,
    showPreflight,
    setShowPreflight,
    fitPageNonce,
    setActiveSheetIndex,
    focusPageFromPreview,
    setZoomPercent,
    importFiles,
    importFromClipboard,
    addImageOverlayFiles,
    applyPageGeometry,
    applyAspectRatioCrop,
    resetCellGeometry,
    commitLayoutGuides,
    selectPrinter,
    setDefaultPrinter,
    openPrinterPreferences,
    updatePrinterProfile,
    refreshPrinterMargins,
    silentPrintNow,
    controlSpoolerJob,
    purgePrinterQueue,
    removeBatchJob,
    openPageSetup,
    updateSettings,
    setAppMode,
  } = useAppStore();

  const activeWorkspaceDrawer = workspaceDrawer === 'closed'
    ? null
    : workspaceDrawer ?? (
        activeRibbonTab === 'batch' || activeRibbonTab === 'printers'
          ? activeRibbonTab
          : null
      );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastWheelStep = useRef(-Infinity);
  const pendingWheelEntry = useRef<{index:number; edge:'top'|'bottom'} | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const bookletSpineDrag = useRef<{ pointerId: number; startX: number; startWidthMm: number; sign: 1 | -1; baseLayout: LayoutSettings } | null>(null);
  const bookletMarginDrag = useRef<{ side: 'left' | 'right' | 'top' | 'bottom'; pointerId: number; startX: number; startY: number; baseLayout: LayoutSettings } | null>(null);
  const matrixGutterDrag = useRef<{ axis: 'horizontal' | 'vertical'; index: number; edge: 'leading' | 'trailing' | 'center'; pointerId: number; startX: number; startY: number; baseLayout: LayoutSettings } | null>(null);
  const suppressClick = useRef(false);
  const handledPreviewRequest = useRef<typeof previewPageRequest>(null);
  const suppressNavigationScroll = useRef(false);
  const scrollSuppressionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returnSheetIndex = useRef(0);
  const [spaceDown, setSpaceDown] = useState(false);
  const [draftLayout, setDraftLayout] = useState<LayoutSettings | null>(null);
  const [activeBandDrag, setActiveBandDrag] = useState<
    | { sheetIndex: number; kind: 'margin'; side: 'left' | 'right' | 'top' | 'bottom' }
    | { sheetIndex: number; kind: 'spine' }
    | { sheetIndex: number; kind: 'gutter'; axis: 'horizontal' | 'vertical'; index: number }
    | null
  >(null);
  const [editScope, setEditScope] = useState<PageEditScope>('current');
  const [currentEditPageId, setCurrentEditPageId] = useState<string | null>(null);
  const [currentOccurrenceKey, setCurrentOccurrenceKey] = useState<string | null>(null);
  const [activeGuideSheet, setActiveGuideSheet] = useState<number | null>(null);
  const [previewOnlyPageId, setPreviewOnlyPageId] = useState<string | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<{pageId: string; sheetIndex: number; previewOnly: boolean} | null>(null);
  const [panning, setPanning] = useState(false);
  const [sheetContextMenu, setSheetContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // A file drag fires `dragover` on the element under the cursor every few milliseconds and a
  // `dragleave` on the workspace each time the pointer crosses into a child element. Driving the
  // drop overlay from those events as they arrive made the whole preview flicker while a file was
  // being dragged, and re-rendered every sheet dozens of times a second — on a slow machine the
  // renderer cannot answer the drag in time and Windows cancels the drop, so the file never
  // arrived. Both overlays are therefore edge-triggered: `dragDepth` counts enter/leave pairs and
  // React only hears about the transitions across zero.
  const dragDepth = useRef(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [pictureDropSheet, setPictureDropSheet] = useState<number | null>(null);
  const pictureDropPos = useRef<{ sheetIndex: number; xPercent: number; yPercent: number } | null>(null);
  const pictureDropNodes = useRef(new Map<number, HTMLSpanElement>());
  /** Follows the cursor without a re-render: the hint node is written directly, on every event. */
  const movePictureHint = (sheetIndex: number, xPercent: number, yPercent: number) => {
    pictureDropPos.current = { sheetIndex, xPercent, yPercent };
    const node = pictureDropNodes.current.get(sheetIndex);
    if (node) { node.style.left = `${xPercent}%`; node.style.top = `${yPercent}%`; }
  };
  const clearFileDropState = () => {
    dragDepth.current = 0;
    setIsDraggingOver(false);
    setPictureDropSheet(prev => (prev === null ? prev : null));
    pictureDropPos.current = null;
  };
  const [loupeCoords, setLoupeCoords] = useState<{
    xPercent: number;
    yPercent: number;
  } | null>(null);

  const layout = draftLayout ?? savedLayout;
  const lang = settings.language;
  const tr = t(lang);

  const outputSheets = useMemo(() => computeImpositionSheets(pages, layout), [pages, layout]);
  const previewOnlyPage = pages.find(page => page.id === previewOnlyPageId && !page.selectedForPrint);
  // The imposition engine keeps an empty back side when duplex output has an odd
  // number of sides. That blank side is required in the print PDF, but it is not
  // an editable/visible page in the workspace preview.
  const sheets = useMemo(() => {
    const computed = previewOnlyPage
      ? computeImpositionSheets([{ ...previewOnlyPage, selectedForPrint: true }], { ...layout, duplexMode: 'none' })
      : outputSheets;
    if (previewOnlyPage || layout.duplexMode === 'none' || computed.length === 0) return computed;

    const last = computed[computed.length - 1];
    const isPrintPaddingBackSide =
      last.side === 'back' && last.cells.every(cell => cell.page === null);
    return isPrintPaddingBackSide ? computed.slice(0, -1) : computed;
  }, [previewOnlyPage, layout, outputSheets]);
  const pageNumbers = useMemo(() => new Map(pages.map((page, index) => [page.id, index + 1])), [pages]);
  const textEditing = useAppStore(s => !!s.textEdit || s.overlays.some(o=>o.id===s.selectedOverlayId && (o.kind==='numbering'||o.kind==='image')));
  // The eraser paints on the overlay layer, and that layer only accepts the pointer in the move tool — arming
  // it from the Insert tab and then dragging over a picture would otherwise do nothing at all, silently.
  const eraseArmed = useAppStore(s => s.eraseTool !== 'off');
  useEffect(() => { if (textEditing || eraseArmed) setCanvasTool('move'); }, [textEditing, eraseArmed, setCanvasTool]);
    // A drawn shape is edited through the same interactive layer, so it has to mount for shapes alone too.
  const hasTextOverlays = useMemo(() => overlays.some(item => item.kind === 'text' || item.kind === 'shape' || item.kind === 'image' || item.kind === 'numbering' && item.enabled), [overlays]);
  useEffect(() => {
    if (!selectedOverlayId) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('[data-overlay-id],[data-text-control-panel],[data-shape-control-panel],[data-tool-panel],[data-top-tool-ribbon],[data-page-context-menu]')) selectOverlay(null);
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
    if (!sheetContextMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheetContextMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetContextMenu]);

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
  useEffect(() => {
    if (fitPageNonce > 0) fitPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitPageNonce]);

  const renderSingleSheet = (sheetSide: ComputedSheetSide, idxInList: number) => {
    const widthPx = Math.round(sheetSide.widthMm * basePxPerMm);
    const heightPx = Math.round(sheetSide.heightMm * basePxPerMm);
    const bookletCells = layout.booklet?.enabled
      ? sheetSide.cells.filter(cell => cell.cellWidthMm > 0).slice().sort((a, b) => a.cellXMm - b.cellXMm)
      : [];
    const bookletGapLeftMm = bookletCells.length >= 2
      ? bookletCells[0].cellXMm + bookletCells[0].cellWidthMm
      : 0;
    const bookletGapWidthMm = bookletCells.length >= 2
      ? Math.max(0, bookletCells[1].cellXMm - bookletGapLeftMm)
      : 0;
    const bookletSpineWidthMm = layout.booklet?.enabled ? Math.max(0, layout.booklet.spineWidthMm) : 0;
    const activePrinterObj = printers.find((p) => p.name === selectedPrinterName);
    const minMargins = resolvePrinterMinMargins(printerMargins, activePrinterObj);
    const flipAxis = getDuplexFlipAxis(layout);
    const mapSheetSideToLayoutSide = (
      side: 'left' | 'right' | 'top' | 'bottom',
      axis = flipAxis,
    ): 'left' | 'right' | 'top' | 'bottom' => {
      if (sheetSide.side !== 'back') return side;
      if (axis === 'horizontal') {
        if (side === 'left') return 'right';
        if (side === 'right') return 'left';
      } else if (axis === 'vertical') {
        if (side === 'top') return 'bottom';
        if (side === 'bottom') return 'top';
      }
      return side;
    };
    const rawSideMargins = sheetSide.marginsMm ?? getEffectiveSideMarginsMm(layout, sheetSide.side);
    const marginTopMm = Math.max(minMargins?.top ?? 0, minMargins?.[mapSheetSideToLayoutSide('top')] ?? 0, rawSideMargins.top);
    const marginRightMm = Math.max(minMargins?.right ?? 0, minMargins?.[mapSheetSideToLayoutSide('right')] ?? 0, rawSideMargins.right);
    const marginBottomMm = Math.max(minMargins?.bottom ?? 0, minMargins?.[mapSheetSideToLayoutSide('bottom')] ?? 0, rawSideMargins.bottom);
    const marginLeftMm = Math.max(minMargins?.left ?? 0, minMargins?.[mapSheetSideToLayoutSide('left')] ?? 0, rawSideMargins.left);

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
        <div className="flex items-center gap-2 rounded-full border border-slate-300/80 bg-white/95 px-3 py-1 text-[11px] font-semibold text-slate-700 shadow-xs dark:border-slate-700/80 dark:bg-slate-900/90 dark:text-slate-300">
          <span>
            {tr.preview.sheet}{' '}
            {formatLocalizedNumber(sheetSide.sheetNumber, lang)}
          </span>
          <span>•</span>
          <span
            className={
              sheetSide.side === 'front' ? 'text-sky-600 dark:text-sky-400' : 'text-amber-600 dark:text-amber-400'
            }
          >
            {sheetSide.side === 'front'
              ? tr.preview.frontSide
              : tr.preview.backSide}
          </span>
          <span>•</span>
          <span className="text-slate-700 dark:text-slate-300" dir="auto">
            {lang === 'fa' ? 'صفحات: ' : 'Pages: '}
            {[...new Set(sheetSide.cells.map(cell => cell.page ? pageNumbers.get(cell.page.id) : undefined).filter((n): n is number => n !== undefined))].map(n => formatLocalizedNumber(n, lang)).join('، ') || '—'}
          </span>
          <span>•</span>
          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
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
              onDragOver={(e) => {
                if (previewOnlyPage || !hasImageTransfer(e.dataTransfer)) return;
                e.preventDefault(); e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                const rect = e.currentTarget.getBoundingClientRect();
                movePictureHint(sheetSide.sideIndex - 1, (e.clientX - rect.left) / rect.width * 100, (e.clientY - rect.top) / rect.height * 100);
                // Which sheet is hovered changes when the drag crosses into it, and not before.
                setPictureDropSheet(current => (current === sheetSide.sideIndex - 1 ? current : sheetSide.sideIndex - 1));
              }}
              onDragLeave={(e) => {
                if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
                setPictureDropSheet(current => (current === sheetSide.sideIndex - 1 ? null : current));
              }}
              onDrop={(e) => {
                const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
                // A picture lands on the sheet as an overlay; a PDF dropped here still opens as a document.
                const { images, documents: others } = routeDroppedFiles(files, !previewOnlyPage);
                // The sheet owns the drop, so the workspace counter has to be released here: its own
                // `onDrop` never runs and the overlay would otherwise stay up until the next drag.
                clearFileDropState();
                if (!files.length) return;
                // The sheet owns this drop either way, so the workspace-wide drop zone must not import it twice.
                e.preventDefault(); e.stopPropagation();
                if (others.length) void importFiles(others);
                if (!images.length) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const xMm = (e.clientX - rect.left) / rect.width * sheetSide.widthMm;
                const yMm = (e.clientY - rect.top) / rect.height * sheetSide.heightMm;
                void addImageOverlayFiles(images, sheetSide, { xMm, yMm });
              }}
              onClick={e => {
                if ((canvasTool === 'move' || canvasTool === 'layout') && !previewOnlyPage) {
                  e.stopPropagation(); setActiveGuideSheet(sheetSide.sideIndex - 1); setCurrentOccurrenceKey(null);
                }
              }}
              onContextMenu={(e) => {
                if (previewOnlyPage) return;
                e.preventDefault();
                e.stopPropagation();
                setSheetContextMenu({
                  x: Math.max(0, Math.min(window.innerWidth - 220, e.clientX)),
                  y: Math.max(0, Math.min(window.innerHeight - 170, e.clientY)),
                });
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
              className="relative overflow-hidden rounded-sm bg-white shadow-[0_12px_36px_rgba(15,23,42,0.18)] ring-1 ring-slate-300/90 transition-all duration-150 dark:shadow-[0_20px_50px_rgba(0,0,0,0.65)] dark:ring-slate-700"
            >
              <SmartGuideProvider
                sheet={sheetSide}
                totalSheets={outputSheets.length}
                pages={pages}
                pageIndices={pageNumbers}
                overlays={overlays}
                marginsMm={{ top: marginTopMm, right: marginRightMm, bottom: marginBottomMm, left: marginLeftMm }}
                rulerGuides={layout.rulerGuides ?? EMPTY_RULER_GUIDES}
                spineGap={layout.booklet?.enabled ? { leftMm: bookletGapLeftMm, rightMm: bookletGapLeftMm + bookletGapWidthMm } : undefined}
                pxPerMm={basePxPerMm}
                unit={settings.unit}
                snapEnabled={snapEnabled}
                smartGuidesEnabled={smartGuidesEnabled}
              >
              {/* Fixed hardware printable boundary from the selected printer driver (cannot shrink outward past this). */}
              {minMargins && (minMargins.top > 0 || minMargins.right > 0 || minMargins.bottom > 0 || minMargins.left > 0) && (
                <div
                  data-printer-min-margins
                  aria-hidden="true"
                  style={{
                    left: minMargins.left * basePxPerMm,
                    top: minMargins.top * basePxPerMm,
                    right: minMargins.right * basePxPerMm,
                    bottom: minMargins.bottom * basePxPerMm,
                  }}
                  className="pointer-events-none absolute z-[9] border border-dashed border-rose-400/60"
                />
              )}

              {/* The shaded area is the configured layout margin, rendered with the same gray hatched style as the spine guide. */}
              <div data-layout-margin-shading aria-label={lang === 'fa' ? 'حاشیه تنظیم‌شدهٔ چیدمان' : 'Configured layout margin'}
                className="pointer-events-none absolute inset-0 z-10">
                <div
                  className="absolute inset-x-0 top-0"
                  style={{
                    height: marginTopMm * basePxPerMm,
                    backgroundImage: 'repeating-linear-gradient(135deg, rgba(100,116,139,0.30) 0px, rgba(100,116,139,0.30) 2px, rgba(148,163,184,0.10) 2px, rgba(148,163,184,0.10) 6px)',
                  }}
                />
                <div
                  className="absolute inset-x-0 bottom-0"
                  style={{
                    height: marginBottomMm * basePxPerMm,
                    backgroundImage: 'repeating-linear-gradient(135deg, rgba(100,116,139,0.30) 0px, rgba(100,116,139,0.30) 2px, rgba(148,163,184,0.10) 2px, rgba(148,163,184,0.10) 6px)',
                  }}
                />
                <div
                  className="absolute left-0"
                  style={{
                    top: marginTopMm * basePxPerMm,
                    bottom: marginBottomMm * basePxPerMm,
                    width: marginLeftMm * basePxPerMm,
                    backgroundImage: 'repeating-linear-gradient(135deg, rgba(100,116,139,0.30) 0px, rgba(100,116,139,0.30) 2px, rgba(148,163,184,0.10) 2px, rgba(148,163,184,0.10) 6px)',
                  }}
                />
                <div
                  className="absolute right-0"
                  style={{
                    top: marginTopMm * basePxPerMm,
                    bottom: marginBottomMm * basePxPerMm,
                    width: marginRightMm * basePxPerMm,
                    backgroundImage: 'repeating-linear-gradient(135deg, rgba(100,116,139,0.30) 0px, rgba(100,116,139,0.30) 2px, rgba(148,163,184,0.10) 2px, rgba(148,163,184,0.10) 6px)',
                  }}
                />
                <div style={{left:marginLeftMm*basePxPerMm,top:marginTopMm*basePxPerMm,right:marginRightMm*basePxPerMm,bottom:marginBottomMm*basePxPerMm}}
                  className="absolute border border-dashed border-slate-500/70" />
              </div>

              {/* Preview-only direct margin drag bands styled & operated identically to the spine guide (gray hatched, col/row-resize cursor, no circles). */}
              {!previewOnlyPage && (
                <>
                  {(['left', 'right', 'top', 'bottom'] as const).map((side) => {
                    const isHorizontal = side === 'left' || side === 'right';
                    const sideMarginMm =
                      side === 'left' ? marginLeftMm : side === 'right' ? marginRightMm : side === 'top' ? marginTopMm : marginBottomMm;
                    const bandPx = Math.max(8, sideMarginMm * basePxPerMm);
                    const style: React.CSSProperties =
                      side === 'left'
                        ? { left: 0, top: marginTopMm * basePxPerMm, bottom: marginBottomMm * basePxPerMm, width: bandPx }
                        : side === 'right'
                          ? { right: 0, top: marginTopMm * basePxPerMm, bottom: marginBottomMm * basePxPerMm, width: bandPx }
                          : side === 'top'
                            ? { top: 0, left: marginLeftMm * basePxPerMm, right: marginRightMm * basePxPerMm, height: bandPx }
                            : { bottom: 0, left: marginLeftMm * basePxPerMm, right: marginRightMm * basePxPerMm, height: bandPx };
                    const borderClass =
                      sideMarginMm > 0
                        ? side === 'left'
                          ? 'border-r border-dashed border-slate-500/70'
                          : side === 'right'
                            ? 'border-l border-dashed border-slate-500/70'
                            : side === 'top'
                              ? 'border-b border-dashed border-slate-500/70'
                              : 'border-t border-dashed border-slate-500/70'
                        : '';
                    const computeNextSideMargin = (
                      clientX: number,
                      clientY: number,
                      dragState: NonNullable<typeof bookletMarginDrag.current>,
                    ) => {
                      const deltaPx =
                        side === 'left'
                          ? clientX - dragState.startX
                          : side === 'right'
                            ? dragState.startX - clientX
                            : side === 'top'
                              ? clientY - dragState.startY
                              : dragState.startY - clientY;
                      const deltaMm = deltaPx / Math.max(0.01, basePxPerMm);
                      const base = dragState.baseLayout;
                      const baseAxis = getDuplexFlipAxis(base);
                      const sideMinMargins = minMargins
                        ? {
                            top: Math.max(minMargins.top, minMargins[mapSheetSideToLayoutSide('top', baseAxis)]),
                            right: Math.max(minMargins.right, minMargins[mapSheetSideToLayoutSide('right', baseAxis)]),
                            bottom: Math.max(minMargins.bottom, minMargins[mapSheetSideToLayoutSide('bottom', baseAxis)]),
                            left: Math.max(minMargins.left, minMargins[mapSheetSideToLayoutSide('left', baseAxis)]),
                          }
                        : undefined;
                      if (!base.booklet?.enabled) {
                        const dxMm = side === 'left' || side === 'right' ? (clientX - dragState.startX) / Math.max(0.01, basePxPerMm) : 0;
                        const dyMm = side === 'top' || side === 'bottom' ? (clientY - dragState.startY) / Math.max(0.01, basePxPerMm) : 0;
                        const effectiveBase: LayoutSettings = {
                          ...base,
                          marginsMm: getEffectiveSideMarginsMm(base, sheetSide.side),
                        };
                        const moved = moveLayoutGuide(effectiveBase, sheetSide, { type: 'margin', side }, dxMm, dyMm, sideMinMargins);
                        return Math.round(moved.marginsMm[side] * 10) / 10;
                      }
                      const effectiveBaseMargins = getEffectiveSideMarginsMm(base, sheetSide.side);
                      const startMargin = effectiveBaseMargins[side];
                      const spine = Math.max(0, base.booklet?.spineWidthMm ?? 0);
                      const minMargin = Math.max(0, sideMinMargins?.[side] ?? 0);
                      const maxMargin =
                        side === 'left'
                          ? Math.max(minMargin, sheetSide.widthMm - effectiveBaseMargins.right - 10 - spine)
                          : side === 'right'
                            ? Math.max(minMargin, sheetSide.widthMm - effectiveBaseMargins.left - 10 - spine)
                            : side === 'top'
                              ? Math.max(minMargin, sheetSide.heightMm - effectiveBaseMargins.bottom - 10)
                              : Math.max(minMargin, sheetSide.heightMm - effectiveBaseMargins.top - 10);
                      return Math.round(Math.max(minMargin, Math.min(maxMargin, startMargin + deltaMm)) * 10) / 10;
                    };
                    const isDraggingThisBand =
                      activeBandDrag?.sheetIndex === sheetSide.sideIndex - 1 &&
                      activeBandDrag.kind === 'margin' &&
                      activeBandDrag.side === side;
                    return (
                      <div
                        key={side}
                        {...(layout.booklet?.enabled ? { 'data-booklet-margin-guide': side } : { 'data-margin-guide': side })}
                        aria-label={lang === 'fa' ? `کشیدن حاشیه ${ { left: 'چپ', right: 'راست', top: 'بالا', bottom: 'پایین' }[side] }` : `Drag ${side} margin`}
                        title={lang === 'fa' ? 'برای تغییر همین ضلع حاشیه بکشید' : `Drag to adjust ${side} margin`}
                        style={style}
                        className={`absolute z-[14] flex touch-none items-center justify-center transition-colors hover:bg-slate-500/10 ${borderClass} ${isHorizontal ? 'cursor-col-resize' : 'cursor-row-resize'}`}
                        onClick={e => e.stopPropagation()}
                        onPointerDown={event => {
                          if (spaceDown || (event.pointerType === 'mouse' && event.button !== 0)) return;
                          event.preventDefault();
                          event.stopPropagation();
                          bookletMarginDrag.current = { side, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, baseLayout: savedLayout };
                          setActiveBandDrag({ sheetIndex: sheetSide.sideIndex - 1, kind: 'margin', side });
                          event.currentTarget.setPointerCapture(event.pointerId);
                        }}
                        onPointerMove={event => {
                          const dragState = bookletMarginDrag.current;
                          if (!dragState || dragState.pointerId !== event.pointerId || dragState.side !== side) return;
                          event.preventDefault();
                          event.stopPropagation();
                          const nextSideMargin = computeNextSideMargin(event.clientX, event.clientY, dragState);
                          const targetSide = mapSheetSideToLayoutSide(side, getDuplexFlipAxis(dragState.baseLayout));
                          setDraftLayout({
                            ...dragState.baseLayout,
                            marginsMm: { ...dragState.baseLayout.marginsMm, [targetSide]: nextSideMargin },
                          });
                        }}
                        onPointerUp={event => {
                          const dragState = bookletMarginDrag.current;
                          if (!dragState || dragState.pointerId !== event.pointerId || dragState.side !== side) return;
                          event.preventDefault();
                          event.stopPropagation();
                          bookletMarginDrag.current = null;
                          setActiveBandDrag(null);
                          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
                          setDraftLayout(null);
                          const nextSideMargin = computeNextSideMargin(event.clientX, event.clientY, dragState);
                          const targetSide = mapSheetSideToLayoutSide(side, getDuplexFlipAxis(dragState.baseLayout));
                          if (nextSideMargin !== dragState.baseLayout.marginsMm[targetSide]) {
                            commitLayoutGuides({ marginsMm: { ...dragState.baseLayout.marginsMm, [targetSide]: nextSideMargin } });
                          }
                        }}
                        onPointerCancel={event => {
                          const dragState = bookletMarginDrag.current;
                          if (!dragState || dragState.pointerId !== event.pointerId) return;
                          bookletMarginDrag.current = null;
                          setActiveBandDrag(null);
                          setDraftLayout(null);
                        }}
                      >
                        {isDraggingThisBand && (
                          <span
                            data-band-size-label={`margin-${side}`}
                            dir="ltr"
                            className="pointer-events-none select-none whitespace-nowrap rounded bg-slate-900/90 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                          >
                            {convertMmToUnit(sideMarginMm, settings.unit)} {settings.unit}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {/* Preview-only booklet fold guide. This DOM layer is not part of PDF rendering or printing. */}
              {layout.booklet?.enabled && (bookletGapWidthMm > 0 || (activeBandDrag?.sheetIndex === sheetSide.sideIndex - 1 && activeBandDrag.kind === 'spine')) && (
                <div
                  data-booklet-spine-guide
                  aria-label={lang === 'fa' ? 'راهنمای غیرقابل چاپ فاصله شیرازه' : 'Non-printing booklet spine guide'}
                  title={lang === 'fa' ? 'فاصله شیرازه و عطف؛ برای تغییر بکشید یا از پنل بوکلت تنظیم کنید' : 'Spine and fold gap; drag or adjust in the booklet panel'}
                  className="absolute z-[14] flex cursor-col-resize touch-none items-center justify-center border-x border-dashed border-slate-500/70"
                  style={{
                    left: bookletGapLeftMm * basePxPerMm,
                    width: Math.max(
                      activeBandDrag?.sheetIndex === sheetSide.sideIndex - 1 && activeBandDrag.kind === 'spine' ? 4 : 0,
                      Math.min(bookletSpineWidthMm, bookletGapWidthMm) * basePxPerMm,
                    ),
                    top: marginTopMm * basePxPerMm,
                    bottom: marginBottomMm * basePxPerMm,
                    backgroundImage: 'repeating-linear-gradient(135deg, rgba(100,116,139,0.30) 0px, rgba(100,116,139,0.30) 2px, rgba(148,163,184,0.10) 2px, rgba(148,163,184,0.10) 6px)',
                  }}
                  onClick={e => e.stopPropagation()}
                  onPointerDown={event => {
                    if (spaceDown || (event.pointerType === 'mouse' && event.button !== 0) || !layout.booklet?.enabled) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    const sign: 1 | -1 =
                      rect.width >= 16 && (event.clientX - rect.left) / rect.width <= 0.35 ? -1 : 1;
                    bookletSpineDrag.current = { pointerId: event.pointerId, startX: event.clientX, startWidthMm: savedLayout.booklet?.spineWidthMm ?? 0, sign, baseLayout: savedLayout };
                    setActiveBandDrag({ sheetIndex: sheetSide.sideIndex - 1, kind: 'spine' });
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={event => {
                    const dragState = bookletSpineDrag.current;
                    if (!dragState || dragState.pointerId !== event.pointerId || !dragState.baseLayout.booklet?.enabled) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const deltaMm = ((event.clientX - dragState.startX) / Math.max(0.01, basePxPerMm)) * dragState.sign;
                    const nextWidth = Math.round(Math.max(0, Math.min(30, dragState.startWidthMm + deltaMm * 2)) * 10) / 10;
                    setDraftLayout({
                      ...dragState.baseLayout,
                      booklet: { ...dragState.baseLayout.booklet, spineWidthMm: nextWidth },
                    });
                  }}
                  onPointerUp={event => {
                    const dragState = bookletSpineDrag.current;
                    if (!dragState || dragState.pointerId !== event.pointerId) return;
                    event.preventDefault();
                    event.stopPropagation();
                    bookletSpineDrag.current = null;
                    setActiveBandDrag(null);
                    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
                    setDraftLayout(null);
                    if (!dragState.baseLayout.booklet?.enabled) return;
                    const deltaMm = ((event.clientX - dragState.startX) / Math.max(0.01, basePxPerMm)) * dragState.sign;
                    const nextWidth = Math.round(Math.max(0, Math.min(30, dragState.startWidthMm + deltaMm * 2)) * 10) / 10;
                    if (nextWidth !== dragState.baseLayout.booklet.spineWidthMm) {
                      commitLayoutGuides({ booklet: { ...dragState.baseLayout.booklet, spineWidthMm: nextWidth } });
                    }
                  }}
                  onPointerCancel={event => {
                    const dragState = bookletSpineDrag.current;
                    if (!dragState || dragState.pointerId !== event.pointerId) return;
                    bookletSpineDrag.current = null;
                    setActiveBandDrag(null);
                    setDraftLayout(null);
                  }}
                >
                  {activeBandDrag?.sheetIndex === sheetSide.sideIndex - 1 && activeBandDrag.kind === 'spine' && (
                    <span
                      data-band-size-label="spine"
                      dir="ltr"
                      className="pointer-events-none select-none whitespace-nowrap rounded bg-slate-900/90 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                    >
                      {convertMmToUnit(bookletSpineWidthMm, settings.unit)} {settings.unit}
                    </span>
                  )}
                </div>
              )}

              {/* Preview-only direct matrix gutter drag bands matching the booklet spine style (centered full-gap hatched bands). */}
              {!previewOnlyPage && !layout.booklet?.enabled && activeGuideSheet !== sheetSide.sideIndex - 1 && (() => {
                const matrixCols = Math.max(1, Math.min(50, Math.floor(layout.cols)));
                const matrixRows = Math.max(1, Math.min(50, Math.floor(layout.rows)));
                const hGutterMm = Math.max(0, layout.horizontalGutterMm);
                const vGutterMm = Math.max(0, layout.verticalGutterMm);
                const printableW = Math.max(10, sheetSide.widthMm - marginLeftMm - marginRightMm);
                const printableH = Math.max(10, sheetSide.heightMm - marginTopMm - marginBottomMm);
                const cellW = Math.max(5, (printableW - (matrixCols - 1) * hGutterMm) / matrixCols);
                const cellH = Math.max(5, (printableH - (matrixRows - 1) * vGutterMm) / matrixRows);
                const hatchBg = 'repeating-linear-gradient(135deg, rgba(100,116,139,0.30) 0px, rgba(100,116,139,0.30) 2px, rgba(148,163,184,0.10) 2px, rgba(148,163,184,0.10) 6px)';

                const computeNextGutter = (
                  clientX: number,
                  clientY: number,
                  dragState: NonNullable<typeof matrixGutterDrag.current>,
                ) => {
                  const dxMm = dragState.axis === 'horizontal' ? (clientX - dragState.startX) / Math.max(0.01, basePxPerMm) : 0;
                  const dyMm = dragState.axis === 'vertical' ? (clientY - dragState.startY) / Math.max(0.01, basePxPerMm) : 0;
                  const effectiveBase: LayoutSettings = {
                    ...dragState.baseLayout,
                    marginsMm: getEffectiveSideMarginsMm(dragState.baseLayout, sheetSide.side),
                  };
                  const moved = moveLayoutGuide(
                    effectiveBase,
                    sheetSide,
                    { type: 'gutter', axis: dragState.axis, index: dragState.index, edge: dragState.edge },
                    dxMm,
                    dyMm,
                  );
                  const key = dragState.axis === 'horizontal' ? 'horizontalGutterMm' : 'verticalGutterMm';
                  return Math.round(moved[key] * 10) / 10;
                };

                const hGutters = Array.from({ length: Math.max(0, matrixCols - 1) }, (_, index) => ({
                  axis: 'horizontal' as const,
                  index,
                  mm: hGutterMm,
                  centerMm: marginLeftMm + (index + 1) * cellW + (index + 0.5) * hGutterMm,
                }));
                const vGutters = Array.from({ length: Math.max(0, matrixRows - 1) }, (_, index) => ({
                  axis: 'vertical' as const,
                  index,
                  mm: vGutterMm,
                  centerMm: marginTopMm + (index + 1) * cellH + (index + 0.5) * vGutterMm,
                }));

                return [...hGutters, ...vGutters].map(({ axis, index, mm, centerMm }) => {
                  const isDraggingThisGutter =
                    activeBandDrag?.sheetIndex === sheetSide.sideIndex - 1 &&
                    activeBandDrag.kind === 'gutter' &&
                    activeBandDrag.axis === axis &&
                    activeBandDrag.index === index;
                  if (mm <= 0 && !isDraggingThisGutter) return null;
                  const bandThicknessPx = Math.max(isDraggingThisGutter ? 4 : 0, mm * basePxPerMm);
                  const bandStyle: React.CSSProperties =
                    axis === 'horizontal'
                      ? {
                          left: centerMm * basePxPerMm,
                          width: bandThicknessPx,
                          top: marginTopMm * basePxPerMm,
                          bottom: marginBottomMm * basePxPerMm,
                          transform: 'translateX(-50%)',
                          backgroundImage: hatchBg,
                        }
                      : {
                          top: centerMm * basePxPerMm,
                          height: bandThicknessPx,
                          left: marginLeftMm * basePxPerMm,
                          right: marginRightMm * basePxPerMm,
                          transform: 'translateY(-50%)',
                          backgroundImage: hatchBg,
                        };
                  return (
                    <div
                      key={`${axis}-${index}`}
                      data-matrix-gutter-guide={`${axis}-${index}`}
                      aria-label={
                        axis === 'horizontal'
                          ? (lang === 'fa' ? `فاصله ستون‌ها ${index + 1}` : `Column gutter ${index + 1}`)
                          : (lang === 'fa' ? `فاصله ردیف‌ها ${index + 1}` : `Row gutter ${index + 1}`)
                      }
                      title={
                        lang === 'fa'
                          ? 'فاصله بین سلول‌ها؛ برای تغییر اندازه از مرکز به دو سمت بکشید'
                          : 'Cell divider gutter; drag to resize symmetrically'
                      }
                      style={bandStyle}
                      className={`absolute z-[14] flex touch-none items-center justify-center border-dashed border-slate-500/70 transition-colors hover:bg-slate-500/10 ${
                        axis === 'horizontal' ? 'cursor-col-resize border-x' : 'cursor-row-resize border-y'
                      }`}
                      onClick={e => e.stopPropagation()}
                      onPointerDown={event => {
                        if (spaceDown || (event.pointerType === 'mouse' && event.button !== 0)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        let edge: 'leading' | 'trailing' | 'center' = 'center';
                        if (axis === 'horizontal' && rect.width >= 16) {
                          const relX = (event.clientX - rect.left) / rect.width;
                          edge = relX <= 0.35 ? 'leading' : relX >= 0.65 ? 'trailing' : 'center';
                        } else if (axis === 'vertical' && rect.height >= 16) {
                          const relY = (event.clientY - rect.top) / rect.height;
                          edge = relY <= 0.35 ? 'leading' : relY >= 0.65 ? 'trailing' : 'center';
                        }
                        matrixGutterDrag.current = {
                          axis,
                          index,
                          edge,
                          pointerId: event.pointerId,
                          startX: event.clientX,
                          startY: event.clientY,
                          baseLayout: savedLayout,
                        };
                        setActiveBandDrag({ sheetIndex: sheetSide.sideIndex - 1, kind: 'gutter', axis, index });
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={event => {
                        const dragState = matrixGutterDrag.current;
                        if (!dragState || dragState.pointerId !== event.pointerId || dragState.axis !== axis || dragState.index !== index) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const nextGutter = computeNextGutter(event.clientX, event.clientY, dragState);
                        const key = axis === 'horizontal' ? 'horizontalGutterMm' : 'verticalGutterMm';
                        setDraftLayout({ ...dragState.baseLayout, [key]: nextGutter });
                      }}
                      onPointerUp={event => {
                        const dragState = matrixGutterDrag.current;
                        if (!dragState || dragState.pointerId !== event.pointerId || dragState.axis !== axis || dragState.index !== index) return;
                        event.preventDefault();
                        event.stopPropagation();
                        matrixGutterDrag.current = null;
                        setActiveBandDrag(null);
                        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
                        setDraftLayout(null);
                        const nextGutter = computeNextGutter(event.clientX, event.clientY, dragState);
                        const key = axis === 'horizontal' ? 'horizontalGutterMm' : 'verticalGutterMm';
                        if (nextGutter !== dragState.baseLayout[key]) {
                          commitLayoutGuides({ [key]: nextGutter });
                        }
                      }}
                      onPointerCancel={event => {
                        const dragState = matrixGutterDrag.current;
                        if (!dragState || dragState.pointerId !== event.pointerId) return;
                        matrixGutterDrag.current = null;
                        setActiveBandDrag(null);
                        setDraftLayout(null);
                      }}
                    >
                      {isDraggingThisGutter && (
                        <span
                          data-band-size-label={`gutter-${axis}-${index}`}
                          dir="ltr"
                          className="pointer-events-none select-none whitespace-nowrap rounded bg-slate-900/90 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                        >
                          {convertMmToUnit(mm, settings.unit)} {settings.unit}
                        </span>
                      )}
                    </div>
                  );
                });
              })()}

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

              {hasTextOverlays && <TextOverlayLayer sheet={sheetSide} totalSheets={outputSheets.length} pages={pages} pageIndices={pageNumbers} pxPerMm={basePxPerMm} enabled={(canvasTool==='move' || !!layout.booklet?.enabled) && !spaceDown} previewOnly={!!previewOnlyPage}/>}
              {pictureDropSheet === sheetSide.sideIndex - 1 && (
                <div className="pointer-events-none absolute inset-0 z-20 bg-sky-500/10">
                  <span
                    data-picture-drop-hint
                    ref={node => {
                      const index = sheetSide.sideIndex - 1;
                      if (node) {
                        pictureDropNodes.current.set(index, node);
                        // The node is mounted one commit after the first dragover, so it has to be
                        // placed at the position that event already measured.
                        const pending = pictureDropPos.current;
                        if (pending?.sheetIndex === index) { node.style.left = `${pending.xPercent}%`; node.style.top = `${pending.yPercent}%`; }
                      } else pictureDropNodes.current.delete(sheetSide.sideIndex - 1);
                    }}
                    className="absolute rounded border-2 border-dashed border-sky-400"
                    style={{ width: '45%', height: '30%', transform: 'translate(-50%, -50%)' }}
                  />
                  <p className="absolute inset-x-0 bottom-2 text-center text-[11px] font-bold text-sky-200">
                    {lang === 'fa' ? 'رها کنید تا تصویر روی همین صفحه بنشیند' : 'Release to drop the picture onto this page'}
                  </p>
                </div>
              )}

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

              {(canvasTool === 'layout' || canvasTool === 'move') && activeGuideSheet === sheetSide.sideIndex - 1 && !previewOnlyPage && <LayoutGuides sheet={sheetSide} layout={layout} pxPerMm={basePxPerMm} spaceDown={spaceDown} language={lang} unit={settings.unit} minMargins={minMargins}
                onDraft={setDraftLayout} onCommit={next => commitLayoutGuides(next.booklet?.enabled ? { marginsMm: next.marginsMm, booklet: next.booklet } : { marginsMm:next.marginsMm, horizontalGutterMm:next.horizontalGutterMm, verticalGutterMm:next.verticalGutterMm })} />}
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
              </SmartGuideProvider>
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
      onDragEnter={(e) => {
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types ?? []).includes('Files')) return;
        dragDepth.current += 1;
        if (dragDepth.current === 1) setIsDraggingOver(true);
      }}
      onDragOver={(e) => {
        // Preventing the default is what says "this area accepts the file". Leaving it out on even
        // one element lets Windows either grey the cursor out or navigate the window to the file.
        e.preventDefault();
        const wantsFiles = !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes('Files');
        if (!wantsFiles) return;
        e.dataTransfer.dropEffect = 'copy';
        // A `dragover` with no preceding `dragenter` (a child that stopped the enter from bubbling)
        // still has to count as the start of the drag, or the hint never appears.
        if (dragDepth.current === 0) { dragDepth.current = 1; setIsDraggingOver(true); }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) clearFileDropState();
      }}
      onDrop={(e) => {
        const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
        e.preventDefault();
        clearFileDropState();
        if (!files.length) return;
        // Whatever reaches this handler — the overlay, the empty state, the padding around a sheet —
        // is a new document. A picture only becomes an overlay when it is released on a sheet, which
        // the sheet handler above owns; here it must not silently vanish into an overlay on a page.
        const { documents } = routeDroppedFiles(files, false);
        if (documents.length) void importFiles(documents);
      }}
      className="relative flex flex-1 flex-col overflow-hidden bg-[#E9EEF5] text-slate-900 dark:bg-slate-950 dark:text-slate-100"
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
        <div data-file-drop-overlay className="pointer-events-none absolute inset-3 z-50 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-sky-500 bg-sky-50/90 backdrop-blur-md dark:border-sky-400 dark:bg-sky-950/85">
          <UploadCloud className="mb-3 h-16 w-16 text-sky-600 dark:text-sky-400 animate-bounce" />
          <h2 className="text-2xl font-black text-slate-900 dark:text-white">
            {tr.preview.dropOverlayTitle}
          </h2>
          <p className="mt-1 text-sm text-sky-700 dark:text-sky-200">
            {tr.preview.dropOverlaySubtitle}
          </p>
        </div>
      )}

      {/* Slim Contextual Sheet Navigation & Active Crop/Geometry Strip */}
      {sheets.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/90 bg-white/80 px-3 py-1 text-xs text-slate-700 backdrop-blur-xs dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-200">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safeSheetIdx <= 0}
              aria-label={lang === 'fa' ? 'شیت قبلی' : 'Prev Sheet'}
              title={lang === 'fa' ? 'شیت قبلی' : 'Prev Sheet'}
              onClick={() => navigateSheet(safeSheetIdx - 1)}
              className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>

            <span className="font-bold text-slate-800 dark:text-slate-200 tabular-nums">
              {lang === 'fa'
                ? `شیت ${formatLocalizedNumber(safeSheetIdx + 1, lang)} از ${formatLocalizedNumber(sheets.length, lang)}`
                : `Sheet ${safeSheetIdx + 1} of ${sheets.length}`}
            </span>

            <button
              type="button"
              disabled={safeSheetIdx >= sheets.length - 1}
              aria-label={lang === 'fa' ? 'شیت بعدی' : 'Next Sheet'}
              title={lang === 'fa' ? 'شیت بعدی' : 'Next Sheet'}
              onClick={() => navigateSheet(safeSheetIdx + 1)}
              className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {showRulers && (
              <label className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                <span>{lang === 'fa' ? 'واحد:' : 'Unit:'}</span>
                <select
                  aria-label={lang === 'fa' ? 'واحد خط‌کش' : 'Ruler unit'}
                  value={settings.unit}
                  onChange={(e) => updateSettings({ unit: e.target.value as 'mm' | 'cm' | 'inch' })}
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="mm">mm</option>
                  <option value="cm">cm</option>
                  <option value="inch">inch</option>
                </select>
              </label>
            )}
            <label className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
              <span>{lang === 'fa' ? 'اعمال روی:' : 'Apply to:'}</span>
              <select
                value={editScope}
                onChange={(e) => setEditScope(e.target.value as PageEditScope)}
                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="current">
                  {canvasTool === 'crop'
                    ? (lang === 'fa' ? 'این صفحه (همه تکرارها)' : 'This page (all repeats)')
                    : (lang === 'fa' ? 'فقط این خانه' : 'This cell')}
                </option>
                <option value="selected">{lang === 'fa' ? 'صفحات انتخاب‌شده در پنل' : 'Selected thumbnails'}</option>
                <option value="all">{lang === 'fa' ? 'همه صفحات' : 'All pages'}</option>
              </select>
            </label>

            {canvasTool === 'crop' && (
              <AspectCropControls
                language={lang}
                disabled={!!previewOnlyPage || !pages.some((page) => page.isHighlighted)}
                onApply={(ratio) => {
                  const page =
                    pages.find((item) => item.id === currentEditPageId && item.isHighlighted) ??
                    pages.find((item) => item.isHighlighted);
                  return !!page && applyAspectRatioCrop(page.id, editScope, ratio);
                }}
              />
            )}

            <button
              type="button"
              aria-label={lang === 'fa' ? 'بازنشانی برش و اندازه' : 'Reset crop and size'}
              title={lang === 'fa' ? 'بازنشانی برش و اندازه' : 'Reset crop and size'}
              disabled={!!previewOnlyPage || !pages.some((page) => page.isHighlighted)}
              onClick={() => {
                const page =
                  pages.find((item) => item.id === currentEditPageId && item.isHighlighted) ??
                  pages.find((item) => item.isHighlighted);
                if (!page) return;
                if (editScope === 'current') {
                  const cell =
                    sheets[safeSheetIdx]?.cells.find((item) => item.page?.id === page.id && item.occurrenceKey === currentOccurrenceKey) ??
                    sheets[safeSheetIdx]?.cells.find((item) => item.page?.id === page.id);
                  if (cell?.occurrenceKey) resetCellGeometry(page.id, cell.occurrenceKey);
                } else {
                  applyPageGeometry(page.id, editScope, { kind: 'reset' });
                }
              }}
              className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-slate-700 hover:bg-slate-100 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{lang === 'fa' ? 'بازنشانی برش' : 'Reset'}</span>
            </button>
          </div>
          {canvasTool === 'move' && <span className="sr-only">{lang === 'fa' ? 'روی تصویر کلیک کنید؛ برای ترتیب لایه راست‌کلیک کنید یا انگشت را نگه دارید.' : 'Click an image to edit it. Right-click or touch and hold for layer order.'}</span>}
          {canvasTool === 'crop' && <span className="sr-only">{lang === 'fa' ? 'برش صفحه روی همه تکرارهای آن اعمال و اندازه‌های اختصاصی آن صفحه بازنشانی می‌شود.' : 'Cropping a page affects all repeats and resets their individual sizes.'}</span>}
          {canvasTool === 'layout' && <span className="sr-only">{lang === 'fa' ? 'سبز: حاشیه؛ بنفش: فاصلهٔ یکسان همهٔ ستون‌ها یا ردیف‌ها. با موس یا لمس بکشید.' : 'Drag green margin or purple uniform gutter handles with mouse or touch.'}</span>}
          {canvasTool === 'measure' && <span className="sr-only">{lang === 'fa' ? 'برای اندازه‌گیری بکشید؛ Shift جهت افقی یا عمودی را قفل می‌کند.' : 'Drag to measure; hold Shift to lock horizontally or vertically.'}</span>}
        </div>
      )}

      {previewOnlyPage && (
        <div role="status" className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <span>{lang === 'fa' ? 'این صفحه برای چاپ انتخاب نشده است؛ نمایش موقت و فقط‌خواندنی است و خروجی چاپ را تغییر نمی‌دهد.' : 'This page is excluded from printing. This is a temporary read-only preview and does not change output.'}</span>
          <button type="button" onClick={() => { setPreviewOnlyPageId(null); setActiveSheetIndex(returnSheetIndex.current); setNavigationTarget(null); }} className="rounded border border-amber-500 px-2 py-1 hover:bg-amber-100 dark:border-amber-600 dark:hover:bg-amber-900/50 cursor-pointer">{lang === 'fa' ? 'بازگشت به پیش‌نمایش چاپ' : 'Return to print preview'}</button>
        </div>
      )}

      {showPreflight && (
        <div role="status" className="border-b border-slate-200 bg-white px-4 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          {preflight.length === 0 ? (lang === 'fa' ? 'مشکل ظاهری در شیت‌ها یافت نشد.' : 'No sheet issues found.') : preflight.map(issue => {
            const labels = lang === 'fa' ? {
              'no-pages': 'صفحه‌ای انتخاب نشده', 'missing-source': 'فایل منبع موجود نیست', 'empty-page': 'صفحه سفید',
              'out-of-bounds': 'خانه خارج از ابعاد کاغذ', 'effects-not-exported': 'بعضی افکت‌ها در PDF خروجی اعمال نمی‌شوند',
            } : {
              'no-pages': 'No pages selected', 'missing-source': 'Source file missing', 'empty-page': 'Blank page',
              'out-of-bounds': 'Cell outside the paper', 'effects-not-exported': 'Some effects are not applied to PDF export',
            };
            return <div key={issue.code} className={issue.severity === 'error' ? 'text-rose-600 dark:text-rose-300' : 'text-amber-600 dark:text-amber-300'}>{labels[issue.code]}{issue.count > 0 ? ` (${issue.count})` : ''}</div>;
          })}
          <div className="mt-1 text-slate-500 dark:text-slate-400">{lang === 'fa' ? 'این بررسی اتصال یا قابلیت چاپگر را تأیید نمی‌کند.' : 'This check does not verify the printer or driver.'}</div>
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
            <div className="max-w-lg rounded-3xl border border-dashed border-slate-300 bg-white/95 p-10 text-center shadow-lg dark:border-slate-700 dark:bg-slate-900/60 dark:shadow-2xl">
              <UploadCloud className="mx-auto mb-4 h-14 w-14 text-sky-600 dark:text-sky-400" />
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
                {tr.preview.emptyTitle}
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
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
                  data-empty-paste-clipboard
                  onClick={() => void importFromClipboard({ target: 'document' })}
                  className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-50 px-5 py-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25 cursor-pointer"
                >
                  <ClipboardPaste className="h-4 w-4" />
                  <span>{tr.preview.pasteClipboard}</span>
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
      {activeWorkspaceDrawer === 'batch' && (
        <section data-workspace-drawer="batch" className="psp-workspace-drawer absolute inset-x-0 bottom-0 z-40 max-h-[40%] overflow-y-auto border-t border-slate-200 bg-white/95 p-4 text-slate-900 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {lang === 'fa'
                  ? 'صف چاپ دسته‌ای و اتوماسیون (Batch Print Queue — H1/H2)'
                  : 'Batch Print Queue Manager (H1/H2)'}
              </h3>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {lang === 'fa'
                ? 'در صورت بروز خطا در یک فایل، صف به‌صورت خودکار به فایل بعدی ادامه می‌دهد'
                : 'Fault-isolated batch execution with automatic retry'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setWorkspaceDrawer('closed');
                  setAppMode('batch');
                }}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 cursor-pointer"
              >
                <Boxes className="h-3.5 w-3.5" />
                <span>
                  {lang === 'fa' ? 'باز کردن محیط مجزای چاپ دسته‌ای' : 'Open Batch Workspace'}
                </span>
              </button>
              <button
                type="button"
                aria-label={lang === 'fa' ? 'بستن پنل صف دسته‌ای' : 'Close batch queue drawer'}
                title={lang === 'fa' ? 'بستن پنل' : 'Close panel'}
                onClick={() => setWorkspaceDrawer('closed')}
                className="shrink-0 rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
              >
                {lang === 'fa' ? 'بستن' : 'Close'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-start text-xs text-slate-800 dark:text-slate-200">
              <thead className="bg-slate-100 text-[11px] text-slate-600 dark:bg-slate-950/80 dark:text-slate-400">
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
              <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800/70 dark:bg-slate-900/60">
                {batchQueue.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-2 font-semibold">{item.fileName}</td>
                    <td className="px-3 py-2">
                      {formatLocalizedNumber(item.pageCount, lang)}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                      {item.printerName}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                          {item.nUp}-Up
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                          {item.copies}×
                        </span>
                        {item.invert && (
                          <span className="rounded bg-fuchsia-100 px-1.5 py-0.5 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300">
                            Invert
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
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
                        className="rounded p-1 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/15 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Contextual Bottom Dock for Windows Printers, Hardware Capabilities & Spooler Queue Manager (I1-I3) */}
      {activeWorkspaceDrawer === 'printers' && (() => {
        const activePrinter = printers.find((p) => p.name === selectedPrinterName) ?? printers[0];
        const caps = activePrinter?.capabilities;
        const prof = activePrinter?.activeProfile;
        const hwPaperOptions = caps?.paperOptions?.length
          ? caps.paperOptions
          : (caps?.supportedPapers ?? (Object.keys(STANDARD_PAPER_SIZES) as PaperSizeId[])).map((id) => {
              const d = id !== 'Custom' ? STANDARD_PAPER_SIZES[id] : { widthMm: 210, heightMm: 297 };
              return { id, name: String(id), widthMm: d.widthMm, heightMm: d.heightMm };
            });
        const selectedHwPaperName = (() => {
          if (!activePrinter || !prof) return 'A4';
          const byName = hwPaperOptions.find((o) => prof.paperName && o.name.toLowerCase() === prof.paperName.toLowerCase());
          if (byName) return byName.name;
          const byId = hwPaperOptions.find((o) => o.id === prof.paperSize);
          return byId?.name ?? hwPaperOptions[0]?.name ?? prof.paperSize;
        })();

        return (
        <section data-workspace-drawer="printers" className="psp-workspace-drawer absolute inset-x-0 bottom-0 z-40 max-h-[40%] overflow-y-auto border-t border-slate-200 bg-white/95 p-4 text-slate-900 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="min-w-0 truncate text-sm font-bold text-slate-900 dark:text-white">
              {lang === 'fa' ? 'مدیریت پرینترها، سخت‌افزار و صف چاپ' : 'Printers, Hardware & Spooler Queue'}
            </h3>
            <button
              type="button"
              aria-label={lang === 'fa' ? 'بستن پنل پرینترها' : 'Close printers drawer'}
              title={lang === 'fa' ? 'بستن پنل' : 'Close panel'}
              onClick={() => setWorkspaceDrawer('closed')}
              className="shrink-0 rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
            >
              {lang === 'fa' ? 'بستن' : 'Close'}
            </button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {/* I1 & I2: Windows Printers & Live Status */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                  <Printer className="h-4 w-4 text-sky-400" />
                  <span>
                    {lang === 'fa'
                      ? 'پرینترهای ویندوز و وضعیت زنده (Win32 Spooler — I1/I2)'
                      : 'Windows Printers & Live Status (I1/I2)'}
                  </span>
                </h4>
                <PrinterRetryButton />
              </div>

              {/* An empty list is never a diagnosis: the sidecar reason is shown next to it. */}
              <PrinterServiceStatus />

              <div className="space-y-2">
                {printers.map((p) => (
                  <div
                    key={p.name}
                    onClick={() => selectPrinter(p.name)}
                    className={`flex items-center justify-between rounded-xl border p-2.5 text-xs transition cursor-pointer ${
                      selectedPrinterName === p.name
                        ? 'border-sky-500 bg-sky-50 dark:bg-sky-500/10'
                        : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-bold text-slate-900 dark:text-slate-100">
                          {p.name}
                        </span>
                        {p.isDefault && (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
                            Default
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                        <span>{p.driverName}</span>
                        <span>•</span>
                        <span>{p.portName}</span>
                        {p.location && (
                          <>
                            <span>•</span>
                            <span>{p.location}</span>
                          </>
                        )}
                        <span>•</span>
                        <span>
                          {p.activeProfile.paperSize} / {p.activeProfile.dpi} DPI
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {renderPrinterStatusBadge(p.status)}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openPrinterPreferences(p.name);
                        }}
                        className="rounded border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        {lang === 'fa' ? 'تنظیمات درایور' : 'Preferences'}
                      </button>
                      {!p.isDefault && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void setDefaultPrinter(p.name);
                          }}
                          className="rounded border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
                        >
                          {lang === 'fa' ? 'پیش‌فرض' : 'Set Default'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Hardware & Driver Capabilities Inspector / Editor */}
            <div
              data-testid="printer-hardware-inspector"
              className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/60"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                  <SlidersHorizontal className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                  <span>
                    {lang === 'fa'
                      ? 'تنظیمات سخت‌افزاری و امکانات درایور'
                      : 'Hardware & Driver Capabilities'}
                  </span>
                </h4>
                {activePrinter && (
                  <button
                    type="button"
                    onClick={() => void silentPrintNow()}
                    className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Zap className="h-3 w-3" />
                    <span>{lang === 'fa' ? 'چاپ فوری' : 'Quick Print'}</span>
                  </button>
                )}
              </div>

              {!activePrinter || !caps || !prof ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  {lang === 'fa'
                    ? 'ابتدا یک پرینتر را از فهرست انتخاب کنید.'
                    : 'Select a Windows printer to inspect hardware capabilities.'}
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300 tabular-nums">
                    <span className="font-bold text-sky-700 dark:text-sky-300 truncate max-w-[180px]" title={activePrinter.name}>
                      {activePrinter.name}
                    </span>
                    <span>
                      {lang === 'fa' ? 'حداکثر کپی:' : 'Max Copies:'} <strong>{caps.maxCopies}</strong>
                    </span>
                    <span>
                      {caps.supportsColor
                        ? lang === 'fa' ? 'رنگی / تک‌رنگ' : 'Color & Mono'
                        : lang === 'fa' ? 'فقط تک‌رنگ' : 'Mono only'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <label className="flex flex-col gap-0.5 text-slate-700 dark:text-slate-300">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {lang === 'fa' ? 'کاغذ درایور (mm)' : 'Driver Paper Size'}
                      </span>
                      <select
                        value={selectedHwPaperName}
                        onChange={(e) => {
                          const opt = hwPaperOptions.find((o) => o.name === e.target.value || o.id === e.target.value);
                          if (!opt) return;
                          void updatePrinterProfile(activePrinter.name, {
                            paperSize: opt.id,
                            paperName: opt.name,
                            paperWidthMm: Math.min(opt.widthMm, opt.heightMm),
                            paperHeightMm: Math.max(opt.widthMm, opt.heightMm),
                          });
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white tabular-nums"
                      >
                        {hwPaperOptions.map((o) => (
                          <option key={`${o.id}-${o.name}`} value={o.name}>
                            {o.name} ({Math.round(o.widthMm)}×{Math.round(o.heightMm)} mm)
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-0.5 text-slate-700 dark:text-slate-300">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {lang === 'fa' ? 'سینی کاغذ (Tray)' : 'Paper Tray'}
                      </span>
                      <select
                        value={prof.tray}
                        onChange={(e) =>
                          void updatePrinterProfile(activePrinter.name, { tray: e.target.value })
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {(caps.supportedTrays.length ? caps.supportedTrays : ['Auto Select']).map((trItem) => (
                          <option key={trItem} value={trItem}>
                            {trItem}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-0.5 text-slate-700 dark:text-slate-300">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {lang === 'fa' ? 'جنس کاغذ (Media)' : 'Media Type'}
                      </span>
                      <select
                        value={prof.mediaType}
                        onChange={(e) =>
                          void updatePrinterProfile(activePrinter.name, { mediaType: e.target.value })
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {(caps.supportedMediaTypes.length ? caps.supportedMediaTypes : ['Plain Paper']).map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-0.5 text-slate-700 dark:text-slate-300">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {lang === 'fa' ? 'جهت و دورو' : 'Orientation & Duplex'}
                      </span>
                      <div className="flex gap-1">
                        <select
                          aria-label={lang === 'fa' ? 'جهت درایور' : 'Driver Orientation'}
                          value={prof.orientation}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, {
                              orientation: e.target.value as PageOrientation,
                            })
                          }
                          className="w-1/2 rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="portrait">{lang === 'fa' ? 'عمودی' : 'Portrait'}</option>
                          <option value="landscape">{lang === 'fa' ? 'افقی' : 'Landscape'}</option>
                        </select>
                        <select
                          aria-label={lang === 'fa' ? 'دورو درایور' : 'Driver Duplex'}
                          value={prof.duplexMode}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, {
                              duplexMode: e.target.value as DuplexMode,
                            })
                          }
                          className="w-1/2 rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="none">{lang === 'fa' ? 'تک‌رو (Simplex)' : 'Simplex (none)'}</option>
                          <option value="long-edge">{lang === 'fa' ? 'دورو لبه بلند (Long-Edge)' : 'Long-Edge'}</option>
                          <option value="short-edge">{lang === 'fa' ? 'دورو لبه کوتاه (Short-Edge)' : 'Short-Edge'}</option>
                        </select>
                      </div>
                    </label>

                    <label className="flex flex-col gap-0.5 text-slate-700 dark:text-slate-300">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {lang === 'fa' ? 'رزولوشن (DPI) و رنگ' : 'DPI & Color Mode'}
                      </span>
                      <div className="flex gap-1">
                        <select
                          aria-label={lang === 'fa' ? 'رزولوشن درایور' : 'Driver DPI'}
                          value={prof.dpi}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, { dpi: Number(e.target.value) })
                          }
                          className="w-1/2 rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white tabular-nums"
                        >
                          {(caps.supportedDpi.length ? caps.supportedDpi : [600]).map((d) => (
                            <option key={d} value={d}>
                              {d} DPI
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label={lang === 'fa' ? 'حالت رنگ درایور' : 'Driver Color'}
                          value={caps.supportsColor ? prof.colorMode : 'monochrome'}
                          disabled={!caps.supportsColor}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, {
                              colorMode: e.target.value as 'color' | 'monochrome',
                            })
                          }
                          className="w-1/2 rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-[11px] text-slate-900 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          {caps.supportsColor && (
                            <option value="color">{lang === 'fa' ? 'رنگی' : 'Color'}</option>
                          )}
                          <option value="monochrome">{lang === 'fa' ? 'تک‌رنگ' : 'Mono'}</option>
                        </select>
                      </div>
                    </label>

                    <label className="flex flex-col gap-0.5 text-slate-700 dark:text-slate-300">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {lang === 'fa' ? 'کیفیت چاپ' : 'Print Quality'}
                      </span>
                      <select
                        value={prof.quality}
                        onChange={(e) =>
                          void updatePrinterProfile(activePrinter.name, {
                            quality: e.target.value as 'draft' | 'normal' | 'high',
                          })
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {(caps.supportedQualities?.length
                          ? caps.supportedQualities
                          : (['draft', 'normal', 'high'] as const)
                        ).map((q) => (
                          <option key={q} value={q}>
                            {q}
                          </option>
                        ))}
                      </select>
                    </label>

                    {((caps.supportedStapleModes?.length ?? 0) > 1 || caps.supportsStaple) && (
                      <label className="flex flex-col gap-0.5 text-slate-700 dark:text-slate-300">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {lang === 'fa' ? 'منگنه (Staple)' : 'Staple'}
                        </span>
                        <select
                          value={prof.staple ?? 'None'}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, { staple: e.target.value })
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          {(caps.supportedStapleModes ?? ['None', 'TopLeft']).map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    {(caps.supportedHolePunchModes?.length ?? 0) > 1 && (
                      <label className="flex flex-col gap-0.5 text-slate-700 dark:text-slate-300">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {lang === 'fa' ? 'پانچ (Hole Punch)' : 'Hole Punch'}
                        </span>
                        <select
                          value={prof.holePunch ?? 'None'}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, { holePunch: e.target.value })
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          {caps.supportedHolePunchModes!.map((hp) => (
                            <option key={hp} value={hp}>{hp}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    {(caps.supportedFoldModes?.length ?? 0) > 1 && (
                      <label className="flex flex-col gap-0.5 text-slate-700 dark:text-slate-300">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {lang === 'fa' ? 'تا کردن (Fold)' : 'Fold'}
                        </span>
                        <select
                          value={prof.fold ?? 'None'}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, { fold: e.target.value })
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          {caps.supportedFoldModes!.map((f) => (
                            <option key={f} value={f}>{f}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    {(caps.supportedOutputBins?.length ?? 0) > 0 && (
                      <label className="flex flex-col gap-0.5 text-slate-700 dark:text-slate-300">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {lang === 'fa' ? 'سینی خروجی' : 'Output Bin'}
                        </span>
                        <select
                          value={prof.outputBin ?? caps.supportedOutputBins![0]}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, { outputBin: e.target.value })
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          {caps.supportedOutputBins!.map((b) => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200 text-[10px] text-slate-500 dark:border-slate-800/80 dark:text-slate-400 tabular-nums">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1 cursor-pointer text-slate-700 dark:text-slate-200">
                        <input
                          type="checkbox"
                          checked={prof.collate ?? true}
                          disabled={caps.supportsCollate === false}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, { collate: e.target.checked })
                          }
                          className="accent-sky-500"
                        />
                        <span>Collate</span>
                      </label>
                      {caps.supportsBorderless && (
                        <label className="flex items-center gap-1 cursor-pointer text-slate-700 dark:text-slate-200">
                          <input
                            type="checkbox"
                            checked={Boolean(prof.borderless)}
                            onChange={(e) =>
                              void updatePrinterProfile(activePrinter.name, { borderless: e.target.checked })
                            }
                            className="accent-sky-500"
                          />
                          <span>{lang === 'fa' ? 'بدون حاشیه' : 'Borderless'}</span>
                        </label>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span>
                        {printerMargins.status === 'available'
                          ? `Margins: ${printerMargins.marginsMm.top}/${printerMargins.marginsMm.right}/${printerMargins.marginsMm.bottom}/${printerMargins.marginsMm.left} mm`
                          : lang === 'fa' ? 'حاشیه سخت‌افزار نامشخص' : 'Hardware margins N/A'}
                      </span>
                      <button
                        type="button"
                        onClick={() => refreshPrinterMargins()}
                        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                      >
                        {lang === 'fa' ? 'خواندن' : 'Sync'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* I3: Live Print Queue Manager (Spooler Jobs) */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                  {lang === 'fa'
                    ? `مدیریت صف چاپ ویندوز (Print Queue Manager — ${spoolerJobs.length} Job)`
                    : `Print Queue Manager (${spoolerJobs.length} Jobs)`}
                </h4>
                {selectedPrinterName && (
                  <button
                    type="button"
                    onClick={() => void purgePrinterQueue(selectedPrinterName)}
                    className="rounded-lg bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:hover:bg-rose-500/25 cursor-pointer"
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
                      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-800 dark:bg-slate-900/80"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-sky-600 dark:text-sky-400">
                            #{job.jobId}
                          </span>
                          <span className="truncate font-bold text-slate-800 dark:text-slate-200">
                            {job.documentTitle}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                          <span>{job.printerName}</span>
                          <span>•</span>
                          <span>
                            {job.pagesPrinted}/{job.totalPages}{' '}
                            {lang === 'fa' ? 'صفحه' : 'p'}
                          </span>
                          <span>•</span>
                          <span className="font-semibold text-amber-600 dark:text-amber-300">
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
                            className="rounded bg-emerald-100 p-1.5 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:hover:bg-emerald-500/30 cursor-pointer"
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
                            className="rounded bg-amber-100 p-1.5 text-amber-700 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:hover:bg-amber-500/30 cursor-pointer"
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
                          className="rounded bg-slate-100 p-1.5 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
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
                          className="rounded bg-rose-100 p-1.5 text-rose-700 hover:bg-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:hover:bg-rose-500/30 cursor-pointer"
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

          <div className="mt-4">
            <VirtualPrinterCard />
          </div>
        </section>
        );
      })()}

      {sheetContextMenu &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999]"
            onClick={() => setSheetContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setSheetContextMenu(null);
            }}
          >
            <div
              data-sheet-context-menu
              role="menu"
              dir={lang === 'fa' ? 'rtl' : 'ltr'}
              style={{ position: 'fixed', left: sheetContextMenu.x, top: sheetContextMenu.y }}
              onClick={(e) => e.stopPropagation()}
              className="min-w-52 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-800 shadow-xl dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            >
              <button
                role="menuitem"
                type="button"
                disabled={printerMargins.status !== 'available'}
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-start hover:bg-slate-100 disabled:opacity-45 dark:hover:bg-slate-700 cursor-pointer"
                onClick={() => {
                  resetMarginsToPrinter();
                  setSheetContextMenu(null);
                }}
              >
                <RotateCcw className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 shrink-0" aria-hidden="true" />
                <span>{lang === 'fa' ? 'بازنشانی به حاشیه پرینتر' : 'Reset printer margins'}</span>
              </button>
              <button
                role="menuitem"
                type="button"
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-start hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                onClick={() => {
                  fitPage();
                  setSheetContextMenu(null);
                }}
              >
                <Maximize2 className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300 shrink-0" aria-hidden="true" />
                <span>{lang === 'fa' ? 'جاگیری کامل در صفحه' : 'Fit page to view'}</span>
              </button>
              <div className="my-1 h-px bg-slate-200 dark:bg-slate-700/80" />
              <button
                role="menuitem"
                type="button"
                data-context-action="page-setup"
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-start text-sky-700 hover:bg-slate-100 dark:text-sky-300 dark:hover:bg-slate-700 cursor-pointer"
                onClick={() => {
                  setSheetContextMenu(null);
                  openPageSetup('margins');
                }}
              >
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{lang === 'fa' ? 'تنظیمات صفحه...' : 'Page Setup...'}</span>
              </button>
            </div>
          </div>,
          document.body
        )}
    </main>
  );
};
