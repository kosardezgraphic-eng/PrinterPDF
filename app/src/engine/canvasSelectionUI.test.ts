// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem } from '@shared/models';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { computeImpositionSheets, sortCellsByLayer } from './layoutEngine';
import { PreviewWorkspace } from '../components/PreviewWorkspace';
import { SidebarPages } from '../components/SidebarPages';

const page=(id:string,highlighted=true):PageItem => ({id,documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:50,heightMm:100,rotation:0,
  selectedForPrint:true,isHighlighted:highlighted,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0,thumbnailDataUrl:'data:image/png;base64,AA=='});
let container:HTMLDivElement, root:Root;
function pointer(target:Element,type:string,x:number,y:number,pointerType='touch') {
  const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});
  Object.defineProperties(event,{pointerId:{value:7},pointerType:{value:pointerType}});
  act(() => target.dispatchEvent(event));
}
function click(target:Element,x=0,y=0) { act(() => target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:x,clientY:y}))); }
const image=(id:string) => container.querySelector(`[data-canvas-page-id="${id}"] > div`) as HTMLElement;
const handles=(id:string) => container.querySelectorAll(`[data-canvas-page-id="${id}"] button[aria-label^="move "]`);
beforeEach(() => {
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  Object.defineProperty(HTMLElement.prototype,'setPointerCapture',{configurable:true,value:vi.fn()});
  useAppStore.setState({pages:[page('red'),page('blue')],documents:[{id:'d',name:'d',filePath:'',fileSize:10,fileType:'pdf',mimeType:'application/pdf',pageCount:2,createdAt:''}],
    settings:{...DEFAULT_SETTINGS,language:'en'},zoomPercent:100,activeSheetIndex:0,viewMode:'single',sidebarTab:'pages',sidebarReveal:null,
    layout:{...DEFAULT_LAYOUT,paperSize:'Custom',customWidthMm:100,customHeightMm:100,rows:1,cols:2,sheetOrder:'ltr',duplexMode:'none',autoRotateToFit:false,
      marginsMm:{top:0,bottom:0,left:0,right:0},horizontalGutterMm:0,verticalGutterMm:0}});
  container=document.createElement('div'); document.body.appendChild(container);root=createRoot(container);
  act(() => root.render(React.createElement(React.Fragment,null,React.createElement(SidebarPages),React.createElement(PreviewWorkspace,{onCursorMoveMm:()=>{}}))));
});
afterEach(() => {act(() => root.unmount());container.remove();vi.useRealTimers();vi.restoreAllMocks();});

