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
function pointer(el:Element,type:string,x:number,y:number,pointerType='mouse',shiftKey=false) {
 const ev = new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,shiftKey});
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
 const first=container.querySelector('[data-canvas-page-id="red"] > div') as HTMLElement; act(() => first.click());
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
 it.each(['mouse','touch'])('rotates a selected occurrence freely with %s, updates preview and can undo', pointerType => {
  const content=container.querySelector('[data-canvas-page-id="red"] [data-page-content]') as HTMLElement;
  vi.spyOn(content,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:100,bottom:200,width:100,height:200,x:0,y:0,toJSON:()=>({})});
  const handle=container.querySelector('[aria-label="Rotate image"]')!;
  pointer(handle,'pointerdown',50,50,pointerType);pointer(handle,'pointermove',80,60,pointerType);
  expect(parseFloat(content.style.transform.replace('rotate(',''))).toBeCloseTo(36.87,1);
  expect(container.querySelector('[data-rotation-value]')?.textContent).toContain('36.9');
  pointer(handle,'pointerup',80,60,pointerType);
  const read=() => computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells[0].transform?.rotationDeg ?? 0;
  expect(read()).toBeCloseTo(36.87,1);
  act(() => useAppStore.getState().undo());expect(read()).toBe(0);
  act(() => useAppStore.getState().redo());expect(read()).toBeCloseTo(36.87,1);
  expect(computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells[1].transform?.rotationDeg).toBeUndefined();
 });
 it.each([[80,60,45],[100,100,90],[20,60,-45]] as const)('snaps rotation to %s,%s → %s° with Shift', (x,y,expected) => {
  const content=container.querySelector('[data-canvas-page-id="red"] [data-page-content]') as HTMLElement;
  vi.spyOn(content,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:100,bottom:200,width:100,height:200,x:0,y:0,toJSON:()=>({})});
  const handle=container.querySelector('[aria-label="Rotate image"]')!;
  pointer(handle,'pointerdown',50,50);pointer(handle,'pointermove',x,y,'mouse',true);
  expect(content.style.transform).toBe(`rotate(${expected}deg)`);
  pointer(handle,'pointerup',x,y,'mouse',true);
  expect(computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells[0].transform?.rotationDeg).toBe(expected);
 });
 it('cancels rotation without saving and offers keyboard rotation', () => {
  const content=container.querySelector('[data-canvas-page-id="red"] [data-page-content]') as HTMLElement;
  vi.spyOn(content,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:100,bottom:200,width:100,height:200,x:0,y:0,toJSON:()=>({})});
  const handle=container.querySelector('[aria-label="Rotate image"]')!;
  pointer(handle,'pointerdown',50,50,'touch');pointer(handle,'pointermove',100,100,'touch');pointer(handle,'pointercancel',100,100,'touch');
  expect(content.style.transform).toBe('rotate(0deg)');
  expect(computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells[0].transform?.rotationDeg).toBeUndefined();
  act(() => handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true})));
  expect(content.style.transform).toBe('rotate(45deg)');
 });
 it('rotates only the chosen step-and-repeat occurrence', () => {
  act(() => useAppStore.setState({pages:[makePage('red')],layout:{...useAppStore.getState().layout,placementMode:'step-and-repeat'}}));
  const copies=container.querySelectorAll('[data-canvas-page-id="red"]');
  const second=copies[1].querySelector<HTMLElement>('[data-page-content]')!;act(() => second.click());
  vi.spyOn(second,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:100,bottom:200,width:100,height:200,x:0,y:0,toJSON:()=>({})});
  const handle=copies[1].querySelector('[aria-label="Rotate image"]')!;
  pointer(handle,'pointerdown',50,50);pointer(handle,'pointermove',100,100,'mouse',true);pointer(handle,'pointerup',100,100,'mouse',true);
  const cells=computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells;
  expect(cells[0].transform?.rotationDeg).toBeUndefined();expect(cells[1].transform?.rotationDeg).toBe(90);
  const saved=JSON.parse(JSON.stringify(useAppStore.getState().layout));
  expect(computeImpositionSheets(useAppStore.getState().pages,saved)[0].cells[1].transform?.rotationDeg).toBe(90);
 });
 it('keeps rotation while moving or resizing using the rotated local axes', () => {
  const current=()=>computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)[0].cells[0];
  act(() => useAppStore.getState().applyCellTransform('red',current().occurrenceKey!,{x:0,y:0,scaleX:1,scaleY:1,rotationDeg:90}));
  const before=current(), handle=container.querySelector('[data-canvas-page-id="red"] [aria-label="move e"]')!;
  pointer(handle,'pointerdown',10,10);pointer(handle,'pointermove',10,29.5);pointer(handle,'pointerup',10,29.5);
  const after=current();
  expect(after.contentWidthMm-before.contentWidthMm).toBeCloseTo(10);
  expect(after.contentHeightMm).toBeCloseTo(before.contentHeightMm);
  expect(after.contentYMm+after.contentHeightMm/2 - (before.contentYMm+before.contentHeightMm/2)).toBeCloseTo(5);
  expect(after.transform?.rotationDeg).toBe(90);
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
  const second=copies[1].firstElementChild as HTMLElement;
  act(() => second.click());
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
