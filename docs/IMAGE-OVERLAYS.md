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

- embeds PNG and JPEG files directly, without resampling, when the picture is neither flipped nor letterboxed;
- rasterizes everything else (flips, other formats) through the browser's Canvas 2D at up to 300 dpi with a 4096-pixel cap per side, because `pdf-lib` has no negative scale; exporting such a picture without Canvas 2D support fails with an explicit error instead of silently dropping the picture;
- embeds each distinct picture once and reuses it on every sheet where the scope matches, and clips page-targeted pictures to their cell, so a logo repeated in a matrix costs one image object;
- honours the same scopes as the preview, so an `odd` picture appears on odd output sides only.

## Not verified here

Native OS drag-and-drop into a real browser window or the Electron shell, pixel-level agreement between the preview and the exported PDF, printer-driver behaviour, transparent or CMYK artwork, and the memory cost of many large pictures have not been measured in this environment. Browser image decoding decides which formats are accepted beyond PNG/JPEG/WebP/GIF/BMP/TIFF; a file that cannot be decoded falls back to a 1×1 measurement, which keeps the drop working but makes the first ratio neutral.