describe('combined selection and layer context menu', () => {
  it('starts in combined mode without handles, selects only a clicked cell and hides handles on empty space', () => {
    const combined=container.querySelector('[aria-label="Select / move / resize"]');
    expect(combined?.getAttribute('aria-pressed')).toBe('true');
    expect(Array.from(container.querySelectorAll('button')).some(b => b.textContent?.trim()==='Select')).toBe(false);
    expect(handles('red')).toHaveLength(0); expect(handles('blue')).toHaveLength(0);
    click(image('red'));
    expect(handles('red')).toHaveLength(8); expect(handles('blue')).toHaveLength(0);
    expect(container.querySelector('[aria-label="Layer order"]')).toBeNull();
    click(image('blue'));
    expect(handles('red')).toHaveLength(0); expect(handles('blue')).toHaveLength(8);
    click(container.querySelector('[data-preview-viewport]')!);
    expect(handles('blue')).toHaveLength(0);
    expect(useAppStore.getState().pages.filter(p => p.isHighlighted).map(p => p.id)).toEqual(['red','blue']);
    expect(useAppStore.getState().pages.every(p => p.selectedForPrint)).toBe(true);
  });
  it('tap selects an image and repeat copies show handles only on the tapped occurrence', () => {
    act(() => useAppStore.setState({pages:[page('red')],layout:{...useAppStore.getState().layout,placementMode:'step-and-repeat'}}));
    const copies=container.querySelectorAll('[data-canvas-page-id="red"]');
    const second=copies[1].firstElementChild!;
    pointer(second,'pointerdown',140,40);pointer(second,'pointerup',140,40);click(second,140,40);
    expect(copies[0].querySelectorAll('[aria-label^="move "]')).toHaveLength(0);
    expect(copies[1].querySelectorAll('[aria-label^="move "]')).toHaveLength(8);
  });
  it('hides handles when the user points elsewhere in the sidebar but keeps its multi-selection', () => {
    click(image('red')); expect(handles('red')).toHaveLength(8);
    pointer(container.querySelector('[data-thumbnail-list]')!,'pointerdown',2,2,'mouse');
    expect(handles('red')).toHaveLength(0);
    expect(useAppStore.getState().pages.filter(p=>p.isHighlighted)).toHaveLength(2);
  });
  it('keeps handles available while operating them and preserves right-click layer ordering', () => {
    click(image('red')); const handle=container.querySelector('[data-canvas-page-id="red"] [aria-label="move se"]')!;
    pointer(handle,'pointerdown',0,0,'mouse'); pointer(handle,'pointermove',20,20,'mouse');pointer(handle,'pointerup',20,20,'mouse');click(handle);
    expect(handles('red')).toHaveLength(8);
    act(() => image('red').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:40})));
    const front=Array.from(document.querySelectorAll('[role="menuitem"]')).find(item=>item.textContent==='Bring to front')!;
    click(front);
    const s=useAppStore.getState(); expect(sortCellsByLayer(computeImpositionSheets(s.pages,s.layout)[0].cells).at(-1)?.page?.id).toBe('red');
    expect(handles('red')).toHaveLength(8);
  });
  it('opens layers from an unselected image on a touch hold and suppresses the release click', () => {
    vi.useFakeTimers();
    const red=image('red');pointer(red,'pointerdown',40,40);
    act(() => vi.advanceTimersByTime(599)); expect(document.querySelector('[role=menu]')).toBeNull();
    act(() => vi.advanceTimersByTime(1)); expect(document.querySelector('[role=menu]')).not.toBeNull();
    expect(handles('red')).toHaveLength(8);
    pointer(red,'pointerup',40,40);
    // Browsers can send a click to the overlay on release; it must not close the menu.
    const overlay=document.querySelector('[data-layer-menu]')!.parentElement!;
    click(overlay,40,40); expect(document.querySelector('[role=menu]')).not.toBeNull();
    const front=Array.from(document.querySelectorAll('[role=menuitem]')).find(item=>item.textContent==='Bring to front')!;
    click(front); const s=useAppStore.getState();
    expect(sortCellsByLayer(computeImpositionSheets(s.pages,s.layout)[0].cells).at(-1)?.page?.id).toBe('red');
    expect(s.layout.cellOverrides?.[computeImpositionSheets(s.pages,s.layout)[0].cells[0].occurrenceKey!]?.transform).toBeUndefined();
  });
  it('does not execute a menu item from a synthesized release click', () => {
    vi.useFakeTimers(); const red=image('red');pointer(red,'pointerdown',40,40);
    act(() => vi.advanceTimersByTime(600));pointer(red,'pointerup',40,40);
    const front=Array.from(document.querySelectorAll('[role=menuitem]')).find(item=>item.textContent==='Bring to front')!;
    click(front,40,40);
    const initial=useAppStore.getState();
    expect(sortCellsByLayer(computeImpositionSheets(initial.pages,initial.layout)[0].cells).at(-1)?.page?.id).toBe('blue');
    expect(document.querySelector('[role=menu]')).not.toBeNull();
    click(front,75,75);
    const changed=useAppStore.getState();
    expect(sortCellsByLayer(computeImpositionSheets(changed.pages,changed.layout)[0].cells).at(-1)?.page?.id).toBe('red');
  });
  it('handles a native touch contextmenu without a second timer opening it again', () => {
    vi.useFakeTimers();const red=image('red');pointer(red,'pointerdown',40,40);
    act(() => red.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:40})));
    expect(document.querySelectorAll('[role=menu]')).toHaveLength(1);
    pointer(red,'pointerup',40,40);act(() => vi.advanceTimersByTime(700));
    expect(document.querySelectorAll('[role=menu]')).toHaveLength(1);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(document.querySelector('[role=menu]')).toBeNull();
  });
  it('cancels a pending hold if the tool changes', () => {
    vi.useFakeTimers(); const red=image('red');pointer(red,'pointerdown',40,40);
    const crop=container.querySelector('[aria-label="Crop"]')!;
    click(crop);act(() => vi.advanceTimersByTime(700));
    expect(document.querySelector('[role=menu]')).toBeNull();
  });
  it('cancels a pending hold when the finger moves, releases, or is canceled', () => {
    vi.useFakeTimers();const red=image('red');
    pointer(red,'pointerdown',40,40);pointer(red,'pointermove',55,40);act(() => vi.advanceTimersByTime(700));
    expect(document.querySelector('[role=menu]')).toBeNull();pointer(red,'pointerup',55,40);
    pointer(red,'pointerdown',40,40);pointer(red,'pointerup',40,40);act(() => vi.advanceTimersByTime(700));
    expect(document.querySelector('[role=menu]')).toBeNull();
    pointer(red,'pointerdown',40,40);pointer(red,'pointercancel',40,40);act(() => vi.advanceTimersByTime(700));
    expect(document.querySelector('[role=menu]')).toBeNull();
  });
  it('cancels a pending drag when a selected image is held for the menu', () => {
    vi.useFakeTimers(); const red=image('red'); click(red); pointer(red,'pointerdown',40,40);
    pointer(red,'pointermove',44,43); act(() => vi.advanceTimersByTime(600));
    expect(document.querySelector('[role=menu]')).not.toBeNull();pointer(red,'pointerup',44,43);
    const s=useAppStore.getState();
    expect(computeImpositionSheets(s.pages,s.layout)[0].cells[0].contentXMm).toBeCloseTo(0);
  });
});
