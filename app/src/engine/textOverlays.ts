import type {ComputedSheetSide,PageItem,PageOverlay,PageOverlayText,PageOverlayNumbering} from '@shared/models';
import {matchesOverlayScope,formatOverlayNumber} from './overlayRenderUtils';
import {sequenceCells, sequenceOrder} from './numberingSequence';
import {resolveTextTemplate} from './textFormatting';
import type {TextScriptRange} from '@shared/models';

export interface TextPlacement {
  text: PageOverlayText | PageOverlayNumbering; renderText: PageOverlayText; formulaError?: string; key: string; x:number;y:number;width:number;height:number;
  parentX:number;parentY:number;parentWidth:number;parentHeight:number; parentRotation:number; pageId?:string; sheetIndex:number;
  clip?: {x:number;y:number;width:number;height:number};
}
/** `^{...}` raises and `_{...}` lowers a template segment; inner `{page}`-style tokens stay usable. */
const NUMBERING_MARKER=/([\^_])\{((?:[^{}]|\{[^{}]*\})*)\}/;
type ParsedTemplateSpan = {text:string;script?:'super'|'sub'};
const parsedTemplateCache = new Map<string, ParsedTemplateSpan[]>();

export function parseNumberingTemplate(template:string):ParsedTemplateSpan[]{
  const cached = parsedTemplateCache.get(template);
  if (cached) return cached;
  const spans:ParsedTemplateSpan[]=[];let rest=template;
  for(;;){
    const match=NUMBERING_MARKER.exec(rest);
    if(!match){if(rest)spans.push({text:rest});break;}
    if(match.index>0)spans.push({text:rest.slice(0,match.index)});
    // The outer script wins: any nested marker inside a run only contributes its text, so no stray syntax prints.
    if(match[2])spans.push({text:match[2].replace(NUMBERING_MARKER,'$2'),script:match[1]==='^'?'super':'sub'});
    rest=rest.slice(match.index+match[0].length);
  }
  if (parsedTemplateCache.size > 512) parsedTemplateCache.clear();
  parsedTemplateCache.set(template, spans);
  return spans;
}
/** Resolves a numbering template, including its script markers, for one page/sheet position. */
export function resolveNumberingTemplate(item:PageOverlayNumbering,page:number,total:number):{text:string;ranges:TextScriptRange[]}{
  let out='';const ranges:TextScriptRange[]=[];
  for(const span of parseNumberingTemplate(item.template)){
    const part=formatOverlayNumber({...item,template:span.text},page,total);
    if(!part)continue;
    if(span.script)ranges.push({start:out.length,end:out.length+part.length,script:span.script});
    out+=part;
  }
  return {text:out,ranges};
}
/** Positions refer to the visible page box or the output sheet, measured in mm. */
export function textPlacements(sheet:ComputedSheetSide,totalSheets:number,pages:PageItem[],overlays:PageOverlay[],pageIndices?:Map<string,number>):TextPlacement[] {
  const texts=overlays.filter((o):o is PageOverlayText|PageOverlayNumbering=>o.kind==='text'||(o.kind==='numbering' && o.enabled));
  if(!texts.length)return [];
  const indices=pageIndices ?? new Map(pages.map((page,i)=>[page.id,i+1]));
  const sheetPageIds=sheet.cells.flatMap(c=>c.page?[c.page.id]:[]);
  // Compute grid sequence order at most once per direction on this sheet so N slots don't re-sort the grid N times.
  const sheetWalkCache = new Map<string, { indexByPageId: Map<string, number>; count: number }>();
  const getSheetWalk = (direction: NonNullable<PageOverlayNumbering['sequenceDirection']>) => {
    let entry = sheetWalkCache.get(direction);
    if (!entry) {
      const orderedIds = sequenceOrder(sequenceCells(sheet), direction);
      const indexByPageId = new Map<string, number>();
      for (let i = 0; i < orderedIds.length; i++) indexByPageId.set(orderedIds[i], i);
      entry = { indexByPageId, count: Math.max(1, orderedIds.length) };
      sheetWalkCache.set(direction, entry);
    }
    return entry;
  };
  const result:TextPlacement[]=[];
  for(const item of texts){
    const add=(rect:{x:number;y:number;width:number;height:number},key:string,rotation:number,context:{page:number;total:number;sheet:number;file:string;docPage:number},clip?:TextPlacement['clip'],pageId?:string)=>{
      if(rect.width<=0||rect.height<=0||!Number.isFinite(item.xPercent)||!Number.isFinite(item.yPercent)||!Number.isFinite(item.widthPercent)||!Number.isFinite(item.heightPercent))return;
      let renderText:PageOverlayText, formulaError:string|undefined;
      if(item.kind==='text'){
        const resolved=resolveTextTemplate(item.text,item.scriptRanges,context);
        renderText={...item,text:resolved.text,scriptRanges:resolved.ranges};formulaError=resolved.error;
      } else {
        let value:string,ranges:TextScriptRange[]=[];
        try {const resolved=resolveNumberingTemplate(item,context.page,context.total);value=resolved.text;ranges=resolved.ranges;}
        catch {value=item.template;formulaError='Invalid numbering formula or format';}
        renderText={...item,kind:'text',text:value,scriptRanges:ranges,underline:false,align:item.align??'center',verticalAlign:'middle'};
      }
      result.push({text:item,renderText,formulaError,key,x:rect.x+rect.width*item.xPercent/100,y:rect.y+rect.height*item.yPercent/100,
        width:rect.width*item.widthPercent/100,height:rect.height*item.heightPercent/100,
        parentX:rect.x,parentY:rect.y,parentWidth:rect.width,parentHeight:rect.height,parentRotation:rotation,pageId,sheetIndex:sheet.sideIndex,clip});
    };
    // What the layer counts: the document's own page number, the cells read off the sheet, or one number per
    // output side. `page` keeps `{page}`/`{total}` meaning exactly what they always did.
    const numberFor=(_target:'sheet'|'cell'|'page',pageId:string|undefined,_pageIndex:number,basisPage:number,basisTotal:number)=>{
      const basis = item.kind === 'numbering' ? (item.sequenceBasis ?? 'page') : 'page';
      if (basis === 'page') return {page:basisPage,total:basisTotal};
      if (basis === 'sheet') return {page:sheet.sideIndex,total:Math.max(1,totalSheets)};
      const direction = (item.kind === 'numbering' ? item.sequenceDirection : undefined) ?? 'ltr';
      const walk = getSheetWalk(direction);
      const slotIdx = pageId ? (walk.indexByPageId.get(pageId) ?? -1) : -1;
      if (basis === 'cut-stack') {
        const safeSlot = Math.max(0, slotIdx);
        const perSheet = Math.max(1, sheet.cells.length);
        const totalTickets = Math.max(1, basisTotal);
        const sheetIndexZero = Math.max(0, sheet.sideIndex - 1);
        const basePerPile = Math.floor(totalTickets / perSheet);
        const remainder = totalTickets % perSheet;
        const offsetBeforeSlot = safeSlot * basePerPile + Math.min(safeSlot, remainder);
        return {page:offsetBeforeSlot + sheetIndexZero + 1, total:totalTickets};
      }
      return {page:slotIdx >= 0 ? slotIdx + 1 : 1, total:walk.count};
    };
    if(item.target==='sheet'){
      if(matchesOverlayScope(item,{pageIndex:0,total:totalSheets,sheetIndex:sheet.sideIndex,sheetPageIds})){
        const counted=numberFor('sheet',undefined,0,sheet.sideIndex,totalSheets);
        add({x:0,y:0,width:sheet.widthMm,height:sheet.heightMm},`${item.id}-sheet-${sheet.sideIndex}`,0,
          {page:counted.page,total:counted.total,sheet:sheet.sideIndex,file:sheet.cells.find(c=>c.page)?.page?.documentName??'',docPage:sheet.cells.find(c=>c.page)?.page?.sourcePageNumber??0});
      }
    }else{
      for(const cell of sheet.cells){if(!cell.page)continue;
        const pageIndex=indices.get(cell.page.id);if(!pageIndex)continue;
        if(!matchesOverlayScope(item,{pageIndex,total:pages.length,pageId:cell.page.id,documentId:cell.page.documentId,sheetIndex:sheet.sideIndex,sheetPageIds}))continue;
        const cellTarget=item.target==='cell';
        const rect=cellTarget
          ? {x:cell.cellXMm,y:cell.cellYMm,width:cell.cellWidthMm,height:cell.cellHeightMm}
          : {x:cell.contentXMm,y:cell.contentYMm,width:cell.contentWidthMm,height:cell.contentHeightMm};
        const counted=numberFor(cellTarget?'cell':'page',cell.page.id,pageIndex,pageIndex,pages.length);
        add(rect,`${item.id}-${cell.occurrenceKey??cell.cellIndex}`,cell.transform?.rotationDeg??0,
          {page:counted.page,total:counted.total,sheet:sheet.sideIndex,file:cell.page.documentName,docPage:cell.page.sourcePageNumber},
          cellTarget||cell.allowOverflow?undefined:{x:cell.cellXMm,y:cell.cellYMm,width:cell.cellWidthMm,height:cell.cellHeightMm},cell.page.id);
      }
    }
  }
  return result;
}
interface WrappedTextLine {
  text: string;
  start: number;
  end: number;
  isLastInPara: boolean;
}

