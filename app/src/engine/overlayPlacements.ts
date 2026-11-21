import type {ComputedSheetSide,PageItem,PageOverlay,PageOverlayImage,PageOverlayNumbering,PageOverlayShape,PageOverlayText} from '@shared/models';
import {matchesOverlayScope} from './overlayRenderUtils';
import {textPlacements,type TextPlacement} from './textOverlays';

export interface ImagePlacement {
  overlay: PageOverlayImage; image: PageOverlayImage;
  key: string; x:number;y:number;width:number;height:number;
  parentX:number;parentY:number;parentWidth:number;parentHeight:number;parentRotation:number;
  pageId?:string; sheetIndex:number;
  clip?: {x:number;y:number;width:number;height:number};
}
export type OverlayPlacement = TextPlacement | ImagePlacement | ShapePlacement;

/** The box an overlay of this kind is measured against, and what it is clipped by. */
type BoxHost = { x:number;y:number;width:number;height:number };

/**
 * One pass over the overlays for every kind that occupies a box on a side — a picture or a drawn shape.
 * Scope, rotation and clipping rules are identical between them, and having two copies of those rules is
 * how a preview and a printed sheet end up disagreeing about one of the two kinds.
 */
function boxPlacements<T extends PageOverlayImage|PageOverlayShape>(
  sheet:ComputedSheetSide,totalSheets:number,pages:PageItem[],overlays:PageOverlay[],kind:T['kind'],pageIndices?:Map<string,number>
):{item:T;rect:BoxHost;key:string;rotation:number;clip?:BoxHost;pageId?:string}[] {
  const wanted=overlays.filter((o):o is T=>o.kind===kind);
  if(!wanted.length)return [];
  const indices=pageIndices ?? new Map(pages.map((page,i)=>[page.id,i+1]));
  const sheetPageIds=sheet.cells.flatMap(c=>c.page?[c.page.id]:[]);
  const result:{item:T;rect:BoxHost;key:string;rotation:number;clip?:BoxHost;pageId?:string}[]=[];
  for(const item of wanted){
    if(item.target==='sheet'){
      if(!matchesOverlayScope(item,{pageIndex:0,total:totalSheets,sheetIndex:sheet.sideIndex,sheetPageIds}))continue;
      // A sheet picture is one picture across the side; only a picture that asks to be repeated is echoed into
      // every populated cell, and a picture dropped *into* a page never is — that is what made a stamp dropped
      // on one cell turn up on all of them.
      if(kind==='image' && (item as unknown as PageOverlayImage).sheetFill==='each-cell'){
        for(const cell of sheet.cells){
          if(!cell.page)continue;
          if(!indices.has(cell.page.id))continue;
          result.push({item,rect:{x:cell.contentXMm,y:cell.contentYMm,width:cell.contentWidthMm,height:cell.contentHeightMm},
            key:`${item.id}-repeat-${cell.occurrenceKey??cell.cellIndex}`,rotation:cell.transform?.rotationDeg??0,
            clip:cell.allowOverflow?undefined:{x:cell.cellXMm,y:cell.cellYMm,width:cell.cellWidthMm,height:cell.cellHeightMm},pageId:cell.page.id});
        }
        continue;
      }
      result.push({item,rect:{x:0,y:0,width:sheet.widthMm,height:sheet.heightMm},key:`${item.id}-sheet-${sheet.sideIndex}`,rotation:0});
      continue;
    }
    for(const cell of sheet.cells){
      if(!cell.page)continue;
      if(!indices.has(cell.page.id))continue;
      if(!matchesOverlayScope(item,{pageIndex:indices.get(cell.page.id)!,total:pages.length,pageId:cell.page.id,documentId:cell.page.documentId,sheetIndex:sheet.sideIndex,sheetPageIds}))continue;
      result.push({item,rect:{x:cell.contentXMm,y:cell.contentYMm,width:cell.contentWidthMm,height:cell.contentHeightMm},
        key:`${item.id}-${cell.occurrenceKey??cell.cellIndex}`,rotation:cell.transform?.rotationDeg??0,
        clip:cell.allowOverflow?undefined:{x:cell.cellXMm,y:cell.cellYMm,width:cell.cellWidthMm,height:cell.cellHeightMm},pageId:cell.page.id});
    }
  }
  return result;
}

