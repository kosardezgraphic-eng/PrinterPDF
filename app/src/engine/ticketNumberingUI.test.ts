// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketNumberingWorkspace } from '../components/TicketNumberingWorkspace';
import { createDefaultTicketConfig } from './ticketNumbering';
import { DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';

const rect = (left: number, top: number, width: number, height: number) =>
  ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect;

function pointer(el: Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  act(() => el.dispatchEvent(event));
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => true) });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
  useAppStore.setState({
    settings: { ...DEFAULT_SETTINGS, language: 'en' },
    ticketConfig: createDefaultTicketConfig(),
    ticketSourceDocument: null,
    ticketSourcePages: [],
    ticketSelectedSourcePageId: null,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(React.createElement(TicketNumberingWorkspace)));
  const sheet = host.querySelector<HTMLElement>('[data-ticket-sheet-preview]')!;
  vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue(rect(100, 50, 420, 594));
  const cell = host.querySelector<HTMLElement>('[data-ticket-cell="0-0"]')!;
  vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(rect(108, 58, 404, 190));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('ticket sheet mouse editing', () => {
  it('moves a number slot by dragging it without changing its dimensions', () => {
    const slot = host.querySelector<HTMLElement>('[data-ticket-slot-id="slot-main"]')!;
    const before = useAppStore.getState().ticketConfig.numberSlots.find(item => item.id === 'slot-main')!;
    const x = 108 + (before.xPercent + 4) / 100 * 404;
    const y = 58 + (before.yPercent + 3) / 100 * 190;
    pointer(slot, 'pointerdown', x, y);
    pointer(host.querySelector('[data-ticket-sheet-preview]')!, 'pointermove', x + 20, y + 15);
    pointer(host.querySelector('[data-ticket-sheet-preview]')!, 'pointerup', x + 20, y + 15);
    const after = useAppStore.getState().ticketConfig.numberSlots.find(item => item.id === 'slot-main')!;
    expect(after.xPercent).toBeGreaterThan(before.xPercent);
    expect(after.yPercent).toBeGreaterThan(before.yPercent);
    expect(after.widthPercent).toBe(before.widthPercent);
    expect(after.heightPercent).toBe(before.heightPercent);
  });

  it('draws a cut line with the mouse and lets the line be repositioned', () => {
    act(() => host.querySelector<HTMLButtonElement>('[data-draw-ticket-guide="cut"]')!.click());
    const sheet = host.querySelector('[data-ticket-sheet-preview]')!;
    pointer(sheet, 'pointerdown', 200, 180);
    pointer(sheet, 'pointermove', 230, 180);
    pointer(sheet, 'pointerup', 230, 180);

    const created = useAppStore.getState().ticketConfig.guideLines.find(line => line.kind === 'cut');
    expect(created).toBeTruthy();
    const before = created!.positionPercent;
    const line = host.querySelector<HTMLElement>(`[data-ticket-guide-id="${created!.id}"]`)!;
    pointer(line, 'pointerdown', 230, 180);
    pointer(sheet, 'pointermove', 250, 180);
    pointer(sheet, 'pointerup', 250, 180);
    const after = useAppStore.getState().ticketConfig.guideLines.find(item => item.id === created!.id)!;
    expect(after.positionPercent).toBeGreaterThan(before);
  });
});
