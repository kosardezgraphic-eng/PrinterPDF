/**
 * The eraser's geometry, in one place, for the screen and for the paper.
 *
 * A gesture is stored as a list on the overlay (see `EraseShape` in `shared/models.ts`) and only ever
 * *derived* into pixels — a CSS mask for the preview, a Canvas paint for the raster the exported PDF embeds.
 * That is what makes "delete a bit of this logo" reversible: the picture's own bytes are never rewritten, a
 * further stroke adds to the list, "one stroke back" takes one away, and "restore" empties the list instead of
 * reloading artwork from disk.
 *
 * A gesture is either a **hole** (the pixels are removed) or a **stroke of colour** (the pixels are covered).
 * Both live in the same list, in the order they were drawn, and both renderers keep that order exact:
 *
 * | | hole | colour |
 * | --- | --- | --- |
 * | preview | the union of all holes is a `mask-image` on the picture | a layer above the picture, each stroke masked by the holes drawn *after* it |
 * | export | `destination-out` | an opaque fill |
 *
 * which is why painting over a hole fills it and erasing over a paint stroke cuts it, on the screen and on
 * the sheet alike — the one place where a "same list, two renderers" design is allowed to cheat is nothing.
 *
 * Percentages are of the picture's **fit rectangle** — the part of the box the artwork covers — because that is
 * the rectangle the pointer paints on and the one the mask is clipped to. A mark therefore stays on the logo it
 * belongs to even when a `contain` letterbox, a resize or a mirror moves the picture inside its box. A brush
 * radius is in millimetres and is converted per axis at paint time, which is why the brush feels the same size
 * at any zoom and stays round on the sheet; the ellipse it becomes inside a stretched picture is exactly what
 * the operator saw.
 */
import { sanitizeEraseColor, sanitizeEraseShapes, type EraseShape } from '@shared/models';

/** The pointer's mode on the sheet: which tool a click hands the picture. */
export type EraseTool = 'off' | 'brush' | 'region' | 'picker';

/** A tool that changes the picture; the picker only reads it. */
export function eraseToolPaints(tool: EraseTool): boolean {
  return tool === 'brush' || tool === 'region';
}

/**
 * Two samples closer than this (percent of the fit rectangle) are the same dot — but only once the stroke is
 * *dense enough to be continuous*.
 *
 * A pointermove arrives far faster than the eye can see a new dot, and every point is stored in the project
 * file and repeated in each undo snapshot — an un-sampled 400 px drag would bankroll thousands of identical
 * ellipses for the rest of the session. The catch is that a stroke is drawn as one dot per point, so dropping
 * every sample shorter than a fixed distance leaves visible gaps between them once the brush is small or the
 * pointer moves fast. The next sample is therefore only skipped when the dot already there covers the way to it.
 */
export const ERASE_SAMPLE_PERCENT = 0.3;
/**
 * How much of the brush's diameter two consecutive samples may be apart before the stretch between them is
 * filled in. The brush paints a disc of its radius at each point, so two points one diameter apart already
 * overlap; anything over that leaves a lens-shaped gap the eye reads as a dotted line.
 */
export const ERASE_MAX_GAP_DIAMETERS = 1;

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
  /**
   * The strokes' paths, one per brush gesture that has a second point: a polyline anchored *at the centre* of
   * each dot. The dots alone are a dotted line whenever the samples are further apart than the brush, which is
   * exactly what a fast freehand drag produces; a `round`-capped line of the brush's width through the same
   * centres is the continuous stroke the operator drew.
   */
  strokes: { xs: number[]; ys: number[]; width: number }[];
  /** Marquee regions. */
  rects: { x: number; y: number; width: number; height: number }[];
}

/**
 * The shape a gesture starts with: one dot for a brush, a zero-sized rectangle for a marquee.
 *
 * A colour turns it from a hole into a stroke of paint, which is what lets an operator cover a corner with the
 * background colour picked off the artwork instead of cutting it out and showing the page through it.
 */
