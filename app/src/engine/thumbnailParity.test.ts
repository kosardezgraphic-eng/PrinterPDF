// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PageItem,
  PageOverlayImage,
  PageOverlayNumbering,
  PageOverlayShape,
  PageOverlayText,
  SourceDocument,
} from '@shared/models';
import {
  DEFAULT_EFFECTS,
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  useAppStore,
} from '../store/useAppStore';
import { SidebarPages } from '../components/SidebarPages';
import { PreviewWorkspace } from '../components/PreviewWorkspace';
import {
  getDefaultPageNumberSettings,
  getDefaultWatermarkSettings,
} from './watermarkEngine';

const makePage = (id: string, sourcePageNumber = 1, highlighted = false): PageItem => ({
  id,
  documentId: 'd1',
  documentName: 'doc.pdf',
  sourcePageNumber,
  widthMm: 210,
  heightMm: 297,
  rotation: 0,
  selectedForPrint: true,
  isHighlighted: highlighted,
  isBlankPage: false,
  colorProfile: 'color',
  inkCoveragePercent: 12,
  thumbnailDataUrl: 'data:image/png;base64,AA==',
});

const doc1: SourceDocument = {
  id: 'd1',
  name: 'doc.pdf',
  filePath: '',
  fileSize: 2048,
  fileType: 'pdf',
  mimeType: 'application/pdf',
  pageCount: 2,
  createdAt: '',
  collapsed: false,
};

