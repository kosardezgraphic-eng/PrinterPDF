import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ComputedCellPlacement,
  ComputedSheetSide,
  EffectsSettings,
  LayoutSettings,
  PageItem,
  PageNumberSettings,
  WatermarkSettings,
} from '@shared/models';
import { eraseMaskCss, erasePaintCss } from '../engine/imageErase';
import { PREVIEW_PX_PER_MM } from '../engine/viewNavigation';
import { formatPageNumberLabel, resolveTextMacros } from '../engine/watermarkEngine';
import { PageContentImage } from './PageContentImage';
import { TextOverlayLayer } from './TextOverlayLayer';

interface PageThumbnailProps {
  page: PageItem;
  cell: ComputedCellPlacement;
  effects: EffectsSettings;
  sheetWidth: number;
  sheetHeight: number;
  sizePx?: number;
  sheet?: ComputedSheetSide;
  totalSheets?: number;
  pages?: PageItem[];
  pageIndices?: Map<string, number>;
  layout?: LayoutSettings;
  watermark?: WatermarkSettings;
  pageNumbering?: PageNumberSettings;
  userName?: string;
}

/** Show the content and all sheet/page edits inside the same bounds used by the sheet preview. */
export function PageThumbnail({
  page,
  cell,
  effects,
  sheetWidth,
  sheetHeight,
  sizePx = 112,
  sheet,
  totalSheets,
  pages,
  pageIndices,
  layout,
  watermark,
  pageNumbering,
  userName = '',
}: PageThumbnailProps) {
  // A moved object is shown relative to the whole sheet rather than cropped to its old cell.
  const w = cell.allowOverflow ? sheetWidth : cell.cellWidthMm;
  const h = cell.allowOverflow ? sheetHeight : cell.cellHeightMm;
  const viewXMm = cell.allowOverflow ? 0 : cell.cellXMm;
  const viewYMm = cell.allowOverflow ? 0 : cell.cellYMm;
  const x = cell.allowOverflow ? cell.contentXMm : cell.contentXMm - cell.cellXMm;
  const y = cell.allowOverflow ? cell.contentYMm : cell.contentYMm - cell.cellYMm;

  const sheetBoxRef = useRef<HTMLDivElement>(null);
  const [measuredWidthPx, setMeasuredWidthPx] = useState(0);

  useLayoutEffect(() => {
    const el = sheetBoxRef.current;
    if (!el) return;
    const measure = () => {
      const next = el.getBoundingClientRect().width;
      if (next > 0) setMeasuredWidthPx(prev => (Math.abs(prev - next) > 0.5 ? next : prev));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? el.getBoundingClientRect().width;
      if (next > 0) setMeasuredWidthPx(prev => (Math.abs(prev - next) > 0.5 ? next : prev));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [sizePx, w, h]);

  const fallbackWidthPx = (sizePx * w) / Math.max(1, h);
  const boxWidthPx = measuredWidthPx > 0 ? measuredWidthPx : fallbackWidthPx;
  const thumbPxPerMm = boxWidthPx / Math.max(1, w);
  const previewScale = thumbPxPerMm / PREVIEW_PX_PER_MM;

  const pageEraseBox = useMemo(
    () => ({
      width: Math.max(1, cell.contentWidthMm * thumbPxPerMm),
      height: Math.max(1, cell.contentHeightMm * thumbPxPerMm),
      widthMm: Math.max(0.01, cell.contentWidthMm),
      heightMm: Math.max(0.01, cell.contentHeightMm),
    }),
    [cell.contentWidthMm, cell.contentHeightMm, thumbPxPerMm],
  );
  const pageEraseMask = useMemo(() => eraseMaskCss(page.erase, pageEraseBox), [page.erase, pageEraseBox]);
  const pageErasePaint = useMemo(() => erasePaintCss(page.erase, pageEraseBox), [page.erase, pageEraseBox]);

  const effectiveSheet = useMemo<ComputedSheetSide>(
    () =>
      sheet ?? {
        sheetNumber: 1,
        side: 'front',
        sideIndex: 1,
        widthMm: sheetWidth,
        heightMm: sheetHeight,
        cells: [cell],
      },
    [sheet, sheetWidth, sheetHeight, cell],
  );
  const effectivePages = useMemo(() => pages ?? [page], [pages, page]);
  const effectivePageIndices = useMemo(
    () => pageIndices ?? new Map([[page.id, 1]]),
    [pageIndices, page.id],
  );
  const effectiveTotalSheets = Math.max(1, totalSheets ?? 1);

  const firstPopulatedPage = effectiveSheet.cells.find((c) => c.page !== null)?.page ?? page;
  const resolvedWatermarkText = watermark?.enabled
    ? resolveTextMacros(watermark.text, {
        pageNumber: firstPopulatedPage.sourcePageNumber ?? effectiveSheet.sideIndex,
        totalPages: effectivePages.length,
        sheetNumber: effectiveSheet.sheetNumber,
        totalSheets: effectiveTotalSheets,
        fileName: firstPopulatedPage.documentName ?? 'PrintStudio',
        userName,
      })
    : '';

  const pageNumText = pageNumbering?.enabled
    ? formatPageNumberLabel(pageNumbering, effectiveSheet.sideIndex, effectiveTotalSheets)
    : '';

  return (
    <div data-thumbnail-box className="relative flex items-center justify-center overflow-hidden rounded-lg bg-slate-950" style={{ height: `${sizePx}px` }}>
      <div ref={sheetBoxRef} data-color-accurate className="relative overflow-hidden bg-white" style={{ width: `min(100%, ${(sizePx * w) / h}px)`, aspectRatio: `${w} / ${h}` }}>
        <div
          data-thumbnail-content
          className="absolute overflow-hidden"
          style={{
            left: `${(100 * x) / w}%`,
            top: `${(100 * y) / h}%`,
            width: `${(100 * cell.contentWidthMm) / w}%`,
            height: `${(100 * cell.contentHeightMm) / h}%`,
            transform: `rotate(${cell.transform?.rotationDeg ?? 0}deg)`,
          }}
        >
          <div
            className="absolute inset-0"
            style={
              pageEraseMask
                ? {
                    maskImage: pageEraseMask,
                    WebkitMaskImage: pageEraseMask,
                    maskSize: '100% 100%',
                    WebkitMaskSize: '100% 100%',
                    maskRepeat: 'no-repeat',
                    WebkitMaskRepeat: 'no-repeat',
                    maskPosition: '0 0',
                    WebkitMaskPosition: '0 0',
                    maskMode: 'alpha',
                  }
                : undefined
            }
          >
            <PageContentImage page={page} effects={effects} rotation={cell.effectiveRotation} width={cell.contentWidthMm} height={cell.contentHeightMm} />
          </div>
          {pageErasePaint && (
            <div
              aria-hidden="true"
              data-thumbnail-page-paint
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: pageErasePaint,
                backgroundSize: '100% 100%',
                backgroundRepeat: 'no-repeat',
              }}
            />
          )}
        </div>

        {/* Full-sheet overlay coordinate space mapped onto the thumbnail viewport */}
        <div
          data-thumbnail-overlays
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            left: `${(-100 * viewXMm) / Math.max(1, w)}%`,
            top: `${(-100 * viewYMm) / Math.max(1, h)}%`,
            width: `${(100 * sheetWidth) / Math.max(1, w)}%`,
            height: `${(100 * sheetHeight) / Math.max(1, h)}%`,
          }}
        >
          {(layout?.showCellBorders || layout?.showCropMarks) && (
            <div
              style={{
                left: cell.cellXMm * thumbPxPerMm,
                top: cell.cellYMm * thumbPxPerMm,
                width: cell.cellWidthMm * thumbPxPerMm,
                height: cell.cellHeightMm * thumbPxPerMm,
              }}
              className={`pointer-events-none absolute ${layout?.showCellBorders ? 'border border-slate-300/80' : ''}`}
            >
              {layout?.showCropMarks && (
                <>
                  <span className="absolute -top-1 -left-1 h-1 w-1 border-r border-b border-slate-800" />
                  <span className="absolute -top-1 -right-1 h-1 w-1 border-l border-b border-slate-800" />
                  <span className="absolute -bottom-1 -left-1 h-1 w-1 border-r border-t border-slate-800" />
                  <span className="absolute -bottom-1 -right-1 h-1 w-1 border-l border-t border-slate-800" />
                </>
              )}
            </div>
          )}

          <TextOverlayLayer
            sheet={effectiveSheet}
            totalSheets={effectiveTotalSheets}
            pages={effectivePages}
            pageIndices={effectivePageIndices}
            pxPerMm={thumbPxPerMm}
            enabled={false}
            thumbnailMode
            thumbnailPageId={page.id}
            thumbnailOccurrenceKey={cell.occurrenceKey ?? String(cell.cellIndex)}
          />

          {watermark?.enabled && resolvedWatermarkText && (
            <div
              data-thumbnail-watermark
              style={{ opacity: watermark.opacity }}
              className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
            >
              {watermark.tiled ? (
                <div
                  className="grid grid-cols-3"
                  style={{ gap: `${40 * previewScale}px`, padding: `${16 * previewScale}px` }}
                >
                  {Array.from({ length: 9 }, (_, tIdx) => (
                    <span
                      key={tIdx}
                      style={{
                        color: watermark.colorHex,
                        transform: `rotate(${watermark.rotationDeg}deg)`,
                        fontSize: `${Math.max(4, Math.max(11, watermark.fontSizePt * 0.55) * previewScale)}px`,
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
                    fontSize: `${Math.max(5, Math.max(16, watermark.fontSizePt * 0.9) * previewScale)}px`,
                  }}
                  className="font-black tracking-wide whitespace-nowrap select-none"
                >
                  {resolvedWatermarkText}
                </span>
              )}
            </div>
          )}

          {pageNumbering?.enabled && pageNumText && (
            <div
              data-thumbnail-legacy-numbering
              style={{ bottom: Math.max(1, pageNumbering.marginMm * thumbPxPerMm * 0.6) }}
              className="pointer-events-none absolute inset-x-0 z-10 flex justify-center"
            >
              <span
                style={{
                  fontSize: `${Math.max(5, 10 * previewScale)}px`,
                  paddingInline: `${Math.max(2, 8 * previewScale)}px`,
                  paddingBlock: `${Math.max(1, 2 * previewScale)}px`,
                }}
                className="rounded bg-white/85 font-mono font-bold text-slate-700 shadow-xs"
              >
                {pageNumText}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
