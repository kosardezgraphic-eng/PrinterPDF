/**
 * The eraser's geometry and the two things it promises: the picture's file survives, and a second press of
 * any "invert" button is the way back — never a second inversion.
 *
 * Runs in the plain node environment on purpose. Every number here is what a renderer is handed, and the
 * renderers themselves (Canvas 2D, CSS masks, pdf-lib) are covered by the UI test and cannot be exercised
 * without a browser; a maths module that is tested with maths alone stays honest about that.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sanitizeEraseShapes,
  type EraseShape,
  type PageItem,
  type PageOverlayImage,
} from '@shared/models';
import {
  DEFAULT_EFFECTS,
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  useAppStore,
} from '../store/useAppStore';
import {
  beginEraseShape,
  commitEraseShape,
  eraseMaskCss,
  eraseMaskSvg,
  eraseParts,
  eraseShapeBounds,
  eraseShapeIsMeaningful,
  eraseShapeParts,
  eraseSignature,
  growEraseShape,
  popEraseShape,
  ERASE_REGION_MIN_PERCENT,
  ERASE_SAMPLE_PERCENT,
} from './imageErase';

const box = { width: 100, height: 50, widthMm: 100, heightMm: 50 };

describe('erase gesture geometry', () => {
  it('starts a brush with the dot under the pointer and a region with no size at all', () => {
    expect(beginEraseShape('brush', { x: 12, y: 8 }, 3)).toEqual({ mode: 'brush', radiusMm: 3, points: [{ x: 12, y: 8 }] });
    expect(beginEraseShape('region', { x: 12, y: 8 }, 3)).toEqual({ mode: 'region', x: 12, y: 8, width: 0, height: 0 });
  });

  it('ignores pointer samples closer than one dot of the brush', () => {
    const start = beginEraseShape('brush', { x: 10, y: 10 }, 2);
    expect(growEraseShape(start, { x: 10, y: 10 }, { x: 10 + ERASE_SAMPLE_PERCENT / 2, y: 10 })).toBe(start);
    const far = growEraseShape(start, { x: 10, y: 10 }, { x: 20, y: 10 });
    expect(far.mode === 'brush' && far.points).toEqual([{ x: 10, y: 10 }, { x: 20, y: 10 }]);
  });

  it('rebuilds a marquee from the anchor, so dragging back across the start flips its side', () => {
    const start = beginEraseShape('region', { x: 40, y: 40 }, 0);
    const down = growEraseShape(start, { x: 40, y: 40 }, { x: 70, y: 60 });
    expect(down).toMatchObject({ x: 40, y: 40, width: 30, height: 20 });
    expect(growEraseShape(down, { x: 40, y: 40 }, { x: 20, y: 30 })).toMatchObject({ x: 20, y: 30, width: 20, height: 10 });
  });

  it('treats a click without travel as a click, not as a hole', () => {
    expect(eraseShapeIsMeaningful(beginEraseShape('region', { x: 5, y: 5 }, 0))).toBe(false);
    expect(eraseShapeIsMeaningful({ mode: 'region', x: 5, y: 5, width: ERASE_REGION_MIN_PERCENT, height: 0.1 })).toBe(false);
    expect(eraseShapeIsMeaningful({ mode: 'region', x: 5, y: 5, width: 30, height: 20 })).toBe(true);
    expect(eraseShapeIsMeaningful(beginEraseShape('brush', { x: 5, y: 5 }, 4))).toBe(true);
  });

  it('appends a committed gesture and takes the last one back', () => {
    const first: EraseShape = { mode: 'region', x: 0, y: 0, width: 10, height: 10 };
    const second: EraseShape = { mode: 'region', x: 20, y: 0, width: 10, height: 10 };
    const list = commitEraseShape(commitEraseShape(undefined, first), second);
    expect(list).toEqual([first, second]);
    expect(popEraseShape(list)).toEqual([first]);
    expect(popEraseShape(popEraseShape(list))).toEqual([]);
    expect(popEraseShape(undefined)).toEqual([]);
  });

  it('turns a millimetre brush into an ellipse per sampled point, and a region into one rectangle', () => {
    // A box twice as wide as it is tall, so a round brush has to become a wide ellipse in the mask.
    const parts = eraseShapeParts({ mode: 'brush', radiusMm: 5, points: [{ x: 50, y: 50 }] }, { width: 200, height: 100, widthMm: 200, heightMm: 100 });
    expect(parts.holes).toEqual([{ cx: 100, cy: 50, rx: 5, ry: 5 }]);
    const stretched = eraseShapeParts({ mode: 'brush', radiusMm: 5, points: [{ x: 50, y: 50 }] }, { width: 100, height: 100, widthMm: 50, heightMm: 50 });
    expect(stretched.holes[0]).toMatchObject({ rx: 10, ry: 10 });
    expect(eraseShapeParts({ mode: 'region', x: 10, y: 20, width: 30, height: 40 }, box).rects)
      .toEqual([{ x: 10, y: 10, width: 30, height: 20 }]);
  });

  it('reports the box a gesture covers, brush diameter included', () => {
    const bounds = eraseShapeBounds({ mode: 'brush', radiusMm: 10, points: [{ x: 20, y: 20 }, { x: 60, y: 20 }] }, { widthMm: 100, heightMm: 100 });
    expect(bounds).toMatchObject({ x: 10, y: 10, width: 60, height: 20 });
  });
});

describe('the mask the preview cuts and the paper sees', () => {
  it('is absent while there is nothing to erase', () => {
    expect(eraseMaskSvg(undefined, box)).toBeUndefined();
    expect(eraseMaskCss([], box)).toBeUndefined();
  });

  it('is a luminance mask with a hole per gesture, in a viewBox of the picture box', () => {
    const svg = eraseMaskSvg([{ mode: 'region', x: 10, y: 10, width: 20, height: 20 }, { mode: 'brush', radiusMm: 5, points: [{ x: 50, y: 50 }] }], box)!;
    expect(svg).toContain('viewBox="0 0 100 50"');
    expect(svg).toContain('<rect width="100" height="50" fill="#fff"/><g fill="#000">');
    expect(svg).toContain('<rect x="10" y="5" width="20" height="10"/>');
    expect(svg).toContain('<ellipse cx="50" cy="25"');
    expect(svg).toContain('mask="url(#e)"');
    expect(eraseMaskCss([{ mode: 'region', x: 1, y: 1, width: 5, height: 5 }], box)!).toMatch(/^url\("data:image\/svg\+xml,%3Csvg/);
  });

  it('shares one geometry with the mask, so a region and its preview band cannot drift', () => {
    const shape: EraseShape = { mode: 'region', x: 25, y: 50, width: 25, height: 25 };
    expect(eraseParts([shape], box).rects).toEqual(eraseShapeParts(shape, box).rects);
  });
});

describe('junk in a project file', () => {
  it('keeps what it can read and drops what no renderer could draw', () => {
    const clean = sanitizeEraseShapes([
      null, 'nope', { mode: 'region' }, { mode: 'brush', radiusMm: 2, points: [] },
      { mode: 'region', x: 1e9, y: Number.NaN, width: 40, height: 30 },
      { mode: 'brush', radiusMm: -4, points: [{ x: 1, y: 2 }, { x: '3', y: 4 }, { x: 5, y: 6 }] },
      { mode: 'else' },
    ]);
    expect(clean).toEqual([
      // A percentage outside the sane band is pulled back to its edge, a value that is not a number at all
      // becomes zero — and none of this is silently dropped, because a hole the operator did draw must stay.
      { mode: 'region', x: 300, y: 0, width: 40, height: 30 },
      { mode: 'brush', radiusMm: 4, points: [{ x: 1, y: 2 }, { x: 5, y: 6 }] },
    ]);
  });

  it('caps a pathological file instead of freezing the page', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ mode: 'brush' as const, radiusMm: 1, points: Array.from({ length: 1200 }, (_, j) => ({ x: j, y: i })) }));
    const clean = sanitizeEraseShapes(many as unknown as EraseShape[]);
    expect(clean).toHaveLength(240);
    expect(clean[0]!.mode === 'brush' && clean[0]!.points).toHaveLength(900);
  });
});

describe('the erase signature an export bitmap is cached under', () => {
  it('is empty when there is nothing to cut and stable for the same strokes', () => {
    expect(eraseSignature(undefined)).toBe('');
    expect(eraseSignature([])).toBe('');
    const stroke: EraseShape = { mode: 'brush', radiusMm: 2, points: [{ x: 1, y: 1 }, { x: 9, y: 9 }] };
    expect(eraseSignature([stroke])).toBe(eraseSignature([{ ...stroke, points: [...stroke.points] }]));
    expect(eraseSignature([stroke])).not.toBe(eraseSignature([{ ...stroke, radiusMm: 3 }]));
  });
});

const image = (overrides: Partial<PageOverlayImage> = {}): PageOverlayImage => ({
  id: 'i1', kind: 'image', target: 'sheet', targetScope: 'all', targetPageIds: [], targetSheetIndex: 1,
  xPercent: 10, yPercent: 10, widthPercent: 40, heightPercent: 20, opacity: 1, rotation: 0,
  src: 'data:image/png;base64,AAE=', name: 'logo', naturalWidth: 400, naturalHeight: 200, fit: 'fill', ...overrides,
});
const page = (id: string, overrides: Partial<PageItem> = {}): PageItem => ({
  id, documentId: 'd1', documentName: 'd1', sourcePageNumber: 1, widthMm: 200, heightMm: 300, rotation: 0,
  isHighlighted: false, selectedForPrint: true, isBlankPage: false, colorProfile: 'color', inkCoveragePercent: 0, ...overrides,
});
const overlay = () => useAppStore.getState().overlays[0] as PageOverlayImage;
const invertOf = (id: string) => useAppStore.getState().pages.find(p => p.id === id)!.overrides?.invert;

beforeEach(() => {
  useAppStore.setState({
    settings: { ...DEFAULT_SETTINGS, language: 'en' },
    layout: { ...DEFAULT_LAYOUT },
    effects: { ...DEFAULT_EFFECTS },
    documents: [], pages: [], overlays: [], selectedOverlayId: null,
  } as never);
  vi.spyOn(useAppStore.getState(), 'addToast').mockImplementation(() => {});
});

describe('erasing a picture from the store', () => {
  it('keeps the file and the rest of the overlay untouched while the hole is recorded', () => {
    useAppStore.getState().addOverlay(image());
    const stroke: EraseShape = { mode: 'region', x: 5, y: 5, width: 30, height: 20 };
    useAppStore.getState().setOverlayErase('i1', [stroke]);
    expect(overlay().erase).toEqual([stroke]);
    expect(overlay().src).toBe('data:image/png;base64,AAE=');
    expect(overlay().widthPercent).toBe(40);
  });

  it('gives a whole gesture back on one undo, and takes it again on redo', () => {
    useAppStore.getState().addOverlay(image());
    useAppStore.getState().setOverlayErase('i1', [{ mode: 'region', x: 5, y: 5, width: 30, height: 20 }]);
    useAppStore.getState().setOverlayErase('i1', [
      { mode: 'region', x: 5, y: 5, width: 30, height: 20 },
      { mode: 'brush', radiusMm: 4, points: [{ x: 10, y: 10 }, { x: 60, y: 30 }] },
    ]);
    expect(overlay().erase).toHaveLength(2);
    useAppStore.getState().undo();
    expect(overlay().erase).toHaveLength(1);
    useAppStore.getState().undo();
    expect(overlay().erase).toBeUndefined();
    useAppStore.getState().redo();
    expect(overlay().erase).toHaveLength(1);
  });

  it('restores the picture by clearing the list, and spends no undo step on a stroke that changes nothing', () => {
    useAppStore.getState().addOverlay(image({ erase: [{ mode: 'region', x: 5, y: 5, width: 30, height: 20 }] }));
    useAppStore.getState().setOverlayErase('i1', []);
    expect(overlay().erase).toBeUndefined();
    const label = useAppStore.getState().undoLabel;
    expect(label).toBe('Restore the picture');
    // A second press of a button with nothing left to restore must not add another step to the history:
    // the operator would have to press Ctrl+Z twice to get one stroke back.
    useAppStore.getState().setOverlayErase('i1', []);
    expect(useAppStore.getState().undoLabel).toBe(label);
    useAppStore.getState().undo();
    expect(overlay().erase).toHaveLength(1);
  });

  it('ignores a gesture aimed at a text layer or a missing picture', () => {
    useAppStore.getState().setOverlayErase('nope', [{ mode: 'region', x: 0, y: 0, width: 10, height: 10 }]);
    expect(useAppStore.getState().overlays).toHaveLength(0);
    useAppStore.getState().addOverlay(image());
    useAppStore.getState().setOverlayErase('i1', [{ mode: 'region', x: 0, y: 0, width: 10, height: 10 }, { mode: 'nonsense' } as never]);
    expect(overlay().erase).toHaveLength(1);
  });

  it('survives a project save and reload with the holes and the inversion still on it', async () => {
    useAppStore.getState().addOverlay(image());
    useAppStore.getState().setOverlayErase('i1', [{ mode: 'brush', radiusMm: 6, points: [{ x: 20, y: 20 }, { x: 70, y: 40 }] }]);
    useAppStore.getState().toggleOverlayInvert(['i1']);
    // The project file holds `state.overlays` as it is, so the two new fields travel with it verbatim.
    const text = JSON.stringify({ layout: DEFAULT_LAYOUT, pages: [], documents: [], overlays: useAppStore.getState().overlays });
    useAppStore.setState({ overlays: [] } as never);
    await useAppStore.getState().openPspProjectFile({ text: async () => text } as unknown as File);
    expect(overlay().invert).toBe(true);
    expect(overlay().erase).toEqual([{ mode: 'brush', radiusMm: 6, points: [{ x: 20, y: 20 }, { x: 70, y: 40 }] }]);
  });

  it('reads a hand-written or damaged file without inventing a hole the operator never drew', async () => {
    const junk = [{ mode: 'region', x: 5, y: 5, width: 900, height: 20 }, 'rubbish'] as unknown as EraseShape[];
    const text = JSON.stringify({ layout: DEFAULT_LAYOUT, pages: [], documents: [], overlays: [image({ erase: junk })] });
    await useAppStore.getState().openPspProjectFile({ text: async () => text } as unknown as File);
    // Percentages are clamped into a sane band (a rectangle wider than the sheet is a corrupted file, not a
    // marquee) and entries no renderer could draw are dropped rather than guessed at.
    expect(sanitizeEraseShapes(overlay().erase)).toEqual([{ mode: 'region', x: 5, y: 5, width: 500, height: 20 }]);
  });
});

describe('the picture invert button', () => {
  it('is the way back, not a second inversion', () => {
    useAppStore.getState().addOverlay(image());
    useAppStore.getState().toggleOverlayInvert(['i1']);
    expect(overlay().invert).toBe(true);
    useAppStore.getState().toggleOverlayInvert(['i1']);
    expect(overlay().invert).toBe(false);
    useAppStore.getState().toggleOverlayInvert(['i1']);
    expect(overlay().invert).toBe(true);
  });

  it('leaves no mix behind when the selection was half inverted', () => {
    useAppStore.getState().addOverlay(image({ id: 'i1' }));
    useAppStore.getState().addOverlay(image({ id: 'i2', invert: true }));
    useAppStore.getState().toggleOverlayInvert(['i1', 'i2']);
    expect(useAppStore.getState().overlays.map(o => (o as PageOverlayImage).invert)).toEqual([true, true]);
    useAppStore.getState().toggleOverlayInvert(['i1', 'i2']);
    expect(useAppStore.getState().overlays.map(o => (o as PageOverlayImage).invert)).toEqual([false, false]);
  });

  it('acts on the selected layer when no id is given, and not on text', () => {
    useAppStore.setState({ overlays: [image(), { ...image(), id: 't1', kind: 'text' } as never], selectedOverlayId: 'i1' });
    useAppStore.getState().toggleOverlayInvert();
    expect(overlay().invert).toBe(true);
    expect(useAppStore.getState().overlays[1]).not.toMatchObject({ invert: true });
    useAppStore.setState({ selectedOverlayId: null });
    useAppStore.getState().toggleOverlayInvert();
    expect(useAppStore.getState().overlays.map(o => (o as PageOverlayImage).invert)).toEqual([true, undefined]);
  });
});

describe('the page invert button', () => {
  it('presses back to the state the page had, without leaving an override behind', () => {
    useAppStore.setState({ pages: [page('a'), page('b')] });
    useAppStore.getState().togglePagesInvertOverride(['a']);
    expect(invertOf('a')).toBe(true);
    expect(invertOf('b')).toBeUndefined();
    useAppStore.getState().togglePagesInvertOverride(['a']);
    // Not `false`: the page had nothing of its own to say before, and a stored `false` would quietly
    // exclude it from any global invert the operator turns on afterwards.
    expect(invertOf('a')).toBeUndefined();
    expect(useAppStore.getState().pages[0].overrides).toBeUndefined();             // and no empty object is left behind in the file
  });

  it('returns an inverted page to inverted when the global switch is the one inverting it', () => {
    useAppStore.setState({ pages: [page('a')], effects: { ...DEFAULT_EFFECTS, enabled: true, scope: 'all', invert: true } });
    expect(invertOf('a')).toBeUndefined();
    useAppStore.getState().togglePagesInvertOverride(['a']);
    expect(invertOf('a')).toBe(false);
    useAppStore.getState().togglePagesInvertOverride(['a']);
    expect(invertOf('a')).toBeUndefined();
  });

  it('inverts a page that only the global switch had inverted, on the very first press', () => {
    useAppStore.setState({ pages: [page('a')], effects: { ...DEFAULT_EFFECTS, enabled: true, scope: 'all', invert: true } });
    useAppStore.getState().togglePagesInvertOverride(['a']);
    expect(invertOf('a')).toBe(false);
  });

  it('unifies a mixed selection in one press and clears the lot in the next', () => {
    useAppStore.setState({ pages: [page('a', { overrides: { invert: true } }), page('b'), page('c')] });
    useAppStore.getState().togglePagesInvertOverride(['a', 'b', 'c']);
    expect([invertOf('a'), invertOf('b'), invertOf('c')]).toEqual([true, true, true]);
    useAppStore.getState().togglePagesInvertOverride(['a', 'b', 'c']);
    expect([invertOf('a'), invertOf('b'), invertOf('c')]).toEqual([undefined, undefined, undefined]);
  });

  it('drops an exclusion that has nothing left to exclude', () => {
    useAppStore.setState({ pages: [page('a', { overrides: { invert: false } })], effects: { ...DEFAULT_EFFECTS, enabled: true, scope: 'all', invert: true } });
    // The page is showing an un-inverted sheet while the document says inverted. Pressing the button asks for
    // inverted, which is what inheritance already gives — so the override disappears instead of being written,
    // and the next press has to bring the exclusion back for the page to look the way it did.
    useAppStore.getState().togglePagesInvertOverride(['a']);
    expect(invertOf('a')).toBeUndefined();
    useAppStore.getState().togglePagesInvertOverride(['a']);
    expect(invertOf('a')).toBe(false);
  });

  it('treats a page outside the effects scope as not inverted', () => {
    useAppStore.setState({ pages: [page('a', { isHighlighted: false })], effects: { ...DEFAULT_EFFECTS, enabled: true, scope: 'selected', invert: true } });
    useAppStore.getState().togglePagesInvertOverride(['a']);
    expect(invertOf('a')).toBe(true);
  });

  it('is undone as one step, whatever the press did to the selection', () => {
    useAppStore.setState({ pages: [page('a'), page('b')] });
    useAppStore.getState().togglePagesInvertOverride(['a', 'b']);
    useAppStore.getState().undo();
    expect([invertOf('a'), invertOf('b')]).toEqual([undefined, undefined]);
    useAppStore.getState().redo();
    expect([invertOf('a'), invertOf('b')]).toEqual([true, true]);
  });

  it('flips the document switch itself back and forth', () => {
    expect(useAppStore.getState().effects.invert).toBe(false);
    useAppStore.getState().toggleGlobalInvert();
    expect(useAppStore.getState().effects.invert).toBe(true);
    expect(useAppStore.getState().effects.enabled).toBe(true);
    useAppStore.getState().toggleGlobalInvert();
    expect(useAppStore.getState().effects.invert).toBe(false);
  });
});
