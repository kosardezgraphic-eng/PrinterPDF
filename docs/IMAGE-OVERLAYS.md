# Picture overlays

A picture can be placed on top of the document without importing it as a page. Drag an image file from the desktop and release it **on a sheet in the preview**: it becomes an editable picture overlay on the page under the cursor. **Insert → Add picture** does the same thing from the file picker and centres the picture on the current page; several files at once create one overlay each and are undone as a single step.

Where the file is dropped decides what it becomes:

- On a populated page box of a sheet → a picture overlay attached to that page (`page` target, `Only this page` scope, so a dropped logo does not silently cover the whole document).
- On the margins, gutter or an empty cell of a sheet → an overlay attached to the **output sheet** instead, limited to that sheet.
- Anywhere else in the application, or on a sheet while a single page is open in the read-only temporary preview → the file is imported as a **document/page** exactly as before. A mixed drop is split: pictures land on the sheet, everything else goes to the importer, and a PDF dropped on a sheet is still imported once, not twice.
- Outside the sheet bounds → not an overlay; it is imported as a document.

While a picture hovers over a sheet the sheet is tinted and a dashed box previews the size the picture will get. The hint only appears for files that look like images.

## Editing on the sheet

A selected picture shows the same eight resize handles, rotate knob and drag behaviour as text overlays (see [TEXT-OVERLAYS.md](TEXT-OVERLAYS.md)):

- Drag the box to move it, `Escape` or pointer cancellation to abandon the gesture; every completed gesture is one undo step.
- `Ctrl`/`Cmd`-drag makes an independent copy of the picture on the same target.
- Arrow keys nudge by 1 mm, `Shift`+arrow by 5 mm, in the axes of the parent box.
- The rotate knob turns the box around the centre of its parent; hold `Shift` to snap to 15° steps. The panel also offers 0/90/180/270° presets and a continuous slider.

### Shift and the aspect ratio

**Shift inverts the aspect-ratio lock for the drag you are doing.** The lock itself is a property of the overlay, shown as **Lock aspect ratio** in the picture and numbering panels, and that checkbox is the source of truth:

| Overlay | Default while dragging | Default with `Shift` |
| --- | --- | --- |
| Text | free (either axis alone) | ratio kept |
| Picture | free | ratio kept |
| Newly dropped picture | **ratio kept** | free |
| Page number | **ratio kept** | free |

A freshly dropped picture and a page number are created with `lockAspect: true`, so a natural corner drag scales them proportionally and `Shift` is what frees one axis. A picture whose lock was turned off in the panel behaves like text: free by default, `Shift` to keep the ratio. Locked resizing keeps the millimetre ratio of the **box**, not of the image file, so letterboxing (`contain`) is the setting to use when the file itself must not be stretched.

## Picture panel

With a picture selected (click it in move mode, or double-click it) the panel offers:

- **Replace picture** — swap the file behind the overlay while keeping position, size and scope. The overlay's own `Copy` button duplicates it with a new id.
- **Width / Height (mm)** — the box size in millimetres, converted to the percentages the engine stores; with the ratio locked, changing one axis follows the other.
- **Fit** — *Stretch to the box* fills the box, *Contain (letterbox)* keeps the file's ratio inside the box; the preview and the exporter use the same fit rectangle.
- **Flip H / Flip V** — mirrored output.
- **Rotation** and **Opacity**.
- **Attach to** (document page or output sheet) and **Scope** (all / odd / even / first / last / current / custom selection). The custom range accepts one-based page or sheet numbers and ranges such as `1, 3-5` (Persian and Arabic digits included) and is validated before it is applied.
- **Delete picture**.

Pictures, their geometry and their scope live in the same overlay list as texts and page numbers, so z-order is shared: overlays are drawn in list order, and moving a picture forward or backward also moves text and numbers. The picture bytes are stored inside the project file as a data URL, which keeps projects self-contained but makes them heavier — downscale large artwork before shipping a project.

## Preview and PDF

Preview and export share one geometry engine (`overlayPlacements`), so the box, its rotation, the parent box's rotation, the cell clip and the fit rectangle are computed identically in both. The exporter:

- stores the file's bytes as they are when the header says a PDF can hold them — **the header, not the `data:image/...` prefix**: a JPEG saved with a PNG label is embedded as a DCT stream, which also means the preview and the PDF never disagree about the route;
- rasterizes everything else (flips, animated PNGs, exotic colour types, rotated phone JPEGs) through Canvas 2D at up to 300 dpi with a 4096-pixel cap per side, because `pdf-lib` has no negative scale; exporting such a picture without Canvas 2D support fails with an explicit error instead of silently dropping the picture;
- embeds each distinct picture once and reuses it on every sheet where the scope matches — the cache key is the picture data itself, so the same logo at three sizes is still one image object — and clips page-targeted pictures to their cell;
- honours the same scopes as the preview, so an `odd` picture appears on odd output sides only;
- writes the overlay opacity straight into the page's transparency state. It used to be floored at 0.1 while the preview showed the real value; now 4 % in the panel means 4 % on paper (the panel sliders still stop at 10 %).

