// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PageItem } from '@shared/models';
import {
  computeAutoPackPlan,
  getPageDisplayDimensionsMm,
  resolveAutoPackTargetDimensions,
} from './autoPack';
import { computeImpositionSheets } from './layoutEngine';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { Ribbon } from '../components/Ribbon';

function makePage(overrides: Partial<PageItem> = {}): PageItem {
  return {
    id: overrides.id ?? 'p1',
    documentId: overrides.documentId ?? 'doc1',
    documentName: overrides.documentName ?? 'photo.jpg',
    sourcePageNumber: overrides.sourcePageNumber ?? 1,
    widthMm: overrides.widthMm ?? 150,
    heightMm: overrides.heightMm ?? 200,
    rotation: overrides.rotation ?? 0,
    selectedForPrint: overrides.selectedForPrint ?? true,
    isHighlighted: overrides.isHighlighted ?? true,
    isBlankPage: overrides.isBlankPage ?? false,
    colorProfile: overrides.colorProfile ?? 'color',
    inkCoveragePercent: overrides.inkCoveragePercent ?? 40,
    ...overrides,
  };
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Auto-Pack geometry engine', () => {
  it('computes proportional height from width and vice-versa when aspect ratio is locked', () => {
    const byWidth = resolveAutoPackTargetDimensions({
      sourceWidthMm: 150,
      sourceHeightMm: 200,
      driver: 'width',
      targetWidthMm: 30,
      lockAspect: true,
    });
    expect(byWidth).toEqual({ widthMm: 30, heightMm: 40 });

    const byHeight = resolveAutoPackTargetDimensions({
      sourceWidthMm: 150,
      sourceHeightMm: 200,
      driver: 'height',
      targetHeightMm: 60,
      lockAspect: true,
    });
    expect(byHeight).toEqual({ widthMm: 45, heightMm: 60 });

    const unlocked = resolveAutoPackTargetDimensions({
      sourceWidthMm: 150,
      sourceHeightMm: 200,
      driver: 'width',
      targetWidthMm: 50,
      targetHeightMm: 90,
      lockAspect: false,
    });
    expect(unlocked).toEqual({ widthMm: 50, heightMm: 90 });
  });

  it('accounts for crop and 90-degree rotation in display dimensions', () => {
    const page = makePage({
      widthMm: 100,
      heightMm: 200,
      rotation: 90,
      overrides: { cropBoxMm: { top: 0, right: 0, bottom: 50, left: 0 } },
    });
    const dims = getPageDisplayDimensionsMm(page);
    // Cropped unrotated: 100 x 150 -> rotated 90°: 150 x 100
    expect(dims.widthMm).toBe(150);
    expect(dims.heightMm).toBe(100);
    expect(dims.aspectRatio).toBeCloseTo(1.5, 4);
  });

  it('packs exact passport photo count on A4 with exact cell size and centered margins', () => {
    const plan = computeAutoPackPlan({
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      baseMarginsMm: { top: 5, right: 5, bottom: 5, left: 5 },
      itemWidthMm: 30,
      itemHeightMm: 40,
      horizontalGapMm: 4,
      verticalGapMm: 4,
      allowRotateForMax: true,
      centerOnSheet: true,
    });
    expect(plan.fits).toBe(true);
    expect(plan.cols).toBe(6);
    expect(plan.rows).toBe(6);
    expect(plan.totalPerSheet).toBe(36);
    expect(plan.rotated90).toBe(false);
    expect(plan.cellWidthMm).toBe(30);
    expect(plan.cellHeightMm).toBe(40);
    expect(plan.marginsMm).toEqual({ top: 18.5, right: 5, bottom: 18.5, left: 5 });
  });

  it('rotates 90 degrees automatically when rotation fits more copies on the sheet', () => {
    const baseInput = {
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      baseMarginsMm: { top: 5, right: 5, bottom: 5, left: 5 },
      itemWidthMm: 50,
      itemHeightMm: 85,
      horizontalGapMm: 3,
      verticalGapMm: 3,
      centerOnSheet: true,
    };
    const withoutRotate = computeAutoPackPlan({ ...baseInput, allowRotateForMax: false });
    expect(withoutRotate.rotated90).toBe(false);
    expect(withoutRotate.cols).toBe(3);
    expect(withoutRotate.rows).toBe(3);
    expect(withoutRotate.totalPerSheet).toBe(9);

    const withRotate = computeAutoPackPlan({ ...baseInput, allowRotateForMax: true });
    expect(withRotate.rotated90).toBe(true);
    expect(withRotate.cols).toBe(2);
    expect(withRotate.rows).toBe(5);
    expect(withRotate.totalPerSheet).toBe(10);
    expect(withRotate.cellWidthMm).toBe(85);
    expect(withRotate.cellHeightMm).toBe(50);
  });

  it('supports dense packing beyond 10x10 (up to 50x50)', () => {
    const plan = computeAutoPackPlan({
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      baseMarginsMm: { top: 5, right: 5, bottom: 5, left: 5 },
      itemWidthMm: 12,
      itemHeightMm: 12,
      horizontalGapMm: 2,
      verticalGapMm: 2,
      allowRotateForMax: true,
      centerOnSheet: true,
    });
    expect(plan.fits).toBe(true);
    expect(plan.cols).toBe(14);
    expect(plan.rows).toBe(20);
    expect(plan.totalPerSheet).toBe(280);
  });

  it('reports fits=false when item exceeds printable area', () => {
    const plan = computeAutoPackPlan({
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      baseMarginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
      itemWidthMm: 205,
      itemHeightMm: 100,
      horizontalGapMm: 2,
      verticalGapMm: 2,
      allowRotateForMax: false,
      centerOnSheet: true,
    });
    expect(plan.fits).toBe(false);
    expect(plan.totalPerSheet).toBe(0);
  });
});

