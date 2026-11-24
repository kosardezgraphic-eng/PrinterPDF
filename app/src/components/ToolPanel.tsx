import React, { useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Hash,
  ImagePlus,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { t } from '../i18n/translations';
import { resolvePrinterMinMargins } from '../engine/sheetInteraction';
import { SHAPE_TYPES } from '../engine/shapes';
import { ToolButton } from './ToolButton';
import { Ribbon } from './Ribbon';
import { MarginPresetsMenu } from './MarginPresetsMenu';
import { CrossMarginWidget } from './CrossMarginWidget';
import { TextControlPanel } from './TextControlPanel';
import { NumberingControlPanel } from './NumberingControlPanel';
import { ImageControlPanel } from './ImageControlPanel';
import { ShapeControlPanel } from './ShapeControlPanel';
import { ShapePreview, shapeLabel } from './ShapePreview';
import { EraserControlPanel } from './EraserControlPanel';
import { WatermarkControlPanel } from './WatermarkControlPanel';
import { BookletControlPanel } from './BookletControlPanel';

export const ToolPanel: React.FC = () => {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const {
    settings,
    pages,
    layout,
    overlays,
    pageNumbering,
    selectedOverlayId,
    printers,
    selectedPrinterName,
    printerMargins,
    activeInspectorTool,
    inspectorCollapsed,
    setActiveInspectorTool,
    setInspectorCollapsed,
    setRibbonCollapsed,
    selectOverlay,
    addNumberingOverlay,
    updatePageNumbering,
    addImageOverlayFiles,
    addShapeOverlay,
    updateMargins,
    updateLayout,
    resetMarginsToPrinter,
    refreshPrinterMargins,
    openPageSetup,
  } = useAppStore();

  const lang = settings.language;
  const isFa = lang === 'fa';
  const tr = t(lang);

  const selectedOverlay = selectedOverlayId
    ? overlays.find((item) => item.id === selectedOverlayId)
    : undefined;
  const numberingOverlays = overlays.filter((o) => o.kind === 'numbering');
  const imageOverlays = overlays.filter((o) => o.kind === 'image');
  const shapeOverlays = overlays.filter((o) => o.kind === 'shape');

  const selectedPrinter = printers.find((p) => p.name === selectedPrinterName);
  const marginMinimums = resolvePrinterMinMargins(printerMargins, selectedPrinter) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };

  const title = tr.shell.inspector[activeInspectorTool] ?? tr.shell.toolPanel;

  const renderInspectorBody = () => {
    if (
      activeInspectorTool === 'file' ||
      activeInspectorTool === 'layout' ||
      activeInspectorTool === 'effects' ||
      activeInspectorTool === 'crop' ||
      activeInspectorTool === 'pdf' ||
      activeInspectorTool === 'batch' ||
      activeInspectorTool === 'printers' ||
      activeInspectorTool === 'view'
    ) {
      return (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Ribbon
            panelMode
            onOpenWatermarkPanel={() => setActiveInspectorTool('watermark')}
            onOpenBookletPanel={() => setActiveInspectorTool('booklet')}
          />
        </div>
      );
    }

    if (activeInspectorTool === 'margins') {
      return (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-600 dark:text-slate-300">
              {isFa ? 'پریست حاشیه و شیرازه' : 'Margin Presets & Gutters'}
            </span>
            <MarginPresetsMenu compact />
          </div>

          <CrossMarginWidget
            language={lang}
            margins={layout.marginsMm}
            minimums={marginMinimums}
            step={layout.booklet?.enabled ? 0.5 : 1}
            horizontalGutterMm={
              layout.booklet?.enabled ? layout.booklet.spineWidthMm : layout.horizontalGutterMm
            }
            verticalGutterMm={layout.booklet?.enabled ? 0 : layout.verticalGutterMm}
            bookletEnabled={!!layout.booklet?.enabled}
            onMarginChange={(side, value) =>
              updateMargins({ [side]: Math.max(marginMinimums[side], Math.min(200, value)) })
            }
            onGutterChange={(field, value) => {
              if (layout.booklet?.enabled && field === 'horizontalGutterMm') {
                updateLayout({
                  booklet: { ...layout.booklet, spineWidthMm: Math.min(30, value) },
                });
              } else {
                updateLayout({ [field]: value });
              }
            }}
          />

          <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                {isFa ? 'حاشیه سخت‌افزاری پرینتر' : 'Hardware Printable Margins'}
              </span>
              <button
                type="button"
                onClick={refreshPrinterMargins}
                title={isFa ? 'به‌روزرسانی از درایور' : 'Refresh from driver'}
                className="rounded border border-slate-200 bg-slate-50 p-1 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
            <div dir="ltr" className="text-[11px] font-mono text-slate-600 dark:text-slate-300 tabular-nums">
              {printerMargins.status === 'available'
                ? `T:${printerMargins.marginsMm.top} · R:${printerMargins.marginsMm.right} · B:${printerMargins.marginsMm.bottom} · L:${printerMargins.marginsMm.left} mm`
                : printerMargins.status === 'loading'
                  ? (isFa ? 'در حال خواندن حاشیه‌های پرینتر...' : 'Loading printer margins...')
                  : isFa
                    ? 'نامشخص در درایور فعلی — مقادیر فعلی تأییدنشده‌اند'
                    : 'Unavailable from current driver — current values are unverified'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={printerMargins.status !== 'available'}
                title={isFa ? 'بازنشانی حاشیه شیت به حاشیه‌های پرینتر انتخاب‌شده' : 'Reset sheet margins to selected printer margins'}
                onClick={resetMarginsToPrinter}
                className="flex flex-1 items-center justify-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-45 dark:bg-emerald-600/15 dark:text-emerald-300 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                <span>{isFa ? 'بازنشانی حاشیه پرینتر' : 'Reset printer margins'}</span>
              </button>
              <button
                type="button"
                onClick={() => openPageSetup('margins')}
                className="flex items-center justify-center gap-1 rounded-md border border-sky-500/40 bg-sky-50 px-2.5 py-1.5 text-[11px] font-semibold text-sky-700 hover:bg-sky-100 dark:bg-sky-500/15 dark:text-sky-300 cursor-pointer"
              >
                <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                <span>{isFa ? 'تنظیمات کامل...' : 'Page Setup...'}</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (activeInspectorTool === 'text') {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TextControlPanel />
        </div>
      );
    }

    if (activeInspectorTool === 'numbering') {
      if (selectedOverlay?.kind === 'numbering') {
        return (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NumberingControlPanel />
          </div>
        );
      }
      return (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs">
          <p className="text-slate-600 dark:text-slate-400">
            {isFa
              ? 'یک شمارنده صفحه جدید اضافه کنید یا یکی از شمارنده‌های موجود را برای ویرایش انتخاب کنید.'
              : 'Add a new editable page number or select an existing numbering overlay to edit.'}
          </p>
          <button
            type="button"
            disabled={!pages.length}
            onClick={() => addNumberingOverlay(false)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 font-bold text-white hover:bg-sky-500 disabled:opacity-45 cursor-pointer"
          >
            <Hash className="h-4 w-4" aria-hidden="true" />
            <span>{isFa ? 'افزودن شماره صفحه' : 'Add Page Number'}</span>
          </button>
          <div className="rounded-lg border border-slate-200 bg-white p-2 space-y-2 dark:border-slate-700 dark:bg-slate-800/70">
            <label className="flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                aria-label={isFa ? 'شماره‌گذاری قدیمی (خروجی ثابت)' : 'Legacy numbering (fixed output only)'}
                checked={pageNumbering.enabled}
                onChange={(e) => updatePageNumbering({ enabled: e.target.checked })}
                className="accent-sky-500"
              />
              <span>{isFa ? 'شماره‌گذاری قدیمی (Page / Bates)' : 'Page / Bates (fixed output)'}</span>
            </label>
            {pageNumbering.enabled && (
              <button
                type="button"
                disabled={!pages.length}
                onClick={() => addNumberingOverlay(true)}
                className="w-full rounded border border-amber-400 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-45 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300 cursor-pointer"
              >
                {isFa ? 'تبدیل شماره‌گذاری قدیمی به قابل ویرایش' : 'Convert legacy numbering to editable'}
              </button>
            )}
          </div>
          {numberingOverlays.length > 0 && (
            <div className="space-y-1">
              {numberingOverlays.map((num, idx) => (
                <button
                  key={num.id}
                  type="button"
                  onClick={() => selectOverlay(num.id)}
                  className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-start hover:border-sky-400 dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
                >
                  <span>{isFa ? `شماره ${idx + 1}` : `Number ${idx + 1}`}</span>
                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                    {num.template}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (activeInspectorTool === 'image') {
      if (selectedOverlay?.kind === 'image') {
        return (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ImageControlPanel />
          </div>
        );
      }
      return (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*,.tif,.tiff,.psd,.webp,.heic,.heif,.bmp,.svg"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              if (files.length) void addImageOverlayFiles(files);
              e.target.value = '';
            }}
          />
          <p className="text-slate-600 dark:text-slate-400">
            {isFa
              ? 'یک تصویر روی صفحه درج کنید (یا فایل تصویر را مستقیم روی برگه رها کنید).'
              : 'Insert an image overlay onto the sheet, or drop an image file straight onto a sheet.'}
          </p>
          <button
            type="button"
            disabled={!pages.length}
            onClick={() => imageInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 font-bold text-white hover:bg-emerald-500 disabled:opacity-45 cursor-pointer"
          >
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            <span>{isFa ? 'افزودن تصویر روی صفحه' : 'Add Picture Overlay'}</span>
          </button>
          {imageOverlays.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {isFa ? 'تصویرهای موجود:' : 'Existing pictures:'}
              </div>
              {imageOverlays.map((img, idx) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => selectOverlay(img.id)}
                  className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-start hover:border-sky-400 dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
                >
                  <span className="truncate">{img.name || (isFa ? `تصویر ${idx + 1}` : `Picture ${idx + 1}`)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (activeInspectorTool === 'shape') {
      if (selectedOverlay?.kind === 'shape') {
        return (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ShapeControlPanel />
          </div>
        );
      }
      return (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs">
          <p className="text-slate-600 dark:text-slate-400">
            {isFa
              ? 'شکل هندسی مورد نظر را برای درج در صفحه انتخاب کنید:'
              : 'Pick a geometric shape to insert onto the active sheet:'}
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {SHAPE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                disabled={!pages.length}
                title={shapeLabel(type, isFa)}
                aria-label={shapeLabel(type, isFa)}
                onClick={() => addShapeOverlay(type)}
                className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-700 hover:border-sky-400 hover:bg-sky-50 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                <ShapePreview type={type} size={20} />
              </button>
            ))}
          </div>
          {shapeOverlays.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {isFa ? 'اشکال درج‌شده:' : 'Inserted shapes:'}
              </div>
              {shapeOverlays.map((sh, idx) => (
                <button
                  key={sh.id}
                  type="button"
                  onClick={() => selectOverlay(sh.id)}
                  className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-start hover:border-sky-400 dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
                >
                  <ShapePreview type={sh.type} size={14} shape={sh} />
                  <span>
                    {shapeLabel(sh.type, isFa)} #{idx + 1}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (activeInspectorTool === 'eraser') {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EraserControlPanel />
        </div>
      );
    }

    if (activeInspectorTool === 'watermark') {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WatermarkControlPanel onClose={() => setActiveInspectorTool('layout')} />
        </div>
      );
    }

    if (activeInspectorTool === 'booklet') {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <BookletControlPanel onClose={() => setActiveInspectorTool('layout')} />
        </div>
      );
    }

    return null;
  };

  return (
    <aside
      dir={isFa ? 'rtl' : 'ltr'}
      className={`psp-tool-panel ${inspectorCollapsed ? 'psp-tool-panel--collapsed' : ''}`}
      aria-label={tr.shell.toolPanel}
      data-tool-panel
      data-active-inspector={activeInspectorTool}
    >
      {inspectorCollapsed ? (
        <div className="flex h-full flex-col items-center py-2">
          <ToolButton
            icon={<ChevronLeft className="h-4 w-4" />}
            label={isFa ? 'باز کردن پنل تنظیمات' : 'Expand Inspector'}
            size="sm"
            onClick={() => {
              setInspectorCollapsed(false);
              setRibbonCollapsed(false);
            }}
          />
        </div>
      ) : (
        <>
          <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-950/80">
            <h2 className="min-w-0 truncate text-xs font-bold text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            <ToolButton
              icon={<ChevronRight className="h-4 w-4" />}
              label={tr.shell.collapseToolPanel}
              size="sm"
              onClick={() => setInspectorCollapsed(true)}
            />
          </header>
          {renderInspectorBody()}
        </>
      )}
    </aside>
  );
};
