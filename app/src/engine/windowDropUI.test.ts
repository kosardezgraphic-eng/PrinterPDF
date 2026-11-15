// @vitest-environment jsdom
/**
 * A file dropped outside the preview still has to arrive, and it must never be allowed to become a
 * navigation. The default behaviour of a browser (and therefore of the packaged app) when a file
 * lands on a spot that does not claim the drop is to load that file in the window — which looks
 * exactly like "the app fell apart when I dragged a file in". The window-level handlers in `App`
 * are the net under that case, so they are pinned here.
 */
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {App} from '../App';
import {DEFAULT_LAYOUT,DEFAULT_SETTINGS,useAppStore} from '../store/useAppStore';

const PNG=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
let root:Root,host:HTMLDivElement,importFiles:ReturnType<typeof vi.fn>;

/** A drop that never touched the app's own DOM: it only reaches the window listeners. */
function dropOnWindow(type:string,files:File[]) {
  const ev=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:5,clientY:5});
  Object.defineProperty(ev,'dataTransfer',{value:{files,items:files.map(file=>({kind:'file',type:file.type,getAsFile:()=>file})),
    types:['Files'],getData:()=>'',setData:()=>{},dropEffect:'none'}});
  act(()=>host.dispatchEvent(ev));
  return ev;
}
async function flush(){for(let i=0;i<6;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});}

beforeEach(()=>{
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  importFiles=vi.fn(async()=>{});
  useAppStore.setState({initializeWorkspace:vi.fn(async()=>{}),importFiles,addToast:vi.fn(),
    documents:[],pages:[],bookmarks:[],overlays:[],selectedOverlayId:null,textEdit:null,
    settings:{...DEFAULT_SETTINGS,language:'en'},layout:{...DEFAULT_LAYOUT,duplexMode:'none'},
    previewPageRequest:null,activeSheetIndex:0,viewMode:'single'} as never);
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
  act(()=>root.render(React.createElement(App)));
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();});

describe('drops outside the preview',()=>{
 it('imports a PDF that lands anywhere else in the window',async()=>{
  dropOnWindow('dragover',[new File(['%PDF-1.4'],'scan.pdf',{type:'application/pdf'})]);
  const event=dropOnWindow('drop',[new File(['%PDF-1.4'],'scan.pdf',{type:'application/pdf'})]);
  await flush();
  expect(event.defaultPrevented).toBe(true);
  expect(importFiles).toHaveBeenCalledTimes(1);
  expect(importFiles.mock.calls[0][0][0].name).toBe('scan.pdf');
 });
 it('imports a picture as a document, because there is no sheet under the cursor',async()=>{
  const event=dropOnWindow('drop',[new File([PNG],'logo.png',{type:'image/png'})]);
  await flush();
  expect(event.defaultPrevented).toBe(true);
  expect(importFiles).toHaveBeenCalledTimes(1);
  expect(useAppStore.getState().overlays).toHaveLength(0);
 });
 it('claims a file drop it cannot use, so the window is never navigated away',async()=>{
  const event=dropOnWindow('drop',[]);                                      // the drag carries files, none readable
  await flush();
  expect(event.defaultPrevented).toBe(true);
  expect(importFiles).not.toHaveBeenCalled();
 });
 it('leaves an unrelated drag alone',async()=>{
  const ev=new MouseEvent('drop',{bubbles:true,cancelable:true});
  Object.defineProperty(ev,'dataTransfer',{value:{files:[],items:[],types:['text/plain'],getData:()=>'x',setData:()=>{},dropEffect:'none'}});
  act(()=>host.dispatchEvent(ev));
  await flush();
  expect(ev.defaultPrevented).toBe(false);
  expect(importFiles).not.toHaveBeenCalled();
 });
 it('opens with an empty desk, so there is nothing to jumble when a file arrives',()=>{
  expect(host.textContent).toContain('No Documents Loaded in Workspace');
  expect(host.textContent).not.toContain('Load Sample');                     // no demo button on the empty state
  expect(host.querySelector('[data-sheet-canvas-index]')).toBeNull();
 });
});
