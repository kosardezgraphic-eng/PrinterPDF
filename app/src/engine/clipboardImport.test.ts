// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extensionForImageMime,
  extractFilesFromClipboardData,
  readImagesFromSystemClipboard,
} from './clipboardImport';
import { App } from '../App';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import type { PageItem, SourceDocument } from '@shared/models';

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('clipboardImport engine', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { printStudioAPI?: unknown }).printStudioAPI;
  });

  it('maps image MIME types to file extensions cleanly', () => {
    expect(extensionForImageMime('image/png')).toBe('png');
    expect(extensionForImageMime('image/jpeg')).toBe('jpg');
    expect(extensionForImageMime('image/webp; charset=utf-8')).toBe('webp');
    expect(extensionForImageMime('image/tiff')).toBe('tif');
    expect(extensionForImageMime('')).toBe('png');
  });

  it('extracts screenshot images from clipboardData.items even when .files is empty', () => {
    const snip = new File([PNG_HEADER], 'image.png', { type: 'image/png' });
    const dt = {
      files: [] as unknown as FileList,
      items: [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'image/png', getAsFile: () => snip },
      ] as unknown as DataTransferItemList,
    } as unknown as DataTransfer;

    const extracted = extractFilesFromClipboardData(dt);
    expect(extracted).toHaveLength(1);
    expect(extracted[0].type).toBe('image/png');
    expect(extracted[0].name).toMatch(/^clipboard-image-\d+-1\.png$/);
  });

  it('deduplicates identical file present in both .files and .items and preserves named PDFs', () => {
    const namedPdf = new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' });
    const dt = {
      files: [namedPdf] as unknown as FileList,
      items: [
        { kind: 'file', type: 'application/pdf', getAsFile: () => namedPdf },
      ] as unknown as DataTransferItemList,
    } as unknown as DataTransfer;

    const extracted = extractFilesFromClipboardData(dt);
    expect(extracted).toHaveLength(1);
    expect(extracted[0].name).toBe('invoice.pdf');
  });

  it('reads image via Electron native bridge when available', async () => {
    window.printStudioAPI = {
      readClipboardImage: vi.fn(async () => ({
        name: 'electron-clip.png',
        mimeType: 'image/png',
        bytes: PNG_HEADER,
      })),
    } as never;

    const result = await readImagesFromSystemClipboard();
    expect(result.status).toBe('ok');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('electron-clip.png');
    expect(result.files[0].type).toBe('image/png');
  });

  it('falls back to navigator.clipboard.read() in browser preview', async () => {
    const blob = new Blob([PNG_HEADER], { type: 'image/png' });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read: vi.fn(async () => [
          {
            types: ['text/html', 'image/png'],
            getType: async (type: string) => {
              if (type === 'image/png') return blob;
              throw new Error('unexpected type');
            },
          },
        ]),
      },
    });

    const result = await readImagesFromSystemClipboard();
    expect(result.status).toBe('ok');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].type).toBe('image/png');
    expect(result.files[0].name).toMatch(/^clipboard-image-\d+-1\.png$/);
  });

  it('reports permission-denied cleanly when clipboard read throws NotAllowedError', async () => {
    const err = new Error('Read permission denied');
    err.name = 'NotAllowedError';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read: vi.fn(async () => {
          throw err;
        }),
      },
    });

    const result = await readImagesFromSystemClipboard();
    expect(result.status).toBe('permission-denied');
    expect(result.files).toHaveLength(0);
  });

  it('reports empty when clipboard contains only text and no images', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read: vi.fn(async () => [
          {
            types: ['text/plain'],
            getType: async () => new Blob(['hello'], { type: 'text/plain' }),
          },
        ]),
      },
    });

    const result = await readImagesFromSystemClipboard();
    expect(result.status).toBe('empty');
    expect(result.files).toHaveLength(0);
  });
});

