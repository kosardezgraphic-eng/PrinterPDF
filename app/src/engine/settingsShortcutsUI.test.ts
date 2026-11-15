// @vitest-environment jsdom
/**
 * The keyboard and the buttons, not the algorithms.
 *
 * Three promises the operator can actually feel: Alt+F6 puts every adjustable setting back the way the
 * app shipped it (and works with the caret sitting in a text field, because a function key is never
 * typing), the reset button asks before it destroys anything, and the vector-preview switch is a real
 * setting that reaches the store rather than a decoration. The preset menu is exercised end to end,
 * because a profile nobody can reach from the ribbon is not "quick access".
 */
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {App} from '../App';
import {DEFAULT_EFFECTS,DEFAULT_LAYOUT,DEFAULT_SETTINGS,useAppStore} from '../store/useAppStore';
import {getDefaultPageNumberSettings,getDefaultWatermarkSettings} from '../engine/watermarkEngine';

let root:Root,host:HTMLDivElement;
async function flush(){for(let i=0;i<6;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});}

beforeEach(()=>{
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  useAppStore.setState({
    initializeWorkspace:vi.fn(async()=>{}),restorePreferences:vi.fn(async()=>{}),
    documents:[],pages:[],bookmarks:[],overlays:[],selectedOverlayId:null,textEdit:null,
    settings:{...DEFAULT_SETTINGS,language:'en'},layout:{...DEFAULT_LAYOUT,duplexMode:'none'},
    effects:{...DEFAULT_EFFECTS},watermark:getDefaultWatermarkSettings(),pageNumbering:getDefaultPageNumberSettings(),
    settingsPresets:[],showSettingsModal:false,activeRibbonTab:'view',
    previewPageRequest:null,activeSheetIndex:0,viewMode:'single',toasts:[],
  } as never);
  localStorage.clear();
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
  act(()=>root.render(React.createElement(App)));
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();});

describe('Alt+F6 resets every setting',()=>{
  it('puts each section back without touching the desk',()=>{
    const state=useAppStore.getState();
    state.updateLayout({rows:3,cols:2,paperSize:'A3'});
    state.updateEffects({invert:true});
    state.updateWatermark({enabled:true,text:'PROOF'});
    state.updateSettings({unit:'inch',previewFidelity:'fast'});
    useAppStore.setState({documents:[{id:'d',name:'job.pdf',filePath:'job.pdf',fileSize:1,fileType:'pdf',mimeType:'application/pdf',pageCount:1,createdAt:''}],pages:[{id:'p1',documentId:'d',documentName:'job.pdf',sourcePageNumber:1,widthMm:210,heightMm:297,rotation:0,selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:1}]});

    act(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'F6',altKey:true,bubbles:true,cancelable:true}));});

    const after=useAppStore.getState();
    expect(after.layout).toEqual(DEFAULT_LAYOUT);
    expect(after.effects).toEqual(DEFAULT_EFFECTS);
    expect(after.watermark).toEqual(getDefaultWatermarkSettings());
    expect(after.pageNumbering).toEqual(getDefaultPageNumberSettings());
    expect(after.settings).toEqual({...DEFAULT_SETTINGS,language:'en'});       // the language is kept
    expect(after.pages.map(page=>page.id)).toEqual(['p1']);                    // the job stays loaded
  });

  it('works while the caret is inside a field, because F6 is not typing',()=>{
    const input=document.createElement('input');
    host.appendChild(input);
    useAppStore.getState().updateSettings({unit:'cm'});

    act(()=>{input.dispatchEvent(new KeyboardEvent('keydown',{key:'F6',altKey:true,bubbles:true,cancelable:true}));});

    expect(useAppStore.getState().settings.unit).toBe(DEFAULT_SETTINGS.unit);
    input.remove();
  });

  it('leaves the chords alone when Alt is not part of them',()=>{
    useAppStore.getState().updateSettings({unit:'cm'});
    act(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'F6',bubbles:true,cancelable:true}));});
    expect(useAppStore.getState().settings.unit).toBe('cm');
  });
});

describe('the reset button in the settings modal',()=>{
  it('asks for a second click before it resets, then resets',async()=>{
    await act(async()=>{useAppStore.setState({showSettingsModal:true});});   // flush the modal into the tree
    useAppStore.getState().updateSettings({unit:'cm'});

    const reset=document.querySelector<HTMLButtonElement>('button[data-reset-settings]');
    expect(reset, 'the modal needs a reset button').toBeTruthy();
    expect(reset!.textContent).toMatch(/Reset all settings to defaults — Alt\+F6/);   // the shortcut is on the button
    act(()=>{reset!.click();});
    expect(useAppStore.getState().settings.unit).toBe('cm');       // nothing lost on the first press
    expect(document.querySelector<HTMLButtonElement>('button[data-reset-settings]')!.textContent).toMatch(/Press again to confirm/);

    act(()=>{document.querySelector<HTMLButtonElement>('button[data-reset-settings]')!.click();});
    expect(useAppStore.getState().settings.unit).toBe(DEFAULT_SETTINGS.unit);
  });

  it('lets the crisp vector preview be switched off from the ribbon',()=>{
    const toggle=document.querySelector<HTMLInputElement>('input[data-crisp-preview-toggle]');
    expect(toggle, 'the view tab needs the vector preview switch').toBeTruthy();
    expect(toggle!.checked).toBe(true);
    act(()=>{toggle!.click();});
    expect(useAppStore.getState().settings.previewFidelity).toBe('fast');
    expect(localStorage.getItem('printstudio:settings')).toContain('"previewFidelity":"fast"');
  });
});

describe('the preset menu in the ribbon',()=>{
  it('saves the current settings as a profile and applies it back in one click',async()=>{
    useAppStore.setState({activeRibbonTab:'file'});
    await flush();
    act(()=>{document.querySelector<HTMLButtonElement>('button[data-preset-menu-trigger]')!.click();});
    expect(document.querySelector('[data-preset-menu]')?.textContent).toMatch(/No saved profiles yet/);

    act(()=>{document.querySelector<HTMLButtonElement>('button[data-preset-save-current]')!.click();});
    await flush();
    expect(useAppStore.getState().settingsPresets).toHaveLength(1);
    expect(localStorage.getItem('printstudio:presets')).toContain('"name"');

    // Change everything, then reach back for the stored combination.
    useAppStore.getState().updateLayout({cols:4});
    useAppStore.getState().updateSettings({unit:'inch'});
    act(()=>{document.querySelector<HTMLButtonElement>('button[data-preset-menu-trigger]')!.click();});
    const apply=document.querySelector<HTMLButtonElement>('button[data-preset-apply]');
    expect(apply, 'the saved profile has to be listed').toBeTruthy();
    act(()=>{apply!.click();});
    await flush();
    expect(useAppStore.getState().layout).toMatchObject({cols:DEFAULT_LAYOUT.cols});
    expect(useAppStore.getState().settings.unit).toBe(DEFAULT_SETTINGS.unit);
  });
});
