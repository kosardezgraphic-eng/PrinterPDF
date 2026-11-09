import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCw } from 'lucide-react';
import type { ComputedCellPlacement, PageTransform } from '@shared/models';
import type { PageEditScope } from '../store/useAppStore';
import { dragCrop, IDENTITY_TRANSFORM, normalizeAngle, pageCropFractions, resizeRect, resizeProportionally, rotateVector, rotationFromPointer, type Handle, type Rect } from '../engine/pageGeometry';
import { PageContentImage } from './PageContentImage';
import { useAppStore } from '../store/useAppStore';

export type CanvasTool = 'move' | 'crop' | 'layout' | 'measure';
const HANDLES: { id: Handle; left: string; top: string; cursor: string }[] = [
  { id:'nw', left:'0%', top:'0%', cursor:'nwse-resize' }, { id:'n', left:'50%', top:'0%', cursor:'ns-resize' },
  { id:'ne', left:'100%', top:'0%', cursor:'nesw-resize' }, { id:'e', left:'100%', top:'50%', cursor:'ew-resize' },
  { id:'se', left:'100%', top:'100%', cursor:'nwse-resize' }, { id:'s', left:'50%', top:'100%', cursor:'ns-resize' },
  { id:'sw', left:'0%', top:'100%', cursor:'nesw-resize' }, { id:'w', left:'0%', top:'50%', cursor:'ew-resize' },
];

type Gesture = { x: number; y: number; pointerId: number; handle: Handle | 'move' | 'rotate'; rect: Rect; transform: PageTransform; centerX:number; centerY:number };
interface Props { cell: ComputedCellPlacement; sheetIndex: number; isActive: boolean; readOnly?: boolean; pxPerMm: number; tool: CanvasTool; scope: PageEditScope; spaceDown: boolean; onCurrentPage: (id: string, preserveSelection: boolean, occurrenceKey: string) => void }

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

/** Resize in the rotated local axes while keeping the opposite point fixed on screen. */
function rotatedResize(rect: Rect, handle: Handle, dx: number, dy: number, angle: number, resize: (rect:Rect, handle:Handle, dx:number, dy:number) => Rect): Rect {
  const local = rotateVector(dx,dy,-angle);
  const next = resize(rect,handle,local.x,local.y);
  const shift = rotateVector(next.x + next.width/2 - (rect.x+rect.width/2), next.y + next.height/2 - (rect.y+rect.height/2), angle);
  return {...next,x:rect.x+rect.width/2+shift.x-next.width/2,y:rect.y+rect.height/2+shift.y-next.height/2};
}

