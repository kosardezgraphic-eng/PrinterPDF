import React from 'react';
import { Droplets, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

export function WatermarkControlPanel({ onClose }: { onClose: () => void }) {
  const watermark = useAppStore(state => state.watermark);
  const updateWatermark = useAppStore(state => state.updateWatermark);
  const language = useAppStore(state => state.settings.language);
  const isFa = language === 'fa';
  const patch = (value: Partial<typeof watermark>) => updateWatermark(value);
  const input = 'w-full rounded border border-slate-300 bg-white p-1.5 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white';

  return (
    <aside data-watermark-control-panel aria-label={isFa ? 'تنظیمات واترمارک' : 'Watermark controls'}
      className="w-full bg-white p-3 text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-200 space-y-3">
      <div className="flex items-center justify-between">
        <strong className="flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
          <Droplets className="h-4 w-4 text-sky-600 dark:text-sky-300" />
          {isFa ? 'تنظیمات واترمارک' : 'Watermark'}
        </strong>
        <button type="button" onClick={onClose}
          title={isFa ? 'بستن پنل تنظیمات' : 'Close settings panel'}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white cursor-pointer"><X className="h-4 w-4" /></button>
      </div>

      <label className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800">
        <input type="checkbox" checked={watermark.enabled}
          onChange={e => updateWatermark({ enabled: e.target.checked })} className="accent-sky-500" />
        <span className="font-semibold text-slate-900 dark:text-slate-100">{isFa ? 'نمایش واترمارک' : 'Show watermark'}</span>
      </label>

      <label className="block space-y-1">
        <span className="text-slate-600 dark:text-slate-400">{isFa ? 'متن واترمارک' : 'Watermark text'}</span>
        <textarea rows={3} value={watermark.text}
          onChange={e => patch({ text: e.target.value })}
          placeholder={isFa ? 'متن واترمارک را وارد کنید' : 'Enter watermark text'}
          className={input + ' resize-y'} />
      </label>

      <div>
        <p className="mb-1 text-slate-600 dark:text-slate-400">{isFa ? 'افزودن متغیر پویا' : 'Insert variable'}</p>
        <div className="flex flex-wrap gap-1">
          {['{page}', '{pages}', '{sheet}', '{sheets}', '{date}', '{shamsi_date}', '{file}', '{user}'].map(macro => (
            <button key={macro} type="button"
              onClick={() => patch({ text: `${watermark.text}${watermark.text.trim() ? ' ' : ''}${macro}` })}
              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1 font-mono text-[10px] text-sky-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-sky-300 dark:hover:bg-slate-700 cursor-pointer">{macro}</button>
          ))}
        </div>
      </div>

      <label className="block space-y-1">
        <span className="text-slate-600 dark:text-slate-400">{isFa ? 'نوع قلم' : 'Font family'}</span>
        <select value={watermark.fontFamily}
          onChange={e => patch({ fontFamily: e.target.value as 'Vazirmatn' | 'Inter' })} className={input}>
          <option value="Vazirmatn">Vazirmatn</option>
          <option value="Inter">Inter</option>
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-slate-600 dark:text-slate-400">{isFa ? 'اندازه قلم (pt)' : 'Font size (pt)'}</span>
        <input type="number" min="6" max="200" value={watermark.fontSizePt}
          onChange={e => patch({ fontSizePt: Math.max(6, Math.min(200, Number(e.target.value) || 6)) })} className={input} />
      </label>

      <label className="flex items-center justify-between gap-2">
        <span className="text-slate-600 dark:text-slate-400">{isFa ? 'رنگ واترمارک' : 'Watermark color'}</span>
        <input type="color" value={watermark.colorHex}
          onChange={e => patch({ colorHex: e.target.value })}
          className="h-8 w-12 cursor-pointer rounded border border-slate-300 bg-white p-1 dark:border-slate-600 dark:bg-slate-800" />
      </label>

      <label className="block space-y-1">
        <span className="flex justify-between text-slate-600 dark:text-slate-400"><span>{isFa ? 'شفافیت' : 'Opacity'}</span><span>{Math.round(watermark.opacity * 100)}%</span></span>
        <input type="range" min="5" max="100" value={Math.round(watermark.opacity * 100)}
          onChange={e => patch({ opacity: Number(e.target.value) / 100 })} className="w-full" />
      </label>

      <label className="block space-y-1">
        <span className="flex justify-between text-slate-600 dark:text-slate-400"><span>{isFa ? 'زاویه چرخش' : 'Rotation'}</span><span>{watermark.rotationDeg}°</span></span>
        <input type="range" min="-90" max="90" value={watermark.rotationDeg}
          onChange={e => patch({ rotationDeg: Number(e.target.value) })} className="w-full" />
      </label>

      <div className="border-t border-slate-200 pt-3 space-y-2 dark:border-slate-700">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={watermark.tiled}
            onChange={e => patch({ tiled: e.target.checked })} className="accent-sky-500" />
          {isFa ? 'تکرار واترمارک در کل صفحه' : 'Tile across the page'}
        </label>
        <label className="block space-y-1">
          <span className="text-slate-600 dark:text-slate-400">{isFa ? 'فاصله تکرار (میلی‌متر)' : 'Tile spacing (mm)'}</span>
          <input type="number" min="5" max="500" value={watermark.tileSpacingMm} disabled={!watermark.tiled}
            onChange={e => patch({ tileSpacingMm: Math.max(5, Math.min(500, Number(e.target.value) || 5)) })}
            className={input + ' disabled:opacity-40'} />
        </label>
      </div>
    </aside>
  );
}
