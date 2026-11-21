import type { LayoutSettings, MarginsMm, PrinterInfo, PrinterMarginResult } from '@shared/models';

export type Guide =
  | { type: 'margin'; side: 'left' | 'right' | 'top' | 'bottom' }
  | { type: 'gutter'; axis: 'horizontal' | 'vertical'; index: number; edge?: 'leading' | 'trailing' | 'center' };
export interface Point { x: number; y: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));

export function resolvePrinterMinMargins(
  printerMargins: PrinterMarginResult | { status: 'loading' },
  activePrinter?: Pick<PrinterInfo, 'activeProfile' | 'capabilities'> | null,
): MarginsMm | undefined {
  if (printerMargins.status !== 'available') return undefined;
  if (activePrinter?.activeProfile?.borderless && activePrinter.capabilities?.supportsBorderless) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  return {
    top: Math.max(0, printerMargins.marginsMm.top),
    right: Math.max(0, printerMargins.marginsMm.right),
    bottom: Math.max(0, printerMargins.marginsMm.bottom),
    left: Math.max(0, printerMargins.marginsMm.left),
  };
}

export function clampMarginsToMin(margins: MarginsMm, minMargins?: Partial<MarginsMm>): MarginsMm {
  return {
    top: Math.max(Math.max(0, minMargins?.top ?? 0), Math.max(0, margins.top)),
    right: Math.max(Math.max(0, minMargins?.right ?? 0), Math.max(0, margins.right)),
    bottom: Math.max(Math.max(0, minMargins?.bottom ?? 0), Math.max(0, margins.bottom)),
    left: Math.max(Math.max(0, minMargins?.left ?? 0), Math.max(0, margins.left)),
  };
}

/** Use sheet coordinates in mm; gutters expand/shrink symmetrically from their center or track the dragged edge. */
export function moveLayoutGuide(
  layout: LayoutSettings,
  sheet: { widthMm: number; heightMm: number },
  guide: Guide,
  dx: number,
  dy: number,
  minMargins?: Partial<MarginsMm>,
): LayoutSettings {
  const rows = Math.max(1, Math.min(50, Math.floor(layout.rows)));
  const cols = Math.max(1, Math.min(50, Math.floor(layout.cols)));
  const margins = layout.marginsMm;
  if (guide.type === 'margin') {
    const horizontal = guide.side === 'left' || guide.side === 'right';
    const opposite = {left:'right',right:'left',top:'bottom',bottom:'top'} as const;
    const count = horizontal ? cols : rows;
    const gutter = horizontal ? layout.horizontalGutterMm : layout.verticalGutterMm;
    const length = horizontal ? sheet.widthMm : sheet.heightMm;
    const delta = horizontal ? dx : dy;
    const sign = guide.side === 'right' || guide.side === 'bottom' ? -1 : 1;
    const min = Math.max(0, minMargins?.[guide.side] ?? 0);
    const max = length - margins[opposite[guide.side]] - Math.max(10, 5 * count + Math.max(0, gutter) * (count - 1));
    return { ...layout, marginsMm: { ...margins, [guide.side]: clamp(margins[guide.side] + sign * delta, min, max) } };
  }
  const horizontal = guide.axis === 'horizontal';
  const count = horizontal ? cols : rows;
  if (count <= 1 || guide.index < 0 || guide.index >= count - 1) return layout;
  const available = horizontal ? sheet.widthMm - margins.left - margins.right : sheet.heightMm - margins.top - margins.bottom;
  const max = (available - count * 5) / (count - 1);
  const delta = horizontal ? dx : dy;
  const key = horizontal ? 'horizontalGutterMm' : 'verticalGutterMm';
  const edge = guide.edge ?? 'trailing';
  const gutterDelta =
    edge === 'center'
      ? delta * 2
      : edge === 'leading'
        ? (-delta * count) / (count - guide.index - 1)
        : (delta * count) / (guide.index + 1);
  return { ...layout, [key]: clamp(layout[key] + gutterDelta, 0, max) };
}

export function measureEndpoint(start: Point, end: Point, shift: boolean): Point {
  if (!shift) return end;
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? { x:end.x, y:start.y } : { x:start.x, y:end.y };
}
export function measurement(start: Point, end: Point) {
  const dx = end.x - start.x, dy = end.y - start.y;
  return { dx, dy, distance: Math.hypot(dx, dy) };
}
