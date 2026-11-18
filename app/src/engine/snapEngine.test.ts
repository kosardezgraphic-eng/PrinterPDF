// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem, PageOverlayImage } from '@shared/models';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { computeImpositionSheets } from './layoutEngine';
import { computeSnapAndGuides, type SnapContext } from './snapEngine';
import { PreviewWorkspace } from '../components/PreviewWorkspace';

function baseCtx(overrides: Partial<SnapContext> = {}): SnapContext {
  return {
    sheetWidthMm: 210,
    sheetHeightMm: 297,
    marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
    rulerGuides: [],
    cells: [{ x: 10, y: 10, width: 190, height: 277 }],
    peerBoxes: [],
    thresholdMm: 3,
    snapEnabled: true,
    smartGuidesEnabled: true,
    ...overrides,
  };
}

describe('snapEngine pure calculations', () => {
  it('magnetically snaps edges and center to ruler guides and emits purple guide lines', () => {
    const ctx = baseCtx({
      rulerGuides: [
        { id: 'gx', axis: 'x', positionMm: 45 },
        { id: 'gy', axis: 'y', positionMm: 75 },
      ],
    });
    const res = computeSnapAndGuides({ x: 43.2, y: 53.4, width: 40, height: 40 }, 'move', ctx);
    expect(res.snappedX).toBe(true);
    expect(res.snappedY).toBe(true);
    expect(res.rectMm.x).toBeCloseTo(45, 5);
    // center Y = 53.4 + 20 = 73.4 -> snaps to ruler guide at 75 => y = 55
    expect(res.rectMm.y).toBeCloseTo(55, 5);
    expect(res.guides.lines.some((l) => l.axis === 'x' && Math.abs(l.positionMm - 45) < 0.01 && l.kind === 'ruler')).toBe(true);
    expect(res.guides.lines.some((l) => l.axis === 'y' && Math.abs(l.positionMm - 75) < 0.01 && l.kind === 'ruler')).toBe(true);
  });

  it('snaps to sheet middle (1/2) and thirds (1/3, 2/3) with corresponding purple labels', () => {
    const ctx = baseCtx({ sheetWidthMm: 300, sheetHeightMm: 300, marginsMm: { top: 0, right: 0, bottom: 0, left: 0 }, cells: [] });
    // Center X = 150, 1/3 Y = 100
    const res = computeSnapAndGuides({ x: 128.8, y: 98.5, width: 40, height: 30 }, 'move', ctx);
    expect(res.rectMm.x).toBeCloseTo(130, 5); // center at 150
    expect(res.rectMm.y).toBeCloseTo(100, 5); // top edge at 100 (1/3)
    expect(res.guides.lines.some((l) => l.axis === 'x' && l.kind === 'center' && l.label === '1/2')).toBe(true);
    expect(res.guides.lines.some((l) => l.axis === 'y' && l.kind === 'third' && l.label === '1/3')).toBe(true);
    expect(res.guides.referenceLines.length).toBeGreaterThanOrEqual(6);
  });

  it('snaps to equal spacing divisions between neighboring peers and emits spacing bars', () => {
    const ctx = baseCtx({
      sheetWidthMm: 200,
      sheetHeightMm: 200,
      marginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
      cells: [],
      peerBoxes: [
        { id: 'p1', x: 20, y: 50, width: 30, height: 40 },
        { id: 'p2', x: 110, y: 50, width: 30, height: 40 },
      ],
    });
    // Available span between p1 (end=50) and p2 (start=110) is 60mm; item width=20mm -> equal 20mm gaps at x=70
    const res = computeSnapAndGuides({ x: 68.4, y: 50, width: 20, height: 40 }, 'move', ctx);
    expect(res.snappedX).toBe(true);
    expect(res.rectMm.x).toBeCloseTo(70, 5);
    const xBars = res.guides.spacings.filter((s) => s.axis === 'x');
    expect(xBars.length).toBeGreaterThanOrEqual(2);
    expect(xBars.some((b) => Math.abs(b.gapMm - 20) < 0.05)).toBe(true);
  });

  it('snaps sequentially to match existing gap between two peers (A |<d>| B |<d>| C)', () => {
    const ctx = baseCtx({
      sheetWidthMm: 240,
      sheetHeightMm: 200,
      marginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
      cells: [],
      peerBoxes: [
        { id: 'a', x: 10, y: 40, width: 30, height: 30 },
        { id: 'b', x: 55, y: 40, width: 30, height: 30 }, // gap = 15mm, ends at 85 -> next at 100
      ],
    });
    const res = computeSnapAndGuides({ x: 98.2, y: 40, width: 30, height: 30 }, 'move', ctx);
    expect(res.snappedX).toBe(true);
    expect(res.rectMm.x).toBeCloseTo(100, 5);
    expect(res.guides.spacings.some((s) => s.axis === 'x' && Math.abs(s.gapMm - 15) < 0.05)).toBe(true);
  });

  it('snaps active resize edge to margin/third targets and respects snapEnabled=false / smartGuidesEnabled=false', () => {
    const ctx = baseCtx({
      sheetWidthMm: 300,
      sheetHeightMm: 300,
      marginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
      cells: [],
      rulerGuides: [{ id: 'g1', axis: 'x', positionMm: 120 }],
    });
    const snappedResize = computeSnapAndGuides({ x: 20, y: 20, width: 98.4, height: 50 }, 'resize', ctx, 'e', false);
    expect(snappedResize.snappedX).toBe(true);
    expect(snappedResize.rectMm.width).toBeCloseTo(100, 5); // right edge snaps to 120

    const noSnap = computeSnapAndGuides(
      { x: 20, y: 20, width: 98.4, height: 50 },
      'resize',
      { ...ctx, snapEnabled: false },
      'e',
      false,
    );
    expect(noSnap.snappedX).toBe(false);
    expect(noSnap.rectMm.width).toBeCloseTo(98.4, 5);

    const noGuides = computeSnapAndGuides(
      { x: 20, y: 20, width: 98.4, height: 50 },
      'resize',
      { ...ctx, smartGuidesEnabled: false },
      'e',
      false,
    );
    expect(noGuides.snappedX).toBe(true);
    expect(noGuides.rectMm.width).toBeCloseTo(100, 5);
    expect(noGuides.guides.lines).toHaveLength(0);
    expect(noGuides.guides.spacings).toHaveLength(0);
    expect(noGuides.guides.referenceLines).toHaveLength(0);
  });
});

