// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem, PrinterInfo } from '@shared/models';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { Ribbon } from '../components/Ribbon';
import { PreviewWorkspace } from '../components/PreviewWorkspace';
import { SidebarPages } from '../components/SidebarPages';
import { ModalsAndToasts } from '../components/Modals';
import { ipcBridge } from './ipcBridge';
import { formatMarginValue } from './marginPresets';

const makePage = (id = 'p1'): PageItem => ({
  id,
  documentId: 'doc-1',
  documentName: 'sample.pdf',
  sourcePageNumber: 1,
  widthMm: 148,
  heightMm: 210,
  rotation: 0,
  selectedForPrint: true,
  isHighlighted: true,
  isBlankPage: false,
  colorProfile: 'color',
  inkCoveragePercent: 20,
  thumbnailDataUrl: 'data:image/png;base64,AA==',
});

const makePrinter = (): PrinterInfo => ({
  name: 'HP LaserJet Pro',
  isDefault: true,
  isNetwork: false,
  isVirtual: false,
  status: 'Ready',
  driverName: 'HP Universal',
  portName: 'USB001',
  jobsInQueue: 0,
  capabilities: {
    supportsDuplex: true,
    supportsColor: false,
    supportedPapers: ['A4', 'A5', 'Letter'],
    paperOptions: [
      { id: 'A4', name: 'A4', widthMm: 210, heightMm: 297 },
      { id: 'A5', name: 'A5', widthMm: 148, heightMm: 210 },
      { id: 'Letter', name: 'Letter', widthMm: 215.9, heightMm: 279.4 },
    ],
    supportedTrays: ['Auto Select', 'Tray 1'],
    supportedMediaTypes: ['Plain Paper'],
    supportedDpi: [300, 600],
    maxCopies: 99,
    supportsCollate: true,
  },
  activeProfile: {
    printerName: 'HP LaserJet Pro',
    paperSize: 'A4',
    paperName: 'A4',
    paperWidthMm: 210,
    paperHeightMm: 297,
    orientation: 'portrait',
    tray: 'Auto Select',
    mediaType: 'Plain Paper',
    dpi: 600,
    quality: 'normal',
    duplexMode: 'long-edge',
    colorMode: 'monochrome',
    collate: true,
  },
});

function setInputValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto =
    input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('margin presets dropdown, right-click Page Setup, and PageSetupModal', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
    vi.spyOn(ipcBridge, 'getPrinterMargins').mockResolvedValue({
      status: 'available',
      source: 'hardware',
      marginsMm: { top: 4, bottom: 4, left: 4, right: 4 },
    });
    vi.spyOn(ipcBridge, 'updatePrinterProfile').mockResolvedValue({} as never);
    useAppStore.setState({
      documents: [
        {
          id: 'doc-1',
          name: 'sample.pdf',
          filePath: '',
          fileSize: 1024,
          fileType: 'pdf',
          mimeType: 'application/pdf',
          pageCount: 1,
          createdAt: '',
        },
      ],
      pages: [makePage('p1')],
      printers: [makePrinter()],
      selectedPrinterName: 'HP LaserJet Pro',
      printerMargins: {
        status: 'available',
        source: 'hardware',
        marginsMm: { top: 4, bottom: 4, left: 4, right: 4 },
      },
      layout: {
        ...DEFAULT_LAYOUT,
        paperSize: 'A4',
        orientation: 'portrait',
        marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
        marginMode: 'custom',
        duplexMode: 'long-edge',
      },
      settings: { ...DEFAULT_SETTINGS, language: 'en', unit: 'cm' },
      activeRibbonTab: 'layout',
      ribbonCollapsed: false,
      lastCustomMarginsMm: null,
      showPageSetupModal: false,
      pageSetupInitialTab: 'margins',
      viewMode: 'single',
      activeSheetIndex: 0,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Ribbon, { onOpenWatermarkPanel: () => {}, onOpenBookletPanel: () => {} }),
          React.createElement(SidebarPages),
          React.createElement(PreviewWorkspace, { onCursorMoveMm: () => {} }),
          React.createElement(ModalsAndToasts),
        ),
      );
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('shows all quick margin presets, applies them with hardware clamping, and tracks Last Custom Settings', () => {
    const trigger = container.querySelector<HTMLButtonElement>('[data-margin-presets-trigger]')!;
    expect(trigger).toBeTruthy();
    act(() => trigger.click());

    const menu = document.querySelector<HTMLElement>('[data-margin-presets-menu]')!;
    expect(menu).toBeTruthy();

    const presetIds = Array.from(menu.querySelectorAll('[data-margin-preset]')).map((el) =>
      el.getAttribute('data-margin-preset'),
    );
    expect(presetIds).toEqual(['last-custom', 'hardware', 'normal', 'narrow', 'moderate', 'wide']);

    // Displays Normal in cm (2 cm, 2 cm, 3 cm, 1.5 cm)
    const normalBtn = menu.querySelector<HTMLButtonElement>('[data-margin-preset="normal"]')!;
    expect(normalBtn.textContent).toContain('2 cm');
    expect(normalBtn.textContent).toContain('3 cm');
    expect(normalBtn.textContent).toContain('1.5 cm');

    // Apply Normal
    act(() => normalBtn.click());
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 20, bottom: 20, left: 30, right: 15 });
    expect(document.querySelector('[data-margin-presets-menu]')).toBeNull();

    // Custom edit records Last Custom Settings, and switching to Wide leaves Last Custom intact
    act(() => useAppStore.getState().updateMargins({ top: 12, right: 22, bottom: 14, left: 18 }));
    expect(useAppStore.getState().lastCustomMarginsMm).toEqual({ top: 12, right: 22, bottom: 14, left: 18 });

    act(() => trigger.click());
    const wideBtn = document.querySelector<HTMLButtonElement>('[data-margin-preset="wide"]')!;
    act(() => wideBtn.click());
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 25, bottom: 25, left: 51, right: 51 });
    expect(useAppStore.getState().lastCustomMarginsMm).toEqual({ top: 12, right: 22, bottom: 14, left: 18 });

    // Apply Last Custom Settings restores { 12, 22, 14, 18 }
    act(() => trigger.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-margin-preset="last-custom"]')!.click());
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 12, right: 22, bottom: 14, left: 18 });

    // Hardware Margins applies printer min (4 mm)
    act(() => trigger.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-margin-preset="hardware"]')!.click());
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 4, bottom: 4, left: 4, right: 4 });
    expect(useAppStore.getState().layout.marginMode).toBe('printer');

    // Narrow (13mm) clamps cleanly when hardware min is higher (e.g. 15mm)
    act(() => {
      useAppStore.setState({
        printerMargins: {
          status: 'available',
          source: 'hardware',
          marginsMm: { top: 15, bottom: 15, left: 15, right: 15 },
        },
      });
    });
    act(() => trigger.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-margin-preset="narrow"]')!.click());
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 15, bottom: 15, left: 15, right: 15 });

    // Custom Margins... opens Page Setup modal
    act(() => trigger.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-margin-preset-custom]')!.click());
    expect(useAppStore.getState().showPageSetupModal).toBe(true);
    expect(document.querySelector('[data-page-setup-modal]')).toBeTruthy();
  });

  it('places Page Setup as the last right-click menu item on preview page, sheet canvas, and sidebar thumbnail', () => {
    // 1. Right-click on preview page cell
    const canvasPage = container.querySelector('[data-canvas-page-id="p1"]')!;
    act(() => {
      canvasPage.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    });
    const layerMenu = document.querySelector('[data-layer-menu]')!;
    expect(layerMenu).toBeTruthy();
    const layerItems = Array.from(layerMenu.querySelectorAll('[role="menuitem"]'));
    expect(layerItems[layerItems.length - 1].getAttribute('data-context-action')).toBe('page-setup');
    act(() => (layerItems[layerItems.length - 1] as HTMLButtonElement).click());
    expect(document.querySelector('[data-page-setup-modal]')).toBeTruthy();
    act(() => useAppStore.getState().setModalState('pageSetup', false));

    // 2. Right-click on sheet paper background
    const sheetCanvas = container.querySelector('[data-sheet-canvas-index]')!;
    act(() => {
      sheetCanvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 12, clientY: 12 }));
    });
    const sheetMenu = document.querySelector('[data-sheet-context-menu]')!;
    expect(sheetMenu).toBeTruthy();
    const sheetItems = Array.from(sheetMenu.querySelectorAll('[role="menuitem"]'));
    expect(sheetItems[sheetItems.length - 1].getAttribute('data-context-action')).toBe('page-setup');
    act(() => (sheetItems[sheetItems.length - 1] as HTMLButtonElement).click());
    expect(document.querySelector('[data-page-setup-modal]')).toBeTruthy();
    act(() => useAppStore.getState().setModalState('pageSetup', false));

    // 3. Right-click on sidebar page card
    const sidebarCard = container.querySelector('[data-page-id="p1"]')!;
    act(() => {
      sidebarCard.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 25, clientY: 25 }));
    });
    const sidebarMenu = document.querySelector('[data-page-context-menu]')!;
    expect(sidebarMenu).toBeTruthy();
    const sidebarButtons = Array.from(sidebarMenu.querySelectorAll('button'));
    expect(sidebarButtons[sidebarButtons.length - 1].getAttribute('data-context-action')).toBe('page-setup');
    act(() => sidebarButtons[sidebarButtons.length - 1].click());
    expect(document.querySelector('[data-page-setup-modal]')).toBeTruthy();
  });

  it('applies full margins, booklet spine, paper size, orientation, and duplex from PageSetupModal and syncs printer profile', async () => {
    const syncSpy = vi.fn(async () => {});
    useAppStore.setState({ updatePrinterProfile: syncSpy });

    act(() => useAppStore.getState().openPageSetup('margins'));
    const modal = document.querySelector('[data-page-setup-modal]')!;
    expect(modal).toBeTruthy();

    // Update top margin & try setting below printer min (1mm -> clamped to 4mm)
    const topInput = modal.querySelector<HTMLInputElement>('[data-page-setup-margin="top"]')!;
    const leftInput = modal.querySelector<HTMLInputElement>('[data-page-setup-margin="left"]')!;
    setInputValue(topInput, '24');
    setInputValue(leftInput, '1');

    // Enable booklet & set spine width to 12 mm
    const bookletToggle = modal.querySelector<HTMLInputElement>('[data-page-setup-booklet-toggle]')!;
    act(() => bookletToggle.click());
    const spineInput = modal.querySelector<HTMLInputElement>('[data-page-setup-spine]')!;
    setInputValue(spineInput, '12');

    // Switch to Paper & Layout tab
    const paperTab = modal.querySelector<HTMLButtonElement>('[data-page-setup-tab="paper"]')!;
    act(() => paperTab.click());

    const paperSelect = modal.querySelector<HTMLSelectElement>('[data-page-setup-paper]')!;
    setInputValue(paperSelect, 'A5');

    const duplexSelect = modal.querySelector<HTMLSelectElement>('[data-page-setup-duplex]')!;
    setInputValue(duplexSelect, 'short-edge');

    // Apply
    const applyBtn = modal.querySelector<HTMLButtonElement>('[data-page-setup-apply]')!;
    await act(async () => {
      applyBtn.click();
      await Promise.resolve();
    });

    const state = useAppStore.getState();
    expect(state.showPageSetupModal).toBe(false);
    expect(state.layout.marginsMm.top).toBe(24);
    expect(state.layout.marginsMm.left).toBe(4);
    expect(state.layout.booklet?.enabled).toBe(true);
    expect(state.layout.booklet?.spineWidthMm).toBe(12);
    expect(state.layout.paperSize).toBe('A5');
    expect(state.layout.duplexMode).toBe('short-edge');
    expect(state.layout.booklet?.duplexMode).toBe('short-edge');
    expect(syncSpy).toHaveBeenCalledWith(
      'HP LaserJet Pro',
      expect.objectContaining({
        paperSize: 'A5',
        paperName: 'A5',
        duplexMode: 'short-edge',
      }),
    );
  });

  it('applies exact preset numbers (including fractional hardware mm), shows mirrored odd/even preview & canvas, and edits mirrored back margins', () => {
    expect(formatMarginValue(4.23, 'mm')).toBe('4.23 mm');
    expect(formatMarginValue(20, 'cm')).toBe('2 cm');

    // Add second page & switch to continuous mode so both Front (odd) and Back (even) sheets render
    act(() => {
      useAppStore.setState({
        pages: [makePage('p1'), { ...makePage('p2'), sourcePageNumber: 2 }],
        viewMode: 'continuous',
        zoomPercent: 100,
        lastCustomMarginsMm: null,
        printerMargins: {
          status: 'available',
          source: 'hardware',
          marginsMm: { top: 4, bottom: 4, left: 4, right: 4 },
        },
        layout: {
          ...DEFAULT_LAYOUT,
          paperSize: 'A4',
          orientation: 'portrait',
          duplexMode: 'long-edge',
          sheetOrder: 'rtl',
          marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
        },
      });
    });

    // Apply Normal preset -> exact 20/20/30/15 (2 / 2 / 3 / 1.5 cm)
    const trigger = container.querySelector<HTMLButtonElement>('[data-margin-presets-trigger]')!;
    act(() => trigger.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-margin-preset="normal"]')!.click());
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 20, bottom: 20, left: 30, right: 15 });

    // Front sheet (index 0): left band width > right band width (30mm vs 15mm)
    const frontSheet = container.querySelector<HTMLElement>('[data-sheet-canvas-index="0"]')!;
    const backSheet = container.querySelector<HTMLElement>('[data-sheet-canvas-index="1"]')!;
    expect(frontSheet).toBeTruthy();
    expect(backSheet).toBeTruthy();

    const frontLeftBand = frontSheet.querySelector<HTMLElement>('[data-margin-guide="left"]')!;
    const frontRightBand = frontSheet.querySelector<HTMLElement>('[data-margin-guide="right"]')!;
    const backLeftBand = backSheet.querySelector<HTMLElement>('[data-margin-guide="left"]')!;
    const backRightBand = backSheet.querySelector<HTMLElement>('[data-margin-guide="right"]')!;

    const px = (el: HTMLElement) => parseFloat(el.style.width);
    expect(px(frontLeftBand)).toBeGreaterThan(px(frontRightBand));
    // Back sheet mirrors left & right: back left === front right, back right === front left
    expect(px(backLeftBand)).toBeCloseTo(px(frontRightBand), 2);
    expect(px(backRightBand)).toBeCloseTo(px(frontLeftBand), 2);

    // Dragging the LEFT band on Back sheet (+10mm inward) increases layout.marginsMm.right (not .left!)
    const pxPerMm = px(frontRightBand) / 15;
    const firePointer = (type: string, clientX: number, clientY: number) => {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY });
      Object.defineProperties(ev, { pointerId: { value: 9 }, pointerType: { value: 'mouse' } });
      act(() => {
        backLeftBand.dispatchEvent(ev);
      });
    };
    firePointer('pointerdown', 0, 100);
    firePointer('pointermove', 10 * pxPerMm, 100);
    firePointer('pointerup', 10 * pxPerMm, 100);
    expect(useAppStore.getState().layout.marginsMm.left).toBe(30);
    expect(useAppStore.getState().layout.marginsMm.right).toBe(25);

    // Open PageSetupModal: verify dual Front/Back preview, Swap Left<->Right, RTL/LTR toggle, and null lastCustom preservation
    useAppStore.setState({ lastCustomMarginsMm: null });
    act(() => useAppStore.getState().openPageSetup('margins'));
    const modal = document.querySelector('[data-page-setup-modal]')!;
    expect(modal.querySelector('[data-page-setup-preview="front"]')).toBeTruthy();
    expect(modal.querySelector('[data-page-setup-preview="back"]')).toBeTruthy();

    // Selecting built-in Wide preset does not overwrite null lastCustomMarginsMm
    act(() => modal.querySelector<HTMLButtonElement>('[data-page-setup-preset="wide"]')!.click());
    act(() => modal.querySelector<HTMLButtonElement>('[data-page-setup-apply]')!.click());
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 25, bottom: 25, left: 51, right: 51 });
    expect(useAppStore.getState().lastCustomMarginsMm).toBeNull();

    // Re-open with Normal, click Swap L<->R and switch binding to LTR
    act(() => useAppStore.getState().applyMarginPreset('normal'));
    act(() => useAppStore.getState().openPageSetup('margins'));
    const modal2 = document.querySelector('[data-page-setup-modal]')!;
    act(() => modal2.querySelector<HTMLButtonElement>('[data-page-setup-swap-lr]')!.click());
    act(() => modal2.querySelector<HTMLButtonElement>('[data-page-setup-binding="ltr"]')!.click());
    act(() => modal2.querySelector<HTMLButtonElement>('[data-page-setup-apply]')!.click());
    expect(useAppStore.getState().layout.marginsMm).toEqual({ top: 20, bottom: 20, left: 15, right: 30 });
    expect(useAppStore.getState().layout.sheetOrder).toBe('ltr');
  });
});
