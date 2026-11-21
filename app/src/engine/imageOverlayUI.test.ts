// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PageItem,PageOverlayImage,PageOverlayNumbering} from '@shared/models';
import {PreviewWorkspace} from '../components/PreviewWorkspace';
import {ImageControlPanel} from '../components/ImageControlPanel';
import {Ribbon} from '../components/Ribbon';
import {TopToolRibbon} from '../components/TopToolRibbon';
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
    eraseTool:'off',eraseBrushMm:8,eraseColor:null,erasePending:null,
    activeSheetIndex:0,activeRibbonTab:'insert',viewMode:'single'});
  importFiles=vi.fn(async()=>{});
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

function render(){act(()=>root.render(React.createElement(React.Fragment,null,
  React.createElement(TopToolRibbon),React.createElement(PreviewWorkspace,{onCursorMoveMm:()=>{}}),React.createElement(ImageControlPanel))));rect(canvas(),200,300);}

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

describe('a picture on a grid',()=>{
 const four=[1,2,3,4].map(i=>({...page,id:`p${i}`,sourcePageNumber:i,isHighlighted:i===1}));
 const gridLayout=()=>({...DEFAULT_LAYOUT,paperSize:'Custom' as const,customWidthMm:200,customHeightMm:300,rows:2,cols:2,sheetOrder:'ltr' as const,
   duplexMode:'none' as const,marginMode:'custom' as const,marginsMm:{top:0,right:0,bottom:0,left:0},horizontalGutterMm:0,verticalGutterMm:0,autoRotateToFit:false,showCellBorders:false,rulerGuides:[]});
 const placements=()=>imagePlacements(computeImpositionSheets(four,gridLayout())[0],1,four,useAppStore.getState().overlays);

 it('drops onto the whole sheet once, not into every cell',async()=>{
  act(()=>useAppStore.setState({pages:four,layout:gridLayout()}));
  render();
  const cell=computeImpositionSheets(four,gridLayout())[0].cells[0];
  rect(canvas(),200,300);
  drop(canvas(),'drop',[new File([PNG],'logo.png',{type:'image/png'})],cell.contentXMm+1,cell.contentYMm+1);
  await flush();
  const placed=overlay(0);
  expect(placed.target).toBe('sheet');
  expect(placements()).toHaveLength(1);                                            // one logo on the printed side
  expect(field('Image placement')).toBeTruthy();
 });

 it('repeats into every cell only when the panel is told to',async()=>{
  useAppStore.setState({pages:four,layout:gridLayout(),overlays:[image({target:'sheet',targetScope:'all'})],selectedOverlayId:'i'});
  render();
  expect(placements()).toHaveLength(1);
  const placement=field('Image placement') as HTMLSelectElement;
  expect([...placement.options].map(o=>o.value)).toEqual(['whole','each-cell']);
  act(()=>{placement.value='each-cell';placement.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(overlay(0).sheetFill).toBe('each-cell');
  act(()=>{rect(canvas(),200,300);});
  expect(placements()).toHaveLength(4);                                            // one per populated cell
 });

 it('says when a picture belongs to one cell instead of the sheet',()=>{
  useAppStore.setState({pages:four,layout:gridLayout(),overlays:[image({target:'page',targetPageIds:['p1'],targetScope:'current'})],selectedOverlayId:'i'});
  render();
  expect(host.textContent).toContain('This picture sits in one cell, not on the sheet');
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
 it('lets a picture hang over the page edge, as far as its centre stays on the sheet',()=>{
  // The old rule kept the whole box inside the page, so a logo could never reach the trim line and a
  // bleed was impossible. The centre is the limit now: half the picture may leave, all of it may not.
  act(()=>useAppStore.setState({overlays:[image()],selectedOverlayId:'i'}));render();
  pointer(node(),'pointerdown',10,10);pointer(node(),'pointermove',4000,4000);pointer(node(),'pointerup',4000,4000);
  expect(overlay(0).xPercent).toBeCloseTo(100-45/2,4);
  expect(overlay(0).yPercent).toBeCloseTo(100-15/2,4);
  expect(overlay(0).xPercent+overlay(0).widthPercent).toBeGreaterThan(100);
  expect(overlay(0).widthPercent).toBeCloseTo(45,6);expect(overlay(0).heightPercent).toBeCloseTo(15,6);   // only the position moved
  // Arrow keys obey the same rule, so nudging into the margin works the way dragging does.
  act(()=>useAppStore.setState({overlays:[image({xPercent:70,yPercent:30})],selectedOverlayId:'i'}));render();
  const key=(keyName:string)=>act(()=>node().dispatchEvent(new KeyboardEvent('keydown',{key:keyName,bubbles:true})));
  key('ArrowRight');key('ArrowRight');
  expect(overlay(0).xPercent).toBeGreaterThan(100-45);        // past the old clamp, still on the sheet
  expect(overlay(0).xPercent+overlay(0).widthPercent).toBeGreaterThan(100);
 });

 it('puts the picture where the millimetre fields say, including outside the box',()=>{
  // The drag is limited so a lost picture stays grabbable; a typed number is an explicit decision and is
  // not argued with. These two fields are also the only way to put a logo at an exact offset from the trim.
  act(()=>useAppStore.setState({overlays:[image()],selectedOverlayId:'i'}));render();
  const setNumber=(label:string,value:number)=>{
    const el=host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
    act(()=>{setter.call(el,String(value));el.dispatchEvent(new Event('input',{bubbles:true}));});
  };
  setNumber('Image X',-20);
  expect(overlay(0).xPercent).toBeCloseTo(-10,4);            // 200 mm wide box → -20 mm is -10 %
  setNumber('Image Y',310);
  expect(overlay(0).yPercent).toBeCloseTo(103.333,2);        // past the bottom edge, on purpose
  expect(overlay(0).widthPercent).toBeCloseTo(45,6);         // only the position moved
 });

 it('lines a picture up with the same edges it can be dragged to',()=>{
  act(()=>useAppStore.setState({overlays:[image()],selectedOverlayId:'i'}));render();
  const align=(where:string)=>act(()=>host.querySelector<HTMLButtonElement>(`[data-image-align="${where}"]`)!.click());
  align('right');
  expect(overlay(0).xPercent).toBeCloseTo(55,4);             // 100 - its own 45
  align('bottom');
  expect(overlay(0).yPercent).toBeCloseTo(85,4);
  align('hcenter');align('vcenter');
  expect(overlay(0)).toMatchObject({xPercent:27.5,yPercent:42.5});
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
 // ————— the eraser in the Insert tool: two modes, both of them reversible —————
 const img=()=>node().querySelector('img')!;
 const eraseButton=(mode:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('data-erase-tool')===mode)!;
 const picture=(index=0)=>useAppStore.getState().overlays[index] as PageOverlayImage;
 const stroke=(index=0)=>picture().erase?.[index] as {points:{x:number;y:number}[];radiusMm:number}|undefined;
 // The picture box is 45 % of a 200×300 mm sheet at one pixel per millimetre: 90×45 px, so a pointer at
 // (9, 4.5) sits at 10 % × 10 % of the artwork. That is the number the model has to hold.
 function armErase(mode:'brush'|'region'|'picker'){
  act(()=>useAppStore.setState({overlays:[image()],selectedOverlayId:'i'}));render();rect(img(),90,45);act(()=>eraseButton(mode).click());
  expect(useAppStore.getState().eraseTool).toBe(mode);                              // the Insert button armed it, not a leftover
 }
 it('takes the sheet out of the crop tool when the eraser is armed',()=>{
  // The overlay layer only accepts the pointer in the move tool, so a brush armed while the sheet is in crop
  // mode would paint nothing at all and look like a dead button.
  useAppStore.setState({overlays:[image()],selectedOverlayId:'i'});render();rect(img(),90,45);
  act(()=>{[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')==='Crop')!.click();});
  expect(host.querySelector('[aria-label="Crop"]')!.getAttribute('aria-pressed')).toBe('true');
  act(()=>eraseButton('brush').click());
  expect(host.querySelector('[aria-label="Crop"]')!.getAttribute('aria-pressed')).toBe('false');
  expect(useAppStore.getState().canvasTool).toBe('move');
  pointer(node(),'pointerdown',9,4.5);pointer(node(),'pointermove',45,22.5);pointer(node(),'pointerup',45,22.5);
  expect(picture().erase).toHaveLength(1);
 });

 it('erases along the brush and leaves the picture file alone',()=>{
  armErase('brush');
  expect(eraseButton('brush').getAttribute('aria-pressed')).toBe('true');
  // The arrow is gone and the brush itself stands in for it: a ring at the diameter the panel says, in mm.
  const ringEl=host.querySelector<HTMLElement>('[data-brush-cursor]')!;
  expect(ringEl).toBeTruthy();
  expect(node().getAttribute('style')).toContain('cursor: none');
  // The ring is the cursor: it is the brush diameter at the sheet's own scale, and it is where the pointer is
  // before anything is drawn. While a stroke is held it must not vanish when the edge is crossed.
  expect(ringEl.style.borderRadius).toBe('50%');
  const ringPx=parseFloat(ringEl.style.width);
  expect(ringPx>0).toBe(true);                                                      // the ring has a size at the sheet's scale
  expect(ringEl.style.left).toBe('-9999px');                                        // and it waits until the pointer arrives
  pointer(node(),'pointerover',20,10);                                              // React synthesises `enter` from `over`
  expect(ringEl.style.left).toBe('20px');expect(ringEl.style.top).toBe('10px');
  act(()=>useAppStore.getState().setEraseBrushMm(16));
  expect(parseFloat(host.querySelector<HTMLElement>('[data-brush-cursor]')!.style.width)).toBeCloseTo(ringPx*2,6);
  expect(host.querySelector<HTMLElement>('[data-brush-cursor]')!.style.left).toBe('20px');
  act(()=>useAppStore.getState().setEraseBrushMm(8));                               // back to the default for the stroke below
  pointer(node(),'pointerdown',9,4.5);
  pointer(node(),'pointerout',9,4.5);
  expect(ringEl.style.left).toBe('9px');                                            // still on, because the button is down

  expect(img().getAttribute('style')).toContain('mask');                           // the hole appears while the button is down
  expect(picture().erase).toBeUndefined();                                         // …but nothing is stored mid-gesture
  pointer(node(),'pointermove',45,22.5);pointer(node(),'pointerup',45,22.5);
  // The stroke starts under the pointer, ends where it was released, and carries the samples in between: a gap
  // between them is exactly what used to be drawn as a row of dots. The ends are the exact geometry; the fill
  // between them is what keeps the line continuous at the speed of the hand.
  const painted=stroke()!;
  expect(painted.points[0]).toEqual({x:10,y:10});
  expect(painted.points[painted.points.length-1]).toEqual({x:50,y:50});
  expect(painted.points.length).toBeGreaterThan(2);
  for(let i=1;i<painted.points.length;i++){
    expect(Math.hypot(painted.points[i]!.x-painted.points[i-1]!.x,painted.points[i]!.y-painted.points[i-1]!.y)).toBeLessThan(10);
  }
  expect(painted.radiusMm).toBe(4);                                              // the 8 mm default is a diameter
  expect(picture().src).toBe('data:image/png;base64,AAA');                          // erased, never rewritten
  expect(picture().xPercent).toBe(20);expect(picture().yPercent).toBe(30);          // the eraser ate the drag, not the position
  expect(img().getAttribute('style')).toContain('mask');
 });
 it('gives one gesture back per undo, and the panel button restores the whole picture',()=>{
  armErase('brush');
  pointer(node(),'pointerdown',9,4.5);pointer(node(),'pointermove',45,22.5);pointer(node(),'pointerup',45,22.5);
  pointer(node(),'pointerdown',70,30);pointer(node(),'pointermove',85,40);pointer(node(),'pointerup',85,40);
  expect(picture().erase).toHaveLength(2);
  act(()=>{const undo=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.hasAttribute('data-erase-undo'))!;undo.click();});
  expect(picture().erase).toHaveLength(1);
  act(()=>{const restore=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.hasAttribute('data-erase-restore'))!;restore.click();});
  expect(picture().erase).toBeUndefined();
  expect(picture().src).toBe('data:image/png;base64,AAA');
 });
 it('draws a region that only the Delete key spends on the picture',()=>{
  armErase('region');
  pointer(node(),'pointerdown',9,4.5);pointer(node(),'pointermove',45,22.5);
  // A marquee reads as a marquee while it is being drawn — an outline, not a preview of the hole it would cut.
  expect(Boolean(host.querySelector('[data-erase-selection]'))).toBe(true);
  pointer(node(),'pointerup',45,22.5);
  // The drag selects, it does not destroy: until the key is pressed the picture still holds every pixel.
  expect(picture().erase).toBeUndefined();
  expect(useAppStore.getState().erasePending).toEqual({overlayId:'i',shape:{mode:'region',x:10,y:10,width:40,height:40}});
  expect(Boolean(host.querySelector('[data-erase-selection]'))).toBe(true);       // the marquee waits in plain sight
  expect(picture().widthPercent).toBe(45);expect(picture().heightPercent).toBe(15);
  // The global listener in `App` asks the store first, so this is exactly the call that key makes.
  act(()=>expect(useAppStore.getState().spendEraseKey('Delete')).toBe(true));
  expect(picture().erase).toEqual([{mode:'region',x:10,y:10,width:40,height:40}]);
  expect(useAppStore.getState().erasePending).toBeNull();
  expect(Boolean(host.querySelector('[data-erase-selection]'))).toBe(false);
  // `Delete` spent on the marquee is not `Delete` spent on the layer: the picture is still there.
  expect(useAppStore.getState().overlays).toHaveLength(1);
  pointer(node(),'pointerdown',50,30);pointer(node(),'pointermove',80,40);pointer(node(),'pointerup',80,40);
  act(()=>expect(useAppStore.getState().spendEraseKey('Escape')).toBe(true));      // Esc throws the marquee away
  expect(useAppStore.getState().erasePending).toBeNull();
  expect(picture().erase).toHaveLength(1);
  // With nothing waiting, the same keys go back to the app: the second one would have deleted the layer.
  act(()=>expect(useAppStore.getState().spendEraseKey('Delete')).toBe(false));
 });
 it('keeps the region eraser destructive even when the brush has a paint colour',()=>{
  armErase('region');
  act(()=>useAppStore.getState().setEraseColor('#102030'));
  pointer(node(),'pointerdown',9,4.5);pointer(node(),'pointermove',45,22.5);pointer(node(),'pointerup',45,22.5);
  act(()=>expect(useAppStore.getState().spendEraseKey('Delete')).toBe(true));
  expect(picture().erase).toEqual([{mode:'region',x:10,y:10,width:40,height:40}]);
 });
 it('applies a waiting marquee from the panel, for a hand that stays on the mouse',()=>{
  armErase('region');
  pointer(node(),'pointerdown',9,4.5);pointer(node(),'pointermove',45,22.5);pointer(node(),'pointerup',45,22.5);
  expect(Boolean(host.querySelector('[data-erase-pending]'))).toBe(true);
  act(()=>{host.querySelector<HTMLButtonElement>('[data-erase-apply]')!.click();});
  expect(picture().erase).toEqual([{mode:'region',x:10,y:10,width:40,height:40}]);
  expect(useAppStore.getState().erasePending).toBeNull();
  expect(Boolean(host.querySelector('[data-erase-pending]'))).toBe(false);
 });
 it('paints the chosen colour instead of cutting a hole, and the eyedropper picks it',()=>{
  armErase('brush');
  const colour=host.querySelector<HTMLInputElement>('[data-erase-color][type="color"]')!;
  expect(Boolean(colour)).toBe(true);
  setValue(colour,'#102030');
  expect(useAppStore.getState().eraseColor).toBe('#102030');
  pointer(node(),'pointerdown',9,4.5);pointer(node(),'pointermove',45,22.5);pointer(node(),'pointerup',45,22.5);
  // The gesture is the same shape, only with paint on it — and the preview lays colour *over* the picture
  // rather than masking it away, which is the visible difference between the two modes.
  expect(stroke()).toMatchObject({mode:'brush',color:'#102030'});
  expect(Boolean(host.querySelector('[data-image-paint]'))).toBe(true);
  expect(host.querySelector('[data-brush-cursor]')!.getAttribute('style')).toContain('rgb(16, 32, 48)');
  act(()=>{const hole=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('data-erase-color')==='hole')!;hole.click();});
  expect(useAppStore.getState().eraseColor).toBeNull();
  pointer(node(),'pointerdown',60,10);pointer(node(),'pointermove',80,30);pointer(node(),'pointerup',80,30);
  expect((picture().erase?.[1] as {color?:string}).color).toBeUndefined();         // a hole again, not a leftover colour
 });
 // jsdom has no Canvas 2D, so the context is replaced by one that hands back a flat field of one colour and
 // reports the box it was asked for. What is under test is the mapping: pointer → percentage → artwork pixel →
 // the brush's own footprint, and the colour the brush ends up carrying.
 function fakeContext(fill:[number,number,number,number],asked:number[]){
  const original=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=(function getContext(){
    return {drawImage(){},getImageData(x:number,y:number,width:number,height:number){
      asked.push(x,y,width,height);
      const data=new Uint8ClampedArray(Math.max(1,width)*Math.max(1,height)*4);
      for(let i=0;i<data.length;i+=4){data[i]=fill[0];data[i+1]=fill[1];data[i+2]=fill[2];data[i+3]=fill[3];}
      return {data};
    }};
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  return ()=>{HTMLCanvasElement.prototype.getContext=original;};
 }
 it('takes the colour of the area under the pointer as the brush colour',()=>{
  const asked:number[]=[];const restore=fakeContext([0x12,0x34,0x56,0xff],asked);
  try{
    armErase('picker');
    expect(node().getAttribute('style')).toContain('cursor: copy');
    pointer(node(),'pointerdown',9,4.5);                                            // 10 % × 10 % of the picture
  } finally { restore(); }
  // A 400 px file across a 90 mm box, an 8 mm brush → a 16 px radius around (40, 20), kept inside the file.
  expect(asked).toEqual([24,4,33,33]);
  expect(useAppStore.getState().eraseColor).toBe('#123456');
  expect(useAppStore.getState().eraseTool).toBe('brush');                           // and the brush is armed for the stroke
  const fine:number[]=[];
  act(()=>useAppStore.getState().setEraseBrushMm(0.2));
  const restore2=fakeContext([0x12,0x34,0x56,0xff],fine);
  try{ act(()=>useAppStore.getState().setEraseTool('picker')); pointer(node(),'pointerdown',9,4.5); } finally { restore2(); }
  expect(fine).toEqual([40,20,1,1]);                                              // a hairline brush samples a pixel
 });
 it('refuses to invent a colour when the eyedropper lands on an empty spot',()=>{
  const asked:number[]=[];const restore=fakeContext([0,0,0,0],asked);              // every pixel transparent
  try{ armErase('picker'); pointer(node(),'pointerdown',9,4.5); } finally { restore(); }
  expect(asked.length).toBe(4);
  expect(useAppStore.getState().eraseColor).toBeNull();                             // white would be a guess
  expect(useAppStore.getState().toasts.at(-1)?.title).toContain('empty');
 });
 it('leaves a click without travel as a click, and turns itself off when pressed again',()=>{
  armErase('region');
  pointer(node(),'pointerdown',9,4.5);pointer(node(),'pointerup',9,4.5);
  expect(picture().erase).toBeUndefined();
  expect(useAppStore.getState().eraseTool).toBe('region');                          // still armed, nothing lost
  act(()=>eraseButton('region').click());
  expect(useAppStore.getState().eraseTool).toBe('off');
  expect(eraseButton('region').getAttribute('aria-pressed')).toBe('false');
  pointer(node(),'pointerdown',10,10);pointer(node(),'pointermove',30,20);pointer(node(),'pointerup',30,20);
  expect(picture().xPercent).toBeGreaterThan(20);                                   // the drag moves the picture again
 });
 it('paints through a mirrored picture so the hole follows the artwork, not the glass',()=>{
  act(()=>useAppStore.setState({overlays:[image({flipHorizontal:true})],selectedOverlayId:'i'}));render();rect(img(),90,45);
  act(()=>eraseButton('brush').click());
  pointer(node(),'pointerdown',9,4.5);pointer(node(),'pointermove',45,22.5);pointer(node(),'pointerup',45,22.5);
  const xs=stroke()!.points.map(p=>p.x);
  expect(xs[0]).toBe(90);expect(xs[xs.length-1]).toBe(50);                           // 10 % and 50 % seen in the mirror
  expect(xs.every(x=>x<=90&&x>=50)).toBe(true);                                      // and the path stays between them
 });
 it('inverts the picture on one press and undoes it on the next',()=>{
  act(()=>useAppStore.setState({overlays:[image()],selectedOverlayId:'i'}));render();
  const invert=()=>act(()=>{[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.hasAttribute('data-image-invert'))!.click();});
  invert();
  expect(picture().invert).toBe(true);expect(img().getAttribute('style')).toContain('invert(1)');
  invert();
  expect(picture().invert).toBe(false);expect(img().getAttribute('style')??'').not.toContain('invert(1)');
 });

 it('arms the eyedropper and the brush colour from the Insert tab',()=>{
  // The Insert tab owns the whole eraser, so the two new controls have to be reachable there too — a colour
  // that only the panel offers would leave a picture with no panel open unpaintable.
  useAppStore.setState({overlays:[image()],selectedOverlayId:'i'});render();
  act(()=>root.render(React.createElement(Ribbon)));
  const ribbon=(mode:string)=>[...host.querySelectorAll<HTMLButtonElement>('[data-erase-tool]')].find(b=>b.getAttribute('data-erase-tool')===mode)!;
  expect(ribbon('picker')).toBeTruthy();
  act(()=>ribbon('picker').click());
  expect(useAppStore.getState().eraseTool).toBe('picker');
  // The colour field only exists while a tool is armed; the eyedropper is a tool, so it counts.
  const colour=host.querySelector<HTMLInputElement>('[data-erase-color][type="color"]')!;
  expect(colour).toBeTruthy();
  setValue(colour,'#0a141e');
  expect(useAppStore.getState().eraseColor).toBe('#0a141e');
  act(()=>ribbon('picker').click());                                               // pressed twice: out of the tool
  expect(useAppStore.getState().eraseTool).toBe('off');
  expect(useAppStore.getState().eraseColor).toBe('#0a141e');                        // the colour is a setting, not a mode
 });
 it('arms the eraser from the Insert tab and takes the brush size from its field',()=>{
  // The tool lives in the Insert tab because it edits what Insert puts on the sheet. Both halves of the
  // switch are the same store the picture panel uses, so neither place can disagree with the other.
  useAppStore.setState({overlays:[image()],selectedOverlayId:'i'});render();
  act(()=>root.render(React.createElement(Ribbon)));
  const ribbon=(mode:string)=>[...host.querySelectorAll<HTMLButtonElement>('[data-erase-tool]')].find(b=>b.getAttribute('data-erase-tool')===mode)!;
  act(()=>ribbon('brush').click());
  expect(useAppStore.getState().eraseTool).toBe('brush');
  expect(ribbon('brush').getAttribute('aria-pressed')).toBe('true');
  const size=host.querySelector<HTMLInputElement>('[aria-label="Eraser diameter in millimetres"]')!;
  expect(size).toBeTruthy();                                                      // the size appears with the tool, not beside it
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  act(()=>{setter.call(size,'24');size.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(useAppStore.getState().eraseBrushMm).toBe(24);
  act(()=>ribbon('brush').click());
  expect(useAppStore.getState().eraseTool).toBe('off');                            // pressing the lit button again is the way out
  act(()=>ribbon('region').click());
  expect(useAppStore.getState().eraseTool).toBe('region');
  expect(host.querySelector('[aria-label="Eraser diameter in millimetres"]')).not.toBeNull();
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
