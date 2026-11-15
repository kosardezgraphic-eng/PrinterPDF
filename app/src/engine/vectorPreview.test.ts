/**
 * The budget, not the pixels, is what this file checks.
 *
 * Crisp previews are only acceptable if they stay bounded: a render must be sized to the cell that
 * asked for it, a page that scrolls away must stop, the cache must give its memory back, and a page
 * that cannot render must not be retried forever. Every one of those promises is a behaviour of
 * `VectorPreviewRenderer`, so all of them are tested here against a fake transport that records exactly
 * what the pipeline asked the worker to do.
 */
import { describe, expect, it, vi } from 'vitest';
import { VectorPreviewRenderer, sizeBucket, vectorCacheKey, type VectorFrame, type VectorPreviewTransport } from './vectorPreview';

const frame = (): VectorFrame & { close: ReturnType<typeof vi.fn> } => {
  const close = vi.fn();
  return { source: { width: 100, height: 200 } as CanvasImageSource, width: 100, height: 200, close };
};

/** Every await the pipeline can perform, flushed. */
const flush = async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); };

/** A transport whose renders finish only when the test says so, which makes queuing and cancelling visible. */
function deferredTransport() {
  const calls: Array<{ method: 'open' | 'render' | 'cancel' | 'close'; detail: Record<string, unknown> }> = [];
  const waiters = new Map<string, { resolve: (value: VectorFrame | null) => void }>();
  let openCount = 0;
  const transport: VectorPreviewTransport = {
    async open(docId) {
      calls.push({ method: 'open', detail: { docId } });
      openCount += 1;
      return 3;
    },
    async render(query) {
      calls.push({ method: 'render', detail: { ...query } });
      return new Promise<VectorFrame | null>(resolve => { waiters.set(query.taskId, { resolve }); });
    },
    cancel(taskId) {
      calls.push({ method: 'cancel', detail: { taskId } });
      waiters.get(taskId)?.resolve(null);
      waiters.delete(taskId);
    },
    close(docId) {
      calls.push({ method: 'close', detail: { docId } });
    },
  };
  return {
    transport,
    calls,
    openCount: () => openCount,
    pendingTasks: () => [...waiters.keys()],
    settle(taskId: string, value: VectorFrame | null) {
      waiters.get(taskId)?.resolve(value);
      waiters.delete(taskId);
    },
    renderCalls: () => calls.filter(call => call.method === 'render').length,
  };
}

/** Runs one page through the pipeline to completion, with concurrency 1 it is fully deterministic. */
async function renderOnce(renderer: VectorPreviewRenderer, t: ReturnType<typeof deferredTransport>, docId: string, pageNumber: number, value = frame()) {
  const release = renderer.subscribe({ docId, pageNumber, width: 96, height: 96, bytes: () => new Uint8Array([1]) }, () => {});
  await flush();
  const taskId = t.pendingTasks()[0];
  expect(taskId, `page ${pageNumber} never reached the worker`).toBeTruthy();
  t.settle(taskId as string, value);
  await flush();
  release();
  return value;
}

describe('crisp preview sizing', () => {
  it('rounds a cell size up to a coarse step instead of rendering exactly what the layout produced', () => {
    expect(sizeBucket(300)).toBe(384);          // 4 × 96
    expect(sizeBucket(384)).toBe(384);
    expect(sizeBucket(385)).toBe(480);
    expect(sizeBucket(0)).toBe(0);
    expect(sizeBucket(-12)).toBe(0);
    expect(sizeBucket(Number.NaN)).toBe(0);
  });

  it('caps the longest side so one enormous zoom cannot ask for a giant canvas', () => {
    expect(sizeBucket(40000)).toBe(2600);
  });

  it('keys the cache by document, page and size, so a zoom does not reuse the wrong bitmap', () => {
    expect(vectorCacheKey({ docId: 'a', pageNumber: 2, width: 384, height: 480 })).toBe('a|2|384x480');
  });
});

