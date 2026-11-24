/**
 * PrintStudio Pro — Offset Prepress & Lithography Color Management Engine
 *
 * Implements:
 * - Standard offset press profiles (FOGRA39, FOGRA51, GRACoL, SWOP)
 * - Custom ICC (.icc / .icm) binary profile parser (header, desc, wtpt, PCS/Device validation)
 * - Rendering Intent + Black Point Compensation (BPC)
 * - GCR / UCR gray replacement + Total Ink Coverage (TAC) limiting
 * - Offset Black Rule (small black text -> 100% K only, Pure Black vs Rich Black)
 * - Spot Color alternate CMYK lookup & Keep-Spot vs Convert-to-CMYK logic
 * - Pixel separation buffers, Overprint vs Knockout compositing, and Ink Coverage Inspection
 */

import type {
  LithoColorSettings,
  LithoCustomIccProfile,
  LithoExportSettings,
  LithoGcrLevel,
  LithoIccProfileId,
  LithoJobPreset,
  LithoPlateSizePreset,
  LithoSpotChannel,
} from '@shared/models';

export interface OffsetProfileSpec {
  id: Exclude<LithoIccProfileId, 'custom'>;
  titleFa: string;
  titleEn: string;
  standardName: string;
  defaultTacPercent: number;
  maxBlackStart: number;
  dotGainPercent50: number;
  /** RGB chromaticity/ink absorption tuning for press soft-proofing */
  cyanTint: [number, number, number];
  magentaTint: [number, number, number];
  yellowTint: [number, number, number];
  blackTint: [number, number, number];
  paperWhite: [number, number, number];
}

export const OFFSET_ICC_PROFILES: Record<Exclude<LithoIccProfileId, 'custom'>, OffsetProfileSpec> = {
  FOGRA39: {
    id: 'FOGRA39',
    titleFa: 'FOGRA39 (گلاسه استاندارد اروپا - ۳۰۰٪)',
    titleEn: 'ISO Coated v2 (FOGRA39 · 300% TAC)',
    standardName: 'ISO Coated v2 (ECI)',
    defaultTacPercent: 300,
    maxBlackStart: 0.12,
    dotGainPercent50: 14,
    cyanTint: [0, 159, 227],
    magentaTint: [229, 0, 125],
    yellowTint: [255, 237, 0],
    blackTint: [26, 25, 25],
    paperWhite: [253, 252, 249],
  },
  FOGRA51: {
    id: 'FOGRA51',
    titleFa: 'FOGRA51 (گلاسه جدید روشن‌تر - ۳۰۰٪)',
    titleEn: 'PSO Coated v3 (FOGRA51 · 300% TAC)',
    standardName: 'PSO Coated v3',
    defaultTacPercent: 300,
    maxBlackStart: 0.1,
    dotGainPercent50: 16,
    cyanTint: [0, 162, 232],
    magentaTint: [232, 0, 127],
    yellowTint: [255, 240, 5],
    blackTint: [22, 23, 26],
    paperWhite: [254, 254, 255],
  },
  GRACoL: {
    id: 'GRACoL',
    titleFa: 'GRACoL 2013 (گلاسه استاندارد آمریکا - ۳۲۰٪)',
    titleEn: 'GRACoL 2013 CRPC6 (320% TAC)',
    standardName: 'GRACoL 2013 UNC/CRPC6',
    defaultTacPercent: 320,
    maxBlackStart: 0.14,
    dotGainPercent50: 15,
    cyanTint: [0, 155, 222],
    magentaTint: [226, 12, 124],
    yellowTint: [255, 234, 0],
    blackTint: [25, 24, 24],
    paperWhite: [253, 252, 250],
  },
  SWOP: {
    id: 'SWOP',
    titleFa: 'SWOP v2 (چاپ رول / کاغذ سبک - ۳۰۰٪)',
    titleEn: 'US Web Coated (SWOP) v2 (300% TAC)',
    standardName: 'US Web Coated (SWOP) v2',
    defaultTacPercent: 300,
    maxBlackStart: 0.16,
    dotGainPercent50: 18,
    cyanTint: [0, 149, 212],
    magentaTint: [215, 22, 118],
    yellowTint: [248, 224, 18],
    blackTint: [34, 32, 32],
    paperWhite: [249, 246, 239],
  },
};

export function createDefaultLithoColorSettings(): LithoColorSettings {
  return {
    iccProfile: 'FOGRA39',
    customProfileName: undefined,
    customIcc: null,
    renderingIntent: 'relative-colorimetric',
    blackPointCompensation: true,
    maxTacPercent: 300,
    gcrLevel: 'medium',
    ucrStrengthPercent: 55,
    blackRule: {
      blackTextMaxPtToKOnly: true,
      blackTextPtThreshold: 14,
      preservePureBlack: true,
      richBlackC: 40,
      richBlackM: 30,
      richBlackY: 30,
      richBlackK: 100,
    },
    simulateOverprint: true,
    spotChannels: {},
  };
}

