/**
 * The crisp-preview pipeline: one shared worker, a bounded cache, a queue and real cancellation.
 *
 * "Show the vector file as a vector" cannot mean "render every page at maximum size once": a
 * 10 000-page file would need gigabytes and would freeze the machine. This module is the part that
 * keeps it honest. Only the page a visible cell shows is rendered, at the size that cell asks for
 * (rounded to a coarse step so zooming does not invalidate every bitmap), at most a couple of renders
 * at a time, and a render is cancelled when its cell scrolls away. Cached bitmaps live in an LRU and
 * eviction closes them, so the memory really goes back to the browser instead of waiting for a GC.
 */
import { LRUPageCache } from './pageCache';

export interface VectorFrame {
  /** Whatever `drawImage` accepts: an ImageBitmap normally, an `<img>` where that is unavailable. */
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Releases the underlying handle; without it an ImageBitmap holds memory until GC. */
  close?: () => void;
}

export interface VectorRenderQuery {
  docId: string;
  pageNumber: number;
  width: number;
  height: number;
}

/** How a preview reaches the PDF.js worker. Replaced by a fake in tests. */
export interface VectorPreviewTransport {
  /** Loads the document once; later renders of the same id are then free. */
  open(docId: string, bytes: Uint8Array): Promise<number>;
  /** Resolves to null when the render was cancelled before it finished. */
  render(query: VectorRenderQuery & { taskId: string }): Promise<VectorFrame | null>;
  cancel(taskId: string): void;
  close(docId: string): void;
}

export interface VectorPageRequest extends VectorRenderQuery {
  /** Read lazily: the bytes live in the store and the document can leave the desk mid-render. */
  bytes: () => Uint8Array | null | undefined;
}

/** Sizes are bucketed so a 5 % zoom step does not re-render the whole desk. */
export const VECTOR_SIZE_STEP_PX = 96;
/** Beyond this a preview is off-paper anyway; the cap is what protects the canvas allocation. */
export const VECTOR_MAX_SIDE_PX = 2600;

export function sizeBucket(px: number, step = VECTOR_SIZE_STEP_PX, max = VECTOR_MAX_SIDE_PX): number {
  if (!Number.isFinite(px) || px <= 0) return 0;
  return Math.min(max, Math.max(step, Math.ceil(px / step) * step));
}

export function vectorCacheKey(query: VectorRenderQuery): string {
  return `${query.docId}|${query.pageNumber}|${query.width}x${query.height}`;
}

interface VectorJob {
  key: string;
  taskId: string;
  request: VectorPageRequest;
  waiters: Set<(frame: VectorFrame | null) => void>;
  started: boolean;
}

export interface VectorPreviewOptions {
  transportFactory: () => VectorPreviewTransport | null;
  /** Bitmaps kept at once. */
  maxEntries?: number;
  /**
   * Total bitmap memory held, in bytes. An entry count is not a memory bound on its own: one cached A4
   * page at a big zoom is a few megabytes while a small cell is a fraction of that, so the cache is
   * trimmed by both limits and whichever is hit first drops the page that has gone unnoticed longest.
   */
  maxBytes?: number;
  /** Renders in parallel; 1-2 is what keeps scrolling smooth on a weak machine. */
  concurrency?: number;
}

/** A cached frame is an RGBA surface: what the browser holds is width × height × 4. */
export const BYTES_PER_PIXEL = 4;
export function vectorFrameBytes(frame: VectorFrame): number {
  return Math.max(1, Math.floor(frame.width)) * Math.max(1, Math.floor(frame.height)) * BYTES_PER_PIXEL;
}

/** Keys that failed are remembered for their size, so a broken page cannot spin the queue. */
const MAX_TRACKED_FAILURES = 128;
let jobSerial = 0;

export class VectorPreviewRenderer {
  private readonly frames: LRUPageCache<VectorFrame>;
  private readonly jobs = new Map<string, VectorJob>();
  private readonly queue: string[] = [];
  private readonly opened = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();
  private transport: VectorPreviewTransport | null | undefined;
  private readonly concurrency: number;
  private running = 0;
  private enabledFlag = true;
  private bytesHeld = 0;
  private maxBytesLimit: number;

