import React, { useEffect, useRef, useState } from 'react';
import { Check, KeyRound, Layers, RotateCcw, Save, Trash2, ChevronDown, X } from 'lucide-react';
import { useAppStore, type SettingsPresetEditError } from '../store/useAppStore';
import { buildSheetPresetRows, type SheetPresetRow } from '../engine/sheetPresets';
import { formatShortcut } from '@shared/models';

/**
 * Sheet profiles: a stored page setup, and the reset that undoes it.
 *
 * A profile captures what happens to the *sheet* — imposition and placement, colour and effects,
 * watermark, page numbering — and nothing of the application's own preferences. That limit is the whole
 * point of the redesign: switching a profile on a loaded job is a press change, and an operator must not
 * lose their language, unit or tariff settings because they picked a layout they use every morning.
 *
 * The list always starts with one built-in row, «Shipped defaults», which is not stored anywhere: it is
 * the reset action with the `Alt+F6` chord on it. That is what makes the shortcut and the list the same
 * feature instead of two ways to do one thing, and it is why the entry cannot be renamed or deleted.
 */

const errorHint: Record<SettingsPresetEditError, [string, string]> = {
  'unknown-id': ['این پروفایل دیگر وجود ندارد', 'That profile is no longer stored'],
  'empty-name': ['نام نمی‌تواند خالی باشد', 'The name cannot be empty'],
  'duplicate-name': ['این نام قبلاً استفاده شده است', 'That name is already taken'],
  builtin: ['پروفایل پیش‌فرض قابل ویرایش یا حذف نیست', 'The defaults entry cannot be edited or deleted'],
  'bad-shortcut': ['ترکیب مجاز نیست: Alt+F7 تا Alt+F12 یا Ctrl+Alt با یک حرف/رقم', 'Not an allowed chord: use Alt+F7–Alt+F12, or Ctrl+Alt plus one letter or digit'],
  'reserved-shortcut': ['این کلید برای پیش‌فرض رزرو شده است', 'That chord belongs to the defaults entry'],
  'duplicate-shortcut': ['این کلید به پروفایل دیگری اختصاص دارد', 'Another profile already uses that chord'],
};

/** A `<kbd>`-style chord chip, or a muted "none". */
function ShortcutChip({ shortcut, isFa }: { shortcut: string; isFa: boolean }) {
  if (!shortcut) return <span className="text-[10px] text-slate-500">{isFa ? 'بدون کلید' : 'no key'}</span>;
  return (
    <kbd dir="ltr" className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
      {shortcut}
    </kbd>
  );
}

/**
 * The "press a key to assign it" control. The capture-phase listener and the store flag are both needed:
 * the flag is what tells the application-level chord handler to stand aside, and the capture phase is
 * what keeps the browser from acting on the key being recorded.
 */
