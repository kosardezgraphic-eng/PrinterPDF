// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem, PageOverlayNumbering, PageOverlayText, SourceDocument } from '@shared/models';
import { App } from '../App';
import { NumberingControlPanel } from '../components/NumberingControlPanel';
import { Ribbon } from '../components/Ribbon';
import { SidebarPages } from '../components/SidebarPages';
import { TextControlPanel } from '../components/TextControlPanel';
import { ipcBridge } from './ipcBridge';
import { resetSystemFontsCacheForTest } from './systemFonts';
import { getDefaultPageNumberSettings } from './watermarkEngine';
import { DEFAULT_EFFECTS, DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';

const makePage = (id: string, isHighlighted = false): PageItem => ({
  id,
  documentId: 'd1',
  documentName: 'doc.pdf',
  sourcePageNumber: 1,
  widthMm: 100,
  heightMm: 150,
  rotation: 0,
  selectedForPrint: true,
  isHighlighted,
  isBlankPage: false,
  colorProfile: 'color',
  inkCoveragePercent: 10,
  thumbnailDataUrl: 'data:image/png;base64,AA==',
});

const doc: SourceDocument = {
  id: 'd1',
  name: 'doc.pdf',
  filePath: '',
  fileSize: 1024,
  fileType: 'pdf',
  mimeType: 'application/pdf',
  pageCount: 2,
  createdAt: '',
  collapsed: false,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  resetSystemFontsCacheForTest();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 20 }),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D
  );

  useAppStore.setState({
    documents: [doc],
    pages: [makePage('p1', true), makePage('p2', false)],
    layout: { ...DEFAULT_LAYOUT, rows: 1, cols: 1, duplexMode: 'none' },
    effects: { ...DEFAULT_EFFECTS },
    settings: { ...DEFAULT_SETTINGS, language: 'en' },
    overlays: [],
    selectedOverlayId: null,
    activePageId: 'p1',
    activeSheetIndex: 0,
    sidebarTab: 'pages',
    sidebarWidthPx: 288,
    sidebarThumbnailSizePx: 112,
    pageNumbering: getDefaultPageNumberSettings(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('system fonts, thumbnail sizing, sidebar resizer, and scoped effects UI', () => {
  it('loads system fonts into TextControlPanel and NumberingControlPanel and supports custom fonts', async () => {
    const fontSpy = vi
      .spyOn(ipcBridge, 'listSystemFonts')
      .mockResolvedValue(['B Nazanin', 'B Titr', 'Segoe UI']);

    await act(async () => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(TextControlPanel),
          React.createElement(NumberingControlPanel)
        )
      );
      await Promise.resolve();
    });

    act(() => {
      useAppStore.getState().addTextOverlay();
    });

    const textFontSelect = container.querySelector<HTMLSelectElement>('[aria-label="Text font"]')!;
    const textOptions = Array.from(textFontSelect.options).map((o) => o.value);
    expect(textOptions).toContain('Vazirmatn');
    expect(textOptions).toContain('B Nazanin');
    expect(textOptions).toContain('Segoe UI');

    act(() => {
      textFontSelect.value = 'B Nazanin';
      textFontSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect((useAppStore.getState().overlays[0] as PageOverlayText).fontFamily).toBe('B Nazanin');

    // Custom font input
    const customInput = container.querySelector<HTMLInputElement>(
      '[aria-label="Custom system font name"]'
    )!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(customInput, 'IranNastaliq');
      customInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const useBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Use'
    )!;
    act(() => useBtn.click());
    expect((useAppStore.getState().overlays[0] as PageOverlayText).fontFamily).toBe(
      'IranNastaliq'
    );

    // Numbering font selector
    act(() => {
      useAppStore.getState().addNumberingOverlay();
    });
    const numberFontSelect = container.querySelector<HTMLSelectElement>(
      '[aria-label="Number font"]'
    )!;
    expect(Array.from(numberFontSelect.options).map((o) => o.value)).toContain('B Titr');
    act(() => {
      numberFontSelect.value = 'B Titr';
      numberFontSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const numbering = useAppStore
      .getState()
      .overlays.find((o): o is PageOverlayNumbering => o.kind === 'numbering')!;
    expect(numbering.fontFamily).toBe('B Titr');
    expect(fontSpy).toHaveBeenCalled();
  });

  it('enlarges and shrinks page thumbnails and updates sidebar grid columns', () => {
    act(() => {
      root.render(React.createElement(SidebarPages));
    });

    const box = () => container.querySelector<HTMLElement>('[data-thumbnail-box]')!;
    expect(box().style.height).toBe('112px');

    const largerBtn = container.querySelector<HTMLButtonElement>(
      '[aria-label="Larger thumbnails"]'
    )!;
    act(() => largerBtn.click());
    expect(useAppStore.getState().sidebarThumbnailSizePx).toBe(124);
    expect(box().style.height).toBe('124px');

    const smallerBtn = container.querySelector<HTMLButtonElement>(
      '[aria-label="Smaller thumbnails"]'
    )!;
    act(() => smallerBtn.click());
    expect(useAppStore.getState().sidebarThumbnailSizePx).toBe(112);

    const slider = container.querySelector<HTMLInputElement>('[aria-label="Thumbnail size"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(slider, '196');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useAppStore.getState().sidebarThumbnailSizePx).toBe(196);
    expect(box().style.height).toBe('196px');
    expect(localStorage.getItem('printstudio:sidebar-thumb-px')).toBe('196');
  });

  it('resizes the thumbnail sidebar width by dragging or keyboard on the splitter', () => {
    vi.spyOn(ipcBridge, 'listPrinters').mockResolvedValue([]);
    vi.spyOn(ipcBridge, 'loadSettings').mockResolvedValue(null);
    vi.spyOn(ipcBridge, 'loadSettingsPresets').mockResolvedValue([]);
    vi.spyOn(ipcBridge, 'loadAutoSaveSession').mockResolvedValue(null);

    act(() => {
      root.render(React.createElement(App));
    });

    const sidebar = () => container.querySelector<HTMLElement>('[data-sidebar-pages]')!;
    const resizer = container.querySelector<HTMLElement>('[data-sidebar-resizer]')!;
    expect(sidebar().style.width).toBe('288px');

    act(() => {
      resizer.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 288, button: 0 })
      );
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 400 }));
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 400 }));
    });
    expect(useAppStore.getState().sidebarWidthPx).toBe(400);
    expect(sidebar().style.width).toBe('400px');

    // Keyboard Home/ArrowLeft/double-click reset
    act(() => {
      resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(useAppStore.getState().sidebarWidthPx).toBe(384);

    act(() => {
      resizer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(useAppStore.getState().sidebarWidthPx).toBe(288);
    expect(localStorage.getItem('printstudio:sidebar-width-px')).toBe('288');
  });

  it('displays pinned target pages in Effects ribbon and lets operator explicitly update targets', () => {
    useAppStore.setState({ activeRibbonTab: 'effects' });
    act(() => {
      root.render(React.createElement(Ribbon));
    });

    const scopeSelect = container.querySelector<HTMLSelectElement>('[aria-label="Effects scope"]')!;
    act(() => {
      scopeSelect.value = 'selected';
      scopeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelector('[data-effects-targets]')?.textContent).toContain('#1');

    // Scrolling to p2 moves highlight, but target badge remains #1 until user explicitly re-targets
    act(() => {
      useAppStore.getState().focusPageFromPreview('p2');
    });
    expect(container.querySelector('[data-effects-targets]')?.textContent).toContain('#1');
    expect(container.querySelector('[data-effects-targets]')?.textContent).not.toContain('#2');

    const retargetBtn = container.querySelector<HTMLButtonElement>('[data-effects-retarget]')!;
    act(() => retargetBtn.click());
    expect(container.querySelector('[data-effects-targets]')?.textContent).toContain('#2');
  });
});
