// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem, SourceDocument } from '@shared/models';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { PreviewWorkspace } from '../components/PreviewWorkspace';
import { TopToolRibbon } from '../components/TopToolRibbon';
import { ToolPanel } from '../components/ToolPanel';
import { encodeRgbaToPngBytesUniversal } from './universalImageDecoder';

function pointer(el: Element, type: string, x: number, y: number, pointerType: 'mouse' | 'touch' = 'mouse') {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(ev, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
  act(() => el.dispatchEvent(ev));
}

describe('Deferred full-image Crop mode and Perspective Crop UI', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
    const page: PageItem = {
      id: 'p1',
      documentId: 'doc1',
      documentName: 'doc1.png',
      sourcePageNumber: 1,
      widthMm: 100,
      heightMm: 100,
      rotation: 0,
      selectedForPrint: true,
      isHighlighted: true,
      isBlankPage: false,
      colorProfile: 'color',
      inkCoveragePercent: 20,
      thumbnailDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAD0lEQVR4nGNgGAWjAAgAAABAAAE2W+2lAAAAAElFTkSuQmCC',
      overrides: { cropBoxMm: { top: 20, right: 20, bottom: 20, left: 20 } },
    };
    useAppStore.setState({
      pages: [page],
      documents: [],
      layout: {
        ...DEFAULT_LAYOUT,
        paperSize: 'Custom',
        customWidthMm: 100,
        customHeightMm: 100,
        rows: 1,
        cols: 1,
        duplexMode: 'none',
        marginsMm: { left: 0, right: 0, top: 0, bottom: 0 },
        horizontalGutterMm: 0,
        verticalGutterMm: 0,
      },
      settings: { ...DEFAULT_SETTINGS, language: 'en', unit: 'mm' },
      activeSheetIndex: 0,
      viewMode: 'single',
      canvasTool: 'move',
      cropDrafts: {},
      perspectiveDrafts: {},
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(TopToolRibbon),
          React.createElement(PreviewWorkspace, { onCursorMoveMm: () => {} }),
          React.createElement(ToolPanel)
        )
      )
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('shows the full uncropped image while Crop tool is active, holds drags as draft, and commits only on exit', () => {
    const img = () => container.querySelector('[data-canvas-page-id="p1"] img') as HTMLImageElement;
    // Before entering Crop: previously cropped 60% width is zoomed to 100/0.6 = 166.67%
    expect(parseFloat(img().style.width)).toBeCloseTo(100 / 0.6, 1);

    // Activate Crop tool
    const cropBtn = container.querySelector<HTMLButtonElement>('[data-ribbon-tool="crop"]')!;
    act(() => cropBtn.click());
    expect(useAppStore.getState().canvasTool).toBe('crop');

    // While Crop is active, the full uncropped image (100% width) is visible with dark scrim outside
    expect(container.querySelector('[data-page-content]')?.getAttribute('data-uncropped-preview')).toBe('true');
    expect(parseFloat(img().style.width)).toBeCloseTo(100, 1);
    expect(container.querySelector('[data-crop-scrim]')).not.toBeNull();

    // Drag the West handle inward on the full 195px box (100mm * 1.95)
    const wHandle = container.querySelector('[aria-label="crop w"]')!;
    const beforeCrop = useAppStore.getState().pages[0].overrides?.cropBoxMm;
    pointer(wHandle, 'pointerdown', 39, 97.5);
    pointer(wHandle, 'pointermove', 78, 97.5);
    pointer(wHandle, 'pointerup', 78, 97.5);

    // Still in Crop mode: full image remains visible AND pages[].overrides.cropBoxMm is NOT committed yet
    expect(parseFloat(img().style.width)).toBeCloseTo(100, 1);
    expect(useAppStore.getState().pages[0].overrides?.cropBoxMm).toEqual(beforeCrop);
    expect(useAppStore.getState().cropDrafts['p1'].left).toBeCloseTo(0.4, 1);

    // Exit Crop mode by clicking Apply Crop (or switching tool) -> commits crop and clips to cropped view
    const applyBtn = container.querySelector<HTMLButtonElement>('[data-crop-apply]')!;
    act(() => applyBtn.click());
    expect(useAppStore.getState().canvasTool).toBe('move');
    expect(useAppStore.getState().cropDrafts).toEqual({});
    expect(useAppStore.getState().pages[0].overrides?.cropBoxMm?.left).toBeCloseTo(40, 0);
    // Visible image is now cropped!
    expect(parseFloat(img().style.width)).toBeCloseTo(100 / 0.4, 0);

    // Undo restores the previous crop cleanly
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().pages[0].overrides?.cropBoxMm).toEqual(beforeCrop);
  });

  it('discards deferred crop edits on Cancel without modifying the page', () => {
    const cropBtn = container.querySelector<HTMLButtonElement>('[data-ribbon-tool="crop"]')!;
    act(() => cropBtn.click());
    const beforeCrop = useAppStore.getState().pages[0].overrides?.cropBoxMm;

    const eHandle = container.querySelector('[aria-label="crop e"]')!;
    pointer(eHandle, 'pointerdown', 156, 97.5);
    pointer(eHandle, 'pointermove', 117, 97.5);
    pointer(eHandle, 'pointerup', 117, 97.5);
    expect(useAppStore.getState().cropDrafts['p1']).toBeDefined();

    const cancelBtn = container.querySelector<HTMLButtonElement>('[data-crop-cancel]')!;
    act(() => cancelBtn.click());
    expect(useAppStore.getState().canvasTool).toBe('move');
    expect(useAppStore.getState().cropDrafts).toEqual({});
    expect(useAppStore.getState().pages[0].overrides?.cropBoxMm).toEqual(beforeCrop);
  });

  it('provides Perspective Crop tool with 4 draggable corners and rectifies skewed raster pages with Undo', async () => {
    const raw = new Uint8ClampedArray(20 * 20 * 4);
    for (let i = 0; i < raw.length; i += 4) {
      raw[i] = 200;
      raw[i + 1] = 100;
      raw[i + 2] = 50;
      raw[i + 3] = 255;
    }
    const pngBytes = await encodeRgbaToPngBytesUniversal(raw, 20, 20);
    const doc: SourceDocument = {
      id: 'skew-doc',
      name: 'skewed.png',
      filePath: '',
      fileSize: pngBytes.byteLength,
      fileType: 'image',
      mimeType: 'image/png',
      pageCount: 1,
      createdAt: '',
      rawBytes: pngBytes,
    };
    act(() => {
      useAppStore.setState({
        documents: [doc],
        pages: [
          {
            id: 'skew-p1',
            documentId: 'skew-doc',
            documentName: 'skewed.png',
            sourcePageNumber: 1,
            widthMm: 100,
            heightMm: 100,
            rotation: 0,
            selectedForPrint: true,
            isHighlighted: true,
            isBlankPage: false,
            colorProfile: 'color',
            inkCoveragePercent: 50,
            thumbnailDataUrl: 'data:image/png;base64,AA==',
          },
        ],
      });
    });

    const perspBtn = container.querySelector<HTMLButtonElement>('[data-ribbon-tool="perspective-crop"]')!;
    expect(perspBtn).not.toBeNull();
    act(() => perspBtn.click());
    expect(useAppStore.getState().canvasTool).toBe('perspective-crop');

    const corners = container.querySelectorAll('[data-perspective-corner]');
    expect(corners).toHaveLength(4);

    // Drag top-left corner inward to mark a skewed document corner
    const tlHandle = container.querySelector('[data-perspective-corner="tl"]')!;
    pointer(tlHandle, 'pointerdown', 0, 0);
    pointer(tlHandle, 'pointermove', 39, 19.5);
    pointer(tlHandle, 'pointerup', 39, 19.5);

    const draft = useAppStore.getState().perspectiveDrafts['skew-p1'];
    expect(draft).toBeDefined();
    expect(draft.quad.tl.x).toBeCloseTo(0.2, 1);
    expect(draft.quad.tl.y).toBeCloseTo(0.1, 1);

    // Apply perspective rectification
    const applyBtn = container.querySelector<HTMLButtonElement>('[data-perspective-apply]')!;
    expect(applyBtn.disabled).toBe(false);
    await act(async () => {
      applyBtn.click();
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const s = useAppStore.getState();
        if (!s.isApplyingPerspectiveCrop && s.pages[0]?.documentId !== 'skew-doc') break;
        await new Promise((r) => setTimeout(r, 20));
      }
    });

    const afterState = useAppStore.getState();
    expect(afterState.pages[0].documentId).not.toBe('skew-doc');
    expect(afterState.documents.length).toBe(2);
    expect(afterState.canvasTool).toBe('move');

    // Undo restores original unrectified document & page
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().pages[0].documentId).toBe('skew-doc');
  });
});
