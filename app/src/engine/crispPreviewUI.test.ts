// @vitest-environment jsdom
/**
 * The cell-level half of the crisp preview: what a sheet cell does with a rendered frame.
 *
 * jsdom has no 2D canvas and no workers, which is exactly the pair of conditions the component has to
 * survive: a cell must paint a frame it is given, must stay invisible (not unmounted) while nothing has
 * arrived, and must not explode when the environment cannot render vectors at all. The context is
 * stubbed, so `drawImage` is observed rather than trusted.
 */
import React,{act,useRef} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {CrispPageCanvas,useCrispPageFrame} from '../components/CrispPageCanvas';
import {VectorPreviewRenderer,type VectorFrame,type VectorRenderQuery} from '../engine/vectorPreview';
import {__setVectorRendererForTests,configureVectorPreview,supportsCrispPreview} from '../engine/vectorPreviewBridge';
import {DEFAULT_EFFECTS,DEFAULT_LAYOUT,DEFAULT_SETTINGS,useAppStore} from '../store/useAppStore';
import type {PageItem} from '@shared/models';

const page:PageItem={id:'p1',documentId:'doc-1',documentName:'plate.pdf',sourcePageNumber:3,widthMm:210,heightMm:297,
  rotation:0,selectedForPrint:true,isHighlighted:false,isBlankPage:false,colorProfile:'color',inkCoveragePercent:2,
  thumbnailDataUrl:'data:image/png;base64,aaa'};

let root:Root,host:HTMLDivElement,drawImage:ReturnType<typeof vi.fn>,paints:number;
const bytes=new Uint8Array([1,2,3]);

/** A cell that asks for one page at one size and paints whatever comes back. */
function Probe({enabled=true}:{enabled?:boolean}) {
  const ref=useRef<HTMLDivElement|null>(null);
  const {frame}=useCrispPageFrame({page,enabled,width:420,height:600,hostRef:ref});
  return React.createElement('div',{ref,'data-host':true,style:{width:420,height:600,position:'relative'}},
    enabled?React.createElement(CrispPageCanvas,{page,effects:DEFAULT_EFFECTS,width:420,height:600,style:{},frame,className:'crisp'}):null);
}

beforeEach(()=>{
  (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  paints=0;
  drawImage=vi.fn(()=>{paints+=1;});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>
    ({clearRect:vi.fn(),drawImage,imageSmoothingQuality:'high'}) as unknown as CanvasRenderingContext2D);
  useAppStore.setState({settings:{...DEFAULT_SETTINGS,previewFidelity:'crisp'},layout:{...DEFAULT_LAYOUT},documents:[
    {id:'doc-1',name:'plate.pdf',filePath:'plate.pdf',fileSize:3,fileType:'pdf',mimeType:'application/pdf',pageCount:3,createdAt:'',rawBytes:bytes},
  ]} as never);
  configureVectorPreview({
    bytes:docId=>docId==='doc-1'?bytes:null,
    documents:()=>useAppStore.getState().documents,
  });
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(()=>{
  act(()=>root.unmount());host.remove();vi.restoreAllMocks();__setVectorRendererForTests(null);
});

/** A renderer over a transport that resolves immediately, so the cache path is the one under test. */
function fakeRenderer(frame:VectorFrame){
  const transport={
    open:vi.fn(async()=>1),
    render:vi.fn(async(_query:VectorRenderQuery&{taskId:string})=>frame),
    cancel:vi.fn(),
    close:vi.fn(),
  };
  const renderer=new VectorPreviewRenderer({transportFactory:()=>transport,concurrency:2});
  return {renderer,transport};
}

async function flush(){for(let i=0;i<6;i++)await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});}