function wrapTextIntoLines(
  ctx: CanvasRenderingContext2D,
  fullText: string,
  maxWidth: number,
  size: number,
  font: (pt: number) => string,
  ranges: TextScriptRange[],
  wrapWords: boolean
): WrappedTextLine[] {
  const lines: WrappedTextLine[] = [];
  const paragraphs = fullText.split('\n');
  let offset = 0;

  const measureSlice = (slice: string, sliceStart: number): number => {
    if (!slice.length) return 0;
    const rel = ranges.filter((r) => r.start < sliceStart + slice.length && r.end > sliceStart);
    if (!rel.length) {
      ctx.font = font(size);
      return ctx.measureText(slice).width;
    }
    const scripts: Array<'super' | 'sub' | null> = Array(slice.length).fill(null);
    for (const r of rel) {
      for (let j = Math.max(0, r.start - sliceStart); j < Math.min(slice.length, r.end - sliceStart); j++) {
        scripts[j] = r.script;
      }
    }
    let total = 0;
    for (let j = 0; j < slice.length; ) {
      let end = j + 1;
      while (end < slice.length && scripts[end] === scripts[j]) end++;
      ctx.font = font(scripts[j] ? size * 0.65 : size);
      total += ctx.measureText(slice.slice(j, end)).width;
      j = end;
    }
    return total;
  };

  for (let p = 0; p < paragraphs.length; p++) {
    const para = paragraphs[p];
    const paraStart = offset;
    if (!wrapWords || para.length === 0 || measureSlice(para, paraStart) <= maxWidth + 0.5) {
      lines.push({ text: para, start: paraStart, end: paraStart + para.length, isLastInPara: true });
      offset += para.length + 1;
      continue;
    }

    // Tokenize preserving whitespace runs and exact UTF-16 offsets
    const tokens: Array<{ text: string; start: number; end: number; isSpace: boolean }> = [];
    const tokenRe = /\s+|\S+/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(para)) !== null) {
      tokens.push({
        text: m[0],
        start: paraStart + m.index,
        end: paraStart + m.index + m[0].length,
        isSpace: /^\s+$/.test(m[0]),
      });
    }

    let curTokens: typeof tokens = [];
    const flushLine = (isLastInPara: boolean) => {
      // Trim trailing whitespace token on soft-wrapped lines so edges align crisply
      while (!isLastInPara && curTokens.length > 0 && curTokens[curTokens.length - 1].isSpace) {
        curTokens.pop();
      }
      if (curTokens.length === 0) {
        lines.push({ text: '', start: paraStart, end: paraStart, isLastInPara });
        return;
      }
      const lineStart = curTokens[0].start;
      const lineEnd = curTokens[curTokens.length - 1].end;
      const lineText = curTokens.map((t) => t.text).join('');
      lines.push({ text: lineText, start: lineStart, end: lineEnd, isLastInPara });
      curTokens = [];
    };

    for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
      const tok = tokens[tIdx];
      if (curTokens.length === 0 && tok.isSpace) {
        continue;
      }
      const candidateText = curTokens.map((t) => t.text).join('') + tok.text;
      const candidateStart = curTokens.length > 0 ? curTokens[0].start : tok.start;
      if (curTokens.length > 0 && !tok.isSpace && measureSlice(candidateText, candidateStart) > maxWidth + 0.5) {
        flushLine(false);
      }

      if (curTokens.length === 0 && !tok.isSpace && measureSlice(tok.text, tok.start) > maxWidth + 0.5) {
        // Single unbroken word wider than box: split cleanly by characters without altering font size
        let charStart = 0;
        while (charStart < tok.text.length) {
          let charEnd = charStart + 1;
          while (
            charEnd < tok.text.length &&
            measureSlice(tok.text.slice(charStart, charEnd + 1), tok.start + charStart) <= maxWidth + 0.5
          ) {
            charEnd++;
          }
          const segText = tok.text.slice(charStart, charEnd);
          const isFinalChunk = charEnd >= tok.text.length && tIdx === tokens.length - 1;
          lines.push({
            text: segText,
            start: tok.start + charStart,
            end: tok.start + charEnd,
            isLastInPara: isFinalChunk,
          });
          charStart = charEnd;
        }
        continue;
      }

      curTokens.push(tok);
    }

    if (curTokens.length > 0 || lines.length === 0 || lines[lines.length - 1].end < paraStart) {
      flushLine(true);
    } else if (lines.length > 0) {
      lines[lines.length - 1].isLastInPara = true;
    }

    offset += para.length + 1;
  }

  return lines.length > 0 ? lines : [{ text: '', start: 0, end: 0, isLastInPara: true }];
}

