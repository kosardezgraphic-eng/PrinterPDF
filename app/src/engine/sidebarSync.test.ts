// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageItem, SourceDocument } from '@shared/models';
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { PreviewWorkspace } from '../components/PreviewWorkspace';
import { SidebarPages } from '../components/SidebarPages';
import { computeImpositionSheets } from './layoutEngine';
import { pageImageStyle } from '../components/PageContentImage';

const makePage = (id: string, doc: string, highlighted = false): PageItem => ({
  id, documentId:doc, documentName:doc, sourcePageNumber:1, widthMm:100, heightMm:200, rotation:0,
  selectedForPrint:true, isHighlighted:highlighted, isBlankPage:false, colorProfile:'color', inkCoveragePercent:10,
  thumbnailDataUrl:'data:image/png;base64,AA==',
});
const doc = (id: string, collapsed = false): SourceDocument => ({ id, name:id, filePath:'', fileSize:100,
  fileType:'pdf', mimeType:'application/pdf', pageCount:1, createdAt:'', collapsed });
const highlights = () => useAppStore.getState().pages.filter(p => p.isHighlighted).map(p => p.id);
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState({ documents:[doc('d1'),doc('d2',true)], pages:[makePage('p1','d1',true),makePage('p2','d2')],
    layout:{...DEFAULT_LAYOUT, rows:1,cols:1,duplexMode:'none',autoRotateToFit:false}, settings:{...DEFAULT_SETTINGS,language:'en'},
    activeSheetIndex:0, viewMode:'single', sidebarTab:'pages', sidebarReveal:null, previewPageRequest:null });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  act(() => root.render(React.createElement(React.Fragment, null,
    React.createElement(SidebarPages), React.createElement(PreviewWorkspace, {onCursorMoveMm:()=>{}}))));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('preview and thumbnails', () => {
  it('selects and reveals the corresponding thumbnail on mouse wheel navigation', () => {
    expect(container.querySelector('[data-page-id="p2"]')).toBeNull();
    const viewport = container.querySelector('[data-preview-viewport]')!;
    act(() => viewport.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:120})));
    expect(useAppStore.getState().activeSheetIndex).toBe(1);
    expect(highlights()).toEqual(['p2']);
    expect(useAppStore.getState().documents[1].collapsed).toBe(false);
    expect(container.querySelector('[data-page-id="p2"]')?.className).toContain('border-sky-500');
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Prev Sheet"]')!;
    act(() => button.click());
    expect(highlights()).toEqual(['p1']);
  });
  it('scrolls only the thumbnail list when a preview page is outside it', () => {
    const rect = (top: number, bottom: number) => ({top,bottom,left:0,right:100,width:100,height:bottom-top,x:0,y:top,toJSON:()=>({})});
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-thumbnail-list')) return rect(0,200);
      if (this.dataset.pageId === 'p2') return rect(300,400);
      return rect(0,100);
    });
    const viewport = container.querySelector('[data-preview-viewport]') as HTMLElement;
    act(() => viewport.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:120})));
    expect((container.querySelector('[data-thumbnail-list]') as HTMLElement).scrollTop).toBe(200);
    expect(viewport.scrollTop).toBe(0);
    measure.mockRestore();
  });
  it('follows scrolling in continuous view and clears selection for a blank duplex side', () => {
    act(() => useAppStore.setState({ viewMode:'continuous', layout:{...useAppStore.getState().layout,duplexMode:'long-edge'}, pages:[makePage('p1','d1',true)] }));
    const viewport = container.querySelector('[data-preview-viewport]') as HTMLElement;
    Object.defineProperty(viewport,'clientHeight',{value:100,configurable:true});
    vi.spyOn(viewport,'getBoundingClientRect').mockReturnValue({top:0,bottom:100,left:0,right:100,width:100,height:100,x:0,y:0,toJSON:()=>({})});
    const sides = container.querySelectorAll<HTMLElement>('[data-sheet-index]');
    vi.spyOn(sides[0],'getBoundingClientRect').mockReturnValue({top:-200,bottom:-100,left:0,right:100,width:100,height:100,x:0,y:-200,toJSON:()=>({})});
    vi.spyOn(sides[1],'getBoundingClientRect').mockReturnValue({top:0,bottom:100,left:0,right:100,width:100,height:100,x:0,y:0,toJSON:()=>({})});
    act(() => viewport.dispatchEvent(new Event('scroll',{bubbles:true})));
    expect(useAppStore.getState().activeSheetIndex).toBe(1);
    expect(highlights()).toEqual([]);
  });
  it('follows the nearest sheet while scrolling in grid view', () => {
    act(() => useAppStore.setState({viewMode:'grid'}));
    const viewport = container.querySelector('[data-preview-viewport]') as HTMLElement;
    Object.defineProperties(viewport,{clientHeight:{value:100,configurable:true},clientWidth:{value:100,configurable:true}});
    const rect = (left: number, top: number) => ({top,bottom:top+100,left,right:left+100,width:100,height:100,x:left,y:top,toJSON:()=>({})});
    vi.spyOn(viewport,'getBoundingClientRect').mockReturnValue(rect(0,0));
    const sides = container.querySelectorAll<HTMLElement>('[data-sheet-index]');
    vi.spyOn(sides[0],'getBoundingClientRect').mockReturnValue(rect(-200,0));
    vi.spyOn(sides[1],'getBoundingClientRect').mockReturnValue(rect(0,0));
    act(() => viewport.dispatchEvent(new Event('scroll',{bubbles:true})));
    expect(useAppStore.getState().activeSheetIndex).toBe(1);
    expect(highlights()).toEqual(['p2']);
  });
  it('keeps a sidebar multiselection during edits and mirrors crop, rotation, move and effects', () => {
    act(() => useAppStore.getState().highlightPage('p2',true));
    act(() => useAppStore.getState().focusPageFromPreview('p1',true));
    expect(highlights()).toEqual(['p1','p2']);
    const card = () => container.querySelector('[data-page-id="p1"]')!;
    const content = () => card().querySelector('[data-thumbnail-content]') as HTMLElement;
    const image = () => card().querySelector('img') as HTMLImageElement;
    const beforeWidth = content().style.width;
    act(() => useAppStore.getState().applyPageGeometry('p1','current', {kind:'transform',transform:{x:.2,y:0,scaleX:.5,scaleY:1}}));
    expect(content().style.width).not.toBe(beforeWidth);
    expect(highlights()).toEqual(['p1','p2']);
    act(() => useAppStore.getState().applyPageGeometry('p1','current', {kind:'crop',crop:{top:0,right:0,bottom:0,left:.25}}));
    expect(parseFloat(image().style.width)).toBeCloseTo(100 / .75);
    act(() => useAppStore.getState().rotatePages(['p1'],90));
    expect(image().style.transform).toContain('rotate(90deg)');
    act(() => useAppStore.getState().togglePageInvertOverride('p1'));
    expect(image().style.filter).toContain('invert');
    act(() => useAppStore.getState().undo());
    expect(image().style.filter).not.toContain('invert');
  });
  it('mirrors additional occurrence rotation in the thumbnail without replacing image effects', () => {
    const state=useAppStore.getState(); const cell=computeImpositionSheets(state.pages,state.layout)[0].cells[0];
    act(() => state.applyCellTransform('p1',cell.occurrenceKey!,{x:0,y:0,scaleX:1,scaleY:1,rotationDeg:45}));
    const card=container.querySelector('[data-page-id="p1"]')!;
    expect((card.querySelector('[data-thumbnail-content]') as HTMLElement).style.transform).toBe('rotate(45deg)');
    expect((container.querySelector('[data-canvas-page-id="p1"] [data-page-content]') as HTMLElement).style.transform).toBe('rotate(45deg)');
  });
  it('uses the clicked cell in an N-up sheet and does not change print selection', () => {
    act(() => useAppStore.setState({ layout:{...useAppStore.getState().layout,cols:2}, viewMode:'grid' }));
    const content = container.querySelector('[data-canvas-page-id="p2"] > div') as HTMLElement;
    act(() => content.click());
    expect(highlights()).toEqual(['p2']);
    expect(useAppStore.getState().pages.every(p => p.selectedForPrint)).toBe(true);
  });
  it.each([
    ['single','sequential',1,1,'none',1],
    ['double','sequential',1,1,'long-edge',1],
    ['continuous','sequential',1,1,'none',1],
    ['grid','sequential',1,2,'none',0],
    ['single','step-and-repeat',2,2,'long-edge',1],
  ] as const)('navigates a thumbnail in %s / %s without altering print or multiselection', (viewMode,placementMode,rows,cols,duplexMode,expected) => {
    act(() => useAppStore.setState({documents:[doc('d1'),doc('d2')],viewMode,layout:{...useAppStore.getState().layout,placementMode,rows,cols,duplexMode}}));
    const card=container.querySelector('[data-page-id="p2"]')!;
    act(() => card.dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true})));
    expect(useAppStore.getState().activeSheetIndex).toBe(expected);
    expect(container.querySelector(`[data-sheet-index="${expected}"] [data-canvas-page-id="p2"]`)).not.toBeNull();
    expect(highlights()).toEqual(['p1','p2']);
    expect(useAppStore.getState().pages.every(p=>p.selectedForPrint)).toBe(true);
  });
  it('centers the requested cell in the preview viewport on every click without scrolling the sidebar', () => {
    act(() => useAppStore.setState({documents:[doc('d1'),doc('d2')],viewMode:'grid'}));
    const rect=(left:number,top:number,width:number,height:number) => ({left,top,width,height,right:left+width,bottom:top+height,x:left,y:top,toJSON:()=>({})});
    const viewport=container.querySelector('[data-preview-viewport]') as HTMLElement;
    const list=container.querySelector('[data-thumbnail-list]') as HTMLElement;
    Object.defineProperties(viewport,{clientWidth:{value:100,configurable:true},clientHeight:{value:100,configurable:true}});
    vi.spyOn(viewport,'getBoundingClientRect').mockReturnValue(rect(0,0,100,100));
    const content=container.querySelector('[data-canvas-page-id="p2"] [data-page-content]') as HTMLElement;
    vi.spyOn(content,'getBoundingClientRect').mockReturnValue(rect(200,300,40,40));
    const card=container.querySelector('[data-page-id="p2"]')!;
    act(() => card.dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true})));
    expect(viewport.scrollTop).toBe(270); expect(viewport.scrollLeft).toBe(170); expect(list.scrollTop).toBe(0);
    act(() => viewport.dispatchEvent(new Event('scroll',{bubbles:true})));
    expect(highlights()).toEqual(['p1','p2']);
    viewport.scrollTop=0; viewport.scrollLeft=0;
    act(() => card.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    expect(viewport.scrollTop).toBe(270); expect(viewport.scrollLeft).toBe(170);
  });
  it('previews an excluded page read-only without changing output selection or preflight, then returns', () => {
    act(() => useAppStore.setState({documents:[doc('d1'),doc('d2')],pages:[makePage('p1','d1',true),{...makePage('p2','d2'),selectedForPrint:false}]}));
    act(() => (container.querySelector('[aria-label="Preflight"]') as HTMLElement).click());
    const preflight=container.querySelector('[role=status]')?.textContent;
    act(() => (container.querySelector('[data-page-id="p2"]') as HTMLElement).click());
    expect(container.textContent).toContain('temporary read-only preview');
    expect(container.querySelector('[data-canvas-page-id="p2"]')).not.toBeNull();
    expect((container.querySelector('[data-canvas-page-id="p2"] [data-page-content]') as HTMLElement).style.pointerEvents).toBe('none');
    expect(container.querySelector('[data-layout-guides]')).toBeNull();
    expect(useAppStore.getState().pages.map(p=>p.selectedForPrint)).toEqual([true,false]);
    expect(Array.from(container.querySelectorAll('[role=status]')).some(el=>el.textContent===preflight)).toBe(true);
    act(() => (Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Return to print preview') as HTMLElement).click());
    expect(container.querySelector('[data-canvas-page-id="p1"]')).not.toBeNull();
    expect(useAppStore.getState().pages.map(p=>p.selectedForPrint)).toEqual([true,false]);
  });
  it('switches to the real sheet when a preview-only page is enabled for printing', () => {
    act(() => useAppStore.setState({documents:[doc('d1'),doc('d2')],pages:[makePage('p1','d1'),{...makePage('p2','d2'),selectedForPrint:false}]}));
    act(() => (container.querySelector('[data-page-id="p2"]') as HTMLElement).click());
    act(() => (container.querySelector('[data-page-id="p2"] button') as HTMLElement).click());
    expect(container.textContent).not.toContain('temporary read-only preview');
    expect(useAppStore.getState().activeSheetIndex).toBe(1);
    expect(container.querySelector('[data-sheet-index="1"] [data-canvas-page-id="p2"]')).not.toBeNull();
  });
  it('can preview an excluded page even when there are no printable pages', () => {
    act(() => useAppStore.setState({documents:[doc('d1')],pages:[{...makePage('p1','d1'),selectedForPrint:false}]}));
    act(() => (container.querySelector('[data-page-id="p1"]') as HTMLElement).click());
    expect(container.querySelector('[data-canvas-page-id="p1"]')).not.toBeNull();
    expect(container.textContent).toContain('temporary read-only preview');
    expect(useAppStore.getState().pages[0].selectedForPrint).toBe(false);
  });
  it('does not navigate when a thumbnail print checkbox is clicked', () => {
    act(() => useAppStore.setState({documents:[doc('d1'),doc('d2')]}));
    act(() => (container.querySelector('[data-page-id="p2"] button') as HTMLElement).click());
    expect(useAppStore.getState().activeSheetIndex).toBe(0);
    expect(container.textContent).not.toContain('temporary read-only preview');
    expect(useAppStore.getState().pages[1].selectedForPrint).toBe(false);
  });
  it('uses the same rotated crop mapping for a non-square image', () => {
    const p = {...makePage('p','d'),overrides:{cropBoxMm:{top:0,right:0,bottom:0,left:25}}};
    const style = pageImageStyle(p,90,200,75);
    expect(parseFloat(style.top as string)).toBeCloseTo(100 / 3);
    expect(style.transform).toContain('90deg');
  });
});
