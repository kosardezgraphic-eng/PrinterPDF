import { describe, expect, it } from 'vitest';
import { fitPageZoom, isAtWheelEdge, wheelSheetStep } from './viewNavigation';
import { useAppStore } from '../store/useAppStore';
import type { PageItem } from '@shared/models';

describe('sheet navigation', () => {
  it('throttles wheel navigation to one step per 180ms', () => {
    expect(wheelSheetStep(2, 1000, -Infinity)).toBe(1);
    expect(wheelSheetStep(-2, 1179, 1000)).toBe(0);
    expect(wheelSheetStep(-2, 1180, 1000)).toBe(-1);
    expect(wheelSheetStep(0, 1200, 1000)).toBe(0);
  });
  it('recognizes only the relevant vertical edge, including subpixel scroll positions', () => {
    expect(isAtWheelEdge(120,100,1000,400)).toBe(false);
    expect(isAtWheelEdge(-120,100,1000,400)).toBe(false);
    expect(isAtWheelEdge(120,599.5,1000,400)).toBe(true);
    expect(isAtWheelEdge(-120,.5,1000,400)).toBe(true);
    expect(isAtWheelEdge(120,0,300,400)).toBe(true);
    expect(isAtWheelEdge(-120,0,300,400)).toBe(true);
    expect(isAtWheelEdge(0,0,300,400)).toBe(false);
    expect(isAtWheelEdge(Infinity,0,300,400)).toBe(false);
  });
  it('fits a portrait or landscape page within the available viewport', () => {
    const zoom = fitPageZoom(600, 700, 210, 297, true);
    expect(210 * 1.95 * zoom / 100).toBeLessThanOrEqual(600 - 48 - 28);
    expect(297 * 1.95 * zoom / 100).toBeLessThanOrEqual(700 - 48 - 32 - 24);
    expect(fitPageZoom(600, 700, 297, 210, false)).toBeGreaterThan(0);
  });
  it('inverts print selection and supports undo', () => {
    useAppStore.setState({ pages: [
      { id: 'one', selectedForPrint: true, isHighlighted: true } as PageItem,
      { id: 'two', selectedForPrint: false, isHighlighted: false } as PageItem,
    ] });
    useAppStore.getState().invertPrintSelection();
    expect(useAppStore.getState().pages.map(p => p.selectedForPrint)).toEqual([false, true]);
    useAppStore.getState().undo();
    expect(useAppStore.getState().pages.map(p => p.selectedForPrint)).toEqual([true, false]);
  });
});
