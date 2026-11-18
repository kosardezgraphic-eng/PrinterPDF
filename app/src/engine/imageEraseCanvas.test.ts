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
import { applyEraseToContext, invertPixelsInContext } from './imageErase';

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