describe('Magnetic Snap & Purple Smart Guides UI integration', () => {
  const makePage = (id: string): PageItem => ({
    id,
    documentId: 'd',
    documentName: 'd',
    sourcePageNumber: 1,
    widthMm: 40,
    heightMm: 40,
    rotation: 0,
    selectedForPrint: true,
    isHighlighted: true,
    isBlankPage: false,
    colorProfile: 'color',
    inkCoveragePercent: 0,
    thumbnailDataUrl: 'data:image/png;base64,AA==',
  });

  let container: HTMLDivElement;
  let root: Root;

  function pointer(el: Element, type: string, x: number, y: number) {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(ev, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
    act(() => el.dispatchEvent(ev));
  }

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
    useAppStore.setState({
      pages: [makePage('p1')],
      documents: [],
      overlays: [],
      selectedOverlayId: null,
      settings: { ...DEFAULT_SETTINGS, language: 'fa', unit: 'mm' },
      zoomPercent: 100,
      snapEnabled: true,
      smartGuidesEnabled: true,
      layout: {
        ...DEFAULT_LAYOUT,
        paperSize: 'Custom',
        customWidthMm: 200,
        customHeightMm: 200,
        rows: 1,
        cols: 1,
        sheetOrder: 'ltr',
        duplexMode: 'none',
        autoRotateToFit: false,
        marginsMm: { top: 0, bottom: 0, left: 0, right: 0 },
        horizontalGutterMm: 0,
        verticalGutterMm: 0,
        rulerGuides: [{ id: 'rg-1', axis: 'x', positionMm: 40 }],
      },
      activeSheetIndex: 0,
      viewMode: 'single',
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(React.createElement(PreviewWorkspace, { onCursorMoveMm: () => {} })));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('snaps a cell magnetically while dragging, shows purple smart guides temporarily, and clears them on release', () => {
    const content = container.querySelector('[data-canvas-page-id="p1"] [data-page-content]') as HTMLElement;
    act(() => content.click());
    // Default 1x1 fill/fit on 200x200 sheet fills 200x200; shrink to 40x40 at x=0,y=0 first via transform
    const cell = computeImpositionSheets(useAppStore.getState().pages, useAppStore.getState().layout)[0].cells[0];
    act(() => useAppStore.getState().applyCellTransform('p1', cell.occurrenceKey!, {
      x: (20 - cell.cellWidthMm / 2) / cell.cellWidthMm,
      y: (20 - cell.cellHeightMm / 2) / cell.cellHeightMm,
      scaleX: 0.2,
      scaleY: 0.2,
      rotationDeg: 0,
    }));

    // At 100% zoom, PREVIEW_PX_PER_MM = 1.95. Sheet is 200x200mm; box starts at x=0,y=0,w=40,h=40.
    // Drag right by ~38.5mm (75.075px), within 2.8mm of ruler guide x=40mm!
    expect(container.querySelector('[data-smart-guides-overlay]')).toBeNull();
    pointer(content, 'pointerdown', 10, 10);
    pointer(content, 'pointermove', 10 + 38.5 * 1.95, 10 + 78.5 * 1.95);

    const overlay = container.querySelector('[data-smart-guides-overlay]');
    expect(overlay).not.toBeNull();
    expect(container.querySelector('[data-smart-guide-line="x"]')).not.toBeNull();
    expect(container.querySelector('[data-smart-guide-ref]')).not.toBeNull();
    expect(container.querySelector('[data-smart-spacing-guide]')).not.toBeNull();

    pointer(content, 'pointerup', 10 + 38.5 * 1.95, 10 + 78.5 * 1.95);

    // Smart guides must disappear immediately upon release!
    expect(container.querySelector('[data-smart-guides-overlay]')).toBeNull();
    const afterCell = computeImpositionSheets(useAppStore.getState().pages, useAppStore.getState().layout)[0].cells[0];
    expect(afterCell.contentXMm).toBeCloseTo(40, 1);
    // Y moved near 78.5mm -> center at 98.5mm -> snaps to sheet middle 100mm -> top at 80mm
    expect(afterCell.contentYMm).toBeCloseTo(80, 1);
  });

  it('toggles Snap and Purple Smart Guides independently from canvas toolbar buttons', () => {
    const snapBtn = container.querySelector('[data-snap-toggle]') as HTMLButtonElement;
    const guidesBtn = container.querySelector('[data-smart-guides-toggle]') as HTMLButtonElement;
    expect(snapBtn).not.toBeNull();
    expect(guidesBtn).not.toBeNull();
    expect(snapBtn.getAttribute('aria-pressed')).toBe('true');
    expect(guidesBtn.getAttribute('aria-pressed')).toBe('true');

    // Disable magnetic snap, keep purple guides enabled
    act(() => snapBtn.click());
    expect(useAppStore.getState().snapEnabled).toBe(false);
    expect(snapBtn.getAttribute('aria-pressed')).toBe('false');

    // Also add an image overlay and drag it near ruler guide x=40mm without snapping
    const imgOverlay: PageOverlayImage = {
      id: 'img-1',
      kind: 'image',
      target: 'sheet',
      targetScope: 'all',
      targetPageIds: [],
      targetSheetIndex: 1,
      xPercent: 5, // 10mm on 200mm sheet
      yPercent: 5,
      widthPercent: 20, // 40mm
      heightPercent: 20,
      rotation: 0,
      opacity: 1,
      src: 'data:image/png;base64,AA==',
      name: 'test.png',
      naturalWidth: 100,
      naturalHeight: 100,
      fit: 'fill',
      lockAspect: true,
    };
    act(() => useAppStore.setState({ overlays: [imgOverlay], selectedOverlayId: 'img-1' }));

    const overlayEl = container.querySelector('[data-overlay-id="img-1"]') as HTMLElement;
    expect(overlayEl).not.toBeNull();

    // Drag right by +28.5mm -> x should be 38.5mm (NOT snapped to 40mm since snapEnabled=false)
    pointer(overlayEl, 'pointerdown', 20, 20);
    pointer(overlayEl, 'pointermove', 20 + 28.5 * 1.95, 20);
    pointer(overlayEl, 'pointerup', 20 + 28.5 * 1.95, 20);
    const updatedImg = useAppStore.getState().overlays.find((o) => o.id === 'img-1')!;
    expect((updatedImg.xPercent / 100) * 200).toBeCloseTo(38.5, 1);

    // Disable purple smart guides and verify overlay never appears during drag
    act(() => guidesBtn.click());
    expect(useAppStore.getState().smartGuidesEnabled).toBe(false);
    expect(guidesBtn.getAttribute('aria-pressed')).toBe('false');

    const content = container.querySelector('[data-canvas-page-id="p1"] [data-page-content]') as HTMLElement;
    act(() => content.click());
    pointer(content, 'pointerdown', 10, 10);
    pointer(content, 'pointermove', 50, 50);
    expect(container.querySelector('[data-smart-guides-overlay]')).toBeNull();
    pointer(content, 'pointerup', 50, 50);
  });
});
