import React from 'react';
import {
  Brush,
  Check,
  Eraser,
  Pipette,
  RotateCcw,
  SquareDashedMousePointer,
  Undo2,
  X,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { formatLocalizedNumber } from '../i18n/shamsi';

export const EraserControlPanel: React.FC = () => {
  const {
    settings,
    pages,
    activePageId,
    overlays,
    selectedOverlayId,
    eraseTool,
    eraseBrushMm,
    eraseColor,
    erasePending,
    setEraseTool,
    setEraseBrushMm,
    setEraseColor,
    setErasePending,
    commitErasePending,
    setOverlayErase,
    setPageErase,
  } = useAppStore();

  const isFa = settings.language === 'fa';

  const selectedImageOverlay = overlays.find(
    (item) => item.kind === 'image' && item.id === selectedOverlayId
  );
  const targetOverlay =
    selectedImageOverlay && selectedImageOverlay.kind === 'image'
      ? selectedImageOverlay
      : undefined;

  const targetPage =
    !targetOverlay
      ? pages.find((p) => p.id === activePageId) ??
        pages.find((p) => p.isHighlighted) ??
        pages.find((p) => p.selectedForPrint) ??
        pages[0]
      : undefined;

  const shapes = targetOverlay
    ? targetOverlay.erase ?? []
    : targetPage?.erase ?? [];

  const canModify = Boolean(targetOverlay || targetPage);

  const undoLastShape = () => {
    if (shapes.length === 0) return;
    const next = shapes.slice(0, -1);
    if (targetOverlay) {
      setOverlayErase(targetOverlay.id, next);
    } else if (targetPage) {
      setPageErase(targetPage.id, next);
    }
  };

  const restoreAll = () => {
    if (shapes.length === 0) return;
    if (targetOverlay) {
      setOverlayErase(targetOverlay.id, []);
    } else if (targetPage) {
      setPageErase(targetPage.id, []);
    }
  };

  return (
    <div
      data-erase-tools
      data-eraser-control-panel
      dir={isFa ? 'rtl' : 'ltr'}
      className="flex flex-col gap-3 p-3 text-xs text-slate-800 dark:text-slate-100"
    >
      {/* Active target indicator */}
      <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-xs dark:border-slate-700 dark:bg-slate-800/80">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-slate-700 dark:text-slate-200">
            {isFa ? 'هدف پاک‌کن:' : 'Eraser Target:'}
          </span>
          {eraseTool !== 'off' && (
            <button
              type="button"
              onClick={() => setEraseTool('off')}
              className="rounded border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 cursor-pointer"
            >
              {isFa ? 'پایان پاک‌کن' : 'Done'}
            </button>
          )}
        </div>
        <div className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
          {targetOverlay
            ? isFa
              ? `تصویر روی صفحه: ${targetOverlay.name}`
              : `Picture overlay: ${targetOverlay.name}`
            : targetPage
              ? isFa
                ? `صفحه سند: ${targetPage.documentName} (ص ${formatLocalizedNumber(targetPage.sourcePageNumber || 1, settings.language)})`
                : `Document page: ${targetPage.documentName} (p.${targetPage.sourcePageNumber || 1})`
              : isFa
                ? 'ابتدا یک سند یا تصویر به میز کار اضافه کنید.'
                : 'Load a document or picture onto the workspace first.'}
        </div>
      </div>

      {/* Tool mode selector: Brush, Region, Eyedropper */}
      <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800/80">
        <div className="mb-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">
          {isFa ? 'حالت ابزار پاک‌کن' : 'Eraser Mode'}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            data-erase-tool="brush"
            disabled={!canModify}
            aria-pressed={eraseTool === 'brush'}
            onClick={() => setEraseTool(eraseTool === 'brush' ? 'off' : 'brush')}
            className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-semibold transition cursor-pointer disabled:opacity-45 ${
              eraseTool === 'brush'
                ? 'border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-400 dark:bg-sky-500/20 dark:text-sky-200'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Brush className="h-4 w-4" aria-hidden="true" />
            <span>{isFa ? 'قلم‌مو' : 'Brush'}</span>
          </button>

          <button
            type="button"
            data-erase-tool="region"
            disabled={!canModify}
            aria-pressed={eraseTool === 'region'}
            onClick={() => setEraseTool(eraseTool === 'region' ? 'off' : 'region')}
            className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-semibold transition cursor-pointer disabled:opacity-45 ${
              eraseTool === 'region'
                ? 'border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-400 dark:bg-sky-500/20 dark:text-sky-200'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <SquareDashedMousePointer className="h-4 w-4" aria-hidden="true" />
            <span>{isFa ? 'ناحیه' : 'Region'}</span>
          </button>

          <button
            type="button"
            data-erase-tool="picker"
            disabled={!canModify}
            aria-pressed={eraseTool === 'picker'}
            onClick={() => setEraseTool(eraseTool === 'picker' ? 'off' : 'picker')}
            className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-semibold transition cursor-pointer disabled:opacity-45 ${
              eraseTool === 'picker'
                ? 'border-sky-500 bg-sky-50 text-sky-700 dark:border-sky-400 dark:bg-sky-500/20 dark:text-sky-200'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Pipette className="h-4 w-4" aria-hidden="true" />
            <span>{isFa ? 'قطره‌چکان' : 'Eyedropper'}</span>
          </button>
        </div>

        <p className="mt-2 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
          {eraseTool === 'brush'
            ? isFa
              ? 'نشانگر موس به قلم‌مو تبدیل شده است؛ روی تصویر کلیک و نگه دارید تا پاک شود.'
              : 'Cursor is now a brush. Click and drag across the image to erase.'
            : eraseTool === 'region'
              ? isFa
                ? 'یک مستطیل روی تصویر بکشید و سپس کلید Delete را بزنید تا پاک شود.'
                : 'Drag a rectangle over the image, then press Delete to erase.'
              : eraseTool === 'picker'
                ? isFa
                  ? 'روی هر نقطه از تصویر کلیک کنید تا رنگ آن برای قلم‌مو انتخاب شود.'
                  : 'Click anywhere on the image to sample that color for the brush.'
                : isFa
                  ? 'یکی از ابزارهای قلم‌مو، انتخاب ناحیه یا قطره‌چکان را انتخاب کنید.'
                  : 'Select Brush, Region marquee, or Eyedropper to edit pixels cleanly.'}
        </p>
      </div>

      {/* Brush size */}
      <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800/80">
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold">
          <span className="text-slate-700 dark:text-slate-200">
            {isFa ? 'اندازه قلم‌مو (mm)' : 'Brush Diameter (mm)'}
          </span>
          <span className="tabular-nums text-sky-600 dark:text-sky-400">
            {eraseBrushMm.toFixed(1)} mm
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            data-erase-size
            aria-label={isFa ? 'اندازه قلم‌مو' : 'Brush size'}
            type="range"
            min={0.5}
            max={60}
            step={0.5}
            value={eraseBrushMm}
            onChange={(e) => setEraseBrushMm(Number(e.target.value))}
            className="flex-1 accent-sky-600"
          />
          <input
            type="number"
            min={0.2}
            max={500}
            step={0.5}
            value={eraseBrushMm}
            onChange={(e) => setEraseBrushMm(Number(e.target.value))}
            className="w-16 rounded border border-slate-300 bg-slate-50 px-1.5 py-1 text-center text-[11px] tabular-nums text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      {/* Brush Color & Transparency / Hole */}
      <div className="rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800/80">
        <div className="mb-2 flex items-center justify-between text-[11px] font-bold">
          <span className="text-slate-700 dark:text-slate-200">
            {isFa ? 'رنگ قلم‌مو / برش شفاف' : 'Brush Color / Cutout'}
          </span>
          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
            {eraseColor ?? (isFa ? 'شفاف (حذف کامل)' : 'Transparent hole')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 cursor-pointer dark:border-slate-700 dark:bg-slate-900">
            <input
              data-erase-color
              type="color"
              aria-label={isFa ? 'رنگ قلم‌موی پاک‌کن' : 'Eraser brush color'}
              value={eraseColor ?? '#ffffff'}
              onChange={(e) => setEraseColor(e.target.value)}
              className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <span className="text-[11px]">
              {isFa ? 'رنگ دلخواه' : 'Pick Color'}
            </span>
          </label>

          <button
            type="button"
            onClick={() => setEraseColor('#ffffff')}
            className={`rounded-lg border px-2 py-1 text-[11px] cursor-pointer ${
              eraseColor === '#ffffff'
                ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
            }`}
          >
            {isFa ? 'سفید' : 'White'}
          </button>

          <button
            type="button"
            onClick={() => setEraseColor(null)}
            className={`rounded-lg border px-2 py-1 text-[11px] cursor-pointer ${
              eraseColor === null
                ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
            }`}
          >
            {isFa ? 'حذف شفاف' : 'Transparent'}
          </button>
        </div>
      </div>

      {/* Pending marquee confirmation */}
      {erasePending && (
        <div
          data-erase-pending
          className="rounded-lg border border-sky-300 bg-sky-50 p-2.5 text-[11px] dark:border-sky-600/60 dark:bg-sky-950/50"
        >
          <div className="mb-2 font-semibold text-sky-900 dark:text-sky-100">
            {isFa
              ? 'ناحیه انتخاب شد — کلید Delete را بزنید یا اعمال کنید:'
              : 'Region selected — press Delete or Apply:'}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-erase-apply
              onClick={commitErasePending}
              className="flex flex-1 items-center justify-center gap-1 rounded-md bg-sky-600 px-2.5 py-1.5 font-bold text-white hover:bg-sky-500 cursor-pointer"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isFa ? 'پاک کردن ناحیه' : 'Apply Erase'}</span>
            </button>
            <button
              type="button"
              data-erase-discard
              onClick={() => setErasePending(null)}
              className="flex items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isFa ? 'لغو' : 'Cancel'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Undo & Restore history */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          data-erase-undo
          disabled={shapes.length === 0}
          onClick={undoLastShape}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{isFa ? 'واگرد آخرین ضربه' : 'Undo Stroke'}</span>
        </button>

        <button
          type="button"
          data-erase-restore
          disabled={shapes.length === 0}
          onClick={restoreAll}
          className="flex items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-40 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300 dark:hover:bg-rose-900/50 cursor-pointer"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{isFa ? 'بازگشت کامل' : 'Restore All'}</span>
        </button>
      </div>

      {shapes.length > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
          <Eraser className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            {isFa
              ? `${formatLocalizedNumber(shapes.length, settings.language)} برش/ضربه روی تصویر اصلی محفوظ است.`
              : `${shapes.length} non-destructive erase mark(s) active.`}
          </span>
        </div>
      )}
    </div>
  );
};