describe('Auto-Pack store integration & imposition output', () => {
  beforeEach(() => {
    useAppStore.setState({
      pages: [
        makePage({ id: 'p1', documentName: 'portrait.jpg', widthMm: 300, heightMm: 400, selectedForPrint: true, isHighlighted: true }),
        makePage({ id: 'p2', documentName: 'other.jpg', widthMm: 210, heightMm: 297, selectedForPrint: true, isHighlighted: false }),
      ],
      activePageId: 'p1',
      layout: { ...DEFAULT_LAYOUT, paperSize: 'A4', orientation: 'portrait', duplexMode: 'none', rows: 1, cols: 1 },
      settings: { ...DEFAULT_SETTINGS, language: 'en', unit: 'mm' },
      printerMargins: { status: 'unavailable', reason: 'test' },
    });
  });

  it('packs selected image with exact cell sizes and exact spacing in computed imposition sheets, and supports Undo', () => {
    const plan = useAppStore.getState().autoPackPageOnSheet({
      pageId: 'p1',
      widthMm: 30,
      heightMm: 40,
      lockAspect: true,
      horizontalGapMm: 4,
      verticalGapMm: 6,
      outerMarginMm: 5,
      allowRotateForMax: true,
      centerOnSheet: true,
      onlySelectedPage: true,
    });

    expect(plan?.fits).toBe(true);
    expect(plan?.totalPerSheet).toBe(36);

    const state = useAppStore.getState();
    expect(state.pages[0].selectedForPrint).toBe(true);
    expect(state.pages[1].selectedForPrint).toBe(false);
    expect(state.layout.placementMode).toBe('step-and-repeat');
    expect(state.layout.cols).toBe(6);
    expect(state.layout.rows).toBe(6);

    const sheets = computeImpositionSheets(state.pages, state.layout);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].cells).toHaveLength(36);

    const c0 = sheets[0].cells.find((c) => c.row === 0 && c.col === 0)!;
    const c1 = sheets[0].cells.find((c) => c.row === 0 && c.col === 1)!;
    const r1c0 = sheets[0].cells.find((c) => c.row === 1 && c.col === 0)!;
    expect(c0.contentWidthMm).toBeCloseTo(30, 1);
    expect(c0.contentHeightMm).toBeCloseTo(40, 1);
    expect(c1.contentXMm - (c0.contentXMm + c0.contentWidthMm)).toBeCloseTo(4, 1);
    expect(r1c0.contentYMm - (c0.contentYMm + c0.contentHeightMm)).toBeCloseTo(6, 1);

    useAppStore.getState().undo();
    const restored = useAppStore.getState();
    expect(restored.layout.rows).toBe(1);
    expect(restored.layout.cols).toBe(1);
    expect(restored.pages[1].selectedForPrint).toBe(true);
  });

  it('handles dense packs > 10x10 in computeImpositionSheets after store action', () => {
    const plan = useAppStore.getState().autoPackPageOnSheet({
      pageId: 'p1',
      widthMm: 15,
      heightMm: 20,
      lockAspect: true,
      horizontalGapMm: 2,
      verticalGapMm: 2,
      outerMarginMm: 5,
      allowRotateForMax: false,
      centerOnSheet: true,
      onlySelectedPage: true,
    });
    expect(plan?.cols).toBe(11);
    expect(plan?.rows).toBe(13);
    expect(plan?.totalPerSheet).toBe(143);

    const state = useAppStore.getState();
    const sheets = computeImpositionSheets(state.pages, state.layout);
    expect(sheets[0].cells).toHaveLength(143);
    expect(sheets[0].cells[0].contentWidthMm).toBeCloseTo(15, 1);
    expect(sheets[0].cells[0].contentHeightMm).toBeCloseTo(20, 1);
  });
});

