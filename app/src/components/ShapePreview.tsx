import React from 'react';
import type { PageOverlayShape, ShapeType } from '@shared/models';
import { MM_PER_PT, SHAPE_NAMES, shapeCommands, shapeHasFill, shapeSvgPath } from '../engine/shapes';

/**
 * The outline of a shape at a fixed size, centred inside its own SVG viewport.
 *
 * `shapeCommands` generates coordinates relative to `(0, 0)` spanning `[-w/2, +w/2]`, so the
 * `viewBox` MUST be centred at `(-size/2 - pad, -size/2 - pad)` — otherwise 75% of the icon spills
 * off the top-left corner. `rectangle`, `square`, and `rounded-rect` also get distinct icon box
 * proportions and corner radii so they are immediately distinguishable at a glance.
 */
export function ShapePreview({
  type,
  size = 22,
  className = '',
  shape,
  showColors = false,
}: {
  type: ShapeType;
  size?: number;
  className?: string;
  shape?: Partial<PageOverlayShape>;
  showColors?: boolean;
}) {
  const strokeWidthPx = Math.max(1.25, size / 14);
  const pad = strokeWidthPx + 1.2;
  const inner = Math.max(4, size - pad * 0.4);

  const boxWidth =
    type === 'rectangle' || type === 'rounded-rect'
      ? inner
      : type === 'arrow' || type === 'line'
        ? inner * 0.92
        : inner * 0.84;
  const boxHeight =
    type === 'rectangle'
      ? inner * 0.64
      : type === 'rounded-rect'
        ? inner * 0.68
        : type === 'arrow'
          ? shape?.lineOrientation === 'vertical'
            ? inner * 0.92
            : inner * 0.56
          : type === 'line'
            ? inner * 0.84
            : inner * 0.84;

  const iconRadius =
    type === 'rounded-rect'
      ? Math.max(2.2, Math.min(boxHeight * 0.34, shape?.borderRadius && shape.borderRadius > 0 ? shape.borderRadius : size * 0.16))
      : 0;

  const previewModel = {
    type,
    strokeWidth: 1,
    borderRadius: iconRadius,
    ...(shape?.sides !== undefined ? { sides: shape.sides } : {}),
    ...(shape?.innerRadiusPercent !== undefined ? { innerRadiusPercent: shape.innerRadiusPercent } : {}),
    ...(shape?.lineOrientation ? { lineOrientation: shape.lineOrientation } : {}),
    ...(shape?.arrowStyle ? { arrowStyle: shape.arrowStyle } : {}),
  } as PageOverlayShape;

  const d = shapeSvgPath(shapeCommands(previewModel, boxWidth, boxHeight, 1));
  const stroked = (shape?.strokeWidth ?? 1) * MM_PER_PT > 0;
  const vbHalf = size / 2 + pad;
  const vbSpan = size + pad * 2;

  const fillAttr =
    showColors && shape && shapeHasFill({ ...previewModel, fillColor: shape.fillColor ?? 'transparent' })
      ? shape.fillColor
      : 'none';
  const strokeAttr =
    showColors && shape?.strokeColor
      ? stroked
        ? shape.strokeColor
        : 'none'
      : 'currentColor';

  return (
    <svg
      data-shape-preview={type}
      width={size}
      height={size}
      viewBox={`${-vbHalf} ${-vbHalf} ${vbSpan} ${vbSpan}`}
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      style={{ display: 'block', overflow: 'hidden' }}
    >
      <path
        d={d}
        fill={fillAttr}
        fillRule="nonzero"
        stroke={strokeAttr}
        strokeWidth={strokeWidthPx}
        strokeLinejoin="round"
        strokeLinecap={stroked ? 'round' : 'butt'}
      />
    </svg>
  );
}

/** The label of a shape type, in the language the interface is in. */
export function shapeLabel(type: ShapeType, isFa: boolean): string {
  return SHAPE_NAMES[type][isFa ? 0 : 1];
}