export function beginEraseShape(
  tool: 'brush' | 'region',
  at: { x: number; y: number },
  radiusMm: number,
  color?: string | null
): EraseShape {
  const paint = sanitizeEraseColor(color);
  if (tool === 'region') return { mode: 'region', x: at.x, y: at.y, width: 0, height: 0, ...(paint ? { color: paint } : {}) };
  return { mode: 'brush', radiusMm, points: [{ x: at.x, y: at.y }], ...(paint ? { color: paint } : {}) };
}

/** Is this gesture paint (a colour) rather than a hole? */
export function eraseShapeIsPaint(shape: EraseShape): boolean {
  return shape.color !== undefined;
}

/**
 * Grows the shape as the pointer moves. `anchor` is where the drag began — a marquee is rebuilt from it
 * rather than translated, so dragging back across the start gives a rectangle on the other side the way every
 * selection tool does. The colour rides along with the gesture.
 */
export function growEraseShape(
  shape: EraseShape,
  anchor: { x: number; y: number },
  to: { x: number; y: number },
  box?: { widthMm: number; heightMm: number }
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
  if (!last) return { ...shape, points: [to] };
  const gap = Math.hypot(to.x - last.x, to.y - last.y);
  if (gap < ERASE_SAMPLE_PERCENT) return shape;
  // When the brush's own footprint leaves a hole between the two samples, the stroke is *interpolated* rather
  // than stepped: an ellipse per skipped sample, so the line is continuous at any speed. Without the box the
  // caller is describing a freehand path (a test, a paste), where the plain sample is the honest answer.
  if (!box) return { ...shape, points: [...shape.points, { ...to }] };
  // The gap is compared on both axes so a stretched rectangle cannot hide a hole in the short direction.
  const diameterX = 2 * shape.radiusMm / Math.max(0.0001, box.widthMm) * 100;
  const diameterY = 2 * shape.radiusMm / Math.max(0.0001, box.heightMm) * 100;
  const allowed = Math.max(ERASE_SAMPLE_PERCENT, Math.min(diameterX, diameterY) * ERASE_MAX_GAP_DIAMETERS);
  if (gap <= allowed) return { ...shape, points: [...shape.points, { ...to }] };
  const steps = Math.min(256, Math.ceil(gap / Math.max(ERASE_SAMPLE_PERCENT, allowed)));
  const points = [...shape.points];
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    points.push({ x: last.x + (to.x - last.x) * t, y: last.y + (to.y - last.y) * t });
  }
  return { ...shape, points };
}

/** Is this gesture worth committing at all? A click without travel is not — for a marquee. */
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
    return { holes: [], strokes: [], rects: [{ x: shape.x * sx, y: shape.y * sy, width: shape.width * sx, height: shape.height * sy }] };
  }
  const rx = shape.radiusMm * mmx, ry = shape.radiusMm * mmy;
  return {
    holes: shape.points.map(point => ({ cx: point.x * sx, cy: point.y * sy, rx, ry })),
    strokes: [],
    rects: [],
  };
}

/** The same, for a whole (possibly junk) list — the single sanitising door every renderer walks through. */
export function eraseParts(shapes: EraseShape[] | undefined, box: ErasePaintBox): EraseParts {
  const holes: EraseParts['holes'] = [];
  const strokes: EraseParts['strokes'] = [];
  const rects: EraseParts['rects'] = [];
  const { sx, sy, mmx, mmy } = scalesOf(box);
  for (const shape of sanitizeEraseShapes(shapes ?? [])) {
    const parts = eraseShapeParts(shape, box);
    holes.push(...parts.holes);
    rects.push(...parts.rects);
    if (shape.mode === 'brush' && shape.points.length > 1) {
      // One width per axis: the brush becomes an ellipse in a stretched picture, and a line cannot be both, so the
      // stroke carries the *larger* of the two and the per-point ellipses keep the exact footprint.
      strokes.push({
        xs: shape.points.map(point => point.x * sx),
        ys: shape.points.map(point => point.y * sy),
        width: 2 * shape.radiusMm * Math.max(mmx, mmy),
      });
    }
  }
  return { holes, strokes, rects };
}

