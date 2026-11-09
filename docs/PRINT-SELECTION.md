# Print checkboxes and thumbnail selection

Thumbnail highlight selection and the print checkboxes are separate. Clicking the print checkbox of a highlighted thumbnail sets **all highlighted pages** to the clicked checkbox's new on/off value, even if they previously had mixed states or are in collapsed document groups. Clicking an unhighlighted thumbnail's checkbox affects only that page. Neither action changes the highlighted set or navigates the preview.

Right-click a highlighted thumbnail and choose **Invert print selection of highlighted pages** to flip each highlighted checkbox independently. Right-clicking an unhighlighted thumbnail first selects that one thumbnail, so the command affects that page only. Both operations are single undo/redo steps. The existing toolbar invert command remains a separate global operation.

The selected-for-print flags determine imposition and normal PDF output; the highlighted set is for editing and context actions. Automated UI checks use jsdom and do not verify actual mouse/touch interactions in a real browser or Electron, physical printing, or 60 fps / 10,000-page performance.
