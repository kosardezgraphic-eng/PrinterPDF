// @vitest-environment jsdom
/**
 * Shapes as the operator meets them: a button in the Insert tab, an outline on the page, and a panel whose
 * numbers are the same numbers the preview draws and the exported PDF prints.
 *
 * The geometry itself is exercised in `shapes.test.ts`; this file is about the wiring — that a click in
 * the ribbon produces a *selected* overlay (so the panel opens on the thing that was just inserted), that
 * a circle starts out round in millimetres rather than in percentages, that the panel's controls reach the
 * store instead of a local copy, and that a shape with no document refuses out loud.
 */
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PageItem,PageOverlayShape} from '@shared/models';
import {PreviewWorkspace} from '../components/PreviewWorkspace';
import {Ribbon} from '../components/Ribbon';
import {ShapeControlPanel} from '../components/ShapeControlPanel';
import {DEFAULT_LAYOUT,DEFAULT_SETTINGS,useAppStore} from '../store/useAppStore';
import {SHAPE_TYPES} from '../engine/shapes';

const page:PageItem={id:'p',documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:200,heightMm:300,rotation:0,selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0};
const shape=(over:Partial<PageOverlayShape>={}):PageOverlayShape=>({
  id:'s',kind:'shape',type:'rectangle',target:'page',targetScope:'current',targetPageIds:['p'],targetSheetIndex:1,
  xPercent:20,yPercent:20,widthPercent:28,heightPercent:18.667,opacity:1,rotation:0,
  fillColor:'transparent',strokeColor:'#000000',strokeWidth:1,strokeStyle:'solid',borderRadius:0,...over});
const stored=()=>useAppStore.getState().overlays as PageOverlayShape[];
const one=()=>useAppStore.getState().overlays[0] as PageOverlayShape;

let root:Root,host:HTMLDivElement;
const canvas=()=>host.querySelector<HTMLElement>('[data-sheet-canvas-index]')!;
function rect(el:Element|null,width:number,height:number){if(!el)return;
  vi.spyOn(el,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:width,bottom:height,width,height,x:0,y:0,toJSON:()=>({})} as DOMRect);}
/** One click in the Insert tab: open the picker, take the outline, and the menu closes behind it. */
const pick=(type:string)=>{
  const trigger=host.querySelector<HTMLButtonElement>('[data-shape-picker]')!;
  if(!host.querySelector('[data-shape-menu]'))act(()=>trigger.click());
  act(()=>{host.querySelector<HTMLButtonElement>(`[data-shape-tool="${type}"]`)!.click();});
};
function setNumber(selector:string,value:number|string){
  const el=host.querySelector<HTMLInputElement>(selector)!;
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  act(()=>{setter.call(el,String(value));el.dispatchEvent(new Event('input',{bubbles:true}));});
}
function setRange(selector:string,value:number|string){
  const el=host.querySelector<HTMLInputElement>(selector)!;
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  act(()=>{setter.call(el,String(value));el.dispatchEvent(new Event('input',{bubbles:true}));});
}
async function flush(){for(let i=0;i<6;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});}

beforeEach(()=>{
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  useAppStore.setState({
    pages:[page],documents:[],bookmarks:[],overlays:[],selectedOverlayId:null,textEdit:null,
    settings:{...DEFAULT_SETTINGS,language:'en'},
    layout:{...DEFAULT_LAYOUT,paperSize:'Custom',customWidthMm:200,customHeightMm:300,rows:1,cols:1,duplexMode:'none',
      marginMode:'custom',marginsMm:{top:0,right:0,bottom:0,left:0},horizontalGutterMm:0,verticalGutterMm:0,
      autoRotateToFit:false,showCellBorders:false,rulerGuides:[]},
    activePageId:'p',activeSheetIndex:0,activeRibbonTab:'insert',viewMode:'single',toasts:[],
  } as never);
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();});

function render(){
  act(()=>root.render(React.createElement(React.Fragment,null,
    React.createElement(Ribbon),
    React.createElement(PreviewWorkspace,{onCursorMoveMm:()=>{}}),
    React.createElement(ShapeControlPanel))));
  rect(canvas(),200,300);
}

