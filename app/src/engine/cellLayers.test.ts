import { describe, expect, it } from 'vitest';
import type { PageItem } from '@shared/models';
import { DEFAULT_LAYOUT, useAppStore } from '../store/useAppStore';
import { cellOccurrenceKey, computeImpositionSheets, sortCellsByLayer } from './layoutEngine';
import { resizeProportionally, type Handle } from './pageGeometry';

const page = (id:string):PageItem => ({id,documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:50,heightMm:100,rotation:0,
 selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0});
const layout = {...DEFAULT_LAYOUT,paperSize:'Custom' as const,customWidthMm:100,customHeightMm:100,duplexMode:'none' as const,
 rows:1,cols:2,placementMode:'step-and-repeat' as const,sheetOrder:'ltr' as const,autoRotateToFit:false,
 marginsMm:{top:0,left:0,right:0,bottom:0},horizontalGutterMm:0,verticalGutterMm:0};
const transform = {x:.6,y:0,scaleX:1,scaleY:1};
describe('independent matrix cells and layers', () => {
  it.each(['nw','ne','se','sw'] as Handle[])('preserves aspect and opposite corner on %s', handle => {
    const rect = {x:10,y:20,width:120,height:60};
    const result = resizeProportionally(rect,handle,handle.includes('e')?40:-40,handle.includes('s')?30:-30);
    expect(result.width / result.height).toBeCloseTo(2);
    expect(handle.includes('w') ? result.x + result.width : result.x).toBeCloseTo(handle.includes('w') ? 130 : 10);
    expect(handle.includes('n') ? result.y + result.height : result.y).toBeCloseTo(handle.includes('n') ? 80 : 20);
  });
  it.each(['n','s','e','w'] as Handle[])('resizes only one axis with %s', handle => {
    const result = resizeProportionally({x:10,y:20,width:100,height:60},handle,20,20);
    if (handle === 'n' || handle === 's') expect(result.width).toBe(100);
    else expect(result.height).toBe(60);
  });
  it('edits just one repeated cell and supports undo, redo and reset', () => {
    useAppStore.setState({pages:[page('p')],layout});
    const initial = computeImpositionSheets(useAppStore.getState().pages,layout)[0];
    const key = initial.cells[0].occurrenceKey!;
    useAppStore.getState().applyCellTransform('p',key,transform);
    let sheet = computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0];
    expect(sheet.cells[0].contentXMm-initial.cells[0].contentXMm).toBeCloseTo(30);
    expect(sheet.cells[0].allowOverflow).toBe(true);
    expect(sheet.cells[1].contentXMm).toBe(initial.cells[1].contentXMm);
    useAppStore.getState().undo();
    expect(computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells[0].allowOverflow).toBe(false);
    useAppStore.getState().redo();
    expect(computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells[0].allowOverflow).toBe(true);
    useAppStore.getState().resetCellGeometry('p',key);
    sheet = computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0];
    expect(sheet.cells[0].contentXMm).toBe(initial.cells[0].contentXMm);
  });
  it('orders repeated occurrences independently and preserves transforms and undo', () => {
    useAppStore.setState({pages:[page('p')],layout});
    const cells = computeImpositionSheets(useAppStore.getState().pages,layout)[0].cells;
    useAppStore.getState().applyCellTransform('p',cells[0].occurrenceKey!,transform);
    useAppStore.getState().reorderCellLayer(0,cells[0].occurrenceKey!,'front');
    const result = () => sortCellsByLayer(computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells).map(c => c.occurrenceKey);
    expect(result()).toEqual([cells[1].occurrenceKey,cells[0].occurrenceKey]);
    expect(useAppStore.getState().layout.cellOverrides![cells[0].occurrenceKey!].transform).toEqual(transform);
    useAppStore.getState().undo(); expect(result()).toEqual(cells.map(c => c.occurrenceKey));
    useAppStore.getState().redo(); expect(result()).toEqual([cells[1].occurrenceKey,cells[0].occurrenceKey]);
  });
  it('keeps layer settings in a serialized layout and cleans up deleted pages with undo', () => {
    useAppStore.setState({pages:[page('p')],layout});
    const key=computeImpositionSheets(useAppStore.getState().pages,layout)[0].cells[0].occurrenceKey!;
    useAppStore.getState().applyCellTransform('p',key,transform);
    const saved=JSON.parse(JSON.stringify(useAppStore.getState().layout));
    expect(computeImpositionSheets([page('p')],saved)[0].cells[0].contentXMm).toBeCloseTo(30);
    useAppStore.getState().deletePages(['p']);
    expect(useAppStore.getState().layout.cellOverrides?.[key]).toBeUndefined();
    useAppStore.getState().undo();
    expect(useAppStore.getState().layout.cellOverrides?.[key].transform).toEqual(transform);
  });
  it('clears target per-cell geometry when applying a batch transform, but not its layer', () => {
    useAppStore.setState({pages:[page('p')],layout});
    const key = cellOccurrenceKey('p','step-and-repeat',0,0);
    useAppStore.getState().applyCellTransform('p',key,transform);
    useAppStore.getState().reorderCellLayer(0,key,'front');
    useAppStore.getState().applyPageGeometry('p','selected',{kind:'transform',transform:{x:0,y:0,scaleX:.5,scaleY:.5}});
    const result = computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells;
    expect(result.every(cell => cell.transform?.scaleX === .5)).toBe(true);
    expect(sortCellsByLayer(result).at(-1)?.occurrenceKey).toBe(key);
  });
});
