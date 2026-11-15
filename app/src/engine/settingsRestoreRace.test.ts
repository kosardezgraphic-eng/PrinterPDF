// @vitest-environment jsdom
/**
 * Start-up restore vs. what the operator just did.
 *
 * The rule is "restore only what nobody has moved": a stored value is applied to a key that still holds
 * its default, and ignored for a key whose value differs, because a different value can only mean the
 * operator (or a preset, or a restored session) chose it. The check is against the defaults rather than
 * against a recorded edit-log, which is what keeps it honest after a hot reload — and it is safe because
 * `updateSettings` writes to disk on every change, so the file is never fresher than memory.
 *
 * Reading the stored settings back is only safe if it cannot undo a change that happened while the read
 * was in flight, and a settings file is not allowed to overwrite profiles the operator saved in this
 * session. These two cases are the whole reason `restorePreferences` merges instead of assigning — the
 * obvious implementation (`{ ...state.settings, ...stored }`) is exactly the one that snaps a setting
 * back under the cursor.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsPreset } from '@shared/models';

const mocks = vi.hoisted(() => ({
  saveSettings: vi.fn(async () => true),
  saveSettingsPresets: vi.fn(async () => true),
  loadSettings: vi.fn(async (): Promise<unknown> => null),
  loadSettingsPresets: vi.fn(async (): Promise<unknown> => []),
}));
const { saveSettings, loadSettings, loadSettingsPresets } = mocks;

vi.mock('./ipcBridge', async importOriginal => {
  const actual = await importOriginal<typeof import('./ipcBridge')>();
  return {
    ...actual,
    ipcBridge: {
      ...actual.ipcBridge,
      saveSettings: mocks.saveSettings,
      saveSettingsPresets: mocks.saveSettingsPresets,
      loadSettings: mocks.loadSettings,
      loadSettingsPresets: mocks.loadSettingsPresets,
    },
  };
});

import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';

beforeEach(() => {
  vi.clearAllMocks();
  loadSettings.mockResolvedValue(null);
  loadSettingsPresets.mockResolvedValue([]);
  useAppStore.setState({
    documents: [], pages: [], bookmarks: [], overlays: [], toasts: [],
    layout: { ...DEFAULT_LAYOUT }, settings: { ...DEFAULT_SETTINGS }, settingsPresets: [],
  } as never);
});

describe('a start-up read that arrives late', () => {
  it('does not walk over a setting the operator changed in the meantime', async () => {
    loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, unit: 'cm', maxCachePages: 120 });
    const restoring = useAppStore.getState().restorePreferences();

    // The disk said "cm"; the operator reached for inches before the promise settled.
    useAppStore.getState().updateSettings({ unit: 'inch' });
    await restoring;

    const settings = useAppStore.getState().settings;
    expect(settings.unit).toBe('inch');               // the edit wins
    expect(settings.maxCachePages).toBe(120);          // everything untouched is still restored
  });

  it('does not lose a profile saved while the list was being read', async () => {
    const stored: SettingsPreset = {
      id: 'from-disk', name: 'Disk', createdAt: '', updatedAt: '',
      layout: { ...DEFAULT_LAYOUT, cols: 2 },
      effects: {}, watermark: {}, pageNumbering: {}, settings: { ...DEFAULT_SETTINGS },
    } as SettingsPreset;
    loadSettingsPresets.mockResolvedValue([stored]);
    const restoring = useAppStore.getState().restorePreferences();
    const savedNow = useAppStore.getState().saveSettingsPreset('Saved this session');
    await restoring;

    const names = useAppStore.getState().settingsPresets.map(preset => preset.name);
    expect(names).toContain('Disk');
    expect(names).toContain('Saved this session');
    expect(useAppStore.getState().settingsPresets.find(p => p.id === savedNow)?.name).toBe('Saved this session');
  });

  it('does not write the restored values back, which would make a read look like an edit', async () => {
    loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, bwPageTariffRials: 33000 });
    await useAppStore.getState().restorePreferences();

    expect(useAppStore.getState().settings.bwPageTariffRials).toBe(33000);
    expect(saveSettings).not.toHaveBeenCalled();      // restoring is not an edit; nothing to write back
  });
});
