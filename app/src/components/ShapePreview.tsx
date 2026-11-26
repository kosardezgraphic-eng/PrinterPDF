import React from 'react';
import type { PageOverlayShape, ShapeType } from '@shared/models';
import { MM_PER_PT, SHAPE_NAMES, shapeCommands, shapeSvgPath } from '../engine/shapes';

/**
 * The outline of a shape at a fixed size, used wherever the interface has to *show* a shape rather than
 * describe it: the picker in the ribbon and the type row of the shape panel. It draws the same command list
 * the preview and the exported PDF draw, so a button that looks like a star inserts a star.
 */
export function ShapePreview({ type, size = 22, className = '', shape }: { type: ShapeType; size?: number; className?: string; shape?: Partial<PageOverlayShape> }) {
  const d = shapeSvgPath(shapeCommands({ type, strokeWidth: 1, borderRadius: 0, ...shape } as PageOverlayShape, size, size, 1));
  const stroked = (shape?.strokeWidth ?? 1) * MM_PER_PT > 0;
  return (
    <svg data-shape-preview={type} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true"
      className={className} style={{ display: 'block', overflow: 'visible' }}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={Math.max(1, size / 16)} strokeLinejoin="round"
        strokeLinecap={stroked ? 'round' : 'butt'} />
    </svg>
  );
}

/** The label of a shape type, in the language the interface is in. */
export function shapeLabel(type: ShapeType, isFa: boolean): string {
  return SHAPE_NAMES[type][isFa ? 0 : 1];
}
