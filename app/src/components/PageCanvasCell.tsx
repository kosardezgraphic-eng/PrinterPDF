import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ComputedCellPlacement, PageTransform } from '@shared/models';
import type { PageEditScope } from '../store/useAppStore';
import { dragCrop, IDENTITY_TRANSFORM, pageCropFractions, resizeRect, resizeProportionally, type Handle, type Rect } from '../engine/pageGeometry';
import { PageContentImage } from './PageContentImage';
import { useAppStore } from '../store/useAppStore';

export type CanvasTool = 'select' | 'move' | 'crop' | 'layout' | 'measure';
const HANDLES: { id: Handle; left: string; top: string; cursor: string }[] = [
  { id:'nw', left:'0%', top:'0%', cursor:'nwse-resize' }, { id:'n', left:'50%', top:'0%', cursor:'ns-resize' },
  { id:'ne', left:'100%', top:'0%', cursor:'nesw-resize' }, { id:'e', left:'100%', top:'50%', cursor:'ew-resize' },
  { id:'se', left:'100%', top:'100%', cursor:'nwse-resize' }, { id:'s', left:'50%', top:'100%', cursor:'ns-resize' },
  { id:'sw', left:'0%', top:'100%', cursor:'nesw-resize' }, { id:'w', left:'0%', top:'50%', cursor:'ew-resize' },
];

type Gesture = { x: number; y: number; pointerId: number; handle: Handle | 'move'; rect: Rect; transform: PageTransform };
interface Props { cell: ComputedCellPlacement; sheetIndex: number; pxPerMm: number; tool: CanvasTool; scope: PageEditScope; spaceDown: boolean; onCurrentPage: (id: string, preserveSelection: boolean, occurrenceKey: string) => void }

/** Limit resize preview to exactly the same scale range as the stored transform. */
function resizeForMove(rect: Rect, handle: Handle, dx: number, dy: number, transform: PageTransform): Rect {
  const proposed = resizeProportionally(rect,handle,dx,dy);
  if (handle.length === 2) {
    const factor = Math.max(0.05 / transform.scaleX, 0.05 / transform.scaleY,
      Math.min(10 / transform.scaleX, 10 / transform.scaleY, proposed.width / rect.width));
    const width=rect.width*factor, height=rect.height*factor;
    return { x:handle.includes('w') ? rect.x+rect.width-width : rect.x,
      y:handle.includes('n') ? rect.y+rect.height-height : rect.y, width, height };
  }
  const width=Math.max(rect.width*.05/transform.scaleX,Math.min(rect.width*10/transform.scaleX,proposed.width));
  const height=Math.max(rect.height*.05/transform.scaleY,Math.min(rect.height*10/transform.scaleY,proposed.height));
  return { x:handle.includes('w') ? rect.x+rect.width-width : rect.x,
    y:handle.includes('n') ? rect.y+rect.height-height : rect.y, width, height };
}

