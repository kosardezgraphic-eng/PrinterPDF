# Print checkboxes and thumbnail selection

Thumbnail highlight selection and the print checkboxes are separate. Clicking the print checkbox of a highlighted thumbnail sets **all highlighted pages** to the clicked checkbox's new on/off value, even if they previously had mixed states or are in collapsed document groups. Clicking an unhighlighted thumbnail's checkbox affects only that page. Neither action changes the highlighted set or navigates the preview.

Right-click a thumbnail and the menu works on the **whole highlighted set**, not on the one card under the cursor: rotating, duplicating, making an array, inserting a blank page after each page, inverting the colour override, deleting and extracting to PDF are applied to every selected page at once, as one undo step. The scope line at the top of the menu says how far the action reaches, and the labels name the count. Right-clicking a thumbnail that was not part of the selection highlights just that page first, so the menu then narrows to it.

**Invert print selection** in the menu flips the checkbox of the selected pages only. A second item, **Invert print selection of all pages**, still flips every checkbox in the workspace independently, including pages in collapsed groups and outside the highlighted selection. Both are one undo/redo step, and the toolbar invert command remains a separate global operation.

The selected-for-print flags determine imposition and normal PDF output; the highlighted set is for editing and context actions. Automated UI checks use jsdom and do not verify actual mouse/touch interactions in a real browser or Electron, physical printing, or 60 fps / 10,000-page performance.
