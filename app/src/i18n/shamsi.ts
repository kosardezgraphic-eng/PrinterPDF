/**
 * PrintStudio Pro — Shamsi (Jalali) Calendar, Persian Digits & Roman Numerals Utility
 */

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

export function formatLocalizedNumber(
  value: number,
  lang: 'fa' | 'en',
  decimals = 0
): string {
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return lang === 'fa' ? toPersianDigits(formatted) : formatted;
}

/**
 * Algorithmic Gregorian to Jalali (Shamsi) conversion.
 * Deterministic across all environments without relying on ICU locale quirks.
 */
export function gregorianToJalali(
  gy: number,
  gm: number,
  gd: number
): { jy: number; jm: number; jd: number } {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    g_d_m[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm =
    days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

export function formatShamsiDate(date: Date = new Date(), usePersianDigits = true): string {
  const { jy, jm, jd } = gregorianToJalali(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate()
  );
  const raw = `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
  return usePersianDigits ? toPersianDigits(raw) : raw;
}

export function formatGregorianDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toRomanNumeral(num: number): string {
  if (num <= 0 || num >= 4000) return String(num);
  const lookup: Array<[string, number]> = [
    ['M', 1000],
    ['CM', 900],
    ['D', 500],
    ['CD', 400],
    ['C', 100],
    ['XC', 90],
    ['L', 50],
    ['XL', 40],
    ['X', 10],
    ['IX', 9],
    ['V', 5],
    ['IV', 4],
    ['I', 1],
  ];
  let result = '';
  let remaining = Math.floor(num);
  for (const [roman, value] of lookup) {
    while (remaining >= value) {
      result += roman;
      remaining -= value;
    }
  }
  return result;
}