export function createDefaultLithoPresets(): LithoJobPreset[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'preset-fogra39-coated',
      name: 'گلاسه و کارت ویزیت استاندارد (FOGRA39 · TAC 300%)',
      createdAt: now,
      tacThresholdPercent: 300,
      autoFixOnProcess: true,
      color: {
        iccProfile: 'FOGRA39',
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        maxTacPercent: 300,
        gcrLevel: 'medium',
        ucrStrengthPercent: 55,
        blackRule: {
          blackTextMaxPtToKOnly: true,
          blackTextPtThreshold: 14,
          preservePureBlack: true,
          richBlackC: 40,
          richBlackM: 30,
          richBlackY: 30,
          richBlackK: 100,
        },
        simulateOverprint: true,
      },
      exportSettings: {
        format: 'plate-pdf',
        dpi: 1200,
        includeCropMarks: true,
        includeRegistrationMarks: true,
        includeColorBar: true,
        includeSlug: true,
        jobNamePrefix: '',
      },
    },
    {
      id: 'preset-fogra51-brochure',
      name: 'کاتالوگ و بروشور با کاغذ روشن (FOGRA51 · PDF/X-4)',
      createdAt: now,
      tacThresholdPercent: 300,
      autoFixOnProcess: true,
      color: {
        iccProfile: 'FOGRA51',
        renderingIntent: 'perceptual',
        blackPointCompensation: true,
        maxTacPercent: 300,
        gcrLevel: 'medium',
        ucrStrengthPercent: 50,
        blackRule: {
          blackTextMaxPtToKOnly: true,
          blackTextPtThreshold: 14,
          preservePureBlack: true,
          richBlackC: 35,
          richBlackM: 25,
          richBlackY: 25,
          richBlackK: 100,
        },
        simulateOverprint: true,
      },
      exportSettings: {
        format: 'pdf-x4',
        dpi: 600,
        includeCropMarks: true,
        includeRegistrationMarks: true,
        includeColorBar: true,
        includeSlug: true,
        jobNamePrefix: '',
      },
    },
    {
      id: 'preset-gracol-packaging',
      name: 'بسته‌بندی و جعبه + اسپات (GRACoL · TIFF 1-bit)',
      createdAt: now,
      tacThresholdPercent: 320,
      autoFixOnProcess: false,
      color: {
        iccProfile: 'GRACoL',
        renderingIntent: 'relative-colorimetric',
        blackPointCompensation: true,
        maxTacPercent: 320,
        gcrLevel: 'heavy',
        ucrStrengthPercent: 75,
        blackRule: {
          blackTextMaxPtToKOnly: true,
          blackTextPtThreshold: 16,
          preservePureBlack: true,
          richBlackC: 45,
          richBlackM: 35,
          richBlackY: 35,
          richBlackK: 100,
        },
        simulateOverprint: true,
      },
      exportSettings: {
        format: 'tiff-1bit',
        dpi: 1200,
        includeCropMarks: true,
        includeRegistrationMarks: true,
        includeColorBar: true,
        includeSlug: true,
        jobNamePrefix: '',
      },
    },
  ];
}

export const BUILT_IN_LITHO_PLATE_SIZES: LithoPlateSizePreset[] = [
  {
    id: 'fit-document',
    nameFa: 'هم‌اندازه سند + علائم برش (خودکار)',
    nameEn: 'Auto Fit Document + Marks',
    widthMm: 0,
    heightMm: 0,
    isBuiltIn: true,
  },
  {
    id: 'gto46',
    nameFa: 'پلیت GTO 46 (۳۷۰×۴۵۰ mm)',
    nameEn: 'GTO 46 Plate (370×450 mm)',
    widthMm: 370,
    heightMm: 450,
    isBuiltIn: true,
  },
  {
    id: 'gto52',
    nameFa: 'پلیت GTO 52 (۴۰۰×۵۱۰ mm)',
    nameEn: 'GTO 52 Plate (400×510 mm)',
    widthMm: 400,
    heightMm: 510,
    isBuiltIn: true,
  },
  {
    id: 'sm52',
    nameFa: 'پلیت هایدلبرگ SM 52 (۴۵۹×۵۲۵ mm)',
    nameEn: 'Heidelberg SM 52 Plate (459×525 mm)',
    widthMm: 459,
    heightMm: 525,
    isBuiltIn: true,
  },
  {
    id: 'kord64',
    nameFa: 'پلیت KORD 64 (۵۵۰×۶۵۰ mm)',
    nameEn: 'KORD 64 Plate (550×650 mm)',
    widthMm: 550,
    heightMm: 650,
    isBuiltIn: true,
  },
  {
    id: 'sm74',
    nameFa: 'پلیت دوورقی SM 74 (۶۰۵×۷۴۵ mm)',
    nameEn: 'Heidelberg SM 74 Plate (605×745 mm)',
    widthMm: 605,
    heightMm: 745,
    isBuiltIn: true,
  },
  {
    id: 'cd102',
    nameFa: 'پلیت چهارورقی CD 102 (۷۹۰×۱۰۳۰ mm)',
    nameEn: 'Heidelberg CD 102 Plate (790×1030 mm)',
    widthMm: 790,
    heightMm: 1030,
    isBuiltIn: true,
  },
  {
    id: 'sra3',
    nameFa: 'فرم SRA3 (۳۲۰×۴۵۰ mm)',
    nameEn: 'SRA3 Sheet (320×450 mm)',
    widthMm: 320,
    heightMm: 450,
    isBuiltIn: true,
  },
  {
    id: 'b2',
    nameFa: 'فرم دوورقی B2 (۵۰۰×۷۰۰ mm)',
    nameEn: 'B2 Sheet (500×700 mm)',
    widthMm: 500,
    heightMm: 700,
    isBuiltIn: true,
  },
];

