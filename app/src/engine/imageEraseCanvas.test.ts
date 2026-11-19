/**
 * The compositing itself, on a real Canvas 2D implementation (`@napi-rs/canvas`), so the claim that the paper
 * loses the same pixels the screen masks off is checked rather than asserted.
 *
 * `applyEraseToContext` and `invertPixelsInContext` are the exact functions the export raster runs, and the
 * numbers below are read back out of the bitmap — a hole that is white instead of transparent, or an inversion
 * that ate the letterbox, fails here instead of on a printed sheet.
 */
import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import type { EraseShape } from '@shared/models';
import { applyEraseToContext, colorFromPixels, eraseMaskSvg, invertPixelsInContext } from './imageErase';

const box = { width: 200, height: 100, widthMm: 100, heightMm: 50 };         // two pixels per millimetre

// The two functions under test are typed against the browser's CanvasRenderingContext2D; `@napi-rs/canvas`
// hands back its own class with the same 2D surface. The cast is only about the name of the type — every call
// below is a real canvas call whose result is read out of real pixels.
type Ctx = CanvasRenderingContext2D;
const contextOf = (canvas: import('@napi-rs/canvas').Canvas) => canvas.getContext('2d') as unknown as Ctx;
const at = (ctx: Ctx, x: number, y: number) => {
  const [r, g, b, a] = Array.from(ctx.getImageData(x, y, 1, 1).data);
  return { r, g, b, a };
};

function filled() {
  const canvas = createCanvas(200, 100);
  const ctx = contextOf(canvas);
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 200, 100);
  return { canvas, ctx };
}

describe('SVG mask used by the live page preview', () => {
  it('defines a page-sized opaque mask with only the selected rectangle cut out', () => {
    const svg = eraseMaskSvg(
      [{ mode: 'region', x: 25, y: 20, width: 30, height: 40 }],
      box
    );
    expect(svg).toBeDefined();
    expect(svg).toContain('width="200" height="100" viewBox="0 0 200 100"');
    expect(svg).toContain('<defs><mask id="e"');
    expect(svg).toContain('maskUnits="userSpaceOnUse"');
    expect(svg).toContain('<rect x="0" y="0" width="200" height="100" fill="#fff"/>');
    expect(svg).toContain('<g fill="#000"><rect x="50" y="20" width="60" height="40"/>');
    expect(svg).toContain('mask="url(#e)"');
  });

  it('keeps the mask extent equal to the page instead of falling back to SVG 300×150 defaults', () => {
    const svg = eraseMaskSvg(
      [{ mode: 'brush', radiusMm: 3, points: [{ x: 50, y: 50 }] }],
      { width: 840, height: 1188, widthMm: 210, heightMm: 297 }
    );
    expect(svg).toContain('width="840" height="1188" viewBox="0 0 840 1188"');
  });
});

describe('punching the holes into the export raster', () => {
  it('removes the pixels inside a marquee and leaves the rest opaque', () => {
    const { ctx } = filled();
    const shape: EraseShape = { mode: 'region', x: 25, y: 25, width: 50, height: 50 };
    expect(applyEraseToContext(ctx, [shape], box)).toBe(true);
    expect(at(ctx, 100, 50)).toEqual({ r: 0, g: 0, b: 0, a: 0 });                // dead centre: gone, and gone means nothing — not a white rectangle
    expect(at(ctx, 20, 20)).toEqual({ r: 255, g: 0, b: 0, a: 255 });             // outside: still the picture
    expect(at(ctx, 180, 90).a).toBe(255);
  });

  it('erases a brush dot the size the operator set in millimetres', () => {
    const { ctx } = filled();
    applyEraseToContext(ctx, [{ mode: 'brush', radiusMm: 5, points: [{ x: 50, y: 50 }] }], box);
    // 5 mm radius at two pixels per millimetre is a hole about 20 px across. Counting the columns that went
    // transparent is the honest form of that check, because the canvas anti-aliases the edge itself.
    const row = Array.from(ctx.getImageData(0, 50, 200, 1).data);
    const width = row.filter((value, index) => index % 4 === 3 && value === 0).length;
    expect(width).toBeGreaterThan(16);
    expect(width).toBeLessThan(24);
    expect(at(ctx, 100, 50).a).toBe(0);
    expect(at(ctx, 150, 50).a).toBe(255);                                         // and it stops at the dot
  });

  it('closes the overlap of two strokes, which an even-odd path would have opened again', () => {
    const { ctx } = filled();
    applyEraseToContext(ctx, [
      { mode: 'region', x: 10, y: 10, width: 40, height: 40 },
      { mode: 'region', x: 30, y: 10, width: 40, height: 40 },
    ], box);
    expect(at(ctx, 80, 40).a).toBe(0);                                             // inside both
    expect(at(ctx, 20, 40).a).toBe(0);                                             // inside the first only
    expect(at(ctx, 150, 40).a).toBe(255);
  });

  it('does nothing, and says so, when there is no gesture to apply', () => {
    const { ctx } = filled();
    expect(applyEraseToContext(ctx, undefined, box)).toBe(false);
    expect(applyEraseToContext(ctx, [{ mode: 'region', x: 0, y: 0, width: 0, height: 0 }], box)).toBe(false);
    expect(at(ctx, 10, 10).a).toBe(255);
  });

  it('leaves the context as it found it, so the next overlay is not erased through a stale composite mode', () => {
    const { ctx } = filled();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#00ff00';
    applyEraseToContext(ctx, [{ mode: 'region', x: 0, y: 0, width: 10, height: 10 }], box);
    expect(ctx.globalCompositeOperation).toBe('source-over');
    expect(ctx.fillStyle).toBe('#00ff00');
  });
});

