import type {ComputedSheetSide,PageItem,PageOverlay,PageOverlayImage,PageOverlayNumbering,PageOverlayText} from '@shared/models';
import {matchesOverlayScope} from './overlayRenderUtils';
import {textPlacements,type TextPlacement} from './textOverlays';

export interface ImagePlacement {
  overlay: PageOverlayImage; image: PageOverlayImage;
  key: string; x:number;y:number;width:number;height:number;
  parentX:number;parentY:number;parentWidth:number;parentHeight:number;parentRotation:number;
  pageId?:string; sheetIndex:number;
  clip?: {x:number;y:number;width:number;height:number};
}
export type OverlayPlacement = TextPlacement | ImagePlacement;

/** Placement of every image overlay on one output side, using the same scope and box rules as text. */
export function imagePlacements(sheet:ComputedSheetSide,totalSheets:number,pages:PageItem[],overlays:PageOverlay[],pageIndices?:Map<string,number>):ImagePlacement[] {
  const images=overlays.filter((o):o is PageOverlayImage=>o.kind==='image');
  if(!images.length)return [];
  const indices=pageIndices ?? new Map(pages.map((page,i)=>[page.id,i+1]));
  const sheetPageIds=sheet.cells.flatMap(c=>c.page?[c.page.id]:[]);
  const result:ImagePlacement[]=[];
  const push=(item:PageOverlayImage,rect:{x:number;y:number;width:number;height:number},key:string,rotation:number,clip?:ImagePlacement['clip'],pageId?:string)=>{
    if(rect.width<=0||rect.height<=0||!Number.isFinite(item.xPercent)||!Number.isFinite(item.yPercent)||!Number.isFinite(item.widthPercent)||!Number.isFinite(item.heightPercent))return;
    result.push({overlay:item,image:item,key,x:rect.x+rect.width*item.xPercent/100,y:rect.y+rect.height*item.yPercent/100,
      width:rect.width*item.widthPercent/100,height:rect.height*item.heightPercent/100,
      parentX:rect.x,parentY:rect.y,parentWidth:rect.width,parentHeight:rect.height,parentRotation:rotation,pageId,sheetIndex:sheet.sideIndex,clip});
  };
  for(const item of images){
    if(item.target==='sheet'){
      if(matchesOverlayScope(item,{pageIndex:0,total:totalSheets,sheetIndex:sheet.sideIndex,sheetPageIds}))
        push(item,{x:0,y:0,width:sheet.widthMm,height:sheet.heightMm},`${item.id}-sheet-${sheet.sideIndex}`,0);
      continue;
    }
    for(const cell of sheet.cells){
      if(!cell.page)continue;
      if(!indices.has(cell.page.id))continue;
      if(!matchesOverlayScope(item,{pageIndex:indices.get(cell.page.id)!,total:pages.length,pageId:cell.page.id,documentId:cell.page.documentId,sheetIndex:sheet.sideIndex,sheetPageIds}))continue;
      push(item,{x:cell.contentXMm,y:cell.contentYMm,width:cell.contentWidthMm,height:cell.contentHeightMm},`${item.id}-${cell.occurrenceKey??cell.cellIndex}`,cell.transform?.rotationDeg??0,
        cell.allowOverflow?undefined:{x:cell.cellXMm,y:cell.cellYMm,width:cell.cellWidthMm,height:cell.cellHeightMm},cell.page.id);
    }
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
  const order=new Map(overlays.map((item,index)=>[item.id,index]));
  const indexOf=(item:PageOverlayText|PageOverlayNumbering|PageOverlayImage)=>order.get(item.id)??0;
  return [...texts.map(p=>({p,key:indexOf(p.text),order:0})),...images.map(p=>({p,key:indexOf(p.overlay),order:1}))]
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
