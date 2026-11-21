// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {PageItem, SourceDocument} from '@shared/models';
import {App} from '../App';
import {DEFAULT_EFFECTS, DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore} from '../store/useAppStore';

const initialize=useAppStore.getState().initializeWorkspace;
let container:HTMLDivElement;
const page:PageItem={id:'p',documentId:'d',documentName:'d',sourcePageNumber:1,widthMm:100,heightMm:200,rotation:0,
  selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:0,thumbnailDataUrl:'data:image/png;base64,AA=='};
const doc={id:'d',name:'d',filePath:'',fileSize:10,fileType:'pdf',mimeType:'application/pdf',pageCount:1,createdAt:''} as SourceDocument;

beforeEach(() => {
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  useAppStore.setState({initializeWorkspace:vi.fn(async()=>{}),pages:[page],documents:[doc],effects:{...DEFAULT_EFFECTS,invert:true},
    settings:{...DEFAULT_SETTINGS,language:'en',theme:'light'},layout:{...DEFAULT_LAYOUT,duplexMode:'none'},activeSheetIndex:0,viewMode:'single',sidebarTab:'pages',previewPageRequest:null});
  container=document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  useAppStore.setState({initializeWorkspace:initialize});
});

it('uses native light and dark theme classes without shell CSS invert filters while respecting page invert effects', () => {
  const root=createRoot(container);
  act(() => root.render(React.createElement(App)));

  const app=container.querySelector('.theme-light')!;
  expect(app).not.toBeNull();
  expect(app.className).not.toContain('invert');
  expect(app.className).not.toContain('hue-rotate-180');

  const sheet=app.querySelector<HTMLElement>('[data-sheet-canvas-index]')!;
  const thumb=app.querySelector<HTMLElement>('[data-thumbnail-content]')!.parentElement!;
  for(const paper of [sheet,thumb]) {
    expect(paper.style.filter).not.toContain('invert');
    expect((paper.querySelector('img') as HTMLElement).style.filter).toContain('invert(1)');
  }

  act(() => useAppStore.setState({effects:{...DEFAULT_EFFECTS,invert:false}}));
  for(const paper of [sheet,thumb]) {
    expect((paper.querySelector('img') as HTMLElement).style.filter).not.toContain('invert(1)');
  }

  act(() => useAppStore.setState({settings:{...useAppStore.getState().settings,theme:'dark'}}));
  expect(container.querySelector('.theme-light')).toBeNull();
  const darkApp=container.querySelector('.theme-dark');
  expect(darkApp).not.toBeNull();
  expect(darkApp!.className).toContain('dark');
  act(() => root.unmount());
});

