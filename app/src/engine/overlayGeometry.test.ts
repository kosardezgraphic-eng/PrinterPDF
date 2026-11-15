import {describe,expect,it} from 'vitest';
import {centreWithinLimits,moveOverlay,overlayLimits,resizeOverlay,type OverlayHandle} from './overlayGeometry';
const g={xPercent:20,yPercent:30,widthPercent:40,heightPercent:30};
describe('overlay percent geometry',()=>{
  it('keeps the centre on the page so a box may hang over any edge',()=>{
    // Half of a 40-wide box may leave the page (x down to -20, right edge to 120) and half of a 30-tall
    // box may leave it downward (y up to 85) — that is what a bleed looks like — while the picture never
    // disappears, because its centre is always on the sheet.
    expect(moveOverlay(g,-100,100)).toEqual({...g,xPercent:-20,yPercent:85});
    expect(moveOverlay(g,10,-5)).toEqual({...g,xPercent:30,yPercent:25});
  });

  it('lets an overlay leave a narrow content box as far as the cell that clips it',()=>{
    // A 210x297 page inside a 200x300 sheet, printed with 10mm side margins: the content box is 180 wide,
    // so the page's own edge is at xPercent 110, not 100 — the last 10mm was previously unreachable.
    const limits=overlayLimits({parentXMm:10,parentYMm:1.5,parentWidthMm:180,parentHeightMm:294,
      limitXMm:0,limitYMm:0,limitWidthMm:200,limitHeightMm:300});
    expect(limits.minX).toBeCloseTo(-5.5556,4);
    expect(limits.maxX).toBeCloseTo(105.5556,4);
    expect(moveOverlay({xPercent:95,yPercent:10,widthPercent:20,heightPercent:10},50,0,limits).xPercent)
      .toBeCloseTo(95.5556,4);                     // centre at 105.55% of the content box = the sheet edge
    // and to the left, the same: the box may hang over the cell's left edge by half its own width.
    expect(moveOverlay({xPercent:0,yPercent:10,widthPercent:20,heightPercent:10},-50,0,limits).xPercent)
      .toBeCloseTo(-15.5556,4);
  });

  it('centres an overlay that is wider than the area it may enter',()=>{
    // A background band wider than the page cannot satisfy "centre inside" and "stay out of it"; it is
    // centred instead of being shoved to one side, which would make it look off-square.
    const wide={xPercent:-40,yPercent:10,widthPercent:150,heightPercent:10};
    expect(centreWithinLimits(wide,{minX:0,minY:0,maxX:100,maxY:100})).toMatchObject({xPercent:-25});
  });

  it('clamps resizing to the printable area rather than to the content box',()=>{
    const limits={minX:-5,minY:0,maxX:105,maxY:100};
    expect(resizeOverlay(g,'se',100,100,1,limits)).toEqual({xPercent:20,yPercent:30,widthPercent:85,heightPercent:70});
    expect(resizeOverlay(g,'nw',-100,-100,1,limits)).toEqual({xPercent:-5,yPercent:0,widthPercent:65,heightPercent:60});
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
