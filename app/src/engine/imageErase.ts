/**
 * Erasing part of a picture: the geometry, in one place, for the screen and for the paper.
 *
 * An erase is stored as a list of gestures on the overlay (see `EraseShape` in `shared/models.ts`) and only
 * ever *derived* into pixels — a CSS mask for the preview, a `destination-out` paint for the raster the
 * exported PDF embeds. That is what makes "delete a bit of this logo" reversible: the picture's own bytes are
 * never rewritten, so a further stroke adds to the list, "one stroke back" takes one away, and "restore"
 * empties the list instead of reloading artwork from disk.
 *
 * Percentages are of the picture's **fit rectangle** — the part of the box the artwork covers — because that
 * is the rectangle the pointer paints on and the one the mask is clipped to. A hole therefore stays on the logo
 * it belongs to even when a `contain` letterbox or a resize moves the picture inside its box. A brush radius is in millimetres and is converted per axis at paint time, which is why
 * the brush feels the same size at any zoom and stays round on the sheet — the ellipse it becomes inside a
 * stretched picture is exactly what the operator saw.
 */
import { sanitizeEraseShapes, type EraseShape } from '@shared/models';

export type EraseTool = 'off' | 'brush' | 'region';

/**
 * Two samples closer than this (percent of the fit rectangle) are the same dot.
 *
 * A pointermove arrives far faster than the eye can see a new dot, and every point is stored in the project
 * file and repeated in each undo snapshot — an un-sampled 400 px drag would bankroll thousands of identical
 * ellipses for the rest of the session.
 */
export const ERASE_SAMPLE_PERCENT = 0.3;

/** A region smaller than this on either axis was a click, not a marquee. */
export const ERASE_REGION_MIN_PERCENT = 0.4;

/**
 * The fit rectangle, in the unit the caller paints in *and* in millimetres.
 *
 * Both are needed because a marquee is geometric (percent of the rectangle) while a brush is physical (a
 * radius in millimetres), and the two only agree once the rectangle's real size is known.
 */
export interface ErasePaintBox {
  width: number; height: number;
  widthMm: number; heightMm: number;
}

export interface EraseParts {
  /** Brush dots: one ellipse per sampled point. */
  holes: { cx: number; cy: number; rx: number; ry: number }[];
  /** Marquee regions. */
  rects: { x: number; y: number; width: number; height: number }[];
}

/** The shape a drag starts with: one dot for a brush, a zero-sized rectangle for a marquee. */
export function beginEraseShape(tool: Exclude<EraseTool, 'off'>, at: { x: number; y: number }, radiusMm: number): EraseShape {
  return tool === 'brush'
    ? { mode: 'brush', radiusMm, points: [{ x: at.x, y: at.y }] }
    : { mode: 'region', x: at.x, y: at.y, width: 0, height: 0 };
}

/**
 * Grows the shape as the pointer moves. `anchor` is where the drag began — a marquee is rebuilt from it
 * rather than translated, so dragging back across the start gives a rectangle on the other side the way every
 * selection tool does.
 */
export function growEraseShape(
  shape: EraseShape,
  anchor: { x: number; y: number },
  to: { x: number; y: number }
): EraseShape {
  if (shape.mode === 'region') {
    return {
      ...shape,
      x: Math.min(anchor.x, to.x),
      y: Math.min(anchor.y, to.y),
      width: Math.abs(to.x - anchor.x),
      height: Math.abs(to.y - anchor.y),
    };
  }
  const last = shape.points[shape.points.length - 1];
  if (last && Math.hypot(to.x - last.x, to.y - last.y) < ERASE_SAMPLE_PERCENT) return shape;
  return { ...shape, points: [...shape.points, { x: to.x, y: to.y }] };
}

/** Is this gesture worth committing at all? A click without travel is not. */
export function eraseShapeIsMeaningful(shape: EraseShape): boolean {
  if (shape.mode === 'region') return shape.width >= ERASE_REGION_MIN_PERCENT && shape.height >= ERASE_REGION_MIN_PERCENT;
  return shape.points.length > 0;
}

/** Appends a finished gesture, sanitised, so a caller cannot grow the list past what a file should carry. */
export function commitEraseShape(shapes: EraseShape[] | undefined, shape: EraseShape): EraseShape[] {
  return sanitizeEraseShapes([...(shapes ?? []), shape]);
}

/** Drops the last gesture — the "one stroke back" button, which is what makes a brush usable. */
export function popEraseShape(shapes: EraseShape[] | undefined): EraseShape[] {
  const next = sanitizeEraseShapes(shapes ?? []);
  return next.slice(0, Math.max(0, next.length - 1));
}

/** Percent of the fit rectangle → paint units, and millimetres → paint units, per axis. */
function scalesOf(box: ErasePaintBox) {
  const sx = box.width / 100, sy = box.height / 100;
  const mmx = box.width > 0 && box.widthMm > 0 ? box.width / box.widthMm : sx;
  const mmy = box.height > 0 && box.heightMm > 0 ? box.height / box.heightMm : sy;
  return { sx, sy, mmx, mmy };
}

/** The ellipses and rectangles one gesture turns into, in the caller's own units. */
export function eraseShapeParts(shape: EraseShape, box: ErasePaintBox): EraseParts {
  const { sx, sy, mmx, mmy } = scalesOf(box);
  if (shape.mode === 'region') {
    return { holes: [], rects: [{ x: shape.x * sx, y: shape.y * sy, width: shape.width * sx, height: shape.height * sy }] };
  }
  const rx = shape.radiusMm * mmx, ry = shape.radiusMm * mmy;
  return {
    holes: shape.points.map(point => ({ cx: point.x * sx, cy: point.y * sy, rx, ry })),
    rects: [],
  };
}

