import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import type { EffectsSettings, PageItem } from '@shared/models';
import { buildCssFilterForPage } from '../engine/effectsPipeline';
import { crispRenderSize, requestCrispFrame } from '../engine/vectorPreviewBridge';

import type { VectorFrame } from '../engine/vectorPreview';

/**
 * Watches one cell and hands back the crisp bitmap of its page, or `null` when there is nothing crisp
 * to show (the setting is off, the page is a scanned image, or the cell is scrolled out of view).
 *
 * Visibility is the load-shedding mechanism: a 400-page file laid out on one sheet queues zero renders
 * until a cell is actually on screen, and the render for a cell that scrolls away mid-flight is
 * cancelled rather than finished for nobody.
 */
export function useCrispPageFrame(options: {
  page: PageItem;
  enabled: boolean;
  /** Cell content box in CSS pixels — the size the bitmap has to cover. */
  width: number;
  height: number;
  hostRef: RefObject<HTMLElement | null>;
}): { frame: VectorFrame | null; askAgain: () => void } {
  const { page, enabled, width, height, hostRef } = options;
  const [frame, setFrame] = useState<VectorFrame | null>(null);
  const [visible, setVisible] = useState(false);
  // Bumped when a paint fails, which is how a frame the cache has since evicted (and closed) gets
  // replaced: the subscription is re-asked, misses the cache, and a fresh render is queued.
  const [attempt, setAttempt] = useState(0);
  const askAgain = () => setAttempt(value => value + 1);
  const size = crispRenderSize(width, height, typeof window === 'undefined' ? 1 : window.devicePixelRatio);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver !== 'function') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) setVisible(entry.isIntersecting);
    }, { rootMargin: '160px' });                    // starts a render slightly before the cell arrives
    observer.observe(host);
    return () => observer.disconnect();
  }, [hostRef]);

  useEffect(() => {
    if (!enabled || !visible) { setFrame(null); return; }
    let settled = false;
    const release = requestCrispFrame(
      { documentId: page.documentId, sourcePageNumber: page.sourcePageNumber },
      size.width,
      size.height,
      next => { if (!settled) setFrame(next); }
    );
    return () => { settled = true; release(); };
    // `attempt` is in the list for the reason above; `page.updatedAt` is not, because a geometry change
    // moves the cell rather than changing the source page.
  }, [enabled, visible, attempt, page.documentId, page.sourcePageNumber, size.width, size.height]);

  return { frame, askAgain };
}

export interface CrispPageCanvasProps {
  page: PageItem;
  /** The same per-page filter the thumbnail carries, so the crisp layer cannot change the look. */
  effects: EffectsSettings;
  width: number;
  height: number;
  /** The cell's crop and rotation mapping — identical to the one `PageContentImage` uses. */
  style: CSSProperties;
  className?: string;
  frame: VectorFrame | null;
  /** Called when the frame could not be painted, i.e. it is no longer a live bitmap. */
  onStaleFrame?: () => void;
}

/**
 * Paints a rendered frame into a canvas laid over the import-time thumbnail. `data-crisp-size` is the
 * device-pixel size of the frame, which is the number worth reading when a preview looks wrong. The thumbnail stays
 * underneath on purpose: while a page is being rendered the operator sees the blurry version, and the
 * moment the crisp one lands it covers it — a blank white cell for 40 ms reads as a flicker.
 */
export function CrispPageCanvas({ page, effects, width, height, style, className, frame, onStaleFrame }: CrispPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Whether this element has ever been painted. A canvas that has nothing drawn on it must not be
  // touched at all — asking a 2D context for it is the only work the empty case would do, and an
  // environment without a real canvas implementation (jsdom, a stripped webview) charges for that.
  const painted = useRef(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ready = !!frame && frame.width > 0 && frame.height > 0;
    if (!ready && !painted.current) return;
    if (canvas.width !== (ready ? frame.width : 0)) canvas.width = ready ? frame.width : 0;
    if (canvas.height !== (ready ? frame.height : 0)) canvas.height = ready ? frame.height : 0;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!ready) { painted.current = false; return; }
    context.imageSmoothingQuality = 'high';
    try {
      context.drawImage(frame.source, 0, 0, frame.width, frame.height);
    } catch {
      // An `ImageBitmap` that the cache closed in the meantime cannot be drawn — and must not be
      // retried forever either, so the cell asks the pipeline for the page again instead.
      painted.current = false;
      onStaleFrame?.();
      return;
    }
    painted.current = true;
  }, [frame, width, height, onStaleFrame]);
  // Hidden, not unmounted: keeping the element in the tree means the crop box and the observer survive
  // the gap between "asked for a render" and "the render landed".
  const paintStyle: CSSProperties = { ...style, filter: buildCssFilterForPage(page, effects) };
  if (!frame) return <canvas ref={canvasRef} data-crisp-page={page.id} aria-hidden="true" className={className} style={{ ...paintStyle, visibility: 'hidden' }} />;
  return <canvas ref={canvasRef} data-crisp-page={page.id} data-crisp-size={`${frame.width}x${frame.height}`} aria-hidden="true" className={className} style={paintStyle} />;
}
