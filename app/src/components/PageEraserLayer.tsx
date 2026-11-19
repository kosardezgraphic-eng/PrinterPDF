import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { EraseShape, PageItem } from '@shared/models';
import { useAppStore } from '../store/useAppStore';
import { beginEraseShape, commitEraseShape, colorFromPixels, eraseMaskCss, erasePaintCss, growEraseShape, eraseShapeIsMeaningful } from '../engine/imageErase';

type Point = { x: number; y: number };
type DragState = { pointerId: number; anchor: Point; shape: EraseShape };

/**
 * Interactive eraser surface for the actual imported page. Marks remain vector geometry on PageItem,
 * so they can be undone and are exported with the page rather than being a transient screen overlay.
 */
export function PageEraserLayer({ page, width, height, pxPerMm }: { page: PageItem; width: number; height: number; pxPerMm: number }) {
  const tool = useAppStore(s => s.eraseTool);
  const brushMm = useAppStore(s => s.eraseBrushMm);
  const color = useAppStore(s => s.eraseColor);
  const setColor = useAppStore(s => s.setEraseColor);
  const setTool = useAppStore(s => s.setEraseTool);
  const setPageErase = useAppStore(s => s.setPageErase);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pending, setPending] = useState<EraseShape | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const source = useMemo(() => page.erase ?? [], [page.erase]);
  const preview = drag?.shape ?? pending ?? undefined;
  // A region is only a selection until Delete is pressed; do not mask its contents early.
  const visibleShapes = drag ? [...source, drag.shape] : source;
  const box = { width, height, widthMm: width / Math.max(0.01, pxPerMm), heightMm: height / Math.max(0.01, pxPerMm) };
  const mask = eraseMaskCss(visibleShapes, box);
  const paint = erasePaintCss(visibleShapes, box);
  const region = preview?.mode === 'region' ? preview : null;
  const brushPixels = brushMm * pxPerMm;

  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPending(null); return; }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      event.preventDefault(); event.stopPropagation();
      if (eraseShapeIsMeaningful(pending)) setPageErase(page.id, commitEraseShape(source, pending));
      setPending(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending, page.id, setPageErase, source]);

  useEffect(() => { setDrag(null); setPending(null); setCursor(null); }, [page.id, tool]);
  useEffect(() => {
    const imageLayer = surface.current?.previousElementSibling as HTMLElement | null;
    if (!imageLayer) return;
    imageLayer.style.maskImage = mask ?? '';
    imageLayer.style.webkitMaskImage = mask ?? '';
  }, [mask]);

  if (tool === 'off') return null;

  const pointAt = (event: React.PointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, (event.clientX - rect.left) / Math.max(1, rect.width) * 100)),
      y: Math.max(0, Math.min(100, (event.clientY - rect.top) / Math.max(1, rect.height) * 100)),
    };
  };

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const image = event.currentTarget.parentElement?.querySelector('img') as HTMLImageElement | null;
    const crisp = event.currentTarget.parentElement?.querySelector('canvas[data-crisp-page]') as HTMLCanvasElement | null;
    const sourceNode: CanvasImageSource | null = crisp && crisp.width ? crisp : image && image.complete && image.naturalWidth ? image : null;
    if (!sourceNode) return;
    const sourceWidth = crisp?.width || image?.naturalWidth || 0;
    const sourceHeight = crisp?.height || image?.naturalHeight || 0;
    if (!sourceWidth || !sourceHeight) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(sourceWidth - 1, Math.floor((event.clientX - rect.left) / rect.width * sourceWidth)));
    const y = Math.max(0, Math.min(sourceHeight - 1, Math.floor((event.clientY - rect.top) / rect.height * sourceHeight)));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = sourceWidth; canvas.height = sourceHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(sourceNode, 0, 0, sourceWidth, sourceHeight);
      const pixel = ctx.getImageData(x, y, 1, 1).data;
      const picked = colorFromPixels(pixel, 1, 0, 0);
      if (picked) { setColor(picked); setTool('brush'); }
    } catch {
      // A protected or not-yet-decoded preview cannot be sampled; keep the eyedropper active.
    }
  };

  return <div ref={surface} data-page-eraser={page.id} className="absolute inset-0 z-30"
    style={{ pointerEvents: 'auto', touchAction: 'none', cursor: tool === 'picker' ? 'crosshair' : tool === 'region' ? 'crosshair' : 'none' }}
    onPointerDown={event => {
      event.preventDefault(); event.stopPropagation();
      const point = pointAt(event);
      setCursor(point);
      if (tool === 'picker') { pick(event); return; }
      if (tool !== 'brush' && tool !== 'region') return;
      const shape = beginEraseShape(tool, point, brushMm / 2, color);
      event.currentTarget.setPointerCapture(event.pointerId);
      setPending(null);
      setDrag({ pointerId: event.pointerId, anchor: point, shape });
    }}
    onPointerMove={event => {
      const point = pointAt(event);
      setCursor(point);
      setDrag(current => current && current.pointerId === event.pointerId
        ? { ...current, shape: growEraseShape(current.shape, current.anchor, point) }
        : current);
    }}
    onPointerUp={event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.shape.mode === 'region') {
        if (eraseShapeIsMeaningful(drag.shape)) setPending(drag.shape);
      } else if (eraseShapeIsMeaningful(drag.shape)) {
        setPageErase(page.id, commitEraseShape(source, drag.shape));
      }
      setDrag(null);
    }}
    onPointerCancel={() => setDrag(null)}
    onPointerLeave={() => { if (!drag) setCursor(null); }}>
    {paint && <div aria-hidden="true" className="pointer-events-none absolute inset-0"
      style={{ backgroundImage: paint, backgroundSize: '100% 100%' }} />}
    {region && <div aria-hidden="true" className="pointer-events-none absolute border-2 border-dashed border-sky-500 bg-sky-400/15"
      style={{ left: region.x + '%', top: region.y + '%', width: region.width + '%', height: region.height + '%' }} />}
    {cursor && tool === 'brush' && <div aria-hidden="true" className="pointer-events-none absolute rounded-full border border-slate-900 bg-white/10 shadow-[0_0_0_1px_white]"
      style={{ width: Math.max(2, brushPixels), height: Math.max(2, brushPixels), left: cursor.x + '%', top: cursor.y + '%', transform: 'translate(-50%,-50%)' }} />}
    {pending && <div data-erase-pending="true" className="absolute inset-x-2 top-2 rounded bg-slate-950/90 px-2 py-1 text-center text-xs text-white shadow">
      {page && (useAppStore.getState().settings.language === 'fa' ? 'ناحیه انتخاب شد؛ برای اعمال پاک‌کردن Delete را بزنید و برای لغو Escape را.' : 'Region selected — press Delete to erase or Escape to cancel.')}
    </div>}
  </div>;
}
