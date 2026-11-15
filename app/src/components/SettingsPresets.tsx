import React, { useEffect, useRef, useState } from 'react';
import { Check, RotateCcw, Save, Trash2, ChevronDown, Layers } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { crispPreviewStats } from '../engine/vectorPreviewBridge';

/**
 * Saved setting profiles — the quick-access half of the settings story.
 *
 * A profile captures what changes print output (layout, effects, watermark, page numbering and the
 * general settings block) and nothing else: the files on the desk are never part of it, so applying a
 * preset to a loaded job re-rigs the press without throwing the job away. The menu is the fast path;
 * the panel in the settings modal is the managing path.
 */
export function SettingsPresetMenu() {
  const presets = useAppStore(state => state.settingsPresets);
  const language = useAppStore(state => state.settings.language);
  const applySettingsPreset = useAppStore(state => state.applySettingsPreset);
  const saveSettingsPreset = useAppStore(state => state.saveSettingsPreset);
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);

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

  const isFa = language === 'fa';
  return (
    <div ref={host} className="relative">
      <button
        type="button"
        data-preset-menu-trigger
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        title={isFa ? 'پریست‌های ذخیره‌شدهٔ تنظیمات' : 'Saved setting profiles'}
        className="flex flex-col items-center gap-1 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-slate-200 hover:bg-slate-700 cursor-pointer"
      >
        <Layers className="h-5 w-5 text-violet-400" />
        <span className="sr-only">{isFa ? 'پریست تنظیمات' : 'Setting presets'}</span>
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>
      {open && (
        <div
          data-preset-menu
          dir={isFa ? 'rtl' : 'ltr'}
          className="absolute z-50 mt-1 w-72 rounded-xl border border-slate-600 bg-slate-900 p-2 text-xs text-slate-100 shadow-2xl"
        >
          <div className="mb-1 px-1 text-[10px] font-bold text-slate-400">
            {isFa ? 'اعمال پریست' : 'Apply a profile'}
          </div>
          {presets.length === 0 ? (
            <p className="px-1 pb-2 text-slate-400">
              {isFa
                ? 'هنوز پریستی ذخیره نشده است.'
                : 'No saved profiles yet.'}
            </p>
          ) : (
            <ul className="mb-1 max-h-56 overflow-y-auto">
              {presets.map(preset => (
                <li key={preset.id}>
                  <button
                    type="button"
                    data-preset-apply={preset.name}
                    onClick={() => { applySettingsPreset(preset.id); setOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-slate-700 cursor-pointer"
                  >
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                    <span className="truncate font-semibold">{preset.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            data-preset-save-current
            onClick={() => { saveSettingsPreset(isFa ? `پریست ${presets.length + 1}` : `Profile ${presets.length + 1}`); setOpen(false); }}
            className="flex w-full items-center gap-2 rounded-lg border-t border-slate-800 px-2 py-1.5 text-start text-sky-300 hover:bg-slate-800 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            {isFa ? 'ثبت تنظیمات فعلی به‌عنوان پریست' : 'Save the current settings as a profile'}
          </button>
        </div>
      )}
    </div>
  );
}

/** The managing half: name a profile, see who is stored, apply or delete, and start over. */
export function SettingsPresetPanel() {
  const presets = useAppStore(state => state.settingsPresets);
  const language = useAppStore(state => state.settings.language);
  const saveSettingsPreset = useAppStore(state => state.saveSettingsPreset);
  const applySettingsPreset = useAppStore(state => state.applySettingsPreset);
  const deleteSettingsPreset = useAppStore(state => state.deleteSettingsPreset);
  const resetAllSettings = useAppStore(state => state.resetAllSettings);
  const clearCache = useAppStore(state => state.clearCrispPreviewCacheNow);
  const crispOn = useAppStore(state => state.settings.previewFidelity === 'crisp');
  const [stats, setStats] = useState(() => crispPreviewStats());
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const isFa = language === 'fa';

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 6000);
    return () => clearTimeout(timer);
  }, [confirming]);

  // The cache fills up as pages scroll past, so the line is refreshed while the panel is open — it is
  // the one place that can answer "is this actually costing me memory right now?".
  useEffect(() => {
    const timer = setInterval(() => setStats(crispPreviewStats()), 750);
    return () => clearInterval(timer);
  }, []);

  const formatStamp = (iso: string) => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(isFa ? 'fa-IR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  };

  return (
    <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-extrabold text-slate-200">
          <Layers className="h-4 w-4 text-violet-400" />
          {isFa ? 'پروفایل‌های پریست تنظیمات (K2)' : 'Saved setting profiles (K2)'}
        </h3>
        <button
          type="button"
          data-reset-settings
          onClick={() => { if (confirming) { resetAllSettings(); setConfirming(false); } else { setConfirming(true); } }}
          title={isFa
            ? 'چیدمان، افکت‌ها، واترمارک، شماره‌گذاری صفحه و تنظیمات عمومی به مقدار اولیه برمی‌گردند. فایل‌ها و صفحات دست‌نخورده می‌مانند. میانبر: Alt+F6'
            : 'Layout, effects, watermark, page numbering and general settings go back to their shipped values. Documents and pages stay. Shortcut: Alt+F6'}
          className={`rounded-xl border px-3 py-1.5 text-[11px] font-bold cursor-pointer ${
            confirming
              ? 'border-rose-400 bg-rose-600/30 text-rose-100'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            {confirming
              ? (isFa ? 'برای تأیید دوباره بزنید' : 'Press again to confirm')
              : (isFa ? 'بازگشت همهٔ تنظیمات به پیش‌فرض — Alt+F6' : 'Reset all settings to defaults — Alt+F6')}
          </span>
        </button>
      </div>

      <p className="mb-3 text-[11px] leading-5 text-slate-400">
        {isFa
          ? 'هر پریست چیدمان، افکت‌ها، واترمارک، شماره‌گذاری صفحه و تنظیمات عمومی را با هم نگه می‌دارد؛ زبان رابط کاربری موقع بازنشانی عوض نمی‌شود تا متن زیر دستتان تغییر نکند.'
          : 'A profile stores layout, effects, watermark, page numbering and the general settings together. The interface language survives a reset, so the UI does not change language under you.'}
      </p>

      {presets.length > 0 && (
        <ul className="mb-3 grid gap-1.5">
          {presets.map(preset => (
            <li key={preset.id} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/70 px-2.5 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-bold text-slate-100">{preset.name}</span>
                <span className="block text-[10px] text-slate-400" dir="ltr">
                  {preset.layout.paperSize} · {preset.layout.rows}×{preset.layout.cols} · {preset.layout.duplexMode === 'none' ? (isFa ? 'یک‌رو' : 'simplex') : (isFa ? 'دورو' : 'duplex')}
                  {formatStamp(preset.updatedAt || preset.createdAt) ? ` · ${formatStamp(preset.updatedAt || preset.createdAt)}` : ''}
                </span>
              </span>
              <button
                type="button"
                data-preset-apply={preset.name}
                onClick={() => applySettingsPreset(preset.id)}
                className="rounded-lg bg-sky-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-500 cursor-pointer"
              >
                {isFa ? 'اعمال' : 'Apply'}
              </button>
              <button
                type="button"
                aria-label={isFa ? `حذف پریست ${preset.name}` : `Delete the ${preset.name} profile`}
                onClick={() => deleteSettingsPreset(preset.id)}
                className="rounded-lg border border-slate-700 p-1 text-rose-300 hover:bg-rose-500/15 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 80))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const id = saveSettingsPreset(name);
            if (id) setName('');
          }}
          placeholder={isFa ? 'نام پریست، مثلاً «A4 دورو سیاه‌وسفید»' : 'Profile name, e.g. "A4 duplex B&W"'}
          className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] text-white placeholder:text-slate-500"
        />
        <button
          type="button"
          data-preset-save
          onClick={() => { const id = saveSettingsPreset(name); if (id) setName(''); }}
          className="rounded-xl bg-violet-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-violet-500 cursor-pointer"
        >
          {isFa ? 'ذخیرهٔ تنظیمات فعلی' : 'Save current settings'}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
        <span dir="ltr">
          {isFa ? 'پیش‌نمایش کریسپ: ' : 'Crisp preview: '}
          {crispOn ? (isFa ? 'روشن' : 'on') : (isFa ? 'خاموش' : 'off')} · {stats.cached} {isFa ? 'صفحه در حافظه' : 'pages held'} · {Math.round(stats.bytes / 1048576)} MB · {stats.running} {isFa ? 'در حال رندر' : 'rendering'}
        </span>
        <button
          type="button"
          data-clear-preview-cache
          onClick={() => { clearCache(); setStats(crispPreviewStats()); }}
          title={isFa
            ? 'تصویرهای رندرشدهٔ پیش‌نمایش از حافظه پاک می‌شوند؛ صفحات دوباره در زمان لازم رندر می‌شوند.'
            : 'Frees every preview bitmap held in memory; the pages that are looked at again are re-rendered on demand.'}
          className="rounded-lg border border-slate-700 px-2 py-0.5 text-slate-300 hover:bg-slate-800 cursor-pointer"
        >
          {isFa ? 'خالی‌کردن کش پیش‌نمایش' : 'Free the preview cache'}
        </button>
      </div>
    </div>
  );
}
