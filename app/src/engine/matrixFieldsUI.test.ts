// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Ribbon} from '../components/Ribbon';
import {DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore} from '../store/useAppStore';
let container:HTMLDivElement, root:Root;
function change(input: HTMLInputElement, value:string) {
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  act(() => {setter.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
}
beforeEach(() => {
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  useAppStore.setState({activeRibbonTab:'layout',ribbonCollapsed:false,layout:{...DEFAULT_LAYOUT,rows:1,cols:1},settings:{...DEFAULT_SETTINGS,language:'en'}});
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  act(() => root.render(React.createElement(Ribbon)));
});
afterEach(() => {act(() => root.unmount());container.remove();});
describe('matrix size inputs', () => {
  it('offers only rows and columns for matrix size, not presets or a grid picker', () => {
    const matrix=container.querySelector('[aria-label="Matrix size"]')!;
    expect(matrix.querySelectorAll('input')).toHaveLength(2);
    expect(matrix.querySelectorAll('button')).toHaveLength(0);
    expect(container.textContent).not.toContain('Custom matrix');
  });
  it('keeps incomplete input while typing, clamps on blur, and preserves the other dimension', () => {
    const rows=container.querySelector<HTMLInputElement>('[aria-label="Rows"]')!;
    const cols=container.querySelector<HTMLInputElement>('[aria-label="Columns"]')!;
    change(rows,''); expect(rows.value).toBe(''); expect(useAppStore.getState().layout.rows).toBe(1);
    change(rows,'3'); expect(useAppStore.getState().layout.rows).toBe(3);
    change(cols,'15'); expect(useAppStore.getState().layout.cols).toBe(1);
    act(() => cols.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));
    expect(useAppStore.getState().layout.cols).toBe(10);expect(cols.value).toBe('10');
    change(rows,'0'); act(() => rows.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));
    expect(useAppStore.getState().layout.rows).toBe(1);expect(useAppStore.getState().layout.cols).toBe(10);
    change(cols,'');act(() => cols.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));
    expect(cols.value).toBe('10');expect(useAppStore.getState().layout.cols).toBe(10);
  });
  it('uses named icon buttons with translated titles', () => {
    const tab=container.querySelector<HTMLButtonElement>('[aria-label="Page Layout"]');
    expect(tab?.title).toBe('Page Layout');
  });
});
