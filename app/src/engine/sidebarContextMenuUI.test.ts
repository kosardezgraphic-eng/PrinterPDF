// @vitest-environment jsdom
/**
 * A right-click on one thumbnail works on the whole selection.
 *
 * Picking six pages and right-clicking one of them is how an operator asks for "these six". Before
 * this, the menu acted on the page under the cursor only — so the other five kept their rotation,
 * their print state and their place in the queue, which reads as a broken app rather than a scoped
 * action. The menu now says how far each item reaches, and an explicit "all pages" item is kept for
 * the case where the whole desk really is the target.
 */
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PageItem,SourceDocument} from '@shared/models';
import {SidebarPages} from '../components/SidebarPages';
import {DEFAULT_LAYOUT,DEFAULT_SETTINGS,useAppStore} from '../store/useAppStore';

const doc=(id:string):SourceDocument=>({id,name:`${id}.pdf`,filePath:'',fileSize:10,fileType:'pdf',mimeType:'application/pdf',pageCount:4,createdAt:''});
const page=(id:string,highlighted=false,print=true):PageItem=>({id,documentId:'d1',documentName:'d1',sourcePageNumber:1,
  widthMm:100,heightMm:200,rotation:0,isHighlighted:highlighted,selectedForPrint:print,isBlankPage:false,
  colorProfile:'color',inkCoveragePercent:0,thumbnailDataUrl:'data:image/png;base64,AA=='});

let root:Root,container:HTMLDivElement,exportPdf:ReturnType<typeof vi.fn>;
const card=(id:string)=>container.querySelector<HTMLElement>(`[data-page-id="${id}"]`)!;
const menu=()=>container.querySelector<HTMLElement>('[data-page-context-menu]');
const item=(action:string)=>menu()!.querySelector<HTMLElement>(`[data-context-action="${action}"]`)!;
const state=()=>useAppStore.getState();
const byId=(id:string)=>state().pages.find(page2=>page2.id===id);
const ids=()=>state().pages.map(page2=>page2.id);

function rightClick(id:string){
  const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:60});
  act(()=>card(id).dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);                                     // never the browser menu
}
function choose(action:string){act(()=>item(action).click());}

beforeEach(()=>{
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  exportPdf=vi.fn(async()=>{});
  useAppStore.setState({
    documents:[doc('d1')],
    pages:[page('a'),page('b',true),page('c',true,false),page('d')],
    settings:{...DEFAULT_SETTINGS,language:'en'},
    layout:{...DEFAULT_LAYOUT,duplexMode:'none'},
    sidebarTab:'pages',sidebarReveal:null,previewPageRequest:null,activeSheetIndex:0,overlays:[],
    exportMergedOrImposedPdf:exportPdf,
  } as never);
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  act(()=>root.render(React.createElement(SidebarPages)));
});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('right-click on the thumbnails',()=>{
 it('takes the whole selection as its scope and says so',()=>{
  rightClick('b');
  expect(menu()).not.toBeNull();
  expect(menu()!.querySelector('[data-context-menu-scope]')!.textContent).toBe('Applies to the 2 pages selected');
 });
 it('rotates every selected page, and only those',()=>{
  rightClick('b');choose('rotate');
  expect([byId('a')!.rotation,byId('b')!.rotation,byId('c')!.rotation,byId('d')!.rotation]).toEqual([0,90,90,0]);
  expect(menu()).toBeNull();                                                      // and the menu closes behind it
 });
  // a and d were never part of the selection: their print state is not the menu's business.
 it('inverts the print state of the selection without touching the rest',()=>{
  rightClick('c');choose('invert-print-selection');
  expect(state().pages.map(page2=>page2.selectedForPrint)).toEqual([true,false,true,true]);
 });
 it('keeps a separate item for inverting the whole desk',()=>{
  rightClick('c');choose('invert-print-all');
  expect(state().pages.map(page2=>page2.selectedForPrint)).toEqual([false,false,true,false]);
 });
 it('duplicates the selection in one step',()=>{
  rightClick('b');choose('duplicate');
  const order=ids();
  expect(order).toHaveLength(6);
  expect(order[0]).toBe('a');
  expect(order[2]).toMatch(/^b-dup-/);                                             // each copy follows its source
  expect(order[3]).toBe('c');
  expect(order[4]).toMatch(/^c-dup-/);
  expect(order[5]).toBe('d');
 });
 it('makes an array of each selected page',()=>{
  rightClick('b');choose('make-array');
  // Two selected pages, four copies each: 4 + 2 × 3.
  expect(state().pages).toHaveLength(10);
  expect(state().pages.filter(page2=>/-arr-/.test(page2.id)).length).toBe(6);
  expect(state().pages.filter(page2=>page2.id.startsWith('b-arr-')).length).toBe(3);
  expect(state().pages.filter(page2=>page2.id.startsWith('c-arr-')).length).toBe(3);
 });
 it('inserts one blank page after every selected page',()=>{
  rightClick('b');choose('insert-blank');
  const order=ids();
  expect(order).toHaveLength(6);
  expect(order[2]).toMatch(/^blank-/);                                            // after b
  expect(order[4]).toMatch(/^blank-/);                                            // and after c
  expect(state().pages.filter(page2=>page2.isBlankPage).map(page2=>page2.documentId)).toEqual(['d1','d1']);
 });
 // The second press is the way back, not a second inversion — and "back" means the page's own previous
 // state, which was *no opinion at all*. A stored `false` would look the same on screen today and then quietly
 // exclude those pages from any document-wide invert turned on tomorrow.
 it('sets the invert override on the selection and gives the inheritance back on the second go',()=>{
  rightClick('b');choose('invert-colour');
  expect([byId('a')!.overrides?.invert,byId('b')!.overrides?.invert,byId('c')!.overrides?.invert,byId('d')!.overrides?.invert])
    .toEqual([undefined,true,true,undefined]);
  rightClick('b');choose('invert-colour');
  expect([byId('b')!.overrides?.invert,byId('c')!.overrides?.invert]).toEqual([undefined,undefined]);
  rightClick('a');choose('invert-colour');                                        // a single page still works
  expect(byId('a')!.overrides?.invert).toBe(true);
  expect(byId('b')!.overrides?.invert).toBeUndefined();
 });
 it('deletes the selection',()=>{
  rightClick('c');choose('delete');
  expect(ids()).toEqual(['a','d']);
 });
 it('extracts the selection to PDF',()=>{
  rightClick('b');choose('extract-pdf');
  expect(exportPdf).toHaveBeenCalledTimes(1);
  expect(exportPdf.mock.calls[0][0]).toBe(true);
 });
 it('narrows to the page under the cursor when it was not part of the selection',()=>{
  rightClick('b');choose('invert-colour');                                        // b and c inverted
  rightClick('d');
  expect(menu()!.querySelector('[data-context-menu-scope]')!.textContent).toBe('Only this page');
  choose('rotate');
  expect([byId('a')!.rotation,byId('b')!.rotation,byId('c')!.rotation,byId('d')!.rotation]).toEqual([0,0,0,90]);
  // the selection moved to d, so the colour override b and c already had is left alone
  expect([byId('b')!.overrides?.invert,byId('c')!.overrides?.invert,byId('d')!.overrides?.invert]).toEqual([true,true,undefined]);
 });
});