describe('useAppStore.importFromClipboard routing', () => {
  const initialState = useAppStore.getState();

  beforeEach(() => {
    useAppStore.setState({
      appMode: 'studio',
      documents: [],
      pages: [],
      toasts: [],
      settings: { ...DEFAULT_SETTINGS, language: 'fa' },
      layout: { ...DEFAULT_LAYOUT },
      importFiles: initialState.importFiles,
      addBatchFiles: initialState.addBatchFiles,
      addImageOverlayFiles: initialState.addImageOverlayFiles,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { printStudioAPI?: unknown }).printStudioAPI;
  });

  it('routes pasted clipboard image to importFiles in studio document mode', async () => {
    window.printStudioAPI = {
      readClipboardImage: vi.fn(async () => ({
        name: 'clip-doc.png',
        mimeType: 'image/png',
        bytes: PNG_HEADER,
      })),
    } as never;

    const importSpy = vi.fn<(files: File[]) => Promise<void>>(async () => {});
    useAppStore.setState({ importFiles: importSpy });

    const count = await useAppStore.getState().importFromClipboard({ target: 'document' });
    expect(count).toBe(1);
    expect(importSpy).toHaveBeenCalledTimes(1);
    expect(importSpy.mock.calls[0]?.[0]?.[0]?.name).toBe('clip-doc.png');
  });

  it('routes pasted clipboard image to addImageOverlayFiles when target is overlay', async () => {
    window.printStudioAPI = {
      readClipboardImage: vi.fn(async () => ({
        name: 'clip-overlay.png',
        mimeType: 'image/png',
        bytes: PNG_HEADER,
      })),
    } as never;

    const overlaySpy = vi.fn(async () => 1);
    const mockDoc = {
      id: 'd1',
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      fileSize: 100,
      pageCount: 1,
      rawBytes: new Uint8Array(),
    } as unknown as SourceDocument;
    const mockPage = {
      id: 'p1',
      documentId: 'd1',
      pageNumber: 1,
      widthMm: 210,
      heightMm: 297,
      rotation: 0,
      selectedForPrint: true,
      isHighlighted: true,
      isBlank: false,
      colorType: 'color',
      thumbnailUrl: '',
    } as unknown as PageItem;

    useAppStore.setState({
      documents: [mockDoc],
      pages: [mockPage],
      addImageOverlayFiles: overlaySpy,
    });

    const count = await useAppStore.getState().importFromClipboard({ target: 'overlay' });
    expect(count).toBe(1);
    expect(overlaySpy).toHaveBeenCalledTimes(1);
  });

  it('routes pasted clipboard image to addBatchFiles when in batch print mode', async () => {
    window.printStudioAPI = {
      readClipboardImage: vi.fn(async () => ({
        name: 'clip-batch.png',
        mimeType: 'image/png',
        bytes: PNG_HEADER,
      })),
    } as never;

    const batchSpy = vi.fn(async () => {});
    useAppStore.setState({ appMode: 'batch', addBatchFiles: batchSpy });

    const count = await useAppStore.getState().importFromClipboard({ target: 'document' });
    expect(count).toBe(1);
    expect(batchSpy).toHaveBeenCalledTimes(1);
  });

  it('shows friendly localized toast when permission is denied', async () => {
    const err = new Error('Denied');
    err.name = 'NotAllowedError';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: vi.fn(async () => { throw err; }) },
    });

    const count = await useAppStore.getState().importFromClipboard();
    expect(count).toBe(0);
    const toasts = useAppStore.getState().toasts;
    expect(toasts.some((item) => item.title.includes('کلیپ‌بورد'))).toBe(true);
  });
});

describe('App unmocked startup mount & clipboard UI integration', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('mounts full <App /> cleanly without mocking initializeWorkspace and renders clipboard buttons', async () => {
    const initial = useAppStore.getState();
    const importSpy = vi.fn<(files: File[]) => Promise<void>>(async () => {});
    const batchSpy = vi.fn<(files: File[]) => Promise<void>>(async () => {});
    useAppStore.setState({
      appMode: 'studio',
      documents: [],
      pages: [],
      bookmarks: [],
      overlays: [],
      settings: { ...DEFAULT_SETTINGS, language: 'fa' },
      layout: { ...DEFAULT_LAYOUT },
      importFiles: importSpy,
      addBatchFiles: batchSpy,
    });

    act(() => root.render(React.createElement(App)));
    await flush();

    // App shell renders without hitting ErrorBoundary
    expect(host.querySelector('[data-psp-app-shell]')).not.toBeNull();
    expect(host.querySelector('[data-ribbon-action="paste-clipboard"]')).not.toBeNull();
    expect(host.querySelector('[data-empty-paste-clipboard]')).not.toBeNull();

    // Ctrl+V paste event carrying clipboardData.items (empty .files) imports cleanly
    const snip = new File([PNG_HEADER], 'image.png', { type: 'image/png' });
    const pasteEv = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEv, 'clipboardData', {
      value: {
        files: [],
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => snip }],
        getData: () => '',
      },
    });
    act(() => {
      window.dispatchEvent(pasteEv);
    });
    await flush();

    expect(pasteEv.defaultPrevented).toBe(true);
    expect(importSpy).toHaveBeenCalledTimes(1);
    expect(importSpy.mock.calls[0]?.[0]?.[0]?.name).toMatch(/^clipboard-image-\d+-1\.png$/);

    // Pasting text inside a focused input element does NOT get hijacked
    const input = document.createElement('input');
    input.type = 'text';
    host.appendChild(input);
    const textPasteEv = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(textPasteEv, 'clipboardData', {
      value: {
        files: [],
        items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
        getData: (t: string) => (t === 'text/plain' ? 'hello world' : ''),
      },
    });
    act(() => {
      input.dispatchEvent(textPasteEv);
    });
    expect(textPasteEv.defaultPrevented).toBe(false);

    // Switching to Batch mode renders batch paste button & routes paste to addBatchFiles
    act(() => {
      useAppStore.getState().setAppMode('batch');
    });
    await flush();
    expect(host.querySelector('[data-batch-paste-clipboard]')).not.toBeNull();

    const batchPasteEv = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(batchPasteEv, 'clipboardData', {
      value: {
        files: [],
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => snip }],
        getData: () => '',
      },
    });
    act(() => {
      window.dispatchEvent(batchPasteEv);
    });
    await flush();
    expect(batchSpy).toHaveBeenCalledTimes(1);

    useAppStore.setState({
      appMode: 'studio',
      importFiles: initial.importFiles,
      addBatchFiles: initial.addBatchFiles,
    });
  });
});
