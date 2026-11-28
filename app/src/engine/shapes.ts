/**
 * Geometric shapes: one description of the outline, three renderers.
 *
 * A shape is an outline in the box the operator dragged — a rectangle on a corner, a circle behind a
 * price, an arrow at a fold line. What must never happen is the preview showing one shape and the
 * printed sheet showing another, so the geometry lives here once, in millimetres relative to the box's
 * centre, and the three consumers (the SVG the interactive preview paints, the canvas rasteriser, and
 * the vector operators written into the exported PDF) only map those numbers into their own units.
 *
 * Arcs are cubic Béziers, not SVG `A` commands: a Bézier is exact enough for a printed circle (the error
 * is 2.7e-4 of the radius), every renderer understands it, and the PDF path parser does not have to.
 */
import type { PageOverlayShape, ShapeType } from '@shared/models';

/** A point command in output units: x right, y down, origin at the centre of the box. */
export type ShapeCommand =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' };

export const MM_PER_PT = 25.4 / 72;
/** Kappa: the cubic-Bézier handle length as a fraction of the radius of a quarter arc. */
const KAPPA = 0.5522847498307936;

export const SHAPE_TYPES: ShapeType[] = [
  'rectangle', 'square', 'rounded-rect', 'circle', 'badge', 'triangle', 'diamond', 'polygon', 'star', 'line', 'arrow',
];

/** [Persian, English] labels, in the order the picker shows them. */
export const SHAPE_NAMES: Record<ShapeType, [string, string]> = {
  rectangle: ['مستطیل', 'Rectangle'],
  square: ['مربع', 'Square'],
  'rounded-rect': ['مستطیل گرد', 'Rounded rectangle'],
  circle: ['دایره', 'Circle'],
  badge: ['حلقه', 'Ring'],
  triangle: ['مثلث', 'Triangle'],
  diamond: ['لوزی', 'Diamond'],
  polygon: ['چندضلعی', 'Polygon'],
  star: ['ستاره', 'Star'],
  line: ['خط', 'Line'],
  arrow: ['پیکان', 'Arrow'],
};

/** Line and arrow are strokes; the rest can be filled, and a transparent fill means "outline only". */
export function shapeIsStrokedOnly(type: ShapeType): boolean {
  return type === 'line' || type === 'arrow';
}

export function shapeHasFill(shape: PageOverlayShape): boolean {
  return !shapeIsStrokedOnly(shape.type) && !!shape.fillColor && shape.fillColor !== 'transparent';
}

