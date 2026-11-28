import { describe, expect, it, vi } from 'vitest';
import type { PageOverlayShape, ShapeType } from '@shared/models';
import {
  MM_PER_PT, SHAPE_TYPES, applyShapeCommands, clampSides, defaultShapeStyle, normalizeShapeStyle,
  shapeCapabilities, shapeColorComponents, shapeCommands, shapeDashPattern, shapeHasFill, shapeIsStrokedOnly,
  shapeSvgPath, sanitizeShapeColor,
} from './shapes';

const style = (over: Partial<PageOverlayShape> = {}): PageOverlayShape => ({
  id: 's', kind: 'shape', type: 'rectangle', fillColor: 'transparent', strokeColor: '#000000',
  strokeWidth: 1, strokeStyle: 'solid', borderRadius: 0, opacity: 1, rotation: 0,
  target: 'page', targetScope: 'all', targetPageIds: [], targetSheetIndex: 1,
  xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100, ...over,
});
/** The outline of a shape in a 100×80 box, which is not square — so a mistake in the axis scaling shows up. */
const cmds = (type: ShapeType, over: Partial<PageOverlayShape> = {}) => shapeCommands(style({ type, ...over }), 100, 80);
const points = (list: ReturnType<typeof cmds>) => list.flatMap(cmd => cmd.op === 'Z' ? [] : [cmd.x, 'y' in cmd ? cmd.y : 0]);
const bounds = (list: ReturnType<typeof cmds>) => {
  const xs = points(list).filter((_, index) => index % 2 === 0), ys = points(list).filter((_, index) => index % 2 === 1);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

describe('shape geometry', () => {
  it('draws every offered type inside the box it was given', () => {
    expect(SHAPE_TYPES.length).toBeGreaterThanOrEqual(10);
    for (const type of SHAPE_TYPES) {
      const box = bounds(shapeCommands(style({ type, borderRadius: 6, sides: 5, innerRadiusPercent: 40 }), 100, 80));
      expect(box.minX, `${type} left`).toBeGreaterThanOrEqual(-50.001);
      expect(box.maxX, `${type} right`).toBeLessThanOrEqual(50.001);
      expect(box.minY, `${type} top`).toBeGreaterThanOrEqual(-40.001);
      expect(box.maxY, `${type} bottom`).toBeLessThanOrEqual(40.001);
      // The outline reaches the edges of the box, so a shape fills the space the operator dragged.
      expect(Math.max(Math.abs(box.minX), Math.abs(box.maxX)), type).toBeCloseTo(50, 1);
    }
  });

  it('fills the box with a polygon, not the circumscribed circle it is built on', () => {
    // A pentagon's widest points are its second and fourth vertices, not its top one, so the raw circle
    // would leave the sides of the dragged box empty. Each axis is scaled by the outline's own reach.
    const pentagon = bounds(cmds('polygon', { sides: 5 }));
    expect(pentagon.maxX).toBeCloseTo(50, 1);
    expect(pentagon.minX).toBeCloseTo(-50, 1);
    expect(pentagon.minY).toBeCloseTo(-40, 1);
    // A hexagon reaches the left and right edges too, but the vertical flats stay inside the box.
    const hexagon = bounds(cmds('polygon', { sides: 6 }));
    expect(hexagon.maxX).toBeCloseTo(50, 1);
    expect(hexagon.maxY).toBeCloseTo(40, 1);
  });

  it('keeps a square square in millimetres, which is the whole reason it is its own button', () => {
    expect(SHAPE_TYPES).toContain('square');
    // Same outline as a rectangle...
    expect(shapeSvgPath(cmds('square'))).toBe(shapeSvgPath(cmds('rectangle')));
    // ...but the ratio is locked from the moment it is inserted, and a corner handle cannot break it.
    expect(defaultShapeStyle('square').borderRadius).toBe(0);
    expect(shapeCapabilities('square').lockAspect).toBe(true);
    expect(shapeCapabilities('rectangle').lockAspect).toBe(false);
  });

  it('measures from the centre of the box, which is what a rotated shape turns around', () => {
    const rect = cmds('rectangle');
    expect(rect[0]).toEqual({ op: 'M', x: -50, y: -40 });
    expect(rect[rect.length - 1]).toEqual({ op: 'Z' });
  });

  it('keeps a circle round in millimetres and an ellipse in a stretched box', () => {
    const square = bounds(shapeCommands(style({ type: 'circle' }), 60, 60));
    expect(square.maxX - square.minX).toBeCloseTo(60, 3);
    expect(square.maxY - square.minY).toBeCloseTo(60, 3);
    // Four arcs, each a cubic — no SVG arc command, so the PDF parser does not need one either.
    const circle = cmds('circle');
    expect(circle.filter(cmd => cmd.op === 'C')).toHaveLength(4);
    // An SVG `A` arc would need a parser in the PDF exporter that pdf-lib does not have.
    expect(circle.some(cmd => (cmd.op as string) === 'A')).toBe(false);
  });

  it('rounds a rectangle only as far as its own radius allows', () => {
    const small = shapeCommands(style({ type: 'rounded-rect', borderRadius: 12 }), 20, 10);
    // The box is 10 mm tall, so a 12 mm radius is impossible: the corner is clamped to half the height.
    expect(small.some(cmd => cmd.op === 'C')).toBe(true);
    expect(bounds(small).maxY).toBeCloseTo(5, 3);
    // Radius zero must degrade into the plain rectangle, not into a path with zero-length corners.
    expect(shapeSvgPath(shapeCommands(style({ type: 'rounded-rect', borderRadius: 0 }), 100, 80)))
      .toBe(shapeSvgPath(cmds('rectangle')));
  });

  it('cuts a ring out of the badge instead of filling the middle', () => {
    const badge = cmds('badge');
    // Two closed subpaths, the inner one wound the other way: that is the hole under the non-zero rule.
    expect(badge.filter(cmd => cmd.op === 'Z')).toHaveLength(2);
    const starts = badge.filter(cmd => cmd.op === 'M');
    expect(starts).toHaveLength(2);
    const outer = badge.slice(badge.indexOf(starts[0]), badge.indexOf(starts[1]));
    const inner = badge.slice(badge.indexOf(starts[1]));
    // The outer path goes right → down → left, the inner one right → up → left, so their windings differ.
    expect((outer[1] as { y: number }).y).toBeGreaterThan((inner[1] as { y: number }).y - 1);
    expect(inner[1].op).toBe('C');
    expect((outer[1] as { y: number }).y).toBeGreaterThan(0);
    expect((inner[1] as { y: number }).y).toBeLessThan(0);
  });

  it('gives a polygon the requested sides and a star the same number of points', () => {
    const hexagon = cmds('polygon', { sides: 6 });
    expect(hexagon.filter(cmd => cmd.op === 'L')).toHaveLength(5);        // M + 5 L + Z
    const octagon = cmds('polygon', { sides: 8 });
    expect(octagon.filter(cmd => cmd.op === 'L')).toHaveLength(7);
    const star = cmds('star', { sides: 5 });
    expect(star.filter(cmd => cmd.op === 'L')).toHaveLength(9);           // 5 points, each with a waist
    // A deeper waist is a pointier star: the *inner* vertices — the first one right after the starting
    // point — sit closer to the centre, while the points themselves keep reaching the box.
    const deep = shapeCommands(style({ type: 'star', sides: 5, innerRadiusPercent: 15 }), 100, 80);
    const shallow = shapeCommands(style({ type: 'star', sides: 5, innerRadiusPercent: 90 }), 100, 80);
    const waist = (list: typeof deep) => { const p = list[1] as { x: number; y: number }; return Math.hypot(p.x, p.y); };
    expect(waist(deep)).toBeLessThan(waist(shallow));
    // 15 % of the radius against 90 % — the waist is a proportion, not a coincidence of the box size.
    expect(waist(shallow)).toBeGreaterThan(waist(deep) * 3);
    expect(bounds(deep).minY).toBeCloseTo(-40, 1);
    expect(bounds(deep).maxX).toBeCloseTo(50, 1);
  });

  it('leaves a line and an arrow open and never filled', () => {
    const line = cmds('line');
    expect(line).toHaveLength(2);
    expect(line[line.length - 1].op).not.toBe('Z');
    expect(shapeIsStrokedOnly('line')).toBe(true);
    expect(shapeHasFill(style({ type: 'line', fillColor: '#ff0000' }))).toBe(false);
    expect(shapeHasFill(style({ type: 'arrow', fillColor: '#ff0000' }))).toBe(false);
    // An arrow's head is part of the same open path, so one stroke draws shaft and barbs together.
    const arrow = cmds('arrow');
    expect(arrow.filter(cmd => cmd.op === 'M')).toHaveLength(2);
    expect(arrow[0]).toEqual({ op: 'M', x: -50, y: 0 });
  });

  it('turns the commands into path data a browser and a PDF both parse', () => {
    const d = shapeSvgPath(cmds('rectangle'));
    expect(d).toBe('M -50 -40 L 50 -40 L 50 40 L -50 40 Z');
    expect(d).not.toMatch(/NaN|Infinity|e\+|e-/);
  });

  it('feeds the same commands to a 2D canvas', () => {
    const calls: string[] = [];
    const ctx = {
      moveTo: vi.fn(() => calls.push('M')), lineTo: vi.fn(() => calls.push('L')),
      bezierCurveTo: vi.fn(() => calls.push('C')), closePath: vi.fn(() => calls.push('Z')),
      beginPath: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    applyShapeCommands(ctx, cmds('circle'));
    expect(calls.join('')).toBe('MCCCCZ');
    applyShapeCommands(ctx, cmds('triangle'));
    expect(calls.slice(6).join('')).toBe('MLLZ');
  });

  it('scales a millimetre corner radius into the units the output uses', () => {
    // The same 4 mm radius in a box measured in pixels (2 px per mm) is 8 px of corner.
    const mm = shapeCommands(style({ type: 'rounded-rect', borderRadius: 4 }), 100, 100, 1);
    const px = shapeCommands(style({ type: 'rounded-rect', borderRadius: 4 }), 200, 200, 2);
    expect(shapeSvgPath(px)).toBe(shapeSvgPath(mm).replace(/[-\d.]+/g, match => String(Number(match) * 2)));
  });
});

describe('shape style', () => {
  it('starts every shape as a hairline outline, because ink is what a print shop draws', () => {
    const style1 = defaultShapeStyle('rectangle');
    expect(style1).toMatchObject({ type: 'rectangle', fillColor: 'transparent', strokeColor: '#000000', strokeWidth: 1, strokeStyle: 'solid', borderRadius: 0 });
    expect(defaultShapeStyle('rounded-rect').borderRadius).toBe(3);
    expect(defaultShapeStyle('polygon').sides).toBe(6);
    expect(defaultShapeStyle('star').sides).toBe(5);
    expect(defaultShapeStyle('line').lineCap).toBe('round');
    expect(defaultShapeStyle('star').type).toBe('star');
  });

  it('knows which controls a type has', () => {
    expect(shapeCapabilities('circle')).toMatchObject({ fill: true, radius: false, sides: false, lockAspect: true });
    expect(shapeCapabilities('rounded-rect').radius).toBe(true);
    expect(shapeCapabilities('star')).toMatchObject({ sides: true, inner: true });
    expect(shapeCapabilities('rectangle')).toMatchObject({ sides: false, cap: false, lockAspect: false });
    expect(shapeCapabilities('arrow')).toMatchObject({ fill: false, cap: true });
  });

  it('accepts only the colours a renderer can be handed', () => {
    expect(sanitizeShapeColor('#F00')).toBe('#ff0000');
    expect(sanitizeShapeColor('#00ff00ff')).toBe('#000000');           // 8-digit, alpha or junk → black
    expect(sanitizeShapeColor('url(#gradient)')).toBe('#000000');
    expect(sanitizeShapeColor('transparent')).toBe('transparent');
    expect(sanitizeShapeColor('none', '#123456')).toBe('transparent');
    expect(sanitizeShapeColor(undefined, '#abcdef')).toBe('#abcdef');
    expect(shapeColorComponents('#ff8000')).toEqual([1, 0.5019607843137255, 0]);
    expect(shapeColorComponents('transparent')).toBeNull();
  });

  it('clamps numbers an edited project file could have carried', () => {
    expect(normalizeShapeStyle({ strokeWidth: 999, sides: 900, opacity: 4, rotation: -370, borderRadius: -5, innerRadiusPercent: 3 })).toMatchObject({
      strokeWidth: 24, sides: 16, opacity: 1, rotation: 350, borderRadius: 0, innerRadiusPercent: 10,
    });
    expect(normalizeShapeStyle({ strokeStyle: 'wobbly' as PageOverlayShape['strokeStyle'] }).strokeStyle).toBe('solid');
    expect(normalizeShapeStyle({ lineCap: 'spiky' as PageOverlayShape['lineCap'] }).lineCap).toBe('butt');
    expect(normalizeShapeStyle({ strokeWidth: NaN }).strokeWidth).toBe(1);
    expect(clampSides('six', 6)).toBe(6);
    expect(clampSides(4.6, 6)).toBe(5);
  });

  it('derives a dash from the stroke width, so a dashed hairline is not a dashed picket fence', () => {
    expect(shapeDashPattern('solid', 2)).toBeUndefined();
    expect(shapeDashPattern('dashed', 2)).toEqual([8, 4]);
    expect(shapeDashPattern('dotted', 2)).toEqual([2, 4]);
    expect(shapeDashPattern('dash-dot', 2)).toEqual([8, 3, 2, 3]);
    expect(shapeDashPattern('dashed', 0)).toBeUndefined();
  });

  it('supports double-headed and vertical arrows while normalizing arrowStyle safely', () => {
    const doubleH = cmds('arrow', { arrowStyle: 'double', lineOrientation: 'horizontal' });
    expect(doubleH.filter(c => c.op === 'M')).toHaveLength(3);
    const verticalDouble = cmds('arrow', { arrowStyle: 'double', lineOrientation: 'vertical' });
    expect(verticalDouble.filter(c => c.op === 'M')).toHaveLength(3);
    expect(verticalDouble[0]).toEqual({ op: 'M', x: 0, y: -40 });
    expect(normalizeShapeStyle({ arrowStyle: 'triple' as PageOverlayShape['arrowStyle'] }).arrowStyle).toBe('single');
  });

  it('uses points for a stroke and millimetres for a radius, and says so in the numbers', () => {
    // 1 pt is 0.3528 mm, and that is the only conversion the export relies on.
    expect(MM_PER_PT).toBeCloseTo(0.352778, 5);
    expect(shapeCommands(style({ type: 'rounded-rect', borderRadius: 10 }), 40, 40, 1).length).toBeGreaterThan(4);
  });
});