describe('VectorPreviewRenderer queue and cache', () => {
  it('parses the document before the first render and paints at the requested size', async () => {
    const t = deferredTransport();
    const renderer = new VectorPreviewRenderer({ transportFactory: () => t.transport, concurrency: 1 });
    const painted: Array<VectorFrame | null> = [];
    const next = frame();
    renderer.subscribe({ docId: 'doc-1', pageNumber: 1, width: 384, height: 480, bytes: () => new Uint8Array([1]) }, value => painted.push(value));
    expect(t.calls.map(call => call.method)).toEqual(['open']);     // the parse is the one-time cost
    await flush();
    t.settle(t.pendingTasks()[0] as string, next);
    await flush();
    expect(painted).toEqual([next]);
    expect(t.calls.find(call => call.method === 'render')?.detail).toMatchObject({ docId: 'doc-1', pageNumber: 1, width: 384, height: 480 });
  });

  it('opens the document only once for many pages of the same file', async () => {
    const t = deferredTransport();
    const renderer = new VectorPreviewRenderer({ transportFactory: () => t.transport, concurrency: 4 });
    for (let page = 1; page <= 6; page += 1) {
      renderer.subscribe({ docId: 'doc-1', pageNumber: page, width: 96, height: 96, bytes: () => new Uint8Array([1]) }, () => {});
    }
    await flush();
    expect(t.openCount()).toBe(1);
    expect(t.renderCalls()).toBe(4);             // and four pages got painted, none of them a re-parse
  });

  it('serves a cached page without touching the worker again', async () => {
    const t = deferredTransport();
    const renderer = new VectorPreviewRenderer({ transportFactory: () => t.transport, concurrency: 1 });
    const first = await renderOnce(renderer, t, 'doc-1', 1);
    const before = t.calls.length;

    const seen: Array<VectorFrame | null> = [];
    const release = renderer.subscribe({ docId: 'doc-1', pageNumber: 1, width: 96, height: 96, bytes: () => new Uint8Array([1]) }, value => seen.push(value));
    expect(seen).toEqual([first]);               // synchronous: no flicker when scrolling back
    expect(t.calls.length).toBe(before);         // and no new work for the worker
    release();
  });

  it('cancels a render as soon as the last cell that wanted it goes away', async () => {
    const t = deferredTransport();
    const renderer = new VectorPreviewRenderer({ transportFactory: () => t.transport, concurrency: 1 });
    const release = renderer.subscribe({ docId: 'doc-1', pageNumber: 4, width: 96, height: 96, bytes: () => new Uint8Array([1]) }, () => {});
    await flush();
    const taskId = t.pendingTasks()[0] as string;
    release();
    expect(t.calls).toContainEqual({ method: 'cancel', detail: { taskId } });
  });

  it('never runs more renders at once than the concurrency limit', async () => {
    const t = deferredTransport();
    const renderer = new VectorPreviewRenderer({ transportFactory: () => t.transport, concurrency: 2 });
    for (let page = 1; page <= 5; page += 1) {
      renderer.subscribe({ docId: 'doc-1', pageNumber: page, width: 96, height: 96, bytes: () => new Uint8Array([1]) }, () => {});
    }
    expect(renderer.stats).toMatchObject({ running: 2, queued: 3 });
    await flush();
    const [first, second] = t.pendingTasks();
    t.settle(first as string, frame());
    t.settle(second as string, frame());
    await flush();
    expect(renderer.stats).toMatchObject({ running: 2, queued: 1 });
  });

  it('closes the oldest bitmap when the cache is full, so the bound is real memory', async () => {
    const t = deferredTransport();
    const renderer = new VectorPreviewRenderer({ transportFactory: () => t.transport, concurrency: 1, maxEntries: 16 });
    const made: Array<ReturnType<typeof frame>> = [];
    for (let page = 1; page <= 17; page += 1) {
      made.push(await renderOnce(renderer, t, 'doc-1', page));
    }
    expect(renderer.cachedCount).toBe(16);
    expect(made[0].close).toHaveBeenCalledTimes(1);      // the page nobody looked at for longest
    expect(made[16].close).not.toHaveBeenCalled();
  });

  it('drops everything a removed file owned, and only what it owned', async () => {
    const t = deferredTransport();
    const renderer = new VectorPreviewRenderer({ transportFactory: () => t.transport, concurrency: 1 });
    const kept = await renderOnce(renderer, t, 'doc-1', 1);

    let handedToCell: VectorFrame | null | undefined;
    const release = renderer.subscribe({ docId: 'doc-2', pageNumber: 2, width: 96, height: 96, bytes: () => new Uint8Array([1]) }, value => { handedToCell = value; });
    await flush();
    const pendingTask = t.pendingTasks()[0] as string;
    renderer.releaseDocument('doc-2');
    await flush();
    release();

    expect(t.calls).toContainEqual({ method: 'close', detail: { docId: 'doc-2' } });
    expect(t.calls).toContainEqual({ method: 'cancel', detail: { taskId: pendingTask } });
    expect(handedToCell).toBeNull();                    // the cell was told "nothing is coming", not shown a stale page
    expect(kept.close).not.toHaveBeenCalled();          // another file's page stays cached
    expect(renderer.cachedCount).toBe(1);
  });

  it('hands the cell nothing when the source bytes are gone, instead of throwing at it', async () => {
    const t = deferredTransport();
    const renderer = new VectorPreviewRenderer({ transportFactory: () => t.transport, concurrency: 1 });
    const seen: Array<VectorFrame | null> = [];
    renderer.subscribe({ docId: 'doc-1', pageNumber: 1, width: 96, height: 96, bytes: () => null }, value => seen.push(value));
    await flush();
    expect(seen).toEqual([null]);
    expect(t.renderCalls()).toBe(0);
  });

  it('gives up on a page that failed once rather than re-rendering it every paint', async () => {
    let renders = 0;
    const transport: VectorPreviewTransport = {
      async open() { return 1; },
      async render() { renders += 1; throw new Error('a font this machine does not have'); },
      cancel() {},
      close() {},
    };
    const renderer = new VectorPreviewRenderer({ transportFactory: () => transport, concurrency: 1 });
    const ask = () => new Promise<VectorFrame | null>(resolve => {
      renderer.subscribe({ docId: 'doc-1', pageNumber: 1, width: 96, height: 96, bytes: () => new Uint8Array([1]) }, resolve);
    });
    expect(await ask()).toBeNull();
    expect(await ask()).toBeNull();
    expect(renders).toBe(1);
  });

  it('releases the memory it was holding when the feature is switched off', async () => {
    const t = deferredTransport();
    const renderer = new VectorPreviewRenderer({ transportFactory: () => t.transport, concurrency: 1 });
    const held = await renderOnce(renderer, t, 'doc-1', 1);
    expect(renderer.cachedCount).toBe(1);

    renderer.setEnabled(false);
    expect(held.close).toHaveBeenCalledTimes(1);
    expect(renderer.cachedCount).toBe(0);

    // While off a cell asks for nothing at all: the import-time thumbnail is the picture.
    const seen: Array<VectorFrame | null> = [];
    renderer.subscribe({ docId: 'doc-1', pageNumber: 1, width: 96, height: 96, bytes: () => new Uint8Array([1]) }, value => seen.push(value));
    expect(seen).toEqual([null]);
  });
});

