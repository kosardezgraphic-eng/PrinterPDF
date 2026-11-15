/**
 * Reading the list of sheet profiles the way both surfaces need to see it.
 *
 * The ribbon menu and the settings panel show the same thing — the built-in "back to the shipped
 * defaults" entry first, then the stored profiles with their summary and chord — and the chord lookup
 * has to agree with both. Keeping the three in one pure module is what stops the menu from offering a
 * profile the key handler will not fire, which is the kind of mismatch that reads as "the shortcut
 * broke".
 */
import { SHEET_DEFAULT_PRESET_ID, SHEET_DEFAULT_PRESET_SHORTCUT, type SettingsPreset } from '@shared/models';

export interface SheetPresetRow {
  id: string;
  name: string;
  /** Canonical chord (`Alt+F7`, `Ctrl+Alt+3`), or `''` when the profile has none. */
  shortcut: string;
  /** The defaults entry is not stored, not renamable and not deletable. */
  builtin: boolean;
  /** One-line description of what the profile carries; empty for the built-in row. */
  summary: string;
  changedAt: string;
}

export const DEFAULT_PRESET_ROW: SheetPresetRow = {
  id: SHEET_DEFAULT_PRESET_ID,
  name: 'default',
  shortcut: SHEET_DEFAULT_PRESET_SHORTCUT,
  builtin: true,
  summary: '',
  changedAt: '',
};

/** Persian/English labels for the built-in row, which the store does not name. */
export function defaultPresetLabel(isFa: boolean): string {
  return isFa ? 'پیش‌فرض خود برنامه (بازنشانی همه‌چیز)' : 'Shipped defaults (reset everything)';
}

function describeDuplex(mode: string, isFa: boolean): string {
  if (mode === 'none') return isFa ? 'یک‌رو' : 'simplex';
  if (mode === 'long-edge') return isFa ? 'دورو لبهٔ بلند' : 'duplex long-edge';
  if (mode === 'short-edge') return isFa ? 'دورو لبهٔ کوتاه' : 'duplex short-edge';
  return mode;
}

/**
 * What a profile actually carries, in one line. Kept to the settings an operator decides by eye — paper,
 * the n-up matrix, duplex, and whether watermark / numbering / invert are on — because "Profile 3" tells
 * you nothing at the moment you are choosing between two of them.
 */
export function presetSummary(preset: SettingsPreset, isFa: boolean): string {
  const layout = preset.layout ?? ({} as SettingsPreset['layout']);
  const parts: string[] = [];
  if (layout.paperSize) parts.push(String(layout.paperSize));
  if (layout.rows && layout.cols) parts.push(`${layout.rows}\u00d7${layout.cols}`);
  if (layout.duplexMode) parts.push(describeDuplex(String(layout.duplexMode), isFa));
  const flags = [
    preset.watermark?.enabled ? (isFa ? 'واترمارک' : 'watermark') : '',
    preset.pageNumbering?.enabled ? (isFa ? 'شماره‌گذاری' : 'numbering') : '',
    preset.effects?.invert ? (isFa ? 'معکوس' : 'invert') : '',
    preset.effects?.grayscale || preset.effects?.blackAndWhite ? (isFa ? 'سیاه‌وسفید' : 'b&w') : '',
  ].filter(Boolean);
  if (flags.length) parts.push(flags.join(isFa ? ' + ' : ' + '));
  return parts.join(' · ');
}

export function buildSheetPresetRows(presets: SettingsPreset[], isFa: boolean): SheetPresetRow[] {
  const rows: SheetPresetRow[] = [
    { ...DEFAULT_PRESET_ROW, name: defaultPresetLabel(isFa) },
    ...presets.map(preset => ({
      id: preset.id,
      name: preset.name,
      shortcut: preset.shortcut ?? '',
      builtin: false,
      summary: presetSummary(preset, isFa),
      changedAt: preset.updatedAt || preset.createdAt || '',
    })),
  ];
  return rows;
}

/** Which profile this chord belongs to, if any. The built-in row owns `Alt+F6`. */
export function findPresetIdByShortcut(rows: SheetPresetRow[], chord: string | null): string | null {
  if (!chord) return null;
  const match = rows.find(row => row.shortcut && row.shortcut === chord);
  return match ? match.id : null;
}
