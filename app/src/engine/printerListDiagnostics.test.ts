// @vitest-environment jsdom
/**
 * The printer list must never be silently empty.
 *
 * Every failure mode we actually hit on Windows looked the same from the outside: a blank printer
 * picker. These tests pin what makes it diagnosable instead — the preload/bridge wiring that lets
 * `window.printStudioAPI` exist at all under a sandboxed renderer, the store keeping the sidecar's
 * own explanation, and the retry control that re-runs the call.
 */
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PrinterInfo} from '@shared/models';
import {DEFAULT_SETTINGS,useAppStore} from '../store/useAppStore';
import {ipcBridge} from './ipcBridge';
import {PrinterRetryButton,PrinterServiceStatus} from '../components/PrinterStatus';

const read=(rel:string)=>readFileSync(new URL(rel,import.meta.url),'utf8');
const pkg=JSON.parse(read('../../../package.json')) as {scripts:Record<string,string>};

const printer=(name:string,overrides:Partial<PrinterInfo>={}):PrinterInfo=>({
  name,driverName:'Generic',portName:'PORT1:',isDefault:false,isNetwork:false,isVirtual:false,
  status:'Ready',jobsInQueue:0,location:'',
  capabilities:{supportedPapers:['A4'],supportedTrays:['Tray1'],supportedMediaTypes:['Plain Paper'],supportsDuplex:true,supportsColor:true,supportedDpi:[300,600],maxCopies:999},
  activeProfile:{printerName:name,paperSize:'A4',tray:'Tray1',mediaType:'Plain Paper',duplexMode:'long-edge',orientation:'portrait',colorMode:'color',dpi:600,quality:'normal'},
  ...overrides,
});

