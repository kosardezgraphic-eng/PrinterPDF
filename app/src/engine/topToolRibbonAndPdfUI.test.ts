// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem, SourceDocument } from '@shared/models';
import { TopToolRibbon } from '../components/TopToolRibbon';
import { ToolPanel } from '../components/ToolPanel';
import { ModalsAndToasts } from '../components/Modals';
import { DEFAULT_EFFECTS, DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';

const page: PageItem = {
  id: 'p1',
  documentId: 'd1',
  documentName: 'doc.pdf',
  sourcePageNumber: 1,
  widthMm: 210,
  heightMm: 297,
  rotation: 0,
  selectedForPrint: true,
  isHighlighted: true,
  isBlankPage: false,
  colorProfile: 'color',
  inkCoveragePercent: 12,
  thumbnailDataUrl: 'data:image/png;base64,AA==',
};

const doc: SourceDocument = {
  id: 'd1',
  name: 'doc.pdf',
  filePath: '',
  fileSize: 1024,
  fileType: 'pdf',
  mimeType: 'application/pdf',
  pageCount: 1,
  createdAt: '2026-01-01T00:00:00Z',
};

let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState({
    pages: [page],
    documents: [doc],
    activePageId: 'p1',
    overlays: [],
    selectedOverlayId: null,
    effects: { ...DEFAULT_EFFECTS },
    layout: { ...DEFAULT_LAYOUT },
    settings: { ...DEFAULT_SETTINGS, language: 'en', theme: 'light' },
    activeInspectorTool: 'layout',
    inspectorCollapsed: false,
    eraseTool: 'off',
    canvasTool: 'move',
    pdfPreviewModal: null,
    pdfExportOptions: { imageHandling: 'preserve', compression: 'lossless' },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

describe('TopToolRibbon & ToolPanel routing', () => {
  it('renders Reset, preset menu, all tool icons, PDF export controls, and switches ToolPanel dynamically', () => {
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          'div',
          null,
          React.createElement(TopToolRibbon),
          React.createElement(ToolPanel)
        )
      );
    });

    expect(container.querySelector('[data-ribbon-action="reset"]')).not.toBeNull();
    expect(container.querySelector('[data-preset-menu-trigger]')).not.toBeNull();
    expect(container.querySelector('[data-snap-toggle]')).not.toBeNull();
    expect(container.querySelector('[data-smart-guides-toggle]')).not.toBeNull();
    expect(container.querySelector('[data-ribbon-action="save-as-pdf"]')).not.toBeNull();
    expect(container.querySelector('[data-ribbon-action="view-pdf"]')).not.toBeNull();
    expect(container.querySelector('[data-pdf-image-handling]')).not.toBeNull();
    expect(container.querySelector('[data-pdf-compression]')).not.toBeNull();

    const clickTool = (selector: string) => {
      const btn = container.querySelector<HTMLButtonElement>(selector);
      expect(btn).not.toBeNull();
      act(() => btn!.click());
    };

    clickTool('[data-ribbon-tool="margins"]');
    expect(useAppStore.getState().activeInspectorTool).toBe('margins');
    expect(container.querySelector('[data-cross-margin-widget]')).not.toBeNull();

    clickTool('[data-ribbon-tool="custom-layout"]');
    expect(useAppStore.getState().activeInspectorTool).toBe('layout');
    expect(container.querySelector('[data-tool-panel]')?.getAttribute('data-active-inspector')).toBe('layout');

    clickTool('[data-ribbon-tool="watermark"]');
    expect(useAppStore.getState().activeInspectorTool).toBe('watermark');
    expect(container.querySelector('[data-watermark-control-panel]')).not.toBeNull();

    clickTool('[data-ribbon-tool="booklet"]');
    expect(useAppStore.getState().activeInspectorTool).toBe('booklet');
    expect(container.querySelector('[data-booklet-control-panel]')).not.toBeNull();

    clickTool('[data-ribbon-tool="eraser"]');
    expect(useAppStore.getState().activeInspectorTool).toBe('eraser');
    expect(useAppStore.getState().eraseTool).toBe('brush');
    expect(container.querySelector('[data-eraser-control-panel]')).not.toBeNull();

    // 'file' is deliberately absent: the ribbon used to carry a File tool tile that opened the same document
    // buttons that sit in the row above it, so it was removed rather than fixed.
    for (const tool of ['effects', 'crop', 'pdf', 'batch', 'printers', 'view', 'margins'] as const) {
      const ribbonKey = tool;
      clickTool(`[data-ribbon-tool="${ribbonKey}"]`);
      expect(useAppStore.getState().activeInspectorTool).toBe(tool);
      expect(container.querySelector('[data-tool-panel]')?.getAttribute('data-active-inspector')).toBe(tool);
    }
    expect(container.querySelector('[data-ribbon-tool="file"]')).toBeNull();
    // The other half of that tile's row is real work rather than a second copy of the document buttons.
    expect(container.querySelector('[data-ribbon-quick="save-project"]')).not.toBeNull();
    expect(container.querySelector('[data-ribbon-quick="diagnostics"]')).not.toBeNull();

    act(() => root.unmount());
  });

  it('updates pdfExportOptions from the PDF dropdowns in TopToolRibbon', () => {
    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(TopToolRibbon));
    });

    const imgSelect = container.querySelector<HTMLSelectElement>('[data-pdf-image-handling]')!;
    const compSelect = container.querySelector<HTMLSelectElement>('[data-pdf-compression]')!;

    act(() => {
      imgSelect.value = 'downsample-300';
      imgSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => {
      compSelect.value = 'compact';
      compSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(useAppStore.getState().pdfExportOptions).toEqual({
      imageHandling: 'downsample-300',
      compression: 'compact',
    });

    act(() => root.unmount());
  });

  it('opens and closes the in-app PDF preview modal without calling window.open', () => {
    const openSpy = vi.spyOn(window, 'open');
    const origRevoke = URL.revokeObjectURL;
    const revokeSpy = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeSpy });

    const root = createRoot(container);
    act(() => {
      useAppStore.setState({
        pdfPreviewModal: {
          url: 'blob:http://localhost/mock-pdf',
          fileName: 'PrintStudio-Preview.pdf',
          pageCount: 3,
          byteLength: 20480,
        },
      });
      root.render(React.createElement(ModalsAndToasts));
    });

    const modal = container.querySelector('[data-pdf-preview-modal]');
    const frame = container.querySelector<HTMLIFrameElement>('[data-pdf-preview-frame]');
    expect(modal).not.toBeNull();
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('src')).toBe('blob:http://localhost/mock-pdf');
    expect(openSpy).not.toHaveBeenCalled();

    // Closing via Escape
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(useAppStore.getState().pdfPreviewModal).toBeNull();
    expect(container.querySelector('[data-pdf-preview-modal]')).toBeNull();

    // Re-open and close via close button
    act(() => {
      useAppStore.setState({
        pdfPreviewModal: {
          url: 'blob:http://localhost/mock-pdf-2',
          fileName: 'PrintStudio-Preview-2.pdf',
          pageCount: 1,
          byteLength: 4096,
        },
      });
    });
    const closeBtn = container.querySelector<HTMLButtonElement>('[data-pdf-preview-close]');
    expect(closeBtn).not.toBeNull();
    act(() => closeBtn!.click());
    expect(useAppStore.getState().pdfPreviewModal).toBeNull();

    openSpy.mockRestore();
    if (origRevoke) {
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: origRevoke });
    } else {
      delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
    act(() => root.unmount());
  });
});