/** Placement of every image overlay on one output side, using the same scope and box rules as text. */
export function imagePlacements(sheet:ComputedSheetSide,totalSheets:number,pages:PageItem[],overlays:PageOverlay[],pageIndices?:Map<string,number>):ImagePlacement[] {
  const wanted=boxPlacements<PageOverlayImage>(sheet,totalSheets,pages,overlays,'image',pageIndices);
  if(!wanted.length)return [];
  const result:ImagePlacement[]=[];
  const push=({item,rect,key,rotation,clip,pageId}:typeof wanted[number])=>{
    if(rect.width<=0||rect.height<=0||!Number.isFinite(item.xPercent)||!Number.isFinite(item.yPercent)||!Number.isFinite(item.widthPercent)||!Number.isFinite(item.heightPercent))return;
    result.push({overlay:item,image:item,key,x:rect.x+rect.width*item.xPercent/100,y:rect.y+rect.height*item.yPercent/100,
      width:rect.width*item.widthPercent/100,height:rect.height*item.heightPercent/100,
      parentX:rect.x,parentY:rect.y,parentWidth:rect.width,parentHeight:rect.height,parentRotation:rotation,pageId,sheetIndex:sheet.sideIndex,clip});
  };
  wanted.forEach(push);
  return result;
}

export interface ShapePlacement {
  overlay: PageOverlayShape; shape: PageOverlayShape;
  key: string; x:number;y:number;width:number;height:number;
  parentX:number;parentY:number;parentWidth:number;parentHeight:number;parentRotation:number;
  pageId?:string; sheetIndex:number;
  clip?: {x:number;y:number;width:number;height:number};
}

/** Where each drawn shape lands on one output side — the same box rules a picture follows. */
export function shapePlacements(sheet:ComputedSheetSide,totalSheets:number,pages:PageItem[],overlays:PageOverlay[],pageIndices?:Map<string,number>):ShapePlacement[] {
  const wanted=boxPlacements<PageOverlayShape>(sheet,totalSheets,pages,overlays,'shape',pageIndices);
  const result:ShapePlacement[]=[];
  for(const entry of wanted){
    const {item,rect}=entry;
    if(rect.width<=0||rect.height<=0||!Number.isFinite(item.xPercent)||!Number.isFinite(item.yPercent)||!Number.isFinite(item.widthPercent)||!Number.isFinite(item.heightPercent))continue;
    result.push({overlay:item,shape:item,key:entry.key,
      x:rect.x+rect.width*item.xPercent/100,y:rect.y+rect.height*item.yPercent/100,
      width:rect.width*item.widthPercent/100,height:rect.height*item.heightPercent/100,
      parentX:rect.x,parentY:rect.y,parentWidth:rect.width,parentHeight:rect.height,parentRotation:entry.rotation,
      pageId:entry.pageId,sheetIndex:sheet.sideIndex,clip:entry.clip});
  }
  return result;
}

/**
 * Single z-ordered placement list for the interactive preview. Text, numbering and images are
 * emitted in overlay-array order so what the user sees stacked is also what the export stacks.
 */
export function overlayPlacements(sheet:ComputedSheetSide,totalSheets:number,pages:PageItem[],overlays:PageOverlay[],pageIndices?:Map<string,number>):OverlayPlacement[] {
  const texts=textPlacements(sheet,totalSheets,pages,overlays,pageIndices);
  const images=imagePlacements(sheet,totalSheets,pages,overlays,pageIndices);
  const shapes=shapePlacements(sheet,totalSheets,pages,overlays,pageIndices);
  const order=new Map(overlays.map((item,index)=>[item.id,index]));
  const indexOf=(item:PageOverlayText|PageOverlayNumbering|PageOverlayImage|PageOverlayShape)=>order.get(item.id)??0;
  return [...texts.map(p=>({p,key:indexOf(p.text),order:0})),...shapes.map(p=>({p,key:indexOf(p.overlay),order:1})),...images.map(p=>({p,key:indexOf(p.overlay),order:2}))]
    .sort((a,b)=>a.key-b.key || a.order-b.order)
    .map(entry=>entry.p);
}

/** The rectangle of the picture inside its box in mm, honouring `contain` letterboxing. */
export function imageDrawRect(item:PageOverlayImage,boxWidth:number,boxHeight:number):{x:number;y:number;width:number;height:number} {
  const natural=item.fit==='contain' && item.naturalWidth>0 && item.naturalHeight>0
    ? item.naturalWidth/item.naturalHeight : 0;
  if(natural>0 && boxWidth>0 && boxHeight>0){
    const boxAspect=boxWidth/boxHeight;
    if(natural>boxAspect){const w=boxWidth,h=w/natural;return {x:0,y:(boxHeight-h)/2,width:w,height:h};}
    const h=boxHeight,w=h*natural;return {x:(boxWidth-w)/2,y:0,width:w,height:h};
  }
  return {x:0,y:0,width:boxWidth,height:boxHeight};
}
