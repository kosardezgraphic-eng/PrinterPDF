// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PageItem,SourceDocument} from '@shared/models';
import {SidebarPages} from '../components/SidebarPages';
import {PreviewWorkspace} from '../components/PreviewWorkspace';
import {DEFAULT_LAYOUT,DEFAULT_SETTINGS,useAppStore} from '../store/useAppStore';
const page=(id:string,doc:string,highlighted:boolean,printed:boolean):PageItem=>({id,documentId:doc,documentName:doc,sourcePageNumber:1,
  widthMm:100,heightMm:200,rotation:0,isHighlighted:highlighted,selectedForPrint:printed,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0,
  thumbnailDataUrl:'data:image/png;base64,AA=='});
const doc=(id:string,collapsed=false):SourceDocument=>({id,name:id,filePath:'',fileSize:10,fileType:'pdf',mimeType:'application/pdf',pageCount:2,createdAt:'',collapsed});
let container:HTMLDivElement,root:Root;
const card=(id:string)=>container.querySelector<HTMLElement>(`[data-page-id="${id}"]`)!;
const checkbox=(id:string)=>card(id).querySelector<HTMLButtonElement>('[role="checkbox"]')!;
const flags=()=>useAppStore.getState().pages.map(p=>p.selectedForPrint);
const selected=()=>useAppStore.getState().pages.filter(p=>p.isHighlighted).map(p=>p.id);
const rightClick=(id:string)=>act(()=>card(id).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:100})));
const invert=()=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.includes('Invert print selection of all pages'))!;
beforeEach(()=>{
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  useAppStore.setState({documents:[doc('d1'),doc('d2')],pages:[page('a','d1',true,true),page('b','d1',true,false),page('c','d2',false,true),page('d','d2',true,true)],
    settings:{...DEFAULT_SETTINGS,language:'en'},layout:{...DEFAULT_LAYOUT,rows:1,cols:1,duplexMode:'none'},activeSheetIndex:0,viewMode:'single',sidebarTab:'pages',sidebarReveal:null,previewPageRequest:null});
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  act(()=>root.render(React.createElement(React.Fragment,null,React.createElement(SidebarPages),React.createElement(PreviewWorkspace,{onCursorMoveMm:()=>{}}))));
});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.restoreAllMocks();});
describe('multi-thumbnail print checkboxes',()=>{
  it('sets all highlighted pages to the clicked state without navigating or changing highlights',()=>{
    expect(checkbox('a').getAttribute('aria-checked')).toBe('true');
    expect(checkbox('b').getAttribute('aria-checked')).toBe('false');
    act(()=>checkbox('a').click());
    expect(flags()).toEqual([false,false,true,false]);expect(selected()).toEqual(['a','b','d']);
    expect(checkbox('d').getAttribute('aria-checked')).toBe('false');
    expect(useAppStore.getState().previewPageRequest).toBeNull();
    act(()=>useAppStore.getState().undo());expect(flags()).toEqual([true,false,true,true]);
    act(()=>checkbox('b').click());expect(flags()).toEqual([true,true,true,true]);expect(selected()).toEqual(['a','b','d']);
  });
  it('uses an actual Ctrl multi-selection before applying a group checkbox',()=>{
    act(()=>useAppStore.setState({pages:useAppStore.getState().pages.map(p=>({...p,isHighlighted:p.id==='a'}))}));
    act(()=>card('b').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true})));
    expect(selected()).toEqual(['a','b']);
    act(()=>checkbox('a').click());
    expect(flags()).toEqual([false,false,true,true]);expect(selected()).toEqual(['a','b']);
  });
  it('toggles an unhighlighted checkbox alone, without changing selection',()=>{
    act(()=>checkbox('c').click());expect(flags()).toEqual([true,false,false,true]);expect(selected()).toEqual(['a','b','d']);
  });
  it('right-clicks a selected thumbnail without collapsing the selection and inverts mixed values independently',()=>{
    rightClick('b');expect(selected()).toEqual(['a','b','d']);expect(flags()).toEqual([true,false,true,true]);
    expect(invert()).toBeTruthy();act(()=>invert().click());
    expect(flags()).toEqual([false,true,false,false]);expect(selected()).toEqual(['a','b','d']);expect(container.textContent).not.toContain('Invert print selection of all pages');
    act(()=>useAppStore.getState().undo());expect(flags()).toEqual([true,false,true,true]);expect(selected()).toEqual(['a','b','d']);
    act(()=>useAppStore.getState().redo());expect(flags()).toEqual([false,true,false,false]);
  });
  it('right-clicking an unselected thumbnail still inverts all pages',()=>{
    rightClick('c');expect(selected()).toEqual(['c']);act(()=>invert().click());
    expect(flags()).toEqual([false,true,false,false]);expect(selected()).toEqual(['c']);
  });
  it('applies to selected thumbnails inside a collapsed document',()=>{
    act(()=>useAppStore.setState({documents:[doc('d1'),doc('d2',true)]}));
    expect(container.querySelector('[data-page-id="d"]')).toBeNull();
    rightClick('a');act(()=>invert().click());expect(flags()).toEqual([false,true,false,false]);
  });
  it('provides localized context command and accessible checkbox state',()=>{
    act(()=>useAppStore.setState({settings:{...useAppStore.getState().settings,language:'fa'}}));
    expect(checkbox('a').getAttribute('aria-label')).toContain('انتخاب برای چاپ');
    rightClick('a');expect(container.textContent).toContain('معکوس کردن وضعیت چاپ همهٔ صفحات');
  });
});
