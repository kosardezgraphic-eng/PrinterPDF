// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem, SourceDocument } from '@shared/models';
import { App } from '../App';
import { DEFAULT_EFFECTS, DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { getDefaultPageNumberSettings, getDefaultWatermarkSettings } from './watermarkEngine';

const makeDoc = (id = 'd1'): SourceDocument => ({
  id,
  name: 'sample.pdf',
  filePath: '',
  fileSize: 2048,
  fileType: 'pdf',
  mimeType: 'application/pdf',
  pageCount: 2,
  createdAt: '2026-01-01T00:00:00Z',
});

const makePage = (id: string, highlighted = false, selectedForPrint = true): PageItem => ({
  id,
  documentId: 'd1',
  documentName: 'sample.pdf',
  sourcePageNumber: 1,
  widthMm: 210,
  heightMm: 297,
  rotation: 0,
  selectedForPrint,
  isHighlighted: highlighted,
  isBlankPage: false,
  colorProfile: 'color',
  inkCoveragePercent: 10,
  thumbnailDataUrl: 'data:image/png;base64,AA==',
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState({
    initializeWorkspace: vi.fn(async () => {}),
    restorePreferences: vi.fn(async () => {}),
    documents: [makeDoc()],
    pages: [makePage('p1', true, false), makePage('p2', false, false)],
    activePageId: 'p1',
    bookmarks: [],
    overlays: [],
    selectedOverlayId: null,
    textEdit: null,
    settings: { ...DEFAULT_SETTINGS, language: 'en', theme: 'light' },
    layout: { ...DEFAULT_LAYOUT, duplexMode: 'none' },
    effects: { ...DEFAULT_EFFECTS },
    watermark: getDefaultWatermarkSettings(),
    pageNumbering: getDefaultPageNumberSettings(),
    showPrintModal: false,
    showSettingsModal: false,
    showShortcutsModal: false,
    showRulers: true,
    snapEnabled: true,
    toasts: [],
  } as never);

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(React.createElement(App));
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('Duplicate page custom count & keyboard shortcuts UI', () => {
  it('allows entering a custom copy count in Duplicate Page dropdown', () => {
    const toggleBtn = host.querySelector<HTMLButtonElement>('[data-ribbon-action="duplicate-array-menu"]');
    expect(toggleBtn).not.toBeNull();
    act(() => toggleBtn!.click());

    const input = host.querySelector<HTMLInputElement>('[data-duplicate-custom-input]');
    const applyBtn = host.querySelector<HTMLButtonElement>('[data-duplicate-custom-apply]');
    expect(input).not.toBeNull();
    expect(applyBtn).not.toBeNull();

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, '5');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      applyBtn!.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    // p1 repeated to 5 copies + untouched p2 = 6 total pages
    expect(useAppStore.getState().pages).toHaveLength(6);
    expect(host.querySelector('[data-duplicate-array-menu]')).toBeNull();
  });

  it('handles Ctrl+D, Shift+Insert, Ctrl+P (Quick Print), Ctrl+Shift+P, Ctrl+W, Ctrl+O, Ctrl+A and companion shortcuts', () => {
    const silentPrintSpy = vi.fn(async () => {});
    const fitSpy = vi.fn();
    useAppStore.setState({
      silentPrintNow: silentPrintSpy,
      triggerFitPage: fitSpy,
    } as never);

    // Ctrl+D duplicates highlighted page p1 (2 -> 3)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(useAppStore.getState().pages).toHaveLength(3);

    // Shift+Insert inserts blank page after highlighted pages
    const beforeBlank = useAppStore.getState().pages.length;
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Insert', code: 'Insert', shiftKey: true, bubbles: true, cancelable: true })
      );
    });
    const afterBlankPages = useAppStore.getState().pages;
    expect(afterBlankPages.length).toBeGreaterThan(beforeBlank);
    expect(afterBlankPages.some((p) => p.isBlankPage)).toBe(true);

    // Ctrl+P triggers Quick Print (silentPrintNow), NOT Print modal
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(silentPrintSpy).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().showPrintModal).toBe(false);

    // Ctrl+Shift+P opens Full Print Dialog
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
      );
    });
    expect(useAppStore.getState().showPrintModal).toBe(true);
    act(() => useAppStore.getState().setModalState('print', false));

    // Ctrl+A selects all pages for print
    expect(useAppStore.getState().pages.every((p) => p.selectedForPrint)).toBe(false);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(useAppStore.getState().pages.every((p) => p.selectedForPrint)).toBe(true);

    // Ctrl+O clicks the hidden file input in TopToolRibbon
    const addFileInput = host.querySelector<HTMLInputElement>('[data-top-tool-ribbon] input[type="file"]');
    expect(addFileInput).not.toBeNull();
    const fileClickSpy = vi.spyOn(addFileInput!, 'click');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(fileClickSpy).toHaveBeenCalledTimes(1);

    // Ctrl+R rotates selected pages, Ctrl+0 triggers Fit Page, Ctrl+G toggles rulers, Ctrl+M toggles snap
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', code: 'Digit0', ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(useAppStore.getState().pages[0].rotation).toBe(90);
    expect(fitSpy).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().showRulers).toBe(false);
    expect(useAppStore.getState().snapEnabled).toBe(false);

    // Ctrl+W closes all files and clears workspace
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(useAppStore.getState().documents).toHaveLength(0);
    expect(useAppStore.getState().pages).toHaveLength(0);
  });

  it('displays shortcuts in tooltips and opens the Keyboard Shortcuts modal from toolbar, Settings, F1, and Ctrl+/', () => {
    // Check tooltip annotations include shortcuts
    const addBtnWrap = host.querySelector('[data-ribbon-action="add-files"]')?.closest('[data-tooltip]');
    const blankBtnWrap = host.querySelector('[data-ribbon-action="blank-page"]')?.closest('[data-tooltip]');
    const dupBtnWrap = host.querySelector('[data-ribbon-action="duplicate-page"]')?.closest('[data-tooltip]');
    const closeAllWrap = host.querySelector('[data-ribbon-action="close-all"]')?.closest('[data-tooltip]');
    const quickPrintBtn = host.querySelector<HTMLButtonElement>('[data-quick-print]');

    expect(addBtnWrap?.getAttribute('data-tooltip')).toContain('Ctrl+O');
    expect(blankBtnWrap?.getAttribute('data-tooltip')).toContain('Shift+Insert');
    expect(dupBtnWrap?.getAttribute('data-tooltip')).toContain('Ctrl+D');
    expect(closeAllWrap?.getAttribute('data-tooltip')).toContain('Ctrl+W');
    expect(quickPrintBtn?.getAttribute('title')).toContain('Ctrl+P');

    // Open shortcuts modal via QuickBar trigger
    const trigger = host.querySelector<HTMLButtonElement>('[data-shortcuts-trigger]');
    expect(trigger).not.toBeNull();
    act(() => trigger!.click());

    const modal = host.querySelector('[data-shortcuts-modal]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('Ctrl+D');
    expect(modal?.textContent).toContain('Shift+Insert');
    expect(modal?.textContent).toContain('Ctrl+P');
    expect(modal?.textContent).toContain('Ctrl+W');
    expect(modal?.textContent).toContain('Ctrl+O');
    expect(modal?.textContent).toContain('Ctrl+A');

    // Close via Escape
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(host.querySelector('[data-shortcuts-modal]')).toBeNull();

    // Open via F1 and close via Ctrl+/
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true }));
    });
    expect(host.querySelector('[data-shortcuts-modal]')).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(host.querySelector('[data-shortcuts-modal]')).toBeNull();

    // Also accessible from Settings modal
    act(() => useAppStore.getState().setModalState('settings', true));
    const settingsShortcutsBtn = host.querySelector<HTMLButtonElement>('[data-open-shortcuts-from-settings]');
    expect(settingsShortcutsBtn).not.toBeNull();
    act(() => settingsShortcutsBtn!.click());
    expect(useAppStore.getState().showSettingsModal).toBe(false);
    expect(host.querySelector('[data-shortcuts-modal]')).not.toBeNull();
  });
});
