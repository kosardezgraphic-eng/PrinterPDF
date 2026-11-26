// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem, SourceDocument } from '@shared/models';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { TicketNumberingWorkspace } from '../components/TicketNumberingWorkspace';
import { createDefaultTicketConfig } from './ticketNumbering';

function pointer(el: Element, type: string, x: number, y: number) {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperties(e, {
    pointerId: { value: 1 },
    pointerType: { value: 'mouse' },
  });
  act(() => el.dispatchEvent(e));
}

describe('TicketNumberingWorkspace image move & editing', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    const doc: SourceDocument = {
      id: 'ticket-doc',
      name: 'voucher.png',
      filePath: '',
      fileSize: 1024,
      fileType: 'image',
      mimeType: 'image/png',
      pageCount: 1,
      createdAt: '',
    };
    const page: PageItem = {
      id: 'ticket-page-1',
      documentId: 'ticket-doc',
      documentName: 'voucher.png',
      sourcePageNumber: 1,
      widthMm: 100,
      heightMm: 50,
      rotation: 0,
      selectedForPrint: true,
      isHighlighted: true,
      isBlankPage: false,
      colorProfile: 'color',
      inkCoveragePercent: 30,
      thumbnailDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    };

    useAppStore.setState({
      appMode: 'ticket',
      documents: [doc],
      pages: [page],
      ticketSourceDocument: doc,
      ticketSourcePages: [page],
      ticketSelectedSourcePageId: page.id,
      ticketConfig: {
        ...createDefaultTicketConfig(),
        rows: 2,
        cols: 1,
        quantityMode: 'sheets',
        sheetCount: 2,
      },
      layout: DEFAULT_LAYOUT,
      settings: { ...DEFAULT_SETTINGS, language: 'en' },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(React.createElement(TicketNumberingWorkspace)));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('switches into Edit Artwork mode, drags/resizes/rotates/crops ticket image, resets cleanly, and transfers transforms to Studio', () => {
    const editBtn = host.querySelector<HTMLButtonElement>('[data-ticket-edit-image]')!;
    expect(editBtn).not.toBeNull();
    act(() => editBtn.click());

    const imagePanel = host.querySelector('[data-ticket-image-panel]');
    expect(imagePanel).not.toBeNull();

    const imageBox = host.querySelector<HTMLElement>('[data-ticket-image-box]')!;
    expect(imageBox).not.toBeNull();
    const sheetEl = host.querySelector<HTMLElement>('[data-ticket-sheet-preview]')!;
    vi.spyOn(sheetEl, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 600,
      right: 400,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Move artwork inside the ticket cell
    pointer(imageBox, 'pointerdown', 100, 100);
    pointer(imageBox, 'pointermove', 140, 130);
    pointer(imageBox, 'pointerup', 140, 130);

    let tf = useAppStore.getState().ticketConfig.imageTransform!;
    expect(tf.xPercent).not.toBe(0);
    expect(tf.yPercent).not.toBe(0);

    // Resize artwork via corner handle
    const resizeHandle = imageBox.querySelector<HTMLElement>('[data-ticket-image-resize="se"]')!;
    expect(resizeHandle).not.toBeNull();
    pointer(resizeHandle, 'pointerdown', 200, 200);
    pointer(resizeHandle, 'pointermove', 160, 170);
    pointer(resizeHandle, 'pointerup', 160, 170);

    tf = useAppStore.getState().ticketConfig.imageTransform!;
    expect(tf.widthPercent).toBeLessThan(100);
    expect(tf.heightPercent).toBeLessThan(100);

    // Rotate 90° via sidebar card
    const rot90Btn = Array.from(imagePanel!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('+90°')
    )!;
    act(() => rot90Btn.click());
    expect(useAppStore.getState().ticketConfig.imageTransform?.rotation).toBe(90);

    // Transfer to Studio carries edited rotation & transform onto generated ticket pages
    act(() => {
      useAppStore.getState().generateTicketSheetsToStudio();
    });
    const studioPages = useAppStore.getState().pages;
    expect(studioPages.length).toBe(4);
    expect(studioPages[0].overrides?.transform?.rotationDeg).toBe(90);
    expect(studioPages[0].overrides?.transform?.scaleX).toBeLessThan(1);

    // Reset button restores default transform
    const resetBtn = host.querySelector<HTMLButtonElement>('[data-ticket-reset-image]')!;
    act(() => resetBtn.click());
    const resetTf = useAppStore.getState().ticketConfig.imageTransform!;
    expect(resetTf).toMatchObject({
      xPercent: 0,
      yPercent: 0,
      widthPercent: 100,
      heightPercent: 100,
      rotation: 0,
      opacity: 1,
    });
  });
});
