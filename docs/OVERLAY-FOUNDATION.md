# Overlay foundation (not yet an end-user feature)

The shared model can describe text, shapes and numbering against either a document page or an output sheet using percentage geometry. Scope matching uses one-based page/side indexes; `current` and `selected` use page IDs captured when the scope is applied (for sheet selection, a side matches if it contains a captured page). A sheet-targeted `current` is currently identified by its one-based side index. The model is included in project JSON and undo snapshots; projects created before this addition load with no overlays.

`overlayRenderUtils.ts` contains a Canvas 2D renderer and bounded arithmetic parser (no JavaScript evaluation). Roman conversion accepts 1–3999 and numeric abjad accepts 1–1999; invalid inputs throw rather than silently producing a wrong serial. Geometric move/resize helpers operate on percent coordinates and eight handles.

Text overlays now have a panel, interactive preview and rasterized PDF export; see [TEXT-OVERLAYS.md](TEXT-OVERLAYS.md) for semantics and limitations. **Shape and dynamic numbering overlays remain groundwork only**: they have no control panel, interactive preview or export integration. Native printing, precise browser/PDF visual parity, real touch behavior and 120 FPS/10,000-page performance are not verified.
