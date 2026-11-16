import React from 'react';
import { BookOpen, X, Info } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { STANDARD_PAPER_SIZES, type BookletSettings, type PaperSizeId } from '@shared/models';

export function BookletControlPanel({ onClose }: { onClose: () => void }) {
  const layout = useAppStore(state => state.layout);
  const updateLayout = useAppStore(state => state.updateLayout);
  const language = useAppStore(state => state.settings.language);
  const isFa = language === 'fa';
  const booklet: BookletSettings = layout.booklet ?? {
    enabled: false, direction: 'rtl', signatureSize: 0, spineWidthMm: 4,
    creepMm: 0.2, duplexMode: 'short-edge', outerMarginMm: 10, compensateCreep: true,
  };
  const patch = (value: Partial<BookletSettings>) =>
    updateLayout({ booklet: { ...booklet, ...value } });
  const input = 'w-full rounded border border-slate-600 bg-slate-800 p-1.5 text-xs text-white';
  const label = 'block space-y-1';

  return (
    <aside data-booklet-control-panel aria-label={isFa ? 'تنظیمات بوکلت' : 'Booklet controls'}
      className="w-72 max-w-[min(18rem,45vw)] shrink-0 overflow-y-auto border-s border-slate-700 bg-slate-900 p-3 text-xs text-slate-200 space-y-3">
      <div className="flex items-center justify-between">
        <strong className="flex items-center gap-1.5">
          <BookOpen className="h-4 w-4 text-amber-300" />
          {isFa ? 'تنظیمات چاپ بوکلت' : 'Booklet setup'}
        </strong>
        <button type="button" onClick={onClose} title={isFa ? 'بستن پنل' : 'Close panel'}
          className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"><X className="h-4 w-4" /></button>
      </div>

      <label className="flex items-center gap-2 rounded border border-slate-700 bg-slate-800 p-2">
        <input type="checkbox" checked={booklet.enabled} onChange={e => patch({ enabled: e.target.checked })}
          className="accent-amber-500" />
        <span className="font-semibold text-slate-100">{isFa ? 'فعال‌سازی چیدمان بوکلت' : 'Enable booklet imposition'}</span>
      </label>

      <label className={label}>
        <span className="text-slate-400">{isFa ? 'جهت صحافی و ترتیب صفحات' : 'Reading / binding direction'}</span>
        <select value={booklet.direction} onChange={e => patch({ direction: e.target.value as BookletSettings['direction'] })} className={input}>
          <option value="rtl">{isFa ? 'راست به چپ (فارسی)' : 'Right to left'}</option>
          <option value="ltr">{isFa ? 'چپ به راست (لاتین)' : 'Left to right'}</option>
        </select>
      </label>

      <label className={label}>
        <span className="text-slate-400">{isFa ? 'اندازه کاغذ هر برگ چاپی' : 'Printed sheet size'}</span>
        <select value={layout.paperSize} onChange={e => updateLayout({ paperSize: e.target.value as PaperSizeId })} className={input}>
          {Object.entries(STANDARD_PAPER_SIZES).map(([id, paper]) => <option key={id} value={id}>{paper.label}</option>)}
          <option value="Custom">{isFa ? 'ابعاد سفارشی' : 'Custom size'}</option>
        </select>
      </label>

      {layout.paperSize === 'Custom' && (
        <div className="grid grid-cols-2 gap-2">
          <label className={label}><span className="text-slate-400">{isFa ? 'عرض (mm)' : 'Width (mm)'}</span>
            <input type="number" min="80" max="1000" value={layout.customWidthMm}
              onChange={e => updateLayout({ customWidthMm: Math.max(80, Number(e.target.value) || 80) })} className={input} />
          </label>
          <label className={label}><span className="text-slate-400">{isFa ? 'ارتفاع (mm)' : 'Height (mm)'}</span>
            <input type="number" min="80" max="1400" value={layout.customHeightMm}
              onChange={e => updateLayout({ customHeightMm: Math.max(80, Number(e.target.value) || 80) })} className={input} />
          </label>
        </div>
      )}

      <label className={label}>
        <span className="text-slate-400">{isFa ? 'تعداد صفحات در هر دسته صحافی' : 'Pages per signature'}</span>
        <select value={booklet.signatureSize} onChange={e => patch({ signatureSize: Number(e.target.value) as BookletSettings['signatureSize'] })} className={input}>
          <option value="0">{isFa ? 'خودکار؛ کل سند' : 'Automatic; whole document'}</option>
          {[4,8,12,16,24,32].map(size => <option key={size} value={size}>{size} {isFa ? 'صفحه' : 'pages'}</option>)}
        </select>
      </label>

      <div className="border-t border-slate-700 pt-3 space-y-3">
        <p className="font-semibold text-slate-300">{isFa ? 'شیرازه و عطف' : 'Spine and fold'}</p>
        <label className={label}>
          <span className="flex justify-between text-slate-400"><span>{isFa ? 'عرض فضای شیرازه (mm)' : 'Spine gap (mm)'}</span><span>{booklet.spineWidthMm} mm</span></span>
          <input type="range" min="0" max="30" step="0.5" value={booklet.spineWidthMm}
            onChange={e => patch({ spineWidthMm: Number(e.target.value) })} className="w-full accent-amber-500" />
          <input type="number" min="0" max="30" step="0.5" value={booklet.spineWidthMm}
            onChange={e => patch({ spineWidthMm: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })} className={input} />
        </label>
        <label className={label}>
          <span className="flex justify-between text-slate-400"><span>{isFa ? 'جبران ضخامت کاغذ / Creep (mm)' : 'Creep compensation (mm)'}</span><span>{booklet.creepMm} mm</span></span>
          <input type="number" min="0" max="5" step="0.05" value={booklet.creepMm}
            onChange={e => patch({ creepMm: Math.max(0, Math.min(5, Number(e.target.value) || 0)) })} className={input} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={booklet.compensateCreep} onChange={e => patch({ compensateCreep: e.target.checked })} className="accent-amber-500" />
          {isFa ? 'اعمال جبران شیفت صفحات داخلی' : 'Apply progressive creep shift'}
        </label>
      </div>

      <div className="border-t border-slate-700 pt-3 space-y-3">
        <p className="font-semibold text-slate-300">{isFa ? 'چاپ و حاشیه‌ها' : 'Printing and margins'}</p>
        <label className={label}>
          <span className="text-slate-400">{isFa ? 'حالت پشت‌ورو پرینتر' : 'Duplex flip edge'}</span>
          <select value={booklet.duplexMode} onChange={e => patch({ duplexMode: e.target.value as BookletSettings['duplexMode'] })} className={input}>
            <option value="short-edge">{isFa ? 'برگشت از لبه کوتاه' : 'Flip on short edge'}</option>
            <option value="long-edge">{isFa ? 'برگشت از لبه بلند' : 'Flip on long edge'}</option>
          </select>
        </label>
        <label className={label}>
          <span className="text-slate-400">{isFa ? 'حاشیه بیرونی (mm)' : 'Outer margin (mm)'}</span>
          <input type="number" min="0" max="40" step="0.5" value={booklet.outerMarginMm}
            onChange={e => patch({ outerMarginMm: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })} className={input} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={layout.showCropMarks}
            onChange={e => updateLayout({ showCropMarks: e.target.checked })} className="accent-amber-500" />
          {isFa ? 'نمایش علائم برش' : 'Show crop marks'}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={layout.showCellBorders}
            onChange={e => updateLayout({ showCellBorders: e.target.checked })} className="accent-amber-500" />
          {isFa ? 'نمایش کادر دور صفحات' : 'Show page borders'}
        </label>
      </div>

      <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] leading-5 text-amber-100">
        <div className="mb-1 flex items-center gap-1 font-semibold"><Info className="h-3.5 w-3.5" />{isFa ? 'نکته چاپ' : 'Print note'}</div>
        {isFa
          ? 'بوکلت به چاپ دورو نیاز دارد. تعداد صفحات هر دسته به مضرب ۴ تکمیل می‌شود و صفحات خالی لازم به‌صورت خودکار ایجاد می‌شوند. جهت لبه برگردان را مطابق درایور پرینتر انتخاب کنید.'
          : 'Booklets require duplex printing. Each signature is padded to a multiple of four with blank pages. Match the flip edge to your printer driver.'}
      </div>
    </aside>
  );
}