export interface ResolvedLithoPlateSize {
  plateSizeId: string;
  isFitDocument: boolean;
  widthMm: number;
  heightMm: number;
  markPadMm: number;
}

export function resolveLithoPlateSizeMm(
  exportSettings: Pick<
    LithoExportSettings,
    | 'plateSizeId'
    | 'plateWidthMm'
    | 'plateHeightMm'
    | 'plateOrientation'
    | 'includeCropMarks'
    | 'includeRegistrationMarks'
    | 'includeColorBar'
    | 'includeSlug'
  >,
  pageWidthMm: number,
  pageHeightMm: number,
  savedSizes: LithoPlateSizePreset[] = []
): ResolvedLithoPlateSize {
  const hasMarks =
    exportSettings.includeCropMarks ||
    exportSettings.includeRegistrationMarks ||
    exportSettings.includeColorBar ||
    exportSettings.includeSlug;
  const markPadMm = hasMarks ? 24 * (25.4 / 72) : 0; // ~8.47 mm
  const id = exportSettings.plateSizeId || 'fit-document';

  if (id === 'fit-document') {
    return {
      plateSizeId: 'fit-document',
      isFitDocument: true,
      widthMm: Math.round((pageWidthMm + markPadMm * 2) * 100) / 100,
      heightMm: Math.round((pageHeightMm + markPadMm * 2) * 100) / 100,
      markPadMm,
    };
  }

  const preset = [...BUILT_IN_LITHO_PLATE_SIZES, ...savedSizes].find((p) => p.id === id);
  let rawW =
    id === 'custom'
      ? Number(exportSettings.plateWidthMm)
      : Number(exportSettings.plateWidthMm || preset?.widthMm || 0);
  let rawH =
    id === 'custom'
      ? Number(exportSettings.plateHeightMm)
      : Number(exportSettings.plateHeightMm || preset?.heightMm || 0);

  if (!Number.isFinite(rawW) || rawW < 20) rawW = preset?.widthMm || pageWidthMm + markPadMm * 2;
  if (!Number.isFinite(rawH) || rawH < 20) rawH = preset?.heightMm || pageHeightMm + markPadMm * 2;

  const orient = exportSettings.plateOrientation || 'auto';
  let wMm = rawW;
  let hMm = rawH;
  if (orient === 'portrait') {
    wMm = Math.min(rawW, rawH);
    hMm = Math.max(rawW, rawH);
  } else if (orient === 'landscape') {
    wMm = Math.max(rawW, rawH);
    hMm = Math.min(rawW, rawH);
  } else {
    // 'auto': align long side with page long side
    const pageIsLandscape = pageWidthMm > pageHeightMm;
    if (pageIsLandscape && rawH > rawW) {
      wMm = rawH;
      hMm = rawW;
    } else if (!pageIsLandscape && rawW > rawH) {
      wMm = rawH;
      hMm = rawW;
    }
  }

  return {
    plateSizeId: id,
    isFitDocument: false,
    widthMm: Math.round(wMm * 100) / 100,
    heightMm: Math.round(hMm * 100) / 100,
    markPadMm,
  };
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length && offset + i < bytes.length; i++) {
    const code = bytes[offset + i];
    if (code >= 32 && code <= 126) out += String.fromCharCode(code);
  }
  return out;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readS15Fixed16(bytes: Uint8Array, offset: number): number {
  const raw =
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3];
  return raw / 65536;
}

/**
 * Parses a standard ICC v2 / v4 (.icc / .icm) binary profile header & tags (`desc`, `wtpt`).
 */
