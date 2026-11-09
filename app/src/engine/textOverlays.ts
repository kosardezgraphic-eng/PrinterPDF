import type {ComputedSheetSide,PageItem,PageOverlay,PageOverlayText} from '@shared/models';
import {matchesOverlayScope} from './overlayRenderUtils';
import {resolveTextTemplate} from './textFormatting';

export interface TextPlacement {
  text: PageOverlayText; renderText: PageOverlayText; formulaError?: string; key: string; x:number;y:number;width:number;height:number;
  parentX:number;parentY:number;parentWidth:number;parentHeight:number; parentRotation:number; pageId?:string; sheetIndex:number;
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
    const add=(rect:{x:number;y:number;width:number;height:number},key:string,rotation:number,context:{page:number;total:number;sheet:number;file:string;docPage:number},clip?:TextPlacement['clip'],pageId?:string)=>{
      if(rect.width<=0||rect.height<=0||!Number.isFinite(item.xPercent)||!Number.isFinite(item.yPercent)||!Number.isFinite(item.widthPercent)||!Number.isFinite(item.heightPercent))return;
      const resolved=resolveTextTemplate(item.text,item.scriptRanges,context);
      const renderText={...item,text:resolved.text,scriptRanges:resolved.ranges};
      result.push({text:item,renderText,formulaError:resolved.error,key,x:rect.x+rect.width*item.xPercent/100,y:rect.y+rect.height*item.yPercent/100,
        width:rect.width*item.widthPercent/100,height:rect.height*item.heightPercent/100,
        parentX:rect.x,parentY:rect.y,parentWidth:rect.width,parentHeight:rect.height,parentRotation:rotation,pageId,sheetIndex:sheet.sideIndex,clip});
    };
    if(item.target==='sheet'){
      if(matchesOverlayScope(item,{pageIndex:0,total:totalSheets,sheetIndex:sheet.sideIndex,sheetPageIds}))
        add({x:0,y:0,width:sheet.widthMm,height:sheet.heightMm},`${item.id}-sheet-${sheet.sideIndex}`,0,
          {page:sheet.sideIndex,total:totalSheets,sheet:sheet.sideIndex,file:sheet.cells.find(c=>c.page)?.page?.documentName??'',docPage:sheet.cells.find(c=>c.page)?.page?.sourcePageNumber??0});
    }else{
      for(const cell of sheet.cells){if(!cell.page)continue;
        const pageIndex=indices.get(cell.page.id);if(!pageIndex)continue;
        if(!matchesOverlayScope(item,{pageIndex,total:pages.length,pageId:cell.page.id,documentId:cell.page.documentId,sheetIndex:sheet.sideIndex,sheetPageIds}))continue;
        add({x:cell.contentXMm,y:cell.contentYMm,width:cell.contentWidthMm,height:cell.contentHeightMm},`${item.id}-${cell.occurrenceKey??cell.cellIndex}`,cell.transform?.rotationDeg??0,
          {page:pageIndex,total:pages.length,sheet:sheet.sideIndex,file:cell.page.documentName,docPage:cell.page.sourcePageNumber},
          cell.allowOverflow?undefined:{x:cell.cellXMm,y:cell.cellYMm,width:cell.cellWidthMm,height:cell.cellHeightMm},cell.page.id);
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
  const lineHeight=Math.max(.8,Math.min(3,item.lineHeight??1.25));
  const letter=Math.max(-2,Math.min(20,item.letterSpacingPt??0))*pixelsPerPoint;
  const word=Math.max(-2,Math.min(40,item.wordSpacingPt??0))*pixelsPerPoint;
  const spacing=ctx as CanvasRenderingContext2D & {letterSpacing?:string;wordSpacing?:string};
  if(typeof spacing.letterSpacing==='string')spacing.letterSpacing=`${letter}px`;
  if(typeof spacing.wordSpacing==='string')spacing.wordSpacing=`${word}px`;
  const font=(pt:number)=>`${item.italic?'italic ':''}${item.bold?'bold ':''}${pt}px "${item.fontFamily.replace(/["\\]/g,'')}", sans-serif`;
  ctx.font=font(size);ctx.textBaseline='top';ctx.textAlign=item.align;ctx.direction=/[\u0590-\u08ff]/.test(item.text)?'rtl':'ltr';ctx.fillStyle=item.color;
  const x=item.align==='right'?width:item.align==='center'?width/2:0;
  const ranges=item.scriptRanges??[];
  let offset=0;
  item.text.split('\n').forEach((line,index)=>{
    const y=index*size*lineHeight;
    const relevant=ranges.filter(r=>r.start<offset+line.length && r.end>offset);
    if(!relevant.length){
      ctx.font=font(size);ctx.textAlign=item.align;ctx.fillText(line,x,y,width);
      if(item.underline){const w=Math.min(width,ctx.measureText(line).width);const left=x-(item.align==='right'?w:item.align==='center'?w/2:0);ctx.fillRect(left,y+size,w,Math.max(1,size*.06));}
    }else{
      const scripts=Array<'super'|'sub'|null>(line.length).fill(null);
      for(const r of relevant)for(let j=Math.max(0,r.start-offset);j<Math.min(line.length,r.end-offset);j++)scripts[j]=r.script;
      const runs:{value:string;script:'super'|'sub'|null;width:number}[]=[];
      for(let j=0;j<line.length;){let end=j+1;while(end<line.length&&scripts[end]===scripts[j])end++;
        ctx.font=font(scripts[j]?size*.65:size);const value=line.slice(j,end);runs.push({value,script:scripts[j],width:ctx.measureText(value).width});j=end;
      }
      const measured=runs.reduce((sum,r)=>sum+r.width,0), factor=measured>width?width/measured:1;
      const used=measured*factor, left=item.align==='right'?width-used:item.align==='center'?(width-used)/2:0;
      ctx.save();ctx.translate(left,0);ctx.scale(factor,1);const rtl=ctx.direction==='rtl';ctx.textAlign=rtl?'right':'left';let pos=rtl?measured:0;
      for(const run of runs){ctx.font=font(run.script?size*.65:size);const baseline=y+(run.script==='super'?0:run.script==='sub'?size*.45:size*.18);
        ctx.fillText(run.value,pos,baseline);if(item.underline)ctx.fillRect(rtl?pos-run.width:pos,baseline+(run.script?size*.65:size),run.width,Math.max(1,size*.06));
        pos+=rtl?-run.width:run.width;
      }
      ctx.restore();
    }
    offset+=line.length+1;
  });
}
