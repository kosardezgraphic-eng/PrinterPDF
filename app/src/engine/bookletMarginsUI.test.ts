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

  it('provides a range slider and numeric input for booklet margin and resizes/repositions rendered page images', () => {
    const panel = container.querySelector('[data-booklet-control-panel]')!;
    const ranges = panel.querySelectorAll<HTMLInputElement>('input[type="range"]');
    expect(ranges).toHaveLength(2);

    const beforeLeft = parseFloat(
      (container.querySelectorAll<HTMLElement>('[data-page-content]')[0]).style.left,
    );
    const beforeWidth = parseFloat(
      (container.querySelectorAll<HTMLElement>('[data-page-content]')[0]).style.width,
    );

    setInputValue(ranges[1], '22');
    expect(useAppStore.getState().layout.booklet?.outerMarginMm).toBe(22);

    const afterLeft = parseFloat(
      (container.querySelectorAll<HTMLElement>('[data-page-content]')[0]).style.left,
    );
    const afterWidth = parseFloat(
      (container.querySelectorAll<HTMLElement>('[data-page-content]')[0]).style.width,
    );

    expect(afterLeft).toBeGreaterThan(beforeLeft);
    expect(afterWidth).toBeLessThan(beforeWidth);

    // The spine guide vertical span also aligns with the updated booklet top/bottom margins.
    const spineGuide = container.querySelector<HTMLElement>('[data-booklet-spine-guide]')!;
    expect(parseFloat(spineGuide.style.top)).toBeCloseTo(22 * PREVIEW_PX_PER_MM);
    expect(parseFloat(spineGuide.style.bottom)).toBeCloseTo(22 * PREVIEW_PX_PER_MM);
  });

  it('syncs Ribbon margin inputs with booklet outerMarginMm so editing them moves and resizes images', () => {
    const beforeWidth = parseFloat(
      (container.querySelectorAll<HTMLElement>('[data-page-content]')[0]).style.width,
    );
    const topLabel = Array.from(container.querySelectorAll('label')).find(
      el => el.getAttribute('title') === 'top margin (mm)',
    )!;
    const topInput = topLabel.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(topInput.value).toBe('10');

    setInputValue(topInput, '24');
    expect(useAppStore.getState().layout.booklet?.outerMarginMm).toBe(24);
    expect(topInput.value).toBe('24');

    const afterWidth = parseFloat(
      (container.querySelectorAll<HTMLElement>('[data-page-content]')[0]).style.width,
    );
    expect(afterWidth).toBeLessThan(beforeWidth);
  });

  it('resizes and moves booklet page images live when dragging direct margin border guides or LayoutGuides handles', () => {
    const firstPageContent = () => container.querySelectorAll<HTMLElement>('[data-page-content]')[0];
    const initialLeft = parseFloat(firstPageContent().style.left);
    const initialWidth = parseFloat(firstPageContent().style.width);

    // 1. Direct edge drag on the preview sheet (mirrors data-booklet-spine-guide)
    const leftEdge = container.querySelector<HTMLElement>('[data-booklet-margin-guide="left"]')!;
    const deltaPx = 10 * PREVIEW_PX_PER_MM;
    dispatchPointer(leftEdge, 'pointerdown', 100, 100);
    dispatchPointer(leftEdge, 'pointermove', 100 + deltaPx, 100);
    expect(parseFloat(firstPageContent().style.left)).toBeGreaterThan(initialLeft);
    expect(parseFloat(firstPageContent().style.width)).toBeLessThan(initialWidth);
    dispatchPointer(leftEdge, 'pointerup', 100 + deltaPx, 100);
    expect(useAppStore.getState().layout.booklet?.outerMarginMm).toBeCloseTo(20);

    // 2. Undo reverts the margin drag cleanly in one step
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().layout.booklet?.outerMarginMm).toBe(10);

    // 3. Clicking the sheet opens LayoutGuides at the booklet margin and dragging its green handle updates outerMarginMm
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
    expect(parseFloat(firstPageContent().style.width)).toBeLessThan(initialWidth);
    dispatchPointer(leftHandle, 'pointerup', 18, 50);
    expect(useAppStore.getState().layout.booklet?.outerMarginMm).toBeCloseTo(18);
  });
});
