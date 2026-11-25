// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { PageItem, PageOverlayText } from '@shared/models';
import { importFilesBatch } from './pdfService';
import { encodeRgbaToPngBytesUniversal } from './universalImageDecoder';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { TextControlPanel } from '../components/TextControlPanel';

async function makePngFile(name: string, r: number, g: number, b: number): Promise<File> {
  const rgba = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }
  const bytes = await encodeRgbaToPngBytesUniversal(rgba, 16, 16);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return {
    name,
    type: 'image/png',
    size: copy.byteLength,
    arrayBuffer: async () => copy.buffer.slice(0),
  } as unknown as File;
}

describe('Batch image bookmark grouping & independent text box size/justify UI', () => {
  it('groups all images imported in one batch into a single bookmark and prunes cleanly on delete', async () => {
    const f1 = await makePngFile('scan-01.png', 200, 40, 40);
    const f2 = await makePngFile('scan-02.png', 40, 200, 40);
    const f3 = await makePngFile('scan-03.png', 40, 40, 200);

    const batch = await importFilesBatch([f1, f2, f3]);
    expect(batch.documents).toHaveLength(3);
    expect(batch.pages).toHaveLength(3);
    expect(batch.bookmarks).toHaveLength(1);
    expect(batch.bookmarks[0].itemCount).toBe(3);
    expect(batch.bookmarks[0].documentIds).toEqual(batch.documents.map((d) => d.id));
    expect(batch.bookmarks[0].pageIds).toEqual(batch.pages.map((p) => p.id));

    // Importing a single image produces 1 bookmark with its filename
    const single = await importFilesBatch([await makePngFile('solo.png', 100, 100, 100)]);
    expect(single.bookmarks).toHaveLength(1);
    expect(single.bookmarks[0].title).toBe('solo.png');

    // Removing one document from store updates grouped bookmark rather than dropping all 3
    useAppStore.setState({
      documents: batch.documents,
      pages: batch.pages,
      bookmarks: batch.bookmarks,
    });
    useAppStore.getState().removeDocument(batch.documents[0].id);
    const afterOne = useAppStore.getState();
    expect(afterOne.documents).toHaveLength(2);
    expect(afterOne.bookmarks).toHaveLength(1);
    expect(afterOne.bookmarks[0].documentIds).toHaveLength(2);
    expect(afterOne.bookmarks[0].itemCount).toBe(2);

    useAppStore.getState().removeDocument(batch.documents[1].id);
    useAppStore.getState().removeDocument(batch.documents[2].id);
    expect(useAppStore.getState().bookmarks).toHaveLength(0);
  });

  it('allows editing text box width/height independently of font size and setting justify align in TextControlPanel', () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const page: PageItem = {
      id: 'p1',
      documentId: 'd1',
      documentName: 'd1.pdf',
      sourcePageNumber: 1,
      widthMm: 200,
      heightMm: 300,
      rotation: 0,
      selectedForPrint: true,
      isHighlighted: true,
      isBlankPage: false,
      colorProfile: 'color',
      inkCoveragePercent: 0,
    };
    const overlay: PageOverlayText = {
      id: 't1',
      kind: 'text',
      target: 'page',
      targetScope: 'current',
      targetPageIds: ['p1'],
      targetSheetIndex: 1,
      xPercent: 10,
      yPercent: 10,
      widthPercent: 50,
      heightPercent: 20,
      opacity: 1,
      rotation: 0,
      text: 'Sample paragraph text',
      fontSize: 18,
      fontFamily: 'Vazirmatn',
      color: '#000000',
      bold: false,
      italic: false,
      underline: false,
      align: 'left',
    };

    useAppStore.setState({
      pages: [page],
      documents: [],
      layout: {
        ...DEFAULT_LAYOUT,
        paperSize: 'Custom',
        customWidthMm: 200,
        customHeightMm: 300,
        duplexMode: 'none',
        marginsMm: { left: 0, right: 0, top: 0, bottom: 0 },
      },
      settings: { ...DEFAULT_SETTINGS, language: 'en' },
      overlays: [overlay],
      selectedOverlayId: 't1',
      activePageId: 'p1',
      activeSheetIndex: 0,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    act(() => root.render(React.createElement(TextControlPanel)));

    const wInput = host.querySelector<HTMLInputElement>('[aria-label="Text box width (mm)"]')!;
    const hInput = host.querySelector<HTMLInputElement>('[aria-label="Text box height (mm)"]')!;
    expect(Number(wInput.value)).toBeCloseTo(100, 1);
    expect(Number(hInput.value)).toBeCloseTo(60, 1);

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(wInput, '150');
      wInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const updated = useAppStore.getState().overlays[0] as PageOverlayText;
    expect(updated.widthPercent).toBeCloseTo(75, 1);
    expect(updated.fontSize).toBe(18);

    const justifyBtn = host.querySelector<HTMLButtonElement>('[aria-label="Align Justify"]')!;
    act(() => justifyBtn.click());
    expect((useAppStore.getState().overlays[0] as PageOverlayText).align).toBe('justify');

    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });
});