  constructor(private readonly options: VectorPreviewOptions) {
    // Closing on eviction is the whole point of the bound: an ImageBitmap holds device memory
    // until it is closed, and dropping the reference alone would not give it back.
    this.frames = new LRUPageCache<VectorFrame>(Math.max(4, options.maxEntries ?? 24), frame => frame.close?.());
    this.maxBytesLimit = Math.max(8 * 1024 * 1024, options.maxBytes ?? 48 * 1024 * 1024);
    this.concurrency = Math.max(1, options.concurrency ?? 2);
  }

  get enabled(): boolean { return this.enabledFlag; }

  get cachedCount(): number { return this.frames.size; }

  /** Bytes of bitmap memory the cache is holding right now — the number the limit is actually about. */
  get cachedBytes(): number { return this.bytesHeld; }

  setByteBudget(bytes: number): void {
    this.maxBytesLimit = Math.max(8 * 1024 * 1024, Math.floor(bytes) || 8 * 1024 * 1024);
    this.trimToBudget();
  }

  /**
   * Drops the least recently looked-at frames until the cache is inside both limits. Deleting one key at
   * a time is what makes it real: the LRU's hook closes each dropped bitmap, so the memory returns to
   * the browser instead of waiting for a garbage collection that never has to come.
   */
  private trimToBudget(): void {
    const entries = this.frames.entries();                 // oldest first, i.e. the eviction order
    let total = 0;
    for (const [, frame] of entries) total += vectorFrameBytes(frame);
    let index = 0;
    // `length - 1` is deliberate: the frame that was just cached is the one on screen, and an oversized
    // cell must not be able to empty the cache under itself.
    while (index < entries.length - 1 && total > this.maxBytesLimit) {
      const [key, frame] = entries[index];
      this.frames.delete(key);
      total -= vectorFrameBytes(frame);
      index += 1;
    }
    this.bytesHeld = total;
  }

  /** Exposed for the status line and the tests: what the pipeline is busy with right now. */
  get stats(): { cached: number; bytes: number; queued: number; running: number; documents: number } {
    return {
      cached: this.frames.size, bytes: this.bytesHeld, queued: this.queue.length,
      running: this.running, documents: this.opened.size,
    };
  }

  /** Turns the feature off (setting) and frees everything it was holding. */
  setEnabled(enabled: boolean): void {
    if (this.enabledFlag === enabled) return;
    this.enabledFlag = enabled;
    this.clear();
  }

  setCacheLimit(entries: number): void {
    // The floor of 16 inside LRUPageCache is the real limit; asking for less is asking for the default.
    this.frames.setMaxEntries(Math.max(16, Math.floor(entries) || 16));
    this.trimToBudget();              // a lowered count limit has to release what it just dropped, too
  }

  /**
   * Frees every cached bitmap *and* every parsed document the worker is holding. The second half
   * matters more than it looks: a parsed PDF keeps its object tree alive inside the worker, so a
   * "turn it off" or "free the cache" that only dropped bitmaps would still be holding the file. Pages
   * that are looked at again re-parse from the bytes already in memory — a parse, not a re-import.
   */
  clear(): void {
    this.frames.clear();
    this.bytesHeld = 0;
    this.failed.clear();
    const transport = this.transport;
    for (const docId of this.opened.keys()) transport?.close(docId);
    this.opened.clear();
  }

  private transportOrNull(): VectorPreviewTransport | null {
    if (this.transport === undefined) this.transport = this.options.transportFactory();
    return this.transport;
  }

