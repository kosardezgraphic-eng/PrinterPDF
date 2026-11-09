import {describe, expect, it} from 'vitest';
import {adjustScriptRanges, resolveTextTemplate, setScriptRange} from './textFormatting';
const context={page:3,total:10,sheet:2,file:'doc.pdf',docPage:5};
describe('safe text templates and scripts',()=>{
 it('resolves page, sheet and document fields and bounded arithmetic',()=>{
  expect(resolveTextTemplate('{page}/{total} {sheet} {file} {docPage} {=(page + 2) * 3}',[],context).text).toBe('3/10 2 doc.pdf 5 15');
 });
 it('leaves invalid formulas visible and reports them rather than executing JS',()=>{
  const result=resolveTextTemplate('{=globalThis.alert(1)}',[],context);
  expect(result.error).toBeTruthy();expect(result.text).toBe('{=globalThis.alert(1)}');
  expect(resolveTextTemplate('{=page / 0}',[],context).error).toBeTruthy();
  expect(resolveTextTemplate('{=}',[],context).error).toBeTruthy();
 });
 it('maps script formatting through token expansion',()=>{
  const result=resolveTextTemplate('x{page}y',[{start:1,end:7,script:'super'}],context);
  expect(result).toMatchObject({text:'x3y',ranges:[{start:1,end:2,script:'super'}]});
 });
 it('toggles scripts and preserves offsets through insertion and deletion',()=>{
  const ranges=setScriptRange('H2O',[],1,2,'sub');expect(ranges).toEqual([{start:1,end:2,script:'sub'}]);
  expect(setScriptRange('H2O',ranges,1,2,'sub')).toEqual([]);
  expect(adjustScriptRanges('H2O','HH2O',ranges)).toEqual([{start:2,end:3,script:'sub'}]);
  expect(adjustScriptRanges('H2O','HO',ranges)).toEqual([]);
 });
});
