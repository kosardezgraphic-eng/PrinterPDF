import React, { useEffect, useRef, useState } from 'react';
import { Check, KeyRound, Layers, Pencil, RotateCcw, Save, Trash2, ChevronDown, X } from 'lucide-react';
import { useAppStore, type SettingsPresetEditError } from '../store/useAppStore';
import { buildSheetPresetRows, type SheetPresetRow } from '../engine/sheetPresets';
import { formatShortcut } from '@shared/models';

/**
 * Sheet profiles: a stored page setup, and the reset that undoes it.
 *
 * A profile captures what happens to the *sheet* — imposition and placement, colour and effects,
 * watermark, page numbering — and nothing of the application's own preferences. That limit is the whole
 * point of the design: switching a profile on a loaded job is a press change, and an operator must not
 * lose their language, unit or tariff settings because they picked the layout they use every morning.
 *
 * The list always starts with one built-in row, «Shipped defaults», which is not stored anywhere: it is
 * the reset action with the `Alt+F6` chord on it. That is what makes the shortcut and the list the same
 * feature instead of two ways to do one thing, and it is why that entry cannot be renamed or deleted.
 *
 * Every other row is a single click to apply, and an explicit **edit** button that opens the four things
 * that need room — rename, the chord recorder, re-capturing today's sheet, delete. A list where every row
 * is a form is how a quick-access list stops being quick.
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
    <kbd dir="ltr" className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
      {shortcut}
    </kbd>
  );
}

/**
 * The "press a key to assign it" control. The capture-phase listener and the store flag are both needed:
 * the flag is what tells the application-level chord handler to stand aside, and the capture phase is
 * what keeps the browser from acting on the key being recorded.
 */
