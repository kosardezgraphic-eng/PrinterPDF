import {describe,expect,it} from 'vitest';
import {hasImageTransfer,isDirectlyEmbeddable,isImageFile,measureImage,rasterizeOverlayImage,readFileAsDataUrl,routeDroppedFiles} from './imageImport';

const file=(name:string,type:string)=>({name,type}) as File;
describe('picture import rules',()=>{
 it('recognises pictures by MIME type and by extension',()=>{
  expect(isImageFile(file('logo.png','image/png'))).toBe(true);
  expect(isImageFile(file('scan.HEIC',''))).toBe(false);
  expect(isImageFile(file('stamp.webp','application/octet-stream'))).toBe(true);
  expect(isImageFile(file('sheet.pdf','application/pdf'))).toBe(false);
 });
 it('only offers the sheet as a target while a file is being dragged',()=>{
  expect(hasImageTransfer({types:['Files'],files:[file('a.png','image/png')],items:[]} as unknown as DataTransfer)).toBe(true);
  expect(hasImageTransfer({types:['text/plain'],files:[],items:[]} as unknown as DataTransfer)).toBe(false);
  expect(hasImageTransfer({types:['Files'],files:[],items:[{kind:'string',type:'text/plain',getAsFile:()=>null}]} as unknown as DataTransfer)).toBe(false);
  expect(hasImageTransfer({types:['Files'],files:[],items:[{kind:'file',type:'image/jpeg',getAsFile:()=>file('a.jpg','image/jpeg')}]} as unknown as DataTransfer)).toBe(true);
  expect(hasImageTransfer(null)).toBe(false);
 });
 it('keeps the sheet for pictures and hands everything else to the document importer',()=>{
  const png=file('logo.png','image/png'),pdf=file('scan.pdf','application/pdf');
  expect(routeDroppedFiles([png,pdf],true)).toEqual({images:[png],documents:[pdf]});
  expect(routeDroppedFiles([png,pdf],false)).toEqual({images:[],documents:[png,pdf]});   // dropped anywhere else it is a new document
  expect(routeDroppedFiles([],true)).toEqual({images:[],documents:[]});
 });
 it('embeds only what pdf-lib can take as is',()=>{
  expect(isDirectlyEmbeddable('data:image/png;base64,AAA')).toBe(true);
  expect(isDirectlyEmbeddable('data:image/jpeg;base64,AAA')).toBe(true);
  expect(isDirectlyEmbeddable('data:image/webp;base64,AAA')).toBe(false);
  expect(isDirectlyEmbeddable('https://example.com/a.png')).toBe(false);
 });
 it('says what is missing instead of exporting a blank box',async()=>{
  await expect(rasterizeOverlayImage('data:image/png;base64,AAA',10,10,{fit:'contain'})).rejects.toThrow('Picture overlays need a Canvas 2D renderer');
  await expect(readFileAsDataUrl(new Blob([]) as unknown as File)).rejects.toThrow('cannot read the dropped file');
  await expect(measureImage('data:image/png;base64,AAA')).resolves.toEqual({width:1,height:1});   // no decoder here → a safe 1×1 box
 });
});