export function parseIccProfileBytes(
  bytes: Uint8Array,
  fileName: string
): LithoCustomIccProfile {
  if (!bytes || bytes.length < 132) {
    throw new Error('فایل ICC معتبر نیست (حجم فایل کمتر از سرآیند استاندارد ۱۲۸ بایت است).');
  }
  const signature = readAscii(bytes, 36, 4);
  if (signature !== 'acsp') {
    throw new Error('امضای استاندارد ICC (acsp) در فایل یافت نشد.');
  }

  const versionMajor = bytes[8];
  const versionMinor = (bytes[9] >> 4) & 0x0f;
  const rawColorSpace = readAscii(bytes, 16, 4).trim();
  const pcs = readAscii(bytes, 20, 4).trim() || 'XYZ';
  const colorSpace: LithoCustomIccProfile['colorSpace'] =
    rawColorSpace === 'CMYK' ? 'CMYK' : rawColorSpace === 'RGB' ? 'RGB' : 'UNKNOWN';

  const tagCount = Math.min(256, readUint32BE(bytes, 128));
  let description = fileName.replace(/\.(icc|icm)$/i, '');
  let whitePoint: [number, number, number] | undefined;

  for (let i = 0; i < tagCount; i++) {
    const entryOffset = 132 + i * 12;
    if (entryOffset + 12 > bytes.length) break;
    const tagSig = readAscii(bytes, entryOffset, 4);
    const tagOffset = readUint32BE(bytes, entryOffset + 4);
    const tagSize = readUint32BE(bytes, entryOffset + 8);
    if (tagOffset + tagSize > bytes.length || tagSize < 12) continue;

    if (tagSig === 'desc') {
      const tagType = readAscii(bytes, tagOffset, 4);
      if (tagType === 'desc' && tagSize >= 12) {
        const strLen = readUint32BE(bytes, tagOffset + 8);
        const rawDesc = readAscii(bytes, tagOffset + 12, Math.min(strLen, tagSize - 12)).trim();
        if (rawDesc) description = rawDesc;
      } else if (tagType === 'mluc' && tagSize >= 28) {
        const recSize = readUint32BE(bytes, tagOffset + 20);
        const recOffset = readUint32BE(bytes, tagOffset + 24);
        const start = tagOffset + recOffset;
        let decoded = '';
        for (let p = 0; p + 1 < recSize && start + p + 1 < bytes.length; p += 2) {
          const code = (bytes[start + p] << 8) | bytes[start + p + 1];
          if (code >= 32 && code <= 126) decoded += String.fromCharCode(code);
        }
        if (decoded.trim()) description = decoded.trim();
      }
    } else if (tagSig === 'wtpt' && tagSize >= 20) {
      whitePoint = [
        Math.round(readS15Fixed16(bytes, tagOffset + 8) * 1000) / 1000,
        Math.round(readS15Fixed16(bytes, tagOffset + 12) * 1000) / 1000,
        Math.round(readS15Fixed16(bytes, tagOffset + 16) * 1000) / 1000,
      ];
    }
  }

  return {
    id: `icc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: description || fileName,
    fileName,
    colorSpace,
    pcs,
    version: `${versionMajor}.${versionMinor}`,
    description,
    whitePoint,
    tacDefault: colorSpace === 'CMYK' ? 300 : 300,
    rawBytes: new Uint8Array(bytes),
  };
}

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function clamp255(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}

function gcrFactorFromLevel(level: LithoGcrLevel, ucrPercent: number): number {
  const ucrBias = Math.max(0, Math.min(1, ucrPercent / 100));
  switch (level) {
    case 'none':
      return 0;
    case 'light':
      return 0.28 + ucrBias * 0.12;
    case 'medium':
      return 0.52 + ucrBias * 0.16;
    case 'heavy':
      return 0.76 + ucrBias * 0.14;
    case 'max-k':
      return 0.94;
  }
}

export function resolveActiveProfileSpec(settings: LithoColorSettings): OffsetProfileSpec {
  if (settings.iccProfile === 'custom') {
    return {
      ...OFFSET_ICC_PROFILES.FOGRA39,
      standardName: settings.customIcc?.description || settings.customProfileName || 'Custom ICC',
      defaultTacPercent: settings.maxTacPercent || settings.customIcc?.tacDefault || 300,
    };
  }
  return OFFSET_ICC_PROFILES[settings.iccProfile] ?? OFFSET_ICC_PROFILES.FOGRA39;
}

/**
 * Limits CMYK values [0..100] so C+M+Y+K <= maxTacPercent using GCR replacement before chromatic scaling.
 */
export function applyTacLimitAndGcr(
  cPct: number,
  mPct: number,
  yPct: number,
  kPct: number,
  settings: LithoColorSettings
): [number, number, number, number] {
  let c = Math.max(0, Math.min(100, cPct));
  let m = Math.max(0, Math.min(100, mPct));
  let y = Math.max(0, Math.min(100, yPct));
  let k = Math.max(0, Math.min(100, kPct));

  // Pure black preservation rule: exact K-only inputs stay strictly on K plate
  if (settings.blackRule.preservePureBlack && c < 0.8 && m < 0.8 && y < 0.8) {
    return [0, 0, 0, Math.min(100, Math.round(k * 10) / 10)];
  }

  const maxTac = Math.max(200, Math.min(400, settings.maxTacPercent || 300));
  const total = c + m + y + k;
  if (total <= maxTac) {
    return [c, m, y, k];
  }

  // First replace gray component of CMY into K where capacity permits (saves colored ink & preserves shadow depth)
  const gray = Math.min(c, m, y);
  if (gray > 0 && k < 100) {
    const gcrGain = Math.max(0.35, gcrFactorFromLevel(settings.gcrLevel, settings.ucrStrengthPercent));
    const roomK = 100 - k;
    const shift = Math.min(gray * gcrGain, roomK, (total - maxTac) / 2);
    if (shift > 0) {
      c = Math.max(0, c - shift);
      m = Math.max(0, m - shift);
      y = Math.max(0, y - shift);
      k = Math.min(100, k + shift);
    }
  }

  // If TAC still exceeds threshold, proportionally reduce CMY while guarding K backbone
  const afterGcrTotal = c + m + y + k;
  if (afterGcrTotal > maxTac) {
    const cmySum = c + m + y;
    const allowedCmy = Math.max(0, maxTac - k);
    if (cmySum > 0.001) {
      const scale = Math.max(0, allowedCmy / cmySum);
      c *= scale;
      m *= scale;
      y *= scale;
    } else {
      k = Math.min(100, maxTac);
    }
  }

  return [
    Math.round(c * 10) / 10,
    Math.round(m * 10) / 10,
    Math.round(y * 10) / 10,
    Math.round(k * 10) / 10,
  ];
}

/**
 * Converts sRGB (0..255) to offset CMYK percentages [0..100] under the selected ICC profile,
 * Rendering Intent, Black Point Compensation, GCR/UCR, Black Rule, and TAC ceiling.
 */
export function convertRgbToCmyk(
  r255: number,
  g255: number,
  b255: number,
  settings: LithoColorSettings
): [number, number, number, number] {
  const profile = resolveActiveProfileSpec(settings);

  let r = clamp01(r255 / 255);
  let g = clamp01(g255 / 255);
  let b = clamp01(b255 / 255);

  // Near-white paper guard: avoids micro 1% dot tinting on pure white backgrounds
  if (r > 0.992 && g > 0.992 && b > 0.992) {
    return [0, 0, 0, 0];
  }

  // Pure neutral dark/black rule: keep neutral grays & black crisp on K plate when near neutral
  const maxRgb = Math.max(r, g, b);
  const minRgb = Math.min(r, g, b);
  const chroma = maxRgb - minRgb;
  if (settings.blackRule.preservePureBlack && chroma < 0.018 && maxRgb < 0.92) {
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const kPure = Math.min(100, Math.max(0, (1 - luma) * 100));
    if (luma < 0.06) {
      // Very dark near-black pixel: pure 100% K (unless rich black needed elsewhere)
      return [0, 0, 0, Math.round(kPure * 10) / 10];
    }
  }

  // Black Point Compensation (maps black point cleanly to press K depth)
  if (settings.blackPointCompensation) {
    const pressMin = 0.032;
    r = pressMin + r * (1 - pressMin);
    g = pressMin + g * (1 - pressMin);
    b = pressMin + b * (1 - pressMin);
  }

  // Rendering intent gamut adaptation
  if (settings.renderingIntent === 'perceptual') {
    const gamma = 0.96;
    r = Math.pow(r, gamma);
    g = Math.pow(g, gamma);
    b = Math.pow(b, gamma);
  } else if (settings.renderingIntent === 'saturation') {
    const mid = (r + g + b) / 3;
    const boost = 1.14;
    r = clamp01(mid + (r - mid) * boost);
    g = clamp01(mid + (g - mid) * boost);
    b = clamp01(mid + (b - mid) * boost);
  } else if (settings.renderingIntent === 'absolute-colorimetric') {
    // Slight warm paper cast from profile paperWhite
    r *= profile.paperWhite[0] / 255;
    g *= profile.paperWhite[1] / 255;
    b *= profile.paperWhite[2] / 255;
  }

  // Base CMY subtraction + slight press dot-gain compensation
  const dg = 1 + (profile.dotGainPercent50 - 14) * 0.004;
  let c0 = clamp01(Math.pow(1 - r, dg));
  let m0 = clamp01(Math.pow(1 - g, dg));
  let y0 = clamp01(Math.pow(1 - b, dg));

  // Cross-contamination matrix matching real offset inks (e.g. Cyan ink always absorbs slightly in green/red; Magenta has yellow cast)
  let c = clamp01(c0 * 0.96 - m0 * 0.04 - y0 * 0.02);
  let m = clamp01(m0 * 0.95 - c0 * 0.03 + y0 * 0.04);
  let y = clamp01(y0 * 0.97 + m0 * 0.03);

  const gray = Math.min(c, m, y);
  const gcrStrength = gcrFactorFromLevel(settings.gcrLevel, settings.ucrStrengthPercent);

  let k = 0;
  if (gray > profile.maxBlackStart) {
    const activeGray = (gray - profile.maxBlackStart) / (1 - profile.maxBlackStart);
    k = clamp01(Math.pow(activeGray, 1.05) * (0.45 + gcrStrength * 0.55));
    const subtract = k * (0.68 + gcrStrength * 0.32);
    c = clamp01(c - subtract);
    m = clamp01(m - subtract);
    y = clamp01(y - subtract);
  } else if (settings.gcrLevel === 'max-k' && gray > 0.02) {
    k = gray;
    c = clamp01(c - gray);
    m = clamp01(m - gray);
    y = clamp01(y - gray);
  }

  return applyTacLimitAndGcr(c * 100, m * 100, y * 100, k * 100, settings);
}

/**
 * Known Spot / Pantone alternate CMYK definitions common in Iranian commercial & packaging print shops.
 */
const KNOWN_SPOT_DATABASE: Array<{
  pattern: RegExp;
  cmyk: [number, number, number, number];
  hex: string;
}> = [
  { pattern: /185|red|crimson/i, cmyk: [0, 96, 82, 0], hex: '#e4002b' },
  { pattern: /485/i, cmyk: [0, 95, 100, 0], hex: '#da291c' },
  { pattern: /reflex\s*blue/i, cmyk: [100, 82, 0, 2], hex: '#001489' },
  { pattern: /286|cobalt/i, cmyk: [100, 68, 0, 12], hex: '#0033a0' },
  { pattern: /process\s*blue/i, cmyk: [100, 12, 0, 0], hex: '#0085ca' },
  { pattern: /347|348|green/i, cmyk: [93, 0, 88, 0], hex: '#009a44' },
  { pattern: /871|gold|tala/i, cmyk: [25, 38, 72, 22], hex: '#8b734b' },
  { pattern: /877|silver|noghreh/i, cmyk: [22, 16, 16, 28], hex: '#8a8d8f' },
  { pattern: /orange\s*021|021/i, cmyk: [0, 72, 100, 0], hex: '#fe5000' },
  { pattern: /yellow|116|109/i, cmyk: [0, 12, 100, 0], hex: '#ffcd00' },
  { pattern: /violet|purple|266/i, cmyk: [72, 92, 0, 0], hex: '#753bbd' },
  { pattern: /die|cut|crease|tiq|uv|varnish|spot\s*uv|foil/i, cmyk: [85, 0, 90, 0], hex: '#10b981' },
];

export function guessSpotChannelAppearance(name: string, alternateCmyk?: [number, number, number, number]): {
  cmyk: [number, number, number, number];
  hex: string;
} {
  if (alternateCmyk) {
    const [r, g, b] = cmykValuesToSrgb(
      alternateCmyk[0],
      alternateCmyk[1],
      alternateCmyk[2],
      alternateCmyk[3],
      OFFSET_ICC_PROFILES.FOGRA39
    );
    return {
      cmyk: alternateCmyk,
      hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
    };
  }
  for (const entry of KNOWN_SPOT_DATABASE) {
    if (entry.pattern.test(name)) {
      return { cmyk: entry.cmyk, hex: entry.hex };
    }
  }
  // Deterministic vivid fallback color based on spot name hash
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  const h = hue / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (h < 1) [r1, g1, b1] = [1, x, 0];
  else if (h < 2) [r1, g1, b1] = [x, 1, 0];
  else if (h < 3) [r1, g1, b1] = [0, 1, x];
  else if (h < 4) [r1, g1, b1] = [0, x, 1];
  else if (h < 5) [r1, g1, b1] = [x, 0, 1];
  else [r1, g1, b1] = [1, 0, x];
  const r = Math.round((0.15 + r1 * 0.72) * 255);
  const g = Math.round((0.15 + g1 * 0.72) * 255);
  const b = Math.round((0.15 + b1 * 0.72) * 255);
  return {
    cmyk: [Math.round((1 - r / 255) * 100), Math.round((1 - g / 255) * 100), Math.round((1 - b / 255) * 100), 0],
    hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
  };
}

export function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [16, 185, 129];
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

export function cmykValuesToSrgb(
  cPct: number,
  mPct: number,
  yPct: number,
  kPct: number,
  profile: OffsetProfileSpec
): [number, number, number] {
  const c = clamp01(cPct / 100);
  const m = clamp01(mPct / 100);
  const y = clamp01(yPct / 100);
  const k = clamp01(kPct / 100);

  // Subtractive physical ink transmittance model (Kubelka-Munk inspired soft-proof approximation)
  const trC = [
    1 - c * (1 - profile.cyanTint[0] / 255),
    1 - c * (1 - profile.cyanTint[1] / 255),
    1 - c * (1 - profile.cyanTint[2] / 255),
  ];
  const trM = [
    1 - m * (1 - profile.magentaTint[0] / 255),
    1 - m * (1 - profile.magentaTint[1] / 255),
    1 - m * (1 - profile.magentaTint[2] / 255),
  ];
  const trY = [
    1 - y * (1 - profile.yellowTint[0] / 255),
    1 - y * (1 - profile.yellowTint[1] / 255),
    1 - y * (1 - profile.yellowTint[2] / 255),
  ];
  const trK = [
    1 - k * (1 - profile.blackTint[0] / 255),
    1 - k * (1 - profile.blackTint[1] / 255),
    1 - k * (1 - profile.blackTint[2] / 255),
  ];

  const r = clamp255(profile.paperWhite[0] * trC[0] * trM[0] * trY[0] * trK[0]);
  const g = clamp255(profile.paperWhite[1] * trC[1] * trM[1] * trY[1] * trK[1]);
  const b = clamp255(profile.paperWhite[2] * trC[2] * trM[2] * trY[2] * trK[2]);
  return [r, g, b];
}

export interface SeparationBuffers {
  width: number;
  height: number;
  /** C, M, Y, K in 0..100 percentages (Uint8Array length = width * height) */
  c: Uint8Array;
  m: Uint8Array;
  y: Uint8Array;
  k: Uint8Array;
  /** Active Spot channel coverage 0..100 keyed by spot name */
  spots: Map<string, Uint8Array>;
  /** Exact TAC sum (C+M+Y+K+Spots) clamped 0..400 in Uint16Array */
  tac: Uint16Array;
  /** Total average coverage % for each plate */
  averages: {
    c: number;
    m: number;
    y: number;
    k: number;
    spots: Record<string, number>;
    maxTacPercent: number;
    tacExceedAreaPercent: number;
  };
}

/**
 * Separates an RGBA image surface into real C, M, Y, K and optional Spot plate coverage buffers (0..100%).
 * Also measures exact pixel TAC% and area% exceeding `tacThresholdPercent`.
 */
export function buildSeparationBuffersFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  settings: LithoColorSettings,
  detectedSpots: LithoSpotChannel[],
  tacThresholdPercent: number
): SeparationBuffers {
  const count = width * height;
  const cBuf = new Uint8Array(count);
  const mBuf = new Uint8Array(count);
  const yBuf = new Uint8Array(count);
  const kBuf = new Uint8Array(count);
  const tacBuf = new Uint16Array(count);

  const spotBuffers = new Map<string, Uint8Array>();
  const keptSpots: Array<{
    channel: LithoSpotChannel;
    targetRgb: [number, number, number];
    buf: Uint8Array;
    sum: number;
  }> = [];

  for (const spot of detectedSpots) {
    const handling = settings.spotChannels[spot.name] ?? spot.handling;
    if (handling === 'keep-spot') {
      const buf = new Uint8Array(count);
      spotBuffers.set(spot.name, buf);
      keptSpots.push({
        channel: spot,
        targetRgb: hexToRgbTuple(spot.previewHex),
        buf,
        sum: 0,
      });
    }
  }

  let sumC = 0;
  let sumM = 0;
  let sumY = 0;
  let sumK = 0;
  let maxTacPercent = 0;
  let exceedCount = 0;

  // Quantization cache speeds up large PDF pages dramatically (maps quantized 18-bit RGB -> CMYK)
  const lut = new Map<number, [number, number, number, number]>();

  for (let i = 0; i < count; i++) {
    const off = i * 4;
    const a = rgba[off + 3] / 255;
    const r = Math.round(rgba[off] * a + 255 * (1 - a));
    const g = Math.round(rgba[off + 1] * a + 255 * (1 - a));
    const b = Math.round(rgba[off + 2] * a + 255 * (1 - a));

    let cVal = 0;
    let mVal = 0;
    let yVal = 0;
    let kVal = 0;
    let matchedSpot = false;

    if (keptSpots.length > 0 && (r < 252 || g < 252 || b < 252)) {
      for (const ks of keptSpots) {
        const [sr, sg, sb] = ks.targetRgb;
        // Distance in chroma direction to separate dedicated Spot ink pixels from CMYK process inks
        const dr = Math.abs(r - sr);
        const dg = Math.abs(g - sg);
        const db = Math.abs(b - sb);
        const luma = (255 - (0.299 * r + 0.587 * g + 0.114 * b)) / 255;
        const spotLuma = (255 - (0.299 * sr + 0.587 * sg + 0.114 * sb)) / 255;
        if (dr + dg + db < 52 && spotLuma > 0.05) {
          const tint = Math.min(100, Math.round((luma / spotLuma) * 100));
          ks.buf[i] = tint;
          ks.sum += tint;
          matchedSpot = true;
          break;
        }
      }
    }

    if (!matchedSpot) {
      const qKey = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
      let cmyk = lut.get(qKey);
      if (!cmyk) {
        cmyk = convertRgbToCmyk(r, g, b, settings);
        lut.set(qKey, cmyk);
      }
      cVal = Math.round(cmyk[0]);
      mVal = Math.round(cmyk[1]);
      yVal = Math.round(cmyk[2]);
      kVal = Math.round(cmyk[3]);
    }

    cBuf[i] = cVal;
    mBuf[i] = mVal;
    yBuf[i] = yVal;
    kBuf[i] = kVal;

    let spotSumHere = 0;
    for (const ks of keptSpots) spotSumHere += ks.buf[i];
    const tac = cVal + mVal + yVal + kVal + spotSumHere;
    tacBuf[i] = tac;

    sumC += cVal;
    sumM += mVal;
    sumY += yVal;
    sumK += kVal;
    if (tac > maxTacPercent) maxTacPercent = tac;
    if (tac > tacThresholdPercent) exceedCount++;
  }

  const spotAverages: Record<string, number> = {};
  for (const ks of keptSpots) {
    spotAverages[ks.channel.name] = count > 0 ? Math.round((ks.sum / count) * 10) / 10 : 0;
  }

  return {
    width,
    height,
    c: cBuf,
    m: mBuf,
    y: yBuf,
    k: kBuf,
    spots: spotBuffers,
    tac: tacBuf,
    averages: {
      c: count > 0 ? Math.round((sumC / count) * 10) / 10 : 0,
      m: count > 0 ? Math.round((sumM / count) * 10) / 10 : 0,
      y: count > 0 ? Math.round((sumY / count) * 10) / 10 : 0,
      k: count > 0 ? Math.round((sumK / count) * 10) / 10 : 0,
      spots: spotAverages,
      maxTacPercent,
      tacExceedAreaPercent: count > 0 ? Math.round((exceedCount / count) * 1000) / 10 : 0,
    },
  };
}

export interface PlatePreviewOptions {
  enabledC: boolean;
  enabledM: boolean;
  enabledY: boolean;
  enabledK: boolean;
  enabledSpots: Record<string, boolean>;
  spotChannels: LithoSpotChannel[];
  simulateOverprint: boolean;
  highlightTacExceed: boolean;
  tacThresholdPercent: number;
  monochromeSinglePlate?: boolean;
  settings: LithoColorSettings;
}

/**
 * Renders the separated plate buffers back into an RGBA preview buffer so:
 * - Toggling all C+M+Y+K+Spots matches the original artwork accurately
 * - Toggling any subset or single plate shows realistic ink transmittance or monochrome film
 * - Overprint simulation mixes inks subtractively without knockout
 * - Optional TAC > threshold highlighter paints danger areas cleanly
 */
export function renderSeparationPreviewRgba(
  buffers: SeparationBuffers,
  options: PlatePreviewOptions
): Uint8ClampedArray {
  const count = buffers.width * buffers.height;
  const out = new Uint8ClampedArray(count * 4);
  const profile = resolveActiveProfileSpec(options.settings);

  const activeSpotList = options.spotChannels.filter(
    (s) =>
      buffers.spots.has(s.name) &&
      (options.enabledSpots[s.name] ?? true)
  );
  const enabledCount =
    (options.enabledC ? 1 : 0) +
    (options.enabledM ? 1 : 0) +
    (options.enabledY ? 1 : 0) +
    (options.enabledK ? 1 : 0) +
    activeSpotList.length;

  const isMonochromeSolo = options.monochromeSinglePlate && enabledCount === 1;

  for (let i = 0; i < count; i++) {
    const off = i * 4;
    if (options.highlightTacExceed && buffers.tac[i] > options.tacThresholdPercent) {
      // Clear high-contrast magenta/red TAC overload alert overlay
      out[off] = 225;
      out[off + 1] = 29;
      out[off + 2] = 72;
      out[off + 3] = 255;
      continue;
    }

    const c = options.enabledC ? buffers.c[i] : 0;
    const m = options.enabledM ? buffers.m[i] : 0;
    const y = options.enabledY ? buffers.y[i] : 0;
    const k = options.enabledK ? buffers.k[i] : 0;

    if (isMonochromeSolo) {
      let pct = c + m + y + k;
      if (activeSpotList.length === 1) {
        pct = buffers.spots.get(activeSpotList[0].name)?.[i] ?? 0;
      }
      const gray = clamp255(255 * (1 - clamp01(pct / 100)));
      out[off] = gray;
      out[off + 1] = gray;
      out[off + 2] = gray;
      out[off + 3] = 255;
      continue;
    }

    let [r, g, b] = cmykValuesToSrgb(c, m, y, k, profile);

    if (activeSpotList.length > 0) {
      for (const spot of activeSpotList) {
        const pct = buffers.spots.get(spot.name)?.[i] ?? 0;
        if (pct <= 0) continue;
        const [sr, sg, sb] = hexToRgbTuple(spot.previewHex);
        const t = pct / 100;
        if (options.simulateOverprint) {
          // Multiplicative ink overprint simulation
          r = clamp255(r * (1 - t * (1 - sr / 255)));
          g = clamp255(g * (1 - t * (1 - sg / 255)));
          b = clamp255(b * (1 - t * (1 - sb / 255)));
        } else {
          // Knockout blend over underlying plates
          r = clamp255(r * (1 - t) + sr * t);
          g = clamp255(g * (1 - t) + sg * t);
          b = clamp255(b * (1 - t) + sb * t);
        }
      }
    }

    out[off] = r;
    out[off + 1] = g;
    out[off + 2] = b;
    out[off + 3] = 255;
  }

  return out;
}
