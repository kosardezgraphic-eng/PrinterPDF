import type {ComputedSheetSide,PageItem,PageOverlay,PageOverlayText} from '@shared/models';
import {matchesOverlayScope} from './overlayRenderUtils';

export interface TextPlacement {
  text: PageOverlayText; key: string; x:number;y:number;width:number;height:number;
  parentX:number;parentY:number;parentWidth:number;parentHeight:number; parentRotation:number;
  clip?: {x:number;y:number;width:number;height:number};
}
/** Positions refer to the visible page box or the output sheet, measured in mm. */
export function textPlacements(sheet:ComputedSheetSide,totalSheets:number,pages:PageItem[],overlays:PageOverlay[],pageIndices?:Map<string,number>):TextPlacement[] {
  const texts=overlays.filter((o):o is PageOverlayText=>o.kind==='text');
  if(!texts.length)return [];
  const indices=pageIndices ?? new Map(pages.map((page,i)=>[page.id,i+1]));
  const sheetPageIds=sheet.cells.flatMap(c=>c.page?[c.page.id]:[]);
  const result:TextPlacement[]=[];
  for(const item of texts){
    const add=(rect:{x:number;y:number;width:number;height:number},key:string,rotation:number,clip?:TextPlacement['clip'])=>{
      if(rect.width<=0||rect.height<=0||!Number.isFinite(item.xPercent)||!Number.isFinite(item.yPercent)||!Number.isFinite(item.widthPercent)||!Number.isFinite(item.heightPercent))return;
      result.push({text:item,key,x:rect.x+rect.width*item.xPercent/100,y:rect.y+rect.height*item.yPercent/100,
        width:rect.width*item.widthPercent/100,height:rect.height*item.heightPercent/100,
        parentX:rect.x,parentY:rect.y,parentWidth:rect.width,parentHeight:rect.height,parentRotation:rotation,clip});
    };
    if(item.target==='sheet'){
      if(matchesOverlayScope(item,{pageIndex:0,total:totalSheets,sheetIndex:sheet.sideIndex,sheetPageIds}))
        add({x:0,y:0,width:sheet.widthMm,height:sheet.heightMm},`${item.id}-sheet-${sheet.sideIndex}`,0);
    }else{
      for(const cell of sheet.cells){if(!cell.page)continue;
        const pageIndex=indices.get(cell.page.id);if(!pageIndex)continue;
        if(!matchesOverlayScope(item,{pageIndex,total:pages.length,pageId:cell.page.id,sheetIndex:sheet.sideIndex,sheetPageIds}))continue;
        add({x:cell.contentXMm,y:cell.contentYMm,width:cell.contentWidthMm,height:cell.contentHeightMm},`${item.id}-${cell.occurrenceKey??cell.cellIndex}`,cell.transform?.rotationDeg??0,
          cell.allowOverflow?undefined:{x:cell.cellXMm,y:cell.cellYMm,width:cell.cellWidthMm,height:cell.cellHeightMm});
      }
    }
  }
  return result;
}
/** Identical drawing logic is used for preview and PDF rasterization. */
export function drawOverlayText(ctx:CanvasRenderingContext2D,item:PageOverlayText,width:number,height:number,pixelsPerPoint:number){
  ctx.clearRect(0,0,width,height);
  if(item.backgroundColor && item.backgroundColor!=='transparent'){ctx.fillStyle=item.backgroundColor;ctx.fillRect(0,0,width,height);}
  const size=Math.max(8,Math.min(80,item.fontSize))*pixelsPerPoint;
  ctx.font=`${item.italic?'italic ':''}${item.bold?'bold ':''}${size}px "${item.fontFamily.replace(/["\\]/g,'')}", sans-serif`;
  ctx.textBaseline='top';ctx.textAlign=item.align;ctx.direction=/[\u0590-\u08ff]/.test(item.text)?'rtl':'ltr';ctx.fillStyle=item.color;
  const x=item.align==='right'?width:item.align==='center'?width/2:0;
  const lines=item.text.split('\n');
  lines.forEach((line,index)=>{
    const y=index*size*1.25;ctx.fillText(line,x,y,width);
    if(item.underline){const w=Math.min(width,ctx.measureText(line).width);const left=x-(item.align==='right'?w:item.align==='center'?w/2:0);ctx.fillRect(left,y+size,w,Math.max(1,size*.06));}
  });
}
