# Editable page numbering

Page numbers are regular overlays: each one can be selected, dragged, resized and duplicated in the preview, and
they are stored in the project JSON and in undo/redo history exactly like text overlays.

## Adding and editing

* **افزودن شماره صفحه / Add page number** on the Insert tab creates one numbering overlay for the whole workspace
  (`target: page`, `targetScope: all`) with `{page}` as its template and Persian digits when the interface language is
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

`مبنا / Attach to` chooses whether the number belongs to a document page (placed inside the rotated page box, and
clipped to the imposition cell unless the cell allows overflow) or to an output sheet (placed on the full sheet,
numbered by output side order). Scope is `all`, `odd`, `even`, `first`, `last`, current page/sheet, or a typed range of
page or output-sheet numbers (`1, 3-5`). Odd/even is evaluated against workspace page order for page targets and
against output-side order for sheet targets; ranges are captured as page IDs or side indexes and do not change print
selection.

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
