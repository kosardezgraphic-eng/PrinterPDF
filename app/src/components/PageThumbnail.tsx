import type { ComputedCellPlacement, EffectsSettings, PageItem } from '@shared/models';
import { PageContentImage } from './PageContentImage';

/** Show the content inside the same cell bounds used by the sheet preview. */
export function PageThumbnail({ page, cell, effects }: { page: PageItem; cell: ComputedCellPlacement; effects: EffectsSettings }) {
  const w = cell.cellWidthMm, h = cell.cellHeightMm;
  return <div className="relative flex h-28 items-center justify-center overflow-hidden rounded-lg bg-slate-950">
    <div className="relative overflow-hidden bg-white" style={{ width: `min(100%, ${7 * w / h}rem)`, aspectRatio: `${w} / ${h}` }}>
      <div data-thumbnail-content className="absolute overflow-hidden" style={{
        left: `${100 * (cell.contentXMm - cell.cellXMm) / w}%`, top: `${100 * (cell.contentYMm - cell.cellYMm) / h}%`,
        width: `${100 * cell.contentWidthMm / w}%`, height: `${100 * cell.contentHeightMm / h}%`,
      }}>
        <PageContentImage page={page} effects={effects} rotation={cell.effectiveRotation} width={cell.contentWidthMm} height={cell.contentHeightMm} />
      </div>
    </div>
  </div>;
}
