// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem, PageOverlayImage } from '@shared/models';
import {
  collectStudioSheetPeers,
  computeAlignedBoxPosition,
  computeUnionBox,
  resolveStudioCellAlignTransform,
  resolveStudioOverlayAlignPercent,
  resolveTicketSlotAlignPercent,
} from './alignEngine';
import { computeImpositionSheets } from './layoutEngine';
import { MeasurementTool } from '../components/SheetTools';
import { PreviewWorkspace } from '../components/PreviewWorkspace';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';

describe('alignEngine & universal Align + clearable Measurement controls', () => {
  it('computes exact alignment positions across all 6 directions and union bounding boxes', () => {
    const subject = { x: 20, y: 30, width: 40, height: 20 };
    const reference = { x: 100, y: 50, width: 100, height: 80 };

    expect(computeAlignedBoxPosition(subject, reference, 'left')).toEqual({ x: 100, y: 30 });
    expect(computeAlignedBoxPosition(subject, reference, 'hcenter')).toEqual({ x: 130, y: 30 });
    expect(computeAlignedBoxPosition(subject, reference, 'right')).toEqual({ x: 160, y: 30 });
    expect(computeAlignedBoxPosition(subject, reference, 'top')).toEqual({ x: 20, y: 50 });
    expect(computeAlignedBoxPosition(subject, reference, 'vcenter')).toEqual({ x: 20, y: 80 });
    expect(computeAlignedBoxPosition(subject, reference, 'bottom')).toEqual({ x: 20, y: 110 });

    expect(
      computeUnionBox([
        { x: 10, y: 20, width: 30, height: 40 },
        { x: 80, y: 5, width: 20, height: 15 },
      ])
    ).toEqual({ x: 10, y: 5, width: 90, height: 55 });
  });

  it('aligns Studio cells and overlays relative to Sheet, Margins, Cell, and Other Images', () => {
    const p1: PageItem = {
      id: 'p1',
      documentId: 'doc1',
      documentName: 'doc',
      sourcePageNumber: 1,
      widthMm: 80,
      heightMm: 100,
      rotation: 0,
      selectedForPrint: true,
      isHighlighted: true,
      isBlankPage: false,
      colorProfile: 'color',
      inkCoveragePercent: 0,
    };
    const p2: PageItem = {
      ...p1,
      id: 'p2',
      sourcePageNumber: 2,
    };
    const layout = {
      ...DEFAULT_LAYOUT,
      paperSize: 'Custom' as const,
      customWidthMm: 220,
      customHeightMm: 300,
      rows: 1,
      cols: 2,
      marginsMm: { left: 10, right: 10, top: 15, bottom: 15 },
      horizontalGutterMm: 10,
      verticalGutterMm: 0,
      sheetOrder: 'ltr' as const,
    };
    const img: PageOverlayImage = {
      id: 'img1',
      kind: 'image',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      name: 'logo',
      naturalWidth: 100,
      naturalHeight: 100,
      xPercent: 10,
      yPercent: 10,
      widthPercent: 20,
      heightPercent: 10,
      rotation: 0,
      opacity: 1,
      target: 'sheet',
      targetScope: 'all',
      targetPageIds: [],
      targetSheetIndex: 1,
    };

    const sheets = computeImpositionSheets([p1, p2], layout);
    const sheet = sheets[0];
    const pageIndices = new Map([
      ['p1', 0],
      ['p2', 1],
    ]);

    const peersForCell1 = collectStudioSheetPeers(
      sheet,
      sheets.length,
      [p1, p2],
      [img],
      pageIndices,
      `cell:${sheet.cells[0].occurrenceKey}`,
      'fa'
    );
    expect(peersForCell1.map((p) => p.kind)).toEqual(['cell', 'image']);

    // Align cell 0 vertically center against Sheet
    const cellToSheet = resolveStudioCellAlignTransform(
      sheet,
      sheet.cells[0],
      'vcenter',
      'sheet',
      []
    );
    expect(cellToSheet).toBeTruthy();

    // Align cell 0 top edge to match Image peer
    const imgPeer = peersForCell1.find((p) => p.kind === 'image')!;
    const cellToImg = resolveStudioCellAlignTransform(
      sheet,
      sheet.cells[0],
      'top',
      'others',
      [imgPeer.box]
    );
    expect(cellToImg).toBeTruthy();
    const expectedDeltaMm = imgPeer.box.y - sheet.cells[0].contentYMm;
    expect(cellToImg!.y).toBeCloseTo(expectedDeltaMm / sheet.cells[0].cellHeightMm, 3);

    // Align image overlay to Margins right edge
    const imgToMargins = resolveStudioOverlayAlignPercent(sheet, img, 'right', 'margins', []);
    expect(imgToMargins).toBeTruthy();
    // right margin ends at 220 - 10 = 210 mm; image width = 20% of 220 = 44 mm -> left at 166 mm -> 75.45%
    expect(imgToMargins!.xPercent).toBeCloseTo(((210 - 44) / 220) * 100, 2);

    // Align image overlay to match cell 2 left edge
    const cell2Peer = collectStudioSheetPeers(
      sheet,
      sheets.length,
      [p1, p2],
      [img],
      pageIndices,
      `overlay:${img.id}`,
      'en'
    ).find((p) => p.id === `cell:${sheet.cells[1].occurrenceKey}`)!;
    const imgToCell2 = resolveStudioOverlayAlignPercent(
      sheet,
      img,
      'left',
      'others',
      [cell2Peer.box]
    );
    expect(imgToCell2!.xPercent).toBeCloseTo((cell2Peer.box.x / sheet.widthMm) * 100, 2);
  });

  it('aligns Ticket slot relative to Cell, Sheet, and Other Slots', () => {
    const slot1 = { xPercent: 10, yPercent: 10, widthPercent: 20, heightPercent: 10 };
    const slot2 = { xPercent: 55, yPercent: 60, widthPercent: 20, heightPercent: 10 };
    const cellBoundsPct = { x: 5, y: 5, width: 42, height: 42 };

    // To other slot (slot1 -> left = 10, top = 10)
    expect(resolveTicketSlotAlignPercent(slot2, [slot1], cellBoundsPct, 'left', 'others')).toEqual({
      xPercent: 10,
      yPercent: 60,
    });
    expect(resolveTicketSlotAlignPercent(slot2, [slot1], cellBoundsPct, 'top', 'others')).toEqual({
      xPercent: 55,
      yPercent: 10,
    });

    // To cell horizontal center: (100 - 20)/2 = 40
    expect(resolveTicketSlotAlignPercent(slot2, [slot1], cellBoundsPct, 'hcenter', 'cell')).toEqual({
      xPercent: 40,
      yPercent: 60,
    });

    // To sheet horizontal center clamped inside [0..80]
    const toSheetCenter = resolveTicketSlotAlignPercent(slot2, [slot1], cellBoundsPct, 'hcenter', 'sheet');
    expect(toSheetCenter).toBeTruthy();
    expect(toSheetCenter!.xPercent).toBeGreaterThan(70);
  });
});