  /**
   * Registers interest in one page at one size. A cached frame is handed to the listener
   * synchronously; a render result arrives later on the same listener. When the last listener goes
   * away the render is cancelled rather than finished for nobody.
   */
  subscribe(request: VectorPageRequest, listener: (frame: VectorFrame | null) => void): () => void {
    const transport = this.enabledFlag ? this.transportOrNull() : null;
    const key = vectorCacheKey(request);
    if (!transport || request.width <= 0 || request.height <= 0) {
      listener(null);
      return () => {};
    }
    const cached = this.frames.get(key);
    if (cached) { listener(cached); return () => {}; }
    if (this.failed.has(key)) { listener(null); return () => {}; }

    let job = this.jobs.get(key);
    const fresh = !job;
    if (!job) {
      job = { key, taskId: `${key}#${++jobSerial}`, request, waiters: new Set(), started: false };
      this.jobs.set(key, job);
    }
    const active = job;
    active.waiters.add(listener);
    // Registered before the queue is touched, and never after: a render that fails synchronously (the
    // file left the desk) would otherwise finish with an empty waiter list and this cell would sit on
    // its thumbnail forever, never told that there is nothing coming.
    if (fresh) {
      // Newest first: what the operator just scrolled to beats what they scrolled past.
      this.queue.unshift(key);
      this.pump();
    }
    return () => {
      active.waiters.delete(listener);
      if (active.waiters.size > 0) return;
      if (this.jobs.get(active.key) === active) this.jobs.delete(active.key);
      const at = this.queue.indexOf(active.key);
      if (at >= 0) this.queue.splice(at, 1);
      if (active.started) transport.cancel(active.taskId);
    };
  }

  /** Gives up everything held for a document that left the workspace. */
  releaseDocument(docId: string): void {
    this.opened.delete(docId);
    this.transportOrNull()?.close(docId);
    const prefix = `${docId}|`;
    for (const key of [...this.jobs.keys()]) {
      if (!key.startsWith(prefix)) continue;
      const job = this.jobs.get(key)!;
      this.jobs.delete(key);
      const at = this.queue.indexOf(key);
      if (at >= 0) this.queue.splice(at, 1);
      if (job.started) this.transport?.cancel(job.taskId);
    }
    for (const key of [...this.failed]) {
      if (key.startsWith(prefix)) this.failed.delete(key);
    }
    // Deleting one key at a time closes exactly the bitmaps that belonged to this document and leaves
    // every other page's render untouched — clearing the whole cache would throw away other files too.
    for (const [key] of this.frames.entries()) {
      if (key.startsWith(prefix)) this.frames.delete(key);
    }
    this.trimToBudget();
  }

  private pump(): void {
    while (this.running < this.concurrency) {
      const next = this.queue.shift();
      if (!next) return;
      const job = this.jobs.get(next);
      if (!job || job.started) continue;
      void this.execute(job);
    }
  }

  private async execute(job: VectorJob): Promise<void> {
    const transport = this.transportOrNull();
    if (!transport) { this.finish(job, null); return; }
    job.started = true;
    this.running += 1;
    try {
      const { docId, pageNumber, width, height } = job.request;
      const bytes = job.request.bytes();
      if (!bytes) throw new Error('the source file is no longer on the desk');
      await this.ensureOpen(transport, docId, bytes);
      const frame = await transport.render({ taskId: job.taskId, docId, pageNumber, width, height });
      if (frame) {
        this.frames.set(job.key, frame);
        this.trimToBudget();          // one big page must not push the total past the budget
        this.failed.delete(job.key);
      }
      this.finish(job, frame);
    } catch {
      this.failed.add(job.key);
      while (this.failed.size > MAX_TRACKED_FAILURES) this.failed.delete(this.failed.values().next().value as string);
      this.finish(job, null);
    } finally {
      this.running -= 1;
      this.pump();
    }
  }

  private async ensureOpen(transport: VectorPreviewTransport, docId: string, bytes: Uint8Array): Promise<void> {
    const existing = this.opened.get(docId);
    if (existing) { await existing; return; }
    const opening = transport.open(docId, bytes).then(() => undefined, error => {
      this.opened.delete(docId);
      throw error;
    });
    this.opened.set(docId, opening);
    await opening;
  }

  private finish(job: VectorJob, frame: VectorFrame | null): void {
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    for (const waiter of [...job.waiters]) waiter(frame);
    job.waiters.clear();
  }
}

