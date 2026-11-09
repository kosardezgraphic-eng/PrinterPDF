import type { ComputedCellPlacement, EffectsSettings, PageItem } from '@shared/models';
import { PageContentImage } from './PageContentImage';

/** Show the content inside the same cell bounds used by the sheet preview. */
export function PageThumbnail({ page, cell, effects, sheetWidth, sheetHeight }: { page: PageItem; cell: ComputedCellPlacement; effects: EffectsSettings; sheetWidth: number; sheetHeight: number }) {
  // A moved object is shown relative to the whole sheet rather than cropped to its old cell.
  const w = cell.allowOverflow ? sheetWidth : cell.cellWidthMm, h = cell.allowOverflow ? sheetHeight : cell.cellHeightMm;
  const x = cell.allowOverflow ? cell.contentXMm : cell.contentXMm - cell.cellXMm;
  const y = cell.allowOverflow ? cell.contentYMm : cell.contentYMm - cell.cellYMm;
  return <div className="relative flex h-28 items-center justify-center overflow-hidden rounded-lg bg-slate-950">
    <div data-color-accurate className="relative overflow-hidden bg-white" style={{ width: `min(100%, ${7 * w / h}rem)`, aspectRatio: `${w} / ${h}` }}>
      <div data-thumbnail-content className="absolute overflow-hidden" style={{
        left: `${100 * x / w}%`, top: `${100 * y / h}%`,
        width: `${100 * cell.contentWidthMm / w}%`, height: `${100 * cell.contentHeightMm / h}%`,
      }}>
        <PageContentImage page={page} effects={effects} rotation={cell.effectiveRotation} width={cell.contentWidthMm} height={cell.contentHeightMm} />
      </div>
    </div>
  </div>;
}