/** Only the holes, in order, from a given position in the list — the mask a paint stroke is cut by. */
function holesFrom(shapes: EraseShape[], index: number, box: ErasePaintBox): EraseParts {
  return eraseParts(shapes.slice(index).filter(shape => !eraseShapeIsPaint(shape)), box);
}

const num = (value: number) => (Math.round(value * 1000) / 1000).toString();

/** One `<rect>`/`<ellipse>` pair per part of a gesture, in the SVG's own units. */
function partsMarkup(parts: EraseParts): string {
  return [
    ...parts.rects.map(rect => `<rect x="${num(rect.x)}" y="${num(rect.y)}" width="${num(Math.max(0.001, rect.width))}" height="${num(Math.max(0.001, rect.height))}"/>`),
    ...parts.strokes.map(stroke => `<polyline points="${stroke.xs.map((x, i) => `${num(x)},${num(stroke.ys[i] ?? 0)}`).join(' ')}" fill="none" stroke-width="${num(Math.max(0.001, stroke.width))}" stroke-linecap="round" stroke-linejoin="round"/>`),
    ...parts.holes.map(hole => `<ellipse cx="${num(hole.cx)}" cy="${num(hole.cy)}" rx="${num(Math.max(0.001, hole.rx))}" ry="${num(Math.max(0.001, hole.ry))}"/>`),
  ].join('');
}

function svgShell(body: string, box: ErasePaintBox): string {
  const w = num(Math.max(0.001, box.width)), h = num(Math.max(0.001, box.height));
  // CSS mask-image needs a real intrinsic size. A viewBox-only SVG defaults to 300×150 and can
  // tile or stretch incorrectly over a page, which may make the entire page appear transparent.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${body}</svg>`;
}

/**
 * The SVG the preview masks the picture with: an opaque field with every **hole** knocked out of it.
 *
 * A luminance mask, not an even-odd path, is the point — brush dots overlap constantly, and even-odd would
 * make the overlap of two strokes come back as un-erased paper. Black over black stays black. Paint strokes
 * are deliberately absent: they cover the picture, they do not cut it.
 */
export function eraseMaskSvg(shapes: EraseShape[] | undefined, box: ErasePaintBox): string | undefined {
  const clean = sanitizeEraseShapes(shapes ?? []);
  const parts = eraseParts(clean.filter(shape => !eraseShapeIsPaint(shape)), box);
  if (!parts.holes.length && !parts.rects.length) return undefined;
  const width = num(Math.max(0.001, box.width));
  const height = num(Math.max(0.001, box.height));
  // Keep the mask definition inside <defs>; the outer white surface remains opaque everywhere
  // except the exact brush/region geometry cut out by the luminance mask.
  return svgShell(
    `<defs><mask id="e" maskUnits="userSpaceOnUse" mask-type="luminance" x="0" y="0" width="${width}" height="${height}">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/><g fill="#000">${partsMarkup(parts)}</g></mask></defs>`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff" mask="url(#e)"/>`,
    box
  );
}

/** The `mask-image` value for the preview, or `undefined` when there is nothing to mask. */
export function eraseMaskCss(shapes: EraseShape[] | undefined, box: ErasePaintBox): string | undefined {
  const svg = eraseMaskSvg(shapes, box);
  return svg ? `url("data:image/svg+xml,${encodeURIComponent(svg)}")` : undefined;
}

/**
 * The layer the preview paints *above* the picture: one group per coloured gesture, in the order they were
 * drawn, and each group cut by the holes that came after it.
 *
 * Without that per-stroke mask a stroke drawn before a hole would sit on top of it and hide the erasure — the
 * Canvas route gets this right for free (a later `destination-out` clears whatever is under it), so the screen
 * has to say so explicitly or the two would disagree about the operator's own history.
 */
export function erasePaintSvg(shapes: EraseShape[] | undefined, box: ErasePaintBox): string | undefined {
  const clean = sanitizeEraseShapes(shapes ?? []);
  const groups: string[] = [];
  let maskId = 0;
  const defs: string[] = [];
  clean.forEach((shape, index) => {
    if (!eraseShapeIsPaint(shape)) return;
    const later = holesFrom(clean, index + 1, box);
    let mask = '';
    if (later.holes.length + later.rects.length > 0) {
      const id = `m${maskId++}`;
      defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${num(Math.max(0.001, box.width))}" height="${num(Math.max(0.001, box.height))}">`
        + `<rect width="${num(Math.max(0.001, box.width))}" height="${num(Math.max(0.001, box.height))}" fill="#fff"/>`
        + `<g fill="#000">${partsMarkup(later)}</g></mask>`);
      mask = ` mask="url(#${id})"`;
    }
    groups.push(`<g fill="${shape.color}" stroke="${shape.color}"${mask}>${partsMarkup(eraseShapeParts(shape, box))}</g>`);
  });
  if (!groups.length) return undefined;
  return svgShell(`<defs>${defs.join('')}</defs>${groups.join('')}`, box);
}