describe('AutoPackPanel UI integration', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState({
      activeRibbonTab: 'layout',
      ribbonCollapsed: false,
      pages: [makePage({ id: 'p1', widthMm: 300, heightMm: 400, selectedForPrint: true, isHighlighted: true })],
      activePageId: 'p1',
      layout: { ...DEFAULT_LAYOUT, paperSize: 'A4', orientation: 'portrait', duplexMode: 'none', rows: 1, cols: 1 },
      settings: { ...DEFAULT_SETTINGS, language: 'en', unit: 'mm' },
      printerMargins: { status: 'unavailable', reason: 'test' },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        React.createElement(Ribbon, {
          onOpenWatermarkPanel: () => {},
          onOpenBookletPanel: () => {},
        })
      )
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('updates proportional length on width entry, previews max count, and applies layout on click', () => {
    const widthInput = container.querySelector<HTMLInputElement>('[data-auto-pack-width]')!;
    const heightInput = container.querySelector<HTMLInputElement>('[data-auto-pack-height]')!;
    const gapHInput = container.querySelector<HTMLInputElement>('[data-auto-pack-gap-h]')!;
    const gapVInput = container.querySelector<HTMLInputElement>('[data-auto-pack-gap-v]')!;
    const marginInput = container.querySelector<HTMLInputElement>('[data-auto-pack-margin]')!;
    const badge = container.querySelector<HTMLElement>('[data-auto-pack-preview-badge]')!;
    const applyBtn = container.querySelector<HTMLButtonElement>('[data-auto-pack-apply]')!;

    setInput(marginInput, '5');
    setInput(gapHInput, '4');
    expect(gapVInput.value).toBe('4');

    setInput(widthInput, '30');
    expect(heightInput.value).toBe('40');
    expect(badge.textContent).toContain('6×6 = 36/sheet');

    act(() => {
      applyBtn.click();
    });

    const state = useAppStore.getState();
    expect(state.layout.rows).toBe(6);
    expect(state.layout.cols).toBe(6);
    expect(state.layout.horizontalGutterMm).toBe(4);
    expect(state.layout.verticalGutterMm).toBe(4);
  });
});
