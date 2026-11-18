# Print checkboxes and thumbnail selection

Thumbnail highlight selection and the print checkboxes are separate. Clicking the print checkbox of a highlighted thumbnail sets **all highlighted pages** to the clicked checkbox's new on/off value, even if they previously had mixed states or are in collapsed document groups. Clicking an unhighlighted thumbnail's checkbox affects only that page. Neither action changes the highlighted set or navigates the preview.

Right-click a thumbnail and the menu works on the **whole highlighted set**, not on the one card under the cursor: rotating, duplicating, making an array, inserting a blank page after each page, inverting the colour override, deleting and extracting to PDF are applied to every selected page at once, as one undo step. The scope line at the top of the menu says how far the action reaches, and the labels name the count. Right-clicking a thumbnail that was not part of the selection highlights just that page first, so the menu then narrows to it.

**Invert print selection** in the menu flips the checkbox of the selected pages only. A second item, **Invert print selection of all pages**, still flips every checkbox in the workspace independently, including pages in collapsed groups and outside the highlighted selection. Both are one undo/redo step, and the toolbar invert command remains a separate global operation.

The selected-for-print flags determine imposition and normal PDF output; the highlighted set is for editing and context actions. Automated UI checks use jsdom and do not verify actual mouse/touch interactions in a real browser or Electron, physical printing, or 60 fps / 10,000-page performance.

**Invert colour is a round trip at every level.** The document switch (`Ctrl+I`, the button on the Effects
tab, `PageOverrides.invert`) flips one boolean, so the second press returns the document to the state it was
in a moment ago. A page's own override — right-click → **Invert colour**, with a label that reads *Undo the
inverted colour* while the selected pages are inverted — asks the question about what the operator actually
**sees** (`effectiveInvert()` in `engine/effectsPipeline.ts`) rather than about the stored flag, which is why
the first press on a page that inherits the global invert now changes that page instead of doing nothing. The
press after that hands the page back: `togglePagesInvertOverride()` writes `invert: undefined` whenever the
value it would store is exactly what the page already inherits, so a page that had no opinion of its own ends
with no opinion of its own, and a later global invert still reaches it. One gesture over a selection never
leaves a mix behind — the value comes from the whole selection, and a page outside the effects scope counts as
not inverted.

Pressing the document switch while pages carry overrides cannot make those pages move, and that used to look
like a stuck button; the toast now names how many pages are holding their own invert and points at their
right-click menu instead.
