import type { MarginsMm, MeasurementUnit } from '@shared/models';
import { convertMmToUnit } from './layoutEngine';
import { clampMarginsToMin } from './sheetInteraction';

export type MarginPresetId =
  | 'last-custom'
  | 'hardware'
  | 'normal'
  | 'narrow'
  | 'moderate'
  | 'wide';

export interface MarginPresetOption {
  id: MarginPresetId;
  titleFa: string;
  titleEn: string;
  /** Raw preset margins in mm before hardware clamping (null if hardware margins are unavailable). */
  rawMarginsMm: MarginsMm | null;
  /** Effective margins in mm clamped to the active printer's minimum printable boundary. */
  marginsMm: MarginsMm | null;
  /** True when hardware minimum margins raised one or more sides of the preset. */
  clampedToHardware: boolean;
  /** True when the preset can be applied right now. */
  available: boolean;
}

/** Fallback shown for "Last Custom Settings" before the user makes their first custom margin edit. */
export const DEFAULT_LAST_CUSTOM_MARGINS_MM: MarginsMm = {
  top: 4,
  bottom: 4,
  left: 21,
  right: 42,
};

export const BUILTIN_MARGIN_PRESETS_MM: Record<
  Exclude<MarginPresetId, 'last-custom' | 'hardware'>,
  { titleFa: string; titleEn: string; marginsMm: MarginsMm }
> = {
  normal: {
    titleFa: 'معمولی (Normal)',
    titleEn: 'Normal',
    marginsMm: { top: 20, bottom: 20, left: 30, right: 15 },
  },
  narrow: {
    titleFa: 'باریک (Narrow)',
    titleEn: 'Narrow',
    marginsMm: { top: 13, bottom: 13, left: 13, right: 13 },
  },
  moderate: {
    titleFa: 'متوسط (Moderate)',
    titleEn: 'Moderate',
    marginsMm: { top: 25, bottom: 25, left: 19, right: 19 },
  },
  wide: {
    titleFa: 'پهن (Wide)',
    titleEn: 'Wide',
    marginsMm: { top: 25, bottom: 25, left: 51, right: 51 },
  },
};

export function marginsRoughlyEqual(a: MarginsMm, b: MarginsMm, eps = 0.05): boolean {
  return (
    Math.abs(a.top - b.top) <= eps &&
    Math.abs(a.right - b.right) <= eps &&
    Math.abs(a.bottom - b.bottom) <= eps &&
    Math.abs(a.left - b.left) <= eps
  );
}

export function formatMarginValue(mm: number, unit: MeasurementUnit): string {
  const value = unit === 'mm' ? Number(mm.toFixed(2)) : convertMmToUnit(mm, unit);
  const suffix = unit === 'inch' ? 'in' : unit;
  return `${value} ${suffix}`;
}

export function buildMarginPresets(options: {
  lastCustomMarginsMm: MarginsMm | null;
  minMargins?: MarginsMm;
  hardwareAvailable: boolean;
}): MarginPresetOption[] {
  const { lastCustomMarginsMm, minMargins, hardwareAvailable } = options;

  const clampAndCheck = (raw: MarginsMm): { clamped: MarginsMm; didClamp: boolean } => {
    const clamped = clampMarginsToMin(raw, minMargins);
    return {
      clamped,
      didClamp: !marginsRoughlyEqual(raw, clamped, 0.01),
    };
  };

  const lastCustomRaw = lastCustomMarginsMm ?? DEFAULT_LAST_CUSTOM_MARGINS_MM;
  const lastCustomResolved = clampAndCheck(lastCustomRaw);

  const hardwareRaw = hardwareAvailable && minMargins ? { ...minMargins } : null;

  const list: MarginPresetOption[] = [
    {
      id: 'last-custom',
      titleFa: 'آخرین تنظیمات دلخواه',
      titleEn: 'Last Custom Settings',
      rawMarginsMm: lastCustomRaw,
      marginsMm: lastCustomResolved.clamped,
      clampedToHardware: lastCustomResolved.didClamp,
      available: true,
    },
    {
      id: 'hardware',
      titleFa: 'حاشیه سخت‌افزاری پرینتر',
      titleEn: 'Hardware Margins',
      rawMarginsMm: hardwareRaw,
      marginsMm: hardwareRaw,
      clampedToHardware: false,
      available: Boolean(hardwareRaw),
    },
  ];

  for (const id of ['normal', 'narrow', 'moderate', 'wide'] as const) {
    const def = BUILTIN_MARGIN_PRESETS_MM[id];
    const resolved = clampAndCheck(def.marginsMm);
    list.push({
      id,
      titleFa: def.titleFa,
      titleEn: def.titleEn,
      rawMarginsMm: def.marginsMm,
      marginsMm: resolved.clamped,
      clampedToHardware: resolved.didClamp,
      available: true,
    });
  }

  return list;
}
