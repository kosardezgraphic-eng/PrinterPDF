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

describe('Alt+F6 resets sheet and design settings while preserving app preferences',()=>{
  it('puts each sheet section and overlay back without touching app preferences or desk files',()=>{
    const state=useAppStore.getState();
    state.updateLayout({rows:3,cols:2,paperSize:'A3',orientation:'landscape',duplexMode:'short-edge'});
    state.updateEffects({invert:true});
    state.updateWatermark({enabled:true,text:'PROOF'});
    state.addShapeOverlay('rectangle');
    state.addNumberingOverlay(true);
    state.updateSettings({unit:'inch',previewFidelity:'fast'});
    useAppStore.setState({documents:[{id:'d',name:'job.pdf',filePath:'job.pdf',fileSize:1,fileType:'pdf',mimeType:'application/pdf',pageCount:1,createdAt:''}],pages:[{id:'p1',documentId:'d',documentName:'job.pdf',sourcePageNumber:1,widthMm:210,heightMm:297,rotation:0,selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:1}]});

    act(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'F6',altKey:true,bubbles:true,cancelable:true}));});

    const after=useAppStore.getState();
    expect(after.layout).toEqual(DEFAULT_LAYOUT);
    expect(after.effects).toEqual(DEFAULT_EFFECTS);
    expect(after.watermark).toEqual(getDefaultWatermarkSettings());
    expect(after.pageNumbering).toEqual(getDefaultPageNumberSettings());
    expect(after.overlays).toEqual([]);
    expect(after.settings).toEqual({...DEFAULT_SETTINGS,language:'en',unit:'inch',previewFidelity:'fast'});
    expect(after.pages.map(page=>page.id)).toEqual(['p1']);                    // the job stays loaded
  });

  it('works while the caret is inside a field, because F6 is not typing',()=>{
    const input=document.createElement('input');
    host.appendChild(input);
    useAppStore.getState().updateLayout({cols:4});
    useAppStore.getState().updateSettings({unit:'cm'});

    act(()=>{input.dispatchEvent(new KeyboardEvent('keydown',{key:'F6',altKey:true,bubbles:true,cancelable:true}));});

    expect(useAppStore.getState().layout.cols).toBe(DEFAULT_LAYOUT.cols);
    expect(useAppStore.getState().settings.unit).toBe('cm');
    input.remove();
  });

  it('leaves the chords alone when Alt is not part of them',()=>{
    useAppStore.getState().updateLayout({cols:4});
    act(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'F6',bubbles:true,cancelable:true}));});
    expect(useAppStore.getState().layout.cols).toBe(4);
  });
});

