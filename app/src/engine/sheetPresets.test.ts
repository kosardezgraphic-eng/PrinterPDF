/**
 * Chords and the profile list, before any of it touches a component.
 *
 * The chord rules are the part of this feature a user can disagree with by accident: the app must accept
 * `Alt+F7` and `Ctrl+Alt+A`, refuse a bare `F7`, refuse the reserved `Alt+F6` (that one *is* the reset),
 * and above all normalise what a hand-edited file claims. All four decisions live in `shared/models.ts`
 * so the recorder, the loader and the key handler cannot drift apart — which is what these tests pin.
 */
import { describe, expect, it } from 'vitest';
import {
  SHEET_DEFAULT_PRESET_ID,
  SHEET_DEFAULT_PRESET_SHORTCUT,
  formatShortcut,
  isAssignableShortcut,
  sanitizeSettingsPresetList,
  sanitizeSettingsShortcut,
  shortcutMatchesEvent,
} from '@shared/models';
import { buildSheetPresetRows, findPresetIdByShortcut, presetSummary } from './sheetPresets';

const press = (key: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) => ({
  key,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
});

describe('chord text', () => {
  it('normalises modifiers and letters into one canonical order', () => {
    expect(formatShortcut(press('a', { ctrl: true, alt: true }))).toBe('Ctrl+Alt+A');
    expect(formatShortcut(press('3', { alt: true, shift: true }))).toBe('Alt+Shift+3');
    expect(formatShortcut(press('F10', { alt: true }))).toBe('Alt+F10');
    expect(formatShortcut(press('f10', { alt: true }))).toBe('Alt+F10');
    // A lone modifier press is not a chord, and neither is a bare key.
    expect(formatShortcut(press('Control', {}))).toBeNull();
    expect(formatShortcut(press('Alt', { alt: true }))).toBeNull();
    expect(formatShortcut(press('q', {}))).toBeNull();
  });

  it('accepts the two families and nothing else', () => {
    expect(isAssignableShortcut('Alt+F7')).toBe(true);
    expect(isAssignableShortcut('Alt+F12')).toBe(true);
    expect(isAssignableShortcut('Ctrl+Alt+5')).toBe(true);
    expect(isAssignableShortcut('Ctrl+Alt+Z')).toBe(true);
    expect(isAssignableShortcut('Alt+F6')).toBe(false);          // the reset chord, reserved
    expect(isAssignableShortcut('Alt+F1')).toBe(false);
    expect(isAssignableShortcut('F7')).toBe(false);              // never swallow a bare function key
    expect(isAssignableShortcut('Ctrl+3')).toBe(false);          // browser tab switch
    expect(isAssignableShortcut('Ctrl+Alt+Shift+A')).toBe(false);
    expect(isAssignableShortcut('Meta+Alt+A')).toBe(false);
    expect(isAssignableShortcut('')).toBe(false);
    expect(isAssignableShortcut(undefined)).toBe(false);
  });

  it('reaches the same canonical text from a keypress and from a stored string', () => {
    const stored = sanitizeSettingsShortcut('ctrl+alt+b');
    expect(stored).toBe('Ctrl+Alt+B');
    expect(shortcutMatchesEvent(stored, press('b', { ctrl: true, alt: true }))).toBe(true);
    expect(shortcutMatchesEvent(stored, press('b', { ctrl: true, alt: true, shift: true }))).toBe(false);
    expect(shortcutMatchesEvent('', press('b', { ctrl: true, alt: true }))).toBe(false);
  });

  it('throws away anything it cannot honour, so a bad file just means no shortcut', () => {
    for (const junk of ['Alt+F6', 'nonsense', 'Ctrl+Alt+', 'F7', 'ctrl+3', '   ', 'Alt+F13', 'a+b']) {
      expect(sanitizeSettingsShortcut(junk), junk).toBe('');
    }
    // Shift is not part of the assignable families, so the normaliser must not invent a way in.
    expect(sanitizeSettingsShortcut('Alt+Shift+F8')).toBe('');
  });
});

describe('the profile list as the menu and the panel see it', () => {
  const stored = {
    id: 'p1',
    name: 'A4 duplex',
    shortcut: 'Alt+F7',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    layout: { paperSize: 'A4', rows: 2, cols: 2, duplexMode: 'long-edge' },
    effects: { invert: false, grayscale: true },
    watermark: { enabled: true },
    pageNumbering: { enabled: false },
  };

  it('always leads with the built-in defaults row, and never lets a file replace it', () => {
    const rows = buildSheetPresetRows(sanitizeSettingsPresetList([stored]), false);
    expect(rows.map(row => row.id)).toEqual([SHEET_DEFAULT_PRESET_ID, 'p1']);
    expect(rows[0].builtin).toBe(true);
    expect(rows[0].shortcut).toBe(SHEET_DEFAULT_PRESET_SHORTCUT);
    expect(rows[1].summary).toContain('2×2');

    // Spoofing the built-in id would move the reset chord onto stored data — that is refused at the file.
    expect(sanitizeSettingsPresetList([{ ...stored, id: SHEET_DEFAULT_PRESET_ID }])).toEqual([]);
  });

  it('drops the application settings a profile used to carry', () => {
    const [preset] = sanitizeSettingsPresetList([{ ...stored, settings: { language: 'en', unit: 'inch' } }]);
    expect(preset).toBeDefined();
    expect('settings' in preset).toBe(false);
    expect(preset.layout).toMatchObject({ rows: 2 });
  });

  it('resolves chords to the profile that owns them, and to nothing else', () => {
    const rows = buildSheetPresetRows(sanitizeSettingsPresetList([stored]), false);
    expect(findPresetIdByShortcut(rows, 'Alt+F7')).toBe('p1');
    expect(findPresetIdByShortcut(rows, 'Alt+F6')).toBe(SHEET_DEFAULT_PRESET_ID);
    expect(findPresetIdByShortcut(rows, 'Ctrl+Alt+9')).toBeNull();
    expect(findPresetIdByShortcut(rows, null)).toBeNull();
  });

  it('describes a profile by what changes on paper', () => {
    const isFa = true;
    expect(presetSummary({
      ...stored,
      layout: { paperSize: 'A3', rows: 1, cols: 4, duplexMode: 'none' },
      effects: { invert: true, grayscale: false, blackAndWhite: false },
      watermark: { enabled: false },
      pageNumbering: { enabled: true },
    } as never, isFa)).toBe('A3 · 1×4 · یک‌رو · شماره‌گذاری + معکوس');
    expect(presetSummary(stored as never, false)).toContain('duplex long-edge');
    expect(presetSummary(stored as never, false)).toContain('watermark');
  });
});
