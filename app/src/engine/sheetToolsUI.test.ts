// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem } from '@shared/models';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { PreviewWorkspace } from '../components/PreviewWorkspace';
const page: PageItem = {id:'p',documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:100,heightMm:200,rotation:0,
  selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0};
let container:HTMLDivElement, root:Root;
const rect = {x:0,y:0,left:0,top:0,right:400,bottom:600,width:400,height:600,toJSON:()=>({})};
function pointer(el: Element, type:string, x:number, y:number, pointerType:'mouse'|'touch'='mouse', shiftKey=false) {
  const ev = new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,shiftKey});
  Object.defineProperties(ev,{pointerId:{value:1},pointerType:{value:pointerType}});
  act(() => el.dispatchEvent(ev));
}
function clickTool(name:string) {
  const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === name)!;
  act(() => btn.click());
}
beforeEach(() => {
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  Object.defineProperty(HTMLElement.prototype,'setPointerCapture',{configurable:true,value:vi.fn()});
  useAppStore.setState({pages:[page],documents:[],layout:{...DEFAULT_LAYOUT,paperSize:'Custom',customWidthMm:200,customHeightMm:300,
    rows:2,cols:2,duplexMode:'none',marginsMm:{left:10,right:10,top:10,bottom:10},horizontalGutterMm:6,verticalGutterMm:6},
    settings:{...DEFAULT_SETTINGS,language:'en',unit:'mm'},activeSheetIndex:0,viewMode:'single'});
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  act(() => root.render(React.createElement(PreviewWorkspace,{onCursorMoveMm:()=>{}})));
});
afterEach(() => {act(() => root.unmount());container.remove();vi.restoreAllMocks();});
describe('sheet tool pointer interactions', () => {
  it.each(['mouse','touch'] as const)('previews and commits a margin drag using %s, with undo', pointerType => {
    clickTool('Margins / gutters');
    const overlay=container.querySelector('[data-layout-guides]') as HTMLElement;
    vi.spyOn(overlay,'getBoundingClientRect').mockReturnValue(rect);
    const handle=container.querySelector('[aria-label="Left margin"]')!;
    pointer(handle,'pointerdown',20,300,pointerType);
    pointer(handle,'pointermove',40,300,pointerType);
    expect(useAppStore.getState().layout.marginsMm.left).toBe(10);
    expect((handle as HTMLElement).style.left).not.toBe(`${10 * 1.95}px`);
    pointer(handle,'pointerup',40,300,pointerType);
    expect(useAppStore.getState().layout.marginsMm.left).toBe(20);
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().layout.marginsMm.left).toBe(10);
  });
  it.each([['Column gutter 1 (all columns)','horizontalGutterMm',100,100,110,100], ['Row gutter 1 (all rows)','verticalGutterMm',100,100,100,110]] as const)(
    'commits %s with touch and can undo it', (label,key,x,y,endX,endY) => {
      clickTool('Margins / gutters');
      const overlay=container.querySelector('[data-layout-guides]') as HTMLElement;
      vi.spyOn(overlay,'getBoundingClientRect').mockReturnValue(rect);
      const handle=container.querySelector(`[aria-label="${label}"]`)!;
      pointer(handle,'pointerdown',x,y,'touch'); pointer(handle,'pointermove',endX,endY,'touch'); pointer(handle,'pointerup',endX,endY,'touch');
      expect(useAppStore.getState().layout[key]).toBeCloseTo(16);
      act(() => useAppStore.getState().undo());
      expect(useAppStore.getState().layout[key]).toBe(6);
    });
  it('discards a canceled touch gutter drag', () => {
    clickTool('Margins / gutters');
    const overlay=container.querySelector('[data-layout-guides]') as HTMLElement;
    vi.spyOn(overlay,'getBoundingClientRect').mockReturnValue(rect);
    const handle=container.querySelector('[aria-label="Column gutter 1 (all columns)"]')!;
    pointer(handle,'pointerdown',100,100,'touch'); pointer(handle,'pointermove',120,100,'touch'); pointer(handle,'pointercancel',120,100,'touch');
    expect(useAppStore.getState().layout.horizontalGutterMm).toBe(6);
  });
  it('measures a shift-locked horizontal line without changing layout', () => {
    clickTool('Measure');
    const overlay=container.querySelector('[data-measurement-overlay]') as HTMLElement;
    vi.spyOn(overlay,'getBoundingClientRect').mockReturnValue(rect);
    const savedLayout=useAppStore.getState().layout;
    pointer(overlay,'pointerdown',20,20); pointer(overlay,'pointermove',80,40,'mouse',true); pointer(overlay,'pointerup',80,40,'mouse',true);
    const line=overlay.querySelector('line')!;
    expect(line.getAttribute('y1')).toBe(line.getAttribute('y2'));
    expect(overlay.querySelector('[role=status]')?.textContent).toContain('30 mm');
    expect(useAppStore.getState().layout).toBe(savedLayout);
  });
});
