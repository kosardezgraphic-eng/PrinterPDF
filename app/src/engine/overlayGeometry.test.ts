import {describe,expect,it} from 'vitest';
import {moveOverlay,resizeOverlay,type OverlayHandle} from './overlayGeometry';
const g={xPercent:20,yPercent:30,widthPercent:40,heightPercent:30};
describe('overlay percent geometry',()=>{
  it('clamps dragging without changing dimensions',()=>{
    expect(moveOverlay(g,-100,100)).toEqual({...g,xPercent:0,yPercent:70});
    expect(moveOverlay(g,10,-5)).toEqual({...g,xPercent:30,yPercent:25});
  });
  it.each([
    ['nw',{xPercent:25,yPercent:35,widthPercent:35,heightPercent:25}],
    ['n',{...g,yPercent:35,heightPercent:25}],
    ['ne',{...g,yPercent:35,widthPercent:45,heightPercent:25}],
    ['e',{...g,widthPercent:45}],
    ['se',{...g,widthPercent:45,heightPercent:35}],
    ['s',{...g,heightPercent:35}],
    ['sw',{...g,xPercent:25,widthPercent:35,heightPercent:35}],
    ['w',{...g,xPercent:25,widthPercent:35}],
  ] as [OverlayHandle,typeof g][])('resizes using %s handle', (handle,expected)=>expect(resizeOverlay(g,handle,5,5)).toEqual(expected));
  it('prevents crossing, enforces minimum size and stays within target',()=>{
    expect(resizeOverlay(g,'nw',100,100)).toEqual({xPercent:59,yPercent:59,widthPercent:1,heightPercent:1});
    expect(resizeOverlay(g,'se',100,100)).toEqual({xPercent:20,yPercent:30,widthPercent:80,heightPercent:70});
  });
});