describe('the Insert tab shape tool',()=>{
  it('offers every shape the engine can draw, in one click each',()=>{
    render();
    const trigger=host.querySelector<HTMLButtonElement>('[data-shape-picker]')!;
    expect(trigger, 'the insert tab needs a shapes button').toBeTruthy();
    expect(trigger.disabled).toBe(false);
    act(()=>trigger.click());
    const tools=[...host.querySelectorAll<HTMLButtonElement>('[data-shape-tool]')];
    expect(tools.map(button=>button.getAttribute('data-shape-tool'))).toEqual(SHAPE_TYPES);
    expect(tools.length).toBeGreaterThanOrEqual(11);   // rectangle, square, ..., line, arrow
    expect(host.querySelector('[data-shape-menu]')!.textContent).toMatch(/current page/);
  });

  it('stays inert, with a disabled look, until a document is loaded',()=>{
    act(()=>useAppStore.setState({pages:[]}));
    render();
    const trigger=host.querySelector<HTMLButtonElement>('[data-shape-picker]')!;
    expect(trigger.disabled).toBe(true);
    expect(useAppStore.getState().overlays).toHaveLength(0);
  });

  it('inserts the picked outline on the current page and selects it, so its panel opens',()=>{
    render();
    pick('circle');
    expect(stored()).toHaveLength(1);
    expect(one()).toMatchObject({kind:'shape',type:'circle',target:'page',targetScope:'current',targetPageIds:['p']});
    expect(useAppStore.getState().selectedOverlayId).toBe(one().id);
    // centred on the page, in the box the store was asked for
    expect(one().xPercent + one().widthPercent / 2).toBeCloseTo(50,4);
    expect(one().yPercent + one().heightPercent / 2).toBeCloseTo(50,4);
    expect(host.querySelector('[data-shape-control-panel]'), 'the panel has to be on the new shape').toBeTruthy();
  });

  it('starts a circle round in millimetres, and a square with its ratio locked',()=>{
    render();
    act(()=>host.querySelector<HTMLButtonElement>('[data-shape-picker]')!.click());
    pick('circle');
    const boxWidth=200,boxHeight=300;
    const widthMm=one().widthPercent*boxWidth/100, heightMm=one().heightPercent*boxHeight/100;
    expect(widthMm).toBeCloseTo(heightMm,3);            // percentages lie; millimetres do not
    expect(one().lockAspect).toBe(true);
    act(()=>useAppStore.setState({overlays:[],selectedOverlayId:null}));
    pick('square');
    expect(one().type).toBe('square');
    expect(one().lockAspect).toBe(true);
    act(()=>useAppStore.setState({overlays:[],selectedOverlayId:null}));
    pick('rectangle');
    expect(one().lockAspect).toBe(false);                // a rectangle is free to be stretched
  });

  it('refuses to insert with no page to put it on, and says so',()=>{
    act(()=>useAppStore.setState({pages:[]}));
    render();
    let id:unknown='unset';
    act(()=>{id=useAppStore.getState().addShapeOverlay('circle');});
    expect(id).toBeNull();
    expect(stored()).toHaveLength(0);
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({type:'warning'});
    expect(useAppStore.getState().toasts.at(-1)!.title).toMatch(/Load a document/);
  });
});

