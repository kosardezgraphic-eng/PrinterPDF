import { planPictureEmbedding } from './imageFormat';
import { applyEraseToContext, invertPixelsInContext } from './imageErase';
import {
  decodeUniversalImageToPages,
  decodedPageToDataUrl,
  detectUniversalImageFormat,
} from './universalImageDecoder';
const IMAGE_NAME=/\.(jpe?g|png|webp|gif|bmp|tiff?|svg)$/i;
/** Files that may become an on-page picture overlay rather than a new document. */
export function isImageFile(file:File):boolean{
  return (file.type?.startsWith('image/')??false) || IMAGE_NAME.test(file.name??'');
}
/**
 * Whether pdf-lib can store the bytes as they are. The decision comes from the file header — the
 * same `planPictureEmbedding` the exporter follows — so a picture is never previewed as a raw
 * embed and printed through Canvas, or the other way round, and a lying `data:image/png` prefix
 * cannot send a JPEG stream to the PNG decoder.
 */
export function isDirectlyEmbeddable(src:string):boolean{
  return planPictureEmbedding(src).route!=='raster';
}
/** What the exporter will do with this picture, in one line for the panel. */
export function pictureEmbeddingNote(src:string):string{
  return planPictureEmbedding(src).notes.join('; ');
}
/** Drag-over data can only tell us a file is coming, not its type; that is enough for the hint. */
export function hasImageTransfer(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types ?? []);
  if (!types.includes('Files')) return false;
  const items = Array.from(dataTransfer.items ?? []);
  if (items.length) return items.some(item => item.kind === 'file' && (item.type?.startsWith('image/') || IMAGE_NAME.test(item.getAsFile()?.name ?? item.type ?? '')));
  const files = Array.from(dataTransfer.files ?? []);
  return files.length ? files.some(isImageFile) : true;
}
export interface DroppedFilePlan{images:File[];documents:File[]}
/** A picture dropped on a preview sheet is an overlay; anywhere else in the app — and every non-image file — is a new document. */
export function routeDroppedFiles(files:File[],droppedOnSheet:boolean):DroppedFilePlan{
  if(!droppedOnSheet)return {images:[],documents:files};
  const images=files.filter(isImageFile);
  return {images,documents:files.filter(file=>!images.includes(file))};
}
export async function readFileAsDataUrl(file:File):Promise<string>{
  if (typeof file === 'string') return file;
  if (typeof file.arrayBuffer === 'function') {
    const ab = await file.arrayBuffer();
    if (ab.byteLength > 0) {
      const bytes = new Uint8Array(ab);
      const fmt = detectUniversalImageFormat(bytes, file.name ?? '', file.type ?? '');
      if (fmt === 'tiff' || fmt === 'psd' || fmt === 'heic') {
        const pages = await decodeUniversalImageToPages(bytes, file.name ?? 'image', file.type ?? '');
        if (pages[0]) return decodedPageToDataUrl(pages[0]);
      }
    }
  }
  if (typeof FileReader === 'undefined') throw new Error('This environment cannot read the dropped file');
  return new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result));
    reader.onerror=()=>reject(reader.error??new Error('Cannot read the dropped file'));
    reader.readAsDataURL(file);
  });
}
export interface NaturalSize{width:number;height:number}
/** Measures a data URL; falls back to 1×1 so a stalled decoder can never block the drop. */
export function measureImage(src:string):Promise<NaturalSize>{
  if (typeof Image === 'undefined') return Promise.resolve({width:1,height:1});
  return new Promise<NaturalSize>(resolve=>{
    let settled=false;
    const done=(size:NaturalSize)=>{if(settled)return;settled=true;clearTimeout(timer);img.onload=null;img.onerror=null;resolve(size);};
    const timer=setTimeout(()=>done({width:1,height:1}),4000);
    const img=new Image();
    img.onload=()=>done(img.naturalWidth>0&&img.naturalHeight>0?{width:img.naturalWidth,height:img.naturalHeight}:{width:1,height:1});
    img.onerror=()=>done({width:1,height:1});
    img.src=src;
  });
}
/** Draws a picture into the same box the preview shows, so flips and letterboxing match exactly. */
export async function rasterizeOverlayImage(src:string,boxWidthPx:number,boxHeightPx:number,options:{fit?:'fill'|'contain';naturalWidth?:number;naturalHeight?:number;flipHorizontal?:boolean;flipVertical?:boolean;drawRect?:{x:number;y:number;width:number;height:number};
  /** The picture's own colour inversion, negated over the drawn rectangle only — a letterbox stays transparent. */
  invert?:boolean;
  /** The eraser's gestures, punched out with `destination-out` after the picture is drawn. */
  erase?:import('@shared/models').EraseShape[];
  /** Millimetre size of the drawn rectangle, so a brush radius in mm can be turned into pixels. */
  eraseWidthMm?:number;eraseHeightMm?:number;}):Promise<string>{
  if (typeof document === 'undefined') throw new Error('Picture overlays need a Canvas 2D renderer');
  const width=Math.max(1,Math.round(boxWidthPx)),height=Math.max(1,Math.round(boxHeightPx));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Picture overlay Canvas 2D is unavailable');
  ctx.clearRect(0,0,width,height);
  const image=await loadImage(src);
  const rect=options.drawRect??{x:0,y:0,width,height}; // callers pass the same fit box the preview uses
  ctx.save();
  ctx.translate(width/2,height/2);
  ctx.scale(options.flipHorizontal?-1:1,options.flipVertical?-1:1);
  ctx.drawImage(image,rect.x-width/2,rect.y-height/2,rect.width,rect.height);
  ctx.restore();
  // The two flags the model holds and the paper has to see, in the order the operator expects: the colours
  // first, then the holes — an erased pixel must not come back inverted.
  const painted={x:rect.x,y:rect.y,width:rect.width,height:rect.height};
  if(options.invert) invertPixelsInContext(ctx,painted);
  if(options.erase && options.erase.length){
    if(!(options.eraseWidthMm && options.eraseWidthMm>0) || !(options.eraseHeightMm && options.eraseHeightMm>0))
      throw new Error('An eraser brush needs the millimetre size of the picture it erases');
    ctx.save();ctx.translate(painted.x,painted.y);
    applyEraseToContext(ctx,options.erase,{width:painted.width,height:painted.height,widthMm:options.eraseWidthMm,heightMm:options.eraseHeightMm});
    ctx.restore();
  }
  const dataUrl = canvas.toDataURL('image/png');
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
}
function loadImage(src:string):Promise<HTMLImageElement>{
  if (typeof Image === 'undefined') throw new Error('This environment cannot decode the embedded picture');
  return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('The embedded picture could not be decoded'));img.src=src;});
}
