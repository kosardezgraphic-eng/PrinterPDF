import {describe, expect, it} from 'vitest';
import type {PageItem} from '@shared/models';
import {DEFAULT_LAYOUT, useAppStore} from '../store/useAppStore';
import {computeImpositionSheets} from './layoutEngine';
const page=(id:string,selected=false,print=true):PageItem=>({id,documentId:id<'c'?'d1':'d2',documentName:'doc',sourcePageNumber:1,
  widthMm:100,heightMm:200,rotation:0,isHighlighted:selected,selectedForPrint:print,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0});
const ids=()=>useAppStore.getState().pages.map(p=>p.id);
function reset() {useAppStore.setState({pages:[page('a',true),page('b'),page('c',true,false),page('d'),page('e')],documents:[],
  layout:{...DEFAULT_LAYOUT,rows:1,cols:1,duplexMode:'none'}});}
describe('stable page ordering',()=>{
  it('moves a noncontiguous group as a stable block, preserving flags and supporting undo/redo',()=>{
    reset();useAppStore.getState().reorderPages(['c','a'],'d','after');
    expect(ids()).toEqual(['b','d','a','c','e']);
    expect(useAppStore.getState().pages.filter(p=>p.isHighlighted).map(p=>p.id)).toEqual(['a','c']);
    expect(useAppStore.getState().pages.find(p=>p.id==='c')?.selectedForPrint).toBe(false);
    expect(computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout).flatMap(s=>s.cells.filter(c=>c.page).map(c=>c.page!.id))).toEqual(['b','d','a','e']);
    useAppStore.getState().undo();expect(ids()).toEqual(['a','b','c','d','e']);
    useAppStore.getState().redo();expect(ids()).toEqual(['b','d','a','c','e']);
  });
  it('inserts at either boundary and moves an unselected page independently',()=>{
    reset();useAppStore.getState().reorderPages(['e'],'a','before');expect(ids()).toEqual(['e','a','b','c','d']);
    useAppStore.getState().reorderPages(['e'],'d','after');expect(ids()).toEqual(['a','b','c','d','e']);
    expect(useAppStore.getState().pages.filter(p=>p.isHighlighted).map(p=>p.id)).toEqual(['a','c']);
  });
  it('ignores missing, duplicate, selected-target and unchanged drops without creating undo entries',()=>{
    reset();const state=useAppStore.getState();
    useAppStore.getState().reorderPages(['a','c'],'a','before');
    useAppStore.getState().reorderPages(['a','missing'],'d','before');
    useAppStore.getState().reorderPages(['a','a'],'d','after');
    useAppStore.getState().reorderPages(['a'],'b','before');
    useAppStore.getState().reorderPages(['a'],'missing','before');
    expect(ids()).toEqual(['a','b','c','d','e']);expect(useAppStore.getState().undoLabel).toBe(state.undoLabel);
  });
  it('moves every highlighted page one position with the toolbar controls',()=>{
    reset();useAppStore.getState().moveHighlightedPages('down');expect(ids()).toEqual(['b','a','d','c','e']);
    useAppStore.getState().undo();expect(ids()).toEqual(['a','b','c','d','e']);
    useAppStore.getState().moveHighlightedPages('up');expect(ids()).toEqual(['a','c','b','d','e']);
  });
});
