import type { CSSProperties } from 'react';
import type { EffectsSettings, PageItem, PageRotation } from '@shared/models';
import { buildCssFilterForPage } from '../engine/effectsPipeline';
import { pageCropFractions, rotateInsets } from '../engine/pageGeometry';

/** Identical crop and rotation mapping for the canvas and its sidebar preview. */
export function pageImageStyle(page: PageItem, rotation: PageRotation, width: number, height: number): CSSProperties {
  const crop = rotateInsets(pageCropFractions(page), rotation);
  const fullW = width / (1 - crop.left - crop.right);
  const fullH = height / (1 - crop.top - crop.bottom);
  const ninety = rotation % 180 !== 0;
  return {
    position: 'absolute',
    left: `${100 * fullW * (0.5 - crop.left) / width}%`,
    top: `${100 * fullH * (0.5 - crop.top) / height}%`,
    width: `${100 * (ninety ? fullH : fullW) / width}%`,
    height: `${100 * (ninety ? fullW : fullH) / height}%`,
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  };
}

export function PageContentImage({ page, effects, rotation, width, height }: {
  page: PageItem; effects: EffectsSettings; rotation: PageRotation; width: number; height: number;
}) {
  if (width <= 0 || height <= 0) return null;
  if (page.isBlankPage && page.sourcePageNumber === 0) return <div aria-hidden="true" className="absolute inset-0 bg-white" style={{ filter:buildCssFilterForPage(page, effects) }} />;
  if (!page.thumbnailDataUrl) return null;
  return <img draggable={false} src={page.thumbnailDataUrl} alt="" aria-hidden="true"
    style={{ ...pageImageStyle(page, rotation, width, height), filter: buildCssFilterForPage(page, effects) }}
    className="max-w-none select-none pointer-events-none" />;
}
