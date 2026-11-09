import {beforeEach,describe,expect,it} from 'vitest';
import type {PageItem} from '@shared/models';
import {DEFAULT_LAYOUT,useAppStore} from '../store/useAppStore';
import {computeImpositionSheets} from './layoutEngine';
const page=(id:string,highlighted:boolean,printed:boolean):PageItem=>({id,documentId:'d',documentName:'d',sourcePageNumber:1,
  widthMm:100,heightMm:200,rotation:0,isHighlighted:highlighted,selectedForPrint:printed,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0});
const flags=()=>useAppStore.getState().pages.map(p=>p.selectedForPrint);
const selected=()=>useAppStore.getState().pages.filter(p=>p.isHighlighted).map(p=>p.id);
const output=()=>computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout).flatMap(sheet=>sheet.cells.flatMap(cell=>cell.page?[cell.page.id]:[]));
beforeEach(()=>useAppStore.setState({pages:[page('a',true,true),page('b',true,false),page('c',false,true),page('d',true,true)],
  documents:[],layout:{...DEFAULT_LAYOUT,rows:1,cols:1,duplexMode:'none'}}));
describe('print selection for highlighted pages',()=>{
  it('sets every highlighted checkbox to the clicked checkbox new value, preserving highlights and output order',()=>{
    useAppStore.getState().togglePageSelectedForPrint('a');
    expect(flags()).toEqual([false,false,true,false]);expect(selected()).toEqual(['a','b','d']);expect(output()).toEqual(['c']);
    useAppStore.getState().undo();expect(flags()).toEqual([true,false,true,true]);expect(selected()).toEqual(['a','b','d']);
    useAppStore.getState().redo();expect(flags()).toEqual([false,false,true,false]);
    useAppStore.getState().togglePageSelectedForPrint('b');
    expect(flags()).toEqual([true,true,true,true]);expect(output()).toEqual(['a','b','c','d']);
  });
  it('toggles only an unhighlighted page without changing the highlighted group',()=>{
    useAppStore.getState().togglePageSelectedForPrint('c');
    expect(flags()).toEqual([true,false,false,true]);expect(selected()).toEqual(['a','b','d']);
    useAppStore.getState().undo();expect(flags()).toEqual([true,false,true,true]);
  });
  it('inverts every page separately and can undo/redo as one action',()=>{
    useAppStore.getState().invertAllPrintSelection();
    expect(flags()).toEqual([false,true,false,false]);expect(selected()).toEqual(['a','b','d']);expect(output()).toEqual(['b']);
    useAppStore.getState().undo();expect(flags()).toEqual([true,false,true,true]);expect(selected()).toEqual(['a','b','d']);
    useAppStore.getState().redo();expect(flags()).toEqual([false,true,false,false]);
  });
  it('inverts all even without highlighted pages, and ignores nonexistent targets',()=>{
    useAppStore.setState({pages:useAppStore.getState().pages.map(p=>({...p,isHighlighted:false}))});
    const original=useAppStore.getState().pages;
    useAppStore.getState().togglePageSelectedForPrint('missing');
    expect(useAppStore.getState().pages).toBe(original);
    useAppStore.getState().invertAllPrintSelection();
    expect(flags()).toEqual([false,true,false,false]);expect(selected()).toEqual([]);
  });
});
