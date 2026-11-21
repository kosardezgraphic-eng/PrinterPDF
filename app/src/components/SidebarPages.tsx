import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Trash2,
  RotateCw,
  Copy,
  FilePlus,
  CheckSquare,
  Square,
  ArrowUp,
  ArrowDown,
  Contrast,
  Scissors,
  Layers,
  SlidersHorizontal,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { t } from '../i18n/translations';
import { computeImpositionSheets } from '../engine/layoutEngine';
import { effectiveInvert } from '../engine/effectsPipeline';
import { PageThumbnail } from './PageThumbnail';
import type { ComputedCellPlacement, ComputedSheetSide, PageItem, SourceDocument } from '@shared/models';
import { formatLocalizedNumber } from '../i18n/shamsi';

interface ContextMenuState {
  x: number;
  y: number;
  pageId: string;
}

export const SidebarPages: React.FC = () => {
  const {
    documents,
    pages,
    bookmarks,
    effects,
    layout,
    watermark,
    pageNumbering,
    sidebarReveal,
    settings,
    sidebarTab,
    setSidebarTab,
    togglePageSelectedForPrint,
    invertAllPrintSelection,
    invertPagesPrintSelection,
    highlightPage,
    requestPreviewPage,
    selectAllForPrint,
    selectOddEvenForPrint,
    invertPrintSelection,
    reorderPages,
    moveHighlightedPages,
    rotatePages,
    duplicatePages,
    makePagesArray,
    insertBlankPagesAfter,
    deletePages,
    openPageSetup,
    removeDocument,
    toggleDocumentCollapse,
    togglePagesInvertOverride,
    exportMergedOrImposedPdf,
    sidebarWidthPx,
    sidebarThumbnailSizePx,
    setSidebarThumbnailSizePx,
  } = useAppStore();

  const dragIdsRef = useRef<{ids:string[]; set:Set<string>} | null>(null);
  const suppressClickRef = useRef(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragIds, setDragIds] = useState<string[]>([]);
  const dropElementRef = useRef<HTMLElement | null>(null);
  const clearDropTarget = () => {
    if (dropElementRef.current) { delete dropElementRef.current.dataset.dropPosition; delete dropElementRef.current.dataset.dropEdge; }
    dropElementRef.current = null;
  };
  const draggingSet = useMemo(() => new Set(dragIds), [dragIds]);
  useEffect(() => () => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current); }, []);
  const endDrag = () => {
    dragIdsRef.current = null; setDragIds([]); clearDropTarget();
    // Prevent a synthesized release click from changing selection or navigating the preview.
    suppressClickRef.current = true;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => { suppressClickRef.current = false; }, 0);
  };
  const dropPosition = (event: React.DragEvent<HTMLElement>): 'before' | 'after' => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const isLeft = event.clientX < bounds.left + bounds.width/2;
    return (settings.language === 'fa' ? !isLeft : isLeft) ? 'before' : 'after';
  };
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Split repeated document headers into consecutive runs so the visible order
  // always matches the global output order, including cross-document moves.
  const pageRuns = useMemo(() => {
    const docs = new Map(documents.map(doc => [doc.id,doc]));
    const runs: {documentId:string; doc:SourceDocument | undefined; name:string; items:{page:PageItem;globalIdx:number}[]}[] = [];
    pages.forEach((page,globalIdx) => {
      let run = runs.at(-1);
      if (!run || run.documentId !== page.documentId) {
        run = {documentId:page.documentId,doc:docs.get(page.documentId),name:page.documentName,items:[]};
        runs.push(run);
      }
      run.items.push({page,globalIdx});
    });
    return runs;
  }, [documents,pages]);

  const listRef = useRef<HTMLDivElement>(null);
  const thumbnailRefs = useRef(new Map<string, HTMLDivElement>());
  const pageIndices = useMemo(() => new Map(pages.map((p, index) => [p.id, index + 1])), [pages]);
  const placements = useMemo(() => {
    type PlacementInfo = { cell: ComputedCellPlacement; width: number; height: number; sheet: ComputedSheetSide; totalSheets: number };
    const byPage = new Map<string, PlacementInfo>();
    const byOccurrence = new Map<string, PlacementInfo>();
    const add = (sheetPages: typeof pages, totalOverride?: number) => {
      const sheets = computeImpositionSheets(sheetPages, layout);
      const totalSheets = totalOverride ?? Math.max(1, sheets.length);
      for (const sheet of sheets) {
        for (const cell of sheet.cells) if (cell.page) {
          const placement: PlacementInfo = { cell, width: sheet.widthMm, height: sheet.heightMm, sheet, totalSheets };
          if (!byPage.has(cell.page.id)) byPage.set(cell.page.id, placement);
          if (cell.occurrenceKey) byOccurrence.set(cell.occurrenceKey, placement);
        }
      }
      return sheets.length;
    };
    const realTotal = add(pages);
    // Excluded pages have no real placement; preview them using the same layout rules.
    const excluded = pages.filter(page => !page.selectedForPrint);
    if (excluded.length) add(excluded.map(page => ({ ...page, selectedForPrint: true })), Math.max(1, realTotal));
    return { byPage, byOccurrence };
  }, [pages, layout]);

  useLayoutEffect(() => {
    if (!sidebarReveal || sidebarTab !== 'pages') return;
    const list = listRef.current, item = thumbnailRefs.current.get(sidebarReveal.pageId);
    if (!list || !item) return;
    // Scroll only the sidebar, never the main preview viewport.
    const bounds = list.getBoundingClientRect(), itemBounds = item.getBoundingClientRect();
    if (itemBounds.top < bounds.top) list.scrollTop += itemBounds.top - bounds.top;
    else if (itemBounds.bottom > bounds.bottom) list.scrollTop += itemBounds.bottom - bounds.bottom;
  }, [sidebarReveal, sidebarTab]);

  const lang = settings.language;
  const tr = t(lang);

  const highlightedIds = pages.filter((p) => p.isHighlighted).map((p) => p.id);

  // What a right-click acts on: the whole highlighted set, because the menu is opened on a page of
  // that group and every action is expected to follow the selection. Only when the set does not
  // contain the page under the cursor — which right-click itself prevents — does it narrow to that
  // one page, so the labels and the effect can never disagree with the highlighted thumbnails.
  const contextTargets = contextMenu
    ? (highlightedIds.length > 1 && highlightedIds.includes(contextMenu.pageId)
        ? highlightedIds
        : [contextMenu.pageId])
    : [];
  const contextLabel = lang === 'fa'
    ? `${formatLocalizedNumber(contextTargets.length, lang)} صفحه`
    : `${contextTargets.length} page${contextTargets.length === 1 ? '' : 's'}`;
  // The menu item says what the next press will do, because the press is a round trip: the label flips to
  // "undo" while the target pages are inverted — whether that inversion comes from their own override or from
  // the document switch — and back again after it.
  const invertArmed = (() => {
    const set = new Set(contextTargets);
    const targets = pages.filter((page) => set.has(page.id));
    return targets.length > 0 && targets.every((page) => effectiveInvert(page, effects));
  })();
  const scopeNote = contextTargets.length > 1
    ? (lang === 'fa' ? `روی ${contextLabel} انتخاب‌شده اعمال می‌شود` : `Applies to the ${contextLabel} selected`)
    : (lang === 'fa' ? 'فقط روی همین صفحه' : 'Only this page');

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(0)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <aside
      data-sidebar-pages
      dir={lang === 'fa' ? 'rtl' : 'ltr'}
      onClick={() => setContextMenu(null)}
      style={{ width: `${sidebarWidthPx}px` }}
      className="flex shrink-0 flex-col border-r border-slate-200 bg-slate-100 text-slate-800 select-none dark:border-slate-800 dark:bg-slate-900/95 dark:text-slate-200"
    >
      {/* Sidebar Tabs: Pages | Bookmarks */}
      <div className="flex border-b border-slate-200 bg-slate-200/60 p-1.5 gap-1 dark:border-slate-800 dark:bg-slate-950/60">
        <button
          type="button"
          onClick={() => setSidebarTab('pages')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition cursor-pointer ${
            sidebarTab === 'pages'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          <span>{tr.sidebar.pagesTab}</span>
          <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${
            sidebarTab === 'pages'
              ? 'bg-black/20 text-white'
              : 'bg-slate-300/70 text-slate-700 dark:bg-black/25 dark:text-slate-300'
          }`}>
            {formatLocalizedNumber(pages.length, lang)}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setSidebarTab('bookmarks')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition cursor-pointer ${
            sidebarTab === 'bookmarks'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
          }`}
        >
          <Bookmark className="h-3.5 w-3.5" />
          <span>{tr.sidebar.bookmarksTab}</span>
          <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${
            sidebarTab === 'bookmarks'
              ? 'bg-black/20 text-white'
              : 'bg-slate-300/70 text-slate-700 dark:bg-black/25 dark:text-slate-300'
          }`}>
            {formatLocalizedNumber(bookmarks.length, lang)}
          </span>
        </button>
      </div>

      {sidebarTab === 'pages' ? (
        <>
          {/* Quick Page Action Toolbar (A3 / A4) */}
          <div className="flex flex-wrap items-center justify-between gap-1 border-b border-slate-200 bg-white/70 px-2.5 py-1.5 text-[11px] dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => selectAllForPrint(true)}
                title={`${tr.sidebar.selectAll} (Ctrl+A)`}
                className="rounded border border-slate-200 bg-white px-1.5 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                {lang === 'fa' ? 'همه' : 'All'}
              </button>
              <button
                type="button"
                onClick={() => selectAllForPrint(false)}
                title={tr.sidebar.selectNone}
                className="rounded border border-slate-200 bg-white px-1.5 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                {lang === 'fa' ? 'هیچ' : 'None'}
              </button>
              <button
                type="button"
                onClick={() => selectOddEvenForPrint('odd')}
                className="rounded border border-slate-200 bg-white px-1.5 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                {lang === 'fa' ? 'فرد' : 'Odd'}
              </button>
              <button
                type="button"
                onClick={() => selectOddEvenForPrint('even')}
                className="rounded border border-slate-200 bg-white px-1.5 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                {lang === 'fa' ? 'زوج' : 'Even'}
              </button>
              <button
                type="button"
                onClick={invertPrintSelection}
                title={lang === 'fa' ? 'معکوس کردن انتخاب چاپ' : 'Invert print selection'}
                className="rounded border border-slate-200 bg-white px-1.5 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >{lang === 'fa' ? 'معکوس' : 'Invert'}</button>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  rotatePages(
                    highlightedIds.length > 0
                      ? highlightedIds
                      : pages.slice(0, 1).map((p) => p.id),
                    90
                  )
                }
                title={`${tr.sidebar.rotateRight} (Ctrl+R)`}
                className="rounded border border-slate-200 bg-white p-1 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => duplicatePages(highlightedIds)}
                title={`${tr.sidebar.duplicate} (Ctrl+D)`}
                className="rounded border border-slate-200 bg-white p-1 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => moveHighlightedPages('up')}
                title={lang === 'fa' ? 'انتقال صفحات انتخاب‌شده به بالا' : 'Move selected pages up'}
                aria-label={lang === 'fa' ? 'انتقال صفحات انتخاب‌شده به بالا' : 'Move selected pages up'}
                className="rounded border border-slate-200 bg-white p-1 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => moveHighlightedPages('down')}
                title={lang === 'fa' ? 'انتقال صفحات انتخاب‌شده به پایین' : 'Move selected pages down'}
                aria-label={lang === 'fa' ? 'انتقال صفحات انتخاب‌شده به پایین' : 'Move selected pages down'}
                className="rounded border border-slate-200 bg-white p-1 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => deletePages(highlightedIds)}
                title={`${tr.sidebar.deleteSelected} (Delete)`}
                className="rounded border border-rose-200 bg-rose-50 p-1 text-rose-600 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-400 dark:hover:bg-rose-500/25 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Thumbnail Size Control */}
          <div data-thumbnail-zoom-controls className="flex items-center gap-1.5 border-b border-slate-200 bg-white/50 px-2.5 py-1 text-[10px] text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
            <button
              type="button"
              onClick={() => setSidebarThumbnailSizePx(sidebarThumbnailSizePx - 12)}
              disabled={sidebarThumbnailSizePx <= 72}
              aria-label={lang === 'fa' ? 'کوچک کردن تصاویر بندانگشتی' : 'Smaller thumbnails'}
              title={lang === 'fa' ? 'کوچک کردن تصاویر بندانگشتی' : 'Smaller thumbnails'}
              className="rounded border border-slate-200 bg-white p-0.5 text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
            >
              <ZoomOut className="h-3 w-3" />
            </button>
            <input
              type="range"
              min={72}
              max={240}
              step={4}
              value={sidebarThumbnailSizePx}
              aria-label={lang === 'fa' ? 'اندازه تصاویر بندانگشتی' : 'Thumbnail size'}
              onChange={(e) => setSidebarThumbnailSizePx(Number(e.target.value))}
              className="min-w-0 flex-1 accent-sky-500 cursor-pointer"
            />
            <button
              type="button"
              onClick={() => setSidebarThumbnailSizePx(sidebarThumbnailSizePx + 12)}
              disabled={sidebarThumbnailSizePx >= 240}
              aria-label={lang === 'fa' ? 'بزرگ کردن تصاویر بندانگشتی' : 'Larger thumbnails'}
              title={lang === 'fa' ? 'بزرگ کردن تصاویر بندانگشتی' : 'Larger thumbnails'}
              className="rounded border border-slate-200 bg-white p-0.5 text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
            >
              <ZoomIn className="h-3 w-3" />
            </button>
            <span className="w-9 text-end font-mono tabular-nums text-[10px] text-slate-500 dark:text-slate-400">
              {sidebarThumbnailSizePx}px
            </span>
          </div>

          <div className="border-b border-slate-200 bg-slate-50 px-3 py-1 text-[10px] text-slate-500 dark:border-slate-800 dark:bg-transparent dark:text-slate-400" aria-live="polite">
            {dragIds.length ? (lang === 'fa' ? `در حال جابه‌جایی ${formatLocalizedNumber(dragIds.length,lang)} صفحه؛ روی نیمهٔ قبل یا بعد مقصد رها کنید.` : `Moving ${dragIds.length} page(s); drop on the before or after half of a thumbnail.`)
              : (lang === 'fa' ? 'برای جابه‌جایی بکشید؛ انتخاب چندتایی با Ctrl یا Shift.' : 'Drag to reorder; use Ctrl or Shift to select multiple pages.')}
          </div>

          {/* Grouped File & Page Thumbnail List */}
          <div ref={listRef} data-thumbnail-list className="flex-1 overflow-y-auto p-2 space-y-2.5">
            {pageRuns.map(({doc, documentId, name, items:docPages}) => {
              return (
                <div
                  key={`${documentId}:${docPages[0].page.id}`}
                  className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden dark:border-slate-800 dark:bg-slate-950/60"
                >
                  {/* Collapsible Document Group Header */}
                  <div className="flex items-center justify-between bg-slate-50 px-2.5 py-2 border-b border-slate-200 dark:bg-slate-900/90 dark:border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => { if (doc) toggleDocumentCollapse(doc.id); }}
                      disabled={!doc}
                      className="flex items-center gap-1.5 text-start min-w-0 flex-1 cursor-pointer"
                    >
                      {doc?.collapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">
                          {doc?.name ?? name}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                          <span>
                            {formatLocalizedNumber(docPages.length, lang)}{' '}
                            {lang === 'fa' ? 'صفحه' : 'pages'}
                          </span>
                          {doc && <><span>•</span><span>{formatBytes(doc.fileSize)}</span></>}
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => removeDocument(documentId)}
                      title={lang === 'fa' ? 'حذف این فایل از پروژه' : 'Remove file'}
                      className="rounded-lg p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-500/20 dark:hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Thumbnails inside Document Group */}
                  {!doc?.collapsed && (
                    <div
                      className="grid gap-2 p-2"
                      style={{
                        gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(88, sidebarThumbnailSizePx + 14)}px, 1fr))`,
                      }}
                    >
                      {docPages.map(({ page, globalIdx }) => {
                        const placement = sidebarReveal?.pageId === page.id && sidebarReveal.occurrenceKey
                          ? placements.byOccurrence.get(sidebarReveal.occurrenceKey) ?? placements.byPage.get(page.id)
                          : placements.byPage.get(page.id);
                        return (
                          <div
                            key={page.id}
                            ref={element => { if (element) thumbnailRefs.current.set(page.id, element); else thumbnailRefs.current.delete(page.id); }}
                            data-page-id={page.id}
                            aria-label={`${lang === 'fa' ? 'صفحه' : 'Page'} ${globalIdx + 1}`}
                            draggable
                            data-dragging={draggingSet.has(page.id) ? 'true' : undefined}
                            onDragStart={e => {
                              if (e.target instanceof Element && e.target.closest('button')) { e.preventDefault(); return; }
                              const current = useAppStore.getState().pages;
                              const source = current.find(item => item.id === page.id);
                              if (!source) { e.preventDefault(); return; }
                              const ids = source.isHighlighted ? current.filter(item => item.isHighlighted).map(item => item.id) : [page.id];
                              dragIdsRef.current = {ids,set:new Set(ids)}; setDragIds(ids); clearDropTarget();
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', 'PrintStudio pages');
                            }}
                            onDragOver={e => {
                              if (!dragIdsRef.current) return;
                              if (dragIdsRef.current.set.has(page.id)) { clearDropTarget(); return; }
                              e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
                              const position = dropPosition(e);
                              if (dropElementRef.current !== e.currentTarget) clearDropTarget();
                              dropElementRef.current = e.currentTarget;
                              e.currentTarget.dataset.dropPosition = position;
                              e.currentTarget.dataset.dropEdge = (position === 'before') === (lang !== 'fa') ? 'left' : 'right';
                            }}
                            onDragLeave={e => {
                              if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
                              if (dropElementRef.current === e.currentTarget) clearDropTarget();
                            }}
                            onDrop={e => {
                              if (!dragIdsRef.current) return;
                              e.preventDefault(); e.stopPropagation();
                              reorderPages(dragIdsRef.current.ids, page.id, dropPosition(e));
                              endDrag();
                            }}
                            onDragEnd={endDrag}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                              highlightPage(page.id, e.ctrlKey || e.metaKey, e.shiftKey);
                              requestPreviewPage(page.id);
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!page.isHighlighted) highlightPage(page.id, false, false);
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                pageId: page.id,
                              });
                            }}
                            className={`group relative flex flex-col rounded-xl border p-1.5 transition cursor-pointer ${
                              page.isHighlighted
                                ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500/40 dark:bg-sky-500/10'
                                : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/70 dark:hover:border-slate-700'
                            } ${draggingSet.has(page.id) ? 'opacity-50' : !page.selectedForPrint ? 'opacity-45' : ''}`}
                          >
                            {/* Top Row: Checkbox + Global Page Index */}
                            <div className="mb-1 flex items-center justify-between">
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={page.selectedForPrint}
                                aria-label={`${lang === 'fa' ? 'انتخاب برای چاپ صفحه' : 'Include in print, page'} ${formatLocalizedNumber(globalIdx + 1, lang)}`}
                                title={lang === 'fa' ? 'تغییر وضعیت چاپ این صفحه و صفحات انتخاب‌شده' : 'Set print selection for this page and highlighted pages'}
                                draggable={false}
                                onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePageSelectedForPrint(page.id);
                                }}
                                className="flex items-center gap-1 text-[11px] font-bold text-slate-800 dark:text-slate-200 cursor-pointer"
                              >
                                {page.selectedForPrint ? (
                                  <CheckSquare className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                                ) : (
                                  <Square className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                                )}
                                <span>#{formatLocalizedNumber(globalIdx + 1, lang)}</span>
                              </button>

                              <div className="flex items-center gap-1">
                                {page.rotation !== 0 && (
                                  <span className="rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                                    {page.rotation}°
                                  </span>
                                )}
                                {page.overrides?.invert && (
                                  <span className="rounded bg-fuchsia-100 px-1 text-[9px] font-bold text-fuchsia-700 dark:bg-fuchsia-500/25 dark:text-fuchsia-300">
                                    INV
                                  </span>
                                )}
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    page.colorProfile === 'color'
                                      ? 'bg-sky-500 dark:bg-sky-400'
                                      : page.colorProfile === 'grayscale'
                                        ? 'bg-slate-400'
                                        : 'bg-slate-700'
                                  }`}
                                  title={page.colorProfile}
                                />
                              </div>
                            </div>

                            {/* Thumbnail mirrors the actual cell placement, crop, rotation, effects, eraser, overlays and watermarks. */}
                            {placement && (
                              <PageThumbnail
                                page={page}
                                cell={placement.cell}
                                sheetWidth={placement.width}
                                sheetHeight={placement.height}
                                effects={effects}
                                sizePx={sidebarThumbnailSizePx}
                                sheet={placement.sheet}
                                totalSheets={placement.totalSheets}
                                pages={pages}
                                pageIndices={pageIndices}
                                layout={layout}
                                watermark={watermark}
                                pageNumbering={pageNumbering}
                                userName={settings.userName}
                              />
                            )}

                            {/* Bottom Info */}
                            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                              <span>
                                {Math.round(page.widthMm)}×{Math.round(page.heightMm)}
                              </span>
                              <span>
                                {page.isBlankPage
                                  ? lang === 'fa'
                                    ? 'خالی'
                                    : 'Blank'
                                  : `p.${page.sourcePageNumber}`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        /* Bookmarks Tab (C2) */
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {bookmarks.map((bm) => (
            <button
              key={bm.id}
              type="button"
              onClick={() => {
                highlightPage(bm.targetPageId);
                setSidebarTab('pages');
              }}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-start text-xs text-slate-800 hover:border-sky-400 hover:bg-sky-50/50 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:border-sky-500/40 dark:hover:bg-slate-800/60 cursor-pointer"
            >
              <div className="flex items-center gap-2 truncate">
                <Bookmark className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                <span className="truncate font-semibold">{bm.title}</span>
              </div>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400 tabular-nums">
                #{formatLocalizedNumber(bm.pageIndex + 1, lang)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Right-Click Context Menu for Page Operations (A4).
          Every action here works on the whole selection, not on the thumbnail that happened to be
          under the cursor — inverting, rotating, duplicating or deleting six picked pages is one
          right-click. The scope line at the top says how far the action reaches. */}
      {contextMenu && (
        <div
          data-page-context-menu
          style={{
            top: Math.max(8, Math.min(window.innerHeight - 375, contextMenu.y)),
            left: Math.max(8, Math.min(window.innerWidth - 232, contextMenu.x)),
            maxHeight: 'calc(100vh - 16px)',
          }}
          className="fixed z-50 w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 text-xs text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <div
            data-context-menu-scope
            className="px-2.5 pb-1.5 pt-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300"
          >
            {scopeNote}
          </div>
          <button
            type="button"
            data-context-action="invert-print-selection"
            onClick={() => { invertPagesPrintSelection(contextTargets); setContextMenu(null); }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <CheckSquare className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" aria-hidden="true" />
            <span>
              {lang === 'fa'
                ? `معکوس کردن وضعیت چاپ (${contextLabel})`
                : `Invert print selection (${contextLabel})`}
            </span>
          </button>
          <button
            type="button"
            data-context-action="invert-print-all"
            onClick={() => { invertAllPrintSelection(); setContextMenu(null); }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <CheckSquare className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            <span>{lang === 'fa' ? 'معکوس کردن وضعیت چاپ همهٔ صفحات' : 'Invert print selection of all pages'}</span>
          </button>
          <button
            type="button"
            data-context-action="rotate"
            onClick={() => {
              rotatePages(contextTargets, 90);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <RotateCw className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
            <span>
              {lang === 'fa' ? `چرخش ۹۰° راست (${contextLabel})` : `Rotate 90° CW (${contextLabel})`}
            </span>
          </button>
          <button
            type="button"
            data-context-action="duplicate"
            onClick={() => {
              duplicatePages(contextTargets);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Copy className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>
              {lang === 'fa' ? `تکثیر صفحات (${contextLabel})` : `Duplicate (${contextLabel})`}
            </span>
          </button>
          <button
            type="button"
            data-context-action="make-array"
            onClick={() => {
              makePagesArray(contextTargets, 4);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Layers className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
            <span>
              {lang === 'fa'
                ? `تکرار آرایه‌ای ۴تایی (${contextLabel})`
                : `Make an Array ×4 (${contextLabel})`}
            </span>
          </button>
          <button
            type="button"
            data-context-action="insert-blank"
            onClick={() => {
              insertBlankPagesAfter(contextTargets);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <FilePlus className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>
              {lang === 'fa'
                ? `درج صفحه خالی بعد از هر صفحه (${contextLabel})`
                : `Insert a blank page after each (${contextLabel})`}
            </span>
          </button>
          <button
            type="button"
            data-context-action="invert-colour"
            onClick={() => {
              togglePagesInvertOverride(contextTargets);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Contrast className="h-3.5 w-3.5 text-fuchsia-600 dark:text-fuchsia-400" />
            <span>
              {invertArmed
                ? lang === 'fa'
                  ? `لغو معکوس رنگ صفحات (${contextLabel})`
                  : `Undo the inverted colour (${contextLabel})`
                : lang === 'fa'
                  ? `معکوس رنگ صفحات (${contextLabel})`
                  : `Invert colour (${contextLabel})`}
            </span>
          </button>
          <button
            type="button"
            data-context-action="extract-pdf"
            onClick={() => {
              void exportMergedOrImposedPdf(true);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Scissors className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
            <span>
              {lang === 'fa' ? 'استخراج صفحات انتخابی به PDF' : 'Extract the selection to PDF'}
            </span>
          </button>
          <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />
          <button
            type="button"
            data-context-action="delete"
            onClick={() => {
              deletePages(contextTargets);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/15 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>
              {lang === 'fa' ? `حذف صفحات انتخابی (${contextLabel})` : `Delete the selection (${contextLabel})`}
            </span>
          </button>
          <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />
          <button
            type="button"
            data-context-action="page-setup"
            onClick={() => {
              setContextMenu(null);
              openPageSetup('margins');
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sky-700 hover:bg-slate-100 dark:text-sky-300 dark:hover:bg-slate-800 cursor-pointer"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{lang === 'fa' ? 'تنظیمات صفحه...' : 'Page Setup...'}</span>
          </button>
        </div>
      )}
    </aside>
  );
};