/** The `background-image` value for the painted strokes, or `undefined` when nothing was painted. */
export function erasePaintCss(shapes: EraseShape[] | undefined, box: ErasePaintBox): string | undefined {
  const svg = erasePaintSvg(shapes, box);
  return svg ? `url("data:image/svg+xml,${encodeURIComponent(svg)}")` : undefined;
}

/**
 * Cuts the holes and lays the colours down on a canvas, which is what the exported PDF and any raster see.
 *
 * The list is walked in order — `source-over` for a colour, `destination-out` for a hole — so an erasure after
 * a stroke clears it and a stroke after an erasure fills it, exactly like the two preview layers above.
 */
export function applyEraseToContext(
  ctx: CanvasRenderingContext2D,
  shapes: EraseShape[] | undefined,
  box: ErasePaintBox
): boolean {
  const clean = sanitizeEraseShapes(shapes ?? []);
  if (!clean.length) return false;
  for (const shape of clean) {
    const parts = eraseShapeParts(shape, box);
    if (!parts.holes.length && !parts.rects.length) continue;
    const all = eraseParts([shape], box);
    ctx.save();
    if (shape.color) ctx.fillStyle = shape.color;
    else ctx.fillStyle = '#000';
    ctx.globalCompositeOperation = shape.color ? 'source-over' : 'destination-out';
    for (const rect of parts.rects) ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    // The dots first, then the ribbon through their centres: a stroke drawn as separate dots has visible notches
    // wherever the pointer outran the brush, and the raster the PDF embeds would keep them.
    for (const hole of parts.holes) {
      ctx.beginPath();
      ctx.ellipse(hole.cx, hole.cy, Math.max(0.001, hole.rx), Math.max(0.001, hole.ry), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (all.strokes.length) {
      ctx.strokeStyle = shape.color ?? '#000';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const stroke of all.strokes) {
        ctx.lineWidth = Math.max(0.001, stroke.width);
        ctx.beginPath();
        ctx.moveTo(stroke.xs[0]!, stroke.ys[0]!);
        for (let index = 1; index < stroke.xs.length; index++) ctx.lineTo(stroke.xs[index]!, stroke.ys[index]!);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
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

/** The box a gesture covers, in percent of the fit rectangle — the rubber band, and what the tests read. */
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

/** A stable string for "which marks does this picture carry", used as a bitmap cache key on export. */
export function eraseSignature(shapes: EraseShape[] | undefined): string {
  const clean = sanitizeEraseShapes(shapes ?? []);
  if (!clean.length) return '';
  return clean.map(shape => shape.mode === 'region'
    ? `r${num(shape.x)},${num(shape.y)},${num(shape.width)},${num(shape.height)}${shape.color ? `:${shape.color}` : ''}`
    : `b${num(shape.radiusMm)}:${shape.points.length}:${num(shape.points[0]!.x)},${num(shape.points[0]!.y)}:${num(shape.points[shape.points.length - 1]!.x)},${num(shape.points[shape.points.length - 1]!.y)}${shape.color ? `:${shape.color}` : ''}`
  ).join('|');
}

/** A point on the box, in percent, from a pixel offset inside it. */
export function erasePointFromPixels(xPx: number, yPx: number, box: { width: number; height: number }): { x: number; y: number } {
  return {
    x: box.width > 0 ? xPx / box.width * 100 : 0,
    y: box.height > 0 ? yPx / box.height * 100 : 0,
  };
}

/** `#rrggbb` from raw samples, the one colour format the app is willing to store and paint. */
export function hexColor(r: number, g: number, b: number): string {
  const part = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * The colour of a spot of an `RGBA` buffer — the eyedropper's maths, kept apart from the browser so it can be
 * tested without a real image.
 *
 * `radius` widens the sample to a square of `2 r + 1` pixels and the answer is the average of what is there.
 * That is what "the colour of this area" means to an operator: a click on a JPEG logo or an anti-aliased edge
 * otherwise picks one noise pixel and paints a patch that does not match its surroundings, and a mean over
 * the spot the brush will cover matches. Transparent pixels are left out of the mean rather than mixed in as
 * black, so sampling a soft edge gives the edge's own colour; a spot with nothing but transparency returns
 * `undefined` — there is nothing to pick there, and inventing white would paint a hole with paper.
 *
 * `invert` negates the answer, because when the picture is displayed inverted the operator is picking the
 * colour they *see*. Averaging first is the same number: negation and a mean are both linear.
 */
export function colorFromPixels(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  options: { invert?: boolean; radius?: number } = {}
): string | undefined {
  if (!(width > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const height = Math.floor(pixels.length / 4);
  if (!(height > 0)) return undefined;
  const px = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const py = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const radius = Math.max(0, Math.min(32, Math.floor(options.radius ?? 0)));
  const mix = (value: number) => (options.invert ? 255 - value : value);
  let red = 0, green = 0, blue = 0, taken = 0;
  for (let row = py - radius; row <= py + radius; row++) {
    if (row < 0 || row >= height) continue;
    for (let column = px - radius; column <= px + radius; column++) {
      if (column < 0 || column >= width) continue;
      const offset = (row * width + column) * 4;
      if (offset + 3 >= pixels.length) continue;
      if (pixels[offset + 3] === 0) continue;
      red += pixels[offset]; green += pixels[offset + 1]; blue += pixels[offset + 2]; taken++;
    }
  }
  if (!taken) return undefined;
  // A half-transparent pixel is still a colour the operator can aim at; premultiplying it against nothing
  // would darken every soft edge, so the samples are read as they are.
  return hexColor(mix(red / taken), mix(green / taken), mix(blue / taken));
}

/** A box the size of the decoded file, so a percent of the artwork can be turned into a pixel of it. */
export function sampleBoxForImage(naturalWidth: number, naturalHeight: number): ErasePaintBox {
  return { width: naturalWidth, height: naturalHeight, widthMm: naturalWidth, heightMm: naturalHeight };
}

/**
 * The marquee a region gesture is about to become, while the pointer is still down — an outline, not a commit.
 * A region only takes effect when the operator presses `Delete`, so this is what the sheet shows in between.
 */
export function eraseRegionIsSelected(shape: EraseShape | null | undefined): shape is Extract<EraseShape, { mode: 'region' }> {
  return !!shape && shape.mode === 'region' && eraseShapeIsMeaningful(shape);
}
