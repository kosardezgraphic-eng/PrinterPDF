import React, { useState } from 'react';
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
import { buildCssFilterForPage } from '../engine/effectsPipeline';
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
    settings,
    sidebarTab,
    setSidebarTab,
    togglePageSelectedForPrint,
    highlightPage,
    selectAllForPrint,
    selectOddEvenForPrint,
    reorderPage,
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

  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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
                title="Move Up"
                className="rounded bg-slate-800 p-1 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => moveHighlightedPages('down')}
                title="Move Down"
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

          {/* Grouped File & Page Thumbnail List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-2.5">
            {documents.map((doc) => {
              const docPages = pages
                .map((page, globalIdx) => ({ page, globalIdx }))
                .filter((item) => item.page.documentId === doc.id);

              if (docPages.length === 0) return null;

              return (
                <div
                  key={doc.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden"
                >
                  {/* Collapsible Document Group Header */}
                  <div className="flex items-center justify-between bg-slate-900/90 px-2.5 py-2 border-b border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => toggleDocumentCollapse(doc.id)}
                      className="flex items-center gap-1.5 text-start min-w-0 flex-1 cursor-pointer"
                    >
                      {doc.collapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold text-slate-200">
                          {doc.name}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                          <span>
                            {formatLocalizedNumber(docPages.length, lang)}{' '}
                            {lang === 'fa' ? 'صفحه' : 'pages'}
                          </span>
                          <span>•</span>
                          <span>{formatBytes(doc.fileSize)}</span>
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => removeDocument(doc.id)}
                      title={lang === 'fa' ? 'حذف این فایل از پروژه' : 'Remove file'}
                      className="rounded-lg p-1 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Thumbnails inside Document Group */}
                  {!doc.collapsed && (
                    <div className="grid grid-cols-2 gap-2 p-2">
                      {docPages.map(({ page, globalIdx }) => {
                        const cssFilter = buildCssFilterForPage(page, effects);
                        return (
                          <div
                            key={page.id}
                            draggable
                            onDragStart={() => setDragFromIdx(globalIdx)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                              if (dragFromIdx !== null && dragFromIdx !== globalIdx) {
                                reorderPage(dragFromIdx, globalIdx);
                              }
                              setDragFromIdx(null);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              highlightPage(page.id, e.ctrlKey || e.metaKey, e.shiftKey);
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
                            } ${!page.selectedForPrint ? 'opacity-45' : ''}`}
                          >
                            {/* Top Row: Checkbox + Global Page Index */}
                            <div className="mb-1 flex items-center justify-between">
                              <button
                                type="button"
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

                            {/* Thumbnail Image */}
                            <div className="relative flex h-28 items-center justify-center overflow-hidden rounded-lg bg-slate-950">
                              {page.thumbnailDataUrl && (
                                <img
                                  src={page.thumbnailDataUrl}
                                  alt={`Page ${globalIdx + 1}`}
                                  style={{
                                    filter: cssFilter,
                                    transform: `rotate(${page.rotation}deg)`,
                                  }}
                                  className="max-h-full max-w-full object-contain transition duration-150"
                                />
                              )}
                            </div>

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