/** Identical drawing logic is used for preview and PDF rasterization. */
export function drawOverlayText(ctx:CanvasRenderingContext2D,item:PageOverlayText,width:number,height:number,pixelsPerPoint:number){
  ctx.clearRect(0,0,width,height);
  if(item.backgroundColor && item.backgroundColor!=='transparent'){ctx.fillStyle=item.backgroundColor;ctx.fillRect(0,0,width,height);}
  const lineHeight=Math.max(.8,Math.min(3,item.lineHeight??1.25));
  const requestedSize=Math.max(8,Math.min(80,item.fontSize))*pixelsPerPoint;
  const letter=Math.max(-2,Math.min(20,item.letterSpacingPt??0))*pixelsPerPoint;
  const word=Math.max(-2,Math.min(40,item.wordSpacingPt??0))*pixelsPerPoint;
  const spacing=ctx as CanvasRenderingContext2D & {letterSpacing?:string;wordSpacing?:string};
  if(typeof spacing.letterSpacing==='string')spacing.letterSpacing=`${letter}px`;
  if(typeof spacing.wordSpacing==='string')spacing.wordSpacing=`${word}px`;
  const font=(pt:number)=>`${item.italic?'italic ':''}${item.bold?'bold ':''}${pt}px "${item.fontFamily.replace(/["\\\\]/g,'')}", sans-serif`;
  const rtl=/[\u0590-\u08ff]/.test(item.text);
  const ranges=item.scriptRanges??[];
  const explicitLines=Math.max(1,item.text.split('\n').length);
  const isNumberingBox=item.verticalAlign==='middle';
  const size=isNumberingBox&&height>0
    ? Math.max(1,Math.min(requestedSize,(height*0.88)/(explicitLines*lineHeight)))
    : requestedSize;
  const inset=isNumberingBox?Math.min(width*0.08,Math.max(size*0.35,2*pixelsPerPoint)):0;
  const textWidth=Math.max(1,width-inset*2);

  // Wrap paragraphs inside box width independently of fontSize for editable text boxes
  const wrappedLines=wrapTextIntoLines(ctx,item.text,textWidth,size,font,ranges,!isNumberingBox);
  const lineCount=Math.max(1,wrappedLines.length);
  const verticalOffset=isNumberingBox?(height-lineCount*size*lineHeight)/2+size/2:0;
  ctx.font=font(size);ctx.textBaseline=isNumberingBox?'middle':'top';
  ctx.direction=rtl?'rtl':'ltr';ctx.fillStyle=item.color;

  const drawScriptLine=(lineText:string,lineStart:number,y:number,alignMode:'left'|'center'|'right')=>{
    const scripts:Array<'super'|'sub'|null>=Array(lineText.length).fill(null);
    const relevant=ranges.filter(r=>r.start<lineStart+lineText.length && r.end>lineStart);
    for(const r of relevant)for(let j=Math.max(0,r.start-lineStart);j<Math.min(lineText.length,r.end-lineStart);j++)scripts[j]=r.script;
    const runs:{value:string;script:'super'|'sub'|null;width:number}[]=[];
    for(let j=0;j<lineText.length;){
      let end=j+1;
      while(end<lineText.length&&scripts[end]===scripts[j])end++;
      ctx.font=font(scripts[j]?size*.65:size);
      const value=lineText.slice(j,end);
      runs.push({value,script:scripts[j],width:ctx.measureText(value).width});
      j=end;
    }
    const measured=runs.reduce((sum,r)=>sum+r.width,0),factor=measured>textWidth?textWidth/measured:1;
    const used=measured*factor,left=alignMode==='right'?inset+textWidth-used:alignMode==='center'?(width-used)/2:inset;
    ctx.save();ctx.translate(left,0);ctx.scale(factor,1);ctx.textAlign=rtl?'right':'left';let pos=rtl?measured:0;
    for(const run of runs){
      ctx.font=font(run.script?size*.65:size);
      const baseline=isNumberingBox
        ? y+(run.script==='super'?-size*.3:run.script==='sub'?size*.3:0)
        : y+(run.script==='super'?0:run.script==='sub'?size*.45:size*.18);
      ctx.fillText(run.value,pos,baseline);
      if(item.underline)ctx.fillRect(rtl?pos-run.width:pos,baseline+(run.script?size*.65:size),run.width,Math.max(1,size*.06));
      pos+=rtl?-run.width:run.width;
    }
    ctx.restore();
  };

  wrappedLines.forEach((vl,index)=>{
    const y=verticalOffset+index*size*lineHeight;
    const line=vl.text;
    const lineStart=vl.start;
    const relevant=ranges.filter(r=>r.start<lineStart+line.length && r.end>lineStart);

    // Justify full wrapped lines (not the trailing line of a paragraph) across textWidth
    if(item.align==='justify' && !vl.isLastInPara){
      const words:Array<{text:string;offset:number;width:number}>=[];
      const wordRe=/\S+/g;
      let wm:RegExpExecArray|null;
      while((wm=wordRe.exec(line))!==null){
        ctx.font=font(size);
        words.push({text:wm[0],offset:lineStart+wm.index,width:ctx.measureText(wm[0]).width});
      }
      if(words.length>1){
        const totalWordW=words.reduce((s,w)=>s+w.width,0);
        if(totalWordW<textWidth){
          const gap=(textWidth-totalWordW)/(words.length-1);
          let cursor=rtl?inset+textWidth:inset;
          for(const wTok of words){
            const tokHasScript=ranges.some(r=>r.start<wTok.offset+wTok.text.length && r.end>wTok.offset);
            if(!tokHasScript){
              ctx.font=font(size);
              ctx.textAlign=rtl?'right':'left';
              ctx.fillText(wTok.text,cursor,y);
            }else{
              // Draw token runs anchored at word start edge
              const wLeft=rtl?cursor-wTok.width:cursor;
              const scripts:Array<'super'|'sub'|null>=Array(wTok.text.length).fill(null);
              for(const r of ranges)for(let j=Math.max(0,r.start-wTok.offset);j<Math.min(wTok.text.length,r.end-wTok.offset);j++)scripts[j]=r.script;
              ctx.save();ctx.translate(wLeft,0);ctx.textAlign=rtl?'right':'left';let pos=rtl?wTok.width:0;
              for(let j=0;j<wTok.text.length;){
                let end=j+1;while(end<wTok.text.length&&scripts[end]===scripts[j])end++;
                ctx.font=font(scripts[j]?size*.65:size);
                const val=wTok.text.slice(j,end);
                const rw=ctx.measureText(val).width;
                const baseline=isNumberingBox
                  ? y+(scripts[j]==='super'?-size*.3:scripts[j]==='sub'?size*.3:0)
                  : y+(scripts[j]==='super'?0:scripts[j]==='sub'?size*.45:size*.18);
                ctx.fillText(val,pos,baseline);
                pos+=rtl?-rw:rw;j=end;
              }
              ctx.restore();
            }
            cursor+=rtl?-(wTok.width+gap):(wTok.width+gap);
          }
          if(item.underline){
            ctx.fillRect(inset,y+(isNumberingBox?size*.55:size),textWidth,Math.max(1,size*.06));
          }
          return;
        }
      }
    }

    const effectiveAlign:'left'|'center'|'right'=item.align==='justify'?(rtl?'right':'left'):item.align;
    const x=effectiveAlign==='right'?inset+textWidth:effectiveAlign==='center'?width/2:inset;
    if(!relevant.length){
      ctx.font=font(size);ctx.textAlign=effectiveAlign;ctx.fillText(line,x,y,textWidth);
      if(item.underline){const w=Math.min(textWidth,ctx.measureText(line).width);const left=x-(effectiveAlign==='right'?w:effectiveAlign==='center'?w/2:0);ctx.fillRect(left,y+(isNumberingBox?size*.55:size),w,Math.max(1,size*.06));}
    }else{
      drawScriptLine(line,lineStart,y,effectiveAlign);
    }
  });
}