describe('negating the colours in the export raster', () => {
  it('inverts the picture it was given and nothing around it', () => {
    const canvas = createCanvas(200, 100);
    const ctx = contextOf(canvas);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 100, 100);                                                  // the picture; the right half is the letterbox
    invertPixelsInContext(ctx, { x: 0, y: 0, width: 100, height: 100 });
    expect(at(ctx, 50, 50)).toEqual({ r: 0, g: 255, b: 255, a: 255 });             // red → cyan
    expect(at(ctx, 150, 50)).toEqual({ r: 0, g: 0, b: 0, a: 0 });                   // untouched, still empty
  });

  it('keeps alpha, so an erased corner does not come back as a black square', () => {
    const { ctx } = filled();
    applyEraseToContext(ctx, [{ mode: 'region', x: 0, y: 0, width: 20, height: 20 }], box);
    invertPixelsInContext(ctx, { x: 0, y: 0, width: 200, height: 100 });
    expect(at(ctx, 10, 10)).toEqual({ r: 0, g: 0, b: 0, a: 0 });                    // hole stays a hole
    expect(at(ctx, 100, 50)).toEqual({ r: 0, g: 255, b: 255, a: 255 });             // colours flipped once
  });

  it('is its own inverse, which is what a second press of the button has to mean', () => {
    const { ctx } = filled();
    const rect = { x: 0, y: 0, width: 200, height: 100 };
    const before = at(ctx, 30, 30);
    invertPixelsInContext(ctx, rect);
    invertPixelsInContext(ctx, rect);
    expect(at(ctx, 30, 30)).toEqual(before);
  });
});