`app/src/engine/imageFormat.ts` reads the PNG and JPEG headers of the stored data URL — 64 KB of it, never the pixels — and returns one `PicturePlan` that both the panel note and the exporter follow.

## Colour, transparency and rotation

| What the file is | What the PDF gets |
| --- | --- |
| PNG grey / RGB / palette / grey+alpha / RGBA | the file's own bytes; alpha becomes a soft mask, palette and 16-bit samples are normalised to 8-bit by the same decoder the preview path would use |
| PNG with `tRNS` | treated as transparent, kept as is |
| animated PNG (`acTL`) | flattened to its first frame through Canvas |
| interlaced PNG | stored as is (Adam7 is decoded by the same reader) |
| JPEG grey or YCbCr, baseline or progressive | the file's own bytes |
| JPEG with an EXIF orientation | baked into a raster first, because the browser rotates the preview and `pdf-lib` ignores the tag completely |
| CMYK JPEG marked Adobe (transform 2) | the bytes plus `pdf-lib`'s complementing `Decode`, which is what that convention needs |
| CMYK JPEG without an Adobe marker | the bytes with an **identity `Decode`**; `pdf-lib` complements every CMYK stream it writes, which prints an unmarked file as a colour negative |
| CMYK JPEG with an APP14 we cannot parse | left exactly as `pdf-lib` writes it — an unreadable marker is never guessed at |
| anything else (WebP, GIF, BMP, TIFF, SVG) | Canvas raster, so what you see is what is stored |

`describePictureFormat()` turns the same header into one line for the panel (`JPEG 100×50, CMYK (Adobe inverted), progressive`), and `pictureEmbeddingNote()` returns the consequence the exporter will apply. Colour values are still converted by the PDF viewer's own CMYK settings: the app stores no ICC profile, so a CMYK proof on the target device remains the only colour authority.

## Memory with many pictures

`npx vite-node scripts/picture-memory-benchmark.ts [count] [width] [height]` measures this on Node, no browser needed. Twelve 2400×1600 photographs (584 KB of data URL each, 6.84 MB of project state) on a 210×297 mm sheet:

| Case | Wall time | PDF | Image objects stored |
| --- | --- | --- | --- |
| each picture once | 2.4 s | 3.58 MB | 12 (3.55 MB) |
| the same pictures at three sizes (36 placements) | 3.9 s | 3.58 MB | 12 (3.55 MB) |
| two pictures × 20 sheets (800 placements) | 1.8 s | 0.16 MB | 2 (0.13 MB) |

So placement count is nearly free, and only *distinct* pictures are paid for; RSS rose about 170 MB during the first export and fell back afterwards. What is genuinely heavy is the state itself: a `PageOverlayImage.src` is a base64 data URL, so every picture costs ~1.37× its file size in memory, again for each undo snapshot, and once more in the `.psp` file. Downscale artwork before building a project that has to stay open all day.

## Files that arrive from the desktop

Dropping a file on a sheet is a browser drag in both shells: the `File` objects a drop provides are read directly, and that path is unchanged in Electron.

What Electron 32 took away was `File.path`, which is how a file *not* dragged arrives: double-clicking a document in Explorer, `PrintStudio Pro scan.png` from `start`/`Run`, or a second instance launched while the app is already open. `electron/main.ts` filters those arguments down to absolute paths with a document extension and sends them over `cli:open-files`; the preload bridge adds `readLocalFile(path)` and `onCliOpenFiles(cb)`, and the main process refuses anything that is not an existing file up to 128 MB. The renderer receives real `File` objects and routes them exactly like a drop outside a sheet — as documents, never as an overlay — with a toast naming any file it could not read. In a browser there is no bridge, the subscription is a no-op, and nothing else changes.

The same handler now deletes the temporary PDF it writes for a print job after the sidecar answers; before that, every print left a `printstudio-job-<timestamp>.pdf` in the system temp directory.

## Not verified here

- **Pixel-level agreement between the preview and the exported PDF.** The exported side is verified structurally (the picture XObject's dict, its stored bytes, the content-stream `cm`/`Do` operators, the transparency state) and geometrically through the shared placement engine, but no rasterizer compares the browser's composited pixels with a viewer's rendering here.
- **Printer-driver behaviour.** The store deliberately refuses to claim a job was sent (*Direct printing is not available yet*), because `printer-service/Program.cs` dispatches list, margins, profile, default, queue control and purge but has no `printer:print-job` case, and `PrintJobRpcParams` carries only printer, title, path, copies, duplex, dpi, colour mode and tray — page range, odd/even, collation, reverse order and scaling never reach the service. The temporary job PDF is now deleted after the sidecar answers (it used to accumulate one per print), but neither the C# service nor a real driver was built or run here, so what a driver would do with those bytes is still unknown.
- **The Electron GUI itself.** The native-file plumbing is covered by unit tests against a faked bridge plus source-contract tests, not by a launched window.
- **Colour management.** CMYK handling is a header decision, not an ICC conversion; proofs on the target device are still required.

Browser image decoding decides which formats are accepted beyond PNG/JPEG/WebP/GIF/BMP/TIFF; a file that cannot be decoded falls back to a 1×1 measurement, which keeps the drop working but makes the first ratio neutral.