describe('the defaults entry in the settings modal',()=>{
  it('asks for a second click before it resets, then resets',async()=>{
    await act(async()=>{useAppStore.setState({showSettingsModal:true,documents:[{id:'d',name:'job.pdf',filePath:'job.pdf',fileSize:1,fileType:'pdf',mimeType:'application/pdf',pageCount:1,createdAt:''}],pages:[{id:'p1',documentId:'d',documentName:'job.pdf',sourcePageNumber:1,widthMm:210,heightMm:297,rotation:0,selectedForPrint:true,isHighlighted:true,isBlankPage:false,colorProfile:'color',inkCoveragePercent:1}]});});   // flush the modal into the tree
    useAppStore.getState().updateSettings({unit:'cm'});
    useAppStore.getState().updateLayout({cols:4});
    useAppStore.getState().addShapeOverlay('circle');

    const reset=document.querySelector<HTMLButtonElement>('button[data-reset-settings]');
    expect(reset, 'the profile list has to carry the reset as its first row').toBeTruthy();
    // The chord is on the row instead of being spelled out in the caption: it is the entry's own key.
    expect(reset!.textContent).toMatch(/Reset to defaults/);
    expect(reset!.closest('li')!.textContent).toContain('Alt+F6');
    act(()=>{reset!.click();});
    expect(useAppStore.getState().settings.unit).toBe('cm');       // nothing lost on the first press
    expect(useAppStore.getState().layout).toMatchObject({cols:4});
    expect(useAppStore.getState().overlays).toHaveLength(1);
    expect(document.querySelector<HTMLButtonElement>('button[data-reset-settings]')!.textContent).toMatch(/Press again to reset/);

    act(()=>{document.querySelector<HTMLButtonElement>('button[data-reset-settings]')!.click();});
    expect(useAppStore.getState().settings.unit).toBe('cm');
    expect(useAppStore.getState().layout).toEqual(DEFAULT_LAYOUT);
    expect(useAppStore.getState().overlays).toEqual([]);
  });

  it('edits a profile behind an explicit button, and only there',async()=>{
    const id=useAppStore.getState().saveSettingsPreset('A4 duplex') as string;
    await act(async()=>{useAppStore.setState({showSettingsModal:true});});
    await flush();

    const row=()=>document.querySelector<HTMLDivElement>(`[data-preset-row="${id}"]`)!;
    expect(row(),'the saved profile has to be listed in the panel').toBeTruthy();
    // Closed row: one click to apply, the chord shown, nothing to type into.
    expect(row().querySelector('input[data-preset-name]')).toBeNull();
    expect(row().querySelector('button[data-shortcut-record]')).toBeNull();
    expect(row().textContent).toMatch(/no key/);

    act(()=>{row()!.querySelector<HTMLButtonElement>('button[data-preset-edit]')!.click();});
    expect(useAppStore.getState().editingPresetId).toBe(id);
    expect(row().getAttribute('data-preset-editing')).toBe('true');

    // rename
    const input=row()!.querySelector<HTMLInputElement>('input[data-preset-name]')!;
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
    act(()=>{setter.call(input,'A4 simplex');input.dispatchEvent(new Event('input',{bubbles:true}));});
    act(()=>{input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
    expect(useAppStore.getState().settingsPresets.find(p=>p.id===id)?.name).toBe('A4 simplex');

    // record a chord straight from the keyboard — while the recorder waits, the chord must not fire
    act(()=>{row()!.querySelector<HTMLButtonElement>('button[data-shortcut-record]')!.click();});
    expect(useAppStore.getState().shortcutRecordingFor).toBe(id);
    act(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'F8',altKey:true,bubbles:true,cancelable:true}));});
    expect(useAppStore.getState().settingsPresets.find(p=>p.id===id)?.shortcut).toBe('Alt+F8');
    expect(useAppStore.getState().shortcutRecordingFor).toBeNull();

    // re-capture the sheet into the same profile, and delete it after a confirmation
    useAppStore.getState().updateLayout({cols:3});
    act(()=>{row()!.querySelector<HTMLButtonElement>('button[data-preset-capture]')!.click();});
    expect(useAppStore.getState().settingsPresets.find(p=>p.id===id)?.layout.cols).toBe(3);
    expect(useAppStore.getState().settingsPresets.find(p=>p.id===id)?.name).toBe('A4 simplex');
    const trash=row()!.querySelector<HTMLButtonElement>('button[data-preset-delete]')!;
    act(()=>{trash.click();});
    expect(useAppStore.getState().settingsPresets).toHaveLength(1);   // one click only marks the button
    expect(trash.getAttribute('data-preset-delete')).toBe('confirm');
    act(()=>{document.querySelector<HTMLButtonElement>('button[data-preset-delete="confirm"]')!.click();});
    expect(useAppStore.getState().settingsPresets).toEqual([]);
    // ...and the built-in row stays, because it was never a stored profile
    expect(document.querySelector<HTMLButtonElement>('button[data-reset-settings]')).toBeTruthy();
  });

  it('closes the editor with Done, keeping the name that was typed',async()=>{
    const id=useAppStore.getState().saveSettingsPreset('Before') as string;
    await act(async()=>{useAppStore.setState({showSettingsModal:true});});
    await flush();
    act(()=>{document.querySelector<HTMLButtonElement>(`button[data-preset-edit="${id}"]`)!.click();});
    const input=document.querySelector<HTMLInputElement>(`input[data-preset-name="${id}"]`)!;
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
    act(()=>{setter.call(input,'After');input.dispatchEvent(new Event('input',{bubbles:true}));});
    act(()=>{document.querySelector<HTMLButtonElement>(`button[data-preset-edit-done="${id}"]`)!.click();});
    expect(useAppStore.getState().editingPresetId).toBeNull();
    expect(useAppStore.getState().settingsPresets.find(p=>p.id===id)?.name).toBe('After');
    expect(document.querySelector(`[data-preset-row="${id}"] input[data-preset-name]`)).toBeNull();
  });

  it('opens the editor for the right profile from the ribbon menu',async()=>{
    const id=useAppStore.getState().saveSettingsPreset('From the ribbon','Alt+F9') as string;
    useAppStore.setState({activeRibbonTab:'file'});
    await flush();
    act(()=>{document.querySelector<HTMLButtonElement>('button[data-preset-menu-trigger]')!.click();});
    const menuRow=document.querySelector<HTMLButtonElement>(`button[data-preset-edit="${id}"]`)!.closest('li')!;
    expect(menuRow.textContent).toContain('Alt+F9');                 // the chord is shown in the quick menu too
    expect(document.querySelector('[data-preset-menu] li')!.querySelector('button[data-preset-edit]')).toBeNull();  // the defaults row has none
    act(()=>{document.querySelector<HTMLButtonElement>(`button[data-preset-edit="${id}"]`)!.click();});
    expect(useAppStore.getState().editingPresetId).toBe(id);
    expect(useAppStore.getState().showSettingsModal).toBe(true);       // the edit controls live in the panel
    expect(document.querySelector(`input[data-preset-name="${id}"]`)).toBeTruthy();
  });

  it('will not open an editor for the built-in defaults row',async()=>{
    await act(async()=>{useAppStore.setState({showSettingsModal:true});});
    await flush();
    const row=document.querySelector<HTMLDivElement>(`[data-preset-row="preset:defaults"]`)!;
    expect(row.querySelector('button[data-preset-edit]')).toBeNull();  // nothing to rename, nothing to store
    expect(row.textContent).toMatch(/Shipped defaults/);
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
    // With nothing stored, the menu is not empty: the defaults entry is always the first row, which is
    // what makes the shortcut reachable from the same door as the profiles.
    const menu=document.querySelector('[data-preset-menu]')!;
    expect(menu.textContent).toMatch(/Sheet setup/);
    const rows=menu.querySelectorAll<HTMLButtonElement>('button[data-preset-apply]');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Alt+F6');
    expect(rows[0].getAttribute('data-preset-builtin')).toBe('true');

    act(()=>{document.querySelector<HTMLButtonElement>('button[data-preset-save-current]')!.click();});
    await flush();
    expect(useAppStore.getState().settingsPresets).toHaveLength(1);
    expect(localStorage.getItem('printstudio:presets')).toContain('"name"');

    // Change everything, then reach back for the stored combination.
    useAppStore.getState().updateLayout({cols:4});
    useAppStore.getState().updateSettings({unit:'inch'});
    act(()=>{document.querySelector<HTMLButtonElement>('button[data-preset-menu-trigger]')!.click();});
    const apply=document.querySelector<HTMLButtonElement>('button[data-preset-apply="Profile 1"]');
    expect(apply, 'the saved profile has to be listed by name').toBeTruthy();
    act(()=>{apply!.click();});
    await flush();
    expect(useAppStore.getState().layout).toMatchObject({cols:DEFAULT_LAYOUT.cols});
    // The unit the operator changed after saving stays put: a sheet profile does not own app settings,
    // which is the one thing this row must never do silently.
    expect(useAppStore.getState().settings.unit).toBe('inch');
  });

  it('fires a profile from its recorded chord, and lets the recorder finish in peace',()=>{
    const id=useAppStore.getState().saveSettingsPreset('Duplex', 'Alt+F9') as string;
    useAppStore.getState().updateLayout({cols:4});

    act(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'F9',altKey:true,bubbles:true,cancelable:true}));});
    expect(useAppStore.getState().layout).toMatchObject({cols:DEFAULT_LAYOUT.cols});

    // While a recorder is open, the same chord must not reach the profiles behind it.
    useAppStore.getState().updateLayout({cols:5});
    useAppStore.getState().beginShortcutRecording(id);
    act(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'F9',altKey:true,bubbles:true,cancelable:true}));});
    expect(useAppStore.getState().layout).toMatchObject({cols:5});
  });
});
