// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PageItem,PageOverlayText} from '@shared/models';
import {PreviewWorkspace} from '../components/PreviewWorkspace';
import {TextControlPanel} from '../components/TextControlPanel';
import {Ribbon} from '../components/Ribbon';
import {DEFAULT_LAYOUT,DEFAULT_SETTINGS,useAppStore} from '../store/useAppStore';
import {getDefaultPageNumberSettings} from './watermarkEngine';
const page:PageItem={id:'p',documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:200,heightMm:300,rotation:0,selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0};
let root:Root,host:HTMLDivElement,frames:Map<number,FrameRequestCallback>,seq:number;
const click=(name:string)=>act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent===name)!.click());
function pointer(el:Element,type:string,x:number,y:number,ctrl=false){const e=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,ctrlKey:ctrl});Object.defineProperties(e,{pointerId:{value:1},pointerType:{value:'mouse'}});act(()=>el.dispatchEvent(e));}
const field=(name:string)=>host.querySelector<HTMLElement>(`[aria-label="${name}"]`)!;
const setValue=(el:HTMLInputElement|HTMLTextAreaElement,value:string)=>act(()=>{const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});
const text=()=>useAppStore.getState().overlays[0] as PageOverlayText;
const editor=()=>field('Edit text on page') as HTMLTextAreaElement;
const finish=()=>act(()=>useAppStore.getState().finishTextEdit());
beforeEach(()=>{
 (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 Object.defineProperty(HTMLElement.prototype,'setPointerCapture',{configurable:true,value:vi.fn()});
 const ctx={clearRect:vi.fn(),fillRect:vi.fn(),fillText:vi.fn(),measureText:()=>({width:50}),drawImage:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),scale:vi.fn()};
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
 frames=new Map();seq=0;vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{const id=++seq;frames.set(id,cb);return id;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
 useAppStore.setState({pages:[page],documents:[],layout:{...DEFAULT_LAYOUT,paperSize:'Custom',customWidthMm:200,customHeightMm:300,duplexMode:'none',rulerGuides:[]},settings:{...DEFAULT_SETTINGS,language:'en'},overlays:[],selectedOverlayId:null,activePageId:null,textEdit:null,pageNumbering:getDefaultPageNumberSettings(),activeSheetIndex:0,activeRibbonTab:'insert',viewMode:'single'});
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);act(()=>root.render(React.createElement(React.Fragment,null,React.createElement(PreviewWorkspace,{onCursorMoveMm:()=>{}}),React.createElement(TextControlPanel))));
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('text controls and preview',()=>{
 it('starts with page numbering off and lets the user enable it',()=>{
  act(()=>root.render(React.createElement(Ribbon)));
  const label=Array.from(host.querySelectorAll('label')).find(l=>l.textContent?.includes('Page / Bates'))!;
  const checkbox=label.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(checkbox.checked).toBe(false);act(()=>checkbox.click());expect(useAppStore.getState().pageNumbering.enabled).toBe(true);
 });
 it('adds multiple texts, edits content/style and deletes selected text',()=>{
  click('+ Text');expect(text()).toMatchObject({text:'',fontSize:18,target:'page',targetScope:'document',targetDocumentIds:['d']});
  expect(document.activeElement).toBe(editor());setValue(editor(),'سلام جهان');expect(useAppStore.getState().textEdit?.text).toBe('سلام جهان');finish();expect(text().text).toBe('سلام جهان');
  act(()=>field('Bold').click());expect(text().bold).toBe(true);
  click('+ Text');expect(useAppStore.getState().overlays).toHaveLength(2);click('Delete text');expect(useAppStore.getState().overlays).toHaveLength(1);
  act(()=>useAppStore.getState().undo());expect(useAppStore.getState().overlays).toHaveLength(2);
 });
 it('applies page, all and checked scopes without changing print selection',()=>{
  click('+ Text');finish();const scope=field('Text scope') as HTMLSelectElement;
  act(()=>{scope.value='current';scope.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(text().target).toBe('page');expect(text().targetPageIds).toEqual(['p']);
  const target=field('Text target') as HTMLSelectElement;act(()=>{target.value='sheet';target.dispatchEvent(new Event('change',{bubbles:true}));});expect(text().target).toBe('sheet');
  click('Apply to all');expect(text().targetScope).toBe('all');
  click('Apply to checked');expect(text().targetPageIds).toEqual(['p']);expect(useAppStore.getState().pages[0].selectedForPrint).toBe(true);
 });
 it('moves text with an undoable gesture and Ctrl-drags a separate copy',()=>{
  click('+ Text');finish();let node=host.querySelector<HTMLElement>('[data-overlay-id]')!;
  pointer(node,'pointerdown',100,100);pointer(node,'pointermove',139,100);
  expect(text().xPercent).toBe(25);
  act(()=>{const c=[...frames.values()];frames.clear();c.forEach(fn=>fn(0));});
  pointer(node,'pointerup',139,100);expect(text().xPercent).toBeCloseTo(36.111111);
  act(()=>useAppStore.getState().undo());expect(text().xPercent).toBe(25);
  node=host.querySelector<HTMLElement>('[data-overlay-id]')!;
  pointer(node,'pointerdown',100,100,true);expect(node.style.cursor).toBe('copy');pointer(node,'pointermove',139,100,true);
  expect(useAppStore.getState().overlays).toHaveLength(1);expect(node.parentElement?.children.length).toBe(2);
  pointer(node,'pointerup',139,100,true);expect(useAppStore.getState().overlays).toHaveLength(2);
  expect((useAppStore.getState().overlays[1] as PageOverlayText).xPercent).toBeCloseTo(36.111111);
  expect(text().xPercent).toBe(25);
  act(()=>useAppStore.getState().undo());expect(useAppStore.getState().overlays).toHaveLength(1);
 });
 it('double-clicking text selects it and focuses the inline editor without switching tabs',()=>{
  click('+ Text');finish();act(()=>useAppStore.setState({activeRibbonTab:'layout',selectedOverlayId:null}));
  const node=host.querySelector<HTMLElement>('[data-overlay-id]')!;
  act(()=>node.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true})));
  expect(useAppStore.getState().activeRibbonTab).toBe('layout');expect(useAppStore.getState().selectedOverlayId).toBe(text().id);
  act(()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(0));});
  expect(document.activeElement).toBe(editor());
 });
 it('loads text overlays from a project and preserves old project numbering settings',async()=>{
  click('+ Text');setValue(editor(),'متن پروژه');finish();
  const old=text();const project={layout:DEFAULT_LAYOUT,pages:[page],documents:[],overlays:[old],pageNumbering:{...getDefaultPageNumberSettings(),enabled:true}};
  await act(async()=>{await useAppStore.getState().openPspProjectFile({text:async()=>JSON.stringify(project)} as File);});
  expect(text().text).toBe('متن پروژه');expect(useAppStore.getState().pageNumbering.enabled).toBe(true);
 });
 it('cancels a drag without changing state and selects on click',()=>{
  click('+ Text');finish();const node=host.querySelector<HTMLElement>('[data-overlay-id]')!;
  act(()=>useAppStore.getState().selectOverlay(null));pointer(node,'pointerdown',100,100);expect(useAppStore.getState().selectedOverlayId).toBe(text().id);
  pointer(node,'pointermove',139,100);pointer(node,'pointercancel',139,100);expect(text().xPercent).toBe(25);
 });
 it('inserts tokens and applies scripts to the selected inline text with undo',()=>{
  click('+ Text');setValue(editor(),'H2O');act(()=>{editor().setSelectionRange(1,2);editor().dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'ArrowRight'}));});
  act(()=>field('Subscript').click());expect(useAppStore.getState().textEdit?.ranges).toEqual([{start:1,end:2,script:'sub'}]);
  act(()=>{editor().setSelectionRange(3,3);editor().dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'ArrowRight'}));});click('{page}');
  expect(useAppStore.getState().textEdit?.text).toBe('H2O{page}');finish();expect(text().scriptRanges).toEqual([{start:1,end:2,script:'sub'}]);
  act(()=>useAppStore.getState().undo());expect(text().text).toBe('');
 });
 it('resizes using the east handle in a single undoable gesture',()=>{
  click('+ Text');finish();const handle=host.querySelector<HTMLElement>('[data-text-resize="e"]')!;
  pointer(handle,'pointerdown',100,100);pointer(handle,'pointermove',139,100);pointer(handle,'pointerup',139,100);
  expect(text().widthPercent).toBeCloseTo(61.111111);act(()=>useAppStore.getState().undo());expect(text().widthPercent).toBe(50);
 });
 it('allows choosing a sheet even when document scope is initially active',()=>{
  click('+ Text');finish();const target=field('Text target') as HTMLSelectElement;
  act(()=>{target.value='sheet';target.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(text()).toMatchObject({target:'sheet',targetScope:'current'});
 });
 it('has an add text action in the Insert ribbon',()=>{
  act(()=>root.render(React.createElement(React.Fragment,null,React.createElement(Ribbon),React.createElement(PreviewWorkspace,{onCursorMoveMm:()=>{}}))));
  act(()=>field('Add text').click());expect(text().targetScope).toBe('document');expect(document.activeElement).toBe(editor());
 });
 it('targets the active document and captures highlighted document IDs without changing checked pages',()=>{
  const second={...page,id:'p2',documentId:'d2',documentName:'other',isHighlighted:true};
  act(()=>useAppStore.setState({pages:[page,second],activePageId:'p2'}));click('+ Text');finish();
  expect(text().targetDocumentIds).toEqual(['d2']);click('Selected documents');
  expect(text().targetDocumentIds).toEqual(['d','d2']);expect(useAppStore.getState().pages.every(p=>p.selectedForPrint)).toBe(true);
 });
 it('opens an unchecked active page for editing without enabling printing',()=>{
  act(()=>useAppStore.setState({pages:[{...page,selectedForPrint:false}],activePageId:'p'}));click('+ Text');
  expect(editor()).toBeTruthy();setValue(editor(),'draft');finish();expect(text().text).toBe('draft');expect(useAppStore.getState().pages[0].selectedForPrint).toBe(false);
 });
});
