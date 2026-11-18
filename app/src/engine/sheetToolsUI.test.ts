// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem } from '@shared/models';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { PreviewWorkspace } from '../components/PreviewWorkspace';
const page: PageItem = {id:'p',documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:100,heightMm:200,rotation:0,
  selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0};
let container:HTMLDivElement, root:Root;
const rect = {x:0,y:0,left:0,top:0,right:400,bottom:600,width:400,height:600,toJSON:()=>({})};
function pointer(el: Element, type:string, x:number, y:number, pointerType:'mouse'|'touch'='mouse', shiftKey=false) {
  const ev = new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,shiftKey});
  Object.defineProperties(ev,{pointerId:{value:1},pointerType:{value:pointerType}});
  act(() => el.dispatchEvent(ev));
}
function clickTool(name:string) {
  const btn = container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  act(() => btn.click());
}
beforeEach(() => {
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  Object.defineProperty(HTMLElement.prototype,'setPointerCapture',{configurable:true,value:vi.fn()});
  useAppStore.setState({pages:[page],documents:[],layout:{...DEFAULT_LAYOUT,paperSize:'Custom',customWidthMm:200,customHeightMm:300,
    rows:2,cols:2,duplexMode:'none',marginsMm:{left:10,right:10,top:10,bottom:10},horizontalGutterMm:6,verticalGutterMm:6},
    settings:{...DEFAULT_SETTINGS,language:'en',unit:'mm'},activeSheetIndex:0,viewMode:'single'});
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  act(() => root.render(React.createElement(PreviewWorkspace,{onCursorMoveMm:()=>{}})));
});
afterEach(() => {act(() => root.unmount());container.remove();vi.restoreAllMocks();});
describe('sheet tool pointer interactions', () => {
  it('shows guides only on the clicked sheet in default mode and dismisses them outside', () => {
    expect(container.querySelector('[data-layout-guides]')).toBeNull();
    act(() => (container.querySelector('[data-canvas-page-id="p"] > div') as HTMLElement).click());
    expect(container.querySelectorAll('[data-layout-guides]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label^="move "]')).toHaveLength(8);
    pointer(container.querySelector('[data-preview-viewport]')!, 'pointerdown', 0, 0);
    expect(container.querySelector('[data-layout-guides]')).toBeNull();
    expect(container.querySelectorAll('[aria-label^="move "]')).toHaveLength(0);
  });
  it('shows unit-aware guide values on the active sheet and updates them during a drag', () => {
    expect(container.querySelector('[data-guide-value]')).toBeNull();
    act(() => (container.querySelector('[data-sheet-canvas-index]') as HTMLElement).click());
    const value=() => container.querySelector('[data-guide-value="Left margin"]')!;
    expect(value().textContent).toBe('10 mm');
    expect(container.querySelector('[data-guide-value="Column gutter 1 (all columns)"]')?.textContent).toBe('6 mm');
    const overlay=container.querySelector('[data-layout-guides]') as HTMLElement;
    vi.spyOn(overlay,'getBoundingClientRect').mockReturnValue(rect);
    const handle=container.querySelector('[aria-label="Left margin"]')!;
    expect(handle.getAttribute('aria-describedby')).toBe(value().id);
    pointer(handle,'pointerdown',20,300); pointer(handle,'pointermove',40,300);
    expect(value().textContent).toBe('20 mm');
    pointer(handle,'pointercancel',40,300); expect(value().textContent).toBe('10 mm');
    act(() => useAppStore.setState({settings:{...useAppStore.getState().settings,unit:'cm'}}));
    expect(value().textContent).toBe('1 cm');
  });
  it('does not allow reset while the driver limits are unavailable', () => {
    act(()=>useAppStore.setState({printerMargins:{status:'unavailable',reason:'driver did not report margins'}}));
    const reset=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Reset printer margins')!;
    expect(reset.disabled).toBe(true);
    expect(container.textContent).toContain('current values are unverified');
    act(()=>useAppStore.setState({printerMargins:{status:'loading'}}));
    expect(reset.disabled).toBe(true);expect(container.textContent).toContain('Loading printer margins');
  });
  it('shades the configured margin as a preview-only guide and resets margins with undo', () => {
    const shading=container.querySelector('[data-layout-margin-shading]')!;
    expect(shading.getAttribute('aria-label')).toContain('Configured layout margin');
    act(()=>useAppStore.setState({printerMargins:{status:'available',source:'hardware',marginsMm:{left:4.2,right:4.1,top:3,bottom:5}}}));
    expect(shading.children).toHaveLength(5);
    act(() => useAppStore.getState().updateMargins({left:25}));
    const reset=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Reset printer margins')!;
    expect(reset.title).toContain('selected printer margins');
    act(() => reset.click());
    expect(useAppStore.getState().layout.marginsMm).toEqual({left:4.2,right:4.1,top:3,bottom:5});
    expect(useAppStore.getState().layout.horizontalGutterMm).toBe(6);
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().layout.marginsMm.left).toBe(25);
  });
  it('moves guides between clicked sheets and does not activate resize handles on paper', () => {
    act(() => useAppStore.setState({pages:[page,{...page,id:'p2'}],layout:{...useAppStore.getState().layout,rows:1,cols:1},viewMode:'continuous'}));
    const sheets=container.querySelectorAll<HTMLElement>('[data-sheet-canvas-index]');
    act(() => sheets[0].click());
    expect(sheets[0].querySelector('[data-layout-guides]')).not.toBeNull();
    act(() => sheets[1].click());
    expect(sheets[0].querySelector('[data-layout-guides]')).toBeNull();
    expect(sheets[1].querySelector('[data-layout-guides]')).not.toBeNull();
    expect(container.querySelectorAll('[aria-label^="move "]')).toHaveLength(0);
  });
  it.each(['mouse','touch'] as const)('previews and commits a margin drag using %s, with undo', pointerType => {
    act(() => (container.querySelector('[data-sheet-canvas-index]') as HTMLElement).click());
    const overlay=container.querySelector('[data-layout-guides]') as HTMLElement;
    vi.spyOn(overlay,'getBoundingClientRect').mockReturnValue(rect);
    const handle=container.querySelector('[aria-label="Left margin"]')!;
    pointer(handle,'pointerdown',20,300,pointerType);
    pointer(handle,'pointermove',40,300,pointerType);
    expect(useAppStore.getState().layout.marginsMm.left).toBe(10);
    expect((handle as HTMLElement).style.left).not.toBe(`${10 * 1.95}px`);
    pointer(handle,'pointerup',40,300,pointerType);
    expect(useAppStore.getState().layout.marginsMm.left).toBe(20);
    act(() => useAppStore.getState().undo());
    expect(useAppStore.getState().layout.marginsMm.left).toBe(10);
  });
  it.each([['Column gutter 1 (all columns)','horizontalGutterMm',100,100,110,100], ['Row gutter 1 (all rows)','verticalGutterMm',100,100,100,110]] as const)(
    'commits %s with touch and can undo it', (label,key,x,y,endX,endY) => {
      act(() => (container.querySelector('[data-sheet-canvas-index]') as HTMLElement).click());
      const overlay=container.querySelector('[data-layout-guides]') as HTMLElement;
      vi.spyOn(overlay,'getBoundingClientRect').mockReturnValue(rect);
      const handle=container.querySelector(`[aria-label="${label}"]`)!;
      pointer(handle,'pointerdown',x,y,'touch'); pointer(handle,'pointermove',endX,endY,'touch'); pointer(handle,'pointerup',endX,endY,'touch');
      expect(useAppStore.getState().layout[key]).toBeCloseTo(16);
      act(() => useAppStore.getState().undo());
      expect(useAppStore.getState().layout[key]).toBe(6);
    });
  it('discards a canceled touch gutter drag', () => {
    act(() => (container.querySelector('[data-sheet-canvas-index]') as HTMLElement).click());
    const overlay=container.querySelector('[data-layout-guides]') as HTMLElement;
    vi.spyOn(overlay,'getBoundingClientRect').mockReturnValue(rect);
    const handle=container.querySelector('[aria-label="Column gutter 1 (all columns)"]')!;
    pointer(handle,'pointerdown',100,100,'touch'); pointer(handle,'pointermove',120,100,'touch'); pointer(handle,'pointercancel',120,100,'touch');
    expect(useAppStore.getState().layout.horizontalGutterMm).toBe(6);
  });
  it('applies a centered source aspect crop through the crop tool and supports undo', () => {
    clickTool('Crop');
    const width=container.querySelector<HTMLInputElement>('[aria-label="Crop ratio width"]')!;
    const height=container.querySelector<HTMLInputElement>('[aria-label="Crop ratio height"]')!;
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
    act(() => {setter.call(width,'2');width.dispatchEvent(new Event('input',{bubbles:true}));});
    expect(height.value).toBe('1');
    const button=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Apply centered crop')!;
    act(() => button.click());
    const crop=useAppStore.getState().pages[0].overrides?.cropBoxMm!;
    expect((100-crop.left-crop.right)/(200-crop.top-crop.bottom)).toBeCloseTo(2);
    act(() => useAppStore.getState().undo()); expect(useAppStore.getState().pages[0].overrides).toBeUndefined();
    act(() => {setter.call(width,'0');width.dispatchEvent(new Event('input',{bubbles:true}));});
    expect(button.disabled).toBe(true);
    act(() => {setter.call(width,'10000');width.dispatchEvent(new Event('input',{bubbles:true}));});
    act(() => button.click());
    expect(container.querySelector('[role=alert]')?.textContent).toContain('cannot fit');
    expect(useAppStore.getState().pages[0].overrides).toBeUndefined();
  });
  it('measures a shift-locked horizontal line without changing layout', () => {
    clickTool('Measure');
    const overlay=container.querySelector('[data-measurement-overlay]') as HTMLElement;
    vi.spyOn(overlay,'getBoundingClientRect').mockReturnValue(rect);
    const savedLayout=useAppStore.getState().layout;
    pointer(overlay,'pointerdown',20,20); pointer(overlay,'pointermove',80,40,'mouse',true); pointer(overlay,'pointerup',80,40,'mouse',true);
    const line=overlay.querySelector('line')!;
    expect(line.getAttribute('y1')).toBe(line.getAttribute('y2'));
    expect(overlay.querySelector('[role=status]')?.textContent).toContain('30 mm');
    expect(useAppStore.getState().layout).toBe(savedLayout);
  });
  it('renders fixed hardware printable boundary and prevents dragging margins outward past it', () => {
    act(() => useAppStore.setState({
      printerMargins: { status: 'available', source: 'hardware', marginsMm: { top: 6, right: 5, bottom: 7, left: 4 } },
    }));
    const hardwareBoundary = container.querySelector<HTMLElement>('[data-printer-min-margins]');
    expect(hardwareBoundary).not.toBeNull();
    act(() => (container.querySelector('[data-sheet-canvas-index]') as HTMLElement).click());
    const overlay = container.querySelector('[data-layout-guides]') as HTMLElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(rect);
    const leftHandle = container.querySelector('[aria-label="Left margin"]')!;
    pointer(leftHandle, 'pointerdown', 20, 300);
    pointer(leftHandle, 'pointermove', 0, 300);
    pointer(leftHandle, 'pointerup', 0, 300);
    expect(useAppStore.getState().layout.marginsMm.left).toBe(4);
    // Inward drag still works freely
    pointer(leftHandle, 'pointerdown', 8, 300);
    pointer(leftHandle, 'pointermove', 38, 300);
    pointer(leftHandle, 'pointerup', 38, 300);
    expect(useAppStore.getState().layout.marginsMm.left).toBe(19);
  });
  it('renders gray hatched margin shading and non-circular col/row-resize handles matching the spine guide', () => {
    const shading = container.querySelector('[data-layout-margin-shading]')!;
    const firstBand = shading.children[0] as HTMLElement;
    expect(firstBand.style.backgroundImage).toContain('repeating-linear-gradient');

    const directLeft = container.querySelector<HTMLElement>('[data-margin-guide="left"]')!;
    expect(directLeft.className).toContain('cursor-col-resize');
    const directTop = container.querySelector<HTMLElement>('[data-margin-guide="top"]')!;
    expect(directTop.className).toContain('cursor-row-resize');

    act(() => (container.querySelector('[data-sheet-canvas-index]') as HTMLElement).click());
    const guides = container.querySelector('[data-layout-guides]')!;
    expect(guides.querySelectorAll('.rounded-full')).toHaveLength(0);
    const leftGuideHandle = guides.querySelector<HTMLElement>('[aria-label="Left margin"]')!;
    expect(leftGuideHandle.style.cursor).toBe('col-resize');
    expect(leftGuideHandle.style.backgroundImage).toContain('repeating-linear-gradient');

    // Direct drag on hatched margin band shows live size centered inside the band
    pointer(directLeft, 'pointerdown', 10, 300);
    pointer(directLeft, 'pointermove', 30, 300);
    const liveLabel = directLeft.querySelector('[data-band-size-label="margin-left"]');
    expect(liveLabel).not.toBeNull();
    expect(liveLabel!.textContent).toBe('20.3 mm');
    pointer(directLeft, 'pointerup', 30, 300);
    expect(container.querySelector('[data-band-size-label="margin-left"]')).toBeNull();
  });
  it('centers matrix gutter hatched bands on the gap midpoint and grows symmetrically when dragging either edge', () => {
    act(() => useAppStore.setState({
      layout: {
        ...useAppStore.getState().layout,
        rows: 2,
        cols: 3,
        horizontalGutterMm: 20,
        verticalGutterMm: 10,
      },
    }));
    // Direct centered matrix gutter band spans the full gap around its midpoint
    const directHGutter = container.querySelector<HTMLElement>('[data-matrix-gutter-guide="horizontal-0"]')!;
    expect(directHGutter).not.toBeNull();
    expect(directHGutter.style.transform).toBe('translateX(-50%)');
    expect(parseFloat(directHGutter.style.width)).toBeCloseTo(20 * 1.95, 1);

    // Activate sheet layout guides and verify the active gutter handle spans the full gap centered at gap midpoint
    act(() => (container.querySelector('[data-sheet-canvas-index]') as HTMLElement).click());
    const overlay = container.querySelector('[data-layout-guides]') as HTMLElement;
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(rect);
    const colHandle = container.querySelector<HTMLButtonElement>('[aria-label="Column gutter 1 (all columns)"]')!;
    const rowHandle = container.querySelector<HTMLButtonElement>('[aria-label="Row gutter 1 (all rows)"]')!;
    expect(colHandle.style.transform).toBe('translateX(-50%)');
    expect(parseFloat(colHandle.style.width)).toBeCloseTo(20 * 1.95, 1);
    expect(rowHandle.style.transform).toBe('translateY(-50%)');
    expect(parseFloat(rowHandle.style.height)).toBeCloseTo(10 * 1.95, 1);

    // Dragging the left edge of a wide column gutter leftward widens the gutter symmetrically from center
    vi.spyOn(colHandle, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 20, left: 100, top: 20, right: 140, bottom: 580, width: 40, height: 560, toJSON: () => ({}) });
    pointer(colHandle, 'pointerdown', 102, 200);
    pointer(colHandle, 'pointermove', 94, 200);
    pointer(colHandle, 'pointerup', 94, 200);
    // -4 mm on left edge of col-0 gutter (3 cols) => +6 mm total gutter (20 -> 26 mm)
    expect(useAppStore.getState().layout.horizontalGutterMm).toBeCloseTo(26, 1);

    // Dragging the right edge rightward also widens symmetrically
    pointer(colHandle, 'pointerdown', 138, 200);
    pointer(colHandle, 'pointermove', 142, 200);
    pointer(colHandle, 'pointerup', 142, 200);
    expect(useAppStore.getState().layout.horizontalGutterMm).toBeCloseTo(32, 1);

    // Dragging top edge of row gutter upward widens vertical gutter
    vi.spyOn(rowHandle, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 280, left: 20, top: 280, right: 380, bottom: 300, width: 360, height: 20, toJSON: () => ({}) });
    pointer(rowHandle, 'pointerdown', 200, 282);
    pointer(rowHandle, 'pointermove', 200, 276);
    pointer(rowHandle, 'pointerup', 200, 276);
    expect(useAppStore.getState().layout.verticalGutterMm).toBeCloseTo(16, 1);
  });
});
