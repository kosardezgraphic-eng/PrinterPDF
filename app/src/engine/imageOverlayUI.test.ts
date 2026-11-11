// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PageItem,PageOverlayImage,PageOverlayNumbering} from '@shared/models';
import {PreviewWorkspace} from '../components/PreviewWorkspace';
import {ImageControlPanel} from '../components/ImageControlPanel';
import {Ribbon} from '../components/Ribbon';
import {DEFAULT_LAYOUT,DEFAULT_SETTINGS,useAppStore} from '../store/useAppStore';
import {getDefaultPageNumberSettings} from './watermarkEngine';
import {computeImpositionSheets} from './layoutEngine';
import {imagePlacements} from './overlayPlacements';
import {jpegDataUrl, pngChunk, pngDataUrl, sof} from './imageFixtures';

/** A 400×200 picture: 1 px = 1 mm on the mocked 200×300 sheet, so the expected box is 90×45 mm. */
const PNG=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const PDF='%PDF-1.4\n%%EOF\n';
const pdfFile=(name='scan.pdf')=>new File([PDF],name,{type:'application/pdf'});
const page:PageItem={id:'p',documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:200,heightMm:300,rotation:0,selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0};
const image=(overrides:Partial<PageOverlayImage>={}):PageOverlayImage=>({id:'i',kind:'image',target:'sheet',targetScope:'all',targetPageIds:[],targetSheetIndex:1,
  xPercent:20,yPercent:30,widthPercent:45,heightPercent:15,opacity:1,rotation:0,src:'data:image/png;base64,AAA',name:'logo',naturalWidth:400,naturalHeight:200,fit:'fill',lockAspect:true,...overrides});
const overlay=(index:number)=>useAppStore.getState().overlays[index] as PageOverlayImage;
const boxMm=(item:PageOverlayImage)=>({width:item.widthPercent*200/100,height:item.heightPercent*300/100});

let root:Root,host:HTMLDivElement,importFiles:ReturnType<typeof vi.fn>;
const canvas=()=>host.querySelector<HTMLElement>('[data-sheet-canvas-index]')!;
const node=()=>host.querySelector<HTMLElement>('[data-overlay-id]')!;
const field=(name:string)=>host.querySelector<HTMLElement>(`[aria-label="${name}"]`)!;
const click=(name:string)=>act(()=>{const el=[...host.querySelectorAll('button')].find(b=>b.textContent===name)!;el.click();});
function rect(el:Element|null,width:number,height:number){if(!el)return;
  vi.spyOn(el,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:width,bottom:height,width,height,x:0,y:0,toJSON:()=>({})} as DOMRect);}
function drop(el:Element,type:string,files:File[],clientX=60,clientY=40){const ev=new MouseEvent(type,{bubbles:true,cancelable:true,clientX,clientY});
  Object.defineProperty(ev,'dataTransfer',{value:{files,items:files.map(file=>({kind:'file',type:file.type,getAsFile:()=>file})),types:['Files'],getData:()=>''}});
  act(()=>el.dispatchEvent(ev));return ev;}
async function flush(){for(let i=0;i<8;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});}
function pointer(el:Element,type:string,x:number,y:number,shift=false,ctrl=false){const e=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,shiftKey:shift,ctrlKey:ctrl});
  Object.defineProperties(e,{pointerId:{value:1},pointerType:{value:'mouse'}});act(()=>el.dispatchEvent(e));}
const ratio=(item:PageOverlayImage)=>{const box=boxMm(item);return box.width/box.height;};

