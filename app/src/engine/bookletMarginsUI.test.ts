// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem } from '@shared/models';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { BookletControlPanel } from '../components/BookletControlPanel';
import { PreviewWorkspace } from '../components/PreviewWorkspace';
import { Ribbon } from '../components/Ribbon';
import { PREVIEW_PX_PER_MM } from './viewNavigation';

const makePages = (count: number): PageItem[] =>
  Array.from({ length: count }, (_, idx) => ({
    id: `bk-p-${idx + 1}`,
    documentId: 'bk-doc',
    documentName: 'booklet.pdf',
    sourcePageNumber: idx + 1,
    widthMm: 148,
    heightMm: 210,
    rotation: 0,
    selectedForPrint: true,
    isHighlighted: idx === 0,
    isBlankPage: false,
    colorProfile: 'grayscale',
    inkCoveragePercent: 18,
    thumbnailDataUrl: 'data:image/png;base64,AA==',
  }));

function dispatchPointer(el: Element, type: string, x: number, y: number) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(ev, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  act(() => {
    el.dispatchEvent(ev);
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('booklet margin behavior parity with spine gap', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
    useAppStore.setState({
      pages: makePages(4),
      documents: [],
      layout: {
        ...DEFAULT_LAYOUT,
        paperSize: 'A4',
        marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
        booklet: {
          enabled: true,
          direction: 'rtl',
          signatureSize: 0,
          spineWidthMm: 4,
          creepMm: 0,
          duplexMode: 'short-edge',
          outerMarginMm: 10,
          compensateCreep: false,
        },
      },
      settings: { ...DEFAULT_SETTINGS, language: 'en', unit: 'mm' },
      activeRibbonTab: 'layout',
      activeSheetIndex: 0,
      viewMode: 'single',
      zoomPercent: 100,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Ribbon, { onOpenWatermarkPanel: () => {}, onOpenBookletPanel: () => {} }),
          React.createElement(PreviewWorkspace, { onCursorMoveMm: () => {} }),
          React.createElement(BookletControlPanel, { onClose: () => {} }),
        ),
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('provides independent per-side margin sliders and separate Spine and fold control in BookletControlPanel', () => {
    const panel = container.querySelector('[data-booklet-control-panel]')!;
    const topSlider = panel.querySelector<HTMLInputElement>('[data-booklet-margin-slider="top"]')!;
    const spineSlider = panel.querySelector<HTMLInputElement>('input[type="range"]:not([data-booklet-margin-slider])')!;
    expect(topSlider).toBeTruthy();
    expect(spineSlider).toBeTruthy();

    const firstPage = () => container.querySelectorAll<HTMLElement>('[data-page-content]')[0];
    const beforeTop = parseFloat(firstPage().style.top);
    const beforeWidth = parseFloat(firstPage().style.width);

    // Changing only Top margin changes marginsMm.top alone and leaves right/bottom/left and spineWidthMm intact.
    setInputValue(topSlider, '32');
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 32, right: 10, bottom: 10, left: 10 });
    expect(useAppStore.getState().layout.booklet?.spineWidthMm).toBe(4);
    expect(parseFloat(firstPage().style.top)).toBeGreaterThan(beforeTop);
    expect(parseFloat(firstPage().style.width)).toBeLessThan(beforeWidth);

    const spineGuide = container.querySelector<HTMLElement>('[data-booklet-spine-guide]')!;
    expect(parseFloat(spineGuide.style.top)).toBeCloseTo(32 * PREVIEW_PX_PER_MM);
    expect(parseFloat(spineGuide.style.bottom)).toBeCloseTo(10 * PREVIEW_PX_PER_MM);
    expect(parseFloat(spineGuide.style.width)).toBeCloseTo(4 * PREVIEW_PX_PER_MM);

    // Changing Spine and fold affects only the middle gap width and leaves all 4 margins unchanged.
    setInputValue(spineSlider, '14');
    expect(useAppStore.getState().layout.booklet?.spineWidthMm).toBe(14);
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 32, right: 10, bottom: 10, left: 10 });
    expect(parseFloat(container.querySelector<HTMLElement>('[data-booklet-spine-guide]')!.style.width)).toBeCloseTo(14 * PREVIEW_PX_PER_MM);
  });

  it('syncs Ribbon margin inputs per side without changing the other three sides or spineWidthMm', () => {
    const beforeTop = parseFloat(container.querySelectorAll<HTMLElement>('[data-page-content]')[0].style.top);
    const topLabel = Array.from(container.querySelectorAll('label')).find(
      el => el.getAttribute('title') === 'top margin (mm)',
    )!;
    const topInput = topLabel.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(topInput.value).toBe('10');

    setInputValue(topInput, '28');
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 28, right: 10, bottom: 10, left: 10 });
    expect(useAppStore.getState().layout.booklet?.spineWidthMm).toBe(4);
    expect(topInput.value).toBe('28');
    expect(parseFloat(container.querySelectorAll<HTMLElement>('[data-page-content]')[0].style.top)).toBeGreaterThan(beforeTop);
  });

  it('resizes and moves booklet page images independently per side when dragging direct borders, spine guide, or LayoutGuides handles', () => {
    const firstPageContent = () => container.querySelectorAll<HTMLElement>('[data-page-content]')[0];
    const initialTop = parseFloat(firstPageContent().style.top);
    const initialWidth = parseFloat(firstPageContent().style.width);

    // 1. Dragging ONLY the top direct border guide changes only marginsMm.top
    const topEdge = container.querySelector<HTMLElement>('[data-booklet-margin-guide="top"]')!;
    const deltaPx = 12 * PREVIEW_PX_PER_MM;
    dispatchPointer(topEdge, 'pointerdown', 100, 100);
    dispatchPointer(topEdge, 'pointermove', 100, 100 + deltaPx);
    expect(parseFloat(firstPageContent().style.top)).toBeGreaterThan(initialTop);
    expect(parseFloat(firstPageContent().style.width)).toBeLessThan(initialWidth);
    dispatchPointer(topEdge, 'pointerup', 100, 100 + deltaPx);
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 22, right: 10, bottom: 10, left: 10 });
    expect(useAppStore.getState().layout.booklet?.spineWidthMm).toBe(4);

    // 2. Undo reverts only that drag in one step
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });

    // 3. LayoutGuides green Left handle updates ONLY left margin, and purple gutter handle updates ONLY spineWidthMm
    act(() => (container.querySelector('[data-sheet-canvas-index]') as HTMLElement).click());
    const overlay = container.querySelector<HTMLElement>('[data-layout-guides]')!;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 297,
      bottom: 210,
      width: 297,
      height: 210,
      toJSON: () => ({}),
    });
    const leftHandle = container.querySelector('[aria-label="Left margin"]')!;
    dispatchPointer(leftHandle, 'pointerdown', 10, 50);
    dispatchPointer(leftHandle, 'pointermove', 18, 50);
    dispatchPointer(leftHandle, 'pointerup', 18, 50);
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 10, right: 10, bottom: 10, left: 18 });
    expect(useAppStore.getState().layout.booklet?.spineWidthMm).toBe(4);

    const spineHandle = container.querySelector('[aria-label^="Column gutter"]')!;
    dispatchPointer(spineHandle, 'pointerdown', 150, 70);
    dispatchPointer(spineHandle, 'pointermove', 155, 70);
    dispatchPointer(spineHandle, 'pointerup', 155, 70);
    expect(useAppStore.getState().layout.booklet?.spineWidthMm).toBe(14);
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 10, right: 10, bottom: 10, left: 18 });
  });

  it('allows freely moving and resizing a booklet sheet image with pointer drag and resize handles', () => {
    const firstPageContent = () => container.querySelectorAll<HTMLElement>('[data-page-content]')[0];
    const startLeft = parseFloat(firstPageContent().style.left);
    const startTop = parseFloat(firstPageContent().style.top);
    const startWidth = parseFloat(firstPageContent().style.width);
    const startHeight = parseFloat(firstPageContent().style.height);

    // Click the image to select it and reveal resize handles
    act(() => {
      firstPageContent().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const seHandle = container.querySelector('[aria-label="move se"]')!;
    expect(seHandle).toBeTruthy();

    // Drag the image freely across the sheet
    dispatchPointer(firstPageContent(), 'pointerdown', 100, 100);
    dispatchPointer(firstPageContent(), 'pointermove', 145, 130);
    dispatchPointer(firstPageContent(), 'pointerup', 145, 130);

    const movedLeft = parseFloat(firstPageContent().style.left);
    const movedTop = parseFloat(firstPageContent().style.top);
    expect(movedLeft).toBeCloseTo(startLeft + 45);
    expect(movedTop).toBeCloseTo(startTop + 30);

    // Resize the image freely via its bottom-right handle
    const handle = container.querySelector('[aria-label="move se"]')!;
    dispatchPointer(handle, 'pointerdown', 200, 200);
    dispatchPointer(handle, 'pointermove', 250, 240);
    dispatchPointer(handle, 'pointerup', 250, 240);

    expect(parseFloat(firstPageContent().style.width)).toBeGreaterThan(startWidth);
    expect(parseFloat(firstPageContent().style.height)).toBeGreaterThan(startHeight);
  });

  it('prevents booklet margins from shrinking outward past hardware printer limits while allowing inward adjustment', () => {
    act(() => {
      useAppStore.setState({
        printerMargins: {
          status: 'available',
          source: 'hardware',
          marginsMm: { top: 6, right: 5, bottom: 7, left: 4.5 },
        },
      });
    });

    const boundary = container.querySelector<HTMLElement>('[data-printer-min-margins]')!;
    expect(boundary).toBeTruthy();
    expect(parseFloat(boundary.style.top)).toBeCloseTo(6 * PREVIEW_PX_PER_MM);
    expect(parseFloat(boundary.style.left)).toBeCloseTo(4.5 * PREVIEW_PX_PER_MM);

    // Dragging top border guide far upward stops at hardware min (6 mm), never 0 mm
    const topEdge = container.querySelector<HTMLElement>('[data-booklet-margin-guide="top"]')!;
    dispatchPointer(topEdge, 'pointerdown', 100, 100);
    dispatchPointer(topEdge, 'pointermove', 100, 100 - 40 * PREVIEW_PX_PER_MM);
    dispatchPointer(topEdge, 'pointerup', 100, 100 - 40 * PREVIEW_PX_PER_MM);
    expect(useAppStore.getState().layout.marginsMm.top).toBe(6);

    // BookletControlPanel enforces min={minSide} and clamps smaller manual entries up to minSide
    const panel = container.querySelector('[data-booklet-control-panel]')!;
    const topInput = panel.querySelector<HTMLInputElement>('[data-booklet-margin-input="top"]')!;
    expect(topInput.min).toBe('6');
    setInputValue(topInput, '1');
    expect(useAppStore.getState().layout.marginsMm.top).toBe(6);

    // Inward increase works freely
    setInputValue(topInput, '18');
    expect(useAppStore.getState().layout.marginsMm.top).toBe(18);

    // Ribbon margin input also enforces hardware min
    const ribbonLeftInput = Array.from(container.querySelectorAll('label'))
      .find(el => el.getAttribute('title')?.startsWith('left margin (mm)'))!
      .querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(ribbonLeftInput.min).toBe('4.5');
    setInputValue(ribbonLeftInput, '2');
    expect(useAppStore.getState().layout.marginsMm.left).toBe(4.5);

    // Hatched gray bands & spine-matching cursors
    const shading = container.querySelector('[data-layout-margin-shading]')!;
    expect((shading.children[0] as HTMLElement).style.backgroundImage).toContain('repeating-linear-gradient');
    expect(topEdge.className).toContain('cursor-row-resize');
    expect(container.querySelector<HTMLElement>('[data-booklet-margin-guide="left"]')!.className).toContain('cursor-col-resize');

    // Dragging booklet margin shows live size centered inside the hatched margin band
    dispatchPointer(topEdge, 'pointerdown', 100, 50);
    dispatchPointer(topEdge, 'pointermove', 100, 50 + 8 * PREVIEW_PX_PER_MM);
    const marginBadge = topEdge.querySelector('[data-band-size-label="margin-top"]');
    expect(marginBadge?.textContent).toBe('26 mm');
    dispatchPointer(topEdge, 'pointerup', 100, 50 + 8 * PREVIEW_PX_PER_MM);
    expect(container.querySelector('[data-band-size-label="margin-top"]')).toBeNull();

    // Dragging booklet spine shows live spine width centered inside the hatched spine band
    const spineBand = container.querySelector<HTMLElement>('[data-booklet-spine-guide]')!;
    dispatchPointer(spineBand, 'pointerdown', 150, 100);
    dispatchPointer(spineBand, 'pointermove', 150 + 3 * PREVIEW_PX_PER_MM, 100);
    const spineBadge = spineBand.querySelector('[data-band-size-label="spine"]');
    expect(spineBadge?.textContent).toBe('10 mm');
    dispatchPointer(spineBand, 'pointerup', 150 + 3 * PREVIEW_PX_PER_MM, 100);
    expect(container.querySelector('[data-band-size-label="spine"]')).toBeNull();
  });
});
