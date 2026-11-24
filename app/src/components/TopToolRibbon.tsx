import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ClipboardPaste,
  Columns2,
  CopyPlus,
  Crop,
  Eraser,
  Eye,
  FileDown,
  FilePlus2,
  FileSearch,
  FileStack,
  FolderX,
  Grid2x2Plus,
  Hash,
  ImagePlus,
  Layers,
  LayoutGrid,
  Magnet,
  Maximize2,
  MousePointer2,
  PanelsTopLeft,
  PlusCircle,
  Printer,
  RotateCw,
  Ruler,
  Scaling,
  Search,
  SlidersHorizontal,
  Save,
  Sparkles,
  Square,
  Stamp,
  SunDim,
  Trash2,
  Type,
} from 'lucide-react';
import type { PdfCompressionMode, PdfImageHandling } from '@shared/models';
import { useAppStore, type InspectorToolId } from '../store/useAppStore';
import { computeImpositionSheets } from '../engine/layoutEngine';
import { checkPreflight } from '../engine/preflight';
import {
  ACCEPTED_DOCUMENT_INPUT_ACCEPT,
  ACCEPTED_IMAGE_INPUT_ACCEPT,
} from '../engine/universalImageDecoder';
import { SettingsPresetMenu } from './SettingsPresets';
import { Tooltip } from './Tooltip';
import { t } from '../i18n/translations';

