/**
 * PrintStudio Pro — Watermark, Macro Expansion & Page/Bates Numbering Engine (F1 - F2)
 */

import type { PageNumberSettings, WatermarkSettings } from '@shared/models';
import {
  formatGregorianDate,
  formatShamsiDate,
  toPersianDigits,
  toRomanNumeral,
} from '../i18n/shamsi';

export interface MacroContext {
  pageNumber: number;
  totalPages: number;
  sheetNumber: number;
  totalSheets: number;
  fileName: string;
  userName: string;
  date?: Date;
}

/**
 * Resolves dynamic Watermark & Header/Footer macros:
 * {page} {pages} {sheet} {sheets} {date} {shamsi_date} {file} {user}
 */
export function resolveTextMacros(template: string, ctx: MacroContext): string {
  const now = ctx.date ?? new Date();
  return template
    .replace(/\{page\}/gi, String(ctx.pageNumber))
    .replace(/\{pages\}/gi, String(ctx.totalPages))
    .replace(/\{sheet\}/gi, String(ctx.sheetNumber))
    .replace(/\{sheets\}/gi, String(ctx.totalSheets))
    .replace(/\{date\}/gi, formatGregorianDate(now))
    .replace(/\{shamsi_date\}/gi, formatShamsiDate(now, true))
    .replace(/\{file\}/gi, ctx.fileName)
    .replace(/\{user\}/gi, ctx.userName);
}

/**
 * Formats page/sheet numbers in Persian, English, Roman, or Bates Numbering format (F2).
 */
export function formatPageNumberLabel(
  settings: PageNumberSettings,
  indexOneBased: number,
  totalCount: number
): string {
  const num = settings.startNumber + indexOneBased - 1;
  const total = settings.startNumber + totalCount - 1;

  switch (settings.format) {
    case 'persian':
      return `صفحه ${toPersianDigits(num)} از ${toPersianDigits(total)}`;
    case 'english':
      return `Page ${num} of ${total}`;
    case 'roman':
      return `${toRomanNumeral(num)} / ${toRomanNumeral(total)}`;
    case 'bates': {
      const digits = Math.max(3, Math.min(10, settings.batesDigits || 6));
      const padded = String(num).padStart(digits, '0');
      return `${settings.batesPrefix || 'BATES-'}${padded}`;
    }
  }
}

export function getDefaultWatermarkSettings(): WatermarkSettings {
  return {
    enabled: false,
    type: 'text',
    text: 'PrintStudio Pro • {shamsi_date} • {user}',
    fontFamily: 'Vazirmatn',
    fontSizePt: 28,
    colorHex: '#0284c7',
    opacity: 0.22,
    rotationDeg: -35,
    tiled: false,
    tileSpacingMm: 70,
  };
}

export function getDefaultPageNumberSettings(): PageNumberSettings {
  return {
    enabled: false,
    target: 'sheet',
    format: 'persian',
    position: 'bottom-center',
    startNumber: 1,
    batesPrefix: 'PSP-1405-',
    batesDigits: 6,
    fontSizePt: 10,
    marginMm: 8,
    headerText: '{file}',
    footerText: '{shamsi_date}',
  };
}