describe('the preview worker protocol', () => {
  /**
   * The transport owns three things that are easy to get wrong and impossible to see in the UI: a reply
   * is matched to the render that asked for it (not to whichever reply arrives first), cancelling
   * settles the waiting promise instead of leaving the cell hanging, and the source bytes are copied
   * into the message — if they were transferred, the store's own copy would be detached and export and
   * printing would fail on a document the operator merely looked at.
   */
  it('pairs replies by task id, settles cancels and copies the source bytes', async () => {
    const posted: Array<{ payload: Record<string, unknown>; transfer: unknown }> = [];
    const bitmap = { width: 10, height: 20, close: vi.fn() };
    class FakeWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: ((event: { message?: string }) => void) | null = null;
      postMessage(payload: Record<string, unknown>, transfer?: unknown) {
        posted.push({ payload, transfer });
        if (payload.type === 'open-preview-document') {
          this.deliver({ id: payload.id, type: 'preview-ack', pageCount: 2 });
        }
        // Page 2 answers first although page 1 asked first: the reply must reach its own caller.
        if (payload.type === 'render-preview-page' && payload.id === 'task-b') {
          this.deliver({ id: 'task-b', type: 'preview-page-result', width: 10, height: 20, bitmap });
        }
      }
      deliver(reply: Record<string, unknown>) {
        // The transport assigns `worker.onmessage`, which is how the real reply reaches it.
        this.onmessage?.({ data: reply });
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    const { createVectorWorkerTransport } = await import('./vectorPreview');
    const transport = createVectorWorkerTransport();
    expect(transport).not.toBeNull();
    const bytes = new Uint8Array([1, 2, 3]);

    await expect(transport!.open('doc-1', bytes)).resolves.toBe(2);
    expect(posted[0].payload).toMatchObject({ type: 'open-preview-document', docId: 'doc-1' });
    // An empty transfer list is the whole guarantee: `postMessage` clones unless the buffer is handed
    // over, and a transferred buffer would leave the store's own copy detached.
    expect(posted[0].transfer).toEqual([]);
    expect(bytes.byteLength).toBe(3);

    const renderA = transport!.render({ taskId: 'task-a', docId: 'doc-1', pageNumber: 1, width: 96, height: 96 });
    const renderB = transport!.render({ taskId: 'task-b', docId: 'doc-1', pageNumber: 2, width: 96, height: 96 });
    expect(await renderB).toMatchObject({ width: 10, height: 20 });
    expect((await renderB)!.source).toBe(bitmap as unknown as CanvasImageSource);

    transport!.cancel('task-a');
    expect(await renderA).toBeNull();
    expect(posted.map(entry => entry.payload)).toContainEqual({ type: 'cancel-preview-page', id: 'task-a' });
    await expect(renderA).resolves.toBeNull();       // settled once, not left hanging for the cell

    transport!.close('doc-1');
    expect(posted.at(-1)!.payload).toEqual({ type: 'close-preview-document', docId: 'doc-1' });
    vi.unstubAllGlobals();
  });

  it('reports a worker-side failure to the page that asked, and does not retry it', async () => {
    class FailingWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: ((event: { message?: string }) => void) | null = null;
      postMessage(payload: { id: string }) {
        queueMicrotask(() => this.onmessage?.({ data: { id: payload.id, type: 'preview-page-error', errorMessage: 'no font data on this machine' } }));
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FailingWorker);
    const { createVectorWorkerTransport } = await import('./vectorPreview');
    const transport = createVectorWorkerTransport();
    await expect(transport!.render({ taskId: 'x', docId: 'd', pageNumber: 1, width: 96, height: 96 }))
      .rejects.toThrow('no font data on this machine');
    vi.unstubAllGlobals();
  });
});

describe('the preview cache byte budget', () => {
  /**
   * An entry count says nothing useful about memory on its own: one cached A4 sheet at 864 px is
   * megabytes while a small cell is a fraction of that. The budget is what protects a machine with
   * little RAM, so it is enforced on its own terms — a page that fits the count limit still has to go
   * when it does not fit the byte limit. Sizes below are page sides in pixels; each one is worth
   * side × side × 4 bytes of RGBA.
   */
  const bigFrame = (side: number): VectorFrame & { close: ReturnType<typeof vi.fn> } => ({
    source: {} as unknown as CanvasImageSource,
    width: side,
    height: side,
    close: vi.fn(),
  });

  it('drops the oldest frames until the total fits, closing each one it drops', async () => {
    const t = deferredTransport();
    // 1024² is 4 MB, and 8 MB is the smallest budget the renderer accepts: two pages fit, the third does not.
    const renderer = new VectorPreviewRenderer({ transportFactory: () => t.transport, concurrency: 1, maxBytes: 8 * 1024 * 1024 });
    const made = [bigFrame(1024), bigFrame(1024), bigFrame(1024)];
    for (const [index, value] of made.entries()) await renderOnce(renderer, t, 'doc-1', index + 1, value);

    expect(renderer.cachedCount).toBe(2);                 // the count limit (16) was never the problem
    expect(renderer.cachedBytes).toBe(8 * 1024 * 1024);
    expect(made[0].close).toHaveBeenCalledTimes(1);
    expect(made[1].close).not.toHaveBeenCalled();
    expect(made[2].close).not.toHaveBeenCalled();
  });

  it('re-trims when the budget is lowered, and hands the bytes back on clear', async () => {
    const t = deferredTransport();
    const renderer = new VectorPreviewRenderer({ transportFactory: () => t.transport, concurrency: 1, maxBytes: 48 * 1024 * 1024 });
    const made = [bigFrame(2048), bigFrame(2048)];        // 16 MB each, both inside the default budget
    for (const [index, value] of made.entries()) await renderOnce(renderer, t, 'doc-1', index + 1, value);
    expect(renderer.cachedBytes).toBe(2 * 2048 * 2048 * 4);

    renderer.setByteBudget(2048 * 2048 * 4 + 1024);       // room for exactly one of them
    expect(renderer.cachedCount).toBe(1);
    expect(made[0].close).toHaveBeenCalledTimes(1);

    renderer.clear();
    expect(renderer.cachedBytes).toBe(0);
    expect(renderer.cachedCount).toBe(0);
    expect(made[1].close).toHaveBeenCalledTimes(1);
  });

  it('letting go of a document means the worker drops the parsed file too, not just the pixels', async () => {
    const t = deferredTransport();
    const renderer = new VectorPreviewRenderer({ transportFactory: () => t.transport, concurrency: 1 });
    await renderOnce(renderer, t, 'doc-1', 1);
    await renderOnce(renderer, t, 'doc-2', 1);
    expect(renderer.stats.documents).toBe(2);

    // Turning the feature off is the moment an operator is asking for their memory back.
    renderer.setEnabled(false);
    expect(renderer.stats.documents).toBe(0);
    expect(t.calls).toContainEqual({ method: 'close', detail: { docId: 'doc-1' } });
    expect(t.calls).toContainEqual({ method: 'close', detail: { docId: 'doc-2' } });
  });
});
