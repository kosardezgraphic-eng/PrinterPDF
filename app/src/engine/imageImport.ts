const IMAGE_NAME=/\.(jpe?g|png|webp|gif|bmp|tiff?|svg)$/i;
/** Files that may become an on-page picture overlay rather than a new document. */
export function isImageFile(file:File):boolean{
  return (file.type?.startsWith('image/')??false) || IMAGE_NAME.test(file.name??'');
}
/** Formats pdf-lib can embed without resampling. */
export function isDirectlyEmbeddable(src:string):boolean{
  return /^data:image\/(png|jpe?g);/i.test(src);
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
export async function rasterizeOverlayImage(src:string,boxWidthPx:number,boxHeightPx:number,options:{fit?:'fill'|'contain';naturalWidth?:number;naturalHeight?:number;flipHorizontal?:boolean;flipVertical?:boolean;drawRect?:{x:number;y:number;width:number;height:number}}):Promise<string>{
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
  return canvas.toDataURL('image/png');
}
function loadImage(src:string):Promise<HTMLImageElement>{
  if (typeof Image === 'undefined') throw new Error('This environment cannot decode the embedded picture');
  return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('The embedded picture could not be decoded'));img.src=src;});
}
