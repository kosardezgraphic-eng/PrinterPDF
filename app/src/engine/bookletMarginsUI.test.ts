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
});