describe('laying the brush’s colour on the export raster', () => {
  it('covers the spot with the chosen colour instead of cutting through it', () => {
    const { ctx } = filled();
    const shape: EraseShape = { mode: 'region', x: 25, y: 25, width: 50, height: 50, color: '#0000ff' };
    expect(applyEraseToContext(ctx, [shape], box)).toBe(true);
    expect(at(ctx, 100, 50)).toEqual({ r: 0, g: 0, b: 255, a: 255 });              // the patch, opaque — not a hole
    expect(at(ctx, 20, 20)).toEqual({ r: 255, g: 0, b: 0, a: 255 });               // outside it, the picture
  });

  it('paints a dot the size the brush says, in millimetres', () => {
    const { ctx } = filled();
    applyEraseToContext(ctx, [{ mode: 'brush', radiusMm: 5, points: [{ x: 50, y: 50 }], color: '#00ff00' }], box);
    expect(at(ctx, 100, 50)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    // The same 20 px across the erasing test measured, only filled instead of removed.
    const row = Array.from(ctx.getImageData(0, 50, 200, 1).data);
    const green = row.filter((value, index) => index % 4 === 1 && value === 255).length;
    expect(green).toBeGreaterThan(16);
    expect(green).toBeLessThan(24);
    expect(at(ctx, 150, 50)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it('lets a hole cut through paint drawn before it, and paint refill a hole drawn before it', () => {
    // Both orders are the operator's own history, and the canvas compositing gives them for free: a later
    // `destination-out` clears what is under it, a later `source-over` covers it.
    const { ctx } = filled();
    applyEraseToContext(ctx, [
      { mode: 'region', x: 10, y: 10, width: 30, height: 30, color: '#00ff00' },   // px 20…80
      { mode: 'region', x: 25, y: 10, width: 30, height: 30 },                     // px 50…110
    ], box);
    expect(at(ctx, 40, 25)).toEqual({ r: 0, g: 255, b: 0, a: 255 });               // paint only
    expect(at(ctx, 65, 25)).toEqual({ r: 0, g: 0, b: 0, a: 0 });                    // the hole went through it
    expect(at(ctx, 95, 25)).toEqual({ r: 0, g: 0, b: 0, a: 0 });                    // and cut the bare picture

    const { ctx: after } = filled();
    applyEraseToContext(after, [
      { mode: 'region', x: 25, y: 10, width: 30, height: 30 },
      { mode: 'region', x: 10, y: 10, width: 30, height: 30, color: '#00ff00' },
    ], box);
    expect(at(after, 65, 25)).toEqual({ r: 0, g: 255, b: 0, a: 255 });               // the paint closed the hole again
    expect(at(after, 95, 25)).toEqual({ r: 0, g: 0, b: 0, a: 0 });                    // where nothing was painted since
  });

  it('ignores a colour that is not a colour, and erases there instead', () => {
    const { ctx } = filled();
    // `sanitizeEraseShapes` is the gate in front of every renderer: a stored file with a hostile or broken
    // `color` must fall back to a hole, not feed the canvas an expression.
    applyEraseToContext(ctx, [{ mode: 'region', x: 25, y: 25, width: 50, height: 50, color: 'url(#x)' as string }], box);
    expect(at(ctx, 100, 50)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});

describe('reading a colour out of the artwork', () => {
  const rgba = (r: number, g: number, b: number, a: number) => new Uint8ClampedArray([r, g, b, a]);

  it('answers with the hex the brush stores, and with nothing on an empty pixel', () => {
    expect(colorFromPixels(rgba(0x12, 0x34, 0x56, 0xff), 1, 0, 0)).toBe('#123456');
    expect(colorFromPixels(rgba(0, 0, 0, 0), 1, 0, 0)).toBeUndefined();            // never an invented white
  });

  it('negates the sample when the picture is displayed inverted, because that is the colour on the screen', () => {
    expect(colorFromPixels(rgba(0x12, 0x34, 0x56, 0xff), 1, 0, 0, { invert: true })).toBe('#edcba9');
  });

  it('walks the row it was given, and refuses a point outside the sample', () => {
    const two = new Uint8ClampedArray([1, 2, 3, 255, 250, 251, 252, 255]);
    expect(colorFromPixels(two, 2, 1, 0)).toBe('#fafbfc');
    expect(colorFromPixels(two, 2, 0, 5)).toBeUndefined();
    expect(colorFromPixels(two, 0, 0, 0)).toBeUndefined();
  });

  it('averages the area it is given, and ignores the empty pixels in it', () => {
    // A 3×3 field: eight anti-aliased edge pixels around one transparent hole.
    const field = new Uint8ClampedArray(9 * 4);
    for (let i = 0; i < 9; i++) field.set(i === 4 ? [0, 0, 0, 0] : [10, 20, 30, 255], i * 4);
    expect(colorFromPixels(field, 3, 1, 1, { radius: 1 })).toBe('#0a141e');
    field.set([100, 100, 100, 255], 4 * 4);                                         // the centre joins in
    expect(colorFromPixels(field, 3, 1, 1, { radius: 1 })).toBe('#141d26');          // (8·10+100)/9, and so on
    expect(colorFromPixels(field, 3, 1, 1)).toBe('#646464');                          // radius 0 reads the pixel
    // A window that hangs past the file is clipped, not wrapped, and an all-empty one still says nothing.
    expect(colorFromPixels(field, 3, 0, 0, { radius: 8 })).toBe('#141d26');
    expect(colorFromPixels(new Uint8ClampedArray(9 * 4), 3, 1, 1, { radius: 1 })).toBeUndefined();
  });
});
