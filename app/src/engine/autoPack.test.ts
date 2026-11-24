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
import { computeImpositionSheets, getOrderedGridCoordinates } from './layoutEngine';
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

  it('packs exact uniform passport photo count when rotation is locked and upgrades to 38 when auto-rotate optimizes mixed strips', () => {
    const uniformPlan = computeAutoPackPlan({
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      baseMarginsMm: { top: 5, right: 5, bottom: 5, left: 5 },
      itemWidthMm: 30,
      itemHeightMm: 40,
      horizontalGapMm: 4,
      verticalGapMm: 4,
      allowRotateForMax: false,
      centerOnSheet: true,
    });
    expect(uniformPlan.fits).toBe(true);
    expect(uniformPlan.cols).toBe(6);
    expect(uniformPlan.rows).toBe(6);
    expect(uniformPlan.totalPerSheet).toBe(36);
    expect(uniformPlan.rotated90).toBe(false);
    expect(uniformPlan.cellWidthMm).toBe(30);
    expect(uniformPlan.cellHeightMm).toBe(40);
    expect(uniformPlan.marginsMm).toEqual({ top: 18.5, right: 5, bottom: 18.5, left: 5 });

    const optimalPlan = computeAutoPackPlan({
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
    expect(optimalPlan.fits).toBe(true);
    expect(optimalPlan.totalPerSheet).toBe(38);
    expect(optimalPlan.isHybrid).toBe(true);
  });

  it('rotates 90 degrees automatically when rotation fits more copies on the sheet', () => {
    // Pure uniform 90° win: 130x190mm on A4 (200x287 printable) -> 1x1=1 unrotated, 1x2=2 rotated 90°
    const uniformRotateInput = {
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      baseMarginsMm: { top: 5, right: 5, bottom: 5, left: 5 },
      itemWidthMm: 130,
      itemHeightMm: 190,
      horizontalGapMm: 3,
      verticalGapMm: 3,
      centerOnSheet: true,
    };
    const withoutRotate = computeAutoPackPlan({ ...uniformRotateInput, allowRotateForMax: false });
    expect(withoutRotate.rotated90).toBe(false);
    expect(withoutRotate.totalPerSheet).toBe(1);

    const withRotate = computeAutoPackPlan({ ...uniformRotateInput, allowRotateForMax: true });
    expect(withRotate.rotated90).toBe(true);
    expect(withRotate.isHybrid).toBe(false);
    expect(withRotate.cols).toBe(1);
    expect(withRotate.rows).toBe(2);
    expect(withRotate.totalPerSheet).toBe(2);
    expect(withRotate.cellWidthMm).toBe(190);
    expect(withRotate.cellHeightMm).toBe(130);

    // Optimal mixed rotation packs 11 copies of 50x85mm instead of 9 or 10
    const mixedPlan = computeAutoPackPlan({
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      baseMarginsMm: { top: 5, right: 5, bottom: 5, left: 5 },
      itemWidthMm: 50,
      itemHeightMm: 85,
      horizontalGapMm: 3,
      verticalGapMm: 3,
      allowRotateForMax: true,
      centerOnSheet: true,
    });
    expect(mixedPlan.totalPerSheet).toBe(11);
    expect(mixedPlan.isHybrid).toBe(true);
  });

  it('supports dense packing beyond 10x10 (up to 100x100)', () => {
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

  it('allows auto-pack grids to reach 100 rows and columns', () => {
    const plan = computeAutoPackPlan({
      sheetWidthMm: 500,
      sheetHeightMm: 500,
      baseMarginsMm: { top: 0, right: 0, bottom: 0, left: 0 },
      itemWidthMm: 5,
      itemHeightMm: 5,
      horizontalGapMm: 0,
      verticalGapMm: 0,
      allowRotateForMax: false,
      centerOnSheet: true,
    });
    expect(plan.rows).toBe(100);
    expect(plan.cols).toBe(100);
    expect(plan.totalPerSheet).toBe(10_000);
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

  it('finds hybrid mixed-orientation layouts that pack strictly more items than any uniform grid', () => {
    // Business card 85x55mm on A4 (210x297) with 5mm margin & 2mm gap:
    // Pure 0° fits 2x5=10, Pure 90° fits 3x3=9, Hybrid (1x5 unrotated + 2x3 rotated 90°) fits 11.
    const cardsPlan = computeAutoPackPlan({
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      baseMarginsMm: { top: 5, right: 5, bottom: 5, left: 5 },
      itemWidthMm: 85,
      itemHeightMm: 55,
      horizontalGapMm: 2,
      verticalGapMm: 2,
      allowRotateForMax: true,
      centerOnSheet: true,
    });
    expect(cardsPlan.fits).toBe(true);
    expect(cardsPlan.isHybrid).toBe(true);
    expect(cardsPlan.totalPerSheet).toBe(11);
    expect(cardsPlan.slots).toHaveLength(11);

    // 120x70mm on A4 with 5mm margin & 2mm gap:
    // Pure 0° fits 1x4=4, Pure 90° fits 2x2=4, Hybrid fits 6.
    const flyerPlan = computeAutoPackPlan({
      sheetWidthMm: 210,
      sheetHeightMm: 297,
      baseMarginsMm: { top: 5, right: 5, bottom: 5, left: 5 },
      itemWidthMm: 120,
      itemHeightMm: 70,
      horizontalGapMm: 2,
      verticalGapMm: 2,
      allowRotateForMax: true,
      centerOnSheet: true,
    });
    expect(flyerPlan.fits).toBe(true);
    expect(flyerPlan.isHybrid).toBe(true);
    expect(flyerPlan.totalPerSheet).toBe(6);
    expect(flyerPlan.slots).toHaveLength(6);
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

  it('supports matrix layouts up to 100 rows and columns', () => {
    useAppStore.getState().setNUpMatrix(100, 100);
    expect(useAppStore.getState().layout).toMatchObject({ rows: 100, cols: 100 });
    const coordinates = getOrderedGridCoordinates(100, 100, 'ltr');
    expect(coordinates).toHaveLength(10_000);
    expect(coordinates[coordinates.length - 1]).toEqual({ row: 99, col: 99 });
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
      allowRotateForMax: false,
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

  it('places hybrid mixed-orientation slots cleanly in computeImpositionSheets without overlap', () => {
    useAppStore.setState((s) => ({
      pages: [makePage({ id: 'card', widthMm: 85, heightMm: 55, selectedForPrint: true, isHighlighted: true })],
      activePageId: 'card',
      layout: { ...s.layout, paperSize: 'A4', orientation: 'portrait' },
    }));

    const plan = useAppStore.getState().autoPackPageOnSheet({
      pageId: 'card',
      widthMm: 85,
      heightMm: 55,
      lockAspect: true,
      horizontalGapMm: 2,
      verticalGapMm: 2,
      outerMarginMm: 5,
      allowRotateForMax: true,
      centerOnSheet: true,
      onlySelectedPage: true,
    });

    expect(plan?.totalPerSheet).toBe(11);
    const state = useAppStore.getState();
    const sheets = computeImpositionSheets(state.pages, state.layout);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].cells).toHaveLength(11);

    const cells = sheets[0].cells;
    for (let i = 0; i < cells.length; i++) {
      const a = cells[i];
      expect(a.cellXMm).toBeGreaterThanOrEqual(4.99);
      expect(a.cellYMm).toBeGreaterThanOrEqual(4.99);
      expect(a.cellXMm + a.cellWidthMm).toBeLessThanOrEqual(205.01);
      expect(a.cellYMm + a.cellHeightMm).toBeLessThanOrEqual(292.01);
      for (let j = i + 1; j < cells.length; j++) {
        const b = cells[j];
        const overlapsX = a.cellXMm < b.cellXMm + b.cellWidthMm - 0.01 && a.cellXMm + a.cellWidthMm > b.cellXMm + 0.01;
        const overlapsY = a.cellYMm < b.cellYMm + b.cellHeightMm - 0.01 && a.cellYMm + a.cellHeightMm > b.cellYMm + 0.01;
        expect(overlapsX && overlapsY).toBe(false);
      }
    }
  });

  it('does not double-rotate a page when Auto-Pack is re-applied after tweaking margins/gaps', () => {
    const first = useAppStore.getState().autoPackPageOnSheet({
      pageId: 'p1',
      widthMm: 130,
      heightMm: 190,
      lockAspect: false,
      horizontalGapMm: 3,
      verticalGapMm: 3,
      outerMarginMm: 5,
      allowRotateForMax: true,
      centerOnSheet: true,
      onlySelectedPage: true,
    });
    expect(first?.rotated90).toBe(true);
    expect(useAppStore.getState().pages[0].rotation).toBe(90);

    // Second apply (e.g. changing outer margin from 5 to 6) must remain at 90°, not 180°
    const second = useAppStore.getState().autoPackPageOnSheet({
      pageId: 'p1',
      widthMm: 130,
      heightMm: 190,
      lockAspect: false,
      horizontalGapMm: 3,
      verticalGapMm: 3,
      outerMarginMm: 6,
      allowRotateForMax: true,
      centerOnSheet: true,
      onlySelectedPage: true,
    });
    expect(second?.rotated90).toBe(true);
    expect(useAppStore.getState().pages[0].rotation).toBe(90);

    // Applying an unrotated 0° uniform plan restores base rotation cleanly
    const third = useAppStore.getState().autoPackPageOnSheet({
      pageId: 'p1',
      widthMm: 30,
      heightMm: 40,
      lockAspect: true,
      horizontalGapMm: 4,
      verticalGapMm: 4,
      outerMarginMm: 5,
      allowRotateForMax: true,
      centerOnSheet: true,
      onlySelectedPage: true,
    });
    expect(third?.rotated90).toBe(false);
    expect(useAppStore.getState().pages[0].rotation).toBe(0);
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
    expect(badge.textContent).toContain('38/sheet');

    // Toggle Auto-rotate 90° off -> uniform 6×6 = 36/sheet
    const autoRotateCheckbox = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    ).find((el) => el.parentElement?.textContent?.includes('Auto-rotate 90'))!;
    act(() => {
      autoRotateCheckbox.click();
    });
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

  it('supports width-only or length-only entry with cleared blank dimension, cleared zero spacing, and hybrid preview', () => {
    const widthInput = container.querySelector<HTMLInputElement>('[data-auto-pack-width]')!;
    const heightInput = container.querySelector<HTMLInputElement>('[data-auto-pack-height]')!;
    const lockBtn = container.querySelector<HTMLButtonElement>('[data-auto-pack-lock-aspect]')!;
    const gapHInput = container.querySelector<HTMLInputElement>('[data-auto-pack-gap-h]')!;
    const gapVInput = container.querySelector<HTMLInputElement>('[data-auto-pack-gap-v]')!;
    const marginInput = container.querySelector<HTMLInputElement>('[data-auto-pack-margin]')!;
    const badge = container.querySelector<HTMLElement>('[data-auto-pack-preview-badge]')!;
    const applyBtn = container.querySelector<HTMLButtonElement>('[data-auto-pack-apply]')!;

    setInput(marginInput, '5');
    setInput(gapHInput, '');
    expect(gapVInput.value).toBe('');

    // Width-only entry even when aspect lock is toggled off (clear height completely)
    act(() => {
      lockBtn.click(); // unlock
    });
    setInput(heightInput, '');
    setInput(widthInput, '30');
    // Un-entered height automatically computes proportionally as 40mm from 300x400 source -> 46/sheet optimal mixed (vs 42 uniform)
    expect(badge.textContent).toContain('46/sheet (Mixed 0°+90°)');

    // Length-only entry (clear width, type 40 in height) -> still computes proportional 30mm width => 46/sheet
    setInput(widthInput, '');
    setInput(heightInput, '40');
    expect(badge.textContent).toContain('46/sheet (Mixed 0°+90°)');

    // Custom width + height yielding optimal hybrid 11/sheet
    setInput(gapHInput, '2');
    setInput(widthInput, '85');
    setInput(heightInput, '55');
    expect(badge.textContent).toContain('11/sheet');

    act(() => {
      applyBtn.click();
    });

    const state = useAppStore.getState();
    const sheets = computeImpositionSheets(state.pages, state.layout);
    expect(sheets[0].cells).toHaveLength(11);
  });
});