/** The style a freshly inserted shape of this type gets: black 1 pt outline, no fill. */
export function defaultShapeStyle(type: ShapeType): Omit<PageOverlayShape, 'id' | 'kind' | 'target' | 'targetScope' | 'targetPageIds' | 'targetSheetIndex' | 'xPercent' | 'yPercent' | 'widthPercent' | 'heightPercent' | 'opacity' | 'rotation'> {
  return {
    type,
    fillColor: 'transparent',
    strokeColor: '#000000',
    strokeWidth: 1,
    strokeStyle: 'solid',
    borderRadius: type === 'rounded-rect' ? 3 : 0,
    ...(type === 'polygon' ? { sides: 6 } : {}),
    ...(type === 'star' ? { sides: 5, innerRadiusPercent: 45 } : {}),
    ...(shapeIsStrokedOnly(type) ? { lineCap: 'round' as const } : {}),
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** A full ellipse as four cubic arcs; `reversed` winds it the other way, which is how a ring is cut. */
function ellipseCommands(cx: number, cy: number, rx: number, ry: number, reversed = false): ShapeCommand[] {
  const hx = rx * KAPPA, hy = ry * KAPPA;
  // Quarter arcs from the right-hand point, sweeping downward through the box's own space.
  const quarters = [
    { from: [cx + rx, cy], c1: [cx + rx, cy + hy], c2: [cx + hx, cy + ry], to: [cx, cy + ry] },
    { from: [cx, cy + ry], c1: [cx - hx, cy + ry], c2: [cx - rx, cy + hy], to: [cx - rx, cy] },
    { from: [cx - rx, cy], c1: [cx - rx, cy - hy], c2: [cx - hx, cy - ry], to: [cx, cy - ry] },
    { from: [cx, cy - ry], c1: [cx + hx, cy - ry], c2: [cx + rx, cy - hy], to: [cx + rx, cy] },
  ];
  // Walking the same quarters backwards, with each arc's ends and handles swapped, reverses the winding —
  // and a reversed subpath inside a filled outline is a hole under the non-zero fill rule.
  const path = reversed ? [...quarters].reverse().map(q => ({ from: q.to, c1: q.c2, c2: q.c1, to: q.from })) : quarters;
  const out: ShapeCommand[] = [{ op: 'M', x: round(path[0].from[0]), y: round(path[0].from[1]) }];
  for (const arc of path) {
    out.push({ op: 'C', x1: round(arc.c1[0]), y1: round(arc.c1[1]), x2: round(arc.c2[0]), y2: round(arc.c2[1]), x: round(arc.to[0]), y: round(arc.to[1]) });
  }
  out.push({ op: 'Z' });
  return out;
}

/**
 * Points of a regular polygon (or star) **filling** the box it was drawn in, first vertex pointing up.
 *
 * The vertices are placed on the circumscribed circle and then each axis is scaled by how far the outline
 * actually reaches on that axis. Without that step a pentagon in a 100×80 box stops 5 mm short of its left
 * and right edges (its widest points are not its top vertex) and a hexagon in a wide box looks pinched, so
 * the shape would not be the box the operator dragged. The scaling is per axis and around the centre, which
 * keeps the circumcentre — the point a rotated shape turns around — at the middle of the box.
 */
function polygonPoints(sides: number, halfW: number, halfH: number, innerPercent?: number): [number, number][] {
  const inner = innerPercent === undefined ? 1 : Math.max(0.1, Math.min(0.95, innerPercent / 100));
  const steps = innerPercent === undefined ? sides : sides * 2;
  const unit: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
    const radius = innerPercent === undefined || i % 2 === 0 ? 1 : inner;
    unit.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  const reach = (index: 0 | 1) => {
    const far = Math.max(...unit.map(point => Math.abs(point[index])));
    return far > 0 ? 1 / far : 1;
  };
  const scaleX = reach(0) * halfW, scaleY = reach(1) * halfH;
  return unit.map(([x, y]) => [round(x * scaleX), round(y * scaleY)] as [number, number]);
}

/**
 * The outline of a shape, in the units its box is measured in.
 *
 * `halfW`/`halfH` are half the box size, `unitsPerMm` scales anything the operator sets in millimetres
 * (a corner radius) into those units, so the same call feeds a pixel canvas and a PDF in points.
 */
export function shapeCommands(shape: PageOverlayShape, width: number, height: number, unitsPerMm = 1): ShapeCommand[] {
  const w = Math.max(0.0001, width), h = Math.max(0.0001, height);
  const halfW = w / 2, halfH = h / 2;
  const line = (points: [number, number][], close: boolean): ShapeCommand[] => [
    { op: 'M', x: round(points[0][0]), y: round(points[0][1]) },
    ...points.slice(1).map(([x, y]) => ({ op: 'L' as const, x: round(x), y: round(y) })),
    ...(close ? [{ op: 'Z' as const }] : []),
  ];
  switch (shape.type) {
    case 'rounded-rect': {
      const r = Math.max(0, Math.min(halfW, halfH, (shape.borderRadius || 0) * unitsPerMm));
      if (r <= 0.0001) return line([[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]], true);
      const k = r * KAPPA;
      const out: ShapeCommand[] = [{ op: 'M', x: round(-halfW + r), y: round(-halfH) }];
      // Straight edge, then a quarter arc, four times round the box. The handle is pulled in by kappa·r on
      // each side, which is what makes the arc a circle rather than a squashed oval.
      const corners = [
        { edge: [halfW - r, -halfH], c1: [halfW - r + k, -halfH], c2: [halfW, -halfH + r - k], end: [halfW, -halfH + r] },
        { edge: [halfW, halfH - r], c1: [halfW, halfH - r + k], c2: [halfW - r + k, halfH], end: [halfW - r, halfH] },
        { edge: [-halfW + r, halfH], c1: [-halfW + r - k, halfH], c2: [-halfW, halfH - r + k], end: [-halfW, halfH - r] },
        { edge: [-halfW, -halfH + r], c1: [-halfW, -halfH + r - k], c2: [-halfW + r - k, -halfH], end: [-halfW + r, -halfH] },
      ];
      for (const corner of corners) {
        out.push({ op: 'L', x: round(corner.edge[0]), y: round(corner.edge[1]) });
        out.push({ op: 'C', x1: round(corner.c1[0]), y1: round(corner.c1[1]), x2: round(corner.c2[0]), y2: round(corner.c2[1]), x: round(corner.end[0]), y: round(corner.end[1]) });
      }
      out.push({ op: 'Z' });
      return out;
    }
    case 'circle':
      return ellipseCommands(0, 0, halfW, halfH);
    case 'badge': {
      // A ring: the outer circle and a reversed inner one, so the fill rule leaves the middle open.
      const outer = ellipseCommands(0, 0, halfW, halfH);
      const innerRatio = 0.72;
      const inner = ellipseCommands(0, 0, halfW * innerRatio, halfH * innerRatio, true);
      return [...outer, ...inner];
    }
    case 'triangle':
      return line([[0, -halfH], [halfW, halfH], [-halfW, halfH]], true);
    case 'diamond':
      return line([[0, -halfH], [halfW, 0], [0, halfH], [-halfW, 0]], true);
    case 'polygon':
      return line(polygonPoints(clampSides(shape.sides, 6), halfW, halfH), true);
    case 'star':
      return line(polygonPoints(clampSides(shape.sides, 5), halfW, halfH, shape.innerRadiusPercent ?? 45), true);
    case 'line':
      if (shape.lineOrientation === 'vertical') return line([[0, -halfH], [0, halfH]], false);
      return line([[-halfW, 0], [halfW, 0]], false);
    case 'arrow': {
      // The head is built in physical units, so a long thin arrow does not grow a splayed tip.
      const isVertical = shape.lineOrientation === 'vertical';
      const isDouble = shape.arrowStyle === 'double';
      if (isVertical) {
        const head = Math.max(0.0001, Math.min(h * 0.3, w * 1.4));
        const cmds: ShapeCommand[] = [
          { op: 'M', x: 0, y: round(-halfH) },
          { op: 'L', x: 0, y: round(halfH) },
          { op: 'M', x: round(-head / 2), y: round(halfH - head) },
          { op: 'L', x: 0, y: round(halfH) },
          { op: 'L', x: round(head / 2), y: round(halfH - head) },
        ];
        if (isDouble) {
          cmds.push(
            { op: 'M', x: round(-head / 2), y: round(-halfH + head) },
            { op: 'L', x: 0, y: round(-halfH) },
            { op: 'L', x: round(head / 2), y: round(-halfH + head) },
          );
        }
        return cmds;
      }
      const head = Math.max(0.0001, Math.min(w * 0.3, h * 1.4));
      const cmds: ShapeCommand[] = [
        { op: 'M', x: round(-halfW), y: 0 },
        { op: 'L', x: round(halfW), y: 0 },
        { op: 'M', x: round(halfW - head), y: round(-head / 2) },
        { op: 'L', x: round(halfW), y: 0 },
        { op: 'L', x: round(halfW - head), y: round(head / 2) },
      ];
      if (isDouble) {
        cmds.push(
          { op: 'M', x: round(-halfW + head), y: round(-head / 2) },
          { op: 'L', x: round(-halfW), y: 0 },
          { op: 'L', x: round(-halfW + head), y: round(head / 2) },
        );
      }
      return cmds;
    }
    default:
      // `rectangle` and `square` are the same outline; the square differs by the ratio its panel and its
      // handles hold on to, which is what makes it the "square" button a print shop actually reaches for.
      return line([[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]], true);
  }
}

export function clampSides(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(3, Math.min(16, n));
}

/** SVG path data — what the preview's `<path>` and pdf-lib's path parser both consume. */
export function shapeSvgPath(commands: ShapeCommand[]): string {
  return commands.map((cmd) => {
    switch (cmd.op) {
      case 'M': return `M ${cmd.x} ${cmd.y}`;
      case 'L': return `L ${cmd.x} ${cmd.y}`;
      case 'C': return `C ${cmd.x1} ${cmd.y1} ${cmd.x2} ${cmd.y2} ${cmd.x} ${cmd.y}`;
      default: return 'Z';
    }
  }).join(' ');
}

/** The same outline on a 2D canvas, already translated so the origin is the centre of the box. */
export function applyShapeCommands(ctx: CanvasRenderingContext2D, commands: ShapeCommand[]): void {
  ctx.beginPath();
  for (const cmd of commands) {
    switch (cmd.op) {
      case 'M': ctx.moveTo(cmd.x, cmd.y); break;
      case 'L': ctx.lineTo(cmd.x, cmd.y); break;
      case 'C': ctx.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y); break;
      default: ctx.closePath();
    }
  }
}

/** Dash lengths for a stroke width, in that width's own units; `undefined` means a solid line. */
export function shapeDashPattern(style: PageOverlayShape['strokeStyle'] | undefined, lineWidth: number): number[] | undefined {
  if (lineWidth <= 0) return undefined;
  if (style === 'dashed') return [round(lineWidth * 4), round(lineWidth * 2)];
  if (style === 'dotted') return [round(lineWidth), round(lineWidth * 2)];
  if (style === 'dash-dot') return [round(lineWidth * 4), round(lineWidth * 1.5), round(lineWidth), round(lineWidth * 1.5)];
  return undefined;
}

export const SHAPE_STROKE_STYLES: PageOverlayShape['strokeStyle'][] = ['solid', 'dashed', 'dotted', 'dash-dot'];
export const SHAPE_LINE_CAPS: NonNullable<PageOverlayShape['lineCap']>[] = ['butt', 'round', 'square'];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * A colour the three renderers can agree on. Only `#rgb`, `#rrggbb` and `transparent` are accepted,
 * because a `url(#gradient)` or an `expression()` in a project file would otherwise be handed straight
 * to the SVG the preview paints. Anything else falls back to black, which is what a print shop expects
 * from an unset colour anyway.
 */
export function sanitizeShapeColor(value: unknown, fallback = '#000000'): string {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().toLowerCase();
  if (text === 'transparent' || text === 'none') return 'transparent';
  if (!HEX.test(text)) return fallback;
  if (text.length === 4) return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  return text;
}

/** [0..1] components of a sanitised colour, for the PDF's `rgb()`; `null` for `transparent`. */
export function shapeColorComponents(color: string): [number, number, number] | null {
  const hex = sanitizeShapeColor(color);
  if (hex === 'transparent') return null;
  const digits = hex.slice(1);
  return [0, 2, 4].map(i => Math.max(0, Math.min(1, parseInt(digits.slice(i, i + 2), 16) / 255))) as [number, number, number];
}

const numberWithin = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, n));
};

