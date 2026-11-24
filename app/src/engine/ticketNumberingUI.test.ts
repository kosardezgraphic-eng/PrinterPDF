// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketNumberingWorkspace } from '../components/TicketNumberingWorkspace';
import { createDefaultTicketConfig } from './ticketNumbering';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';

let root: Root;
let host: HTMLDivElement;

function pointerEvent(el: Element | Window, type: string, x: number, y: number) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperties(ev, {
    pointerId: { value: 1 },
    pointerType: { value: 'mouse' },
  });
  act(() => {
    el.dispatchEvent(ev);
  });
}

describe('TicketNumberingWorkspace interactive UI', () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-ticket-sheet-preview')) {
        return { left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => {} } as DOMRect;
      }
      if (this.hasAttribute('data-ticket-cell')) {
        return { left: 0, top: 0, right: 200, bottom: 300, width: 200, height: 300, x: 0, y: 0, toJSON: () => {} } as DOMRect;
      }
      return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => {} } as DOMRect;
    });

    useAppStore.setState({
      appMode: 'ticket',
      settings: { ...DEFAULT_SETTINGS, language: 'en' },
      layout: { ...DEFAULT_LAYOUT },
      pages: [],
      documents: [],
      overlays: [],
      ticketSourceDocument: null,
      ticketSourcePages: [],
      ticketSelectedSourcePageId: null,
      ticketConfig: {
        ...createDefaultTicketConfig(),
        rows: 2,
        cols: 2,
        direction: 'rtl',
        orderingMode: 'cut-stack',
        quantityMode: 'sheets',
        sheetCount: 4,
        startNumber: 1001,
      },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(React.createElement(TicketNumberingWorkspace));
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.restoreAllMocks();
  });

  it('displays consecutive cut-stack numbers across sheets (Sheet 1 -> 1001, Sheet 2 -> 1002 at same cell) and supports per-sheet switching', () => {
    const topRightCell = () => host.querySelector<HTMLElement>('[data-ticket-cell="0-1"]')!;
    expect(topRightCell().textContent).toContain('1001');

    act(() => {
      host.querySelector<HTMLButtonElement>('[data-ticket-preview-next]')!.click();
    });
    expect(topRightCell().textContent).toContain('1002');

    // Switch ordering mode to per-sheet
    const orderingSelect = host.querySelector<HTMLSelectElement>('[data-ticket-ordering-mode]')!;
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-ticket-preview-prev]')!.click();
      orderingSelect.value = 'per-sheet';
      orderingSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useAppStore.getState().ticketConfig.orderingMode).toBe('per-sheet');
    expect(host.querySelector<HTMLElement>('[data-ticket-cell="0-1"]')!.textContent).toContain('1001');
    expect(host.querySelector<HTMLElement>('[data-ticket-cell="0-0"]')!.textContent).toContain('1002');
  });

  it('allows dragging number slots, creating cut/perforation guides, and dragging guides with the mouse', () => {
    const slotId = useAppStore.getState().ticketConfig.numberSlots[0].id;
    const beforeX = useAppStore.getState().ticketConfig.numberSlots[0].xPercent;
    const slotEl = host.querySelector<HTMLElement>(`[data-ticket-slot-id="${slotId}"]`)!;

    pointerEvent(slotEl, 'pointerdown', 50, 50);
    pointerEvent(window, 'pointermove', 90, 80);
    pointerEvent(window, 'pointerup', 90, 80);

    expect(useAppStore.getState().ticketConfig.numberSlots[0].xPercent).toBeGreaterThan(beforeX);

    // Draw a new cut line with mouse
    const initialGuides = useAppStore.getState().ticketConfig.guideLines.length;
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-draw-ticket-guide="cut"]')!.click();
    });
    const sheetEl = host.querySelector<HTMLElement>('[data-ticket-sheet-preview]')!;
    pointerEvent(sheetEl, 'pointerdown', 120, 150);
    pointerEvent(window, 'pointermove', 160, 150);
    pointerEvent(window, 'pointerup', 160, 150);

    const guidesAfterDraw = useAppStore.getState().ticketConfig.guideLines;
    expect(guidesAfterDraw).toHaveLength(initialGuides + 1);
    const createdGuide = guidesAfterDraw[guidesAfterDraw.length - 1];
    expect(createdGuide.kind).toBe('cut');

    // Drag the created guide line with mouse
    const guideEl = host.querySelector<HTMLElement>(`[data-ticket-guide-id="${createdGuide.id}"]`)!;
    const posBeforeDrag = createdGuide.positionPercent;
    pointerEvent(guideEl, 'pointerdown', 160, 150);
    pointerEvent(window, 'pointermove', 200, 150);
    pointerEvent(window, 'pointerup', 200, 150);
    expect(
      useAppStore.getState().ticketConfig.guideLines.find((g) => g.id === createdGuide.id)!.positionPercent
    ).not.toBe(posBeforeDrag);
  });

  it('generates all ticket sheets and opens Studio with editable numbering and guide overlays', () => {
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-ticket-generate-studio]')!.click();
    });
    const state = useAppStore.getState();
    expect(state.appMode).toBe('studio');
    expect(state.pages).toHaveLength(16); // 4 sheets * (2x2)
    expect(state.layout.rows).toBe(2);
    expect(state.layout.cols).toBe(2);
    expect(state.overlays.some((o) => o.kind === 'numbering' && o.sequenceBasis === 'cut-stack')).toBe(true);
    expect(state.overlays.some((o) => o.kind === 'shape' && o.type === 'line')).toBe(true);
  });

  it('preserves exact A4 (210x297) portrait and landscape aspect ratios even in a short wide viewport', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-ticket-sheet-stage')) {
        return { left: 0, top: 0, right: 900, bottom: 480, width: 900, height: 480, x: 0, y: 0, toJSON: () => {} } as DOMRect;
      }
      if (this.hasAttribute('data-ticket-sheet-preview')) {
        return { left: 0, top: 0, right: 316.8, bottom: 448, width: 316.8, height: 448, x: 0, y: 0, toJSON: () => {} } as DOMRect;
      }
      return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => {} } as DOMRect;
    });

    act(() => {
      useAppStore.getState().updateTicketConfig({
        paperSize: 'A4',
        orientation: 'portrait',
      });
      window.dispatchEvent(new Event('resize'));
    });

    const sheetEl = host.querySelector<HTMLElement>('[data-ticket-sheet-preview]')!;
    const portraitW = parseFloat(sheetEl.style.width);
    const portraitH = parseFloat(sheetEl.style.height);
    expect(portraitW).toBeGreaterThan(0);
    expect(portraitH).toBeGreaterThan(portraitW);
    expect(portraitW / portraitH).toBeCloseTo(210 / 297, 2);
    expect(host.querySelector<HTMLElement>('[data-ticket-sheet-dimensions]')!.textContent).toContain('210 × 297 mm');

    act(() => {
      useAppStore.getState().updateTicketConfig({
        orientation: 'landscape',
      });
    });

    const landscapeW = parseFloat(sheetEl.style.width);
    const landscapeH = parseFloat(sheetEl.style.height);
    expect(landscapeW).toBeGreaterThan(landscapeH);
    expect(landscapeW / landscapeH).toBeCloseTo(297 / 210, 2);
    expect(host.querySelector<HTMLElement>('[data-ticket-sheet-dimensions]')!.textContent).toContain('297 × 210 mm');
  });

  it('aligns selected ticket number slot relative to Cell, Sheet, and Other Slots via [data-ticket-align-bar]', () => {
    const slot1Id = useAppStore.getState().ticketConfig.numberSlots[0].id;
    act(() => {
      useAppStore.getState().updateTicketConfig((prev) => ({
        ...prev,
        numberSlots: prev.numberSlots.map((s) =>
          s.id === slot1Id ? { ...s, xPercent: 12, yPercent: 14, widthPercent: 24, heightPercent: 10 } : s
        ),
      }));
    });

    const initialCount = useAppStore.getState().ticketConfig.numberSlots.length;
    // Add a new slot (becomes selected)
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-ticket-add-slot]')!.click();
    });
    const slotsAfterAdd = useAppStore.getState().ticketConfig.numberSlots;
    expect(slotsAfterAdd).toHaveLength(initialCount + 1);
    const slot2Id = slotsAfterAdd[slotsAfterAdd.length - 1].id;

    // Make existing other slots share xPercent=12 so union left edge is 12
    act(() => {
      useAppStore.getState().updateTicketConfig((prev) => ({
        ...prev,
        numberSlots: prev.numberSlots.map((s) =>
          s.id === slot2Id ? s : { ...s, xPercent: 12, yPercent: 14, widthPercent: 24, heightPercent: 10 }
        ),
      }));
    });

    const alignBar = host.querySelector('[data-ticket-align-bar]');
    expect(alignBar).toBeTruthy();

    // Align new slot to Other Slots left edge (12)
    const refSelect = host.querySelector<HTMLSelectElement>('[data-ticket-align-reference]')!;
    act(() => {
      refSelect.value = 'others';
      refSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-ticket-align="left"]')!.click();
    });
    expect(
      useAppStore.getState().ticketConfig.numberSlots.find((s) => s.id === slot2Id)!.xPercent
    ).toBeCloseTo(12, 1);

    // Align slot to Cell horizontal center
    act(() => {
      refSelect.value = 'cell';
      refSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-ticket-align="hcenter"]')!.click();
    });
    const slot2Centered = useAppStore.getState().ticketConfig.numberSlots.find((s) => s.id === slot2Id)!;
    expect(slot2Centered.xPercent).toBeCloseTo((100 - slot2Centered.widthPercent) / 2, 1);
  });
});
