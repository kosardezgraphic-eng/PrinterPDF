import type { PageOverlay, PageOverlayNumbering, PageOverlayShape } from '@shared/models';

export interface OverlayContext { pageIndex: number; total: number; pageId?: string; sheetIndex: number; sheetPageIds: string[] }
export interface OverlayRect { x: number; y: number; width: number; height: number; pixelsPerPoint: number }

const selectedIdSets = new WeakMap<string[], Set<string>>();
function containsTarget(ids: string[], id: string): boolean {
  let set = selectedIdSets.get(ids);
  if (!set) { set = new Set(ids); selectedIdSets.set(ids, set); }
  return set.has(id);
}
/** Current and selected are captured by stable page ID at the time of applying the scope. */
export function matchesOverlayScope(overlay: PageOverlay, context: OverlayContext): boolean {
  const n = overlay.target === 'sheet' ? context.sheetIndex : context.pageIndex;
  switch (overlay.targetScope) {
    case 'all': return true;
    case 'odd': return n % 2 === 1;
    case 'even': return n % 2 === 0;
    case 'first': return n === 1;
    case 'last': return n === context.total;
    case 'current': return overlay.target === 'sheet' ? n === overlay.targetSheetIndex : !!context.pageId && containsTarget(overlay.targetPageIds,context.pageId);
    case 'selected': return overlay.target === 'sheet' ? context.sheetPageIds.some(id => containsTarget(overlay.targetPageIds,id)) : !!context.pageId && containsTarget(overlay.targetPageIds,context.pageId);
  }
}

/** Small bounded arithmetic parser. No JavaScript evaluation, variables, property access or function calls. */
export function evaluateNumberScript(script: string, page: number): number {
  if (!script.trim()) return page;
  if (script.length > 160) throw new Error('Formula is too long');
  const tokens = script.match(/(?:\d+(?:\.\d+)?|page|[()+\-*/])/gi) ?? [];
  if (tokens.join('').toLowerCase() !== script.replace(/\s+/g, '').toLowerCase() || tokens.length > 100) throw new Error('Invalid formula');
  let index = 0, depth = 0;
  const primary = (): number => {
    if (++depth > 32) throw new Error('Formula is too deep');
    const token = tokens[index++]; let value: number;
    if (token === '+' || token === '-') value = (token === '-' ? -1 : 1) * primary();
    else if (token === '(') { value = sum(); if (tokens[index++] !== ')') throw new Error('Missing parenthesis'); }
    else if (token?.toLowerCase() === 'page') value = page;
    else if (token && /^\d/.test(token)) value = Number(token);
    else throw new Error('Invalid formula');
    depth--; return value;
  };
  const product = (): number => { let value = primary(); while (tokens[index] === '*' || tokens[index] === '/') { const op=tokens[index++]; const other=primary(); value=op==='*' ? value*other : value/other; } return value; };
  const sum = (): number => { let value = product(); while (tokens[index] === '+' || tokens[index] === '-') { const op=tokens[index++]; const other=product(); value=op==='+' ? value+other : value-other; } return value; };
  const value = sum();
  if (index !== tokens.length || !Number.isSafeInteger(value) || Math.abs(value) > 999999999) throw new Error('Formula must produce a safe integer');
  return value;
}

