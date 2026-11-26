import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, PanelsTopLeft, SlidersHorizontal, Star } from 'lucide-react';
import type { MarginsMm } from '@shared/models';
import { useAppStore } from '../store/useAppStore';
import {
  buildMarginPresets,
  formatMarginValue,
  marginsRoughlyEqual,
  type MarginPresetId,
} from '../engine/marginPresets';
import { resolvePrinterMinMargins } from '../engine/sheetInteraction';

function MarginPresetThumbnail({
  presetId,
  marginsMm,
  active,
}: {
  presetId: MarginPresetId;
  marginsMm: MarginsMm | null;
  active: boolean;
}) {
  const m = marginsMm ?? { top: 4, right: 4, bottom: 4, left: 4 };
  // Scale margins into a 34×44 miniature page schematic, keeping lines distinct & readable
  const clampFrac = (mm: number) => Math.max(3, Math.min(13, 2.5 + mm * 0.18));
  const topY = clampFrac(m.top);
  const bottomY = 44 - clampFrac(m.bottom);
  const leftX = clampFrac(m.left);
  const rightX = 34 - clampFrac(m.right);

  const lineColor =
    presetId === 'hardware'
      ? '#f97316'
      : active
        ? '#0284c7'
        : '#94a3b8';

  return (
    <div
      className={`relative flex h-11 w-[34px] shrink-0 items-center justify-center rounded-[2px] border bg-white dark:bg-slate-950/90 ${
        active
          ? 'border-sky-500 shadow-[0_0_0_1px_rgba(14,165,233,0.35)] dark:border-sky-400 dark:shadow-[0_0_0_1px_rgba(56,189,248,0.35)]'
          : presetId === 'hardware'
            ? 'border-orange-500/60'
            : 'border-slate-300 dark:border-slate-600'
      }`}
    >
      <svg
        width="34"
        height="44"
        viewBox="0 0 34 44"
        aria-hidden="true"
        className="block h-full w-full"
      >
        <line x1="0" y1={topY} x2="34" y2={topY} stroke={lineColor} strokeWidth="1" />
        <line x1="0" y1={bottomY} x2="34" y2={bottomY} stroke={lineColor} strokeWidth="1" />
        <line x1={leftX} y1="0" x2={leftX} y2="44" stroke={lineColor} strokeWidth="1" />
        <line x1={rightX} y1="0" x2={rightX} y2="44" stroke={lineColor} strokeWidth="1" />
      </svg>
      {presetId === 'last-custom' && (
        <Star
          className="absolute h-3.5 w-3.5 fill-emerald-400 text-emerald-400"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

interface MarginPresetsMenuProps {
  compact?: boolean;
  disabled?: boolean;
}

export const MarginPresetsMenu: React.FC<MarginPresetsMenuProps> = ({
  compact = false,
  disabled = false,
}) => {
  const layout = useAppStore((state) => state.layout);
  const settings = useAppStore((state) => state.settings);
  const printers = useAppStore((state) => state.printers);
  const selectedPrinterName = useAppStore((state) => state.selectedPrinterName);
  const printerMargins = useAppStore((state) => state.printerMargins);
  const lastCustomMarginsMm = useAppStore((state) => state.lastCustomMarginsMm);
  const applyMarginPreset = useAppStore((state) => state.applyMarginPreset);
  const openPageSetup = useAppStore((state) => state.openPageSetup);

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const isFa = settings.language === 'fa';
  const activePrinter = printers.find((p) => p.name === selectedPrinterName);
  const minMargins = resolvePrinterMinMargins(printerMargins, activePrinter);
  const hardwareAvailable = printerMargins.status === 'available' && Boolean(minMargins);

  const presets = buildMarginPresets({
    lastCustomMarginsMm,
    minMargins,
    hardwareAvailable,
  });

  const updateMenuPosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuWidth = 304;
    const estHeight = 420;
    const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, isFa ? rect.right - menuWidth : rect.left));
    const top =
      rect.bottom + estHeight <= window.innerHeight - 8
        ? rect.bottom + 4
        : Math.max(8, rect.top - estHeight - 4);
    setCoords({ top, left });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [open, isFa]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onResize = () => updateMenuPosition();
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <div className="relative inline-flex shrink-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        data-margin-presets-trigger
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        title={isFa ? 'پریست‌های سریع حاشیه صفحه' : 'Quick Margin Presets'}
        className={`flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 hover:border-sky-500/50 hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 ${
          compact ? 'py-1' : 'py-1.5'
        }`}
      >
        <PanelsTopLeft className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
        <span>{isFa ? 'پریست حاشیه' : 'Margins'}</span>
        <ChevronDown className="h-3 w-3 text-slate-500 dark:text-slate-400 shrink-0" aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            data-margin-presets-menu
            role="menu"
            dir={isFa ? 'rtl' : 'ltr'}
            style={{ top: coords.top, left: coords.left }}
            className="fixed z-[9998] w-[304px] overflow-hidden rounded-xl border border-slate-200 bg-white text-xs text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300">
              {isFa ? 'پریست‌های سریع حاشیه صفحه' : 'Margin Presets'}
            </div>

            <div className="max-h-[360px] overflow-y-auto p-1.5 space-y-1">
              {presets.map((preset) => {
                const isActive =
                  preset.id === 'hardware'
                    ? layout.marginMode === 'printer' &&
                      Boolean(preset.marginsMm && marginsRoughlyEqual(layout.marginsMm, preset.marginsMm))
                    : Boolean(
                        preset.marginsMm &&
                          marginsRoughlyEqual(layout.marginsMm, preset.marginsMm) &&
                          !(preset.id === 'last-custom' && layout.marginMode === 'printer')
                      );

                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="menuitem"
                    disabled={!preset.available}
                    data-margin-preset={preset.id}
                    onClick={() => {
                      applyMarginPreset(preset.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-start transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                      isActive
                        ? 'border-sky-500/60 bg-sky-50 dark:bg-sky-500/15'
                        : 'border-transparent hover:border-slate-200 hover:bg-slate-100 dark:hover:border-slate-700 dark:hover:bg-slate-800/80'
                    }`}
                  >
                    <MarginPresetThumbnail
                      presetId={preset.id}
                      marginsMm={preset.marginsMm}
                      active={isActive}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-bold text-slate-900 dark:text-slate-100">
                          {isFa ? preset.titleFa : preset.titleEn}
                        </span>
                        {preset.clampedToHardware && (
                          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-300 shrink-0">
                            {isFa ? 'محدود به پرینتر' : 'Min clamped'}
                          </span>
                        )}
                      </div>
                      {preset.marginsMm ? (
                        <div
                          dir="ltr"
                          className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-700 dark:text-slate-300 tabular-nums"
                        >
                          <span dir={isFa ? 'rtl' : 'ltr'} className="flex justify-between gap-1">
                            <span className="text-slate-500 dark:text-slate-400">{isFa ? 'بالا:' : 'Top:'}</span>
                            <span dir="ltr">{formatMarginValue(preset.marginsMm.top, settings.unit)}</span>
                          </span>
                          <span dir={isFa ? 'rtl' : 'ltr'} className="flex justify-between gap-1">
                            <span className="text-slate-500 dark:text-slate-400">{isFa ? 'پایین:' : 'Bottom:'}</span>
                            <span dir="ltr">{formatMarginValue(preset.marginsMm.bottom, settings.unit)}</span>
                          </span>
                          <span dir={isFa ? 'rtl' : 'ltr'} className="flex justify-between gap-1">
                            <span className="text-slate-500 dark:text-slate-400">{isFa ? 'چپ:' : 'Left:'}</span>
                            <span dir="ltr">{formatMarginValue(preset.marginsMm.left, settings.unit)}</span>
                          </span>
                          <span dir={isFa ? 'rtl' : 'ltr'} className="flex justify-between gap-1">
                            <span className="text-slate-500 dark:text-slate-400">{isFa ? 'راست:' : 'Right:'}</span>
                            <span dir="ltr">{formatMarginValue(preset.marginsMm.right, settings.unit)}</span>
                          </span>
                        </div>
                      ) : (
                        <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-300/80">
                          {isFa
                            ? 'حاشیه سخت‌افزاری پرینتر فعلاً در دسترس نیست'
                            : 'Printer hardware margins unavailable'}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-1.5 dark:border-slate-800 dark:bg-slate-950/60">
              <button
                type="button"
                role="menuitem"
                data-margin-preset-custom
                onClick={() => {
                  setOpen(false);
                  openPageSetup('margins');
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start font-semibold text-sky-700 hover:bg-slate-100 dark:text-sky-300 dark:hover:bg-slate-800 cursor-pointer"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{isFa ? 'حاشیه‌های دلخواه...' : 'Custom Margins...'}</span>
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