export function PageCanvasCell({ cell, sheetIndex, isActive, readOnly = false, pxPerMm, tool, scope, spaceDown, onCurrentPage }: Props) {
  const effects = useAppStore(state => state.effects);
  const language = useAppStore(state => state.settings.language);
  const applyPageGeometry = useAppStore(state => state.applyPageGeometry);
  const applyCellTransform = useAppStore(state => state.applyCellTransform);
  const reorderCellLayer = useAppStore(state => state.reorderCellLayer);
  const page = cell.page!, occurrenceKey = cell.occurrenceKey!;
  const interaction = useRef<Gesture | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [delta, setDelta] = useState({ x:0, y:0, shift:false });
  const [active, setActive] = useState(false);
  const [menu, setMenu] = useState<{x:number;y:number} | null>(null);
  const longPress = useRef<{ pointerId:number; x:number; y:number; timer:ReturnType<typeof setTimeout> | null; fired:boolean } | null>(null);
  const suppressTouchClick = useRef<{x:number;y:number} | null>(null);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (longPress.current?.timer) clearTimeout(longPress.current.timer);
    if (suppressTimer.current) clearTimeout(suppressTimer.current);
  }, []);
  useEffect(() => {
    // Changing tools during a touch/drag cancels the pending gesture.
    if (longPress.current?.timer) clearTimeout(longPress.current.timer);
    longPress.current = null;
    if (interaction.current) { interaction.current = null; setActive(false); setDelta({x:0,y:0,shift:false}); }
  }, [tool]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    window.addEventListener('keydown',close); return () => window.removeEventListener('keydown',close);
  }, [menu]);
  const canEdit = !readOnly && (tool === 'move' ? isActive && page.isHighlighted : tool === 'crop' && page.isHighlighted);
  // Sheet coordinates rather than cell coordinates let a layer move anywhere on the sheet.
  const base: Rect = { x:cell.contentXMm*pxPerMm, y:cell.contentYMm*pxPerMm,
    width:cell.contentWidthMm*pxPerMm, height:cell.contentHeightMm*pxPerMm };
  const gesture = interaction.current;
  const baseAngle = normalizeAngle(cell.transform?.rotationDeg ?? 0);
  const angle = active && gesture?.handle === 'rotate'
    ? rotationFromPointer(gesture.transform.rotationDeg ?? 0,gesture.centerX,gesture.centerY,gesture.x,gesture.y,gesture.x+delta.x,gesture.y+delta.y,delta.shift)
    : baseAngle;
  const display = active && gesture && tool === 'move'
    ? gesture.handle === 'move' ? { ...base, x:base.x+delta.x, y:base.y+delta.y }
      : gesture.handle === 'rotate' ? base
      : rotatedResize(base,gesture.handle,delta.x,delta.y,baseAngle,(r,h,x,y) => resizeForMove(r,h,x,y,gesture.transform))
    : base;
  const cropFrame = active && gesture && tool === 'crop' && gesture.handle !== 'move' && gesture.handle !== 'rotate'
    ? rotatedResize(base,gesture.handle,delta.x,delta.y,baseAngle,resizeRect) : base;
  // Unedited fill-mode content keeps its historical cell clip. Moved/resized content is clipped only by the sheet.
  const clipToCell = !cell.allowOverflow && !(active && tool === 'move');
  const inset = clipToCell ? `inset(${Math.max(0,cell.cellYMm*pxPerMm-display.y)}px ${Math.max(0,display.x+display.width-(cell.cellXMm+cell.cellWidthMm)*pxPerMm)}px ${Math.max(0,display.y+display.height-(cell.cellYMm+cell.cellHeightMm)*pxPerMm)}px ${Math.max(0,cell.cellXMm*pxPerMm-display.x)}px)` : undefined;
  const begin = (event: React.PointerEvent<HTMLElement>, handle: Handle | 'move' | 'rotate') => {
    if (!canEdit || spaceDown || interaction.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation();
    onCurrentPage(page.id,true,occurrenceKey);
    const bounds = contentRef.current?.getBoundingClientRect();
    interaction.current = { x:event.clientX, y:event.clientY, pointerId:event.pointerId, handle, rect:base, transform:cell.transform ?? IDENTITY_TRANSFORM,
      centerX:bounds ? bounds.left + bounds.width/2 : event.clientX, centerY:bounds ? bounds.top + bounds.height/2 : event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDelta({ x:0, y:0, shift:false }); setActive(true);
  };
  const move = (event: React.PointerEvent<HTMLElement>) => {
    const press = longPress.current;
    if (press && press.pointerId === event.pointerId) {
      if (press.fired) { event.preventDefault(); event.stopPropagation(); return; }
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8 && press.timer) {
        clearTimeout(press.timer); press.timer = null;
      }
    }
    const start = interaction.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation(); setDelta({ x:event.clientX-start.x, y:event.clientY-start.y, shift:event.shiftKey });
  };
  const end = (event: React.PointerEvent<HTMLElement>, canceled = false) => {
    const start = interaction.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const dx = event.clientX-start.x, dy = event.clientY-start.y;
    interaction.current = null; setActive(false); setDelta({ x:0, y:0, shift:false });
    if (canceled || Math.hypot(dx, dy) < (event.pointerType === 'touch' ? 8 : 0.5)) return;
    if (tool === 'move' && start.handle === 'rotate') {
      const rotationDeg = rotationFromPointer(start.transform.rotationDeg ?? 0,start.centerX,start.centerY,start.x,start.y,event.clientX,event.clientY,event.shiftKey);
      const transform = {...start.transform,rotationDeg};
      if (scope === 'current') applyCellTransform(page.id,occurrenceKey,transform);
      else applyPageGeometry(page.id,scope,{kind:'transform',transform});
    } else if (tool === 'crop' && start.handle !== 'move' && start.handle !== 'rotate') {
      const local = rotateVector(dx,dy,-(start.transform.rotationDeg ?? 0));
      applyPageGeometry(page.id, scope, { kind:'crop', crop:dragCrop(pageCropFractions(page), cell.effectiveRotation, start.handle, local.x, local.y, start.rect.width, start.rect.height) });
    } else if (tool === 'move' && start.handle !== 'rotate') {
      const rect = start.handle === 'move' ? { ...start.rect, x:start.rect.x+dx, y:start.rect.y+dy } : rotatedResize(start.rect,start.handle,dx,dy,start.transform.rotationDeg ?? 0,(r,h,x,y) => resizeForMove(r,h,x,y,start.transform));
      const prev = start.transform;
      const transform: PageTransform = {
        ...prev,
        x: prev.x + (rect.x-start.rect.x + (rect.width-start.rect.width)/2) / Math.max(1,cell.cellWidthMm*pxPerMm),
        y: prev.y + (rect.y-start.rect.y + (rect.height-start.rect.height)/2) / Math.max(1,cell.cellHeightMm*pxPerMm),
        scaleX: Math.max(0.05, Math.min(10, prev.scaleX * rect.width / start.rect.width)),
        scaleY: Math.max(0.05, Math.min(10, prev.scaleY * rect.height / start.rect.height)),
      };
      if (scope === 'current') applyCellTransform(page.id,occurrenceKey,transform);
      else applyPageGeometry(page.id,scope,{kind:'transform',transform});
    }
  };
  const openMenu = (x:number,y:number) => { onCurrentPage(page.id,true,occurrenceKey); setMenu({x:Math.max(0,Math.min(window.innerWidth-205,x)),y:Math.max(0,Math.min(window.innerHeight-190,y))}); };
  const consumeTouchClick = (event: React.MouseEvent<HTMLElement>) => {
    const point = suppressTouchClick.current;
    if (!point || Math.hypot(event.clientX - point.x, event.clientY - point.y) > 12) return false;
    suppressTouchClick.current = null;
    if (suppressTimer.current) clearTimeout(suppressTimer.current);
    suppressTimer.current = null;
    return true;
  };
  const finishPress = (event: React.PointerEvent<HTMLElement>, canceled = false) => {
    const press = longPress.current;
    if (press && press.pointerId === event.pointerId) {
      if (press.timer) clearTimeout(press.timer);
      longPress.current = null;
      if (press.fired) {
        event.preventDefault(); event.stopPropagation();
        // A browser may synthesize a click at the release point after a long press.
        suppressTouchClick.current = {x:event.clientX, y:event.clientY};
        if (suppressTimer.current) clearTimeout(suppressTimer.current);
        suppressTimer.current = setTimeout(() => { suppressTouchClick.current = null; suppressTimer.current = null; }, 700);
        return;
      }
    }
    end(event,canceled);
  };
  const startTouchHold = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch' || spaceDown || (tool !== 'move' && tool !== 'crop')) return;
    if (longPress.current) {
      if (longPress.current.timer) clearTimeout(longPress.current.timer);
      longPress.current.timer = null;
      return;
    }
    const press = { pointerId:event.pointerId, x:event.clientX, y:event.clientY, timer:null as ReturnType<typeof setTimeout> | null, fired:false };
    longPress.current = press;
    event.currentTarget.setPointerCapture(event.pointerId);
    press.timer = setTimeout(() => {
      if (longPress.current !== press) return;
      press.timer = null; press.fired = true;
      interaction.current = null; setActive(false); setDelta({x:0,y:0,shift:false});
      suppressTouchClick.current = {x:press.x, y:press.y};
      openMenu(press.x+16,press.y+16);
    }, 600);
  };
  const pointerEvents = { onPointerMove:move, onPointerUp:(e: React.PointerEvent<HTMLElement>) => finishPress(e), onPointerCancel:(e: React.PointerEvent<HTMLElement>) => finishPress(e,true), onLostPointerCapture:(e: React.PointerEvent<HTMLElement>) => finishPress(e,true) };
  const fa = language === 'fa';
  const menuActions = [
    {id:'front' as const, label:fa?'انتقال به روی همه':'Bring to front'},
    {id:'forward' as const, label:fa?'یک لایه جلوتر':'Bring forward'},
    {id:'backward' as const, label:fa?'یک لایه عقب‌تر':'Send backward'},
    {id:'back' as const, label:fa?'انتقال به پشت همه':'Send to back'},
  ];
  return <div data-canvas-page-id={page.id} data-occurrence-key={occurrenceKey} className="pointer-events-none absolute inset-0"
    onContextMenu={e => {
      e.preventDefault(); e.stopPropagation();
      if (readOnly) return;
      const press = longPress.current;
      if (press?.fired) return;
      if (press) {
        if (press.timer) clearTimeout(press.timer);
        press.timer = null; press.fired = true;
        interaction.current = null; setActive(false); setDelta({x:0,y:0,shift:false}); suppressTouchClick.current = {x:press.x,y:press.y};
      }
      openMenu(press ? press.x+16 : e.clientX,press ? press.y+16 : e.clientY);
    }}>
    <div ref={contentRef} data-page-content onClick={e => {
      if (tool === 'layout') return;
      e.stopPropagation();
      if (readOnly) return;
      if (consumeTouchClick(e)) { e.preventDefault(); return; }
      if (tool === 'move' || tool === 'crop') onCurrentPage(page.id,page.isHighlighted,occurrenceKey);
    }}
      onPointerDown={e => { if (readOnly) return; startTouchHold(e); if (tool === 'move') begin(e,'move'); }} {...pointerEvents}
      style={{ left:display.x, top:display.y, width:display.width, height:display.height, transform:`rotate(${angle}deg)`, clipPath:inset, pointerEvents:readOnly ? 'none' : 'auto', touchAction:canEdit ? 'none' : 'auto', WebkitTouchCallout:'none', userSelect:'none', cursor:canEdit && tool === 'move' ? 'move' : 'pointer' }}
      className={`pointer-events-auto absolute overflow-hidden ${(tool === 'move' ? isActive && page.isHighlighted : page.isHighlighted) ? 'ring-2 ring-inset ring-sky-500' : ''}`}>
      <PageContentImage page={page} effects={effects} rotation={cell.effectiveRotation} width={display.width} height={display.height} />
    </div>
    {canEdit && <div style={{ left:tool === 'crop' ? cropFrame.x : display.x, top:tool === 'crop' ? cropFrame.y : display.y,
      width:tool === 'crop' ? cropFrame.width : display.width, height:tool === 'crop' ? cropFrame.height : display.height,
      transform:`rotate(${angle}deg)` }}
      className={`pointer-events-none absolute z-20 border-2 ${tool === 'crop' ? 'border-amber-500' : 'border-sky-500'}`}>
      {HANDLES.map(handle => <button key={handle.id} type="button" aria-label={`${tool} ${handle.id}`}
        onPointerDown={e => begin(e, handle.id)} onClick={e => e.stopPropagation()} {...pointerEvents}
        style={{ left:handle.left, top:handle.top, cursor:handle.cursor, touchAction:'none', transform:'translate(-50%, -50%)' }}
        className={`pointer-events-auto absolute h-5 w-5 rounded-sm border-2 border-white shadow ${tool === 'crop' ? 'bg-amber-500' : 'bg-sky-600'}`} />)}
      {tool === 'move' && <button type="button" data-rotation-handle aria-label={fa ? 'چرخش تصویر' : 'Rotate image'}
        title={fa ? 'چرخش آزاد؛ با Shift گام‌های ۴۵ درجه' : 'Rotate freely; hold Shift to snap to 45°'}
        onPointerDown={e => begin(e,'rotate')} onClick={e => e.stopPropagation()} {...pointerEvents}
        onKeyDown={e => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault(); e.stopPropagation();
          const direction=e.key === 'ArrowRight' ? 1 : -1;
          const rotationDeg=normalizeAngle(e.shiftKey
            ? (direction > 0 ? Math.floor(baseAngle/45 + 1e-9)+1 : Math.ceil(baseAngle/45 - 1e-9)-1)*45
            : baseAngle+direction);
          const transform={...(cell.transform ?? IDENTITY_TRANSFORM),rotationDeg};
          if (scope === 'current') applyCellTransform(page.id,occurrenceKey,transform);
          else applyPageGeometry(page.id,scope,{kind:'transform',transform});
        }}
        style={{left:'50%',top:'min(22px, 20%)',transform:'translate(-50%, -50%)',touchAction:'none'}}
        className="pointer-events-auto absolute flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-indigo-600 text-white shadow cursor-grab">
        <RotateCw className="h-4 w-4" aria-hidden="true" />
      </button>}
      {tool === 'move' && active && gesture?.handle === 'rotate' && <span data-rotation-value dir="ltr" className="absolute left-1/2 top-10 -translate-x-1/2 rounded bg-slate-900/90 px-1 text-xs text-white">{Math.round(angle * 10) / 10}°</span>}
    </div>}
    {menu && createPortal(<div className="fixed inset-0 z-[9999]"
      onClickCapture={e => { if (consumeTouchClick(e)) { e.preventDefault(); e.stopPropagation(); } }}
      onClick={e => { e.stopPropagation(); setMenu(null); }} onContextMenu={e => {e.preventDefault();e.stopPropagation();setMenu(null);}}>
      <div data-layer-menu role="menu" style={{position:'fixed',left:menu.x,top:menu.y}} className="min-w-48 rounded-lg border border-slate-600 bg-slate-900 p-1 text-sm text-white shadow-xl" onClick={e => e.stopPropagation()}>
        {menuActions.map(action => <button role="menuitem" key={action.id} type="button" className="block w-full rounded px-3 py-2 text-start hover:bg-slate-700"
          onClick={() => {reorderCellLayer(sheetIndex,occurrenceKey,action.id);setMenu(null);}}>{action.label}</button>)}
      </div>
    </div>,document.body)}
  </div>;
}