let container:HTMLDivElement,root:Root;
const mount=async()=>{
  if (root) act(()=>root.unmount());
  // The store subscription settles a microtask after render, so flush it inside act().
  act(()=>{
    root=createRoot(container);
    root.render(React.createElement(React.Fragment,null,React.createElement(PrinterServiceStatus),React.createElement(PrinterRetryButton)));
  });
  await act(async()=>{});
};
const text=()=>container.textContent??'';
const click=async(selector:string)=>{
  const node=container.querySelector<HTMLButtonElement>(selector)!;
  await act(async()=>{node.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  await act(async()=>{});
};

beforeEach(()=>{
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  container=document.createElement('div');
  document.body.appendChild(container);
  useAppStore.setState({printers:[],selectedPrinterName:'',printerServiceError:null,printerServiceNote:null,
    isRefreshingPrinters:false,printerMargins:{status:'unavailable',reason:'test'},
    settings:{...DEFAULT_SETTINGS,language:'en'},toasts:[]});
  // Hard-margin refresh is noise in these tests and resolves outside act() if left live.
  vi.spyOn(ipcBridge,'getPrinterMargins').mockResolvedValue({status:'unavailable',reason:'test'});
  vi.spyOn(ipcBridge,'getPrinterStatusNote').mockResolvedValue(null);
});
afterEach(()=>{
  if (root) act(()=>root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('sidecar wiring for a sandboxed renderer',()=>{
  it('builds the preload as a single CommonJS file the sandbox can load',()=>{
    const build=pkg.scripts['build:preload'];
    expect(build).toContain('esbuild electron/preload.ts');
    expect(build).toContain('--bundle');
    expect(build).toContain('--platform=node');
    expect(build).toContain('--format=cjs');
    expect(build).toContain('--external:electron');
    expect(build).toContain('dist-electron/electron/preload.cjs');
    // The main process must point at that bundle, and keep the sandbox on.
    const main=read('../../../electron/main.ts');
    expect(main).toContain(`path.join(__dirname, 'preload.cjs')`);
    expect(main).toContain('sandbox: true');
    expect(main).toContain('contextIsolation: true');
  });

  it('runs Electron with the dev server URL so the app does not fall back to simulated printers',()=>{
    // Plain `npm run dev` is the browser preview; `electron:dev` is the desktop one.
    expect(pkg.scripts['dev']).not.toContain('VITE_DEV_SERVER_URL');
    expect(pkg.scripts['dev:electron']).toContain('VITE_DEV_SERVER_URL=http://localhost:5173');
    expect(pkg.scripts['dev:electron']).toContain('wait-on');
    expect(pkg.scripts['electron:dev']).toMatch(/dev:vite.*dev:electron/s);
    expect(pkg.scripts['electron:dev']).toContain('build:preload');
    expect(pkg.scripts['electron:dev']).toContain('ensure-sidecar.mjs');
    expect(pkg.scripts['build:electron']).toMatch(/build:service[\s\S]*vite build[\s\S]*electron-builder/);
  });

  it('keeps the sidecar process output and refuses to answer with a bare empty list',()=>{
    const sidecar=read('../../../electron/printerSidecarClient.ts');
    expect(sidecar).toContain(`stdio: ['ignore', 'ignore', 'pipe']`);
    expect(sidecar).toContain('startupError');
    expect(sidecar).toContain('describeFailure');
    // The silent early returns used to be the reason nothing was ever explained.
    expect(sidecar).toContain('PrinterService.exe was not found');
    expect(sidecar).toContain('npm run build:service');
    const main=read('../../../electron/main.ts');
    expect(main).toContain('withSidecarDiagnostics');
    expect(main).toContain('PRINTER_STATUS_NOTE');
  });
});

describe('ipcBridge status note',()=>{
  // These exercise the real bridge, not the store-level spy installed above.
  beforeEach(()=>{vi.mocked(ipcBridge.getPrinterStatusNote).mockRestore();});

  it('labels the browser preview as simulated instead of claiming it read Windows',async()=>{
    vi.stubGlobal('window',{});
    vi.stubGlobal('navigator',{userAgent:'Mozilla/5.0 Chrome/120'});
    expect(await ipcBridge.getPrinterStatusNote()).toMatch(/simulated/i);
  });
  it('forwards the desktop explanation and tolerates an older preload',async()=>{
    vi.stubGlobal('window',{printStudioAPI:{isElectron:true,getPrinterStatusNote:vi.fn().mockResolvedValue('PrinterService.exe is missing')}});
    expect(await ipcBridge.getPrinterStatusNote()).toBe('PrinterService.exe is missing');
    vi.stubGlobal('window',{printStudioAPI:{isElectron:true}});
    expect(await ipcBridge.getPrinterStatusNote()).toMatch(/older/i);
  });
  it('still refuses simulated printers when Electron has no bridge',async()=>{
    vi.stubGlobal('window',{});
    vi.stubGlobal('navigator',{userAgent:'Electron/34.0.0'});
    await expect(ipcBridge.listPrinters()).rejects.toThrow('preload bridge');
  });
});

describe('retryPrinters',()=>{
  it('replaces the empty list with real printers and clears the error',async()=>{
    vi.stubGlobal('window',{printStudioAPI:{isElectron:true,
      listPrinters:vi.fn().mockResolvedValue([printer('HP LaserJet')]),
      getPrinterStatusNote:vi.fn().mockResolvedValue(null)}});
    useAppStore.setState({printerServiceError:'pipe gone'});
    await useAppStore.getState().retryPrinters();
    const state=useAppStore.getState();
    expect(state.printers.map(p=>p.name)).toEqual(['HP LaserJet']);
    expect(state.selectedPrinterName).toBe('HP LaserJet');
    expect(state.printerServiceError).toBeNull();
    expect(state.toasts.at(-1)?.type).toBe('info');
  });

  it('keeps the exact reason and raises a toast when the sidecar fails',async()=>{
    vi.stubGlobal('window',{printStudioAPI:{isElectron:true,
      listPrinters:vi.fn().mockRejectedValue(new Error('no process is listening on \\\\.\\pipe\\PrintStudioPrinterService (ENOENT)'))}});
    vi.mocked(ipcBridge.getPrinterStatusNote).mockResolvedValue('PrinterService.exe was not found. Build it with "npm run build:service"');
    await useAppStore.getState().retryPrinters();
    const state=useAppStore.getState();
    expect(state.printers).toEqual([]);
    expect(state.printerServiceError).toContain('no process is listening');
    expect(state.printerServiceNote).toContain('PrinterService.exe was not found');
    expect(state.isRefreshingPrinters).toBe(false);
    expect(state.toasts.at(-1)?.type).toBe('error');
    expect(state.toasts.at(-1)?.message).toContain('npm run build:service');
  });

  it('falls back to the default printer when the selected one disappeared',async()=>{
    vi.stubGlobal('window',{printStudioAPI:{isElectron:true,
      listPrinters:vi.fn().mockResolvedValue([printer('Ghostscript PDF',{isDefault:true})]),
      getPrinterStatusNote:vi.fn().mockResolvedValue(null)}});
    useAppStore.setState({selectedPrinterName:'Removed Printer'});
    await useAppStore.getState().retryPrinters();
    expect(useAppStore.getState().selectedPrinterName).toBe('Ghostscript PDF');
  });

  it('reports an empty list as an empty list, not as success',async()=>{
    vi.stubGlobal('window',{printStudioAPI:{isElectron:true,
      listPrinters:vi.fn().mockResolvedValue([]),
      getPrinterStatusNote:vi.fn().mockResolvedValue(null)}});
    await useAppStore.getState().retryPrinters();
    expect(useAppStore.getState().toasts.at(-1)?.type).toBe('warning');
  });
});

describe('printer status panel',()=>{
  it('explains a missing sidecar instead of showing nothing',async()=>{
    useAppStore.setState({printerServiceError:'PrinterService.exe was not found. Build it with "npm run build:service"'});
    await mount();
    expect(text()).toContain('could not be read');
    expect(text()).toContain('PrinterService.exe was not found');
    expect(text()).toContain('npm run build:service');
  });

  it('explains a healthy-but-empty Windows list',async()=>{
    useAppStore.setState({printers:[]});
    await mount();
    expect(text()).toContain('no printers');
  });

  it('shows the sidecar note even when no call has failed yet',async()=>{
    useAppStore.setState({printers:[],printerServiceNote:'PrinterService.exe stopped before the app connected (exit code 1).'});
    await mount();
    expect(text()).toContain('exit code 1');
  });

  it('stays quiet while printers are listed and healthy',async()=>{
    useAppStore.setState({printers:[printer('Konica Minolta bizhub C458')]});
    await mount();
    expect(text()).toBe('Retry');
  });

  it('the retry button re-runs listPrinters',async()=>{
    const listPrinters=vi.fn().mockResolvedValue([printer('Ricoh MP 2501')]);
    vi.stubGlobal('window',{printStudioAPI:{isElectron:true,listPrinters,
      getPrinterStatusNote:vi.fn().mockResolvedValue(null)}});
    await mount();
    await click('button[aria-label="Retry reading printers"]');
    expect(listPrinters).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().printers.map(p=>p.name)).toEqual(['Ricoh MP 2501']);
    expect(text()).toBe('Retry');
  });
});
