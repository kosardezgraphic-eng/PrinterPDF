# Sheet profiles, and the reset that undoes them

Two things an operator in a print shop does constantly: put the machine back the way it came out of the
box, and go back to a configuration they have used before. Both used to mean changing every control by
hand, because the settings panel wrote `settings.json` but nothing ever read it back.

The list of profiles and the reset are **one feature**, not two: the first row of the list is "the shipped
defaults", it carries the `Alt+F6` chord, and pressing it is the reset. Every other row is a profile the
operator saved, and each of those can carry its own chord.

## What a profile holds — and what it must never touch

`SettingsPreset` (in `shared/models.ts`) is `layout` + `effects` + `watermark` + `pageNumbering`, with a
name, a chord and two timestamps. That is the **sheet**: imposition and placement, colour and effects,
watermark, page numbering.

The application's own settings — language, unit, calendar, operator name, tariffs, cache size, preview
fidelity — are deliberately **not** in a profile. A profile is a press setup you hand to a colleague or
switch into ten times a day; the machine's preferences are not, and while they were folded in, applying
"the layout I use every morning" also reset the language and the tariff table under the operator's hands.

- Documents, pages, bookmarks and overlays are not in a profile either: a profile describes the machine,
  not the job on the desk.
- A `settings-presets.json` written by the older build still carries a `settings` block.
  `sanitizeSettingsPresetList` drops it on read, so the old file works and simply stops touching app
  settings — nothing migrates it forward, because the block is not wanted any more.
- Applying merges each section over **its own default**, so a profile written before an option existed
  leaves that option at its default instead of at `undefined`.
- Applying is one undo step; `Ctrl+Z` brings the previous sheet setup back.

## Editing a profile

A closed row is one click to **Apply** and nothing else — that is what makes the list usable as quick
access. **Edit** on the row opens the four things that need room, and only that row is open at a time
(`editingPresetId` in the store):

| control | behaviour |
| --- | --- |
| name | an inline input, focused when the row opens; Enter or blur commits, Escape puts the old name back. A name another profile has (trimmed, case-insensitive) is refused, not silently deduplicated. |
| chord | the recorder below the divider — see the next section. |
| re-capture | stores today's sheet into that profile — contents change, name, chord and creation date stay. |
| delete | two clicks: the first marks the button, the second deletes. A pending confirmation times out after 6 s. |

**Done** commits the name and closes the row. Opening another row closes the previous one *and* cancels a
waiting recorder, and deleting the profile a row is editing closes that row too — an editor pointing at a
profile that no longer exists would write into nothing. The ribbon's quick menu carries the same Edit button,
which opens the settings modal with that row already expanded; the built-in defaults row has none, because
there is nothing in it to rename or re-capture.

Saving from the ribbon menu names the profile `پروفایل N` / `Profile N`; saving from the panel takes the
typed name, and an empty name is refused rather than auto-numbered.

The built-in first row is synthesised (`SHEET_DEFAULT_PRESET_ID`), never stored, and refuses rename and
delete. Applying it is `resetAllSettings()`: `layout`, `effects`, `watermark`, `pageNumbering` **and**
`settings` go back to the shipped defaults, `settings.language` is kept so the interface does not change
language mid-action, and the job on the desk is untouched. In the panel it asks for a second click; from
the ribbon menu and from the chord it acts immediately, because picking an item in a list is already the
deliberate act. The list never stores a row with the built-in id, so a hand-edited file cannot impersonate
it.

## Recording a chord

`isAssignableShortcut` in `shared/models.ts` decides what may be bound:

- `Alt+F7` … `Alt+F12` — Alt alone with a function key, skipping `Alt+F6` (the defaults entry) and the
  function keys the window manager owns;
- `Ctrl+Alt` plus one letter or one digit.

Anything else — a bare key, `Ctrl+3` (a browser tab), `Meta+…` (a desktop shortcut), `Alt+D` (the address
bar) — is refused with a reason, and the refusal **fails the whole action**: `saveSettingsPreset(name,
chord)` stores nothing rather than storing a profile whose key silently does nothing. Three error codes
come back from the store (`bad-shortcut`, `reserved-shortcut`, `duplicate-shortcut`) and are shown as a
one-line notice in the panel; `reserved-shortcut` is checked against the raw text before it is
canonicalised, so `alt+ f6` is reported as "that chord belongs to the defaults entry", not as an unknown
key.

The recorder itself (`ShortcutRecorder`, exported so the ribbon and the panel share it) listens in the
**capture phase** and sets `shortcutRecordingFor` in the store. It sits under the open row, next to the
`<kbd>` chip of the chord it currently has, and the row spells out the allowed set — `Alt+F7–Alt+F12`, or
`Ctrl+Alt` plus one letter or digit — so the operator learns the rule where they are about to break it. The flag matters: `App.tsx` fires profile chords from a window
listener placed *before* the "ignore keys typed into a field" guard — a chord is never text input, so it
has to work with the caret anywhere — and while a recorder is open the same listener has to stand aside or
the profile would fire while the operator is still typing its key. Escape cancels without changing the
binding; an existing chord has a small ✕ that removes it.

## Where it lives

`ipcBridge.saveSettingsPresets` → `SETTINGS_PRESETS_SAVE` → `SessionStore.saveSettingsPresets` in
`%APPDATA%\PrintStudioPro\settings-presets.json`, with a `localStorage['printstudio:presets']` fallback in a
plain browser (the same shape the settings and autosave session already use; `sandbox` and
`contextIsolation` are untouched). Profiles are in a **separate file from the settings**, so a reset cannot
destroy the profiles the operator saved on purpose — and a corrupt profile file cannot destroy the
settings.

Start-up reads both back (`restorePreferences`, called once per page load from `App.tsx` — once, because a
hot reload or a StrictMode remount must not overwrite what the operator has been editing; and it merges
rather than assigns, so a change made *while the read was in flight* keeps the operator's value, see
`settingsRestoreRace.test.ts`) through `sanitizeAppSettings` / `sanitizeSettingsPresetList`, which keep only
values that are actually possible — a hand-edited `unit: 'furlong'` or a profile list that is not an array
costs one default, not a crash.

## Tested here, and what was not

Covered by the suite: scope (a profile cannot move `settings`; the legacy `settings` block is ignored),
rename and its duplicate refusal, re-capture, delete, the built-in row refusing rename/delete, chord
normalisation / reservation / collision, the recorder flag suppressing the global handler, and both UI
paths end to end in jsdom — `sheetPresets.test.ts`, `settingsResetAndPresets.test.ts`,
`settingsRestoreRace.test.ts`, `settingsShortcutsUI.test.ts` (which covers the edit button both ways: the
row that opens, the ribbon button that opens the modal on the right row, and the built-in row that refuses
to be edited).

Not run here: the `%APPDATA%` read/write (this environment is Linux, no Electron), the real feel of
`Alt+F6` on a Windows desktop — Windows documents it as "switch to the previous window of the same
application", so whether it reaches the renderer at all is untested, which is exactly why the reset is also
a row you can click — and the C# service, which this feature does not touch.
