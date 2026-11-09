# Print checkboxes and thumbnail selection

Thumbnail highlight selection and the print checkboxes are separate. Clicking the print checkbox of a highlighted thumbnail sets **all highlighted pages** to the clicked checkbox's new on/off value, even if they previously had mixed states or are in collapsed document groups. Clicking an unhighlighted thumbnail's checkbox affects only that page. Neither action changes the highlighted set or navigates the preview.

Right-click any thumbnail and choose **Invert print selection of all pages** to flip every checkbox independently, including pages in collapsed groups and outside the highlighted selection. Right-clicking an unhighlighted thumbnail still highlights it for the other context operations, but does not restrict this command. Inversion is one undo/redo step. The existing toolbar invert command remains a separate global operation.

The selected-for-print flags determine imposition and normal PDF output; the highlighted set is for editing and context actions. Automated UI checks use jsdom and do not verify actual mouse/touch interactions in a real browser or Electron, physical printing, or 60 fps / 10,000-page performance.