export function PageCanvasCell({ cell, sheetIndex, pxPerMm, tool, scope, spaceDown, onCurrentPage }: Props) {
  const effects = useAppStore(state => state.effects);
  const language = useAppStore(state => state.settings.language);
  const applyPageGeometry = useAppStore(state => state.applyPageGeometry);
  const applyCellTransform = useAppStore(state => state.applyCellTransform);
  const reorderCellLayer = useAppStore(state => state.reorderCellLayer);
  const page = cell.page!, occurrenceKey = cell.occurrenceKey!;
  const interaction = useRef<Gesture | null>(null);
  const [delta, setDelta] = useState({ x:0, y:0 });
  const [active, setActive] = useState(false);
  const [menu, setMenu] = useState<{x:number;y:number} | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    window.addEventListener('keydown',close); return () => window.removeEventListener('keydown',close);
  }, [menu]);
  const canEdit = (tool === 'move' || tool === 'crop') && page.isHighlighted;
  // Sheet coordinates rather than cell coordinates let a layer move anywhere on the sheet.
  const base: Rect = { x:cell.contentXMm*pxPerMm, y:cell.contentYMm*pxPerMm,
    width:cell.contentWidthMm*pxPerMm, height:cell.contentHeightMm*pxPerMm };
  const gesture = interaction.current;
  const display = active && gesture && tool === 'move'
    ? gesture.handle === 'move' ? { ...base, x:base.x+delta.x, y:base.y+delta.y } : resizeForMove(base,gesture.handle,delta.x,delta.y,gesture.transform)
    : base;
  const cropFrame = active && gesture && tool === 'crop' && gesture.handle !== 'move'
    ? resizeRect(base, gesture.handle, delta.x, delta.y) : base;
  // Unedited fill-mode content keeps its historical cell clip. Moved/resized content is clipped only by the sheet.
  const clipToCell = !cell.allowOverflow && !(active && tool === 'move');
  const inset = clipToCell ? `inset(${Math.max(0,cell.cellYMm*pxPerMm-display.y)}px ${Math.max(0,display.x+display.width-(cell.cellXMm+cell.cellWidthMm)*pxPerMm)}px ${Math.max(0,display.y+display.height-(cell.cellYMm+cell.cellHeightMm)*pxPerMm)}px ${Math.max(0,cell.cellXMm*pxPerMm-display.x)}px)` : undefined;
  const begin = (event: React.PointerEvent<HTMLElement>, handle: Handle | 'move') => {
    if (!canEdit || spaceDown || interaction.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation();
    onCurrentPage(page.id,true,occurrenceKey);
    interaction.current = { x:event.clientX, y:event.clientY, pointerId:event.pointerId, handle, rect:base, transform:cell.transform ?? IDENTITY_TRANSFORM };
    event.currentTarget.setPointerCapture(event.pointerId);
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
      const rect = start.handle === 'move' ? { ...start.rect, x:start.rect.x+dx, y:start.rect.y+dy } : resizeForMove(start.rect,start.handle,dx,dy,start.transform);
      const prev = start.transform;
      const transform: PageTransform = {
        x: prev.x + (rect.x-start.rect.x + (rect.width-start.rect.width)/2) / Math.max(1,cell.cellWidthMm*pxPerMm),
        y: prev.y + (rect.y-start.rect.y + (rect.height-start.rect.height)/2) / Math.max(1,cell.cellHeightMm*pxPerMm),
        scaleX: Math.max(0.05, Math.min(10, prev.scaleX * rect.width / start.rect.width)),
        scaleY: Math.max(0.05, Math.min(10, prev.scaleY * rect.height / start.rect.height)),
      };
      if (scope === 'current') applyCellTransform(page.id,occurrenceKey,transform);
      else applyPageGeometry(page.id,scope,{kind:'transform',transform});
    }
  };
  const pointerEvents = { onPointerMove:move, onPointerUp:(e: React.PointerEvent<HTMLElement>) => end(e), onPointerCancel:(e: React.PointerEvent<HTMLElement>) => end(e,true), onLostPointerCapture:(e: React.PointerEvent<HTMLElement>) => end(e,true) };
  const openMenu = (x:number,y:number) => { onCurrentPage(page.id,true,occurrenceKey); setMenu({x:Math.max(0,Math.min(window.innerWidth-205,x)),y:Math.max(0,Math.min(window.innerHeight-190,y))}); };
  const fa = language === 'fa';
  const menuActions = [
    {id:'front' as const, label:fa?'انتقال به روی همه':'Bring to front'},
    {id:'forward' as const, label:fa?'یک لایه جلوتر':'Bring forward'},
    {id:'backward' as const, label:fa?'یک لایه عقب‌تر':'Send backward'},
    {id:'back' as const, label:fa?'انتقال به پشت همه':'Send to back'},
  ];
  return <div data-canvas-page-id={page.id} data-occurrence-key={occurrenceKey} className="pointer-events-none absolute inset-0"
    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX,e.clientY); }}>
    <div onClick={() => { if (tool === 'select' || ((tool === 'move' || tool === 'crop') && !page.isHighlighted)) onCurrentPage(page.id,false,occurrenceKey); }}
      onPointerDown={e => { if (tool === 'move') begin(e,'move'); }} {...pointerEvents}
      style={{ left:display.x, top:display.y, width:display.width, height:display.height, clipPath:inset, touchAction:canEdit ? 'none' : 'auto', cursor:canEdit && tool === 'move' ? 'move' : 'pointer' }}
      className={`pointer-events-auto absolute overflow-hidden ${page.isHighlighted ? 'ring-2 ring-inset ring-sky-500' : ''}`}>
      <PageContentImage page={page} effects={effects} rotation={cell.effectiveRotation} width={display.width} height={display.height} />
    </div>
    {canEdit && <div style={{ left:tool === 'crop' ? cropFrame.x : display.x, top:tool === 'crop' ? cropFrame.y : display.y,
      width:tool === 'crop' ? cropFrame.width : display.width, height:tool === 'crop' ? cropFrame.height : display.height }}
      className={`pointer-events-none absolute z-20 border-2 ${tool === 'crop' ? 'border-amber-500' : 'border-sky-500'}`}>
      {HANDLES.map(handle => <button key={handle.id} type="button" aria-label={`${tool} ${handle.id}`}
        onPointerDown={e => begin(e, handle.id)} {...pointerEvents}
        style={{ left:handle.left, top:handle.top, cursor:handle.cursor, touchAction:'none', transform:'translate(-50%, -50%)' }}
        className={`pointer-events-auto absolute h-5 w-5 rounded-sm border-2 border-white shadow ${tool === 'crop' ? 'bg-amber-500' : 'bg-sky-600'}`} />)}
      <button type="button" aria-label={fa?'ترتیب لایه':'Layer order'} title={fa?'ترتیب لایه':'Layer order'}
        onClick={e => { e.stopPropagation(); const r=e.currentTarget.getBoundingClientRect(); openMenu(r.left,r.bottom); }}
        className="pointer-events-auto absolute right-4 top-1 flex h-8 w-8 items-center justify-center rounded bg-slate-800 text-sm text-white">⋮</button>
    </div>}
    {menu && createPortal(<div className="fixed inset-0 z-[9999]" onClick={() => setMenu(null)} onContextMenu={e => {e.preventDefault();setMenu(null);}}>
      <div role="menu" style={{position:'fixed',left:menu.x,top:menu.y}} className="min-w-48 rounded-lg border border-slate-600 bg-slate-900 p-1 text-sm text-white shadow-xl" onClick={e => e.stopPropagation()}>
        {menuActions.map(action => <button role="menuitem" key={action.id} type="button" className="block w-full rounded px-3 py-2 text-start hover:bg-slate-700"
          onClick={() => {reorderCellLayer(sheetIndex,occurrenceKey,action.id);setMenu(null);}}>{action.label}</button>)}
      </div>
    </div>,document.body)}
  </div>;
}