function ShortcutRecorder({ presetId, shortcut, isFa, onNotice }: {
  presetId: string;
  shortcut: string;
  isFa: boolean;
  onNotice: (text: string) => void;
}) {
  const recording = useAppStore(state => state.shortcutRecordingFor === presetId);
  const beginRecording = useAppStore(state => state.beginShortcutRecording);
  const editSettingsPreset = useAppStore(state => state.editSettingsPreset);
  const cancelRef = useRef<() => void>(() => {});
  cancelRef.current = () => beginRecording(null);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      beginRecording(null);
      if (event.key === 'Escape') return;                       // Escape cancels, it is not a chord
      const chord = formatShortcut(event);
      if (!chord) {
        // Modifier alone, or a bare letter: nothing to assign, and the recorder must say so rather than
        // quietly keep waiting for a key that will never be accepted.
        onNotice(isFa ? errorHint['bad-shortcut'][0] : errorHint['bad-shortcut'][1]);
        return;
      }
      const result = editSettingsPreset(presetId, { shortcut: chord });
      if (!result.ok) onNotice(isFa ? errorHint[result.error][0] : errorHint[result.error][1]);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, presetId, beginRecording, editSettingsPreset, onNotice, isFa]);

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        data-shortcut-record={presetId}
        onClick={() => beginRecording(recording ? null : presetId)}
        title={isFa
          ? 'برای ثبت کلید میانبر، این را بزنید و بعد ترکیب مورد نظر را فشار دهید (Esc لغو)'
          : 'Press this, then type the chord you want for this profile (Esc cancels)'}
        className={`rounded-lg border px-2 py-1 text-[10px] font-bold cursor-pointer ${
          recording ? 'border-amber-400 bg-amber-500/20 text-amber-100' : 'border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700'
        }`}
      >
        {recording
          ? (isFa ? 'کلید را بزنید…' : 'Press a key…')
          : (shortcut ? (isFa ? 'تغییر کلید' : 'Change key') : (isFa ? 'ثبت کلید' : 'Assign a key'))}
      </button>
      {shortcut && !recording && (
        <button
          type="button"
          data-shortcut-clear={presetId}
          aria-label={isFa ? 'برداشتن کلید میانبر' : 'Remove the chord'}
          onClick={() => {
            const result = editSettingsPreset(presetId, { shortcut: '' });
            if (!result.ok) onNotice(isFa ? errorHint[result.error][0] : errorHint[result.error][1]);
          }}
          className="rounded-lg border border-slate-700 p-1 text-slate-400 hover:bg-slate-800 cursor-pointer"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

/** Quick access, from the ribbon: the defaults entry, then one click per profile. */
export function SettingsPresetMenu() {
  const presets = useAppStore(state => state.settingsPresets);
  const language = useAppStore(state => state.settings.language);
  const applySettingsPreset = useAppStore(state => state.applySettingsPreset);
  const saveSettingsPreset = useAppStore(state => state.saveSettingsPreset);
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);
  const isFa = language === 'fa';
  const rows = buildSheetPresetRows(presets, isFa);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={host} className="relative">
      <button
        type="button"
        data-preset-menu-trigger
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        title={isFa ? 'پروفایل‌های تنظیمات شیت' : 'Saved sheet profiles'}
        className="flex flex-col items-center gap-1 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-200 hover:bg-slate-700 cursor-pointer"
      >
        <Layers className="h-5 w-5 text-violet-400" />
        <span className="sr-only">{isFa ? 'پروفایل شیت' : 'Sheet profiles'}</span>
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>
      {open && (
        <div
          data-preset-menu
          dir={isFa ? 'rtl' : 'ltr'}
          className="absolute z-50 mt-1 w-80 rounded-xl border border-slate-600 bg-slate-900 p-2 text-xs text-slate-100 shadow-2xl"
        >
          <div className="mb-1 px-1 text-[10px] font-bold text-slate-400">
            {isFa ? 'چیدمان شیت — با یک کلیک یا کلید میانبرش' : 'Sheet setup — one click, or its chord'}
          </div>
          <ul className="mb-1 max-h-64 overflow-y-auto">
            {rows.map(row => (
              <li key={row.id}>
                <button
                  type="button"
                  data-preset-apply={row.name}
                  data-preset-builtin={row.builtin ? 'true' : undefined}
                  onClick={() => { applySettingsPreset(row.id); setOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-slate-700 cursor-pointer"
                >
                  {row.builtin
                    ? <RotateCcw className="h-3.5 w-3.5 shrink-0 text-rose-300" aria-hidden="true" />
                    : <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{row.name}</span>
                    {row.summary && <span dir="ltr" className="block truncate text-[10px] text-slate-400">{row.summary}</span>}
                  </span>
                  <ShortcutChip shortcut={row.shortcut} isFa={isFa} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            data-preset-save-current
            onClick={() => { saveSettingsPreset(isFa ? `پروفایل ${presets.length + 1}` : `Profile ${presets.length + 1}`); setOpen(false); }}
            className="flex w-full items-center gap-2 rounded-lg border-t border-slate-800 px-2 py-1.5 text-start text-sky-300 hover:bg-slate-800 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            {isFa ? 'ثبت چیدمان فعلی شیت به‌عنوان پروفایل' : 'Save the current sheet setup as a profile'}
          </button>
        </div>
      )}
    </div>
  );
}

/** The managing half: rename, re-record the chord, re-capture the contents, delete. */
export function SettingsPresetPanel() {
  const presets = useAppStore(state => state.settingsPresets);
  const language = useAppStore(state => state.settings.language);
  const saveSettingsPreset = useAppStore(state => state.saveSettingsPreset);
  const applySettingsPreset = useAppStore(state => state.applySettingsPreset);
  const deleteSettingsPreset = useAppStore(state => state.deleteSettingsPreset);
  const editSettingsPreset = useAppStore(state => state.editSettingsPreset);
  const overwriteSettingsPreset = useAppStore(state => state.overwriteSettingsPreset);
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const isFa = language === 'fa';
  const rows = buildSheetPresetRows(presets, isFa);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(null), 6000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);
  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 6000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  const commitDraft = (row: SheetPresetRow) => {
    const draft = drafts[row.id];
    if (draft === undefined || draft === row.name) { setDrafts(state => ({ ...state, [row.id]: '' })); return; }
    const result = editSettingsPreset(row.id, { name: draft });
    if (result.ok) setDrafts(state => { const next = { ...state }; delete next[row.id]; return next; });
    else setNotice(isFa ? errorHint[result.error][0] : errorHint[result.error][1]);
  };

  const applyRow = (row: SheetPresetRow) => {
    // The defaults row is destructive to the operator's current setup, so it asks once — same rule as the
    // reset button it replaced, and the reason it is a row like any other is that its chord is real.
    if (row.builtin) {
      if (!confirmReset) { setConfirmReset(true); return; }
      setConfirmReset(false);
    }
    applySettingsPreset(row.id);
  };

  return (
    <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-extrabold text-slate-200">
          <Layers className="h-4 w-4 text-violet-400" />
          {isFa ? 'پروفایل‌های تنظیمات شیت (K2)' : 'Sheet profiles (K2)'}
        </h3>
        <span className="text-[10px] text-slate-500">
          {isFa ? 'بی‌زبان، واحد، تعرفه و تنظیمات برنامه' : 'no language, unit, tariffs or app settings'}
        </span>
      </div>

      <p className="mb-3 text-[11px] leading-5 text-slate-400">
        {isFa
          ? 'هر پروفایل فقط چیدمان، افکت‌ها، واترمارک و شماره‌گذاری صفحه را نگه می‌دارد؛ تنظیمات خود برنامه (زبان، واحد، تقویم، تعرفه، کش و کیفیت پیش‌فایل) در هیچ پروفایلی ذخیره یا بازیابی نمی‌شوند. سطر اول، «پیش‌فرض خود برنامه»، همان کاری را می‌کند که Alt+F6 می‌کند.'
          : 'A profile stores the sheet only: layout, effects, watermark and page numbering. The application settings (language, unit, calendar, tariffs, cache and preview quality) are never captured or restored by a profile. The first row, "Shipped defaults", is what Alt+F6 does.'}
      </p>

      <ul className="mb-3 grid gap-1.5">
        {rows.map(row => (
          <li
            key={row.id}
            data-preset-row={row.id}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/70 px-2.5 py-1.5"
          >
            <span className="min-w-0 flex-1 basis-40">
              {row.builtin ? (
                <span className="block truncate text-[11px] font-bold text-rose-200">{row.name}</span>
              ) : (
                <input
                  type="text"
                  data-preset-name={row.id}
                  aria-label={isFa ? `نام پروفایل ${row.name}` : `Profile name for ${row.name}`}
                  value={drafts[row.id] ?? row.name}
                  onChange={(event) => setDrafts(state => ({ ...state, [row.id]: event.target.value.slice(0, 80) }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); commitDraft(row); }
                    if (event.key === 'Escape') setDrafts(state => { const next = { ...state }; delete next[row.id]; return next; });
                  }}
                  onBlur={() => commitDraft(row)}
                  className="w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-[11px] font-bold text-slate-100 hover:border-slate-600 focus:border-sky-500 focus:bg-slate-900"
                />
              )}
              <span dir="ltr" className="block truncate text-[10px] text-slate-400">
                {row.summary || (row.builtin
                  ? (isFa ? 'بازنشانی چیدمان، افکت‌ها، واترمارک، شماره‌گذاری و تنظیمات برنامه' : 'resets layout, effects, watermark, numbering and app settings')
                  : '')}
                {row.changedAt && !row.builtin ? ` · ${formatStamp(row.changedAt, isFa)}` : ''}
              </span>
            </span>

            <span className="flex items-center gap-1.5">
              <ShortcutChip shortcut={row.shortcut} isFa={isFa} />
              {!row.builtin && <ShortcutRecorder presetId={row.id} shortcut={row.shortcut} isFa={isFa} onNotice={setNotice} />}
            </span>

            <span className="flex items-center gap-1.5">
              <button
                type="button"
                data-preset-apply={row.name}
                data-reset-settings={row.builtin ? 'true' : undefined}
                onClick={() => applyRow(row)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer ${
                  row.builtin
                    ? (confirmReset
                        ? 'bg-rose-600 text-white'
                        : 'border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20')
                    : 'bg-sky-600 text-white hover:bg-sky-500'
                }`}
              >
                {row.builtin
                  ? (confirmReset
                      ? (isFa ? 'برای بازنشانی دوباره بزنید' : 'Press again to reset')
                      : (isFa ? 'بازنشانی به پیش‌فرض' : 'Reset to defaults'))
                  : (isFa ? 'اعمال' : 'Apply')}
              </button>
              {!row.builtin && (
                <>
                  <button
                    type="button"
                    data-preset-capture={row.id}
                    title={isFa
                      ? 'چیدمان، افکت‌ها، واترمارک و شماره‌گذاری فعلی روی همین پروفایل ذخیره می‌شود (نام و کلید میانبر می‌مانند)'
                      : 'Store the current sheet setup into this profile (its name and chord stay)'}
                    onClick={() => {
                      const result = overwriteSettingsPreset(row.id);
                      if (!result.ok) setNotice(isFa ? errorHint[result.error][0] : errorHint[result.error][1]);
                    }}
                    className="rounded-lg border border-slate-600 p-1 text-emerald-300 hover:bg-slate-700 cursor-pointer"
                  >
                    <Save className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={isFa ? `حذف پروفایل ${row.name}` : `Delete the ${row.name} profile`}
                    data-preset-delete={confirmDelete === row.id ? 'confirm' : row.id}
                    onClick={() => {
                      if (confirmDelete === row.id) { deleteSettingsPreset(row.id); setConfirmDelete(null); return; }
                      setConfirmDelete(row.id);
                    }}
                    className={`rounded-lg border p-1 cursor-pointer ${
                      confirmDelete === row.id
                        ? 'border-rose-400 bg-rose-600/30 text-rose-100'
                        : 'border-slate-700 text-rose-300 hover:bg-rose-500/15'
                    }`}
                  >
                    {confirmDelete === row.id
                      ? <span className="px-1 text-[10px] font-bold">{isFa ? 'تأیید حذف' : 'Confirm'}</span>
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 80))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (saveSettingsPreset(name)) setName('');
          }}
          placeholder={isFa ? 'نام پروفایل جدید، مثلاً «A4 دورو سیاه‌وسفید»' : 'New profile name, e.g. "A4 duplex B&W"'}
          className="min-w-0 flex-1 basis-48 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] text-white placeholder:text-slate-500"
        />
        <button
          type="button"
          data-preset-save
          onClick={() => { if (saveSettingsPreset(name)) setName(''); }}
          className="rounded-xl bg-violet-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-violet-500 cursor-pointer"
        >
          {isFa ? 'ثبت چیدمان فعلی' : 'Save current sheet setup'}
        </button>
      </div>

      {notice && (
        <p role="status" data-preset-notice className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-300">
          <KeyRound className="h-3 w-3" aria-hidden="true" />{notice}
        </p>
      )}
    </div>
  );
}

function formatStamp(iso: string, isFa: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(isFa ? 'fa-IR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
