// @vitest-environment node
/**
 * Resetting settings, and storing the sheet setup as profiles.
 *
 * The scope of a profile is the point of these tests: it carries the sheet (layout, effects, watermark,
 * page numbering) and nothing of the application's own preferences, so applying one cannot change the
 * language, the unit or the tariffs. Editing is a first-class action too - rename, re-record the chord,
 * re-capture the contents, delete - and the built-in "defaults" row is an entry in that same list rather
 * than a separate button, which is why Alt+F6 and the row have to agree.
 *
 * Two behaviours matter here and both were missing before: every adjustable section going back to the
 * values the app ships with (without touching the files on the desk, and without switching the
 * interface language out from under the operator), and settings being *read back* at start-up — they
 * used to be written to disk and never loaded, so a restart quietly undid the operator's setup. The
 * presets are the fast path to a stored combination, and they are persisted through the same bridge as
 * the settings themselves, which is why the tests watch what the bridge is handed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SHEET_DEFAULT_PRESET_ID } from '@shared/models';
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
    printers: [],
    selectedPrinterName: '',
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

const makePrinter = () => ({
  name: 'OfficeLaser',
  driverName: 'PCL6 Driver',
  portName: 'USB001',
  isDefault: true,
  isNetwork: false,
  isVirtual: false,
  status: 'Ready' as const,
  jobsInQueue: 0,
  capabilities: {
    supportedPapers: ['A4', 'A3'] as Array<'A4' | 'A3'>,
    supportedTrays: ['Auto'],
    supportedMediaTypes: ['Plain'],
    supportsDuplex: true,
    supportsColor: true,
    supportedDpi: [300, 600],
    maxCopies: 99,
  },
  activeProfile: {
    printerName: 'OfficeLaser',
    paperSize: 'A3' as const,
    tray: 'Auto',
    mediaType: 'Plain',
    orientation: 'landscape' as const,
    duplexMode: 'short-edge' as const,
    dpi: 600,
    colorMode: 'color' as const,
    quality: 'normal' as const,
  },
});

describe('resetting every sheet and design setting to its default', () => {
  it('puts each sheet, overlay, shape, effect, numbering, orientation, and printer-synced section back while preserving app settings and files', () => {
    useAppStore.setState({
      printers: [makePrinter()],
      selectedPrinterName: 'OfficeLaser',
    });
    const state = useAppStore.getState();
    state.updateLayout({
      rows: 2,
      cols: 2,
      paperSize: 'A3',
      orientation: 'landscape',
      duplexMode: 'short-edge',
      marginMode: 'custom',
      marginsMm: { top: 18, right: 16, bottom: 18, left: 16 },
      horizontalGutterMm: 9,
      verticalGutterMm: 7,
      scaleMode: 'custom',
      customScalePercent: 85,
    });
    state.updateEffects({ invert: true, grayscale: true, brightness: 15 });
    state.rotatePages(['mine-p1'], 90);
    state.updateWatermark({ enabled: true, text: 'DRAFT' });
    state.updatePageNumbering({ enabled: true, position: 'bottom-right' });
    state.addShapeOverlay('rectangle');
    state.addNumberingOverlay(true);
    state.updateSettings({ unit: 'inch', previewFidelity: 'fast', bwPageTariffRials: 999, theme: 'light' });

    useAppStore.getState().resetAllSettings();
    const after = useAppStore.getState();

    expect(after.layout).toMatchObject({
      rows: DEFAULT_LAYOUT.rows,
      cols: DEFAULT_LAYOUT.cols,
      paperSize: DEFAULT_LAYOUT.paperSize,
      orientation: DEFAULT_LAYOUT.orientation,
      duplexMode: DEFAULT_LAYOUT.duplexMode,
      marginMode: DEFAULT_LAYOUT.marginMode,
      marginsMm: DEFAULT_LAYOUT.marginsMm,
      horizontalGutterMm: DEFAULT_LAYOUT.horizontalGutterMm,
      verticalGutterMm: DEFAULT_LAYOUT.verticalGutterMm,
      scaleMode: DEFAULT_LAYOUT.scaleMode,
      customScalePercent: DEFAULT_LAYOUT.customScalePercent,
    });
    expect(after.effects).toEqual(DEFAULT_EFFECTS);
    expect(after.watermark).toEqual(getDefaultWatermarkSettings());
    expect(after.pageNumbering).toEqual(getDefaultPageNumberSettings());
    expect(after.overlays).toEqual([]);
    expect(after.selectedOverlayId).toBeNull();
    expect(after.pages[0].overrides).toBeUndefined();
    expect(after.pages[0].rotation).toBe(0);
    expect(after.printers[0].activeProfile.orientation).toBe(DEFAULT_LAYOUT.orientation);
    expect(after.printers[0].activeProfile.duplexMode).toBe(DEFAULT_LAYOUT.duplexMode);
    // Application environment preferences must stay untouched.
    expect(after.settings).toMatchObject({
      unit: 'inch',
      previewFidelity: 'fast',
      bwPageTariffRials: 999,
      theme: 'light',
    });
    // The files are what the operator is paid to handle: a settings reset must never touch them.
    expect(after.documents.map(item => item.id)).toEqual(['mine']);
    expect(after.pages.map(item => item.id)).toEqual(['mine-p1']);
  });

  it('keeps the interface language and environment preferences untouched', () => {
    useAppStore.getState().updateSettings({ language: 'en', unit: 'cm', bwPageTariffRials: 77777 });

    useAppStore.getState().resetAllSettings();

    expect(useAppStore.getState().settings.language).toBe('en');
    expect(useAppStore.getState().settings.unit).toBe('cm');
    expect(useAppStore.getState().settings.bwPageTariffRials).toBe(77777);
  });

  it('does not overwrite saved application environment settings on sheet reset', () => {
    useAppStore.getState().updateSettings({ unit: 'cm' });
    saveSettings.mockClear();

    useAppStore.getState().resetAllSettings();

    expect(saveSettings).not.toHaveBeenCalled();
    expect(useAppStore.getState().settings.unit).toBe('cm');
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

describe('saved sheet profiles', () => {
  it('captures the current sections under a name and persists the list', async () => {
    useAppStore.getState().updateLayout({ rows: 2, cols: 1, paperSize: 'A4' });
    useAppStore.getState().updateEffects({ grayscale: true });

    const id = useAppStore.getState().saveSettingsPreset('A4 دوبلکس');

    expect(id).toBeTruthy();
    const preset = useAppStore.getState().settingsPresets[0];
    expect(preset.name).toBe('A4 دوبلکس');
    expect(preset.layout).toMatchObject({ rows: 2, cols: 1, paperSize: 'A4' });
    expect(preset.effects).toMatchObject({ grayscale: true });
    expect(preset.shortcut).toBe('');
    // A profile is the sheet and nothing else: the application settings are not in it, not even a copy.
    expect('settings' in preset).toBe(false);
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
    useAppStore.getState().saveSettingsPreset('Counter A4', 'Alt+F8');
    const createdAt = useAppStore.getState().settingsPresets[0].createdAt;

    useAppStore.getState().updateLayout({ cols: 4 });
    useAppStore.getState().saveSettingsPreset('counter a4 ');

    const presets = useAppStore.getState().settingsPresets;
    expect(presets).toHaveLength(1);
    expect(presets[0].layout).toMatchObject({ cols: 4 });
    expect(presets[0].createdAt).toBe(createdAt);        // still the same profile, re-saved
    expect(presets[0].name).toBe('counter a4');           // the typed name wins
    expect(presets[0].shortcut).toBe('Alt+F8');            // and a re-save never silently drops the chord
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

  it('leaves the application settings out of it, on purpose', () => {
    useAppStore.getState().updateSettings({ unit: 'inch', bwPageTariffRials: 42000, previewFidelity: 'fast' });
    const id = useAppStore.getState().saveSettingsPreset('Sheet only');
    useAppStore.getState().updateSettings({ unit: 'mm', bwPageTariffRials: 15000, previewFidelity: 'crisp' });

    useAppStore.getState().applySettingsPreset(id as string);

    const settings = useAppStore.getState().settings;
    expect(settings.unit).toBe('mm');
    expect(settings.bwPageTariffRials).toBe(15000);
    expect(settings.previewFidelity).toBe('crisp');
  });

  it('ignores the settings block a profile saved by the older build still carries', () => {
    // Exactly what settings-presets.json looks like after the scope change: a stale settings blob.
    useAppStore.setState({
      settingsPresets: [{
        id: 'legacy', name: 'From the old file', createdAt: '', updatedAt: '', shortcut: '',
        layout: { ...DEFAULT_LAYOUT, cols: 2 },
        effects: { ...DEFAULT_EFFECTS },
        watermark: getDefaultWatermarkSettings(),
        pageNumbering: getDefaultPageNumberSettings(),
        settings: { ...DEFAULT_SETTINGS, unit: 'inch' },
      } as unknown as SettingsPreset],
    });

    useAppStore.getState().applySettingsPreset('legacy');

    expect(useAppStore.getState().layout).toMatchObject({ cols: 2 });
    expect(useAppStore.getState().settings.unit).toBe(DEFAULT_SETTINGS.unit);
  });

  it('refuses to delete the built-in defaults entry, which is not a stored profile', () => {
    const before = useAppStore.getState().settingsPresets.length;

    useAppStore.getState().deleteSettingsPreset(SHEET_DEFAULT_PRESET_ID);

    expect(useAppStore.getState().settingsPresets).toHaveLength(before);
    expect(saveSettingsPresets).not.toHaveBeenCalled();
    expect(useAppStore.getState().toasts.at(-1)?.type).toBe('warning');
  });

  it('applies the defaults entry as a sheet reset while preserving app environment preferences', () => {
    useAppStore.getState().updateLayout({ rows: 4, cols: 4, orientation: 'landscape', duplexMode: 'short-edge' });
    useAppStore.getState().updateSettings({ unit: 'cm' });

    useAppStore.getState().applySettingsPreset(SHEET_DEFAULT_PRESET_ID);

    expect(useAppStore.getState().layout).toEqual(DEFAULT_LAYOUT);
    expect(useAppStore.getState().settings.unit).toBe('cm');
  });

  it('saves and restores effects, margins, gutters, custom layout, page & section numbering, orientation, and duplex with printer sync', () => {
    useAppStore.setState({
      printers: [makePrinter()],
      selectedPrinterName: 'OfficeLaser',
    });

    const store = useAppStore.getState();
    store.updateEffects({ invert: true, grayscale: true, contrast: 20, scope: 'all' });
    store.updateLayout({
      paperSize: 'A3',
      orientation: 'landscape',
      duplexMode: 'short-edge',
      marginMode: 'custom',
      marginsMm: { top: 15, right: 12, bottom: 14, left: 10 },
      horizontalGutterMm: 8,
      verticalGutterMm: 6,
      rows: 2,
      cols: 3,
      scaleMode: 'custom',
      customScalePercent: 92,
    });
    store.updatePageNumbering({ enabled: true, format: 'english', position: 'bottom-center', startNumber: 5 });
    store.addNumberingOverlay(false);
    const createdOverlay = useAppStore.getState().overlays.find((o) => o.kind === 'numbering');
    expect(createdOverlay).toBeDefined();
    store.updateOverlay(createdOverlay!.id, { sequenceBasis: 'grid' });

    const presetId = useAppStore.getState().saveSettingsPreset('Full Sheet Profile') as string;
    expect(presetId).toBeTruthy();

    useAppStore.getState().resetAllSettings();
    expect(useAppStore.getState().overlays).toEqual([]);
    expect(useAppStore.getState().layout.orientation).toBe(DEFAULT_LAYOUT.orientation);
    expect(useAppStore.getState().layout.duplexMode).toBe(DEFAULT_LAYOUT.duplexMode);

    // Keep an existing shape overlay to verify numbering overlays restore cleanly alongside non-numbering overlays.
    useAppStore.getState().addShapeOverlay('circle');
    useAppStore.getState().applySettingsPreset(presetId);

    const restored = useAppStore.getState();
    expect(restored.effects).toMatchObject({ invert: true, grayscale: true, contrast: 20 });
    expect(restored.layout.marginMode).toBe('custom');
    expect(restored.layout.marginsMm).toEqual({ top: 15, right: 12, bottom: 14, left: 10 });
    expect(restored.layout.horizontalGutterMm).toBe(8);
    expect(restored.layout.verticalGutterMm).toBe(6);
    expect(restored.layout.rows).toBe(2);
    expect(restored.layout.cols).toBe(3);
    expect(restored.layout.scaleMode).toBe('custom');
    expect(restored.layout.customScalePercent).toBe(92);
    expect(restored.layout.orientation).toBe('landscape');
    expect(restored.layout.duplexMode).toBe('short-edge');
    expect(restored.pageNumbering).toMatchObject({ enabled: true, format: 'english', startNumber: 5 });
    expect(restored.overlays.some((o) => o.kind === 'numbering' && o.sequenceBasis === 'grid')).toBe(true);
    expect(restored.overlays.some((o) => o.kind === 'shape')).toBe(true);
    expect(restored.printers[0].activeProfile.orientation).toBe('landscape');
    expect(restored.printers[0].activeProfile.duplexMode).toBe('short-edge');
    expect(restored.printers[0].activeProfile.paperSize).toBe('A3');
  });

  it('renames a profile, and refuses a name another profile already has', () => {
    const id = useAppStore.getState().saveSettingsPreset('First') as string;
    useAppStore.getState().saveSettingsPreset('Second');

    expect(useAppStore.getState().editSettingsPreset(id, { name: ' Front desk ' })).toMatchObject({ ok: true, id });
    expect(useAppStore.getState().settingsPresets.find(p => p.id === id)?.name).toBe('Front desk');

    const clash = useAppStore.getState().editSettingsPreset(id, { name: 'Second' });
    expect(clash).toEqual({ ok: false, error: 'duplicate-name' });
    expect(useAppStore.getState().settingsPresets.find(p => p.id === id)?.name).toBe('Front desk');
    expect(useAppStore.getState().editSettingsPreset(id, { name: '   ' })).toEqual({ ok: false, error: 'empty-name' });
    expect(useAppStore.getState().editSettingsPreset('ghost', { name: 'X' })).toEqual({ ok: false, error: 'unknown-id' });
  });

  it('records, replaces and clears a chord, and will not hand out a busy one', () => {
    const first = useAppStore.getState().saveSettingsPreset('First') as string;
    const second = useAppStore.getState().saveSettingsPreset('Second') as string;

    expect(useAppStore.getState().editSettingsPreset(first, { shortcut: 'alt+f7' })).toMatchObject({ ok: true });
    expect(useAppStore.getState().settingsPresets.find(p => p.id === first)?.shortcut).toBe('Alt+F7');

    expect(useAppStore.getState().editSettingsPreset(second, { shortcut: 'Alt+F7' })).toEqual({ ok: false, error: 'duplicate-shortcut' });
    expect(useAppStore.getState().editSettingsPreset(second, { shortcut: 'Alt+F6' })).toEqual({ ok: false, error: 'reserved-shortcut' });
    // a reservation is still a reservation when it arrives in the wrong case, or with a space in it
    expect(useAppStore.getState().editSettingsPreset(second, { shortcut: 'alt+ f6' })).toEqual({ ok: false, error: 'reserved-shortcut' });
    expect(useAppStore.getState().editSettingsPreset(second, { shortcut: 'Ctrl+3' })).toEqual({ ok: false, error: 'bad-shortcut' });
    expect(useAppStore.getState().settingsPresets.find(p => p.id === second)?.shortcut).toBe('');

    expect(useAppStore.getState().editSettingsPreset(first, { shortcut: '' })).toMatchObject({ ok: true });
    expect(useAppStore.getState().settingsPresets.find(p => p.id === first)?.shortcut).toBe('');
    // ...and the freed chord is assignable again.
    expect(useAppStore.getState().editSettingsPreset(second, { shortcut: 'Alt+F7' })).toMatchObject({ ok: true });
  });

  it('refuses the whole save when the chord is not one the app could honour', () => {
    // Ctrl+3 is a browser tab switch. Half-storing the profile - name yes, chord silently no - would
    // leave the operator pressing a key that does nothing, so nothing is stored and the reason is said.
    expect(useAppStore.getState().saveSettingsPreset('First', 'Ctrl+3')).toBeNull();
    expect(useAppStore.getState().settingsPresets).toEqual([]);
    expect(saveSettingsPresets).not.toHaveBeenCalled();
    expect(useAppStore.getState().toasts.at(-1)?.type).toBe('warning');
  });

  it('re-captures the sheet into a profile while keeping its name, chord and birthday', () => {
    const id = useAppStore.getState().saveSettingsPreset('Duplex A4', 'Alt+F9') as string;
    const { createdAt } = useAppStore.getState().settingsPresets[0];

    useAppStore.getState().updateLayout({ cols: 6, paperSize: 'A3' });
    expect(useAppStore.getState().overwriteSettingsPreset(id)).toMatchObject({ ok: true, id });

    const preset = useAppStore.getState().settingsPresets[0];
    expect(preset.layout).toMatchObject({ cols: 6, paperSize: 'A3' });
    expect(preset.name).toBe('Duplex A4');
    expect(preset.shortcut).toBe('Alt+F9');
    expect(preset.createdAt).toBe(createdAt);
    expect('settings' in preset).toBe(false);
  });

  it('holds the recorder flag, which is all that stands between a keypress and a fired chord', () => {
    const id = useAppStore.getState().saveSettingsPreset('First') as string;
    useAppStore.getState().beginShortcutRecording(id as string);
    expect(useAppStore.getState().shortcutRecordingFor).toBe(id);
    useAppStore.getState().beginShortcutRecording(null);
    expect(useAppStore.getState().shortcutRecordingFor).toBeNull();
  });

  it('opens one profile for editing at a time, and takes the recorder with it', () => {
    const first = useAppStore.getState().saveSettingsPreset('First') as string;
    const second = useAppStore.getState().saveSettingsPreset('Second') as string;

    useAppStore.getState().beginEditPreset(first);
    expect(useAppStore.getState().editingPresetId).toBe(first);

    // Opening another row while a recorder is waiting must cancel the wait, or the next keypress would
    // be assigned to the row the operator already walked away from.
    useAppStore.getState().beginShortcutRecording(first);
    useAppStore.getState().beginEditPreset(second);
    expect(useAppStore.getState().editingPresetId).toBe(second);
    expect(useAppStore.getState().shortcutRecordingFor).toBeNull();

    useAppStore.getState().beginEditPreset(null);
    expect(useAppStore.getState().editingPresetId).toBeNull();
  });

  it('closes the editor when the profile it was editing is deleted', () => {
    const id = useAppStore.getState().saveSettingsPreset('Doomed') as string;
    useAppStore.getState().beginEditPreset(id);
    useAppStore.getState().beginShortcutRecording(id);

    useAppStore.getState().deleteSettingsPreset(id);

    expect(useAppStore.getState().editingPresetId).toBeNull();
    expect(useAppStore.getState().shortcutRecordingFor).toBeNull();
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

  it('leaves the operator previewFidelity preference intact across sheet resets', () => {
    useAppStore.getState().updateSettings({ previewFidelity: 'fast' });
    useAppStore.getState().resetAllSettings();
    expect(crispPreviewStats().enabled).toBe(false);
    expect(useAppStore.getState().settings.previewFidelity).toBe('fast');
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
      shortcut: 'Alt+F10',
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
