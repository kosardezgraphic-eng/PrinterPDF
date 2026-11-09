// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {PageItem, SourceDocument} from '@shared/models';
import {SidebarPages} from '../components/SidebarPages';
import {DEFAULT_LAYOUT,DEFAULT_SETTINGS,useAppStore} from '../store/useAppStore';
const page=(id:string,doc:string,highlighted=false,print=true):PageItem=>({id,documentId:doc,documentName:doc,sourcePageNumber:1,
  widthMm:100,heightMm:200,rotation:0,isHighlighted:highlighted,selectedForPrint:print,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0,
  thumbnailDataUrl:'data:image/png;base64,AA=='});
const doc=(id:string):SourceDocument=>({id,name:id,filePath:'',fileSize:10,fileType:'pdf',mimeType:'application/pdf',pageCount:2,createdAt:''});
let root:Root, container:HTMLDivElement;
const card=(id:string)=>container.querySelector<HTMLElement>(`[data-page-id="${id}"]`)!;
const ids=()=>useAppStore.getState().pages.map(p=>p.id);
const visible=()=>Array.from(container.querySelectorAll<HTMLElement>('[data-page-id]')).map(el=>el.dataset.pageId);
const transfer=()=>({effectAllowed:'none',dropEffect:'none',setData:vi.fn()});
function drag(target:Element,type:string,x:number,data:ReturnType<typeof transfer>) {
  const ev=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x});
  Object.defineProperty(ev,'dataTransfer',{value:data});
  act(()=>target.dispatchEvent(ev));return ev;
}
function bounds(el:HTMLElement){vi.spyOn(el,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:100,bottom:100,width:100,height:100,x:0,y:0,toJSON:()=>({})});}
beforeEach(()=>{
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  useAppStore.setState({documents:[doc('d1'),doc('d2')],pages:[page('a','d1',true),page('b','d1'),page('c','d2',true,false),page('d','d2')],
    settings:{...DEFAULT_SETTINGS,language:'en'},layout:{...DEFAULT_LAYOUT,duplexMode:'none'},sidebarTab:'pages',sidebarReveal:null,previewPageRequest:null,activeSheetIndex:0});
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  act(()=>root.render(React.createElement(SidebarPages)));
});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.restoreAllMocks();});
describe('thumbnail drag ordering',()=>{
  it('drags the highlighted group across documents and shows the actual global order',()=>{
    const data=transfer(); const source=card('a'),target=card('d');bounds(target);
    drag(source,'dragstart',20,data);expect(data.effectAllowed).toBe('move');expect(data.setData).toHaveBeenCalled();
    expect(card('a').dataset.dragging).toBe('true');expect(card('c').dataset.dragging).toBe('true');
    expect(container.textContent).toContain('Moving 2 page(s)');
    expect(drag(target,'dragover',90,data).defaultPrevented).toBe(true);
    expect(target.dataset.dropPosition).toBe('after');expect(target.dataset.dropEdge).toBe('right');
    drag(target,'drop',90,data);
    expect(ids()).toEqual(['b','d','a','c']);expect(visible()).toEqual(ids());
    expect(useAppStore.getState().pages.filter(p=>p.isHighlighted).map(p=>p.id)).toEqual(['a','c']);
    expect(useAppStore.getState().pages.find(p=>p.id==='c')?.selectedForPrint).toBe(false);
    expect(useAppStore.getState().previewPageRequest).toBeNull();expect(useAppStore.getState().activeSheetIndex).toBe(0);
    expect(container.querySelector('[data-drop-position]')).toBeNull();
    act(()=>useAppStore.getState().undo());expect(visible()).toEqual(['a','b','c','d']);
    act(()=>useAppStore.getState().redo());expect(visible()).toEqual(['b','d','a','c']);
  });
  it('allows Ctrl-selected thumbnails to move together without changing the print checkboxes',()=>{
    act(()=>useAppStore.setState({pages:useAppStore.getState().pages.map(p=>({...p,isHighlighted:p.id==='a'}))}));
    act(()=>card('c').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true})));
    expect(useAppStore.getState().pages.filter(p=>p.isHighlighted).map(p=>p.id)).toEqual(['a','c']);
    const data=transfer(),target=card('d');bounds(target);
    drag(card('c'),'dragstart',10,data);drag(target,'drop',90,data);
    expect(ids()).toEqual(['b','d','a','c']);
    expect(useAppStore.getState().pages.find(p=>p.id==='c')?.selectedForPrint).toBe(false);
  });
  it('removes a previous marker when hovering a member of the dragged selection',()=>{
    const data=transfer(),target=card('d');bounds(target);
    drag(card('a'),'dragstart',10,data);drag(target,'dragover',90,data);
    expect(target.dataset.dropPosition).toBe('after');
    drag(card('c'),'dragover',10,data);
    expect(target.dataset.dropPosition).toBeUndefined();
  });
  it('moves only the unselected source and chooses the before half in LTR',()=>{
    const data=transfer(), target=card('a');bounds(target);
    drag(card('d'),'dragstart',10,data);drag(target,'dragover',10,data);
    expect(target.dataset.dropPosition).toBe('before');drag(target,'drop',10,data);
    expect(ids()).toEqual(['d','a','b','c']);expect(visible()).toEqual(ids());
    expect(useAppStore.getState().pages.filter(p=>p.isHighlighted).map(p=>p.id)).toEqual(['a','c']);
  });
  it('honors RTL insertion direction',()=>{
    act(()=>useAppStore.setState({settings:{...useAppStore.getState().settings,language:'fa'}}));
    const data=transfer(),target=card('a');bounds(target);
    drag(card('d'),'dragstart',10,data);drag(target,'dragover',90,data);
    expect(target.dataset.dropPosition).toBe('before');
    expect(target.dataset.dropEdge).toBe('right');
    drag(target,'drop',90,data);expect(ids()).toEqual(['d','a','b','c']);
  });
  it('cancels drag without changing order and ignores external drops',()=>{
    const data=transfer(),source=card('a'),target=card('d');bounds(target);
    expect(drag(target,'dragover',90,data).defaultPrevented).toBe(false);
    drag(source,'dragstart',10,data);drag(target,'dragover',90,data);drag(source,'dragend',10,data);
    expect(ids()).toEqual(['a','b','c','d']);expect(container.querySelector('[data-drop-position]')).toBeNull();
  });
  it('does not initiate dragging from the print checkbox or change its state',()=>{
    const data=transfer();const checkbox=card('a').querySelector('button')!;
    expect(drag(checkbox,'dragstart',10,data).defaultPrevented).toBe(true);
    expect(data.setData).not.toHaveBeenCalled();expect(useAppStore.getState().pages[0].selectedForPrint).toBe(true);
  });
  it('moves all selected pages with the toolbar arrows',()=>{
    const button=container.querySelector<HTMLButtonElement>('[aria-label="Move selected pages down"]')!;
    act(()=>button.click());
    expect(ids()).toEqual(['b','a','d','c']);expect(visible()).toEqual(ids());
    act(()=>useAppStore.getState().undo());expect(ids()).toEqual(['a','b','c','d']);
  });
  it('suppresses a release click after dragging rather than changing the selection',()=>{
    const data=transfer(),source=card('a'),target=card('d');bounds(target);
    drag(source,'dragstart',10,data);drag(target,'drop',90,data);
    act(()=>card('d').click());
    expect(useAppStore.getState().pages.filter(p=>p.isHighlighted).map(p=>p.id)).toEqual(['a','c']);
    expect(useAppStore.getState().previewPageRequest).toBeNull();
  });
  it('keeps standalone blank pages visible and draggable',()=>{
    act(()=>useAppStore.setState({documents:[],pages:[{...page('blank','blank-doc'),isBlankPage:true,sourcePageNumber:0},page('next','blank-doc')]}));
    expect(visible()).toEqual(['blank','next']);
    const data=transfer(),target=card('next');bounds(target);drag(card('blank'),'dragstart',10,data);drag(target,'drop',90,data);
    expect(visible()).toEqual(['next','blank']);
  });
});
