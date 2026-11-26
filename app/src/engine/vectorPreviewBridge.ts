/**
 * The single main-thread entry point for crisp page previews.
 *
 * Deliberately ignorant of the store: the bytes it needs are looked up through a resolver the store
 * registers when it initialises, so this module can be imported from a component, from the store and
 * from a test without a cycle. It also answers the two questions the UI needs — can this page be
 * rendered crisply at all, and is the pipeline busy — without either of them reaching into the cache.
 */
import { VectorPreviewRenderer, createVectorWorkerTransport, sizeBucket, type VectorFrame } from './vectorPreview';
import type { SourceDocument } from '@shared/models';

export interface VectorPreviewSubject {
  documentId: string;
  /** One-based page number inside the source file; `0` means a synthetic page, which has no vectors. */
  sourcePageNumber: number;
}

export type VectorBytesResolver = (docId: string) => Uint8Array | null | undefined;

let bytesResolver: VectorBytesResolver = () => null;
let documents: (() => SourceDocument[]) | null = null;

const createDefaultRenderer = () => new VectorPreviewRenderer({
  // One worker for the whole desk. `null` is the honest answer where Workers do not exist (a test
  // runner, an Electron renderer with a restrictive CSP), and the crisp layer simply never appears.
  transportFactory: () => createVectorWorkerTransport(),
  maxEntries: 24,
  concurrency: 2,
});

let renderer = createDefaultRenderer();

/** Lets the store hand over the lookup without this module importing the store. */
export function configureVectorPreview(options: { bytes: VectorBytesResolver; documents?: () => SourceDocument[] }): void {
  bytesResolver = options.bytes;
  documents = options.documents ?? null;
}

/**
 * True when a crisp render is possible in principle for this page — no rendering, no allocation.
 * A non-PDF file has no drawing instructions to follow, so `image` files keep their bitmap, which is
 * already the pixels; that is not a downgrade, it is the same picture at the right resolution.
 */
export function supportsCrispPreview(subject: VectorPreviewSubject): boolean {
  if (!(subject.sourcePageNumber >= 1)) return false;
  const document = findVectorDocument(subject.documentId);
  if (!document || document.fileType !== 'pdf') return false;
  const bytes = bytesResolver(subject.documentId);
  return !!bytes && bytes.byteLength > 0;
}

/** The file behind a page, when the desk still has it. Used to keep the cache honest after a removal. */
export function findVectorDocument(docId: string): SourceDocument | undefined {
  return documents?.().find(document => document.id === docId);
}

/**
 * Subscribes one cell to one page at one size. The listener is called with the frame when it is ready
 * and with `null` when crisp rendering is not available; the returned function drops the subscription
 * and cancels the render if nobody else wants that page.
 */
export function requestCrispFrame(
  subject: VectorPreviewSubject,
  widthPx: number,
  heightPx: number,
  listener: (frame: VectorFrame | null) => void
): () => void {
  if (!renderer.enabled || !supportsCrispPreview(subject)) {
    listener(null);
    return () => {};
  }
  const docId = subject.documentId;
  return renderer.subscribe(
    {
      docId,
      pageNumber: subject.sourcePageNumber,
      width: widthPx,
      height: heightPx,
      bytes: () => bytesResolver(docId),
    },
    listener
  );
}

/** The size bucket used for a cell, so zoom gestures share renders instead of invalidating them. */
export function crispRenderSize(cssWidth: number, cssHeight: number, devicePixelRatio = 1): { width: number; height: number } {
  const ratio = Math.min(2, Math.max(1, devicePixelRatio || 1));
  return { width: sizeBucket(cssWidth * ratio), height: sizeBucket(cssHeight * ratio) };
}

export function setCrispPreviewEnabled(enabled: boolean): void {
  renderer.setEnabled(enabled);
}

export function setCrispPreviewCacheLimit(entries: number): void {
  renderer.setCacheLimit(entries);
}

/**
 * The memory the preview cache may hold, derived from the page-cache limit. Pages are counted in
 * thumbnails while the preview cache holds full sheets, so the two are related by a rough factor rather
 * than shared directly: about 96 KB of bitmap per cached page, kept between 24 MB and 192 MB whatever
 * the setting says. The upper bound is what stops a 20 000-page cache preference from turning the
 * preview into a memory leak.
 */
export function crispCacheBytesFor(maxCachePages: number): number {
  const pages = Math.min(20000, Math.max(16, Math.floor(maxCachePages) || 400));
  return Math.min(192 * 1024 * 1024, Math.max(24 * 1024 * 1024, pages * 96 * 1024));
}

export function setCrispPreviewByteBudget(bytes: number): void {
  renderer.setByteBudget(bytes);
}

export function clearCrispPreviewCache(): void {
  renderer.clear();
}

export function releaseCrispPreviewDocument(docId: string): void {
  renderer.releaseDocument(docId);
}

export function crispPreviewStats(): {
  enabled: boolean; cached: number; bytes: number; queued: number; running: number; documents: number;
} {
  return { enabled: renderer.enabled, ...renderer.stats };
}

/** Test seam: hand the module a renderer over a fake transport, so the queue and cache run without a worker. */
export function __setVectorRendererForTests(instance: VectorPreviewRenderer | null): void {
  renderer.clear();
  renderer = instance ?? createDefaultRenderer();
}