/**
 * The transport that talks to `pdfRendererWorker.ts`. One worker serves the whole desk, and the
 * document stays parsed inside it while its pages are on screen — that is what makes a crisp page
 * cheaper than a re-import, and what `releaseDocument` cleans up.
 */
export function createVectorWorkerTransport(): VectorPreviewTransport | null {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker | null = null;
  const pending = new Map<string, { resolve: (value: WorkerReply) => void; reject: (error: unknown) => void }>();
  let failure: unknown = null;
  const ensureWorker = (): Worker => {
    if (worker) return worker;
    const created = new Worker(new URL('./pdfRendererWorker.ts', import.meta.url), { type: 'module' });
    created.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      if (!reply?.id) return;
      const waiter = pending.get(reply.id);
      if (!waiter) return;
      pending.delete(reply.id);
      // Only the error replies carry a message; anything else is a result the caller sorts out.
      if (reply.errorMessage) waiter.reject(new Error(reply.errorMessage));
      else waiter.resolve(reply);
    };
    created.onerror = event => {
      // A worker that died takes every waiting page with it; the thumbnail is the fallback, so the
      // pages fail once each instead of the app retrying the dead worker forever.
      failure = new Error(event.message || 'The PDF preview worker stopped');
      for (const [, waiter] of pending) waiter.reject(failure);
      pending.clear();
      worker = null;
    };
    worker = created;
    return created;
  };
  // The reply is matched by the `id` the worker echoes back, so a caller that already has one (a
  // render, which a later `cancel` must be able to address) registers under that id, not a new one.
  const send = (payload: Record<string, unknown>, transfer: Transferable[] = []): Promise<WorkerReply> => {
    const id = typeof payload.id === 'string' && payload.id
      ? payload.id
      : `vec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<WorkerReply>((resolve, reject) => {
      if (failure) { reject(failure); return; }
      pending.set(id, { resolve, reject });
      const target = ensureWorker();
      target.postMessage({ ...payload, id }, transfer);
    });
  };
  return {
    async open(docId, bytes: Uint8Array) {
      // Deliberately no transfer list: `bytes` is the document's own buffer, still held by the store and
      // needed for export and printing. A detached ArrayBuffer would break those silently.
      const reply = await send({ type: 'open-preview-document', docId, bytes });
      return typeof reply.pageCount === 'number' ? reply.pageCount : 0;
    },
    async render({ taskId, docId, pageNumber, width, height }) {
      const reply = await send({ type: 'render-preview-page', id: taskId, docId, pageNumber, width, height });
      if (reply.canceled) return null;
      if (reply.bitmap) {
        const bitmap = reply.bitmap;
        return { source: bitmap, width: reply.width ?? bitmap.width, height: reply.height ?? bitmap.height, close: () => bitmap.close() };
      }
      if (reply.png) {
        const blob = new Blob([reply.png as unknown as BlobPart], { type: 'image/png' });
        if (typeof createImageBitmap === 'function') {
          const bitmap = await createImageBitmap(blob);
          return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
        }
        // No ImageBitmap in this environment: an <img> over an object URL paints the same pixels, and
        // revoking the URL on eviction is what lets the blob go.
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.src = url;
        await new Promise<void>(resolve => {
          image.onload = () => resolve();
          image.onerror = () => resolve();          // the cell keeps its thumbnail; nothing else to do
        });
        return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
      }
      throw new Error('The PDF preview worker returned no pixels');
    },
    cancel(taskId) {
      pending.get(taskId)?.resolve({ id: taskId, type: 'canceled', canceled: true });
      pending.delete(taskId);
      try { worker?.postMessage({ type: 'cancel-preview-page', id: taskId }); } catch { /* gone already */ }
    },
    close(docId) {
      try { worker?.postMessage({ type: 'close-preview-document', docId }); } catch { /* gone already */ }
    },
  };
}

interface WorkerReply {
  id: string;
  type?: string;
  canceled?: boolean;
  errorMessage?: string;
  pageCount?: number;
  width?: number;
  height?: number;
  bitmap?: ImageBitmap;
  png?: Uint8Array;
}
