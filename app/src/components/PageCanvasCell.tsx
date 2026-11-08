import React, { useRef, useState } from 'react';
import type { ComputedCellPlacement } from '@shared/models';
import type { PageEditScope } from '../store/useAppStore';
import { dragCrop, IDENTITY_TRANSFORM, pageCropFractions, resizeRect, type Handle, type Rect } from '../engine/pageGeometry';
import { PageContentImage } from './PageContentImage';
import { useAppStore } from '../store/useAppStore';

export type CanvasTool = 'select' | 'move' | 'crop' | 'layout' | 'measure';
const HANDLES: { id: Handle; left: string; top: string; cursor: string }[] = [
  { id:'nw', left:'0%', top:'0%', cursor:'nwse-resize' }, { id:'n', left:'50%', top:'0%', cursor:'ns-resize' },
  { id:'ne', left:'100%', top:'0%', cursor:'nesw-resize' }, { id:'e', left:'100%', top:'50%', cursor:'ew-resize' },
  { id:'se', left:'100%', top:'100%', cursor:'nwse-resize' }, { id:'s', left:'50%', top:'100%', cursor:'ns-resize' },
  { id:'sw', left:'0%', top:'100%', cursor:'nesw-resize' }, { id:'w', left:'0%', top:'50%', cursor:'ew-resize' },
];

type Gesture = { x: number; y: number; pointerId: number; handle: Handle | 'move'; rect: Rect };
interface Props { cell: ComputedCellPlacement; pxPerMm: number; tool: CanvasTool; scope: PageEditScope; spaceDown: boolean; onCurrentPage: (id: string, preserveSelection: boolean) => void }

/** Pointer events cover mouse, touch and pen; edits commit once per gesture for undo. */
export function PageCanvasCell({ cell, pxPerMm, tool, scope, spaceDown, onCurrentPage }: Props) {
  const effects = useAppStore(state => state.effects);
  const applyPageGeometry = useAppStore(state => state.applyPageGeometry);
  const page = cell.page!;
  const interaction = useRef<Gesture | null>(null);
  const [delta, setDelta] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const canEdit = (tool === 'move' || tool === 'crop') && page.isHighlighted;
  const base: Rect = { x:(cell.contentXMm-cell.cellXMm)*pxPerMm, y:(cell.contentYMm-cell.cellYMm)*pxPerMm,
    width:cell.contentWidthMm*pxPerMm, height:cell.contentHeightMm*pxPerMm };
  const gesture = interaction.current;
  const display = active && gesture && tool === 'move'
    ? gesture.handle === 'move' ? { ...base, x:base.x+delta.x, y:base.y+delta.y } : resizeRect(base, gesture.handle, delta.x, delta.y)
    : base;
  const cropFrame = active && gesture && tool === 'crop' && gesture.handle !== 'move'
    ? resizeRect(base, gesture.handle, delta.x, delta.y) : base;

  const begin = (event: React.PointerEvent<HTMLElement>, handle: Handle | 'move') => {
    if (!canEdit || spaceDown || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation();
    onCurrentPage(page.id, true);
    event.currentTarget.setPointerCapture(event.pointerId);
    interaction.current = { x:event.clientX, y:event.clientY, pointerId:event.pointerId, handle, rect:base };
    setDelta({ x:0, y:0 }); setActive(true);
  };
  const move = (event: React.PointerEvent<HTMLElement>) => {
    const start = interaction.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation(); setDelta({ x:event.clientX-start.x, y:event.clientY-start.y });
  };
  const end = (event: React.PointerEvent<HTMLElement>, canceled = false) => {
    const start = interaction.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const dx = event.clientX-start.x, dy = event.clientY-start.y;
    interaction.current = null; setActive(false); setDelta({ x:0, y:0 });
    if (canceled || Math.abs(dx) + Math.abs(dy) < 0.5) return;
    if (tool === 'crop' && start.handle !== 'move') {
      applyPageGeometry(page.id, scope, { kind:'crop', crop:dragCrop(pageCropFractions(page), cell.effectiveRotation, start.handle, dx, dy, start.rect.width, start.rect.height) });
    } else if (tool === 'move') {
      const rect = start.handle === 'move' ? { ...start.rect, x:start.rect.x+dx, y:start.rect.y+dy } : resizeRect(start.rect, start.handle, dx, dy);
      const prev = page.overrides?.transform ?? IDENTITY_TRANSFORM;
      applyPageGeometry(page.id, scope, { kind:'transform', transform:{
        x: prev.x + (rect.x-start.rect.x + (rect.width-start.rect.width)/2) / Math.max(1,cell.cellWidthMm*pxPerMm),
        y: prev.y + (rect.y-start.rect.y + (rect.height-start.rect.height)/2) / Math.max(1,cell.cellHeightMm*pxPerMm),
        scaleX: Math.max(0.05, Math.min(10, prev.scaleX * rect.width / start.rect.width)),
        scaleY: Math.max(0.05, Math.min(10, prev.scaleY * rect.height / start.rect.height)),
      } });
    }
  };
  const pointerEvents = { onPointerMove:move, onPointerUp:(e: React.PointerEvent<HTMLElement>) => end(e), onPointerCancel:(e: React.PointerEvent<HTMLElement>) => end(e, true) };
  return <div data-canvas-page-id={page.id} style={{ left:cell.cellXMm*pxPerMm, top:cell.cellYMm*pxPerMm, width:cell.cellWidthMm*pxPerMm, height:cell.cellHeightMm*pxPerMm }} className="absolute overflow-hidden">
    <div onClick={() => { if (tool === 'select' || ((tool === 'move' || tool === 'crop') && !page.isHighlighted)) onCurrentPage(page.id, false); }}
      onPointerDown={e => { if (tool === 'move') begin(e,'move'); }} {...pointerEvents}
      style={{ left:display.x, top:display.y, width:display.width, height:display.height, touchAction:canEdit ? 'none' : 'auto', cursor:canEdit && tool === 'move' ? 'move' : 'pointer' }}
      className={`absolute overflow-hidden ${page.isHighlighted ? 'ring-2 ring-inset ring-sky-500' : ''}`}>
      <PageContentImage page={page} effects={effects} rotation={cell.effectiveRotation} width={display.width} height={display.height} />
    </div>
    {canEdit && <div style={{ left:tool === 'crop' ? cropFrame.x : display.x, top:tool === 'crop' ? cropFrame.y : display.y,
      width:tool === 'crop' ? cropFrame.width : display.width, height:tool === 'crop' ? cropFrame.height : display.height }}
      className={`pointer-events-none absolute z-20 border-2 ${tool === 'crop' ? 'border-amber-500' : 'border-sky-500'}`}>
      {HANDLES.map(handle => <button key={handle.id} type="button" aria-label={`${tool} ${handle.id}`}
        onPointerDown={e => begin(e, handle.id)} {...pointerEvents}
        style={{ left:handle.left, top:handle.top, cursor:handle.cursor, touchAction:'none', transform:'translate(-50%, -50%)' }}
        className={`pointer-events-auto absolute h-5 w-5 rounded-sm border-2 border-white shadow ${tool === 'crop' ? 'bg-amber-500' : 'bg-sky-600'}`} />)}
    </div>}
  </div>;
}
