// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {PageItem,PageOverlayNumbering} from '@shared/models';
import {PreviewWorkspace} from '../components/PreviewWorkspace';
import {Ribbon} from '../components/Ribbon';
import {NumberingControlPanel} from '../components/NumberingControlPanel';
import {DEFAULT_LAYOUT,DEFAULT_SETTINGS,useAppStore} from '../store/useAppStore';
import {getDefaultPageNumberSettings} from './watermarkEngine';
const pages:PageItem[]=[1,2,3].map(i=>({id:`p${i}`,documentId:'d',documentName:'d',sourcePageNumber:i,widthMm:200,heightMm:300,rotation:0,selectedForPrint:true,isHighlighted:i===1,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0}));
let root:Root,host:HTMLDivElement;
const field=(name:string)=>host.querySelector<HTMLElement>(`[aria-label="${name}"]`)!;
const number=()=>useAppStore.getState().overlays.find(o=>o.kind==='numbering') as PageOverlayNumbering;
const allNumbers=()=>useAppStore.getState().overlays.filter((o):o is PageOverlayNumbering=>o.kind==='numbering');
const setValue=(el:HTMLInputElement|HTMLTextAreaElement,value:string)=>act(()=>{const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});
function pointer(el:Element,type:string,x:number,y:number){const e=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});Object.defineProperties(e,{pointerId:{value:1},pointerType:{value:'mouse'}});act(()=>el.dispatchEvent(e));}
beforeEach(()=>{
 (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 Object.defineProperty(HTMLElement.prototype,'setPointerCapture',{configurable:true,value:vi.fn()});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({clearRect:vi.fn(),fillRect:vi.fn(),fillText:vi.fn(),measureText:()=>({width:20}),drawImage:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),scale:vi.fn(),setLineDash:vi.fn()} as unknown as CanvasRenderingContext2D);
 vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',()=>{});
 useAppStore.setState({pages,documents:[],layout:{...DEFAULT_LAYOUT,paperSize:'Custom',customWidthMm:200,customHeightMm:300,duplexMode:'none',rulerGuides:[]},settings:{...DEFAULT_SETTINGS,language:'en'},overlays:[],selectedOverlayId:null,activePageId:'p1',textEdit:null,pageNumbering:getDefaultPageNumberSettings(),activeSheetIndex:0,activeRibbonTab:'insert',viewMode:'single'});
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);act(()=>root.render(React.createElement(React.Fragment,null,React.createElement(Ribbon),React.createElement(PreviewWorkspace,{onCursorMoveMm:()=>{}}),React.createElement(NumberingControlPanel))));
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('interactive page numbers',()=>{
 it('adds, edits, moves and resizes a numbering overlay with undo',()=>{
  act(()=>field('Add editable page number').click());expect(number()).toMatchObject({target:'page',targetScope:'all',template:'{page}',enabled:true});
  setValue(field('Number template') as HTMLTextAreaElement,'Page {page}');setValue(field('Number formula') as HTMLInputElement,'page+1000');
  expect(number()).toMatchObject({template:'Page {page}',customScript:'page+1000'});
  let node=host.querySelector<HTMLElement>('[data-overlay-id]')!;expect(node.getAttribute('aria-label')).toBe('Page 1001');
  pointer(node,'pointerdown',100,100);pointer(node,'pointermove',135,100);pointer(node,'pointerup',135,100);expect(number().xPercent).toBeGreaterThan(30);
  act(()=>useAppStore.getState().undo());expect(number().xPercent).toBe(30);
  node=host.querySelector<HTMLElement>('[data-overlay-id]')!;const handle=node.querySelector<HTMLElement>('[data-text-resize="e"]')!;
  pointer(handle,'pointerdown',100,100);pointer(handle,'pointermove',135,100);pointer(handle,'pointerup',135,100);expect(number().widthPercent).toBeGreaterThan(40);
  act(()=>useAppStore.getState().undo());expect(number().widthPercent).toBe(40);
 });
 it('supports odd/even and independent selected pages without changing print selection',()=>{
  act(()=>field('Add editable page number').click());const scope=field('Number scope') as HTMLSelectElement;
  act(()=>{scope.value='even';scope.dispatchEvent(new Event('change',{bubbles:true}));});expect(number().targetScope).toBe('even');
  setValue(field('Numbering range') as HTMLInputElement,'1, 3');act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Apply range')!.click());
  expect(number()).toMatchObject({targetScope:'selected',targetPageIds:['p1','p3']});expect(useAppStore.getState().pages.every(p=>p.selectedForPrint)).toBe(true);
  setValue(field('Numbering range') as HTMLInputElement,'4');act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Apply range')!.click());expect(number().targetPageIds).toEqual(['p1','p3']);expect(host.querySelector('[role="alert"]')).toBeTruthy();
 });
 it('converts legacy numbering explicitly and undo restores it',()=>{
  act(()=>useAppStore.setState({pageNumbering:{...getDefaultPageNumberSettings(),enabled:true,format:'bates',startNumber:42,batesDigits:9,batesPrefix:'X-'}}));
  act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Convert legacy numbering to editable')!.click());
  expect(number()).toMatchObject({target:'sheet',template:'X-{serial}',startOffset:42,padZeros:9});expect(useAppStore.getState().pageNumbering.enabled).toBe(false);
  act(()=>useAppStore.getState().undo());expect(useAppStore.getState().pageNumbering.enabled).toBe(true);expect(useAppStore.getState().overlays).toHaveLength(0);
 });
 it('nudges with arrow keys, toggles visibility and creates an independent even/odd pair',()=>{
  act(()=>field('Add editable page number').click());
  const node=host.querySelector<HTMLElement>('[data-overlay-id]')!;expect(node.tabIndex).toBe(0);
  const key=(k:string,shift=false)=>act(()=>{node.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,shiftKey:shift}));});
  const before={x:number().xPercent,y:number().yPercent};key('ArrowRight');expect(number().xPercent).toBeGreaterThan(before.x);
  key('ArrowDown',true);expect(number().yPercent).toBeGreaterThan(before.y);
  act(()=>useAppStore.getState().undo());act(()=>useAppStore.getState().undo());expect({x:number().xPercent,y:number().yPercent}).toEqual(before);
  const duplicate=[...host.querySelectorAll('button')].find(b=>b.textContent==='Add another independent number')!;act(()=>duplicate.click());
  const numbers=useAppStore.getState().overlays.filter(o=>o.kind==='numbering') as PageOverlayNumbering[];
  expect(numbers).toHaveLength(2);expect(numbers[1]).toMatchObject({targetScope:'odd'});expect(numbers[1].id).not.toBe(numbers[0].id);
  expect(useAppStore.getState().selectedOverlayId).toBe(allNumbers()[1].id);
  const toggle=[...host.querySelectorAll('button')].find(b=>b.textContent==='Enabled')!;expect(toggle.getAttribute('aria-pressed')).toBe('true');
  act(()=>toggle.click());expect(allNumbers()[1].enabled).toBe(false);expect(allNumbers()[0].enabled).toBe(true);
  expect(host.querySelectorAll('[data-overlay-id]')).toHaveLength(1);
  act(()=>useAppStore.getState().selectOverlay(allNumbers()[1].id));
  act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Enabled')!.click());
  expect(allNumbers()[1].enabled).toBe(true);expect(host.querySelectorAll('[data-overlay-id]')).toHaveLength(2);
 });
 it('warns instead of silently doubling legacy and editable numbers',()=>{
  act(()=>field('Add editable page number').click());
  act(()=>{host.querySelector<HTMLInputElement>('input[aria-label="Legacy numbering (fixed output only)"]')!.click();});
  expect(useAppStore.getState().pageNumbering.enabled).toBe(true);
  expect(useAppStore.getState().toasts.some(t=>t.type==='warning'&&/legacy numbering|قدیمی/i.test(t.title))).toBe(true);
 });
 it('round-trips numbering through a saved project and keeps the Persian default',async()=>{
  act(()=>field('Add editable page number').click());
  setValue(field('Number template') as HTMLTextAreaElement,'{page}/{total}');setValue(field('Number formula') as HTMLInputElement,'page+1000');
  setValue(field('Number color') as HTMLInputElement,'#ff0000');
  const project={layout:useAppStore.getState().layout,pages,documents:[],overlays:useAppStore.getState().overlays,pageNumbering:useAppStore.getState().pageNumbering};
  act(()=>useAppStore.setState({overlays:[],selectedOverlayId:null}));expect(host.querySelector('[data-overlay-id]')).toBeNull();
  await act(async()=>{await useAppStore.getState().openPspProjectFile({text:async()=>JSON.stringify(project)} as File);});
  expect(number()).toMatchObject({template:'{page}/{total}',customScript:'page+1000',color:'#ff0000',format:'english'});
  expect(host.querySelector<HTMLElement>('[data-overlay-id]')!.getAttribute('aria-label')).toBe('1001/3');
  act(()=>useAppStore.setState({settings:{...DEFAULT_SETTINGS,language:'fa'}}));
  act(()=>field('افزودن شماره صفحه قابل ویرایش').click());
  expect(allNumbers()).toHaveLength(2);expect(allNumbers()[1]).toMatchObject({format:'persian',template:'{page}',targetScope:'all'});
  expect(host.querySelectorAll('[data-overlay-id]')).toHaveLength(2);
 });
 it('inserts tokens and reports an unusable formula instead of printing wrong numbers',()=>{
  act(()=>field('Add editable page number').click());
  const template=field('Number template') as HTMLTextAreaElement;
  setValue(template,'');act(()=>{template.setSelectionRange(0,0);template.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));});
  act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='{pad4}')!.click());
  expect(number().template).toBe('{pad4}');
  setValue(field('Number formula') as HTMLInputElement,'page constructor');
  expect([...host.querySelectorAll('[role="alert"]')].some(e=>/Invalid formula|cannot be computed/.test(e.textContent??''))).toBe(true);
 });
 it('lists every numbering so independent pages can be switched and edited separately',()=>{
  act(()=>field('Add editable page number').click());
  const first=number().id;
  act(()=>[...host.querySelectorAll<HTMLElement>('button')].find(b=>b.textContent==='+ Number')!.click());
  const created=allNumbers();expect(created).toHaveLength(2);
  act(()=>useAppStore.getState().updateOverlay(created[1].id,{template:'{serial}',startOffset:700}));
  const tabs=[...host.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')];expect(tabs).toHaveLength(2);
  expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  act(()=>tabs[0].click());expect(useAppStore.getState().selectedOverlayId).toBe(first);
  expect((field('Number template') as HTMLTextAreaElement).value).toBe('{page}');
  act(()=>tabs[1].click());expect((field('Number template') as HTMLTextAreaElement).value).toBe('{serial}');
 });
 it('wraps the selected template part into a superscript and keeps the marker out of the number',()=>{
  act(()=>field('Add editable page number').click());
  const template=field('Number template') as HTMLTextAreaElement;
  setValue(template,'{page}th');act(()=>{template.setSelectionRange(6,8);template.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));});
  act(()=>[...host.querySelectorAll<HTMLElement>('button')].find(b=>b.getAttribute('aria-label')==='Superscript')!.click());
  expect(number().template).toBe('{page}^{th}');
  expect(host.querySelector<HTMLElement>('[data-overlay-id]')!.getAttribute('aria-label')).toBe('1th');
  expect(host.querySelectorAll('canvas').length).toBeGreaterThan(0);
  act(()=>{template.setSelectionRange(6,11);act(()=>{[...host.querySelectorAll<HTMLElement>('button')].find(b=>b.getAttribute('aria-label')==='Subscript')!.click();});});
  expect(number().template).toBe('{page}_{^{th}}');
  expect(host.querySelector<HTMLElement>('[data-overlay-id]')!.getAttribute('aria-label')).toBe('1th');
 });
});
