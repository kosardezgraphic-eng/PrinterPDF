// @vitest-environment jsdom
/**
 * Dropping a file on the workspace has to do exactly one of two things: import it, or place a
 * picture on the sheet under the cursor. It must never do neither — and it must never disturb the
 * preview while the pointer is still moving.
 *
 * The flicker was the original complaint: `dragover` fires on the element under the cursor every few
 * milliseconds and `dragleave` fires on the workspace each time the pointer crosses into a child, so
 * driving the hint from those events as they arrive made the whole sheet area blink and re-render.
 * On a busy renderer Windows even cancels the drag, which is how a drop "did nothing".
 */
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PageItem} from '@shared/models';
import {PreviewWorkspace} from '../components/PreviewWorkspace';
import {DEFAULT_LAYOUT,DEFAULT_SETTINGS,useAppStore} from '../store/useAppStore';

const PNG=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const page:PageItem={id:'p',documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:200,heightMm:300,rotation:0,
  selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0};

let root:Root,host:HTMLDivElement,importFiles:ReturnType<typeof vi.fn>,addImageOverlayFiles:ReturnType<typeof vi.fn>;
const main=()=>host.querySelector('main')!;
const viewport=()=>host.querySelector<HTMLElement>('[data-preview-viewport]')!;
const canvas=()=>host.querySelector<HTMLElement>('[data-sheet-canvas-index]')!;
const overlay=()=>host.querySelector('[data-file-drop-overlay]');
const picture=()=>new File([PNG],'logo.png',{type:'image/png'});
const pdf=(name='scan.pdf')=>new File(['%PDF-1.4\n%%EOF\n'],name,{type:'application/pdf'});

function transfer(files:File[]) {
  return { files, items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    types: ['Files'], getData: () => '', setData: () => {}, dropEffect: 'none' };
}
/** A file drag in jsdom: a mouse event carrying a dataTransfer, which is all the app can read. */
function dragEvent(el:Element,type:string,files:File[],clientX=60,clientY=40,relatedTarget:Element|null=null) {
  const ev=new MouseEvent(type,{bubbles:true,cancelable:true,clientX,clientY,relatedTarget});
  Object.defineProperty(ev,'dataTransfer',{value:transfer(files)});
  act(()=>el.dispatchEvent(ev));
  return ev;
}
function rect(el:Element|null,width:number,height:number){if(!el)return;
  vi.spyOn(el,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:width,bottom:height,width,height,x:0,y:0,toJSON:()=>({})} as DOMRect);}
async function flush(){for(let i=0;i<6;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});}

beforeEach(()=>{
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  useAppStore.setState({pages:[page],documents:[],overlays:[],selectedOverlayId:null,textEdit:null,activePageId:'p',
    settings:{...DEFAULT_SETTINGS,language:'en'},viewMode:'single',activeSheetIndex:0,previewPageRequest:null,
    layout:{...DEFAULT_LAYOUT,paperSize:'Custom',customWidthMm:200,customHeightMm:300,rows:1,cols:1,duplexMode:'none',
      marginMode:'custom',marginsMm:{top:0,right:0,bottom:0,left:0},horizontalGutterMm:0,verticalGutterMm:0,
      autoRotateToFit:false,showCellBorders:false,rulerGuides:[]}});
  importFiles=vi.fn(async()=>{});
  addImageOverlayFiles=vi.fn(async()=>1);
  useAppStore.setState({importFiles,addImageOverlayFiles} as never);
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();});

function render(){act(()=>root.render(React.createElement(PreviewWorkspace,{onCursorMoveMm:()=>{}})));rect(canvas(),200,300);}

describe('file drops on the workspace',()=>{
 it('keeps the hint up while the pointer moves into a child of the drop zone',()=>{
  render();
  expect(overlay()).toBeNull();
  dragEvent(main(),'dragenter',[]);
  expect(overlay()).not.toBeNull();
  // Crossing into a child is a dragleave on the workspace followed by a dragenter on the child.
  dragEvent(viewport(),'dragenter',[]);
  dragEvent(main(),'dragleave',[]);
  expect(overlay()).not.toBeNull();                                            // still inside the workspace
  dragEvent(main(),'dragover',[]);dragEvent(viewport(),'dragover',[]);
  expect(overlay()).not.toBeNull();
  dragEvent(main(),'dragleave',[],60,40,document.body);                        // leaving for good
  expect(overlay()).toBeNull();
 });
 it('imports a PDF dropped anywhere in the workspace, including the empty padding',async()=>{
  render();
  dragEvent(viewport(),'drop',[pdf()]);
  await flush();
  expect(importFiles).toHaveBeenCalledTimes(1);
  expect(importFiles.mock.calls[0][0].map((file:File)=>file.name)).toEqual(['scan.pdf']);
  expect(useAppStore.getState().overlays).toHaveLength(0);
 });
 it('treats a picture dropped outside a sheet as a new document, not as an overlay',async()=>{
  render();
  dragEvent(viewport(),'drop',[picture()]);
  await flush();
  expect(importFiles).toHaveBeenCalledTimes(1);
  expect(addImageOverlayFiles).not.toHaveBeenCalled();
 });
 it('still swallows an unusable drop instead of letting the window open the file',async()=>{
  render();
  const event=dragEvent(main(),'drop',[]);
  await flush();
  expect(event.defaultPrevented).toBe(true);                                     // no navigation to file://
  expect(importFiles).not.toHaveBeenCalled();
 });
 it('never puts the drop hint between the cursor and the sheet',()=>{
  render();
  dragEvent(main(),'dragenter',[]);
  expect(overlay()!.getAttribute('class')).toContain('pointer-events-none');
 });
 it('places a picture dropped on the sheet and releases the workspace afterwards',async()=>{
  render();
  dragEvent(main(),'dragenter',[]);
  dragEvent(canvas(),'dragover',[picture()]);
  expect(host.textContent).toContain('Release to drop the picture');
  await act(async()=>{dragEvent(canvas(),'drop',[picture()],60,150);});await flush();
  expect(addImageOverlayFiles).toHaveBeenCalledTimes(1);
  expect(importFiles).not.toHaveBeenCalled();
  expect(overlay()).toBeNull();                                                  // the hint is not left hanging
  expect(host.textContent).not.toContain('Release to drop the picture');
 });
 it('follows the cursor with the picture box without remounting the sheet',()=>{
  render();
  dragEvent(canvas(),'dragover',[picture()],60,150);
  const hint=host.querySelector<HTMLElement>('[data-picture-drop-hint]')!;
  const sheet=canvas();
  expect(hint.style.left).toBe('30%');expect(hint.style.top).toBe('50%');        // where the first event pointed
  dragEvent(canvas(),'dragover',[picture()],100,60);
  expect(host.querySelector('[data-picture-drop-hint]')).toBe(hint);             // same node: no re-render churn
  expect(host.querySelector('[data-sheet-canvas-index]')).toBe(sheet);
  expect(hint.style.left).toBe('50%');expect(hint.style.top).toBe('20%');
 });
 it('clears the hint when the picture leaves the sheet',()=>{
  render();
  dragEvent(canvas(),'dragover',[picture()],60,150);
  expect(host.querySelector('[data-picture-drop-hint]')).not.toBeNull();
  act(()=>canvas()!.dispatchEvent(new MouseEvent('dragleave',{bubbles:true,cancelable:true,relatedTarget:document.body})));
  expect(host.querySelector('[data-picture-drop-hint]')).toBeNull();
 });
});
