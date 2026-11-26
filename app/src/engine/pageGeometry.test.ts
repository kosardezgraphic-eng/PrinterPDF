import { describe, expect, it } from 'vitest';
import type { PageItem, PageRotation } from '@shared/models';
import { centeredAspectCrop, cropToMm, dragCrop, pageCropFractions, resizeRect, rotateInsets } from './pageGeometry';
import { computeImpositionSheets } from './layoutEngine';
import { DEFAULT_LAYOUT, useAppStore } from '../store/useAppStore';

const makePage = (id: string, selected = true): PageItem => ({ id, documentId:'d', documentName:'x', sourcePageNumber:1, widthMm:100, heightMm:200, rotation:0,
  selectedForPrint:true, isHighlighted:selected, isBlankPage:false, colorProfile:'color', inkCoveragePercent:10 });
describe('graphical page editing', () => {
  it('keeps the opposite edge fixed for eight resize handles', () => {
    const original = { x:10, y:20, width:100, height:200 };
    expect(resizeRect(original,'nw',10,20)).toEqual({ x:20, y:40, width:90, height:180 });
    expect(resizeRect(original,'e',20,50)).toEqual({ x:10, y:20, width:120, height:200 });
    expect(resizeRect(original,'s',20,10)).toEqual({ x:10, y:20, width:100, height:210 });
  });
  it('maps rotated crop edges to the correct original edge and clamps extreme drags', () => {
    const zero = { top:0, bottom:0, left:0, right:0 };
    const crop = dragCrop(zero, 90, 'n', 0, 30, 100, 100);
    expect(crop.left).toBeCloseTo(.3);
    for (const angle of [0,90,180,270] as PageRotation[]) {
      expect(rotateInsets(rotateInsets(crop, angle), ((360-angle)%360) as PageRotation)).toEqual(crop);
    }
    expect(dragCrop(zero,0,'w',999,0,100,100).left).toBeCloseTo(.98);
  });
  it('computes centered source ratios within existing asymmetric crops', () => {
    const original = {...makePage('one'),overrides:{cropBoxMm:{left:10,right:20,top:20,bottom:40}}};
    const crop = centeredAspectCrop(original, 1)!;
    const width = 100 * (1-crop.left-crop.right), height=200*(1-crop.top-crop.bottom);
    expect(width/height).toBeCloseTo(1);
    expect(crop.left).toBeCloseTo(.1); expect(crop.right).toBeCloseTo(.2);
    expect(crop.top).toBeCloseTo(.275); expect(crop.bottom).toBeCloseTo(.375);
    expect(centeredAspectCrop(original,0)).toBeNull();
    expect(centeredAspectCrop(original,Infinity)).toBeNull();
    expect(centeredAspectCrop(original,10000)).toBeNull();
  });
  it('applies each page aspect independently, resets its transforms, and undoes atomically', () => {
    const one=makePage('one'), two={...makePage('two'),widthMm:200,heightMm:100};
    useAppStore.setState({pages:[one,two,makePage('three',false)], layout:{...DEFAULT_LAYOUT,cellOverrides:{
      one:{pageId:'one',transform:{x:1,y:0,scaleX:2,scaleY:2},allowOverflow:true},
      other:{pageId:'three',transform:{x:1,y:0,scaleX:2,scaleY:2},allowOverflow:true}}}});
    expect(useAppStore.getState().applyAspectRatioCrop('one','selected',1)).toBe(true);
    const result=useAppStore.getState();
    for (const p of result.pages.slice(0,2)) {
      const c=pageCropFractions(p); expect(p.widthMm*(1-c.left-c.right)/(p.heightMm*(1-c.top-c.bottom))).toBeCloseTo(1);
    }
    expect(result.pages[2].overrides).toBeUndefined();
    expect(result.layout.cellOverrides?.one.transform).toBeUndefined();
    expect(result.layout.cellOverrides?.other.transform).toBeDefined();
    useAppStore.getState().undo();
    expect(useAppStore.getState().pages[0].overrides).toBeUndefined();
    expect(useAppStore.getState().layout.cellOverrides?.one.transform).toBeDefined();
    expect(useAppStore.getState().applyAspectRatioCrop('one','all',10000)).toBe(false);
    expect(useAppStore.getState().pages.every(p=>!p.overrides)).toBe(true);
  });
  it('fits cropped dimensions and applies per-page relative transforms', () => {
    const one = { ...makePage('one'), overrides:{ cropBoxMm:cropToMm(makePage('one'), { top:0, right:0, bottom:0, left:.5 }) } };
    const config = { ...DEFAULT_LAYOUT, rows:1, cols:1, duplexMode:'none' as const, autoRotateToFit:false, scaleMode:'original' as const };
    const cell = computeImpositionSheets([one],config)[0].cells[0];
    expect(cell.contentHeightMm).toBeCloseTo(cell.cellHeightMm);
    const transformed = computeImpositionSheets([{ ...one, overrides:{ ...one.overrides, transform:{ x:.1,y:0,scaleX:.5,scaleY:1 } } }],config)[0].cells[0];
    expect(transformed.contentWidthMm).toBeCloseTo(cell.contentWidthMm/2);
    expect(transformed.contentXMm + transformed.contentWidthMm/2 - (cell.contentXMm + cell.contentWidthMm/2)).toBeCloseTo(cell.cellWidthMm*.1);
  });
  it('applies relative crop to highlighted pages only and undo restores them', () => {
    useAppStore.setState({ pages:[makePage('one'),makePage('two'),makePage('three',false)] });
    useAppStore.getState().applyPageGeometry('one','selected',{ kind:'crop',crop:{ top:.1,right:0,bottom:0,left:.2 } });
    const result = useAppStore.getState().pages;
    expect(pageCropFractions(result[0]).left).toBeCloseTo(.2);
    expect(pageCropFractions(result[1]).top).toBeCloseTo(.1);
    expect(pageCropFractions(result[2]).left).toBe(0);
    useAppStore.getState().undo();
    expect(pageCropFractions(useAppStore.getState().pages[0]).left).toBe(0);
    useAppStore.getState().applyPageGeometry('one','current',{ kind:'transform',transform:{ x:.1,y:0,scaleX:1,scaleY:1 } });
    expect(useAppStore.getState().pages[1].overrides?.transform).toBeUndefined();
    useAppStore.getState().applyPageGeometry('one','all',{ kind:'reset' });
    expect(useAppStore.getState().pages[0].overrides?.transform).toBeUndefined();
  });
});
