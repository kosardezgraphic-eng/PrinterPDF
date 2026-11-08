import { describe, expect, it } from 'vitest';
import type { PageItem } from '@shared/models';
import { DEFAULT_LAYOUT, useAppStore } from '../store/useAppStore';
import { computeImpositionSheets } from './layoutEngine';
import { measurement, measureEndpoint, moveLayoutGuide } from './sheetInteraction';

const layout = { ...DEFAULT_LAYOUT, paperSize:'Custom' as const, customWidthMm:200, customHeightMm:300,
  rows:3,cols:3,duplexMode:'none' as const, marginsMm:{left:10,right:10,top:10,bottom:10},horizontalGutterMm:6,verticalGutterMm:6 };
const page: PageItem = {id:'p',documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:100,heightMm:200,rotation:0,
  selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0};
describe('sheet guides and ruler', () => {
  it('changes each margin, clamps it and preserves the opposite margin', () => {
    const sheet = {widthMm:200,heightMm:300};
    const left = moveLayoutGuide(layout,sheet,{type:'margin',side:'left'},20,0);
    expect(left.marginsMm).toEqual({left:30,right:10,top:10,bottom:10});
    const right = moveLayoutGuide(layout,sheet,{type:'margin',side:'right'},20,0);
    expect(right.marginsMm.right).toBe(0);
    const top = moveLayoutGuide(layout,sheet,{type:'margin',side:'top'},0,999);
    expect(top.marginsMm.top).toBe(263);
    expect(top.marginsMm.bottom).toBe(10);
  });
  it('moves the trailing edge of any gutter by the dragged amount, with a uniform gap', () => {
    const sheet = {widthMm:200,heightMm:300};
    const before = computeImpositionSheets([page],layout)[0];
    for (const index of [0,1]) {
      const updated = moveLayoutGuide(layout,sheet,{type:'gutter',axis:'horizontal',index},4,0);
      const after = computeImpositionSheets([page],updated)[0];
      const oldTrailing = before.cells.find(c => c.row === 0 && c.col === index+1)!.cellXMm;
      const newTrailing = after.cells.find(c => c.row === 0 && c.col === index+1)!.cellXMm;
      expect(newTrailing-oldTrailing).toBeCloseTo(4);
      expect(updated.horizontalGutterMm).toBeGreaterThan(layout.horizontalGutterMm);
    }
    const updated = moveLayoutGuide(layout,sheet,{type:'gutter',axis:'vertical',index:0},0,10000);
    const result = computeImpositionSheets([page],updated)[0];
    expect(result.cells[0].cellHeightMm).toBeCloseTo(5);
    expect(result.cells.every(c => c.cellYMm + c.cellHeightMm <= sheet.heightMm - layout.marginsMm.bottom + .0001)).toBe(true);
  });
  it('locks to the dominant axis when shift is held and measures in mm', () => {
    const start = {x:10,y:20};
    expect(measureEndpoint(start,{x:40,y:30},true)).toEqual({x:40,y:20});
    expect(measureEndpoint(start,{x:15,y:40},true)).toEqual({x:10,y:40});
    expect(measurement(start,measureEndpoint(start,{x:13,y:24},false)).distance).toBe(5);
  });
  it('commits guide changes as one undo step without navigating away', () => {
    useAppStore.setState({pages:[page],layout,activeSheetIndex:2});
    useAppStore.getState().commitLayoutGuides({horizontalGutterMm:12});
    expect(useAppStore.getState().activeSheetIndex).toBe(2);
    expect(useAppStore.getState().layout.horizontalGutterMm).toBe(12);
    useAppStore.getState().undo();
    expect(useAppStore.getState().layout.horizontalGutterMm).toBe(6);
    useAppStore.getState().redo();
    expect(useAppStore.getState().layout.horizontalGutterMm).toBe(12);
  });
  it('rotates from the displayed angle, without auto-fit undoing rotation or changing paper orientation', () => {
    useAppStore.setState({pages:[{...page,widthMm:200,heightMm:100}],layout:{...layout,rows:1,cols:1,autoRotateToFit:true},activeSheetIndex:0});
    const before = computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0];
    expect(before.cells[0].effectiveRotation).toBe(90);
    useAppStore.getState().rotatePages(['p'],90);
    const after = computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0];
    expect(after.cells[0].effectiveRotation).toBe(180);
    expect([after.widthMm,after.heightMm]).toEqual([before.widthMm,before.heightMm]);
    expect(useAppStore.getState().layout.orientation).toBe('portrait');
    useAppStore.getState().undo();
    expect(computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells[0].effectiveRotation).toBe(90);
  });
});
