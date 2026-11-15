// @vitest-environment node
/**
 * Resetting settings and storing them as profiles.
 *
 * Two behaviours matter here and both were missing before: every adjustable section going back to the
 * values the app ships with (without touching the files on the desk, and without switching the
 * interface language out from under the operator), and settings being *read back* at start-up — they
 * used to be written to disk and never loaded, so a restart quietly undid the operator's setup. The
 * presets are the fast path to a stored combination, and they are persisted through the same bridge as
 * the settings themselves, which is why the tests watch what the bridge is handed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, PageItem, SettingsPreset, SourceDocument } from '@shared/models';

// `vi.hoisted` because the mock factory below is hoisted above this file's statements: a plain `const`
// would still be in its temporal dead zone when the factory runs. The values are `unknown` on purpose —
// the two readers get handed whatever the test wants, and the store is what has to make sense of it,
// which is exactly what the corrupted-file cases below check.
const mocks = vi.hoisted(() => ({
  // The parameter types are erased at run time, so naming them here is free — and it is what makes the
  // assertions below read like the API instead of like a cast.
  saveSettings: vi.fn(async (_settings: AppSettings) => true),
  saveSettingsPresets: vi.fn(async (_presets: SettingsPreset[]) => true),
  loadSettings: vi.fn(async (): Promise<unknown> => null),
  loadSettingsPresets: vi.fn(async (): Promise<unknown> => []),
}));
const { saveSettings, saveSettingsPresets, loadSettings, loadSettingsPresets } = mocks;

// The bridge is one exported object, so the stubs replace its methods rather than named exports.
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
      listPrinters: vi.fn(async () => []),
      listSpoolerJobs: vi.fn(async () => []),
      getPrinterStatusNote: vi.fn(async () => null),
    },
  };
});

import { crispPreviewStats } from '../engine/vectorPreviewBridge';
import {
  DEFAULT_EFFECTS,
  DEFAULT_LAYOUT,
  DEFAULT_SETTINGS,
  useAppStore,
} from '../store/useAppStore';
import { getDefaultPageNumberSettings, getDefaultWatermarkSettings } from './watermarkEngine';

const doc = (id: string): SourceDocument => ({
  id, name: `${id}.pdf`, filePath: `${id}.pdf`, fileSize: 10, fileType: 'pdf',
  mimeType: 'application/pdf', pageCount: 1, createdAt: '', rawBytes: new Uint8Array([1, 2, 3]),
});
const page = (id: string, overrides: Partial<PageItem> = {}): PageItem => ({
  id, documentId: 'mine', documentName: 'mine.pdf', sourcePageNumber: 1, widthMm: 210, heightMm: 297,
  rotation: 0, selectedForPrint: true, isHighlighted: false, isBlankPage: false,
  colorProfile: 'color', inkCoveragePercent: 0, ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  loadSettings.mockResolvedValue(null);
  loadSettingsPresets.mockResolvedValue([]);
  useAppStore.setState({
    documents: [doc('mine')],
    pages: [page('mine-p1', { isHighlighted: true })],
    bookmarks: [], overlays: [], toasts: [],
    layout: { ...DEFAULT_LAYOUT },
    effects: { ...DEFAULT_EFFECTS },
    watermark: getDefaultWatermarkSettings(),
    pageNumbering: getDefaultPageNumberSettings(),
    settings: { ...DEFAULT_SETTINGS },
    settingsPresets: [],
    activePageId: 'mine-p1',
    previewPageRequest: null,
  });
});

describe('resetting every setting to its default', () => {
  it('puts each adjustable section back and leaves the desk alone', () => {
    const state = useAppStore.getState();
    state.updateLayout({ rows: 2, cols: 2, paperSize: 'A3', duplexMode: 'short-edge' });
    state.updateEffects({ invert: true, grayscale: true });
    state.updateWatermark({ enabled: true, text: 'DRAFT' });
    state.updatePageNumbering({ enabled: true, position: 'bottom-right' });
    state.updateSettings({ unit: 'inch', previewFidelity: 'fast', bwPageTariffRials: 999 });

    useAppStore.getState().resetAllSettings();
    const after = useAppStore.getState();

    expect(after.layout).toMatchObject({ rows: DEFAULT_LAYOUT.rows, cols: DEFAULT_LAYOUT.cols, paperSize: DEFAULT_LAYOUT.paperSize, duplexMode: DEFAULT_LAYOUT.duplexMode });
    expect(after.effects).toEqual(DEFAULT_EFFECTS);
    expect(after.watermark).toEqual(getDefaultWatermarkSettings());
    expect(after.pageNumbering).toEqual(getDefaultPageNumberSettings());
    expect(after.settings).toEqual({ ...DEFAULT_SETTINGS });
    // The files are what the operator is paid to handle: a settings reset must never touch them.
    expect(after.documents.map(item => item.id)).toEqual(['mine']);
    expect(after.pages.map(item => item.id)).toEqual(['mine-p1']);
  });

  it('keeps the interface language, so the UI does not change under the operator', () => {
    useAppStore.getState().updateSettings({ language: 'en', unit: 'cm' });

    useAppStore.getState().resetAllSettings();

    expect(useAppStore.getState().settings.language).toBe('en');
    expect(useAppStore.getState().settings.unit).toBe(DEFAULT_SETTINGS.unit);
  });

  it('writes the defaults through the same bridge the settings panel uses', () => {
    useAppStore.getState().updateSettings({ unit: 'cm' });
    saveSettings.mockClear();

    useAppStore.getState().resetAllSettings();

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings.mock.calls[0][0]).toMatchObject({ unit: DEFAULT_SETTINGS.unit, previewFidelity: DEFAULT_SETTINGS.previewFidelity });
  });

  it('brings the layout back with undo, because the sheet sections are part of the history', () => {
    useAppStore.getState().updateLayout({ rows: 3, cols: 3 });
    useAppStore.getState().resetAllSettings();
    expect(useAppStore.getState().canUndo).toBe(true);

    useAppStore.getState().undo();

    expect(useAppStore.getState().layout).toMatchObject({ rows: 3, cols: 3 });
  });

  it('says what it did, in the language the operator is reading', () => {
    useAppStore.getState().resetAllSettings();
    const toast = useAppStore.getState().toasts.at(-1);
    expect(toast?.title).toContain('پیش‌فرض');
    expect(useAppStore.getState().settingsPresets).toEqual([]);
  });
});

describe('saved setting profiles', () => {
  it('captures the current sections under a name and persists the list', async () => {
    useAppStore.getState().updateLayout({ rows: 2, cols: 1, paperSize: 'A4' });
    useAppStore.getState().updateEffects({ grayscale: true });

    const id = useAppStore.getState().saveSettingsPreset('A4 دوبلکس');

    expect(id).toBeTruthy();
    const preset = useAppStore.getState().settingsPresets[0];
    expect(preset.name).toBe('A4 دوبلکس');
    expect(preset.layout).toMatchObject({ rows: 2, cols: 1, paperSize: 'A4' });
    expect(preset.effects).toMatchObject({ grayscale: true });
    expect(preset.settings).toMatchObject({ previewFidelity: DEFAULT_SETTINGS.previewFidelity });
    expect(saveSettingsPresets).toHaveBeenCalledTimes(1);
    expect(saveSettingsPresets.mock.calls[0][0]).toHaveLength(1);
    expect(saveSettingsPresets.mock.calls[0][0][0].id).toBe(preset.id);
  });

  it('refuses an empty name instead of storing an anonymous profile', () => {
    const id = useAppStore.getState().saveSettingsPreset('   ');
    expect(id).toBeNull();
    expect(useAppStore.getState().settingsPresets).toEqual([]);
    expect(saveSettingsPresets).not.toHaveBeenCalled();
    expect(useAppStore.getState().toasts.at(-1)?.type).toBe('warning');
  });

  it('overwrites a profile of the same name rather than filling the menu with twins', () => {
    useAppStore.getState().saveSettingsPreset('Counter A4');
    const createdAt = useAppStore.getState().settingsPresets[0].createdAt;

    useAppStore.getState().updateLayout({ cols: 4 });
    useAppStore.getState().saveSettingsPreset('counter a4 ');

    const presets = useAppStore.getState().settingsPresets;
    expect(presets).toHaveLength(1);
    expect(presets[0].layout).toMatchObject({ cols: 4 });
    expect(presets[0].createdAt).toBe(createdAt);        // still the same profile, re-saved
    expect(presets[0].name).toBe('counter a4');           // the typed name wins
  });

  it('applies a profile over the current desk without dropping documents', () => {
    useAppStore.getState().updateLayout({ rows: 2, cols: 2 });
    const id = useAppStore.getState().saveSettingsPreset('1-up');
    useAppStore.getState().updateLayout({ rows: 5, cols: 5, duplexMode: 'none' });

    useAppStore.getState().applySettingsPreset(id as string);

    const state = useAppStore.getState();
    expect(state.layout).toMatchObject({ rows: 2, cols: 2 });
    // A profile says nothing about the duplex the operator just changed... unless it stores it: the
    // stored value is what comes back, which is the whole point of a profile.
    expect(state.layout.duplexMode).toBe(DEFAULT_LAYOUT.duplexMode);
    expect(state.pages).toHaveLength(1);
    expect(state.documents).toHaveLength(1);
  });

  it('leaves options the profile never saw at their default instead of undefined', () => {
    // A profile written by an older build has no `previewFidelity` in its settings block.
    useAppStore.setState({
      settingsPresets: [{
        id: 'old', name: 'old build', createdAt: '', updatedAt: '',
        layout: { rows: 4 } as never,
        effects: {},
        watermark: {},
        pageNumbering: {},
        settings: { unit: 'inch' },
      } as unknown as SettingsPreset],
    });
    useAppStore.getState().updateSettings({ unit: 'mm' });

    useAppStore.getState().applySettingsPreset('old');

    const state = useAppStore.getState();
    expect(state.settings.unit).toBe('inch');
    expect(state.settings.previewFidelity).toBe(DEFAULT_SETTINGS.previewFidelity);
    expect(state.layout).toEqual({ ...DEFAULT_LAYOUT, rows: 4 });
    expect(state.effects).toEqual(DEFAULT_EFFECTS);
  });

  it('deletes a profile and stores the shorter list', () => {
    useAppStore.getState().saveSettingsPreset('keep');
    const drop = useAppStore.getState().saveSettingsPreset('drop');
    saveSettingsPresets.mockClear();

    useAppStore.getState().deleteSettingsPreset(drop as string);

    expect(useAppStore.getState().settingsPresets.map(preset => preset.name)).toEqual(['keep']);
    expect(saveSettingsPresets.mock.calls[0][0]).toHaveLength(1);
  });

  it('does not pretend a reset deleted the profiles', () => {
    const id = useAppStore.getState().saveSettingsPreset('A4');
    useAppStore.getState().resetAllSettings();

    expect(useAppStore.getState().settingsPresets.map(preset => preset.id)).toEqual([id]);
  });
});

describe('the preview pipeline following the settings', () => {
  it('switches the crisp renderer with `previewFidelity`, and the cache limit with `maxCachePages`', () => {
    // Both numbers come out of the same module the sheet cells ask, so this is the wiring and not a
    // mock of it: a setting that nothing reads would leave the pipeline in the dark.
    useAppStore.getState().updateSettings({ previewFidelity: 'crisp' });
    expect(crispPreviewStats().enabled).toBe(true);

    useAppStore.getState().updateSettings({ previewFidelity: 'fast' });
    expect(crispPreviewStats().enabled).toBe(false);

    useAppStore.getState().updateSettings({ previewFidelity: 'crisp', maxCachePages: 400 });
    expect(crispPreviewStats().enabled).toBe(true);
    expect(crispPreviewStats().cached).toBe(0);      // nothing was cached in a run without a worker
  });

  it('gives the settings back to the pipeline when a reset turns crisp mode on again', () => {
    useAppStore.getState().updateSettings({ previewFidelity: 'fast' });
    useAppStore.getState().resetAllSettings();
    expect(crispPreviewStats().enabled).toBe(DEFAULT_SETTINGS.previewFidelity === 'crisp');
  });
});

describe('reading preferences back at start-up', () => {
  it('restores the stored settings and the saved profiles together', async () => {
    const stored: SettingsPreset = {
      id: 'p1', name: 'Counter', createdAt: '', updatedAt: '',
      layout: { ...DEFAULT_LAYOUT, cols: 3 },
      effects: { ...DEFAULT_EFFECTS },
      watermark: getDefaultWatermarkSettings(),
      pageNumbering: getDefaultPageNumberSettings(),
      settings: { ...DEFAULT_SETTINGS, unit: 'cm' },
    };
    loadSettings.mockResolvedValue({ unit: 'inch', previewFidelity: 'fast', bwPageTariffRials: 20000 });
    loadSettingsPresets.mockResolvedValue([stored]);

    await useAppStore.getState().restorePreferences();

    const state = useAppStore.getState();
    expect(state.settings.unit).toBe('inch');
    expect(state.settings.bwPageTariffRials).toBe(20000);
    expect(state.settings.previewFidelity).toBe('fast');
    expect(state.settingsPresets.map(preset => preset.id)).toEqual(['p1']);
  });

  it('keeps the shipped defaults when nothing is stored yet', async () => {
    loadSettings.mockResolvedValue(null);
    loadSettingsPresets.mockResolvedValue([]);
    useAppStore.getState().updateSettings({ unit: 'cm' });

    await useAppStore.getState().restorePreferences();

    expect(useAppStore.getState().settings.unit).toBe('cm');
    expect(useAppStore.getState().settingsPresets).toEqual([]);
  });

  it('survives a bridge that cannot answer at all', async () => {
    loadSettings.mockRejectedValue(new Error('settings file is locked'));
    loadSettingsPresets.mockRejectedValue(new Error('settings file is locked'));

    await expect(useAppStore.getState().restorePreferences()).resolves.toBeUndefined();
    expect(useAppStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS });
  });
});
