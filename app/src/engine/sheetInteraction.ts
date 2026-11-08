import type { LayoutSettings } from '@shared/models';

export type Guide = { type: 'margin'; side: 'left' | 'right' | 'top' | 'bottom' }
  | { type: 'gutter'; axis: 'horizontal' | 'vertical'; index: number };
export interface Point { x: number; y: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));

/** Use sheet coordinates in mm; gutter handles follow the trailing edge of each gap. */
export function moveLayoutGuide(layout: LayoutSettings, sheet: { widthMm: number; heightMm: number }, guide: Guide, dx: number, dy: number): LayoutSettings {
  const rows = Math.max(1, Math.min(10, Math.floor(layout.rows)));
  const cols = Math.max(1, Math.min(10, Math.floor(layout.cols)));
  const margins = layout.marginsMm;
  if (guide.type === 'margin') {
    const horizontal = guide.side === 'left' || guide.side === 'right';
    const opposite = {left:'right',right:'left',top:'bottom',bottom:'top'} as const;
    const count = horizontal ? cols : rows;
    const gutter = horizontal ? layout.horizontalGutterMm : layout.verticalGutterMm;
    const length = horizontal ? sheet.widthMm : sheet.heightMm;
    const delta = horizontal ? dx : dy;
    const sign = guide.side === 'right' || guide.side === 'bottom' ? -1 : 1;
    const max = length - margins[opposite[guide.side]] - Math.max(10, 5 * count + Math.max(0, gutter) * (count - 1));
    return { ...layout, marginsMm: { ...margins, [guide.side]: clamp(margins[guide.side] + sign * delta, 0, max) } };
  }
  const horizontal = guide.axis === 'horizontal';
  const count = horizontal ? cols : rows;
  if (count <= 1 || guide.index < 0 || guide.index >= count - 1) return layout;
  const available = horizontal ? sheet.widthMm - margins.left - margins.right : sheet.heightMm - margins.top - margins.bottom;
  const max = (available - count * 5) / (count - 1);
  const delta = horizontal ? dx : dy;
  const key = horizontal ? 'horizontalGutterMm' : 'verticalGutterMm';
  return { ...layout, [key]: clamp(layout[key] + delta * count / (guide.index + 1), 0, max) };
}

export function measureEndpoint(start: Point, end: Point, shift: boolean): Point {
  if (!shift) return end;
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? { x:end.x, y:start.y } : { x:start.x, y:end.y };
}
export function measurement(start: Point, end: Point) {
  const dx = end.x - start.x, dy = end.y - start.y;
  return { dx, dy, distance: Math.hypot(dx, dy) };
}