export const TopToolRibbon: React.FC = () => {
  const {
    documents,
    pages,
    layout,
    effects,
    overlays,
    selectedOverlayId,
    settings,
    batchQueue,
    activeInspectorTool,
    inspectorCollapsed,
    canvasTool,
    eraseTool,
    snapEnabled,
    smartGuidesEnabled,
    showRulers,
    loupeEnabled,
    transparentMode,
    showPreflight,
    pdfExportOptions,
    isExportingPdf,
    exportProgress,
    isGeneratingPdfPreview,
    resetAllSettings,
    importFiles,
    importFromClipboard,
    addImageOverlayFiles,
    clearWorkspace,
    insertBlankPagesAfter,
    duplicatePages,
    makePagesArray,
    deletePages,
    setCanvasTool,
    setActiveInspectorTool,
    setEraseTool,
    setSnapEnabled,
    setSmartGuidesEnabled,
    setShowRulers,
    setLoupeEnabled,
    setTransparentMode,
    setShowPreflight,
    triggerFitPage,
    addTextOverlay,
    addShapeOverlay,
    addNumberingOverlay,
    openPageSetup,
    exportMergedOrImposedPdf,
    openPdfPreviewModal,
    setPdfExportOptions,
    savePspProject,
    sendStudioSheetsToLithography,
  } = useAppStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pictureInputRef = useRef<HTMLInputElement>(null);
  const arrayMenuRef = useRef<HTMLDivElement>(null);
  const [arrayMenuOpen, setArrayMenuOpen] = useState(false);
  const [customArrayCount, setCustomArrayCount] = useState('3');

  useEffect(() => {
    const onAddFilesTrigger = () => {
      fileInputRef.current?.click();
    };
    window.addEventListener('printstudio:add-files', onAddFilesTrigger);
    return () => window.removeEventListener('printstudio:add-files', onAddFilesTrigger);
  }, []);

  useEffect(() => {
    if (!arrayMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (arrayMenuRef.current && !arrayMenuRef.current.contains(e.target as Node)) {
        setArrayMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setArrayMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [arrayMenuOpen]);

  const lang = settings.language;
  const isFa = lang === 'fa';
  const tr = t(lang);
  const labels = tr.shell.topRibbon;

  const targetPageIds = useMemo(() => {
    const highlighted = pages.filter((p) => p.isHighlighted).map((p) => p.id);
    if (highlighted.length > 0) return highlighted;
    const active = useAppStore.getState().activePageId;
    if (active) return [active];
    return pages.length > 0 ? [pages[0].id] : [];
  }, [pages]);

  const outputSheets = useMemo(() => computeImpositionSheets(pages, layout), [pages, layout]);
  const preflightIssues = useMemo(
    () => checkPreflight(pages, documents, outputSheets, effects),
    [pages, documents, outputSheets, effects]
  );

  const selectTool = (tool: InspectorToolId) => {
    if (tool !== 'eraser' && eraseTool !== 'off') {
      setEraseTool('off');
    }
    setActiveInspectorTool(tool);
  };

  const iconTileClass = (active: boolean) =>
    `relative flex h-8 w-8 items-center justify-center rounded-md border text-[11px] transition-colors cursor-pointer shrink-0 ${
      active
        ? 'border-sky-500 bg-sky-50 text-sky-700 shadow-xs dark:border-sky-400 dark:bg-sky-500/20 dark:text-sky-200'
        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
    }`;

  const labeledMiniButtonClass = (active: boolean) =>
    `flex h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
      active
        ? 'border-sky-500 bg-sky-50 text-sky-700 shadow-xs dark:border-sky-400 dark:bg-sky-500/20 dark:text-sky-200'
        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
    }`;

  const isToolActive = (tool: InspectorToolId) =>
    !inspectorCollapsed && activeInspectorTool === tool;

  const handleTextClick = () => {
    const hasText = overlays.some((o) => o.kind === 'text');
    if (!hasText && pages.length > 0) {
      addTextOverlay();
    }
    selectTool('text');
  };

  const handleShapesClick = () => {
    const hasShape = overlays.some((o) => o.kind === 'shape');
    if (!hasShape && pages.length > 0) {
      addShapeOverlay('rectangle');
    }
    selectTool('shape');
  };

  const handleNumberingClick = () => {
    const hasNum = overlays.some((o) => o.kind === 'numbering');
    if (!hasNum && pages.length > 0 && !useAppStore.getState().pageNumbering.enabled) {
      addNumberingOverlay(false);
    }
    selectTool('numbering');
  };

  const handleImageClick = () => {
    const hasImgOverlay = overlays.some((o) => o.kind === 'image');
    const selectedIsImg = overlays.some(
      (o) => o.id === selectedOverlayId && o.kind === 'image'
    );
    if (!hasImgOverlay || selectedIsImg) {
      selectTool('image');
      if (!hasImgOverlay) pictureInputRef.current?.click();
      return;
    }
    selectTool('image');
  };

  const handleEraserClick = () => {
    if (eraseTool === 'off') {
      setCanvasTool('move');
      setEraseTool('brush');
      setActiveInspectorTool('eraser');
    } else if (isToolActive('eraser')) {
      setEraseTool('off');
    } else {
      setActiveInspectorTool('eraser');
    }
  };

  return (
    <div
      data-top-tool-ribbon
      className="flex w-full flex-wrap items-center justify-between gap-1.5 border-b border-slate-200 bg-white px-2 py-1.5 text-slate-900 shadow-xs dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      {/* Hidden file inputs for Add Docs and Insert Image Overlay */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_DOCUMENT_INPUT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const list = e.target.files ? Array.from(e.target.files) : [];
          if (list.length > 0) void importFiles(list);
          e.target.value = '';
        }}
      />
      <input
        ref={pictureInputRef}
        type="file"
        multiple
        accept={ACCEPTED_IMAGE_INPUT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const list = e.target.files ? Array.from(e.target.files) : [];
          if (list.length > 0) {
            void addImageOverlayFiles(list);
          }
          e.target.value = '';
        }}
      />

      {/* CLUSTER 1 (Start): Reset, SaveSheetProfile, Document Controls & Utility Modules */}
      <div data-top-tool-ribbon-start className="flex items-center gap-1.5 shrink-0">
        <Tooltip
          label={isFa ? 'بازگردانی تمام تنظیمات به پیش‌فرض' : 'Reset all sheet settings to defaults'}
          shortcut="Alt+F6"
          side="bottom"
        >
          <button
            type="button"
            data-ribbon-action="reset"
            onClick={() => resetAllSettings()}
            className="flex h-16 min-w-[50px] flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-1.5 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          >
            <RotateCw className="h-6 w-6 text-slate-800 dark:text-slate-100" aria-hidden="true" />
            <span className="text-[10px] font-semibold whitespace-nowrap">{labels.reset}</span>
          </button>
        </Tooltip>

        <SettingsPresetMenu />

        <div className="h-12 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" aria-hidden="true" />

        {/* Document quick controls + utility modules: 2 compact balanced rows */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Tooltip label={labels.add} shortcut="Ctrl+O" side="bottom">
              <button
                type="button"
                data-ribbon-action="add-files"
                aria-label={labels.add}
                title={`${labels.add} (Ctrl+O)`}
                onClick={() => fileInputRef.current?.click()}
                className={iconTileClass(false)}
              >
                <PlusCircle className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.pasteClipboard} shortcut="Ctrl+V" side="bottom">
              <button
                type="button"
                data-ribbon-action="paste-clipboard"
                aria-label={labels.pasteClipboard}
                title={`${labels.pasteClipboard} (Ctrl+V)`}
                onClick={() => void importFromClipboard({ target: 'document' })}
                className={iconTileClass(false)}
              >
                <ClipboardPaste className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.blankPage} shortcut="Shift+Insert" side="bottom">
              <button
                type="button"
                data-ribbon-action="blank-page"
                aria-label={labels.blankPage}
                title={`${labels.blankPage} (Shift+Insert)`}
                onClick={() => insertBlankPagesAfter(targetPageIds)}
                className={iconTileClass(false)}
              >
                <FilePlus2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              </button>
            </Tooltip>

            <div ref={arrayMenuRef} className="relative flex items-center">
              <Tooltip label={labels.duplicatePage} shortcut="Ctrl+D" side="bottom">
                <button
                  type="button"
                  data-ribbon-action="duplicate-page"
                  title={`${labels.duplicatePage} (Ctrl+D)`}
                  disabled={targetPageIds.length === 0}
                  onClick={() => duplicatePages(targetPageIds)}
                  className="flex h-8 items-center gap-1 rounded-s-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-medium text-slate-700 hover:bg-white disabled:opacity-45 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer whitespace-nowrap"
                >
                  <CopyPlus className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                  <span>{labels.duplicatePage}</span>
                </button>
              </Tooltip>
              <button
                type="button"
                data-ribbon-action="duplicate-array-menu"
                aria-label={isFa ? 'تکرار آرایه‌ای و تعداد سفارشی' : 'Array copies & custom count'}
                aria-expanded={arrayMenuOpen}
                title={isFa ? 'انتخاب تعداد تکرار یا عدد سفارشی' : 'Choose repeat presets or custom count'}
                disabled={targetPageIds.length === 0}
                onClick={() => setArrayMenuOpen((v) => !v)}
                className="flex h-8 items-center justify-center rounded-e-md border border-s-0 border-slate-200 bg-slate-50 px-1 text-slate-600 hover:bg-white disabled:opacity-45 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
              >
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              </button>
              {arrayMenuOpen && (
                <div
                  data-duplicate-array-menu
                  className="absolute top-full start-0 z-50 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1.5 text-xs shadow-xl dark:border-slate-700 dark:bg-slate-900"
                >
                  {[2, 4, 8, 16].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      data-duplicate-preset={cnt}
                      onClick={() => {
                        makePagesArray(targetPageIds, cnt);
                        setArrayMenuOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-start hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Grid2x2Plus className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
                        <span>{isFa ? `آرایه ×${cnt}` : `Array ×${cnt}`}</span>
                      </span>
                    </button>
                  ))}
                  <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />
                  <form
                    className="flex flex-col gap-1.5 px-1 py-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const parsed = Number.parseInt(customArrayCount, 10);
                      const clamped = Number.isFinite(parsed) ? Math.max(2, Math.min(100, parsed)) : 2;
                      makePagesArray(targetPageIds, clamped);
                      setArrayMenuOpen(false);
                    }}
                  >
                    <label className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                      {isFa ? 'تعداد سفارشی (۲ تا ۱۰۰):' : 'Custom count (2–100):'}
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={2}
                        max={100}
                        data-duplicate-custom-input
                        aria-label={isFa ? 'تعداد سفارشی تکثیر' : 'Custom duplicate count'}
                        value={customArrayCount}
                        onChange={(e) => setCustomArrayCount(e.target.value)}
                        className="h-7 min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                      <button
                        type="submit"
                        data-duplicate-custom-apply
                        className="h-7 shrink-0 rounded bg-sky-600 px-2.5 text-[11px] font-bold text-white hover:bg-sky-500 cursor-pointer"
                      >
                        {isFa ? 'اعمال' : 'Apply'}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>

            <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" aria-hidden="true" />

            <Tooltip label={labels.pdfTools} side="bottom">
              <button
                type="button"
                data-ribbon-tool="pdf"
                aria-label={labels.pdfTools}
                aria-pressed={isToolActive('pdf')}
                onClick={() => selectTool('pdf')}
                className={iconTileClass(isToolActive('pdf'))}
              >
                <FileStack className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.batch} side="bottom">
              <button
                type="button"
                data-ribbon-tool="batch"
                aria-label={labels.batch}
                aria-pressed={isToolActive('batch')}
                onClick={() => selectTool('batch')}
                className={iconTileClass(isToolActive('batch'))}
              >
                <Layers className="h-4 w-4" aria-hidden="true" />
                {batchQueue.length > 0 && (
                  <span className="pointer-events-none absolute -top-1 -end-1 min-w-4 rounded-full bg-sky-600 px-1 text-center text-[9px] font-bold leading-3.5 text-white tabular-nums">
                    {batchQueue.length}
                  </span>
                )}
              </button>
            </Tooltip>

            <Tooltip label={labels.printers} side="bottom">
              <button
                type="button"
                data-ribbon-tool="printers"
                aria-label={labels.printers}
                aria-pressed={isToolActive('printers')}
                onClick={() => selectTool('printers')}
                className={iconTileClass(isToolActive('printers'))}
              >
                <Printer className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>

          <div className="flex items-center gap-1">
            <Tooltip label={labels.closeAll} shortcut="Ctrl+W" side="bottom">
              <button
                type="button"
                data-ribbon-action="close-all"
                aria-label={labels.closeAll}
                title={`${labels.closeAll} (Ctrl+W)`}
                disabled={documents.length === 0 && pages.length === 0 && overlays.length === 0}
                onClick={() => clearWorkspace()}
                className={`${iconTileClass(false)} disabled:opacity-45`}
              >
                <FolderX className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.deletePage} shortcut="Delete" side="bottom">
              <button
                type="button"
                data-ribbon-action="delete-page"
                aria-label={labels.deletePage}
                title={`${labels.deletePage} (Delete)`}
                disabled={targetPageIds.length === 0}
                onClick={() => deletePages(targetPageIds)}
                className={`${iconTileClass(false)} disabled:opacity-45`}
              >
                <Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              </button>
            </Tooltip>

            <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" aria-hidden="true" />

            <Tooltip label={labels.view} side="bottom">
              <button
                type="button"
                data-ribbon-tool="view"
                aria-label={labels.view}
                aria-pressed={isToolActive('view')}
                onClick={() => selectTool('view')}
                className={iconTileClass(isToolActive('view'))}
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={isFa ? 'ذخیره پروژه' : 'Save project'} shortcut="Ctrl+Shift+S" side="bottom">
              <button
                type="button"
                data-ribbon-quick="save-project"
                aria-label={isFa ? 'ذخیره پروژه (.psp)' : 'Save project (.psp)'}
                title={isFa ? 'ذخیره پروژه (.psp) — Ctrl+Shift+S' : 'Save project (.psp) — Ctrl+Shift+S'}
                onClick={() => savePspProject()}
                className={iconTileClass(false)}
              >
                <Save className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={isFa ? 'تشخیص و خطاها' : 'Diagnostics'} side="bottom">
              <button
                type="button"
                data-ribbon-quick="diagnostics"
                aria-label={isFa ? 'پنل وضعیت و خطاها' : 'Status and diagnostics'}
                onClick={() => setActiveInspectorTool('printers')}
                className={iconTileClass(isToolActive('printers'))}
              >
                <AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-400" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.loupe} side="bottom">
              <button
                type="button"
                data-ribbon-tool="loupe"
                aria-label={labels.loupe}
                aria-pressed={loupeEnabled}
                onClick={() => setLoupeEnabled(!loupeEnabled)}
                className={iconTileClass(loupeEnabled)}
              >
                <Search className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.lightTable} side="bottom">
              <button
                type="button"
                data-ribbon-tool="light-table"
                aria-label={labels.lightTable}
                aria-pressed={transparentMode}
                onClick={() => setTransparentMode(!transparentMode)}
                className={iconTileClass(transparentMode)}
              >
                <SunDim className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.preflight} side="bottom">
              <button
                type="button"
                data-ribbon-tool="preflight"
                aria-label={labels.preflight}
                aria-pressed={showPreflight}
                onClick={() => setShowPreflight(!showPreflight)}
                className={iconTileClass(showPreflight)}
              >
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {preflightIssues.length > 0 && (
                  <span className="pointer-events-none absolute -top-1 -end-1 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[9px] font-bold leading-3.5 text-white tabular-nums">
                    {preflightIssues.length}
                  </span>
                )}
              </button>
            </Tooltip>

            <Tooltip label={labels.fitPage} shortcut="Ctrl+0" side="bottom">
              <button
                type="button"
                data-ribbon-tool="fit-page"
                aria-label={labels.fitPage}
                title={`${labels.fitPage} (Ctrl+0)`}
                onClick={() => triggerFitPage()}
                className={iconTileClass(false)}
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={isFa ? 'تنظیمات کامل صفحه...' : 'Page Setup...'} side="bottom">
              <button
                type="button"
                data-ribbon-tool="page-setup"
                aria-label={isFa ? 'تنظیمات کامل صفحه' : 'Page Setup'}
                onClick={() => openPageSetup('margins')}
                className={iconTileClass(false)}
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="hidden xl:block h-12 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

      {/* CLUSTER 2 (Center): All Program Tools as Uniform Icon Buttons */}
      <div
        data-top-tool-ribbon-tools
        className="flex flex-1 flex-wrap items-center gap-1.5 min-w-0"
      >
        {/* Canvas & Layout Icon Grid (2 rows) */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Tooltip label={labels.marginTool} side="bottom">
              <button
                type="button"
                data-ribbon-tool="margin-canvas"
                aria-label={labels.marginTool}
                aria-pressed={canvasTool === 'layout'}
                onClick={() => {
                  setCanvasTool('layout');
                  selectTool('margins');
                }}
                className={iconTileClass(canvasTool === 'layout')}
              >
                <PanelsTopLeft className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.selectMoveResize} side="bottom">
              <button
                type="button"
                data-ribbon-tool="select-move"
                aria-label={labels.selectMoveResize}
                aria-pressed={canvasTool === 'move' && eraseTool === 'off'}
                onClick={() => {
                  setEraseTool('off');
                  setCanvasTool('move');
                }}
                className={iconTileClass(canvasTool === 'move' && eraseTool === 'off')}
              >
                <MousePointer2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.measure} side="bottom">
              <button
                type="button"
                data-ribbon-tool="measure"
                aria-label={labels.measure}
                aria-pressed={canvasTool === 'measure'}
                onClick={() => {
                  setEraseTool('off');
                  setCanvasTool('measure');
                }}
                className={iconTileClass(canvasTool === 'measure')}
              >
                <Ruler className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.text} side="bottom">
              <button
                type="button"
                data-ribbon-tool="text"
                aria-label={labels.text}
                aria-pressed={isToolActive('text')}
                onClick={handleTextClick}
                className={iconTileClass(isToolActive('text'))}
              >
                <Type className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.margins} side="bottom">
              <button
                type="button"
                data-ribbon-tool="margins"
                aria-label={labels.margins}
                aria-pressed={isToolActive('margins')}
                onClick={() => selectTool('margins')}
                className={iconTileClass(isToolActive('margins'))}
              >
                <Columns2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>

          <div className="flex items-center gap-1">
            <Tooltip label={labels.customLayout} side="bottom">
              <button
                type="button"
                data-ribbon-tool="custom-layout"
                aria-label={labels.customLayout}
                aria-pressed={isToolActive('layout')}
                onClick={() => selectTool('layout')}
                className={iconTileClass(isToolActive('layout'))}
              >
                <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.crop} side="bottom">
              <button
                type="button"
                data-ribbon-tool="crop"
                aria-label={labels.crop}
                aria-pressed={canvasTool === 'crop' || isToolActive('crop')}
                onClick={() => {
                  setEraseTool('off');
                  setCanvasTool('crop');
                  selectTool('crop');
                }}
                className={iconTileClass(canvasTool === 'crop' || isToolActive('crop'))}
              >
                <Crop className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.shapes} side="bottom">
              <button
                type="button"
                data-ribbon-tool="shapes"
                aria-label={labels.shapes}
                aria-pressed={isToolActive('shape')}
                onClick={handleShapesClick}
                className={iconTileClass(isToolActive('shape'))}
              >
                <Square className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.eraser} side="bottom">
              <button
                type="button"
                data-ribbon-tool="eraser"
                aria-label={labels.eraser}
                aria-pressed={eraseTool !== 'off' || isToolActive('eraser')}
                onClick={handleEraserClick}
                className={iconTileClass(eraseTool !== 'off' || isToolActive('eraser'))}
              >
                <Eraser className="h-4 w-4" aria-hidden="true" />
              </button>
            </Tooltip>

            <Tooltip label={labels.effects} side="bottom">
              <button
                type="button"
                data-ribbon-tool="effects"
                aria-label={labels.effects}
                aria-pressed={isToolActive('effects')}
                onClick={() => selectTool('effects')}
                className={iconTileClass(isToolActive('effects'))}
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {effects.invert && (
                  <span
                    className="pointer-events-none absolute -top-0.5 -end-0.5 h-2 w-2 rounded-full bg-fuchsia-500 ring-1 ring-white dark:ring-slate-900"
                    aria-hidden="true"
                  />
                )}
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="h-12 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

        {/* Inserts, Booklet, Guides & Snapping Group */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-ribbon-tool="watermark"
              aria-pressed={isToolActive('watermark')}
              onClick={() => selectTool('watermark')}
              className={labeledMiniButtonClass(isToolActive('watermark'))}
            >
              <Stamp className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
              <span>{labels.watermark}</span>
            </button>

            <button
              type="button"
              data-ribbon-tool="booklet"
              aria-pressed={isToolActive('booklet') || Boolean(layout.booklet?.enabled)}
              onClick={() => selectTool('booklet')}
              className={labeledMiniButtonClass(isToolActive('booklet') || Boolean(layout.booklet?.enabled))}
            >
              <BookOpen className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
              <span>{labels.booklet}</span>
            </button>

            <Tooltip label={labels.image} side="bottom">
              <button
                type="button"
                data-ribbon-tool="image"
                aria-pressed={isToolActive('image')}
                onClick={handleImageClick}
                className={labeledMiniButtonClass(isToolActive('image'))}
              >
                <ImagePlus className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <span>{labels.image}</span>
              </button>
            </Tooltip>
          </div>

          <div className="flex items-center gap-1">
            <Tooltip
              label={isFa ? 'فعال/غیرفعال کردن حالت آهن‌ربایی' : 'Toggle magnetic snapping to guides and edges'}
              shortcut="Ctrl+M"
              side="bottom"
            >
              <button
                type="button"
                data-snap-toggle
                aria-pressed={snapEnabled}
                title={isFa ? 'فعال/غیرفعال کردن حالت آهن‌ربایی (Ctrl+M)' : 'Toggle magnetic snapping (Ctrl+M)'}
                onClick={() => setSnapEnabled(!snapEnabled)}
                className={labeledMiniButtonClass(snapEnabled)}
              >
                <Magnet className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                <span>{labels.snap}</span>
              </button>
            </Tooltip>

            <Tooltip
              label={isFa ? 'خطوط راهنمای بنفش (وسط، یک‌سوم و تقسیم فاصله)' : 'Toggle purple smart guides'}
              side="bottom"
            >
              <button
                type="button"
                data-smart-guides-toggle
                aria-pressed={smartGuidesEnabled}
                title={isFa ? 'خطوط راهنمای بنفش (وسط، یک‌سوم و تقسیم فاصله)' : 'Toggle purple smart guides'}
                onClick={() => setSmartGuidesEnabled(!smartGuidesEnabled)}
                className={labeledMiniButtonClass(smartGuidesEnabled)}
              >
                <Sparkles className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" aria-hidden="true" />
                <span>{labels.smartGuides}</span>
              </button>
            </Tooltip>

            <Tooltip label={labels.rulers} shortcut="Ctrl+G" side="bottom">
              <button
                type="button"
                data-ribbon-tool="rulers"
                aria-pressed={showRulers}
                title={`${labels.rulers} (Ctrl+G)`}
                onClick={() => setShowRulers(!showRulers)}
                className={labeledMiniButtonClass(showRulers)}
              >
                <Scaling className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span>{labels.rulers}</span>
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Page Number vertical tile */}
        <Tooltip label={labels.pageNumber} side="bottom">
          <button
            type="button"
            data-ribbon-tool="page-number"
            aria-pressed={isToolActive('numbering')}
            onClick={handleNumberingClick}
            className={`flex h-[68px] min-w-[52px] flex-col items-center justify-center gap-1 rounded-md border px-1.5 text-[10px] font-medium transition-colors cursor-pointer shrink-0 ${
              isToolActive('numbering')
                ? 'border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-400 dark:bg-sky-500/20 dark:text-sky-200'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Hash className="h-4 w-4 text-slate-600 dark:text-slate-300" aria-hidden="true" />
            <span className="leading-tight text-center">{labels.pageNumber}</span>
          </button>
        </Tooltip>

        {/* Auto-Pack by Image Dimensions quick tile */}
        <Tooltip label={labels.autoPack} side="bottom">
          <button
            type="button"
            data-ribbon-tool="auto-pack"
            aria-label={labels.autoPack}
            aria-pressed={isToolActive('layout')}
            onClick={() => {
              selectTool('layout');
              requestAnimationFrame(() => {
                document.querySelector<HTMLInputElement>('[data-auto-pack-width]')?.focus();
              });
            }}
            className={`flex h-[68px] min-w-[56px] flex-col items-center justify-center gap-1 rounded-md border px-1.5 text-[10px] font-medium transition-colors cursor-pointer shrink-0 ${
              isToolActive('layout')
                ? 'border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-400 dark:bg-sky-500/20 dark:text-sky-200'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Grid2x2Plus className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
            <span className="leading-tight text-center">{isFa ? 'چیدمان ابعاد' : 'Auto-Pack'}</span>
          </button>
        </Tooltip>
      </div>

      {/* CLUSTER 3 (End): Save As PDF File, View PDF File, Image Quality & Compression */}
      <div className="flex items-center gap-1.5 border-s border-slate-200 ps-1.5 dark:border-slate-700 shrink-0">
        <Tooltip label={labels.saveAsPdf} shortcut="Ctrl+S" side="bottom">
          <button
            type="button"
            data-ribbon-action="save-as-pdf"
            title={`${labels.saveAsPdf} (Ctrl+S)`}
            disabled={isExportingPdf}
            onClick={() => void exportMergedOrImposedPdf(false)}
            className="flex h-[68px] w-[58px] flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-1 text-slate-700 hover:border-slate-300 hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          >
            <FileDown className="h-6 w-6 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            <span className="text-[10px] font-semibold leading-tight text-center tabular-nums">
              {isExportingPdf && !isGeneratingPdfPreview && exportProgress > 0
                ? `${exportProgress}%`
                : labels.saveAsPdf}
            </span>
          </button>
        </Tooltip>

        <Tooltip label={labels.viewPdf} side="bottom">
          <button
            type="button"
            data-ribbon-action="view-pdf"
            disabled={isGeneratingPdfPreview || isExportingPdf}
            onClick={() => void openPdfPreviewModal()}
            className="flex h-[68px] w-[58px] flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-1 text-slate-700 hover:border-slate-300 hover:bg-white disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          >
            <FileSearch className="h-6 w-6 text-red-600 dark:text-red-400" aria-hidden="true" />
            <span className="text-[10px] font-semibold leading-tight text-center tabular-nums">
              {isGeneratingPdfPreview && exportProgress > 0 ? `${exportProgress}%` : labels.viewPdf}
            </span>
          </button>
        </Tooltip>

        <Tooltip label={isFa ? 'ارسال شیت‌های استادیو به بخش لیتوگرافی' : 'Send Studio Sheets to Lithography'} side="bottom">
          <button
            type="button"
            data-ribbon-action="send-to-lithography"
            disabled={pages.every((p) => !p.selectedForPrint) || isExportingPdf}
            onClick={() => void sendStudioSheetsToLithography('all')}
            className="flex h-[68px] w-[62px] flex-col items-center justify-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-1 text-amber-900 hover:bg-amber-100 disabled:opacity-45 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/50 cursor-pointer"
          >
            <Layers className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <span className="text-[10px] font-semibold leading-tight text-center">
              {isFa ? 'ارسال به لیتوگرافی' : 'To Litho'}
            </span>
          </button>
        </Tooltip>

        <div className="flex flex-col gap-1.5">
          <select
            aria-label={isFa ? 'کیفیت تصاویر PDF' : 'PDF image resolution'}
            data-pdf-image-handling
            value={pdfExportOptions.imageHandling}
            onChange={(e) =>
              setPdfExportOptions({ imageHandling: e.target.value as PdfImageHandling })
            }
            className="h-7 w-36 rounded-md border border-slate-300 bg-white px-1.5 text-[11px] font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="preserve">{labels.imagePreserve}</option>
            <option value="downsample-300">{labels.imageDownsample300}</option>
            <option value="downsample-150">{labels.imageDownsample150}</option>
          </select>

          <select
            aria-label={isFa ? 'میزان فشرده‌سازی PDF' : 'PDF compression level'}
            data-pdf-compression
            value={pdfExportOptions.compression}
            onChange={(e) =>
              setPdfExportOptions({ compression: e.target.value as PdfCompressionMode })
            }
            className="h-7 w-36 rounded-md border border-slate-300 bg-white px-1.5 text-[11px] font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="lossless">{labels.compLossless}</option>
            <option value="balanced">{labels.compBalanced}</option>
            <option value="compact">{labels.compCompact}</option>
          </select>
        </div>
      </div>
    </div>
  );
};
