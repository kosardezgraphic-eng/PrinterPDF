// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PageItem} from '@shared/models';
import {PreviewWorkspace} from '../components/PreviewWorkspace';
import {rulerTicks,rulerMinorTicks} from '../components/RulerGuides';
import {DEFAULT_LAYOUT,DEFAULT_SETTINGS,useAppStore} from '../store/useAppStore';
import {computeImpositionSheets} from './layoutEngine';
import {ipcBridge} from './ipcBridge';
const page:PageItem={id:'p',documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:100,heightMm:200,rotation:0,selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0};
const rect=(left:number,top:number,width:number,height:number)=>({x:left,y:top,left,top,width,height,right:left+width,bottom:top+height,toJSON:()=>({})});
let host:HTMLDivElement, root:Root, frames:Map<number,FrameRequestCallback>,frameId:number;
function pointer(el:Element,type:string,x:number,y:number,pointerType='mouse'){
 const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});Object.defineProperties(event,{pointerId:{value:1},pointerType:{value:pointerType}});act(()=>el.dispatchEvent(event));
}
function flush(){act(()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(cb=>cb(0));});}
function guide(){return host.querySelector<HTMLButtonElement>('[data-ruler-guide]')!;}
function setupRects(){
 const paper=host.querySelector<HTMLElement>('[data-sheet-canvas-index]')!.parentElement!;
 vi.spyOn(paper,'getBoundingClientRect').mockReturnValue(rect(100,50,400,600));
 vi.spyOn(host.querySelector<HTMLElement>('[data-sheet-ruler="x"]')!,'getBoundingClientRect').mockReturnValue(rect(100,26,400,20));
 vi.spyOn(host.querySelector<HTMLElement>('[data-sheet-ruler="y"]')!,'getBoundingClientRect').mockReturnValue(rect(72,50,24,600));
}
beforeEach(()=>{
 (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 Object.defineProperty(HTMLElement.prototype,'setPointerCapture',{configurable:true,value:vi.fn()});
 frames=new Map();frameId=0;
 vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{const id=++frameId;frames.set(id,cb);return id;});
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
 useAppStore.setState({pages:[page],documents:[],layout:{...DEFAULT_LAYOUT,paperSize:'Custom',customWidthMm:200,customHeightMm:300,duplexMode:'none',rulerGuides:[]},settings:{...DEFAULT_SETTINGS,language:'en',unit:'mm'},activeSheetIndex:0,viewMode:'single',showRulers:true,selectedPrinterName:''});
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);act(()=>root.render(React.createElement(PreviewWorkspace,{onCursorMoveMm:()=>{}})));setupRects();
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('sheet ruler guides',()=>{
 it('drags a vertical guide from the top ruler and commits only on pointerup',()=>{
   const original=useAppStore.getState().layout;const ruler=host.querySelector('[data-sheet-ruler="x"]')!;
   pointer(ruler,'pointerdown',200,30);pointer(ruler,'pointermove',200,250);flush();
   expect(useAppStore.getState().layout).toBe(original);
   expect(host.querySelector('[data-guide-ghost] [data-ruler-guide-label]')?.textContent).toBe('50 mm');
   pointer(ruler,'pointerup',200,250);
   expect(useAppStore.getState().layout.rulerGuides).toMatchObject([{axis:'x',positionMm:50}]);
   expect(guide().style.left).toBe('25%');expect(guide().getAttribute('aria-label')).toContain('50 mm');
   act(()=>useAppStore.getState().undo());expect(host.querySelector('[data-ruler-guide]')).toBeNull();
   act(()=>useAppStore.getState().redo());expect(guide().style.left).toBe('25%');
 });
 it('creates a horizontal line using touch and deletes it only by dropping on its ruler',()=>{
   const ruler=host.querySelector('[data-sheet-ruler="y"]')!;
   pointer(ruler,'pointerdown',80,250,'touch');pointer(ruler,'pointermove',300,250,'touch');pointer(ruler,'pointerup',300,250,'touch');
   expect(useAppStore.getState().layout.rulerGuides).toMatchObject([{axis:'y',positionMm:100}]);
   const line=guide();pointer(line,'pointerdown',300,250,'touch');pointer(line,'pointermove',80,300,'touch');flush();
   expect(line.querySelector('[data-ruler-guide-label]')?.textContent).toBe('125 mm');expect(line.hasAttribute('data-dragging')).toBe(true);
   pointer(line,'pointerup',80,300,'touch');expect(useAppStore.getState().layout.rulerGuides).toEqual([]);
   act(()=>useAppStore.getState().undo());expect(useAppStore.getState().layout.rulerGuides).toMatchObject([{axis:'y',positionMm:100}]);
 });
 it('moves without jumping, cancels on pointercancel and ignores outside drops',()=>{
   act(()=>useAppStore.getState().addRulerGuide({id:'a',axis:'x',positionMm:50}));
   const line=guide();pointer(line,'pointerdown',204,200);pointer(line,'pointermove',224,200);flush();
   expect(line.style.left).toBe('30%');expect(line.querySelector('[data-ruler-guide-label]')?.textContent).toBe('60 mm');
   pointer(line,'pointercancel',224,200);expect(line.style.left).toBe('25%');expect(useAppStore.getState().layout.rulerGuides?.[0].positionMm).toBe(50);
   pointer(line,'pointerdown',200,200);pointer(line,'pointerup',700,200);expect(useAppStore.getState().layout.rulerGuides?.[0].positionMm).toBe(50);
   pointer(line,'pointerdown',200,200);pointer(line,'pointermove',240,200);pointer(line,'pointerup',240,200);
   expect(useAppStore.getState().layout.rulerGuides?.[0].positionMm).toBe(70);
   act(()=>useAppStore.getState().undo());expect(useAppStore.getState().layout.rulerGuides?.[0].positionMm).toBe(50);
 });
 it('updates labels and true ruler tick values between mm and cm without moving guides',()=>{
   act(()=>useAppStore.getState().addRulerGuide({id:'a',axis:'x',positionMm:50}));
   const selector=host.querySelector<HTMLSelectElement>('[aria-label="Ruler unit"]')!;
   expect(host.querySelector('[data-sheet-ruler="x"] [data-ruler-tick="20"]')?.textContent).toBe('20');
   act(()=>{selector.value='cm';selector.dispatchEvent(new Event('change',{bubbles:true}));});
   expect(guide().getAttribute('aria-label')).toContain('5 cm');expect(host.querySelector('[data-sheet-ruler="x"] [data-ruler-tick="20"]')?.textContent).toBe('2');
   expect(useAppStore.getState().layout.rulerGuides?.[0].positionMm).toBe(50);
 });
 it('supports keyboard creation, arrow movement and deletion',()=>{
   const ruler=host.querySelector('[data-sheet-ruler="x"]')!;
   act(()=>ruler.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
   expect(useAppStore.getState().layout.rulerGuides?.[0].positionMm).toBe(100);
   act(()=>guide().dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true})));
   expect(useAppStore.getState().layout.rulerGuides?.[0].positionMm).toBe(101);
   act(()=>guide().dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true})));
   expect(useAppStore.getState().layout.rulerGuides).toEqual([]);
 });
 it('does not affect imposition or page selections and hides guides beyond paper edges',()=>{
   const before=computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout);
   act(()=>useAppStore.getState().addRulerGuide({id:'a',axis:'x',positionMm:220}));
   expect(host.querySelector('[data-ruler-guide]')).toBeNull();
   expect(computeImpositionSheets(useAppStore.getState().pages,useAppStore.getState().layout)).toEqual(before);
   expect(useAppStore.getState().pages[0].selectedForPrint).toBe(true);
 });
 it('shows the same physical guides on other sheets and restores them with projects',async()=>{
   act(()=>useAppStore.setState({pages:[page,{...page,id:'p2'}],viewMode:'double',layout:{...useAppStore.getState().layout,rows:1,cols:1}}));
   act(()=>useAppStore.getState().addRulerGuide({id:'shared',axis:'x',positionMm:50}));
   expect(host.querySelectorAll('[data-ruler-guide="shared"]')).toHaveLength(2);
   const save=vi.spyOn(ipcBridge,'saveAutoSaveSession').mockResolvedValue(true);
   vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:project'),revokeObjectURL:vi.fn()}));
   vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
   act(()=>useAppStore.getState().savePspProject());
   const project=save.mock.calls[0][0];expect(project.layout.rulerGuides).toEqual([{id:'shared',axis:'x',positionMm:50}]);
   act(()=>useAppStore.getState().removeRulerGuide('shared'));
   await act(async()=>{await useAppStore.getState().openPspProjectFile({text:async()=>JSON.stringify(project)} as File);});
   expect(useAppStore.getState().layout.rulerGuides).toEqual([{id:'shared',axis:'x',positionMm:50}]);
 });
 it('resets the draft line geometry when switching from a vertical to a horizontal guide',()=>{
   const top=host.querySelector('[data-sheet-ruler="x"]')!,side=host.querySelector('[data-sheet-ruler="y"]')!;
   pointer(top,'pointerdown',200,30);pointer(top,'pointermove',200,250);flush();pointer(top,'pointercancel',200,250);
   pointer(side,'pointerdown',80,250);pointer(side,'pointermove',300,250);flush();
   const ghost=host.querySelector<HTMLElement>('[data-guide-ghost]')!;
   expect(ghost.dataset.axis).toBe('y');expect(ghost.style.left).toBe('');expect(ghost.style.top).toBe('33.33333333333333%');
   pointer(side,'pointercancel',300,250);
 });
 it('uses left/top origin in Persian and retains guides when rulers are hidden',()=>{
   act(()=>useAppStore.setState({settings:{...useAppStore.getState().settings,language:'fa'}}));
   expect(host.querySelector('[data-sheet-ruler="x"]')?.parentElement?.getAttribute('dir')).toBe('ltr');
   act(()=>useAppStore.getState().addRulerGuide({id:'rtl',axis:'x',positionMm:50}));
   expect(guide().style.left).toBe('25%');expect(guide().getAttribute('aria-label')).toContain('خط راهنمای عمودی');
   act(()=>useAppStore.getState().setShowRulers(false));
   expect(host.querySelector('[data-sheet-ruler="x"]')).toBeNull();expect(guide()).toBeTruthy();
 });
 it('cancels an active gesture on Escape and preserves external guide edits',()=>{
   act(()=>useAppStore.getState().addRulerGuide({id:'a',axis:'x',positionMm:50}));
   const line=guide();pointer(line,'pointerdown',200,200);pointer(line,'pointermove',250,200);flush();
   act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
   expect(line.style.left).toBe('25%');pointer(line,'pointerup',250,200);expect(useAppStore.getState().layout.rulerGuides?.[0].positionMm).toBe(50);
   pointer(line,'pointerdown',200,200);act(()=>useAppStore.getState().moveRulerGuide('a',80));pointer(line,'pointerup',250,200);
   expect(useAppStore.getState().layout.rulerGuides?.[0].positionMm).toBe(80);expect(line.style.left).toBe('40%');
 });
 it('cancels a new line released away from the sheet and a touch cancel',()=>{
   const ruler=host.querySelector('[data-sheet-ruler="x"]')!;
   pointer(ruler,'pointerdown',200,30,'touch');pointer(ruler,'pointermove',200,250,'touch');pointer(ruler,'pointercancel',200,250,'touch');
   pointer(ruler,'pointerdown',200,30);pointer(ruler,'pointerup',700,250);
   expect(useAppStore.getState().layout.rulerGuides).toEqual([]);expect((host.querySelector('[data-guide-ghost]') as HTMLElement).style.display).toBe('none');
 });
});
describe('ruler ticks',()=>{
 it('produces accurate mm/cm positions independent of zoom, and bounded minor ticks',()=>{
   expect(rulerTicks(200,400,'mm').slice(0,3)).toEqual([{mm:0,label:'0'},{mm:20,label:'20'},{mm:40,label:'40'}]);
   expect(rulerTicks(200,400,'cm').slice(0,3)).toEqual([{mm:0,label:'0'},{mm:20,label:'2'},{mm:40,label:'4'}]);
   expect(rulerMinorTicks(200,400,'mm').slice(0,3)).toEqual([2,4,6]);
   expect(rulerTicks(200,0,'mm')).toEqual([]);
 });
});