export function ShortcutRecorder({ presetId, shortcut, isFa, onNotice }: {
  presetId: string;
  shortcut: string;
  isFa: boolean;
  onNotice: (text: string) => void;
}) {
  const recording = useAppStore(state => state.shortcutRecordingFor === presetId);
  const beginRecording = useAppStore(state => state.beginShortcutRecording);
  const editSettingsPreset = useAppStore(state => state.editSettingsPreset);
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
    <span className="inline-flex items-center gap-1" data-shortcut-recorder={presetId}>
      <button
        type="button"
        data-shortcut-record={presetId}
        aria-pressed={recording}
        onClick={() => beginRecording(recording ? null : presetId)}
        title={isFa
          ? 'برای ثبت کلید میانبر، این را بزنید و بعد ترکیب مورد نظر را فشار دهید (Esc لغو)'
          : 'Press this, then type the chord you want for this profile (Esc cancels)'}
        className={`rounded-lg border px-2 py-1 text-[10px] font-bold cursor-pointer ${
          recording
            ? 'border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100'
            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
        }`}
      >
        {recording
          ? (isFa ? 'کلید را بزنید…' : 'Press a key…')
          : (shortcut ? (isFa ? 'تغییر کلید' : 'Change key') : (isFa ? 'ثبت کلید میانبر' : 'Assign a key'))}
      </button>
      {shortcut && (
        <button
          type="button"
          data-shortcut-clear={presetId}
          aria-label={isFa ? 'برداشتن کلید میانبر' : 'Remove the chord'}
          onClick={() => {
            const result = editSettingsPreset(presetId, { shortcut: '' });
            if (!result.ok) onNotice(isFa ? errorHint[result.error][0] : errorHint[result.error][1]);
          }}
          className="rounded-lg border border-slate-300 p-1 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 cursor-pointer"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <span className="text-[9px] leading-3 text-slate-500">
        {isFa ? 'Alt+F7 تا Alt+F12 یا Ctrl+Alt + حرف/رقم' : 'Alt+F7–Alt+F12, or Ctrl+Alt + a letter or digit'}
      </span>
    </span>
  );
}

/** Quick access, from the ribbon: the defaults entry, then one click per profile. */
export function SettingsPresetMenu() {
  const presets = useAppStore(state => state.settingsPresets);
  const language = useAppStore(state => state.settings.language);
  const applySettingsPreset = useAppStore(state => state.applySettingsPreset);
  const saveSettingsPreset = useAppStore(state => state.saveSettingsPreset);
  const beginEditPreset = useAppStore(state => state.beginEditPreset);
  const setModalState = useAppStore(state => state.setModalState);
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
        className="flex h-16 min-w-14 flex-col items-center justify-center gap-0.5 rounded-lg border border-slate-200 bg-white px-2 text-slate-700 transition hover:border-violet-400 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
      >
        <Layers className="h-5 w-5 text-violet-600 dark:text-violet-400" />
        <span className="sr-only">{isFa ? 'پروفایل شیت' : 'Sheet profiles'}</span>
        <ChevronDown className="h-3 w-3 text-slate-500 dark:text-slate-400" />
      </button>
      {open && (
        <div
          data-preset-menu
          dir={isFa ? 'rtl' : 'ltr'}
          className="absolute z-50 mt-1 w-96 rounded-xl border border-slate-200 bg-white p-2 text-xs text-slate-800 shadow-2xl dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        >
          <div className="mb-1 px-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">
            {isFa ? 'چیدمان شیت — با یک کلیک یا کلید میانبرش' : 'Sheet setup — one click, or its chord'}
          </div>
          <ul className="mb-1 max-h-64 overflow-y-auto">
            {rows.map(row => (
              <li key={row.id} className="flex items-center gap-1">
                <button
                  type="button"
                  data-preset-apply={row.name}
                  data-preset-builtin={row.builtin ? 'true' : undefined}
                  onClick={() => { applySettingsPreset(row.id); setOpen(false); }}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                >
                  {row.builtin
                    ? <RotateCcw className="h-3.5 w-3.5 shrink-0 text-rose-500 dark:text-rose-300" aria-hidden="true" />
                    : <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{row.name}</span>
                    {row.summary && <span dir="ltr" className="block truncate text-[10px] text-slate-500 dark:text-slate-400">{row.summary}</span>}
                  </span>
                  <ShortcutChip shortcut={row.shortcut} isFa={isFa} />
                </button>
                {!row.builtin && (
                  <button
                    type="button"
                    data-preset-edit={row.id}
                    aria-label={isFa ? `ویرایش پروفایل ${row.name}` : `Edit the ${row.name} profile`}
                    title={isFa ? 'نام، کلید میانبر، محتوا و حذف این پروفایل' : 'Rename this profile, give it a chord, re-capture it or delete it'}
                    onClick={() => { beginEditPreset(row.id); setModalState('settings', true); setOpen(false); }}
                    className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            data-preset-save-current
            onClick={() => { saveSettingsPreset(isFa ? `پروفایل ${presets.length + 1}` : `Profile ${presets.length + 1}`); setOpen(false); }}
            className="flex w-full items-center gap-2 rounded-lg border-t border-slate-200 px-2 py-1.5 text-start text-sky-700 hover:bg-slate-100 dark:border-slate-800 dark:text-sky-300 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            {isFa ? 'ثبت چیدمان فعلی شیت به‌عنوان پروفایل' : 'Save the current sheet setup as a profile'}
          </button>
        </div>
      )}
    </div>
  );
}

/** The managing half: apply in one click, and an edit button that opens rename, chord, re-capture, delete. */
export function SettingsPresetPanel() {
  const presets = useAppStore(state => state.settingsPresets);
  const language = useAppStore(state => state.settings.language);
  const applySettingsPreset = useAppStore(state => state.applySettingsPreset);
  const deleteSettingsPreset = useAppStore(state => state.deleteSettingsPreset);
  const editSettingsPreset = useAppStore(state => state.editSettingsPreset);
  const overwriteSettingsPreset = useAppStore(state => state.overwriteSettingsPreset);
  const saveSettingsPreset = useAppStore(state => state.saveSettingsPreset);
  const editingId = useAppStore(state => state.editingPresetId);
  const beginEditPreset = useAppStore(state => state.beginEditPreset);
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
    // The draft is the source of truth while a row is open for editing; committing the same text the
    // store already has must not burn an undo step or flash "name taken" for the profile's own name.
    const draft = drafts[row.id];
    if (draft === undefined || draft === row.name) return;
    const result = editSettingsPreset(row.id, { name: draft });
    if (!result.ok) setNotice(isFa ? errorHint[result.error][0] : errorHint[result.error][1]);
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
    <div className="mt-3 max-h-[42vh] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40" data-preset-panel>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-extrabold text-slate-800 dark:text-slate-200">
          <Layers className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          {isFa ? 'پروفایل‌های تنظیمات چاپ' : 'Print setup profiles'}
        </h3>
        <span className="text-[10px] text-slate-500">
          {isFa ? 'فقط تنظیمات خروجی چاپ؛ بدون تنظیمات محیط نرم‌افزار' : 'Print output only — no application preferences'}
        </span>
      </div>

      <p className="mb-3 text-[11px] leading-5 text-slate-600 dark:text-slate-400">
        {isFa
          ? 'هر پروفایل تنظیمات اعمال‌شده روی شیت را نگه می‌دارد: افکت‌ها، اندازه مارجین، اندازه میانه‌ها، چیدمان سفارشی، شماره صفحه و شماره بخش‌ها، جهت صفحه، پشت و رو بودن و واترمارک. تنظیمات محیطی نرم‌افزار (زبان، تم، واحد، تقویم، تعرفه و پیش‌نمایش) جزو پروفایل و بازنشانی نیستند.'
          : 'A profile stores sheet setup: effects, margins, gutters, custom layout, page & section numbering, page orientation, duplex mode, and watermark. Application environment preferences (language, theme, UI units, calendar, tariffs and preview) are untouched.'}
      </p>

      <ul className="mb-3 grid gap-1.5">
        {rows.map(row => {
          const editing = editingId === row.id;
          return (
            <li
              key={row.id}
              data-preset-row={row.id}
              data-preset-editing={editing ? 'true' : undefined}
              className={`flex flex-wrap items-center gap-2 rounded-xl border px-2.5 py-1.5 ${
                editing
                  ? 'border-sky-500/60 bg-sky-50/70 dark:bg-slate-800'
                  : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/70'
              }`}
            >
              <span className="min-w-0 flex-1 basis-40">
                {row.builtin ? (
                  <span className="block truncate text-[11px] font-bold text-rose-700 dark:text-rose-200">{row.name}</span>
                ) : editing ? (
                  <input
                    type="text"
                    data-preset-name={row.id}
                    autoFocus
                    aria-label={isFa ? `نام پروفایل ${row.name}` : `Profile name for ${row.name}`}
                    value={drafts[row.id] ?? row.name}
                    onChange={(event) => setDrafts(state => ({ ...state, [row.id]: event.target.value.slice(0, 80) }))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); commitDraft(row); }
                      if (event.key === 'Escape') { event.preventDefault(); setDrafts(state => ({ ...state, [row.id]: row.name })); }
                    }}
                    onBlur={() => commitDraft(row)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-bold text-slate-900 focus:border-sky-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                ) : (
                  <span className="block truncate text-[11px] font-bold text-slate-900 dark:text-slate-100">{row.name}</span>
                )}
                <span dir="ltr" className="block truncate text-[10px] text-slate-500 dark:text-slate-400">
                  {row.summary || (row.builtin
                    ? (isFa ? 'بازنشانی افکت‌ها، مارجین، میانه، چیدمان، شماره‌ها، جهت، دورو و اشکال (بدون تغییر تنظیمات محیطی)' : 'resets effects, margins, gutters, layout, numbering, orientation, duplex & shapes (keeps app preferences)')
                    : '')}
                  {row.changedAt && !row.builtin ? ` · ${formatStamp(row.changedAt, isFa)}` : ''}
                </span>
              </span>

              <span className="flex items-center gap-1.5">
                {!editing && <ShortcutChip shortcut={row.shortcut} isFa={isFa} />}
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
                          : 'border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20')
                      : 'bg-sky-600 text-white hover:bg-sky-500'
                  }`}
                >
                  {row.builtin
                    ? (confirmReset
                        ? (isFa ? 'برای بازنشانی دوباره بزنید' : 'Press again to reset')
                        : (isFa ? 'بازنشانی به پیش‌فرض' : 'Reset to defaults'))
                    : (isFa ? 'اعمال' : 'Apply')}
                </button>
                {!row.builtin && !editing && (
                  <button
                    type="button"
                    data-preset-edit={row.id}
                    onClick={() => { beginEditPreset(row.id); setDrafts(state => ({ ...state, [row.id]: row.name })); }}
                    className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                    {isFa ? 'ویرایش' : 'Edit'}
                  </button>
                )}
                {!row.builtin && editing && (
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
                      className="flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20 cursor-pointer"
                    >
                      <Save className="h-3 w-3" aria-hidden="true" />
                      {isFa ? 'ثبت محتوای فعلی' : 'Store current sheet'}
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
                          ? 'border-rose-400 bg-rose-100 text-rose-800 dark:bg-rose-600/30 dark:text-rose-100'
                          : 'border-slate-300 text-rose-600 hover:bg-rose-50 dark:border-slate-700 dark:text-rose-300 dark:hover:bg-rose-500/15'
                      }`}
                    >
                      {confirmDelete === row.id
                        ? <span className="px-1 text-[10px] font-bold">{isFa ? 'تأیید حذف' : 'Confirm'}</span>
                        : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      data-preset-edit-done={row.id}
                      onClick={() => { commitDraft(row); beginEditPreset(null); }}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
                    >
                      {isFa ? 'پایان ویرایش' : 'Done'}
                    </button>
                  </>
                )}
              </span>

              {editing && (
                <span className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-1.5 dark:border-slate-700">
                  <span className="flex items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400">
                    <KeyRound className="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-300" aria-hidden="true" />
                    {isFa ? 'کلید میانبر این پروفایل:' : 'Chord for this profile:'}
                    <ShortcutChip shortcut={row.shortcut} isFa={isFa} />
                  </span>
                  <ShortcutRecorder presetId={row.id} shortcut={row.shortcut} isFa={isFa} onNotice={setNotice} />
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          data-preset-new-name
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 80))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (saveSettingsPreset(name)) setName('');
          }}
          placeholder={isFa ? 'نام پروفایل جدید، مثلاً «A4 دورو سیاه‌وسفید»' : 'New profile name, e.g. "A4 duplex B&W"'}
          className="min-w-0 flex-1 basis-48 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-[11px] text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
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
        <p role="status" data-preset-notice className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-300">
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