const persianDigits = (value: string) => value.replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
function roman(value: number): string {
  if (value < 1 || value > 3999 || !Number.isInteger(value)) throw new Error('Roman numbers require 1–3999');
  let out=''; for (const [n,s] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']] as const) while (value >= n) {out+=s;value-=n;} return out;
}
function abjad(value: number): string {
  if (value < 1 || value > 1999 || !Number.isInteger(value)) throw new Error('Abjad numbers require 1–1999');
  let out=''; for (const [n,s] of [[1000,'غ'],[900,'ظ'],[800,'ض'],[700,'ذ'],[600,'خ'],[500,'ث'],[400,'ت'],[300,'ش'],[200,'ر'],[100,'ق'],[90,'ص'],[80,'ف'],[70,'ع'],[60,'س'],[50,'ن'],[40,'م'],[30,'ل'],[20,'ک'],[10,'ی'],[9,'ط'],[8,'ح'],[7,'ز'],[6,'و'],[5,'ه'],[4,'د'],[3,'ج'],[2,'ب'],[1,'ا']] as const) while(value >= n){out+=s;value-=n;} return out;
}
export function formatOverlayNumber(settings: PageOverlayNumbering, index: number, total: number): string {
  const serial = evaluateNumberScript(settings.customScript, index) + settings.startOffset - 1;
  if (!Number.isSafeInteger(serial) || Math.abs(serial)>999999999) throw new Error('Invalid serial number');
  const convert = (n:number) => settings.format === 'roman' ? roman(n) : settings.format === 'abjad' ? abjad(n) : settings.format === 'persian' ? persianDigits(String(n)) : String(n);
  const padded = (length:number) => { const v = (serial < 0 ? '-' : '') + String(Math.abs(serial)).padStart(length,'0'); return settings.format === 'persian' ? persianDigits(v) : v; };
  return settings.template.replace(/\{(page|total|serial|pad[3-7])\}/gi, (_, tag:string) => {
    const key=tag.toLowerCase(); return key === 'page' ? convert(serial) : key === 'serial' ? (settings.padZeros > 0 && (settings.format === 'english' || settings.format === 'persian') ? padded(Math.min(7, Math.max(3, settings.padZeros))) : convert(serial)) : key === 'total' ? convert(total) : padded(Number(key.slice(3)));
  });
}

function shapePath(ctx:CanvasRenderingContext2D, s:PageOverlayShape,w:number,h:number) {
  const line=(pts:[number,number][])=>{ctx.moveTo(pts[0][0]*w,pts[0][1]*h);pts.slice(1).forEach(([x,y])=>ctx.lineTo(x*w,y*h));ctx.closePath();};
  switch (s.type) {
    case 'rectangle': ctx.rect(0,0,w,h); break;
    case 'rounded-rect': ctx.roundRect(0,0,w,h,Math.min(w/2,h/2,Math.max(0,s.borderRadius))); break;
    case 'circle': case 'badge': ctx.ellipse(w/2,h/2,w/2,h/2,0,0,Math.PI*2); break;
    case 'line': case 'arrow': ctx.moveTo(0,h/2);ctx.lineTo(w,h/2); if(s.type==='arrow'){ctx.moveTo(w-Math.min(w*.25, h*.4),h*.1);ctx.lineTo(w,h/2);ctx.lineTo(w-Math.min(w*.25,h*.4),h*.9);} break;
    case 'triangle': line([[.5,0],[1,1],[0,1]]); break;
    case 'diamond': line([[.5,0],[1,.5],[.5,1],[0,.5]]); break;
    case 'polygon': line(Array.from({length:6},(_,i)=>[.5+.5*Math.cos(-Math.PI/2+i*Math.PI/3),.5+.5*Math.sin(-Math.PI/2+i*Math.PI/3)] as [number,number])); break;
    case 'star': line(Array.from({length:10},(_,i)=>{const r=i%2?.22:.5;return [.5+r*Math.cos(-Math.PI/2+i*Math.PI/5),.5+r*Math.sin(-Math.PI/2+i*Math.PI/5)] as [number,number];})); break;
  }
}

/** Canvas output uses the same renderer in preview and exported PDF. */
export function renderOverlaysOnCanvas(ctx:CanvasRenderingContext2D, overlays:PageOverlay[], rect:OverlayRect, context:OverlayContext): void {
  for (const item of [...overlays.filter(o=>o.kind==='shape'), ...overlays.filter(o=>o.kind==='text'), ...overlays.filter(o=>o.kind==='numbering')]) {
    if (!matchesOverlayScope(item,context) || (item.kind==='numbering' && !item.enabled)) continue;
    const x=rect.x+rect.width*item.xPercent/100,y=rect.y+rect.height*item.yPercent/100,w=rect.width*item.widthPercent/100,h=rect.height*item.heightPercent/100;
    if (w<=0||h<=0) continue;
    ctx.save();
    try {
    ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();
    ctx.translate(x+w/2,y+h/2);ctx.rotate(item.rotation*Math.PI/180);ctx.translate(-w/2,-h/2);ctx.globalAlpha=Math.max(.1,Math.min(1,item.opacity));
    if (item.kind==='shape') {
      ctx.beginPath();shapePath(ctx,item,w,h);ctx.strokeStyle=item.strokeColor;ctx.lineWidth=item.strokeWidth*.75*rect.pixelsPerPoint;
      ctx.setLineDash(item.strokeStyle==='solid'?[]:item.strokeStyle==='dashed'?[ctx.lineWidth*4,ctx.lineWidth*2]:[ctx.lineWidth,ctx.lineWidth*2]);
      if (item.fillColor !== 'transparent' && item.type !== 'line' && item.type !== 'arrow') {ctx.fillStyle=item.fillColor;ctx.fill();}
      if(item.strokeWidth>0)ctx.stroke();
    } else {
      const content = item.kind==='text' ? item.text : formatOverlayNumber(item,item.target==='page'?context.pageIndex:context.sheetIndex,context.total);
      if (item.backgroundColor && item.backgroundColor !== 'transparent'){ctx.fillStyle=item.backgroundColor;ctx.fillRect(0,0,w,h);}
      const size=item.fontSize*rect.pixelsPerPoint;
      ctx.font=`${item.italic?'italic ':''}${item.bold?'bold ':''}${size}px "${item.fontFamily.replace(/["\\]/g,'')}", sans-serif`;
      ctx.fillStyle=item.color;ctx.textBaseline='top';ctx.textAlign=item.kind==='text'?item.align:'left';
      const tx=ctx.textAlign==='center'?w/2:ctx.textAlign==='right'?w:0;
      ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
      content.split('\n').forEach((line,i)=>{ctx.fillText(line,tx,i*size*1.25,w);if(item.kind==='text'&&item.underline){const tw=Math.min(w,ctx.measureText(line).width);const left=tx-(ctx.textAlign==='right'?tw:ctx.textAlign==='center'?tw/2:0);ctx.fillRect(left,i*size*1.25+size,tw,Math.max(1,size*.06));}});
    }
    } finally { ctx.restore(); }
  }
}
