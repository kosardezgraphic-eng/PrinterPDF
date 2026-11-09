// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PageItem,SourceDocument} from '@shared/models';
import {PreviewWorkspace} from '../components/PreviewWorkspace';
import {SidebarPages} from '../components/SidebarPages';
import {DEFAULT_LAYOUT,DEFAULT_SETTINGS,useAppStore} from '../store/useAppStore';
const page=(id:string):PageItem=>({id,documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:100,heightMm:200,rotation:0,
  selectedForPrint:true,isHighlighted:id==='p1',isBlankPage:false,colorProfile:'color',inkCoveragePercent:0});
const doc={id:'d',name:'d',filePath:'',fileSize:1,fileType:'pdf',mimeType:'application/pdf',pageCount:3,createdAt:''} as SourceDocument;
let container:HTMLDivElement,root:Root,viewport:HTMLElement,now:number;
function wheel(init:WheelEventInit) {
  const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,...init});
  act(()=>viewport.dispatchEvent(event));return event;
}
beforeEach(()=>{
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  useAppStore.setState({pages:[page('p1'),page('p2'),page('p3')],documents:[doc],settings:{...DEFAULT_SETTINGS,language:'en'},
    layout:{...DEFAULT_LAYOUT,rows:1,cols:1,duplexMode:'none'},activeSheetIndex:0,viewMode:'single',zoomPercent:200,sidebarTab:'pages',sidebarReveal:null,previewPageRequest:null});
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  act(()=>root.render(React.createElement(React.Fragment,null,React.createElement(SidebarPages),React.createElement(PreviewWorkspace,{onCursorMoveMm:()=>{}}))));
  viewport=container.querySelector<HTMLElement>('[data-preview-viewport]')!;
  Object.defineProperties(viewport,{clientHeight:{value:400,configurable:true},scrollHeight:{value:1200,configurable:true}});
  now=1000;vi.spyOn(performance,'now').mockImplementation(()=>now);
});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.restoreAllMocks();});
describe('zoomed sheet scrolling',()=>{
  it('leaves wheel scrolling native within a sheet, then enters the next sheet at the top',()=>{
    viewport.scrollTop=250;
    expect(wheel({deltaY:120}).defaultPrevented).toBe(false);
    expect(useAppStore.getState().activeSheetIndex).toBe(0);
    viewport.scrollTop=800;
    expect(wheel({deltaY:120}).defaultPrevented).toBe(true);
    expect(useAppStore.getState().activeSheetIndex).toBe(1);expect(viewport.scrollTop).toBe(0);
    expect(container.querySelector('[data-canvas-page-id="p2"]')).not.toBeNull();
    expect(useAppStore.getState().pages.filter(p=>p.isHighlighted).map(p=>p.id)).toEqual(['p2']);
    expect(useAppStore.getState().pages.every(p=>p.selectedForPrint)).toBe(true);
  });
  it('scrolls upward within the sheet and enters the preceding sheet at its bottom',()=>{
    act(()=>useAppStore.setState({activeSheetIndex:1}));
    viewport.scrollTop=400;expect(wheel({deltaY:-120}).defaultPrevented).toBe(false);
    expect(useAppStore.getState().activeSheetIndex).toBe(1);
    viewport.scrollTop=0;expect(wheel({deltaY:-120}).defaultPrevented).toBe(true);
    expect(useAppStore.getState().activeSheetIndex).toBe(0);expect(viewport.scrollTop).toBe(800);
  });
  it('does not skip sheets on repeated wheel events and lets the new sheet scroll',()=>{
    viewport.scrollTop=800;wheel({deltaY:120});expect(useAppStore.getState().activeSheetIndex).toBe(1);
    now=1050;expect(wheel({deltaY:120}).defaultPrevented).toBe(false);
    expect(useAppStore.getState().activeSheetIndex).toBe(1);
    viewport.scrollTop=800;expect(wheel({deltaY:120}).defaultPrevented).toBe(true);
    expect(useAppStore.getState().activeSheetIndex).toBe(1);
    now=1180;wheel({deltaY:120});expect(useAppStore.getState().activeSheetIndex).toBe(2);expect(viewport.scrollTop).toBe(0);
  });
  it('does not navigate on horizontal or Shift-wheel and keeps Ctrl-wheel zoom',()=>{
    viewport.scrollTop=800;
    expect(wheel({deltaY:30,deltaX:100}).defaultPrevented).toBe(false);
    expect(wheel({deltaY:100,shiftKey:true}).defaultPrevented).toBe(false);
    expect(useAppStore.getState().activeSheetIndex).toBe(0);
    expect(wheel({deltaY:-100,ctrlKey:true}).defaultPrevented).toBe(true);
    expect(useAppStore.getState().zoomPercent).toBe(210);expect(useAppStore.getState().activeSheetIndex).toBe(0);
  });
  it('navigates on a non-overflowing page and does nothing beyond the first or last sheet',()=>{
    Object.defineProperty(viewport,'scrollHeight',{value:400,configurable:true});
    expect(wheel({deltaY:-100}).defaultPrevented).toBe(false);expect(useAppStore.getState().activeSheetIndex).toBe(0);
    wheel({deltaY:100});expect(useAppStore.getState().activeSheetIndex).toBe(1);
    now=1200;wheel({deltaY:100});expect(useAppStore.getState().activeSheetIndex).toBe(2);
    now=1400;expect(wheel({deltaY:100}).defaultPrevented).toBe(false);expect(useAppStore.getState().activeSheetIndex).toBe(2);
  });
  it('supports the same edge navigation in double view',()=>{
    act(()=>useAppStore.setState({viewMode:'double'}));viewport.scrollTop=400;
    expect(wheel({deltaY:100}).defaultPrevented).toBe(false);expect(useAppStore.getState().activeSheetIndex).toBe(0);
    viewport.scrollTop=800;wheel({deltaY:100});expect(useAppStore.getState().activeSheetIndex).toBe(1);expect(viewport.scrollTop).toBe(0);
  });
  it.each(['continuous','grid'] as const)('keeps native scrolling in %s view',mode=>{
    act(()=>useAppStore.setState({viewMode:mode}));viewport.scrollTop=800;
    expect(wheel({deltaY:100}).defaultPrevented).toBe(false);expect(useAppStore.getState().activeSheetIndex).toBe(0);
  });
  it('uses safe centering so overflowing sheets are not centered outside the scrollable area',()=>{
    const content=container.querySelector<HTMLElement>('[data-preview-sheet-container]')!;
    expect(content.style.alignItems).toBe('safe center');expect(content.style.justifyContent).toBe('safe center');
    expect(viewport.className).toContain('overflow-auto');
  });
});