/**
 * Clamps a style patch to what the renderers can draw. Project files are JSON a person may have edited,
 * and a `strokeWidth: -4` or `sides: 900` must not reach a path.
 */
export function normalizeShapeStyle(patch: Partial<PageOverlayShape>): Partial<PageOverlayShape> {
  const out: Partial<PageOverlayShape> = { ...patch };
  if (out.fillColor !== undefined) out.fillColor = sanitizeShapeColor(out.fillColor, 'transparent');
  if (out.strokeColor !== undefined) out.strokeColor = sanitizeShapeColor(out.strokeColor);
  if (out.strokeWidth !== undefined) out.strokeWidth = numberWithin(out.strokeWidth, 0, 24, 1);
  if (out.borderRadius !== undefined) out.borderRadius = numberWithin(out.borderRadius, 0, 200, 0);
  if (out.opacity !== undefined) out.opacity = numberWithin(out.opacity, 0.05, 1, 1);
  if (out.rotation !== undefined) out.rotation = ((numberWithin(out.rotation, -3600, 3600, 0) % 360) + 360) % 360;
  if (out.sides !== undefined) out.sides = clampSides(out.sides, 6);
  if (out.innerRadiusPercent !== undefined) out.innerRadiusPercent = numberWithin(out.innerRadiusPercent, 10, 95, 45);
  if (out.strokeStyle !== undefined && !SHAPE_STROKE_STYLES.includes(out.strokeStyle)) out.strokeStyle = 'solid';
  if (out.lineCap !== undefined && !SHAPE_LINE_CAPS.includes(out.lineCap)) out.lineCap = 'butt';
  if (out.lineOrientation !== undefined && out.lineOrientation !== 'horizontal' && out.lineOrientation !== 'vertical') {
    out.lineOrientation = 'horizontal';
  }
  if (out.arrowStyle !== undefined && out.arrowStyle !== 'single' && out.arrowStyle !== 'double') {
    out.arrowStyle = 'single';
  }
  return out;
}

/** Everything the panel and the store need to know about a type, in one lookup. */
export function shapeCapabilities(type: ShapeType) {
  return {
    /** A corner radius the operator can set (only a rounded rectangle has one). */
    radius: type === 'rounded-rect',
    /** A vertex count (a polygon) or point count (a star). */
    sides: type === 'polygon' || type === 'star',
    /** How deep a star's waist is. */
    inner: type === 'star',
    /** Filling the outline, which a line and an arrow have no use for. */
    fill: !shapeIsStrokedOnly(type),
    /** How the ends of an open stroke are cut. */
    cap: shapeIsStrokedOnly(type),
    /** Horizontal or vertical axis toggle for lines and arrows. */
    orientation: shapeIsStrokedOnly(type),
    /** Single vs double arrowheads. */
    arrow: type === 'arrow',
    /** Round shapes look wrong when stretched, so the picker starts them with the ratio locked. */
    lockAspect: type === 'circle' || type === 'badge' || type === 'polygon' || type === 'star'
      || type === 'diamond' || type === 'square',
  };
}