beforeEach(()=>{
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  Object.defineProperty(HTMLElement.prototype,'setPointerCapture',{configurable:true,value:vi.fn()});
  vi.stubGlobal('Image',class{onload:(()=>void)|null=null;onerror:(()=>void)|null=null;naturalWidth=400;naturalHeight=200;set src(_v:string){queueMicrotask(()=>this.onload?.());}});
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{cb(0);return 1;});vi.stubGlobal('cancelAnimationFrame',()=>{});
  useAppStore.setState({pages:[page],documents:[],layout:{...DEFAULT_LAYOUT,paperSize:'Custom',customWidthMm:200,customHeightMm:300,rows:1,cols:1,duplexMode:'none',
    marginMode:'custom',marginsMm:{top:0,right:0,bottom:0,left:0},horizontalGutterMm:0,verticalGutterMm:0,autoRotateToFit:false,showCellBorders:false,rulerGuides:[]},
    settings:{...DEFAULT_SETTINGS,language:'en'},overlays:[],selectedOverlayId:null,activePageId:'p',textEdit:null,pageNumbering:getDefaultPageNumberSettings(),
    activeSheetIndex:0,activeRibbonTab:'insert',viewMode:'single'});
  importFiles=vi.fn(async()=>{});
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

function render(){act(()=>root.render(React.createElement(React.Fragment,null,
  React.createElement(PreviewWorkspace,{onCursorMoveMm:()=>{}}),React.createElement(ImageControlPanel))));rect(canvas(),200,300);}

describe('picture format line',()=>{
 it('shows what the file is and how the export will handle it',()=>{
  useAppStore.setState({overlays:[image({src:pngDataUrl({width:12,height:6,colorType:6})})],selectedOverlayId:'i'});
  render();
  expect(host.querySelector('[data-picture-format]')!.textContent).toBe('File: PNG 12×6, RGB + alpha, 8-bit');
 });
 it('warns before an animation is flattened',()=>{
  useAppStore.setState({overlays:[image({src:pngDataUrl({extra:pngChunk('acTL',[0,0,0,2])})})],selectedOverlayId:'i'});
  render();
  const note=host.querySelector('[data-picture-format]')!.textContent!;
  expect(note).toContain('PNG 8×8');expect(note).toContain('the animation is flattened to its first frame');
 });
 it('names a CMYK file so the operator can expect a colour-managed print',()=>{
  useAppStore.setState({overlays:[image({src:jpegDataUrl([sof(0xc0,30,20,4)])})],selectedOverlayId:'i'});
  render();
  const note=host.querySelector('[data-picture-format]')!.textContent!;
  expect(note).toContain('JPEG 30×20, CMYK (unmarked)');expect(note).toContain('plain CMYK samples are stored as-is');
 });
});

describe('picture drop and gestures',()=>{
 it('drops a picture on the sheet as a page overlay centred on the cursor',async()=>{
  render();
  await act(async()=>{drop(canvas(),'drop',[new File([PNG],'logo.png',{type:'image/png'})],60,150);});await flush();
  expect(overlay(0)).toMatchObject({kind:'image',name:'logo',naturalWidth:400,naturalHeight:200,target:'page',targetScope:'current',targetPageIds:['p'],lockAspect:true,fit:'fill'});
  // sizeImageToFit caps the 2:1 picture at 45 % of the sheet width (90×45 mm) and centres it on the cursor.
  expect(overlay(0).widthPercent).toBeCloseTo(45,6);expect(overlay(0).heightPercent).toBeCloseTo(15,6);
  expect(overlay(0).xPercent).toBeCloseTo((60-45)/200*100,6);expect(overlay(0).yPercent).toBeCloseTo((150-22.5)/300*100,6);
  expect(importFiles).not.toHaveBeenCalled();
  expect(useAppStore.getState().selectedOverlayId).toBe(overlay(0).id);
 });
 it('shows the drop hint only while a picture is over the sheet',async()=>{
  render();
  const picture=new File([PNG],'logo.png',{type:'image/png'}),scan=pdfFile();
  expect(host.textContent).not.toContain('Release to drop');                      // nothing is over the sheet yet
  drop(canvas(),'dragover',[scan]);expect(host.textContent).not.toContain('Release to drop');   // a PDF is not ours to place here
  expect(drop(canvas(),'dragover',[picture]).defaultPrevented).toBe(true);        // the sheet accepts the picture
  expect(host.textContent).toContain('Release to drop the picture');
  act(()=>canvas()!.dispatchEvent(new MouseEvent('dragleave',{bubbles:true,cancelable:true,relatedTarget:document.body})));
  expect(host.textContent).not.toContain('Release to drop');                       // leaving the sheet clears the hint
  await act(async()=>{drop(canvas(),'drop',[scan]);});await flush();
  expect(host.textContent).not.toContain('Release to drop');
 });
 it('opens a non-picture dropped on the sheet as a document instead of an overlay',async()=>{
  render();useAppStore.setState({importFiles} as never);render();
  await act(async()=>{drop(canvas(),'drop',[pdfFile()]);});await flush();
  expect(useAppStore.getState().overlays).toHaveLength(0);
  expect(importFiles).toHaveBeenCalledTimes(1);expect(importFiles.mock.calls[0][0][0].name).toBe('scan.pdf');
 });
 it('splits a mixed drop: pictures on the page, everything else as a document',async()=>{
  render();useAppStore.setState({importFiles} as never);render();
  await act(async()=>{drop(canvas(),'drop',[new File([PNG],'logo.png',{type:'image/png'}),pdfFile()],60,150);});await flush();
  expect(useAppStore.getState().overlays).toHaveLength(1);expect(overlay(0).name).toBe('logo');
  expect(importFiles.mock.calls[0][0]).toHaveLength(1);expect(importFiles.mock.calls[0][0][0].name).toBe('scan.pdf');
 });
 it('moves a picture and keeps one undo step for the whole gesture',()=>{
  act(()=>useAppStore.setState({overlays:[image()],selectedOverlayId:'i'}));render();
  const before={...overlay(0)};
  pointer(node(),'pointerdown',10,10);pointer(node(),'pointermove',30,20);pointer(node(),'pointerup',30,20);
  expect(overlay(0).xPercent).toBeGreaterThan(before.xPercent);expect(overlay(0).yPercent).toBeGreaterThan(before.yPercent);
  act(()=>useAppStore.getState().undo());expect(overlay(0)).toMatchObject({xPercent:before.xPercent,yPercent:before.yPercent});
 });
 it('keeps the millimetre ratio while resizing a locked picture and frees it with Shift',()=>{
  act(()=>useAppStore.setState({overlays:[image()],selectedOverlayId:'i'}));render();
  const handle=()=>host.querySelector<HTMLElement>('[data-text-resize="se"]')!;
  expect(ratio(overlay(0))).toBeCloseTo(2,6);                                                  // 90×45 mm, the file's own ratio
  pointer(handle(),'pointerdown',100,100);pointer(handle(),'pointermove',140,110);pointer(handle(),'pointerup',140,110);
  expect(overlay(0).widthPercent).toBeGreaterThan(45);expect(overlay(0).heightPercent).toBeGreaterThan(15);
  expect(ratio(overlay(0))).toBeCloseTo(2,6);                                                  // Shift not held → the lock holds
  expect(overlay(0).xPercent).toBeCloseTo(20,6);expect(overlay(0).yPercent).toBeCloseTo(30,6);  // the opposite corner stays put
  const grown={...overlay(0)};
  pointer(handle(),'pointerdown',100,100);pointer(handle(),'pointermove',140,100,true);pointer(handle(),'pointerup',140,100,true);
  expect(overlay(0).heightPercent).toBeCloseTo(grown.heightPercent,6);                           // Shift frees it → only the width follows
  expect(ratio(overlay(0))).not.toBeCloseTo(2,6);
  expect((field('Lock aspect ratio') as HTMLInputElement).checked).toBe(true);                 // the checkbox is the source of truth
 });
 it('lets Shift lock a free picture and follows the panel checkbox afterwards',()=>{
  act(()=>useAppStore.setState({overlays:[image({lockAspect:false})],selectedOverlayId:'i'}));render();
  const handle=()=>host.querySelector<HTMLElement>('[data-text-resize="se"]')!;
  pointer(handle(),'pointerdown',100,100);pointer(handle(),'pointermove',140,100);pointer(handle(),'pointerup',140,100);
  expect(overlay(0).widthPercent).toBeGreaterThan(45);expect(overlay(0).heightPercent).toBeCloseTo(15,6);   // free by default
  const stretched=ratio(overlay(0));expect(stretched).not.toBeCloseTo(2,6);
  pointer(handle(),'pointerdown',100,100);pointer(handle(),'pointermove',140,110,true);pointer(handle(),'pointerup',140,110,true);
  expect(overlay(0).heightPercent).toBeGreaterThan(15);expect(ratio(overlay(0))).toBeCloseTo(stretched,6);   // Shift locks it
  const lock=field('Lock aspect ratio') as HTMLInputElement;expect(lock.checked).toBe(false);
  act(()=>lock.click());expect(overlay(0).lockAspect).toBe(true);
  const grown=ratio(overlay(0));
  pointer(handle(),'pointerdown',100,100);pointer(handle(),'pointermove',140,100);pointer(handle(),'pointerup',140,100);
  expect(ratio(overlay(0))).toBeCloseTo(grown,6);expect(overlay(0).heightPercent).toBeGreaterThan(15);       // unlocked by the panel, so Shift is free again
 });
 it('rotates with the knob and snaps to 15° while Shift is held',()=>{
  act(()=>useAppStore.setState({overlays:[image({rotation:0})],selectedOverlayId:'i'}));render();rect(node(),90,45);
  const knob=()=>host.querySelector<HTMLElement>('[data-text-rotate]')!;
  pointer(knob(),'pointerdown',145,22.5);pointer(knob(),'pointermove',45,-57.5);pointer(knob(),'pointerup',45,-57.5);   // straight up from the centre
  expect(overlay(0).rotation).toBeCloseTo(270,4);
  act(()=>useAppStore.setState({overlays:[image({rotation:0})]}));
  const second=knob();
  pointer(second,'pointerdown',145,22.5);pointer(second,'pointermove',200,-57.5);pointer(second,'pointerup',200,-57.5); // an awkward angle
  expect(overlay(0).rotation).not.toBeCloseTo(Math.round(overlay(0).rotation/15)*15,4);
  act(()=>useAppStore.setState({overlays:[image({rotation:0})]}));
  const third=host.querySelector<HTMLElement>('[data-text-rotate]')!;
  pointer(third,'pointerdown',145,22.5);pointer(third,'pointermove',200,-57.5,true);pointer(third,'pointerup',200,-57.5,true);
  expect(overlay(0).rotation%15).toBeCloseTo(0,6);
 });
 it('nudges a picture by a millimetre, five with Shift',()=>{
  act(()=>useAppStore.setState({overlays:[image()],selectedOverlayId:'i'}));render();
  const key=(keyName:string,shift=false)=>act(()=>node().dispatchEvent(new KeyboardEvent('keydown',{key:keyName,bubbles:true,shiftKey:shift})));
  key('ArrowRight');expect(overlay(0).xPercent).toBeCloseTo(20+0.5,6);   // 1 mm of a 200 mm sheet
  key('ArrowDown',true);expect(overlay(0).yPercent).toBeCloseTo(30+5/300*100,6);
  key('ArrowLeft');expect(overlay(0).xPercent).toBeCloseTo(20,6);
 });
 it('previews, clips and repeats pictures through the shared placement engine',()=>{
  act(()=>useAppStore.setState({overlays:[image({target:'page',targetScope:'odd',targetPageIds:[]})]}));render();
  const state=useAppStore.getState(),sheets=computeImpositionSheets(state.pages,state.layout);
  expect(imagePlacements(sheets[0],sheets.length,state.pages,state.overlays)).toHaveLength(1);
  expect(host.querySelector('img')).toBeTruthy();
 });
});

describe('picture panel',()=>{
 const seed=(item:PageOverlayImage)=>{act(()=>useAppStore.setState({overlays:[item],selectedOverlayId:item.id}));render();};
 const setValue=(el:HTMLInputElement,value:string)=>act(()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});
 it('edits millimetres with the ratio locked, then freely after unlocking',()=>{
  seed(image());
  const width=field('Image width') as HTMLInputElement,height=field('Image height') as HTMLInputElement;
  setValue(width,'100');expect(boxMm(overlay(0)).width).toBeCloseTo(100,6);expect(boxMm(overlay(0)).height).toBeCloseTo(50,6);
  setValue(height,'60');expect(boxMm(overlay(0)).height).toBeCloseTo(60,6);expect(boxMm(overlay(0)).width).toBeCloseTo(120,6);
  act(()=>(field('Lock aspect ratio') as HTMLInputElement).click());
  setValue(height,'30');expect(boxMm(overlay(0)).height).toBeCloseTo(30,6);expect(boxMm(overlay(0)).width).toBeCloseTo(120,6);
 });
 it('flips, letterboxes, turns and fades the picture',()=>{
  seed(image());
  click('Flip H');expect(overlay(0).flipHorizontal).toBe(true);
  click('Flip V');expect(overlay(0).flipVertical).toBe(true);
  const fit=field('Fit') as HTMLSelectElement;act(()=>{fit.value='contain';fit.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(overlay(0).fit).toBe('contain');expect(host.querySelector('img')).toBeTruthy();
  [...host.querySelectorAll('button')].find(b=>b.textContent==='90°')!.click();
  setValue(field('Image rotation') as HTMLInputElement,'45');expect(overlay(0).rotation).toBe(45);
  setValue(field('Image opacity') as HTMLInputElement,'60');expect(overlay(0).opacity).toBeCloseTo(0.6,6);
 });
 it('re-attaches a picture to a page, to a sheet and to a chosen range',()=>{
  seed(image({target:'sheet',targetScope:'all'}));
  const target=field('Image target') as HTMLSelectElement;act(()=>{target.value='page';target.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(overlay(0)).toMatchObject({target:'page',targetScope:'all',targetPageIds:[]});                 // the scope survives the switch
  const scope=field('Image scope') as HTMLSelectElement;act(()=>{scope.value='current';scope.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(overlay(0)).toMatchObject({targetScope:'current',targetPageIds:['p']});
  act(()=>{scope.value='selected';scope.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(overlay(0).targetScope).toBe('selected');
  const range=field('Image range') as HTMLInputElement;setValue(range,'2');click('Apply range');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('valid numbers');expect(overlay(0).targetPageIds).toEqual(['p']);
  setValue(range,'1');click('Apply range');
  expect(overlay(0).targetPageIds).toEqual(['p']);expect(host.querySelector('[role="alert"]')).toBeNull();
 });
 it('copies a picture and deletes it again with undo',()=>{
  seed(image());click('+ Copy');expect(useAppStore.getState().overlays).toHaveLength(2);
  expect(overlay(1)).toMatchObject({xPercent:25,yPercent:35});
  click('Delete picture');expect(useAppStore.getState().overlays).toHaveLength(1);
  act(()=>useAppStore.getState().undo());expect(useAppStore.getState().overlays).toHaveLength(2);
 });
 it('adds a picture from the Insert ribbon at the centre of the current page',async()=>{
  act(()=>root.render(React.createElement(Ribbon)));
  const button=field('Add picture on the page');expect(button).toBeTruthy();
  const picker=host.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
  Object.defineProperty(picker,'files',{value:[new File([PNG],'stamp.png',{type:'image/png'})]});
  await act(async()=>{picker.dispatchEvent(new Event('change',{bubbles:true}));});await flush();
  expect(useAppStore.getState().overlays).toHaveLength(1);
  expect(overlay(0)).toMatchObject({name:'stamp',target:'page',targetPageIds:['p'],lockAspect:true});
  expect(overlay(0).xPercent).toBeCloseTo(27.5,6);expect(overlay(0).yPercent).toBeCloseTo(42.5,6);    // centred on the page box
 });
 it('locks the aspect ratio of page numbers by default and frees it on demand',()=>{
  act(()=>useAppStore.getState().addNumberingOverlay());
  const numbering=useAppStore.getState().overlays.find(o=>o.kind==='numbering') as PageOverlayNumbering;
  expect(numbering.lockAspect).toBe(true);
  act(()=>useAppStore.setState({overlays:[image({lockAspect:false})],selectedOverlayId:'i'}));render();
  expect((field('Lock aspect ratio') as HTMLInputElement).checked).toBe(false);
 });
});
