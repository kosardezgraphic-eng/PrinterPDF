# Geometric shapes: circle, square, arrows, stars

A print shop marks up a sheet for reasons that have nothing to do with text: a ring behind a price, a rule
under a heading, an arrow at a fold line, a crop box, a "SAMPLE" badge. The Insert tab has one button for
all of it, and every outline in it comes from one description.

## One outline, three renderers

`app/src/engine/shapes.ts` holds the outline of every shape as a list of commands — `M`, `L`, `C`, `Z` — in
millimetres around the **centre of the box**, and three consumers map those numbers into their own units:

| consumer | what it does with the commands |
| --- | --- |
| `ShapeGlyph` in `TextOverlayLayer.tsx` | one `<path>` in an SVG whose `viewBox` is the box in millimetres — the interactive preview |
| `renderOverlaysOnCanvas` in `engine/overlayRenderUtils.ts` | `moveTo`/`lineTo`/`bezierCurveTo` on a 2D context — the raster of a page |
| `exportImposedPdf` in `engine/pdfService.ts` | `drawSvgPath`, so the shape goes onto the sheet as **vector** operators |

The preview and the paper cannot disagree about a shape, because there is no second drawing of it to
disagree with. Arcs are cubic Béziers (kappa `0.5522847`), not SVG `A` commands: the error against a true
circle is 2.7e-4 of the radius, every renderer understands a cubic, and the PDF path parser does not need a
new command. `shapes.test.ts` asserts a circle is four `C` commands and that no `A` appears anywhere.

## What is offered

`SHAPE_TYPES`: rectangle, **square**, rounded rectangle, circle, ring (`badge`), triangle, diamond, polygon,
star, line, arrow. Eleven buttons in the picker, each one click.

Two of them are worth calling out:

- **`square` is the rectangle's outline with the ratio held.** The box stays equal-sided in *millimetres*
  while it is dragged or typed, which is the only difference between «مربع» and a rectangle someone forgot
  to unlock. `shapeCapabilities('square').lockAspect` is true, `rectangle`'s is false.
- **`polygon` and `star` fill the box they were dragged into.** The vertices are laid out on the
  circumscribed circle and each axis is then scaled by how far the outline actually reaches — a pentagon's
  widest points are not its top vertex, so without that step the shape would stop short of the sides of the
  box the operator drew. The scaling is per axis and around the centre, so the circumcentre — the point a
  rotated shape turns around — stays in the middle of the box.

`circle`, `badge`, `polygon`, `star`, `diamond` and `square` all start with the aspect locked, because a
stretched circle is a bug report. Shift while dragging frees any of them.

## Where a shape lands

`addShapeOverlay(type)` (in the store) inserts on the **current page**, centred, and selects it so the panel
opens on what was just made. The default box is measured in millimetres first
(`max(12, min(80, min(boxW, boxH) × 0.28))`) and only then converted to the percentages the overlay model
stores — so a circle is round on a 210×297 page, which percentages alone cannot promise. With no document
loaded it refuses with a toast instead of doing nothing silently, and if the page cannot be placed on any
sheet it says that too.

Scope works exactly like a picture's: `target` is the page or the output sheet, `targetScope` picks
current/all/odd/even/first/last/custom range, and `overlayPlacements` walks the same cells for both kinds —
`boxPlacements()` is one function serving `imagePlacements` and `shapePlacements`, because two copies of
those rules is how a preview and a printed sheet end up disagreeing.

## Style, and what a hand-edited project file cannot do to it

`strokeWidth` is in **points** (the unit a print shop quotes in) and `borderRadius` in **millimetres**, so a
1 pt hairline is still 1 pt after the box is dragged twice as big. `sides` is 3–16, `innerRadiusPercent` is
10–95, and `lineCap` only matters to the two open outlines.

Everything the panel or a `.psp` file supplies goes through `normalizeShapeStyle()`: colours are kept only if
they are `#rgb`, `#rrggbb` or `transparent` — which is what makes it safe to put them in an SVG attribute at
all — numbers are clamped to what a path can draw, and a `strokeStyle` or `lineCap` outside the known set
falls back to solid/butt. `sanitizeShapeColor` is the same guard on the raster side.

In the PDF, a shape is drawn **before** text and pictures, so a filled circle cannot sit on top of a
paragraph that was there first; the layer buttons reorder the `overlays` array itself, which is what both
the preview and the exporter sort by.

## Tests

- `shapes.test.ts` — geometry (fills the box, square in millimetres, ring winding, clamped radius, dash,
  path data, canvas commands) and style (defaults, capabilities, colour sanitising, number clamping).
- `shapesUI.test.ts` — the picker is in the Insert tab, disabled without a document, and inserts a selected
  overlay; a circle arrives round in millimetres; the panel's fields reach the store; reorder, duplicate and
  delete behave; an insert with nothing loaded says so.
- `overlayPlacements`/`overlayStore`/`exportRendering` cover the shared box rules, the store actions and the
  exported content stream.

Not verified here: how a real printer rasterises a 0.2 pt vector hairline, and whether a viewer's stroke
mitres match Chromium's `stroke-linejoin="round"` at very small sizes — both need a printed sheet.
