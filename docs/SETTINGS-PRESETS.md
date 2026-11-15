# Reset to defaults, and saved setting profiles

Two things an operator in a print shop does constantly: put the machine back the way it came out of the
box, and go back to a configuration they have used before. Both used to mean changing every control by
hand, because the settings panel wrote `settings.json` but nothing ever read it back.

## Reset — the button and Alt+F6

`useAppStore.getState().resetAllSettings()` (and the `Alt+F6` chord, and the button in the settings modal)
puts **every adjustable section** back on the shipped defaults: `layout` (`DEFAULT_LAYOUT`),
`effects` (`DEFAULT_EFFECTS`), `watermark`, `pageNumbering` and `settings` (`DEFAULT_SETTINGS`).

- Documents, pages, bookmarks and overlays are **not** touched: a settings reset must never throw away
  the job that is on the desk.
- `settings.language` is kept as it is, so the interface does not change language under the operator mid
  -action; the other twelve keys go back to their defaults.
- It is one undo step. `Ctrl+Z` brings the sheet sections back (they are part of `captureSnapshot`); the
  general-settings block is not in the workspace snapshot, so undo does not restore tariffs or units — the
  toast says so in both languages.
- The modal button needs a **second click** to fire. `Alt+F6` does not, because a shortcut is itself the
  deliberate act; it is handled in `App.tsx` *before* the "ignore keys typed into a field" guard, since a
  function key is never text input and the chord has to work with focus anywhere in the window. It is
  matched only when Alt is the sole modifier, so `Ctrl+Alt+F6` and `Shift+Alt+F6` stay free.

## Profiles

`SettingsPreset` (in `shared/models.ts`) is a named bundle of `layout` + `effects` + `watermark` +
`pageNumbering` + `settings`. It deliberately excludes documents, pages and overlays: a profile describes
the machine, not the job. `saveSettingsPreset(name)` returns the id, or `null` for a blank name; a name
that already exists (trimmed, case-insensitive) is **updated in place** rather than duplicated, so the
ribbon menu does not fill up with `A4`, `A4 `, `A4 (2)`.

Two ways in: the ribbon's `SettingsPresetMenu` (apply, or "save the current settings as a profile" under
the name `پریست N` / `Profile N`) and the panel inside the settings modal, which also lists, deletes and
shows when a profile was last saved. Applying merges each section over its own default, so a profile
written by an older build — one that never saw `previewFidelity`, say — leaves that option at its default
instead of at `undefined`. Applying is one undo step.

## Where it lives

`ipcBridge.saveSettingsPresets` → `SETTINGS_PRESETS_SAVE` → `SessionStore.saveSettingsPresets` in
`%APPDATA%\PrintStudioPro\settings-presets.json`, with a `localStorage['printstudio:presets']` fallback in
a plain browser (the same shape the settings and autosave session already use; `sandbox` and
`contextIsolation` are untouched). Presets are in a **separate file from the settings**, so a reset cannot
destroy the profiles the operator saved on purpose — and a corrupt profile file cannot destroy the
settings.

Start-up reads both back (`restorePreferences`, called once per page load from `App.tsx` — once, because a
hot reload or a StrictMode remount must not overwrite what the operator has been editing; and it merges
rather than assigns, so a change made *while the read was in flight* keeps the operator's value, see
`settingsRestoreRace.test.ts`) through
`sanitizeAppSettings` / `sanitizeSettingsPresetList` in `shared/models.ts`, which keep only values that
are actually possible — a hand-edited `unit: 'furlong'` or a preset list that is not an array costs one
default, not a crash. The browser path is covered by tests; the `%APPDATA%` path runs only on Windows and
**has not been executed here**. Neither has the key chord itself: Windows documents `Alt+F6` as
"switch to the previous window of the same application", so whether the chord reaches the renderer inside
Electron on a real desktop — instead of being eaten by the window manager — is untested here. The button
in the settings modal is the guaranteed path, and it is the reason the reset is reachable without the
keyboard at all.
