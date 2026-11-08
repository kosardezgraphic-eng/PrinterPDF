import React, { useRef, useState } from 'react';
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
  ShieldCheck,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { t } from '../i18n/translations';
import {
  computeImpositionSheets,
  convertMmToUnit,
} from '../engine/layoutEngine';
import { buildCssFilterForPage } from '../engine/effectsPipeline';
import {
  formatPageNumberLabel,
  resolveTextMacros,
} from '../engine/watermarkEngine';
import { formatLocalizedNumber } from '../i18n/shamsi';
import type { ComputedSheetSide, PrinterInfo } from '@shared/models';

interface PreviewWorkspaceProps {
  onCursorMoveMm: (pos: { x: number; y: number } | null) => void;
}

export const PreviewWorkspace: React.FC<PreviewWorkspaceProps> = ({
  onCursorMoveMm,
}) => {
  const {
    pages,
    layout,
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
    setZoomPercent,
    importFiles,
    loadSampleWorkspace,
    highlightPage,
    selectPrinter,
    setDefaultPrinter,
    simulatePrinterStatusChange,
    controlSpoolerJob,
    purgePrinterQueue,
    removeBatchJob,
  } = useAppStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [loupeCoords, setLoupeCoords] = useState<{
    xPercent: number;
    yPercent: number;
  } | null>(null);

  const lang = settings.language;
  const tr = t(lang);

  const sheets = computeImpositionSheets(pages, layout);
  const safeSheetIdx = Math.min(
    Math.max(0, activeSheetIndex),
    Math.max(0, sheets.length - 1)
  );

  // Determine which sheets to render based on viewMode
  const visibleSheets: ComputedSheetSide[] =
    viewMode === 'grid'
      ? sheets
      : viewMode === 'double'
        ? sheets.slice(safeSheetIdx, safeSheetIdx + 2)
        : sheets.slice(safeSheetIdx, safeSheetIdx + 1);

  const basePxPerMm = 1.95 * (zoomPercent / 100);

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
        className="flex flex-col items-center gap-2"
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

                const contentLeft = cell.contentXMm * basePxPerMm;
                const contentTop = cell.contentYMm * basePxPerMm;
                const contentW = cell.contentWidthMm * basePxPerMm;
                const contentH = cell.contentHeightMm * basePxPerMm;

                const cssFilter = cell.page
                  ? buildCssFilterForPage(cell.page, effects)
                  : 'none';

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

                    {/* Rendered Page Content inside Cell */}
                    {cell.page && (
                      <div
                        onClick={() => highlightPage(cell.page!.id)}
                        style={{
                          left: contentLeft,
                          top: contentTop,
                          width: contentW,
                          height: contentH,
                        }}
                        className={`absolute overflow-hidden transition cursor-pointer ${
                          cell.page.isHighlighted
                            ? 'ring-2 ring-sky-500'
                            : 'hover:ring-1 hover:ring-sky-400/60'
                        }`}
                      >
                        {cell.page.thumbnailDataUrl && (
                          <img
                            src={cell.page.thumbnailDataUrl}
                            alt={`Cell ${cell.cellIndex + 1}`}
                            style={{
                              filter: cssFilter,
                              transform: `rotate(${cell.effectiveRotation}deg)`,
                            }}
                            className="h-full w-full object-fill select-none"
                          />
                        )}
                      </div>
                    )}
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
      onWheel={(e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 10 : -10;
          setZoomPercent(zoomPercent + delta);
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
              onClick={() => setActiveSheetIndex(safeSheetIdx - 1)}
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
              onClick={() => setActiveSheetIndex(safeSheetIdx + 1)}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200 hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
            >
              <span>{lang === 'fa' ? 'شیت بعدی' : 'Next Sheet'}</span>
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              {lang === 'fa'
                ? 'پردازش ۱۰۰٪ آفلاین • WYSIWYG برداری'
                : '100% Offline • Vector WYSIWYG'}
            </span>
          </div>
        </div>
      )}

      {/* Main Sheet Preview Canvas Area */}
      <div className="flex-1 overflow-auto p-6">
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
            className={`flex min-h-full items-center justify-center gap-8 ${
              viewMode === 'grid' ? 'flex-wrap' : 'flex-col md:flex-row'
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
