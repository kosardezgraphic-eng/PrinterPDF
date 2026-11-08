import { expect, it } from 'vitest';
import { checkPreflight } from './preflight';
import { computeImpositionSheets } from './layoutEngine';
import { DEFAULT_EFFECTS, DEFAULT_LAYOUT } from '../store/useAppStore';
import type { PageItem } from '@shared/models';

it('identifies missing sources, blank pages, overflowing cells and effects not exported', () => {
  const pages = [{ id: 'p', documentId: 'missing', sourcePageNumber: 1, selectedForPrint: true, isBlankPage: true,
    widthMm: 210, heightMm: 297, rotation: 0 } as PageItem];
  const layout = { ...DEFAULT_LAYOUT, marginsMm: { top: 10, bottom: 10, left: 250, right: 10 } };
  const issues = checkPreflight(pages, [], computeImpositionSheets(pages, layout), { ...DEFAULT_EFFECTS, grayscale: true });
  expect(issues.map(i => i.code)).toEqual(expect.arrayContaining(['missing-source', 'empty-page', 'out-of-bounds', 'effects-not-exported']));
  expect(checkPreflight([], [], [], DEFAULT_EFFECTS)[0].code).toBe('no-pages');
});

it('does not claim a simulated job was sent to a printer', async () => {
  const { useAppStore } = await import('../store/useAppStore');
  const { ipcBridge } = await import('./ipcBridge');
  const { vi } = await import('vitest');
  const submit = vi.spyOn(ipcBridge, 'submitPrintJob');
  await useAppStore.getState().submitPrintJob({} as never);
  expect(submit).not.toHaveBeenCalled();
  expect(useAppStore.getState().toasts.at(-1)?.type).toBe('error');
  submit.mockRestore();
});
