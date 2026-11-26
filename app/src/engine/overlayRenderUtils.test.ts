import {describe,expect,it} from 'vitest';
import {createCanvas} from '@napi-rs/canvas';
import type {PageOverlayNumbering,PageOverlayShape,PageOverlayText} from '@shared/models';
import {evaluateNumberScript,formatOverlayNumber,matchesOverlayScope,renderOverlaysOnCanvas} from './overlayRenderUtils';
const base={id:'x',target:'page' as const,targetScope:'all' as const,targetPageIds:['a'],targetSheetIndex:1,xPercent:10,yPercent:10,widthPercent:40,heightPercent:30,opacity:1,rotation:0};
const number:PageOverlayNumbering={...base,kind:'numbering',enabled:true,fontSize:18,fontFamily:'Arial',color:'#000000',bold:false,italic:false,format:'english',template:'No. {pad6} / {page} / {total} / {serial}',startOffset:1001,padZeros:4,customScript:''};
const shape:PageOverlayShape={...base,kind:'shape',type:'rectangle',fillColor:'#ff0000',strokeColor:'#000000',strokeWidth:0,strokeStyle:'solid',borderRadius:0};
const text:PageOverlayText={...base,kind:'text',text:'Test',fontSize:18,fontFamily:'Arial',color:'#000',bold:false,italic:false,underline:false,align:'left'};
const context={pageIndex:2,total:5,pageId:'a',sheetIndex:1,sheetPageIds:['a','b']};
describe('overlay number formatter',()=>{
  it('parses arithmetic with precedence and starting serial, and pads tags',()=>{
    expect(evaluateNumberScript('(page + 3) * 2',2)).toBe(10);
    expect(formatOverlayNumber(number,2,5)).toBe('No. 001002 / 1002 / 5 / 1002');
    expect(formatOverlayNumber({...number,startOffset:1,customScript:'page * 2',padZeros:6},2,5)).toBe('No. 000004 / 4 / 5 / 000004');
  });
  it('supports Persian digits, Roman numerals and numeric abjad',()=>{
    expect(formatOverlayNumber({...number,format:'persian',startOffset:1,template:'{page} از {total}: {pad4}'},2,5)).toBe('۲ از ۵: ۰۰۰۲');
    expect(formatOverlayNumber({...number,format:'roman',startOffset:1,template:'{page}'},14,20)).toBe('XIV');
    expect(formatOverlayNumber({...number,format:'abjad',startOffset:1,template:'{page}'},12,20)).toBe('یب');
  });
  it.each(['globalThis.process.exit()', 'page.constructor', 'page / 0', '1.5', '(', '2 ** 3', 'page;alert(1)', 'page +', '1e30'])('rejects unsafe or invalid expression %s', expression=>{
    expect(()=>evaluateNumberScript(expression,2)).toThrow();
  });
  it('accepts wider padding and Persian/Arabic digits inside the arithmetic script',()=>{
    expect(formatOverlayNumber({...number,format:'persian',startOffset:1,padZeros:0,template:'{serial}'},1,5)).toBe('۱');
    expect(formatOverlayNumber({...number,format:'english',startOffset:1,padZeros:0,template:'{pad10}'},1,5)).toBe('0000000001');
    expect(formatOverlayNumber({...number,format:'english',startOffset:1,customScript:'۱۰۰۰ - page',template:'{serial}'},2,5)).toBe('0998');
    expect(()=>evaluateNumberScript('page ** 2',2)).toThrow();
  });
  it('rejects unsupported Roman and abjad values instead of silently misnumbering',()=>{
    expect(()=>formatOverlayNumber({...number,format:'roman',template:'{page}'},4000,1)).toThrow();
    expect(()=>formatOverlayNumber({...number,format:'abjad',template:'{page}',startOffset:0},1,1)).toThrow();
  });
});
describe('overlay targeting and canvas',()=>{
  it('uses page identity and one-based page order; selected remains a snapshot',()=>{
    expect(matchesOverlayScope({...shape,targetScope:'current'},context)).toBe(true);
    expect(matchesOverlayScope({...shape,targetScope:'selected'}, {...context,pageId:'b'})).toBe(false);
    expect(matchesOverlayScope({...shape,targetScope:'even'},context)).toBe(true);
    expect(matchesOverlayScope({...shape,targetScope:'odd'},context)).toBe(false);
    expect(matchesOverlayScope({...shape,targetScope:'last'}, {...context,pageIndex:5})).toBe(true);
  });
  it('uses sheet indexes and selected page identities for sheet overlays',()=>{
    expect(matchesOverlayScope({...shape,target:'sheet',targetScope:'current'},context)).toBe(true);
    expect(matchesOverlayScope({...shape,target:'sheet',targetScope:'odd'},context)).toBe(true);
    expect(matchesOverlayScope({...shape,target:'sheet',targetScope:'selected'},context)).toBe(true);
    expect(matchesOverlayScope({...shape,target:'sheet',targetScope:'selected',targetPageIds:['other']},context)).toBe(false);
    expect(matchesOverlayScope({...number,target:'sheet',targetScope:'selected',targetSheetIndices:[1]},context)).toBe(true);
    expect(matchesOverlayScope({...number,target:'sheet',targetScope:'selected',targetSheetIndices:[2]},context)).toBe(false);
  });
  it('draws percentage geometry responsively and transparent fill does not cover underlying content',()=>{
    const canvas=createCanvas(200,200),ctx=canvas.getContext('2d');
    renderOverlaysOnCanvas(ctx as unknown as CanvasRenderingContext2D,[shape],{x:0,y:0,width:200,height:200,pixelsPerPoint:1},context);
    expect(Array.from(ctx.getImageData(30,30,1,1).data)).toEqual([255,0,0,255]);
    expect(ctx.getImageData(15,15,1,1).data[3]).toBe(0);
    const canvas2=createCanvas(400,400),c2=canvas2.getContext('2d');
    renderOverlaysOnCanvas(c2 as unknown as CanvasRenderingContext2D,[shape],{x:0,y:0,width:400,height:400,pixelsPerPoint:2},context);
    expect(c2.getImageData(60,60,1,1).data[0]).toBe(255);
    const c3=createCanvas(200,200).getContext('2d');
    renderOverlaysOnCanvas(c3 as unknown as CanvasRenderingContext2D,[{...shape,fillColor:'transparent',strokeWidth:2}],{x:0,y:0,width:200,height:200,pixelsPerPoint:1},context);
    expect(c3.getImageData(50,50,1,1).data[3]).toBe(0);
  });
  it('renders every requested shape and text without crashing',()=>{
    const ctx=createCanvas(200,200).getContext('2d') as unknown as CanvasRenderingContext2D;
    for (const type of ['rectangle','rounded-rect','circle','line','arrow','triangle','polygon','star','diamond','badge'] as const)
      renderOverlaysOnCanvas(ctx,[{...shape,type,strokeWidth:2}],{x:0,y:0,width:200,height:200,pixelsPerPoint:1},context);
    renderOverlaysOnCanvas(ctx,[text,number],{x:0,y:0,width:200,height:200,pixelsPerPoint:1},context);
  });
});
