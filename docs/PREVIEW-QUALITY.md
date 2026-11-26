# Crisp (vector) page preview

A PDF page is not a picture. At import the app rasterises every page once, at
`min(320 / pageWidth, 480 / pageHeight)` device pixels, and stores that PNG as `page.thumbnailDataUrl`. That
is exactly what the sidebar wants and exactly what a sheet the operator zooms into must not show: a
0.2 pt vector rule becomes a grey smear as soon as the small bitmap is stretched, and text antialiased
at 320 px stops being text. The rasterisation is also how `colorProfile` and `inkCoveragePercent` are
measured, so it stays — but the preview no longer has to inherit its resolution.

## What `previewFidelity: 'crisp'` does

`app/src/engine/vectorPreview.ts` keeps a **long-lived PDF.js worker** (`pdfRendererWorker.ts`) that
parses a file once and re-runs a single page's own drawing instructions at the size a cell asks for. The
result is an `ImageBitmap` (transferred, not copied) painted by `CrispPageCanvas` on top of the
import-time thumbnail, through the same `pageImageStyle()` crop and rotation mapping the thumbnail uses —
so the crisp layer cannot shift the page by a pixel or change its filter. `fast` keeps the old behaviour.

## Why it is cheaper than it looks

The whole design is a set of bounds, because "render the real vectors" is trivially turned into a memory
leak by a 10 000-page file:

- **Only what is looked at.** A cell subscribes through an `IntersectionObserver`; an off-screen cell
  asks for nothing. The sheet is never rasterised as a whole.
- **Bucketed sizes.** Sizes are rounded up to a 96 px step (`sizeBucket`) and capped at 2600 px per side,
  so a zoom gesture reuses the render it already has instead of producing a new one per pixel.
- **Two renders at a time.** `VectorPreviewRenderer` has a queue with a concurrency of 2; everything else
  waits rather than starting.
- **Cancellation.** When the last cell interested in a page goes away, the render is cancelled (`cancel`
  reaches the live `pdf.js` render task and the waiting promise is settled with `null`).
- **A cache bounded twice.** `globalThumbnailCache` sizes itself in pages; the preview cache is bounded in
  entries *and* in bytes (`vectorFrameBytes`, default 48 MB, floor 8 MB, ceiling 192 MB from
  `settings.maxCachePages × 96 KB`). Eviction **closes** the bitmap — dropping the reference alone would
  leave the memory to a garbage collector that never has to come.
- **At most four parsed documents** (`PdfVectorPreviewer` LRU). Leaving that window costs a re-parse of a
  file already in memory, not a re-import.
- **A page that failed is not retried** — remembered per size, so a font this machine does not have does
  not restart a render on every paint.
- **Frames that go stale are re-asked, not looped**: if a bitmap was closed by eviction before the canvas
  painted it, `drawImage` throws, the cell bumps its attempt counter and one new render is queued.
- **Nothing detaches the source bytes.** `postMessage` copies them (no transfer list) because PDF.js
  *transfers* the buffer it is handed — a detached `ArrayBuffer` would break export and printing for a
  file the operator merely looked at. The parsed copy is dropped when a document leaves the desk
  (`removeDocument` → `releaseCrispPreviewDocument`).

Fallbacks, in order: crisp frame → import-time thumbnail → nothing. Blurry is always better than blank,
and a `null` listener result is a normal answer rather than an error.

The app holds **two** PDF.js workers when crisp previews are on: the per-import analysis worker
(`analyzePdfOffThread`, terminated when the import finishes) and the long-lived preview worker. Sharing
one instance would mean rewriting the import path, which was out of scope.

Image-based documents (`fileType: 'image'`) and blank pages have no drawing instructions to re-run: they
keep their stored bitmap, which already is the picture.

## Verifying it

`pdfRealRenderer.test.ts` renders a real 0.2 pt rule through real PDF.js at both sizes and asserts the
crisp frame is the requested size **and** that its darkest pixel holds more than twice as much ink as the
stretched thumbnail's — plus the four-document LRU and the `No preview document is open` path.
`vectorPreview.test.ts` covers bucketing, the queue, cancellation, both cache limits and the
no-retry-on-failure rule against a fake transport; `crispPreviewUI.test.ts` covers the React cell,
including "hidden while a render is owed" and "cancel on unmount". `packaging.test.ts` still pins
`sandbox`/`contextIsolation`.

Not verified here, because this environment cannot run it: the look of a real 60 fps scroll or zoom on
Windows/Electron, actual peak RSS, and printer-output appearance (output never went through this path —
`exportMergedOrImposedPdf` embeds source PDF pages as vectors already).
