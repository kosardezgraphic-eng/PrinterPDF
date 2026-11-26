# Sheet guides and measurement

On the main preview toolbar, choose **Margins / gutters** to drag the green margin handles or purple gutter handles. Handles work with pointer events (mouse, touch, and pen). A gutter handle moves the trailing edge of its gap; the spacing is uniform across all columns or all rows, because the existing layout model stores one horizontal and one vertical gutter. These are sheet layout settings shared by all sheets, not independent per-gap settings. During a gesture the preview is provisional; releasing commits one undoable change, and pointer cancellation discards it. A minimum cell size of 5 mm is enforced by these handles.

Choose **Measure** and drag between two points on a sheet. Hold Shift while dragging to lock the dominant axis. The ruler displays Euclidean distance and horizontal/vertical components in the selected unit. It is a temporary preview overlay and is not exported or saved.

Explicit rotation is relative to the currently displayed angle and stays in effect instead of being immediately reversed by automatic fit. It rotates page content without changing the physical paper orientation; the rotated content is still fitted/positioned according to the existing layout settings. Undo restores the prior rotation behavior.

The automated UI tests simulate pointer events in jsdom, not a real browser or touchscreen. PDF raster tests cover representative rotated content and margin/gutter placement. Actual touch ergonomics, complete WYSIWYG across all formats, and performance at 10,000 pages have not been validated in this environment.
