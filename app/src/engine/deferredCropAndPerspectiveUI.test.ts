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

  it('auto-detects 4 sheet corners offline in UI and allows manual handle adjustment afterwards', async () => {
    const W = 80;
    const H = 80;
    const raw = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        const nx = x / (W - 1);
        const ny = y / (H - 1);
        const inside = nx >= 0.2 && nx <= 0.8 && ny >= 0.15 && ny <= 0.85;
        const c = inside ? 245 : 30;
        raw[idx] = c;
        raw[idx + 1] = c;
        raw[idx + 2] = c;
        raw[idx + 3] = 255;
      }
    }
    const pngBytes = await encodeRgbaToPngBytesUniversal(raw, W, H);
    const doc: SourceDocument = {
      id: 'auto-doc',
      name: 'sheet-on-desk.png',
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
            id: 'auto-p1',
            documentId: 'auto-doc',
            documentName: 'sheet-on-desk.png',
            sourcePageNumber: 1,
            widthMm: 100,
            heightMm: 100,
            rotation: 0,
            selectedForPrint: true,
            isHighlighted: true,
            isBlankPage: false,
            colorProfile: 'color',
            inkCoveragePercent: 25,
            thumbnailDataUrl: 'data:image/png;base64,AA==',
          },
        ],
      });
    });

    const perspBtn = container.querySelector<HTMLButtonElement>('[data-ribbon-tool="perspective-crop"]')!;
    act(() => perspBtn.click());
    const autoBtn = container.querySelector<HTMLButtonElement>('[data-perspective-autodetect]')!;
    expect(autoBtn).not.toBeNull();

    await act(async () => {
      autoBtn.click();
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const s = useAppStore.getState();
        if (!s.isAutoDetectingPerspective && s.perspectiveDrafts['auto-p1']) break;
        await new Promise((r) => setTimeout(r, 15));
      }
    });

    const detected = useAppStore.getState().perspectiveDrafts['auto-p1'];
    expect(detected).toBeDefined();
    expect(detected.quad.tl.x).toBeGreaterThan(0.12);
    expect(detected.quad.tl.x).toBeLessThan(0.28);
    expect(detected.quad.br.x).toBeGreaterThan(0.72);
    expect(detected.quad.br.x).toBeLessThan(0.88);

    // Corner handles remain editable after auto-detection
    const startTlX = detected.quad.tl.x;
    const tlHandle = container.querySelector('[data-perspective-corner="tl"]')!;
    pointer(tlHandle, 'pointerdown', 39, 29);
    pointer(tlHandle, 'pointermove', 59, 29);
    pointer(tlHandle, 'pointerup', 59, 29);
    expect(useAppStore.getState().perspectiveDrafts['auto-p1'].quad.tl.x).toBeGreaterThan(startTlX + 0.05);
  });

  it('shows the full original pre-crop image with saved 4 corners when re-entering Perspective Crop and re-rectifies cleanly', async () => {
    const raw = new Uint8ClampedArray(24 * 24 * 4);
    for (let i = 0; i < raw.length; i += 4) {
      raw[i] = 180;
      raw[i + 1] = 120;
      raw[i + 2] = 60;
      raw[i + 3] = 255;
    }
    const pngBytes = await encodeRgbaToPngBytesUniversal(raw, 24, 24);
    const doc: SourceDocument = {
      id: 'orig-doc',
      name: 'receipt.png',
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
            id: 'reedit-p1',
            documentId: 'orig-doc',
            documentName: 'receipt.png',
            sourcePageNumber: 1,
            widthMm: 100,
            heightMm: 150,
            rotation: 0,
            selectedForPrint: true,
            isHighlighted: true,
            isBlankPage: false,
            colorProfile: 'color',
            inkCoveragePercent: 40,
            thumbnailDataUrl: 'data:image/png;base64,AA==',
          },
        ],
      });
    });

    const perspBtn = container.querySelector<HTMLButtonElement>('[data-ribbon-tool="perspective-crop"]')!;
    act(() => perspBtn.click());

    // First perspective crop: drag TL inward
    const tl1 = container.querySelector('[data-perspective-corner="tl"]')!;
    pointer(tl1, 'pointerdown', 0, 0);
    pointer(tl1, 'pointermove', 30, 30);
    pointer(tl1, 'pointerup', 30, 30);
    const firstQuadTlX = useAppStore.getState().perspectiveDrafts['reedit-p1'].quad.tl.x;
    expect(firstQuadTlX).toBeGreaterThan(0.05);

    const applyBtn = container.querySelector<HTMLButtonElement>('[data-perspective-apply]')!;
    await act(async () => {
      applyBtn.click();
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const s = useAppStore.getState();
        if (!s.isApplyingPerspectiveCrop && s.pages[0]?.documentId !== 'orig-doc') break;
        await new Promise((r) => setTimeout(r, 20));
      }
    });

    const afterFirst = useAppStore.getState();
    const firstDocId = afterFirst.pages[0].documentId;
    expect(firstDocId).not.toBe('orig-doc');
    expect(afterFirst.pages[0].overrides?.perspectiveSource).toBeDefined();
    expect(afterFirst.pages[0].overrides?.perspectiveSource?.documentId).toBe('orig-doc');
    expect(afterFirst.pages[0].overrides?.perspectiveSource?.widthMm).toBe(100);
    expect(afterFirst.pages[0].overrides?.perspectiveSource?.heightMm).toBe(150);
    expect(afterFirst.canvasTool).toBe('move');

    // Re-enter Perspective Crop on the rectified page
    act(() => perspBtn.click());
    expect(useAppStore.getState().canvasTool).toBe('perspective-crop');

    // Overlay must indicate it is showing the full original pre-crop source and restore the saved quad
    const overlay = container.querySelector('[data-perspective-overlay]');
    expect(overlay?.getAttribute('data-showing-original-source')).toBe('true');
    const restoredDraft = useAppStore.getState().perspectiveDrafts['reedit-p1'];
    expect(restoredDraft).toBeDefined();
    expect(restoredDraft.quad.tl.x).toBeCloseTo(firstQuadTlX, 3);

    // Exiting perspective crop without changes clears draft without creating a new document
    const moveBtn = container.querySelector<HTMLButtonElement>('[data-ribbon-tool="select-move"]')!;
    act(() => moveBtn.click());
    expect(useAppStore.getState().pages[0].documentId).toBe(firstDocId);

    // Re-enter, edit TL corner further, and re-apply
    act(() => perspBtn.click());
    const tl2 = container.querySelector('[data-perspective-corner="tl"]')!;
    pointer(tl2, 'pointerdown', 30, 30);
    pointer(tl2, 'pointermove', 50, 45);
    pointer(tl2, 'pointerup', 50, 45);
    const editedQuadTlX = useAppStore.getState().perspectiveDrafts['reedit-p1'].quad.tl.x;
    expect(editedQuadTlX).toBeGreaterThan(firstQuadTlX);

    const applyBtn2 = container.querySelector<HTMLButtonElement>('[data-perspective-apply]')!;
    await act(async () => {
      applyBtn2.click();
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const s = useAppStore.getState();
        if (!s.isApplyingPerspectiveCrop && s.pages[0]?.documentId !== firstDocId) break;
        await new Promise((r) => setTimeout(r, 20));
      }
    });

    const afterSecond = useAppStore.getState();
    expect(afterSecond.pages[0].documentId).not.toBe(firstDocId);
    // Original source doc is still preserved for a 3rd edit, and superseded intermediate doc is pruned
    expect(afterSecond.pages[0].overrides?.perspectiveSource?.documentId).toBe('orig-doc');
    expect(afterSecond.documents.some((d) => d.id === 'orig-doc')).toBe(true);
    expect(afterSecond.documents.some((d) => d.id === firstDocId)).toBe(false);
    expect(afterSecond.pages[0].overrides?.perspectiveSource?.quad.tl.x).toBeCloseTo(editedQuadTlX, 3);
  });

  it('auto-detects 4-corner boundaries on raw scan import and exposes them as editable points in the cropping tool', async () => {
    const W = 120;
    const H = 120;
    const raw = new Uint8ClampedArray(W * H * 4);
    const scanQuad = {
      tl: { x: 0.2, y: 0.16 },
      tr: { x: 0.82, y: 0.2 },
      br: { x: 0.86, y: 0.86 },
      bl: { x: 0.16, y: 0.82 },
    };
    const inQuad = (nx: number, ny: number) => {
      const pts = [scanQuad.tl, scanQuad.tr, scanQuad.br, scanQuad.bl];
      let pos = 0;
      let neg = 0;
      for (let i = 0; i < 4; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        const c = (b.x - a.x) * (ny - a.y) - (b.y - a.y) * (nx - a.x);
        if (c >= 0) pos++;
        if (c <= 0) neg++;
      }
      return pos === 4 || neg === 4;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        const inside = inQuad(x / (W - 1), y / (H - 1));
        const c = inside ? 245 : 28;
        raw[idx] = c;
        raw[idx + 1] = c;
        raw[idx + 2] = c;
        raw[idx + 3] = 255;
      }
    }
    const pngBytes = await encodeRgbaToPngBytesUniversal(raw, W, H);
    const buf = new Uint8Array(pngBytes);
    const scanFile = new File([buf], 'raw-desk-scan.png', { type: 'image/png' });
    Object.defineProperty(scanFile, 'arrayBuffer', {
      value: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    });

    act(() => {
      useAppStore.setState({ documents: [], pages: [], bookmarks: [] });
    });

    await act(async () => {
      await useAppStore.getState().importFiles([scanFile]);
    });

    const importedState = useAppStore.getState();
    expect(importedState.pages).toHaveLength(1);
    const importedPage = importedState.pages[0];
    expect(importedPage.overrides?.detectedBoundaries).toBeDefined();
    expect(importedPage.overrides!.detectedBoundaries!.confidence).toBeGreaterThan(0.5);

    // 1) Standard Crop tool exposes detected scan polygon + Snap to Scan Bounds + Edit 4 Corners
    const cropBtn = container.querySelector<HTMLButtonElement>('[data-ribbon-tool="crop"]')!;
    act(() => cropBtn.click());
    expect(container.querySelector('[data-crop-overlay]')?.getAttribute('data-has-detected-boundaries')).toBe('true');
    expect(container.querySelector('[data-crop-detected-quad]')).not.toBeNull();

    const snapBtn = container.querySelector<HTMLButtonElement>('[data-crop-snap-detected]')!;
    expect(snapBtn).not.toBeNull();
    act(() => snapBtn.click());
    const snappedCrop = useAppStore.getState().cropDrafts[importedPage.id];
    expect(snappedCrop).toBeDefined();
    expect(snappedCrop.left).toBeCloseTo(importedPage.overrides!.detectedBoundaries!.bounds.left, 3);
    expect(snappedCrop.top).toBeCloseTo(importedPage.overrides!.detectedBoundaries!.bounds.top, 3);

    // 2) Switch to 4-Corner editing: detected coordinates populate immediately as draggable handles
    const editCornersBtn = container.querySelector<HTMLButtonElement>('[data-crop-to-perspective]')!;
    expect(editCornersBtn).not.toBeNull();
    act(() => editCornersBtn.click());

    expect(useAppStore.getState().canvasTool).toBe('perspective-crop');
    expect(container.querySelector('[data-perspective-detected-badge]')).not.toBeNull();
    const initialDraft = useAppStore.getState().perspectiveDrafts[importedPage.id];
    expect(initialDraft).toBeDefined();
    expect(Math.hypot(initialDraft.quad.tl.x - scanQuad.tl.x, initialDraft.quad.tl.y - scanQuad.tl.y)).toBeLessThan(0.06);
    expect(Math.hypot(initialDraft.quad.br.x - scanQuad.br.x, initialDraft.quad.br.y - scanQuad.br.y)).toBeLessThan(0.06);

    // Control points remain immediately draggable and editable
    const tlHandle = container.querySelector('[data-perspective-corner="tl"]')!;
    const beforeTlX = initialDraft.quad.tl.x;
    pointer(tlHandle, 'pointerdown', 40, 32);
    pointer(tlHandle, 'pointermove', 60, 32);
    pointer(tlHandle, 'pointerup', 60, 32);
    expect(useAppStore.getState().perspectiveDrafts[importedPage.id].quad.tl.x).toBeGreaterThan(beforeTlX + 0.04);

    // Apply Perspective rectifies the scan and clears pre-crop detectedBoundaries
    const applyPerspBtn = container.querySelector<HTMLButtonElement>('[data-perspective-apply]')!;
    await act(async () => {
      applyPerspBtn.click();
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const s = useAppStore.getState();
        if (!s.isApplyingPerspectiveCrop && s.pages[0]?.overrides?.perspectiveSource) break;
        await new Promise((r) => setTimeout(r, 20));
      }
    });

    const rectifiedPage = useAppStore.getState().pages[0];
    expect(rectifiedPage.overrides?.perspectiveSource).toBeDefined();
    expect(rectifiedPage.overrides?.detectedBoundaries).toBeUndefined();
  });

  it('shows a 3x corner magnifier view and live coordinate tooltip when inspecting/dragging 4-corner markers and crop handles', () => {
    // 1) Perspective corners magnifier & live coordinate tooltip
    const perspBtn = container.querySelector<HTMLButtonElement>('[data-ribbon-tool="perspective-crop"]')!;
    act(() => perspBtn.click());

    expect(container.querySelector('[data-corner-magnifier]')).toBeNull();
    expect(container.querySelector('[data-corner-tooltip]')).toBeNull();

    const tlHandle = container.querySelector('[data-perspective-corner="tl"]')!;
    // Hovering corner reveals magnified loupe + tooltip
    pointer(tlHandle, 'mouseover', 0, 0);
    const mag = container.querySelector('[data-corner-magnifier="tl"]');
    const tooltip = container.querySelector('[data-corner-tooltip="tl"]');
    expect(mag).not.toBeNull();
    expect(mag?.querySelector('img')).not.toBeNull();
    expect(mag?.textContent).toContain('3×');
    expect(tooltip?.textContent).toContain('0%');

    // Dragging updates the tooltip coordinates live
    pointer(tlHandle, 'pointerdown', 0, 0);
    pointer(tlHandle, 'pointermove', 39, 19.5);
    const updatedTooltip = container.querySelector('[data-corner-tooltip="tl"]');
    expect(updatedTooltip?.textContent).toContain('20%');
    expect(updatedTooltip?.textContent).toContain('10%');
    pointer(tlHandle, 'pointerup', 39, 19.5);

    // Toggling Corner Magnifier off hides the zoomed loupe while preserving coordinate readout
    const magToggle = container.querySelector<HTMLButtonElement>('[data-perspective-magnifier-toggle]')!;
    expect(magToggle.getAttribute('aria-pressed')).toBe('true');
    act(() => magToggle.click());
    expect(magToggle.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-corner-magnifier="tl"]')).toBeNull();
    expect(container.querySelector('[data-corner-tooltip="tl"]')).not.toBeNull();

    // 2) Standard Crop handle hover shows dimension tooltip
    const cropBtn = container.querySelector<HTMLButtonElement>('[data-ribbon-tool="crop"]')!;
    act(() => cropBtn.click());
    const wHandle = container.querySelector('[aria-label="crop w"]')!;
    pointer(wHandle, 'mouseover', 39, 97.5);
    const cropTooltip = container.querySelector('[data-crop-tooltip="w"]');
    expect(cropTooltip).not.toBeNull();
    expect(cropTooltip?.textContent).toContain('mm');
  });

  it('auto-deskews tilted scans on import and supports Revert Deskew and manual Auto-Deskew with Undo', async () => {
    const W = 160;
    const H = 160;
    const raw = new Uint8ClampedArray(W * H * 4);
    const rad = (8.5 * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x / (W - 1) - 0.5;
        const dy = y / (H - 1) - 0.5;
        const ux = dx * cosA + dy * sinA;
        const uy = -dx * sinA + dy * cosA;
        const inside = Math.abs(ux) <= 0.27 && Math.abs(uy) <= 0.34;
        const c = inside ? 246 : 24;
        const idx = (y * W + x) * 4;
        raw[idx] = c;
        raw[idx + 1] = c;
        raw[idx + 2] = c;
        raw[idx + 3] = 255;
      }
    }
    const pngBytes = await encodeRgbaToPngBytesUniversal(raw, W, H);
    const buf = new Uint8Array(pngBytes);
    const tiltedFile = new File([buf], 'tilted-scan.png', { type: 'image/png' });
    Object.defineProperty(tiltedFile, 'arrayBuffer', {
      value: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    });

    act(() => {
      useAppStore.setState({ documents: [], pages: [], bookmarks: [] });
    });

    await act(async () => {
      await useAppStore.getState().importFiles([tiltedFile]);
    });

    const imported = useAppStore.getState();
    expect(imported.pages).toHaveLength(1);
    expect(imported.pages[0].overrides?.deskewInfo?.applied).toBe(true);
    expect(imported.documents[0].preDeskewRawBytes).toBeDefined();

    // Open Crop tool -> deskew badge and Revert Deskew button are shown
    const cropBtn = container.querySelector<HTMLButtonElement>('[data-ribbon-tool="crop"]')!;
    act(() => cropBtn.click());
    expect(container.querySelector('[data-deskew-badge]')?.textContent).toContain('Deskewed');
    const revertBtn = container.querySelector<HTMLButtonElement>('[data-revert-deskew]')!;
    expect(revertBtn).not.toBeNull();

    // Revert Deskew restores original un-deskewed raster & reveals manual Auto-Deskew button
    await act(async () => {
      revertBtn.click();
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const s = useAppStore.getState();
        if (!s.isDeskewing && !s.pages[0]?.overrides?.deskewInfo) break;
        await new Promise((r) => setTimeout(r, 15));
      }
    });

    expect(useAppStore.getState().pages[0].overrides?.deskewInfo).toBeUndefined();
    expect(useAppStore.getState().documents[0].preDeskewRawBytes).toBeUndefined();

    const manualBtn = container.querySelector<HTMLButtonElement>('[data-manual-deskew]')!;
    expect(manualBtn).not.toBeNull();

    // Manual Auto-Deskew re-straightens it
    await act(async () => {
      manualBtn.click();
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const s = useAppStore.getState();
        if (!s.isDeskewing && s.pages[0]?.overrides?.deskewInfo?.applied) break;
        await new Promise((r) => setTimeout(r, 15));
      }
    });

    expect(useAppStore.getState().pages[0].overrides?.deskewInfo?.applied).toBe(true);
    expect(useAppStore.getState().documents[0].preDeskewRawBytes).toBeDefined();

    // Undo restores the un-deskewed state cleanly
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().pages[0].overrides?.deskewInfo).toBeUndefined();
  });
});

