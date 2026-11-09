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


it('warns when moved content extends past the physical sheet', () => {
  const page = { id:'p', documentId:'d', sourcePageNumber:1, selectedForPrint:true, isBlankPage:false,
    widthMm:210, heightMm:297, rotation:0, overrides:{transform:{x:2,y:0,scaleX:1,scaleY:1}} } as PageItem;
  const sheets=computeImpositionSheets([page],{...DEFAULT_LAYOUT,duplexMode:'none'});
  expect(checkPreflight([page],[],sheets,DEFAULT_EFFECTS).map(issue => issue.code)).toContain('out-of-bounds');
});

it('warns if a rotated rectangle extends past the sheet even when its original bounds fit', () => {
  const page = {id:'p',documentId:'d',sourcePageNumber:1,selectedForPrint:true,isBlankPage:false,
    widthMm:100,heightMm:100,rotation:0,overrides:{transform:{x:0,y:0,scaleX:1,scaleY:1,rotationDeg:45}}} as PageItem;
  const layout={...DEFAULT_LAYOUT,paperSize:'Custom' as const,customWidthMm:100,customHeightMm:100,
    marginsMm:{left:0,right:0,top:0,bottom:0},autoRotateToFit:false,duplexMode:'none' as const};
  const sheets=computeImpositionSheets([page],layout);
  expect(checkPreflight([page],[],sheets,DEFAULT_EFFECTS).some(issue=>issue.code==='out-of-bounds')).toBe(true);
});
