// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem } from '@shared/models';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { computeImpositionSheets, sortCellsByLayer } from './layoutEngine';
import { PreviewWorkspace } from '../components/PreviewWorkspace';
const makePage = (id:string):PageItem => ({id,documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:50,heightMm:100,rotation:0,
 selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0,thumbnailDataUrl:'data:image/png;base64,AA=='});
let container: HTMLDivElement, root: Root;
function pointer(el:Element,type:string,x:number,y:number,pointerType='mouse') {
 const ev = new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});
 Object.defineProperties(ev,{pointerId:{value:1},pointerType:{value:pointerType}}); act(() => el.dispatchEvent(ev));
}
beforeEach(() => {
 (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 Object.defineProperty(HTMLElement.prototype,'setPointerCapture',{configurable:true,value:vi.fn()});
 useAppStore.setState({pages:[makePage('red'),makePage('blue')],documents:[],settings:{...DEFAULT_SETTINGS,language:'en'},zoomPercent:100,
  layout:{...DEFAULT_LAYOUT,paperSize:'Custom',customWidthMm:100,customHeightMm:100,rows:1,cols:2,sheetOrder:'ltr',duplexMode:'none',autoRotateToFit:false,
    marginsMm:{top:0,bottom:0,left:0,right:0},horizontalGutterMm:0,verticalGutterMm:0},activeSheetIndex:0,viewMode:'single'});
 container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
 act(() => root.render(React.createElement(PreviewWorkspace,{onCursorMoveMm:()=>{}})));
 const button=Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim()==='Move / resize')!; act(() => button.click());
});
afterEach(() => {act(() => root.unmount());container.remove();vi.restoreAllMocks();});

describe('matrix layer interaction', () => {
 it.each(['mouse','touch'])('drags one cell across another with %s and keeps the other in place', type => {
  const red = container.querySelector('[data-canvas-page-id="red"] > div') as HTMLElement;
  expect(red.style.clipPath).toContain('inset');
  pointer(red,'pointerdown',20,20,type); pointer(red,'pointermove',78.5,20,type);
  expect(red.style.clipPath).toBe('');
  pointer(red,'pointerup',78.5,20,type);
  const sheet=computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0];
  expect(sheet.cells[0].contentXMm).toBeCloseTo(30);
  expect(sheet.cells[1].contentXMm).toBeCloseTo(50);
  expect(sheet.cells[0].allowOverflow).toBe(true);
  act(() => useAppStore.getState().undo());
  expect(computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells[0].contentXMm).toBeCloseTo(0);
 });
 it('keeps the ratio when resizing from a corner and supports independent edge resize', () => {
  let handle=container.querySelector('[data-canvas-page-id="red"] [aria-label="move se"]')!;
  pointer(handle,'pointerdown',0,0);pointer(handle,'pointermove',30,20);pointer(handle,'pointerup',30,20);
  let cell=computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells[0];
  expect(cell.contentWidthMm/cell.contentHeightMm).toBeCloseTo(.5);
  const previousHeight=cell.contentHeightMm;
  handle=container.querySelector('[data-canvas-page-id="red"] [aria-label="move e"]')!;
  pointer(handle,'pointerdown',0,0);pointer(handle,'pointermove',20,0);pointer(handle,'pointerup',20,0);
  cell=computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells[0];
  expect(cell.contentHeightMm).toBeCloseTo(previousHeight);
  expect(cell.contentWidthMm/cell.contentHeightMm).not.toBeCloseTo(.5);
 });
 it('reorders from the right-click menu without losing the transform', () => {
  const content=container.querySelector('[data-canvas-page-id="red"] > div')!;
  pointer(content,'pointerdown',20,20);pointer(content,'pointermove',78.5,20);pointer(content,'pointerup',78.5,20);
  act(() => content.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:80,clientY:40})));
  const front=Array.from(document.querySelectorAll('[role=menuitem]')).find(b => b.textContent==='Bring to front') as HTMLButtonElement;
  expect(front).toBeTruthy();act(() => front.click());
  const sheet=computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0];
  expect(sortCellsByLayer(sheet.cells).at(-1)?.page?.id).toBe('red');
  expect(sheet.cells[0].contentXMm).toBeCloseTo(30);
  const rendered=Array.from(container.querySelectorAll('[data-canvas-page-id]')).map(el => el.getAttribute('data-canvas-page-id'));
  expect(rendered).toEqual(['blue','red']);
 });
 it('moves one step-and-repeat occurrence without moving its sibling', () => {
  act(() => useAppStore.setState({pages:[makePage('red')],layout:{...useAppStore.getState().layout,placementMode:'step-and-repeat'}}));
  const copies=container.querySelectorAll('[data-canvas-page-id="red"]');
  expect(copies).toHaveLength(2);
  const second=copies[1].firstElementChild!;
  pointer(second,'pointerdown',120,20);pointer(second,'pointermove',140,20);pointer(second,'pointerup',140,20);
  const cells=computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells;
  expect(cells[0].contentXMm).toBeCloseTo(0);
  expect(cells[1].contentXMm).toBeCloseTo(50+20/1.95);
 });
 it('cancels an interrupted drag without saving it', () => {
  const red=container.querySelector('[data-canvas-page-id="red"] > div')!;
  pointer(red,'pointerdown',20,20,'touch');pointer(red,'pointermove',78,20,'touch');pointer(red,'pointercancel',78,20,'touch');
  expect(computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells[0].contentXMm).toBeCloseTo(0);
 });
});
