# Editable page numbering

Page numbers are regular overlays: each one can be selected, dragged, resized and duplicated in the preview, and
they are stored in the project JSON and in undo/redo history exactly like text overlays.

## Adding and editing

* **افزودن شماره صفحه / Add page number** on the Insert tab creates one numbering overlay for the whole workspace
  (`target: page`, `targetScope: all`) with `{page}` as its template, attached to the full output sheet by default, and Persian digits when the interface language is
  Persian (English digits otherwise). It becomes selected, so the numbering panel opens immediately.
* Drag the number to move it, use the eight handles to resize its box, and press the arrow keys for a 1 mm step
  (Shift for 5 mm). Ctrl/Command-drag creates an independent copy. `Alt`-style multi-select is not supported: every
  number is its own overlay and every overlay has its own geometry, font and scope.
* The panel edits template, formula, starting number, numeral type, padding, font, size, colour, bold/italic,
  alignment, opacity and rotation. Double-clicking the number on the sheet focuses the template field.
* **افزودن شمارهٔ مستقل دیگر / Add another independent number** duplicates the current number and switches the copy to
  the complementary odd/even scope, which is how a booklet gets different placements for recto and verso.

## Template, script and safety

The template accepts `{page}`, `{total}`, `{serial}` and `{pad3}`…`{pad10}`; the panel has one-click buttons for these tokens and for the script markers. `{serial}` uses the padding value when the
numeral type is Persian or English, otherwise it is converted like `{page}`.

For superscript and subscript inside a number (for example `Page 1ᵗʰ`), wrap part of the template in `^{…}` or `_{…}` —
the panel buttons **بالانویس / زیرنویس** wrap the current template selection. Markers may not stack: if one span is
wrapped inside another, the outer style wins and the inner text is kept without its syntax.

`Number formula` is a bounded arithmetic expression over `page` only — for example `page+1000`, `1000 - page`,
`(page + 3) * 2`, optionally combined with `startOffset`. Persian and Arabic-Indic digits are accepted in the formula.
There is no JavaScript evaluation, no property access, no function calls, no exponentiation and no non-integer
results; unsafe or unsupported expressions are rejected. Roman numerals (1–3999) and abjad numerals (1–1999) raise an
error rather than silently printing a wrong number. An invalid formula shows an alert in the preview and aborts PDF
export with a message naming the overlay, instead of exporting mis-numbered sheets.

## Target and scope

`مبنا / Attach to` chooses among three coordinate systems: a document page (`page`, inside the placed content image),
an imposed cell (`cell`, positioned relative to each complete matrix/booklet cell, including its margins), or the whole
output sheet (`sheet`, positioned relative to the full physical sheet, independent of any page image). For `page` and
`cell`, `{page}` follows the source page order; for `sheet`, `{page}` follows output-side order. These modes can be used
as separate numbering overlays at the same time. Scope is `all`, `odd`, `even`, `first`, `last`, current page/sheet, or a typed range of
page or output-sheet numbers (`1, 3-5`). Odd/even is evaluated against workspace page order for page targets and
against output-side order for sheet targets; ranges are captured as page IDs or side indexes and do not change print
selection.

## What a number counts: the document page or the printed cell

`مبنای شمارش / Counting basis` is a third, independent question — *which* number a cell gets — and it is what makes
separate numbering of a grid or a booklet possible without moving any pages:

| Basis | The number | `{total}` |
| --- | --- | --- |
| `page` (default) | the page's own position in the workspace — exactly what the sidebar shows | number of pages |
| `grid` | the cell's place in the reading order **of the printed side** | cells on that side |
| `sheet` | the output side's number, shared by every cell on it | number of output sides |

On a 2×2 imposition of an eight-page file, `page` prints 1–8 across the two sides, `grid` prints 1–4 on each side, and
`sheet` prints 1,1,1,1 then 2,2,2,2. Because the basis is a property of the overlay, a document page number and a cell
number can be printed on the same sheet at once — two overlays, two templates, two bases.

For `grid`, `جهت شمارش / Counting direction` decides the walk: rows left-to-right (`ltr`), rows right-to-left (`rtl`),
columns top-to-bottom (`ttb`), columns bottom-to-top (`btt`), or `zigzag` — a boustrophedon walk that reverses every
second row, so a grid of tickets continues its count from the end of the previous row. The walk covers **occupied cells
only**, so a half-filled matrix numbers 1–3 instead of jumping over the empty rectangle. The direction is stored with the
overlay (also for `page`, where it has no effect yet) so switching basis back and forth does not forget it.

`engine/numberingSequence.ts` is the single implementation of both, called by the placement engine the preview and the
PDF exporter share; the panel's preview line uses the same function, so it cannot show one number while the paper prints
another.

Preview and PDF share `textPlacements()` and `drawOverlayText()`, so a number that is visible in the preview is drawn at
the same mm position in the export. Because the number is rasterized into the page image at ~200 dpi, it is not
selectable or searchable text in the PDF.

## Legacy numbering

The Insert tab keeps the old fixed `شماره‌گذاری قدیمی / Page / Bates # (legacy)` block, which renders its own label and
is not editable. Enabling it while an editable number exists shows a warning, because both would print.
**تبدیل شماره‌گذاری قدیمی / Convert legacy numbering** copies the legacy format, start number, Bates prefix/digits,
position and font size into a new editable overlay (attached to the output sheet, as the legacy renderer was) and turns
the legacy block off. The conversion is explicit and undoable; projects saved before this feature keep loading and
rendering exactly as before, with no automatic migration.

Unverified: real printer output, browser/PDF pixel parity, touch gestures and performance on very large documents.
