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
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { t } from '../i18n/translations';
import { computeImpositionSheets } from '../engine/layoutEngine';
import { PageThumbnail } from './PageThumbnail';
import type { ComputedCellPlacement, PageItem, SourceDocument } from '@shared/models';
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
    sidebarReveal,
    settings,
    sidebarTab,
    setSidebarTab,
    togglePageSelectedForPrint,
    highlightPage,
    requestPreviewPage,
    selectAllForPrint,
    selectOddEvenForPrint,
    invertPrintSelection,
    reorderPages,
    moveHighlightedPages,
    rotatePages,
    duplicatePages,
    makePageArray,
    insertBlankPageAfter,
    deletePages,
    removeDocument,
    toggleDocumentCollapse,
    togglePageInvertOverride,
    exportMergedOrImposedPdf,
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
  const placements = useMemo(() => {
    const byPage = new Map<string, {cell:ComputedCellPlacement; width:number; height:number}>();
    const byOccurrence = new Map<string, {cell:ComputedCellPlacement; width:number; height:number}>();
    const add = (sheetPages: typeof pages) => {
      for (const sheet of computeImpositionSheets(sheetPages, layout)) {
        for (const cell of sheet.cells) if (cell.page) {
          const placement = { cell, width:sheet.widthMm, height:sheet.heightMm };
          if (!byPage.has(cell.page.id)) byPage.set(cell.page.id, placement);
          if (cell.occurrenceKey) byOccurrence.set(cell.occurrenceKey, placement);
        }
      }
    };
    add(pages);
    // Excluded pages have no real placement; preview them using the same layout rules.
    const excluded = pages.filter(page => !page.selectedForPrint);
    if (excluded.length) add(excluded.map(page => ({ ...page, selectedForPrint: true })));
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

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(0)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <aside
      onClick={() => setContextMenu(null)}
      className="flex w-76 shrink-0 flex-col border-e border-slate-800 bg-slate-900/95 select-none"
    >
      {/* Sidebar Tabs: Pages | Bookmarks */}
      <div className="flex border-b border-slate-800 bg-slate-950/60 p-1.5 gap-1">
        <button
          type="button"
          onClick={() => setSidebarTab('pages')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition cursor-pointer ${
            sidebarTab === 'pages'
              ? 'bg-sky-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          <span>{tr.sidebar.pagesTab}</span>
          <span className="rounded-full bg-black/25 px-1.5 py-0.2 text-[10px]">
            {formatLocalizedNumber(pages.length, lang)}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setSidebarTab('bookmarks')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition cursor-pointer ${
            sidebarTab === 'bookmarks'
              ? 'bg-sky-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Bookmark className="h-3.5 w-3.5" />
          <span>{tr.sidebar.bookmarksTab}</span>
          <span className="rounded-full bg-black/25 px-1.5 py-0.2 text-[10px]">
            {formatLocalizedNumber(bookmarks.length, lang)}
          </span>
        </button>
      </div>

      {sidebarTab === 'pages' ? (
        <>
          {/* Quick Page Action Toolbar (A3 / A4) */}
          <div className="flex flex-wrap items-center justify-between gap-1 border-b border-slate-800 bg-slate-900 px-2.5 py-1.5 text-[11px]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => selectAllForPrint(true)}
                title={tr.sidebar.selectAll}
                className="rounded bg-slate-800 px-1.5 py-1 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                {lang === 'fa' ? 'همه' : 'All'}
              </button>
              <button
                type="button"
                onClick={() => selectAllForPrint(false)}
                title={tr.sidebar.selectNone}
                className="rounded bg-slate-800 px-1.5 py-1 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                {lang === 'fa' ? 'هیچ' : 'None'}
              </button>
              <button
                type="button"
                onClick={() => selectOddEvenForPrint('odd')}
                className="rounded bg-slate-800 px-1.5 py-1 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                {lang === 'fa' ? 'فرد' : 'Odd'}
              </button>
              <button
                type="button"
                onClick={() => selectOddEvenForPrint('even')}
                className="rounded bg-slate-800 px-1.5 py-1 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                {lang === 'fa' ? 'زوج' : 'Even'}
              </button>
              <button
                type="button"
                onClick={invertPrintSelection}
                title={lang === 'fa' ? 'معکوس کردن انتخاب چاپ' : 'Invert print selection'}
                className="rounded bg-slate-800 px-1.5 py-1 text-slate-300 hover:bg-slate-700 cursor-pointer"
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
                title={tr.sidebar.rotateRight}
                className="rounded bg-slate-800 p-1 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => duplicatePages(highlightedIds)}
                title={tr.sidebar.duplicate}
                className="rounded bg-slate-800 p-1 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => moveHighlightedPages('up')}
                title={lang === 'fa' ? 'انتقال صفحات انتخاب‌شده به بالا' : 'Move selected pages up'}
                aria-label={lang === 'fa' ? 'انتقال صفحات انتخاب‌شده به بالا' : 'Move selected pages up'}
                className="rounded bg-slate-800 p-1 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => moveHighlightedPages('down')}
                title={lang === 'fa' ? 'انتقال صفحات انتخاب‌شده به پایین' : 'Move selected pages down'}
                aria-label={lang === 'fa' ? 'انتقال صفحات انتخاب‌شده به پایین' : 'Move selected pages down'}
                className="rounded bg-slate-800 p-1 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => deletePages(highlightedIds)}
                title={tr.sidebar.deleteSelected}
                className="rounded bg-rose-500/15 p-1 text-rose-400 hover:bg-rose-500/25 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="border-b border-slate-800 px-3 py-1 text-[10px] text-slate-400" aria-live="polite">
            {dragIds.length ? (lang === 'fa' ? `در حال جابه‌جایی ${formatLocalizedNumber(dragIds.length,lang)} صفحه؛ روی نیمهٔ قبل یا بعد مقصد رها کنید.` : `Moving ${dragIds.length} page(s); drop on the before or after half of a thumbnail.`)
              : (lang === 'fa' ? 'برای جابه‌جایی بکشید؛ انتخاب چندتایی با Ctrl یا Shift.' : 'Drag to reorder; use Ctrl or Shift to select multiple pages.')}
          </div>

          {/* Grouped File & Page Thumbnail List */}
          <div ref={listRef} data-thumbnail-list className="flex-1 overflow-y-auto p-2 space-y-2.5">
            {pageRuns.map(({doc, documentId, name, items:docPages}) => {
              return (
                <div
                  key={`${documentId}:${docPages[0].page.id}`}
                  className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden"
                >
                  {/* Collapsible Document Group Header */}
                  <div className="flex items-center justify-between bg-slate-900/90 px-2.5 py-2 border-b border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => { if (doc) toggleDocumentCollapse(doc.id); }}
                      disabled={!doc}
                      className="flex items-center gap-1.5 text-start min-w-0 flex-1 cursor-pointer"
                    >
                      {doc?.collapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold text-slate-200">
                          {doc?.name ?? name}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
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
                      className="rounded-lg p-1 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Thumbnails inside Document Group */}
                  {!doc?.collapsed && (
                    <div className="grid grid-cols-2 gap-2 p-2">
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
                              highlightPage(page.id, false, false);
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                pageId: page.id,
                              });
                            }}
                            className={`group relative flex flex-col rounded-xl border p-1.5 transition cursor-pointer ${
                              page.isHighlighted
                                ? 'border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/40'
                                : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
                            } ${draggingSet.has(page.id) ? 'opacity-50' : !page.selectedForPrint ? 'opacity-45' : ''}`}
                          >
                            {/* Top Row: Checkbox + Global Page Index */}
                            <div className="mb-1 flex items-center justify-between">
                              <button
                                type="button"
                                draggable={false}
                                onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePageSelectedForPrint(page.id);
                                }}
                                className="flex items-center gap-1 text-[11px] font-bold text-slate-200 cursor-pointer"
                              >
                                {page.selectedForPrint ? (
                                  <CheckSquare className="h-3.5 w-3.5 text-sky-400" />
                                ) : (
                                  <Square className="h-3.5 w-3.5 text-slate-500" />
                                )}
                                <span>#{formatLocalizedNumber(globalIdx + 1, lang)}</span>
                              </button>

                              <div className="flex items-center gap-1">
                                {page.rotation !== 0 && (
                                  <span className="rounded bg-amber-500/20 px-1 text-[9px] font-bold text-amber-300">
                                    {page.rotation}°
                                  </span>
                                )}
                                {page.overrides?.invert && (
                                  <span className="rounded bg-fuchsia-500/25 px-1 text-[9px] font-bold text-fuchsia-300">
                                    INV
                                  </span>
                                )}
                                <span
                                  className={`h-2 w-2 rounded-full ${
                                    page.colorProfile === 'color'
                                      ? 'bg-sky-400'
                                      : page.colorProfile === 'grayscale'
                                        ? 'bg-slate-400'
                                        : 'bg-slate-700'
                                  }`}
                                  title={page.colorProfile}
                                />
                              </div>
                            </div>

                            {/* Thumbnail mirrors the actual cell placement, crop, rotation and effects. */}
                            {placement && <PageThumbnail page={page} cell={placement.cell} sheetWidth={placement.width} sheetHeight={placement.height} effects={effects} />}

                            {/* Bottom Info */}
                            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
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
              className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-start text-xs text-slate-200 hover:border-sky-500/40 hover:bg-slate-800/60 cursor-pointer"
            >
              <div className="flex items-center gap-2 truncate">
                <Bookmark className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                <span className="truncate font-semibold">{bm.title}</span>
              </div>
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                #{formatLocalizedNumber(bm.pageIndex + 1, lang)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Right-Click Context Menu for Page Operations (A4) */}
      {contextMenu && (
        <div
          style={{
            top: Math.min(window.innerHeight - 280, contextMenu.y),
            left: Math.min(window.innerWidth - 220, contextMenu.x),
          }}
          className="fixed z-50 w-56 rounded-xl border border-slate-700 bg-slate-900 p-1.5 text-xs text-slate-200 shadow-2xl"
        >
          <button
            type="button"
            onClick={() => {
              rotatePages([contextMenu.pageId], 90);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 cursor-pointer"
          >
            <RotateCw className="h-3.5 w-3.5 text-sky-400" />
            <span>{tr.sidebar.rotateRight}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              duplicatePages([contextMenu.pageId]);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 cursor-pointer"
          >
            <Copy className="h-3.5 w-3.5 text-emerald-400" />
            <span>{tr.sidebar.duplicate}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              makePageArray(contextMenu.pageId, 4);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 cursor-pointer"
          >
            <Layers className="h-3.5 w-3.5 text-amber-400" />
            <span>
              {lang === 'fa'
                ? 'تکرار آرایه‌ای ۴تایی (Make Array ×4)'
                : 'Make an Array (×4)'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              insertBlankPageAfter(contextMenu.pageId);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 cursor-pointer"
          >
            <FilePlus className="h-3.5 w-3.5 text-indigo-400" />
            <span>{tr.sidebar.insertBlank}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              togglePageInvertOverride(contextMenu.pageId);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 cursor-pointer"
          >
            <Contrast className="h-3.5 w-3.5 text-fuchsia-400" />
            <span>
              {lang === 'fa'
                ? 'معکوس رنگ فقط همین صفحه (Invert)'
                : 'Invert Only This Page'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              void exportMergedOrImposedPdf(true);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-slate-800 cursor-pointer"
          >
            <Scissors className="h-3.5 w-3.5 text-sky-400" />
            <span>{tr.sidebar.extractPdf}</span>
          </button>
          <div className="my-1 h-px bg-slate-800" />
          <button
            type="button"
            onClick={() => {
              deletePages([contextMenu.pageId]);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-rose-400 hover:bg-rose-500/15 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{lang === 'fa' ? 'حذف این صفحه' : 'Delete Page'}</span>
          </button>
        </div>
      )}
    </aside>
  );
};
