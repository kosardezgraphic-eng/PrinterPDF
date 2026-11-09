// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {readFileSync} from 'node:fs';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {PageItem, SourceDocument} from '@shared/models';
import {App} from '../App';
import {DEFAULT_EFFECTS, DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore} from '../store/useAppStore';
const initialize=useAppStore.getState().initializeWorkspace;
let container:HTMLDivElement, style:HTMLStyleElement;
const page:PageItem={id:'p',documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:100,heightMm:200,rotation:0,
  selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0,thumbnailDataUrl:'data:image/png;base64,AA=='};
const doc={id:'d',name:'d',filePath:'',fileSize:10,fileType:'pdf',mimeType:'application/pdf',pageCount:1,createdAt:''} as SourceDocument;
beforeEach(() => {
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  useAppStore.setState({initializeWorkspace:vi.fn(async()=>{}),pages:[page],documents:[doc],effects:{...DEFAULT_EFFECTS,invert:true},
    settings:{...DEFAULT_SETTINGS,language:'en',theme:'light'},layout:{...DEFAULT_LAYOUT,duplexMode:'none'},activeSheetIndex:0,viewMode:'single',sidebarTab:'pages',previewPageRequest:null});
  style=document.createElement('style');
  const css=readFileSync('app/src/index.css','utf8');
  style.textContent=css.match(/\.theme-light \[data-color-accurate\]\s*\{[^}]+\}/)?.[0] ?? '';
  document.head.appendChild(style);
  container=document.createElement('div');document.body.appendChild(container);
});
afterEach(() => {style.remove();container.remove();useAppStore.setState({initializeWorkspace:initialize});});
it('counter-inverts the complete paper and thumbnail surfaces in light mode while preserving image effects', () => {
  const root=createRoot(container);
  act(() => root.render(React.createElement(App)));
  const app=container.querySelector('.theme-light')!;
  expect(app.className).toContain('invert');
  const sheet=app.querySelector<HTMLElement>('[data-sheet-canvas-index]')!;
  const thumb=app.querySelector<HTMLElement>('[data-thumbnail-content]')!.parentElement!;
  for(const paper of [sheet,thumb]) {
    expect(paper.hasAttribute('data-color-accurate')).toBe(true);
    expect(getComputedStyle(paper).filter).toBe('invert(1) hue-rotate(180deg)');
    expect((paper.querySelector('img') as HTMLElement).style.filter).toContain('invert(1)');
  }
  act(() => useAppStore.setState({settings:{...useAppStore.getState().settings,theme:'dark'}}));
  expect(container.querySelector('.theme-light')).toBeNull();
  expect(getComputedStyle(sheet).filter).not.toBe('invert(1) hue-rotate(180deg)');
  act(() => root.unmount());
});
