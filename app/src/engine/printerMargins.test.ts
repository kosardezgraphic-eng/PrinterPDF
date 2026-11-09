import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PrinterMarginRequest,PrinterMarginResult} from '@shared/models';
import {DEFAULT_LAYOUT,useAppStore} from '../store/useAppStore';
import {ipcBridge} from './ipcBridge';

const hardware = (top=4.2):PrinterMarginResult => ({status:'available',source:'hardware',marginsMm:{top,right:3,bottom:5,left:6}});
const zero:PrinterMarginResult = {status:'available',source:'virtual',marginsMm:{top:0,right:0,bottom:0,left:0}};
const tick = async()=>{await Promise.resolve();await Promise.resolve();};
const deferred = () => {let resolve!: (value:PrinterMarginResult)=>void;const promise=new Promise<PrinterMarginResult>(r=>{resolve=r});return {promise,resolve};};
beforeEach(()=>{
  vi.spyOn(ipcBridge,'getPrinterMargins').mockResolvedValue({status:'unavailable',reason:'test'});
  useAppStore.setState({selectedPrinterName:'',layout:{...DEFAULT_LAYOUT,marginMode:'printer',marginsMm:{top:10,right:10,bottom:10,left:10}}});
});
afterEach(()=>{useAppStore.setState({selectedPrinterName:''});vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('printer imageable margins',()=>{
  it('queries oriented paper and applies all four measured margins, then refreshes on size/orientation',async()=>{
    const spy=vi.mocked(ipcBridge.getPrinterMargins);spy.mockResolvedValue(hardware());
    useAppStore.getState().selectPrinter('physical');await tick();
    expect(spy).toHaveBeenLastCalledWith({printerName:'physical',paperSize:'A4',orientation:'portrait',widthMm:210,heightMm:297});
    expect(useAppStore.getState().layout.marginsMm).toEqual({top:4.2,right:3,bottom:5,left:6});
    useAppStore.getState().updateLayout({paperSize:'Custom',customWidthMm:100,customHeightMm:200,orientation:'landscape'});await tick();
    expect(spy).toHaveBeenLastCalledWith({printerName:'physical',paperSize:'Custom',orientation:'landscape',widthMm:200,heightMm:100});
    expect(spy).toHaveBeenCalledTimes(2);
    useAppStore.getState().refreshPrinterMargins();await tick();expect(spy).toHaveBeenCalledTimes(3);
  });
  it('rejects stale printer and paper responses even when they arrive out of order',async()=>{
    const a=deferred(),b=deferred(),c=deferred();vi.mocked(ipcBridge.getPrinterMargins).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(c.promise);
    useAppStore.getState().selectPrinter('first');useAppStore.getState().selectPrinter('second');useAppStore.getState().updateLayout({orientation:'landscape'});
    c.resolve(hardware(8));await tick();b.resolve(zero);a.resolve(hardware(1));await tick();
    expect(useAppStore.getState().layout.marginsMm.top).toBe(8);expect(useAppStore.getState().printerMargins).toEqual(hardware(8));
  });
  it('does not overwrite a manual change made during a pending request; reset and undo preserve mode',async()=>{
    const req=deferred();vi.mocked(ipcBridge.getPrinterMargins).mockReturnValue(req.promise);
    useAppStore.getState().selectPrinter('physical');useAppStore.getState().updateMargins({top:12});
    req.resolve(hardware());await tick();
    expect(useAppStore.getState().layout.marginsMm.top).toBe(12);expect(useAppStore.getState().layout.marginMode).toBe('custom');
    useAppStore.getState().resetMarginsToPrinter();expect(useAppStore.getState().layout.marginsMm.top).toBe(4.2);
    useAppStore.getState().undo();expect(useAppStore.getState().layout.marginsMm.top).toBe(12);expect(useAppStore.getState().layout.marginMode).toBe('custom');
    useAppStore.getState().redo();expect(useAppStore.getState().layout.marginMode).toBe('printer');expect(useAppStore.getState().layout.marginsMm.top).toBe(4.2);
  });
  it('keeps existing values when unavailable, invalid, or a call fails; reset cannot claim a result',async()=>{
    const spy=vi.mocked(ipcBridge.getPrinterMargins);spy.mockResolvedValueOnce({status:'unavailable',reason:'no imageable area'}).mockResolvedValueOnce(hardware(-1)).mockRejectedValueOnce(new Error('offline'));
    useAppStore.getState().selectPrinter('physical');await tick();
    expect(useAppStore.getState().printerMargins.status).toBe('unavailable');useAppStore.getState().resetMarginsToPrinter();expect(useAppStore.getState().layout.marginsMm.top).toBe(10);
    useAppStore.getState().refreshPrinterMargins();await tick();expect(useAppStore.getState().printerMargins.status).toBe('unavailable');
    useAppStore.getState().refreshPrinterMargins();await tick();expect(useAppStore.getState().printerMargins.status).toBe('unavailable');expect(useAppStore.getState().layout.marginsMm.top).toBe(10);
  });
  it('uses zero virtual margins, preserves custom values on printer changes, and restores old projects as custom',async()=>{
    vi.mocked(ipcBridge.getPrinterMargins).mockResolvedValue(zero);
    useAppStore.getState().selectPrinter('virtual');await tick();expect(useAppStore.getState().layout.marginsMm).toEqual({top:0,right:0,bottom:0,left:0});
    useAppStore.getState().updateMargins({left:9});useAppStore.getState().selectPrinter('other');await tick();expect(useAppStore.getState().layout.marginsMm.left).toBe(9);
    const layout={...DEFAULT_LAYOUT,marginsMm:{top:7,right:7,bottom:7,left:7}};delete layout.marginMode;
    await useAppStore.getState().openPspProjectFile({text:async()=>JSON.stringify({layout,pages:[],documents:[]})} as File);
    expect(useAppStore.getState().layout.marginMode).toBe('custom');expect(useAppStore.getState().layout.marginsMm.top).toBe(7);
  });
  it('browser simulator labels virtual zero and cannot invent physical measurements',async()=>{
    vi.restoreAllMocks();vi.stubGlobal('window',{});
    const req:PrinterMarginRequest={printerName:'PrintStudio Virtual Printer',paperSize:'A4',orientation:'portrait',widthMm:210,heightMm:297};
    expect(await ipcBridge.getPrinterMargins(req)).toMatchObject({status:'available',source:'simulated-virtual',marginsMm:{top:0,right:0,bottom:0,left:0}});
    expect(await ipcBridge.getPrinterMargins({...req,printerName:'HP LaserJet Enterprise M611dn (High-Speed B&W)'})).toMatchObject({status:'unavailable'});
  });
});