describe('the shape panel',()=>{
  beforeEach(()=>{
    act(()=>useAppStore.setState({overlays:[shape()],selectedOverlayId:'s'}));
    render();
  });

  it('paints the same outline in the preview the exporter turns into path operators',()=>{
    const glyph=host.querySelector('[data-shape-glyph="rectangle"]');
    expect(glyph, 'the preview has to draw the shape, not a placeholder box').toBeTruthy();
    const d=glyph!.querySelector('path')!.getAttribute('d')!;
    expect(d).toMatch(/^M -28 -28/);                     // millimetres around the centre of the box
  });

  it('writes fill, stroke and geometry straight into the store',()=>{
    setNumber('[data-shape-stroke-width]','2.5');
    expect(one().strokeWidth).toBeCloseTo(2.5,6);
    setRange('[data-shape-opacity]','40');
    expect(one().opacity).toBeCloseTo(0.4,6);
    setRange('[data-shape-rotation]','90');
    expect(one().rotation).toBe(90);
    act(()=>host.querySelector<HTMLButtonElement>('[data-shape-fill-none]')!.click());
    expect(one().fillColor).toBe('#000000');              // "no fill" toggles into the stroke colour
    act(()=>host.querySelector<HTMLButtonElement>('[data-shape-swatch="#ef4444"]')!.click());
    expect(one().fillColor).toBe('#ef4444');
    // one undo step per gesture, because a print shop walks changes back one at a time
    act(()=>useAppStore.getState().undo());
    expect(one().fillColor).toBe('#000000');
  });

  it('keeps a polygon and a star at a vertex count the renderers can draw',()=>{
    act(()=>host.querySelector<HTMLButtonElement>('[data-shape-type="polygon"]')!.click());
    expect(one().type).toBe('polygon');
    setRange('[data-shape-sides]','9');
    expect(one().sides).toBe(9);
    setRange('[data-shape-sides]','900');                 // a hand-typed value cannot explode the path
    expect(one().sides).toBe(16);
    act(()=>host.querySelector<HTMLButtonElement>('[data-shape-type="star"]')!.click());
    setRange('[data-shape-inner]','20');
    expect(one().innerRadiusPercent).toBe(20);
  });

  it('moves the box by millimetres, including past the edge of the page',()=>{
    setNumber('[data-shape-x]','-10');
    expect(one().xPercent).toBeCloseTo(-5,4);             // 200 mm wide page → -10 mm is -5 %
    setNumber('[data-shape-y]','300');
    expect(one().yPercent).toBeCloseTo(100,4);
    act(()=>host.querySelector<HTMLButtonElement>('[data-shape-align="right"]')!.click());
    expect(one().xPercent).toBeCloseTo(100-one().widthPercent,4);
    act(()=>host.querySelector<HTMLButtonElement>('[data-shape-align="vcenter"]')!.click());
    expect(one().yPercent).toBeCloseTo((100-one().heightPercent)/2,4);
  });

  it('stacks, copies and deletes the layer, and drops the panel with it',()=>{
    let second='';
    act(()=>{second=useAppStore.getState().addShapeOverlay('line') as string;});
    expect(stored().map(item=>item.type)).toEqual(['rectangle','line']);
    act(()=>host.querySelector<HTMLButtonElement>('[data-shape-order="back"]')!.click());
    expect(stored()[0].id).toBe(second);                     // "to back" is the start: the array order is the stack
    act(()=>host.querySelector<HTMLButtonElement>('[data-shape-order="front"]')!.click());
    expect(stored()[stored().length-1]!.id).toBe(second);   // and "to front" is its end, which the renderers walk last
    // A copy becomes the selected shape, so the panel follows what was just made.
    act(()=>host.querySelector<HTMLButtonElement>('[data-shape-duplicate]')!.click());
    expect(stored()).toHaveLength(3);
    const copy=stored().find(item=>item.id!=='s'&&item.id!==second)!;
    expect(useAppStore.getState().selectedOverlayId).toBe(copy.id);
    const source=stored().find(item=>item.id===second)!;
    expect(copy.xPercent).toBeCloseTo(Math.min(90,source.xPercent+4),4);   // beside it, not on top of it
    expect(copy).toMatchObject({type:source.type,strokeColor:source.strokeColor});  // same settings
    act(()=>host.querySelector<HTMLButtonElement>('[data-shape-delete]')!.click());
    expect(stored().map(item=>item.id)).toEqual(['s',second]);
    // The panel follows the selection: deleting the shape that was selected leaves nothing to edit.
    expect(host.querySelector('[data-shape-control-panel]')).toBeNull();
    expect(useAppStore.getState().selectedOverlayId).toBeNull();

    act(()=>useAppStore.getState().selectOverlay('s'));
    expect(host.querySelector('[data-shape-control-panel]'), 'selecting another layer opens its panel again').toBeTruthy();
    act(()=>host.querySelector<HTMLButtonElement>('[data-shape-delete]')!.click());
    expect(stored().map(item=>item.id)).toEqual([second]);
    expect(host.querySelector('[data-shape-control-panel]')).toBeNull();
  });

  it('centres preview SVG viewBoxes around zero and distinguishes rectangle, square and rounded-rect icons', () => {
    const rectSvg = host.querySelector<SVGSVGElement>('[data-shape-type="rectangle"] [data-shape-preview="rectangle"]')!;
    const squareSvg = host.querySelector<SVGSVGElement>('[data-shape-type="square"] [data-shape-preview="square"]')!;
    const roundedSvg = host.querySelector<SVGSVGElement>('[data-shape-type="rounded-rect"] [data-shape-preview="rounded-rect"]')!;

    const vbParts = (rectSvg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect(vbParts[0]).toBeLessThan(0);
    expect(vbParts[1]).toBeLessThan(0);
    expect(vbParts[0] + vbParts[2] / 2).toBeCloseTo(0, 4);
    expect(vbParts[1] + vbParts[3] / 2).toBeCloseTo(0, 4);
    expect(rectSvg.style.overflow).toBe('hidden');

    const rectPath = rectSvg.querySelector('path')!.getAttribute('d')!;
    const squarePath = squareSvg.querySelector('path')!.getAttribute('d')!;
    const roundedPath = roundedSvg.querySelector('path')!.getAttribute('d')!;
    expect(rectPath).not.toBe(squarePath);
    expect(roundedPath).toContain('C ');
  });

  it('supports print style presets, colour swap, double/vertical arrows and fit/center actions', () => {
    act(() => host.querySelector<HTMLButtonElement>('[data-shape-preset="cutbox"]')!.click());
    expect(one()).toMatchObject({ fillColor: 'transparent', strokeColor: '#dc2626', strokeStyle: 'dashed', strokeWidth: 0.75 });

    act(() => host.querySelector<HTMLButtonElement>('[data-shape-preset="solid"]')!.click());
    expect(one()).toMatchObject({ fillColor: '#0284c7', strokeWidth: 0 });

    act(() => host.querySelector<HTMLButtonElement>('[data-shape-swap-colors]')!.click());
    expect(one().strokeColor).toBe('#0284c7');
    expect(one().strokeWidth).toBeGreaterThan(0);

    act(() => host.querySelector<HTMLButtonElement>('[data-shape-type="arrow"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-shape-arrow-style="double"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-shape-orientation="vertical"]')!.click());
    expect(one()).toMatchObject({ type: 'arrow', arrowStyle: 'double', lineOrientation: 'vertical' });

    act(() => host.querySelector<HTMLButtonElement>('[data-shape-fit-box]')!.click());
    expect(one()).toMatchObject({ xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 });
  });
});
