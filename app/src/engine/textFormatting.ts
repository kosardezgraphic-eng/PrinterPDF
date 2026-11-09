import type { TextScriptRange } from '@shared/models';
import { evaluateNumberScript } from './overlayRenderUtils';

type Script = TextScriptRange['script'];
function scriptMap(length:number,ranges:TextScriptRange[] = []):(Script|null)[] {
  const map = Array<Script|null>(length).fill(null);
  for(const r of ranges) if((r.script==='super'||r.script==='sub') && Number.isInteger(r.start) && Number.isInteger(r.end))
    for(let i=Math.max(0,r.start);i<Math.min(length,r.end);i++) map[i]=r.script;
  return map;
}
function toRanges(map:(Script|null)[]):TextScriptRange[] {
  const out:TextScriptRange[]=[];let i=0;
  while(i<map.length){const script=map[i];if(!script){i++;continue;}let end=i+1;while(end<map.length && map[end]===script)end++;out.push({start:i,end,script});i=end;}
  return out;
}
/** Applying a style to the same selection twice removes it. */
export function setScriptRange(text:string,ranges:TextScriptRange[]|undefined,start:number,end:number,script:Script):TextScriptRange[] {
  const map=scriptMap(text.length,ranges);start=Math.max(0,Math.min(start,text.length));end=Math.max(start,Math.min(end,text.length));
  if(start===end)return toRanges(map);
  const value=map.slice(start,end).every(v=>v===script)?null:script;
  for(let i=start;i<end;i++)map[i]=value;
  return toRanges(map);
}
/** Preserve formatting outside the changed span, inheriting the adjacent style on insertion. */
export function adjustScriptRanges(oldText:string,newText:string,ranges:TextScriptRange[]|undefined):TextScriptRange[] {
  let start=0;while(start<oldText.length && start<newText.length && oldText[start]===newText[start])start++;
  let oldEnd=oldText.length,newEnd=newText.length;
  while(oldEnd>start && newEnd>start && oldText[oldEnd-1]===newText[newEnd-1]){oldEnd--;newEnd--;}
  const map=scriptMap(oldText.length,ranges), inherited=start>0 ? map[start-1] : (map[start] ?? null);
  return toRanges([...map.slice(0,start),...Array<Script|null>(newEnd-start).fill(inherited),...map.slice(oldEnd)]);
}
export interface TextTemplateContext {page:number;total:number;sheet:number;file:string;docPage:number}
/** Expressions are bounded arithmetic over page only. No JavaScript is evaluated. */
export function resolveTextTemplate(text:string,ranges:TextScriptRange[]|undefined,context:TextTemplateContext):{text:string;ranges:TextScriptRange[];error?:string} {
  const original=scriptMap(text.length,ranges), parts:string[]=[],styles:(Script|null)[]=[];let cursor=0,error:string|undefined;
  const append=(value:string, style:(Script|null)[])=>{parts.push(value);styles.push(...style);};
  const pattern=/\{(page|total|sheet|file|docPage|=([^{}]*))\}/gi;
  for(const match of text.matchAll(pattern)){
    const start=match.index!,end=start+match[0].length;
    append(text.slice(cursor,start),original.slice(cursor,start));
    const key=match[1].toLowerCase();let result:string;
    if(key.startsWith('=')){
      try{if(!match[2]?.trim())throw new Error('Empty formula');result=String(evaluateNumberScript(match[2],context.page));}
      catch{result=match[0];error='Invalid text formula';}
    } else result=String(key==='page'?context.page:key==='total'?context.total:key==='sheet'?context.sheet:key==='docpage'?context.docPage:context.file);
    append(result,Array<Script|null>(result.length).fill(original[start]??null));cursor=end;
  }
  append(text.slice(cursor),original.slice(cursor));
  return {text:parts.join(''),ranges:toRanges(styles),error};
}