let container: HTMLDivElement;
let root: Root;
let fillTextCalls: Array<{ text: string }>;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fillTextCalls = [];
  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn((text: string) => {
      fillTextCalls.push({ text });
    }),
    measureText: (txt: string) => ({ width: txt.length * 6 }),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );

  useAppStore.setState({
    documents: [doc1],
    pages: [makePage('p1', 1, true), makePage('p2', 2, false)],
    layout: {
      ...DEFAULT_LAYOUT,
      paperSize: 'A4',
      rows: 1,
      cols: 1,
      duplexMode: 'none',
      autoRotateToFit: false,
    },
    effects: { ...DEFAULT_EFFECTS },
    watermark: getDefaultWatermarkSettings(),
    pageNumbering: getDefaultPageNumberSettings(),
    overlays: [],
    selectedOverlayId: null,
    textEdit: null,
    eraseTool: 'off',
    erasePending: null,
    settings: { ...DEFAULT_SETTINGS, language: 'en' },
    activeSheetIndex: 0,
    viewMode: 'single',
    sidebarTab: 'pages',
    sidebarReveal: null,
    previewPageRequest: null,
  });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(SidebarPages),
        React.createElement(PreviewWorkspace, { onCursorMoveMm: () => {} }),
      ),
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('thumbnail visual parity with main preview', () => {
  it('reflects selected-page pinned visual effects without leaking to other thumbnails', () => {
    act(() => {
      useAppStore.getState().updateEffects({
        enabled: true,
        scope: 'selected',
        grayscale: true,
        contrast: 40,
      });
    });

    const p1Img = container.querySelector('[data-page-id="p1"] img') as HTMLImageElement;
    const p2Img = container.querySelector('[data-page-id="p2"] img') as HTMLImageElement;

    expect(p1Img.style.filter).toContain('grayscale(1)');
    expect(p1Img.style.filter).toContain('contrast(1.40)');
    expect(p2Img.style.filter).not.toContain('grayscale(1)');

    // Switching highlight to p2 does not strip p1's pinned effect or apply it to p2
    act(() => {
      useAppStore.getState().highlightPage('p2', false, false);
    });
    expect((container.querySelector('[data-page-id="p1"] img') as HTMLImageElement).style.filter).toContain('grayscale(1)');
    expect((container.querySelector('[data-page-id="p2"] img') as HTMLImageElement).style.filter).not.toContain('grayscale(1)');
  });

  it('mirrors page eraser holes and painted brush strokes in both thumbnail and canvas (even when eraseTool is off)', () => {
    act(() => {
      useAppStore.getState().setPageErase('p1', [
        { mode: 'region', x: 10, y: 10, width: 25, height: 20 },
        { mode: 'brush', radiusMm: 4, points: [{ x: 40, y: 40 }, { x: 60, y: 50 }], color: '#22c55e' },
      ]);
    });

    const p1Card = container.querySelector('[data-page-id="p1"]')!;
    const maskedWrapper = p1Card.querySelector('[data-thumbnail-content] > div') as HTMLElement;
    expect(maskedWrapper.style.maskImage || maskedWrapper.style.webkitMaskImage).toContain('data:image/svg+xml');

    const thumbPaint = p1Card.querySelector('[data-thumbnail-page-paint]') as HTMLElement;
    expect(thumbPaint).not.toBeNull();
    expect(thumbPaint.style.backgroundImage).toContain('data:image/svg+xml');

    // Main canvas keeps the paint strokes visible when eraseTool === 'off'
    const canvasPaint = container.querySelector('[data-canvas-page-id="p1"] [data-page-paint]') as HTMLElement;
    expect(canvasPaint).not.toBeNull();
    expect(canvasPaint.style.backgroundImage).toContain('data:image/svg+xml');
  });

  it('renders text overlays, live textEdit drafts, shapes, numbering, and inserted images inside thumbnails cleanly', () => {
    const textOverlay: PageOverlayText = {
      id: 'txt-1',
      kind: 'text',
      target: 'page',
      targetScope: 'current',
      targetPageIds: ['p1'],
      targetSheetIndex: 1,
      xPercent: 10,
      yPercent: 10,
      widthPercent: 50,
      heightPercent: 20,
      text: 'Hello Thumb',
      fontFamily: 'Arial',
      fontSize: 18,
      color: '#111827',
      bold: true,
      italic: false,
      underline: false,
      align: 'center',
      opacity: 1,
      rotation: 0,
    };
    const shapeOverlay: PageOverlayShape = {
      id: 'shp-1',
      kind: 'shape',
      type: 'rectangle',
      target: 'sheet',
      targetScope: 'all',
      targetPageIds: [],
      targetSheetIndex: 1,
      xPercent: 20,
      yPercent: 20,
      widthPercent: 30,
      heightPercent: 20,
      opacity: 1,
      rotation: 0,
      fillColor: '#ef4444',
      strokeColor: '#000000',
      strokeWidth: 2,
      strokeStyle: 'solid',
      borderRadius: 0,
    };
    const numOverlay: PageOverlayNumbering = {
      id: 'num-1',
      kind: 'numbering',
      enabled: true,
      target: 'page',
      targetScope: 'all',
      targetPageIds: [],
      targetSheetIndex: 1,
      xPercent: 40,
      yPercent: 85,
      widthPercent: 20,
      heightPercent: 10,
      template: 'P.{page}',
      format: 'english',
      startOffset: 0,
      padZeros: 1,
      customScript: '',
      fontFamily: 'Arial',
      fontSize: 12,
      color: '#0f172a',
      bold: false,
      italic: false,
      align: 'center',
      opacity: 1,
      rotation: 0,
    };
    const imgOverlay: PageOverlayImage = {
      id: 'img-1',
      kind: 'image',
      target: 'page',
      targetScope: 'current',
      targetPageIds: ['p1'],
      targetSheetIndex: 1,
      xPercent: 55,
      yPercent: 15,
      widthPercent: 30,
      heightPercent: 25,
      opacity: 0.9,
      rotation: 0,
      src: 'data:image/png;base64,BBBB',
      name: 'Stamp Logo',
      naturalWidth: 100,
      naturalHeight: 100,
      fit: 'fill',
      invert: true,
    };

    act(() => {
      useAppStore.setState({ overlays: [textOverlay, shapeOverlay, numOverlay, imgOverlay] });
    });

    const p1Card = container.querySelector('[data-page-id="p1"]')!;
    const p2Card = container.querySelector('[data-page-id="p2"]')!;

    // Source page image remains the first <img> in card; overlay image renders inside [data-thumbnail-overlays]
    expect((p1Card.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe('data:image/png;base64,AA==');
    const overlayImg = p1Card.querySelector('[data-thumbnail-overlays] img[alt="Stamp Logo"]') as HTMLImageElement;
    expect(overlayImg).not.toBeNull();
    expect(overlayImg.style.filter).toContain('invert(1)');
    expect(p2Card.querySelector('[data-thumbnail-overlays] img[alt="Stamp Logo"]')).toBeNull();

    // Shape SVG renders in both thumbnails (target: 'sheet', scope: 'all')
    expect(p1Card.querySelector('[data-thumbnail-overlays] svg[data-shape-glyph="rectangle"]')).not.toBeNull();
    expect(p2Card.querySelector('[data-thumbnail-overlays] svg[data-shape-glyph="rectangle"]')).not.toBeNull();

    // Text & numbering canvases render inside thumbnails without interactive chrome
    expect(p1Card.querySelectorAll('[data-thumbnail-overlays] canvas').length).toBe(2);
    expect(p2Card.querySelectorAll('[data-thumbnail-overlays] canvas').length).toBe(1);
    expect(p1Card.querySelector('[data-overlay-id]')).toBeNull();
    expect(p1Card.querySelectorAll('button')).toHaveLength(1); // Only the print checkbox button

    // Live textEdit draft updates thumbnail canvas before finishTextEdit()
    fillTextCalls = [];
    act(() => {
      useAppStore.getState().beginTextEdit('txt-1', 'txt-1-1-0');
      useAppStore.getState().updateTextDraft('Live Draft!', 11, 11);
    });
    expect(fillTextCalls.some((c) => c.text === 'Live Draft!')).toBe(true);
  });

  it('mirrors legacy watermark and legacy page numbering inside thumbnails', () => {
    act(() => {
      useAppStore.setState({
        watermark: {
          ...getDefaultWatermarkSettings(),
          enabled: true,
          text: 'CONFIDENTIAL',
          tiled: false,
        },
        pageNumbering: {
          ...getDefaultPageNumberSettings(),
          enabled: true,
          format: 'english',
        },
      });
    });

    const p1Card = container.querySelector('[data-page-id="p1"]')!;
    expect(p1Card.querySelector('[data-thumbnail-watermark]')?.textContent).toContain('CONFIDENTIAL');
    expect(p1Card.querySelector('[data-thumbnail-legacy-numbering]')?.textContent).toContain('Page 1 of 2');
  });
});