describe('MeasurementTool & Studio Move Align UI', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.restoreAllMocks();
  });

  it('clears the active measurement line via × button click or Escape / Delete keys', () => {
    const page: PageItem = {
      id: 'mp',
      documentId: 'md',
      documentName: 'doc',
      sourcePageNumber: 1,
      widthMm: 100,
      heightMm: 150,
      rotation: 0,
      selectedForPrint: true,
      isHighlighted: true,
      isBlankPage: false,
      colorProfile: 'color',
      inkCoveragePercent: 0,
    };
    const sheet = computeImpositionSheets([page], DEFAULT_LAYOUT)[0];

    act(() => {
      root.render(
        React.createElement(MeasurementTool, {
          sheet,
          unit: 'mm',
          language: 'fa',
          spaceDown: false,
        })
      );
    });

    const overlay = host.querySelector('[data-measurement-overlay]') as HTMLElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 210,
      bottom: 297,
      width: 210,
      height: 297,
      toJSON: () => ({}),
    } as DOMRect);

    const pointer = (type: string, x: number, y: number) => {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperties(ev, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
      act(() => {
        overlay.dispatchEvent(ev);
      });
    };

    pointer('pointerdown', 10, 10);
    pointer('pointermove', 60, 10);
    pointer('pointerup', 60, 10);

    const clearBtn = host.querySelector<HTMLButtonElement>('[data-measurement-clear]');
    expect(clearBtn).toBeTruthy();
    act(() => {
      clearBtn!.click();
    });
    expect(host.querySelector('[data-measurement-clear]')).toBeNull();

    // Draw again and clear via Escape key
    pointer('pointerdown', 15, 20);
    pointer('pointermove', 95, 20);
    pointer('pointerup', 95, 20);
    expect(host.querySelector('[data-measurement-clear]')).toBeTruthy();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelector('[data-measurement-clear]')).toBeNull();
  });

  it('aligns a selected Studio cell to Sheet and to Another Image via [data-studio-align-bar]', () => {
    const page1: PageItem = {
      id: 'p1',
      documentId: 'd1',
      documentName: 'doc1',
      sourcePageNumber: 1,
      widthMm: 80,
      heightMm: 100,
      rotation: 0,
      selectedForPrint: true,
      isHighlighted: true,
      isBlankPage: false,
      colorProfile: 'color',
      inkCoveragePercent: 0,
    };
    const imgOverlay: PageOverlayImage = {
      id: 'ov-img',
      kind: 'image',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      name: 'sticker',
      naturalWidth: 50,
      naturalHeight: 50,
      xPercent: 65,
      yPercent: 5,
      widthPercent: 20,
      heightPercent: 10,
      rotation: 0,
      opacity: 1,
      target: 'sheet',
      targetScope: 'all',
      targetPageIds: [],
      targetSheetIndex: 1,
    };

    useAppStore.setState({
      appMode: 'studio',
      pages: [page1],
      documents: [],
      overlays: [imgOverlay],
      selectedOverlayId: null,
      layout: {
        ...DEFAULT_LAYOUT,
        paperSize: 'Custom',
        customWidthMm: 200,
        customHeightMm: 300,
        rows: 1,
        cols: 2,
        sheetOrder: 'ltr',
        marginsMm: { left: 10, right: 10, top: 20, bottom: 20 },
      },
      settings: { ...DEFAULT_SETTINGS, language: 'fa' },
      canvasTool: 'move',
      activeSheetIndex: 0,
    });

    act(() => {
      root.render(React.createElement(PreviewWorkspace, { onCursorMoveMm: () => {} }));
    });

    const alignBar = host.querySelector('[data-studio-align-bar]');
    expect(alignBar).toBeTruthy();

    const refSelect = host.querySelector<HTMLSelectElement>('[data-studio-align-reference]')!;
    expect(refSelect).toBeTruthy();

    // Align page cell relative to other image ('others')
    act(() => {
      refSelect.value = 'others';
      refSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const alignRightBtn = host.querySelector<HTMLButtonElement>('[data-studio-align="right"]')!;
    act(() => {
      alignRightBtn.click();
    });

    const stateAfterRight = useAppStore.getState();
    const txRight = Object.values(stateAfterRight.layout.cellOverrides ?? {})[0]?.transform?.x ?? stateAfterRight.pages[0].overrides?.transform?.x;
    expect(txRight).toBeGreaterThan(0);

    // Align relative to whole Sheet
    act(() => {
      refSelect.value = 'sheet';
      refSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const alignLeftBtn = host.querySelector<HTMLButtonElement>('[data-studio-align="left"]')!;
    act(() => {
      alignLeftBtn.click();
    });
    const stateAfterLeft = useAppStore.getState();
    const txLeft = Object.values(stateAfterLeft.layout.cellOverrides ?? {})[0]?.transform?.x ?? stateAfterLeft.pages[0].overrides?.transform?.x;
    expect(txLeft).toBeLessThan(0);
  });
});
