import type { AppLanguage } from '@shared/models';

export interface ShortcutEntry {
  id: string;
  keys: string;
  labelFa: string;
  labelEn: string;
}

export interface ShortcutGroup {
  id: string;
  titleFa: string;
  titleEn: string;
  items: ShortcutEntry[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: 'files',
    titleFa: 'فایل‌ها و خروجی',
    titleEn: 'Files & Export',
    items: [
      { id: 'add-file', keys: 'Ctrl+O', labelFa: 'افزودن فایل (PDF / تصویر)', labelEn: 'Add PDF or image files' },
      { id: 'paste-clipboard', keys: 'Ctrl+V', labelFa: 'چسباندن تصویر از کلیپ‌بورد', labelEn: 'Paste image from clipboard' },
      { id: 'close-all', keys: 'Ctrl+W', labelFa: 'بستن همه (پاک‌سازی میز کار)', labelEn: 'Close all files' },
      { id: 'save-pdf', keys: 'Ctrl+S', labelFa: 'ذخیره خروجی PDF', labelEn: 'Save As PDF file' },
      { id: 'save-project', keys: 'Ctrl+Shift+S', labelFa: 'ذخیره پروژه (.psp)', labelEn: 'Save project (.psp)' },
      { id: 'open-project', keys: 'Ctrl+Shift+O', labelFa: 'باز کردن پروژه (.psp)', labelEn: 'Open project (.psp)' },
      { id: 'quick-print', keys: 'Ctrl+P', labelFa: 'چاپ سریع (Quick Print)', labelEn: 'Quick Print' },
      { id: 'full-print', keys: 'Ctrl+Shift+P', labelFa: 'پنجره تنظیمات کامل چاپ', labelEn: 'Full Print Dialog' },
    ],
  },
  {
    id: 'pages',
    titleFa: 'صفحات و ویرایش',
    titleEn: 'Pages & Editing',
    items: [
      { id: 'duplicate', keys: 'Ctrl+D', labelFa: 'تکثیر صفحات انتخاب‌شده', labelEn: 'Duplicate selected pages' },
      { id: 'blank-page', keys: 'Shift+Insert', labelFa: 'ایجاد صفحه سفید', labelEn: 'Insert blank page' },
      { id: 'select-all', keys: 'Ctrl+A', labelFa: 'انتخاب همه صفحات برای چاپ', labelEn: 'Select all pages for print' },
      { id: 'rotate', keys: 'Ctrl+R', labelFa: 'چرخش ۹۰ درجه ساعتگرد', labelEn: 'Rotate selected pages 90° CW' },
      { id: 'delete', keys: 'Delete', labelFa: 'حذف لایه یا صفحات انتخاب‌شده', labelEn: 'Delete selected overlay or pages' },
      { id: 'undo', keys: 'Ctrl+Z', labelFa: 'واگرد آخرین تغییر', labelEn: 'Undo' },
      { id: 'redo', keys: 'Ctrl+Y', labelFa: 'ازنو (بازگردانی تغییر)', labelEn: 'Redo' },
    ],
  },
  {
    id: 'view-tools',
    titleFa: 'نمایش، ابزارها و تنظیمات',
    titleEn: 'View, Tools & Preferences',
    items: [
      { id: 'invert', keys: 'Ctrl+I', labelFa: 'معکوس رنگ کل سند (Invert)', labelEn: 'Toggle color invert' },
      { id: 'fit-page', keys: 'Ctrl+0', labelFa: 'جاگیری کامل صفحه در نما', labelEn: 'Fit page to view' },
      { id: 'zoom-in', keys: '+', labelFa: 'بزرگنمایی نما', labelEn: 'Zoom in' },
      { id: 'zoom-out', keys: '-', labelFa: 'کوچک‌نمایی نما', labelEn: 'Zoom out' },
      { id: 'rulers', keys: 'Ctrl+G', labelFa: 'نمایش / مخفی کردن خط‌کش‌ها', labelEn: 'Toggle rulers' },
      { id: 'snap', keys: 'Ctrl+M', labelFa: 'حالت آهن‌ربایی خطوط راهنما', labelEn: 'Toggle magnetic snap' },
      { id: 'reset', keys: 'Alt+F6', labelFa: 'بازنشانی تمام تنظیمات به پیش‌فرض', labelEn: 'Reset all settings to defaults' },
      { id: 'shortcuts', keys: 'F1 / Ctrl+/', labelFa: 'نمایش لیست میانبرهای کیبورد', labelEn: 'Show keyboard shortcuts' },
    ],
  },
];

export function formatTooltipWithShortcut(label: string, shortcut?: string): string {
  if (!shortcut) return label;
  return `${label} (${shortcut})`;
}

export function getShortcutDescription(entry: ShortcutEntry, lang: AppLanguage): string {
  return lang === 'fa' ? entry.labelFa : entry.labelEn;
}
