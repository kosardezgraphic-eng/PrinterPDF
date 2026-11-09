import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {PageOverlayShape} from '@shared/models';
import {DEFAULT_LAYOUT,useAppStore} from '../store/useAppStore';
const shape:PageOverlayShape={id:'shape',kind:'shape',target:'page',targetScope:'all',targetPageIds:[],targetSheetIndex:1,xPercent:10,yPercent:20,widthPercent:30,heightPercent:40,opacity:1,rotation:0,type:'rectangle',fillColor:'transparent',strokeColor:'#000000',strokeWidth:2,strokeStyle:'solid',borderRadius:0};
beforeEach(()=>useAppStore.setState({overlays:[],selectedOverlayId:null,pages:[],documents:[],layout:{...DEFAULT_LAYOUT}}));
describe('overlay persistence and undo',()=>{
  it('adds, edits and removes in separate undoable steps',()=>{
    useAppStore.getState().addOverlay(shape);
    useAppStore.getState().updateOverlay('shape',{xPercent:25});
    expect(useAppStore.getState().overlays[0].xPercent).toBe(25);
    useAppStore.getState().undo();expect(useAppStore.getState().overlays[0].xPercent).toBe(10);
    useAppStore.getState().redo();expect(useAppStore.getState().overlays[0].xPercent).toBe(25);
    useAppStore.getState().removeOverlay('shape');expect(useAppStore.getState().overlays).toHaveLength(0);
    useAppStore.getState().undo();expect(useAppStore.getState().overlays).toHaveLength(1);
  });
  it('does not create history for unknown ids and prevents changing identity or type',()=>{
    useAppStore.getState().addOverlay(shape);const label=useAppStore.getState().undoLabel;
    useAppStore.getState().removeOverlay('missing');expect(useAppStore.getState().undoLabel).toBe(label);
    useAppStore.getState().updateOverlay('shape',{id:'other',kind:'text'} as never);
    expect(useAppStore.getState().overlays[0]).toMatchObject({id:'shape',kind:'shape'});
  });
  it('loads new and old project files, clearing an earlier overlay when missing',async()=>{
    vi.spyOn(useAppStore.getState(),'addToast').mockImplementation(()=>{});
    const old={layout:DEFAULT_LAYOUT,pages:[],documents:[]};
    await useAppStore.getState().openPspProjectFile({text:async()=>JSON.stringify({...old,overlays:[shape]})} as File);
    expect(useAppStore.getState().overlays).toEqual([shape]);
    await useAppStore.getState().openPspProjectFile({text:async()=>JSON.stringify(old)} as File);
    expect(useAppStore.getState().overlays).toEqual([]);
    vi.restoreAllMocks();
  });
});