/** The same, for a whole (possibly junk) list — the single sanitising door every renderer walks through. */
export function eraseParts(shapes: EraseShape[] | undefined, box: ErasePaintBox): EraseParts {
  const holes: EraseParts['holes'] = [];
  const rects: EraseParts['rects'] = [];
  for (const shape of sanitizeEraseShapes(shapes ?? [])) {
    const parts = eraseShapeParts(shape, box);
    holes.push(...parts.holes);
    rects.push(...parts.rects);
  }
  return { holes, rects };
}

const num = (value: number) => (Math.round(value * 1000) / 1000).toString();

/**
 * The SVG the preview masks with: an opaque field with the holes knocked out of it by a luminance mask.
 *
 * The mask, not an even-odd path, is the point — brush dots overlap constantly, and even-odd would make the
 * overlap of two strokes come back as un-erased paper. Black over black stays black.
 */
export function eraseMaskSvg(shapes: EraseShape[] | undefined, box: ErasePaintBox): string | undefined {
  const { holes, rects } = eraseParts(shapes, box);
  if (!holes.length && !rects.length) return undefined;
  const w = num(Math.max(0.001, box.width)), h = num(Math.max(0.001, box.height));
  const cut = [
    ...rects.map(rect => `<rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(Math.max(0.001, rect.width))}" height="${num(Math.max(0.001, rect.height))}"/>`),
    ...holes.map(hole => `<ellipse cx="${num(hole.cx)}" cy="${num(hole.cy)}" rx="${num(Math.max(0.001, hole.rx))}" ry="${num(Math.max(0.001, hole.ry))}"/>`),
  ].join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`
    + `<mask id="e" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">`
    + `<rect width="${w}" height="${h}" fill="#fff"/><g fill="#000">${cut}</g></mask>`
    + `<rect width="${w}" height="${h}" fill="#fff" mask="url(#e)"/></svg>`;
}

/** The `mask-image` value for the preview, or `undefined` when there is nothing to mask. */
export function eraseMaskCss(shapes: EraseShape[] | undefined, box: ErasePaintBox): string | undefined {
  const svg = eraseMaskSvg(shapes, box);
  return svg ? `url("data:image/svg+xml,${encodeURIComponent(svg)}")` : undefined;
}

/**
 * Punches the same holes into a canvas, which is what the exported PDF and any raster of the page see.
 *
 * `destination-out` with an opaque paint is the exact mirror of the mask above — and it is applied *after*
 * the picture and its inversion are drawn, so erasing never leaves a white rectangle where the artwork was.
 */
export function applyEraseToContext(
  ctx: CanvasRenderingContext2D,
  shapes: EraseShape[] | undefined,
  box: ErasePaintBox
): boolean {
  const { holes, rects } = eraseParts(shapes, box);
  if (!holes.length && !rects.length) return false;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  for (const rect of rects) ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  for (const hole of holes) {
    ctx.beginPath();
    ctx.ellipse(hole.cx, hole.cy, Math.max(0.001, hole.rx), Math.max(0.001, hole.ry), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return true;
}

/** Negates RGB and keeps alpha, which is what a picture invert has to mean for a PNG with transparency. */
export function invertPixelsInContext(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number }
): void {
  const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
  const width = Math.max(1, Math.min(Math.ceil(rect.width) - (x - Math.floor(rect.x)), ctx.canvas.width - x));
  const height = Math.max(1, Math.min(Math.ceil(rect.height) - (y - Math.floor(rect.y)), ctx.canvas.height - y));
  if (width <= 0 || height <= 0) return;
  const data = ctx.getImageData(x, y, width, height);
  const pixels = data.data;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    pixels[index] = 255 - pixels[index];
    pixels[index + 1] = 255 - pixels[index + 1];
    pixels[index + 2] = 255 - pixels[index + 2];
  }
  ctx.putImageData(data, x, y);
}

/** The box a gesture covers, in percent of the fit rectangle — the rubber band, and what tests read. */
export function eraseShapeBounds(
  shape: EraseShape,
  box: { widthMm: number; heightMm: number }
): { x: number; y: number; width: number; height: number } {
  if (shape.mode === 'region') return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  const rx = (shape.radiusMm * 2) / Math.max(0.0001, box.widthMm) * 100;
  const ry = (shape.radiusMm * 2) / Math.max(0.0001, box.heightMm) * 100;
  const xs = shape.points.map(point => point.x), ys = shape.points.map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX - rx / 2, y: minY - ry / 2, width: maxX - minX + rx, height: maxY - minY + ry };
}

/** A stable string for "which erasures does this picture carry", used as a bitmap cache key on export. */
export function eraseSignature(shapes: EraseShape[] | undefined): string {
  const clean = sanitizeEraseShapes(shapes ?? []);
  if (!clean.length) return '';
  return clean.map(shape => shape.mode === 'region'
    ? `r${num(shape.x)},${num(shape.y)},${num(shape.width)},${num(shape.height)}`
    : `b${num(shape.radiusMm)}:${shape.points.length}:${num(shape.points[0]!.x)},${num(shape.points[0]!.y)}:${num(shape.points[shape.points.length - 1]!.x)},${num(shape.points[shape.points.length - 1]!.y)}`
  ).join('|');
}

/** A point on the box, in percent, from a pixel offset inside it. */
export function erasePointFromPixels(xPx: number, yPx: number, box: { width: number; height: number }): { x: number; y: number } {
  return {
    x: box.width > 0 ? xPx / box.width * 100 : 0,
    y: box.height > 0 ? yPx / box.height * 100 : 0,
  };
}