describe('the crisp layer in a sheet cell',()=>{
  it('paints the frame it is given at the size it was rendered in',async()=>{
    const source={} as unknown as CanvasImageSource;
    const {renderer,transport}=fakeRenderer({source,width:480,height:672});
    __setVectorRendererForTests(renderer);

    await act(async()=>{root.render(React.createElement(Probe));await flush();});

    expect(transport.open).toHaveBeenCalledWith('doc-1',bytes);
    expect(transport.render).toHaveBeenCalledWith(expect.objectContaining({docId:'doc-1',pageNumber:3,width:480,height:672}));
    const canvas=host.querySelector<HTMLCanvasElement>('canvas.crisp')!;
    expect(canvas.getAttribute('data-crisp-size')).toBe('480x672');   // device pixels, not CSS pixels
    expect(canvas.width).toBe(480);
    expect(canvas.height).toBe(672);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage.mock.calls[0][0]).toBe(source);
  });

  it('sizes the request to the cell, not to the file: a zoomed cell asks for a bigger page',async()=>{
    const {renderer,transport}=fakeRenderer({source:{} as unknown as CanvasImageSource,width:96,height:96});
    __setVectorRendererForTests(renderer);
    await act(async()=>{root.render(React.createElement(Probe));await flush();});
    // 420×600 CSS px at ratio 1 lands on the 96 px grid: 480 and 672.
    const query=transport.render.mock.calls[0][0];
    expect(query.width).toBe(480);
    expect(query.height).toBe(672);
    expect(renderer.cachedCount).toBe(1);
  });

  it('keeps the cell painted while a render is still owed, instead of showing a hole',async()=>{
    const transport={open:vi.fn(async()=>1),render:vi.fn(()=>new Promise<never>(()=>{})),cancel:vi.fn(),close:vi.fn()};
    __setVectorRendererForTests(new VectorPreviewRenderer({transportFactory:()=>transport,concurrency:2}));

    await act(async()=>{root.render(React.createElement(Probe));await flush();});

    const canvas=host.querySelector<HTMLCanvasElement>('canvas.crisp')!;
    expect(canvas.style.visibility).toBe('hidden');            // the thumbnail underneath is what is seen
    expect(paints).toBe(0);
    expect(transport.render).toHaveBeenCalledTimes(1);
  });

  it('cancels the render when the cell goes away mid-flight',async()=>{
    const transport={open:vi.fn(async()=>1),render:vi.fn(()=>new Promise<never>(()=>{})),cancel:vi.fn(),close:vi.fn()};
    __setVectorRendererForTests(new VectorPreviewRenderer({transportFactory:()=>transport,concurrency:2}));
    await act(async()=>{root.render(React.createElement(Probe));await flush();});

    await act(async()=>{root.unmount();});

    expect(transport.cancel).toHaveBeenCalledTimes(1);
  });

  it('renders no layer at all when the operator chose the light mode',async()=>{
    const {renderer,transport}=fakeRenderer({source:{} as unknown as CanvasImageSource,width:96,height:96});
    __setVectorRendererForTests(renderer);
    await act(async()=>{root.render(React.createElement(Probe,{enabled:false}));await flush();});
    expect(transport.render).not.toHaveBeenCalled();
    expect(host.querySelector('canvas.crisp')).toBeNull();
  });

  it('refuses to promise a crisp page for a file that has no vectors in it',()=>{
    expect(supportsCrispPreview({documentId:'doc-1',sourcePageNumber:3})).toBe(true);
    expect(supportsCrispPreview({documentId:'doc-1',sourcePageNumber:0})).toBe(false);   // a blank sheet
    expect(supportsCrispPreview({documentId:'missing',sourcePageNumber:1})).toBe(false);  // file closed
    useAppStore.setState({documents:[{...useAppStore.getState().documents[0],fileType:'image',rawBytes:undefined}]} as never);
    expect(supportsCrispPreview({documentId:'doc-1',sourcePageNumber:1})).toBe(false);
  });

  it('releases a bitmap the cache drops, which is what makes the limit mean anything',async()=>{
    let released=false;
    const tracked=new VectorPreviewRenderer({transportFactory:()=>({
      open:async()=>1,
      render:async()=>({source:{} as unknown as CanvasImageSource,width:10,height:10,close:()=>{released=true;}}),
      cancel:()=>{},close:()=>{},
    }),concurrency:1,maxEntries:16});
    const ask=async(pageNumber:number)=>{
      let release:()=>void=()=>{};
      await act(async()=>{
        release=tracked.subscribe({docId:'d',pageNumber,width:96,height:96,bytes:()=>bytes},()=>{});
        await new Promise(resolve=>setTimeout(resolve,0));
      });
      release();
    };
    for(let pageNumber=1;pageNumber<=16;pageNumber+=1) await ask(pageNumber);
    expect(released).toBe(false);                      // still inside the bound, nothing dropped
    await ask(17);                                     // one page too many
    expect(released).toBe(true);                       // the oldest was closed, not merely forgotten
    expect(tracked.cachedCount).toBe(16);

    await act(async()=>{tracked.clear();});
    expect(tracked.cachedCount).toBe(0);
  });
});
