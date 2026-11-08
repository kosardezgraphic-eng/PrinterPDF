import React, { useState } from 'react';
import {
  X,
  Calculator,
  Printer,
  Settings,
  HelpCircle,
  FlipHorizontal2,
  Scissors,
  Download,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { computeCounterSummary } from '../engine/counterEngine';
import {
  computeImpositionSheets,
  computeManualDuplexPasses,
} from '../engine/layoutEngine';
import { triggerBlobDownload } from '../engine/pdfService';
import { formatLocalizedNumber, formatShamsiDate } from '../i18n/shamsi';
import type { DuplexMode } from '@shared/models';

export const ModalsAndToasts: React.FC = () => {
  const {
    documents,
    pages,
    layout,
    effects,
    settings,
    printers,
    selectedPrinterName,
    showCounterModal,
    showPrintModal,
    showSettingsModal,
    showManualDuplexModal,
    showSplitModal,
    showOnboardingTour,
    toasts,
    setModalState,
    selectPrinter,
    submitPrintJob,
    splitEveryNPages,
    makePageArray,
    updateSettings,
    dismissToast,
  } = useAppStore();

  const lang = settings.language;
  const isFa = lang === 'fa';
  const summary = computeCounterSummary(documents, pages, layout, settings);

  // Print Dialog local state (G1)
  const [copies, setCopies] = useState(1);
  const [collate, setCollate] = useState(true);
  const [pageRangeMode, setPageRangeMode] = useState<
    'all-selected' | 'current-page' | 'custom-range'
  >('all-selected');
  const [customRangeText, setCustomRangeText] = useState('1-6');
  const [oddEvenFilter, setOddEvenFilter] = useState<'all' | 'odd' | 'even'>('all');
  const [reverseOrder, setReverseOrder] = useState(false);
  const [dpi, setDpi] = useState(600);
  const [tray, setTray] = useState('Auto Select');

  // Split / Make Array local state
  const [splitN, setSplitN] = useState(2);
  const [arrayCount, setArrayCount] = useState(8);

  // Onboarding tour step (0..5)
  const [tourStep, setTourStep] = useState(0);

  const selectedPrinter =
    printers.find((p) => p.name === selectedPrinterName) ?? printers[0];

  const sheets = computeImpositionSheets(pages, layout);
  const manualDuplexInfo = computeManualDuplexPasses(sheets, layout.duplexMode);

  const exportCounterCsv = () => {
    const rows = [
      ['File Name', 'Total Pages', 'Selected Pages', 'Color Pages', 'B&W Pages', 'Blank Pages'],
      ...summary.byFile.map((f) => [
        `"${f.documentName}"`,
        String(f.totalPages),
        String(f.selectedPages),
        String(f.colorPages),
        String(f.bwPages),
        String(f.blankPages),
      ]),
    ];
    const csvContent =
      '\uFEFF' + rows.map((r) => r.join(',')).join('\n');
    triggerBlobDownload(
      csvContent,
      `PrintStudio-Counter-${Date.now()}.csv`,
      'text/csv;charset=utf-8'
    );
  };

  const tourSteps = [
    {
      titleFa: '۱. ورود آسان و Drag & Drop اسناد و تصاویر (A1–A3)',
      descFa:
        'هر تعداد فایل PDF یا عکس را مستقیم در پنجره رها کنید. فایل‌های خراب یا رمزدار به‌صورت ایزوله رد می‌شوند تا کار شما متوقف نشود.',
      titleEn: '1. Drag & Drop PDFs and Images (A1–A3)',
      descEn:
        'Drop any number of PDFs and images. Corrupt files are safely isolated without interrupting the batch.',
    },
    {
      titleFa: '۲. چیدمان حرفه‌ای چندصفحه و Step & Repeat (D1–D5)',
      descFa:
        'در تب Page Layout می‌توانید از 1-Up تا ماتریس ۱۰×۱۰، تکرار یک کارت در تمام شیت (Step & Repeat)، حاشیه و چاپ دورو را با پیش‌نمایش زنده تنظیم کنید.',
      titleEn: '2. N-Up Imposition & Step-and-Repeat (D1–D5)',
      descEn:
        'Configure 1-Up to 10×10 matrices, Step & Repeat business cards, margins, gutters, and Duplex ordering.',
    },
    {
      titleFa: '۳. معکوس کردن رنگ (Invert) و پایپ‌لاین افکت‌ها (E1–E2)',
      descFa:
        'با کلید میان‌بر Ctrl+I یا تب Effects می‌توانید اسلایدهای تیره و نقشه‌ها را معکوس (Invert) یا سیاه‌وسفید کنید. خروجی PDF به‌صورت برداری (BlendMode Difference) ساخته می‌شود.',
      titleEn: '3. GPU & Vector Invert + Effects Pipeline (E1–E2)',
      descEn:
        'Invert dark slides with Ctrl+I, apply Grayscale/Threshold/Gamma, and export true vector inverted PDFs.',
    },
    {
      titleFa: '۴. شمارش آنی صفحات، برگ فیزیکی و محاسبه هزینه (B1–B2)',
      descFa:
        'داشبورد شمارش به‌صورت لحظه‌ای تعداد صفحات رنگی/سیاه‌وسفید، تعداد برگ کاغذ مصرفی با احتساب N-Up و دورو، و هزینه چاپ را محاسبه می‌کند.',
      titleEn: '4. Instant Sheet Counter & Cost Calculator (B1–B2)',
      descEn:
        'Real-time count of color/B&W pages, physical sheets after N-Up & Duplex, and print shop cost.',
    },
    {
      titleFa: '۵. واترمارک با تاریخ شمسی و شماره‌گذاری Bates (F1–F2)',
      descFa:
        'در تب Insert واترمارک متنی با ماکروهای {shamsi_date}، {page}، {file} و شماره‌گذاری فارسی، رومی یا Bates اضافه کنید.',
      titleEn: '5. Shamsi Date Watermarks & Bates Numbering (F1–F2)',
      descEn:
        'Insert dynamic watermarks with Jalali/Shamsi dates and Persian, Roman, or Bates page numbering.',
    },
    {
      titleFa: '۶. مدیریت کامل پرینترهای ویندوز و صف چاپ دسته‌ای (G, H, I)',
      descFa:
        'مشاهده وضعیت زنده پرینترها (Ready, PaperJam, LowToner)، کنترل صف Spooler ویندوز و اجرای صف چاپ دسته‌ای (Batch Print).',
      titleEn: '6. Windows Spooler & Batch Print Queue (G, H, I)',
      descEn:
        'Monitor live printer statuses, control Windows Spooler jobs, and run automated batch print queues.',
    },
  ];

  return (
    <>
      {/* 1. COUNTER & COST SUMMARY MODAL (B1 - B2) */}
      {showCounterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Calculator className="h-5 w-5 text-amber-400" />
                <h2 className="text-base font-extrabold">
                  {isFa
                    ? 'داشبورد جامع شمارش صفحات، مصرف کاغذ و برآورد هزینه (B1–B2)'
                    : 'Page, Sheet & Cost Counter Dashboard (B1–B2)'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalState('counter', false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                <div className="text-[11px] text-slate-400">
                  {isFa ? 'تعداد کل فایل‌ها / صفحات' : 'Total Files / Pages'}
                </div>
                <div className="mt-1 text-lg font-black text-white">
                  {formatLocalizedNumber(summary.totalFiles, lang)} /{' '}
                  {formatLocalizedNumber(summary.totalPages, lang)}
                </div>
              </div>

              <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3">
                <div className="text-[11px] text-sky-300">
                  {isFa
                    ? 'تعداد برگ کاغذ فیزیکی مصرفی'
                    : 'Physical Paper Sheets'}
                </div>
                <div className="mt-1 text-lg font-black text-sky-400">
                  {formatLocalizedNumber(summary.totalPhysicalSheets, lang)}{' '}
                  <span className="text-xs font-normal">
                    ({summary.cellsPerSheet}-Up •{' '}
                    {summary.isDuplex
                      ? isFa
                        ? 'دورو'
                        : 'Duplex'
                      : isFa
                        ? 'تک‌رو'
                        : 'Simplex'}
                    )
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                <div className="text-[11px] text-slate-400">
                  {isFa ? 'رنگی / سیاه‌وسفید / خالی' : 'Color / B&W / Blank'}
                </div>
                <div className="mt-1 text-base font-bold text-slate-200">
                  <span className="text-sky-400">
                    {formatLocalizedNumber(summary.colorPages, lang)}
                  </span>{' '}
                  /{' '}
                  <span>{formatLocalizedNumber(summary.bwPages, lang)}</span> /{' '}
                  <span className="text-slate-500">
                    {formatLocalizedNumber(summary.blankPages, lang)}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                <div className="text-[11px] text-emerald-300">
                  {isFa ? 'برآورد هزینه مشتری (ریال)' : 'Estimated Cost (IRR)'}
                </div>
                <div className="mt-1 text-lg font-black text-emerald-400">
                  {formatLocalizedNumber(summary.estimatedCostRials, lang)}
                </div>
              </div>
            </div>

            {/* Breakdown by File Table */}
            <div className="mb-4 max-h-52 overflow-y-auto rounded-xl border border-slate-800">
              <table className="w-full text-xs">
                <thead className="bg-slate-950 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-start">
                      {isFa ? 'نام فایل' : 'Document Name'}
                    </th>
                    <th className="px-3 py-2 text-center">
                      {isFa ? 'کل صفحات' : 'Total'}
                    </th>
                    <th className="px-3 py-2 text-center">
                      {isFa ? 'انتخاب‌شده' : 'Selected'}
                    </th>
                    <th className="px-3 py-2 text-center">
                      {isFa ? 'رنگی' : 'Color'}
                    </th>
                    <th className="px-3 py-2 text-center">
                      {isFa ? 'سیاه‌وسفید' : 'B&W'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-900/50">
                  {summary.byFile.map((f) => (
                    <tr key={f.documentId}>
                      <td className="px-3 py-2 font-semibold">{f.documentName}</td>
                      <td className="px-3 py-2 text-center">
                        {formatLocalizedNumber(f.totalPages, lang)}
                      </td>
                      <td className="px-3 py-2 text-center text-sky-400 font-bold">
                        {formatLocalizedNumber(f.selectedPages, lang)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {formatLocalizedNumber(f.colorPages, lang)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {formatLocalizedNumber(f.bwPages, lang)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Breakdown by Paper Size & Orientation */}
            <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400">
                {isFa ? 'تفکیک سایز و جهت:' : 'By Size & Orientation:'}
              </span>
              {summary.byPaperSize.map((b) => (
                <span
                  key={`${b.sizeLabel}-${b.orientation}`}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-slate-200"
                >
                  {b.sizeLabel} ({b.orientation}):{' '}
                  <b>{formatLocalizedNumber(b.selectedPages, lang)}</b>
                </span>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={exportCounterCsv}
                className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                <Download className="h-4 w-4 text-sky-400" />
                <span>
                  {isFa ? 'خروجی جدول اکسل / CSV' : 'Export CSV Report'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setModalState('counter', false)}
                className="rounded-xl bg-sky-600 px-5 py-2 text-xs font-bold text-white hover:bg-sky-500 cursor-pointer"
              >
                {isFa ? 'بستن' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. FULL PRINT DIALOG MODAL (G1 - G2) */}
      {showPrintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Printer className="h-5 w-5 text-sky-400" />
                <h2 className="text-base font-extrabold">
                  {isFa
                    ? 'پنجره جامع چاپ و ارسال مستقیم به Spooler ویندوز (G1–G2)'
                    : 'Print Job Configuration & Direct Spooler Dispatch (G1–G2)'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalState('print', false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-slate-400">
                    {isFa ? 'انتخاب پرینتر (محلی / شبکه / مجازی):' : 'Printer:'}
                  </label>
                  <select
                    value={selectedPrinter?.name ?? ''}
                    onChange={(e) => selectPrinter(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                  >
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} [{p.status}]
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-slate-400">
                      {isFa ? 'تعداد کپی (Copies):' : 'Copies:'}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={copies}
                      onChange={(e) =>
                        setCopies(Math.max(1, Number(e.target.value)))
                      }
                      className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                    />
                  </div>
                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={collate}
                        onChange={(e) => setCollate(e.target.checked)}
                        className="accent-sky-500"
                      />
                      <span>{isFa ? 'مرتب‌سازی دسته‌ها (Collate)' : 'Collate'}</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-slate-400">
                    {isFa ? 'محدوده صفحات:' : 'Page Range:'}
                  </label>
                  <select
                    value={pageRangeMode}
                    onChange={(e) =>
                      setPageRangeMode(
                        e.target.value as
                          | 'all-selected'
                          | 'current-page'
                          | 'custom-range'
                      )
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                  >
                    <option value="all-selected">
                      {isFa
                        ? `همه صفحات تیک‌خورده (${summary.selectedPages} صفحه)`
                        : `All Selected Pages (${summary.selectedPages})`}
                    </option>
                    <option value="current-page">
                      {isFa ? 'فقط شیت فعلی' : 'Current Sheet Only'}
                    </option>
                    <option value="custom-range">
                      {isFa ? 'محدوده دلخواه (مثلاً 1-5, 8)' : 'Custom Range'}
                    </option>
                  </select>
                  {pageRangeMode === 'custom-range' && (
                    <input
                      type="text"
                      value={customRangeText}
                      onChange={(e) => setCustomRangeText(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 font-mono text-white"
                    />
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-slate-400">
                      {isFa ? 'سینی کاغذ (Tray):' : 'Paper Tray:'}
                    </label>
                    <select
                      value={tray}
                      onChange={(e) => setTray(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-2 text-white"
                    >
                      {(
                        selectedPrinter?.capabilities.supportedTrays ?? [
                          'Auto Select',
                        ]
                      ).map((tName) => (
                        <option key={tName} value={tName}>
                          {tName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-slate-400">
                      {isFa ? 'رزولوشن چاپ (DPI):' : 'Resolution (DPI):'}
                    </label>
                    <select
                      value={dpi}
                      onChange={(e) => setDpi(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-2 text-white"
                    >
                      {(
                        selectedPrinter?.capabilities.supportedDpi ?? [
                          300, 600, 1200,
                        ]
                      ).map((d) => (
                        <option key={d} value={d}>
                          {d} DPI
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-slate-400">
                      {isFa ? 'فیلتر فرد / زوج:' : 'Odd / Even:'}
                    </label>
                    <select
                      value={oddEvenFilter}
                      onChange={(e) =>
                        setOddEvenFilter(
                          e.target.value as 'all' | 'odd' | 'even'
                        )
                      }
                      className="w-full rounded-xl border border-slate-700 bg-slate-800 px-2.5 py-2 text-white"
                    >
                      <option value="all">{isFa ? 'همه شیت‌ها' : 'All Sheets'}</option>
                      <option value="odd">{isFa ? 'فقط فرد' : 'Odd Only'}</option>
                      <option value="even">{isFa ? 'فقط زوج' : 'Even Only'}</option>
                    </select>
                  </div>
                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reverseOrder}
                        onChange={(e) => setReverseOrder(e.target.checked)}
                        className="accent-sky-500"
                      />
                      <span>{isFa ? 'چاپ از آخر به اول (Reverse)' : 'Reverse Order'}</span>
                    </label>
                  </div>
                </div>

                {/* Final Pre-Flight Summary Box */}
                <div className="rounded-xl border border-sky-500/30 bg-sky-950/30 p-3 text-[11px] leading-relaxed text-slate-200">
                  <div className="font-bold text-sky-300">
                    {isFa ? 'خلاصه نهایی پیش از ارسال به پرینتر:' : 'Pre-flight Summary:'}
                  </div>
                  <div>
                    • {isFa ? 'کاغذ و چیدمان:' : 'Layout:'} {layout.paperSize} (
                    {layout.rows}×{layout.cols}-Up) • {layout.duplexMode}
                  </div>
                  <div>
                    • {isFa ? 'تعداد برگ فیزیکی در هر سری:' : 'Sheets per copy:'}{' '}
                    <b>{summary.totalPhysicalSheets}</b> × {copies} ={' '}
                    <b>{summary.totalPhysicalSheets * copies}</b>{' '}
                    {isFa ? 'برگ' : 'sheets'}
                  </div>
                  {effects.invert && (
                    <div className="text-fuchsia-300 font-bold">
                      • {isFa ? 'افکت معکوس رنگ (Invert) فعال است' : 'Invert Colors Active'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setModalState('print', false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                {isFa ? 'انصراف' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() =>
                  void submitPrintJob({
                    printerName:
                      selectedPrinter?.name ?? 'PrintStudio Virtual Printer',
                    jobTitle:
                      documents[0]?.name ?? 'PrintStudio Imposed Job',
                    copies,
                    collate,
                    pageRangeMode,
                    customRangeText,
                    oddEvenFilter,
                    reverseOrder,
                    duplexMode: layout.duplexMode as DuplexMode,
                    scaleMode: 'fit',
                    dpi,
                    colorMode:
                      effects.grayscale || effects.blackAndWhite
                        ? 'bw'
                        : 'color',
                    tray,
                    silent: true,
                  })
                }
                className="flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 text-xs font-bold text-white hover:bg-sky-500 cursor-pointer"
              >
                <Printer className="h-4 w-4" />
                <span>
                  {isFa
                    ? 'ارسال مستقیم به پرینتر (Silent Print)'
                    : 'Print Now (Direct Spooler)'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. MANUAL DUPLEX 3D GUIDE MODAL (D5) */}
      {showManualDuplexModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-indigo-500/40 bg-slate-900 p-6 text-slate-100 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FlipHorizontal2 className="h-5 w-5 text-indigo-400" />
                <h2 className="text-base font-extrabold">
                  {isFa
                    ? 'راهنمای ۳بعدی چاپ دوروی دستی (Manual Duplex — D5)'
                    : '3D Manual Duplex Flip Guide (D5)'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalState('manualDuplex', false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs leading-relaxed">
              {/* 3D Animated SVG Paper Flip Illustration */}
              <div className="flex items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 p-6">
                <div className="flex items-center gap-6">
                  <div className="flex h-28 w-20 flex-col items-center justify-center rounded-lg border-2 border-sky-400 bg-sky-500/10 p-2 text-center">
                    <span className="text-[10px] font-bold text-sky-300">
                      Pass 1 (Front)
                    </span>
                    <span className="mt-1 text-lg font-black text-white">
                      {manualDuplexInfo.pass1FrontSides.length}
                    </span>
                    <span className="text-[9px] text-slate-400">
                      {isFa ? 'شیت رو' : 'Front Sheets'}
                    </span>
                  </div>

                  <div className="flex flex-col items-center text-indigo-400">
                    <FlipHorizontal2 className="h-8 w-8 animate-pulse" />
                    <span className="mt-1 text-[10px] font-bold">
                      {layout.duplexMode === 'short-edge'
                        ? 'Short-Edge Flip'
                        : 'Long-Edge Flip'}
                    </span>
                  </div>

                  <div className="flex h-28 w-20 flex-col items-center justify-center rounded-lg border-2 border-amber-400 bg-amber-500/10 p-2 text-center">
                    <span className="text-[10px] font-bold text-amber-300">
                      Pass 2 (Back)
                    </span>
                    <span className="mt-1 text-lg font-black text-white">
                      {manualDuplexInfo.pass2BackSides.length}
                    </span>
                    <span className="text-[9px] text-slate-400">
                      {isFa ? 'شیت پشت (معکوس)' : 'Back Sheets'}
                    </span>
                  </div>
                </div>
              </div>

              <p className="rounded-xl border border-indigo-500/30 bg-indigo-950/30 p-3 text-indigo-200">
                {isFa
                  ? manualDuplexInfo.flipInstructionFa
                  : manualDuplexInfo.flipInstructionEn}
              </p>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setModalState('manualDuplex', false)}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-500 cursor-pointer"
              >
                {isFa ? 'متوجه شدم' : 'Got It'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. SPLIT DOCUMENT / MAKE AN ARRAY MODAL (A4) */}
      {showSplitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Scissors className="h-5 w-5 text-amber-400" />
                <h2 className="text-base font-extrabold">
                  {isFa
                    ? 'تفکیک خودکار سند (Split) و تکرار آرایه‌ای (A4)'
                    : 'Split Document & Make Page Array (A4)'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalState('split', false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2">
                <div className="font-bold text-slate-200">
                  {isFa
                    ? '۱. تفکیک سند هر N صفحه به بخش‌های مجزا:'
                    : '1. Split every N pages into separate groups:'}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={splitN}
                    onChange={(e) =>
                      setSplitN(Math.max(1, Number(e.target.value)))
                    }
                    className="w-20 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-center text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      splitEveryNPages(splitN);
                      setModalState('split', false);
                    }}
                    className="rounded-lg bg-amber-600 px-4 py-1.5 font-bold text-white hover:bg-amber-500 cursor-pointer"
                  >
                    {isFa ? `تفکیک هر ${splitN} صفحه` : `Split Every ${splitN} Pages`}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2">
                <div className="font-bold text-slate-200">
                  {isFa
                    ? '۲. تکرار آرایه‌ای صفحه انتخاب‌شده (Make an Array):'
                    : '2. Repeat highlighted page (Make an Array):'}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={2}
                    max={100}
                    value={arrayCount}
                    onChange={(e) =>
                      setArrayCount(Math.max(2, Number(e.target.value)))
                    }
                    className="w-20 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-center text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const target =
                        pages.find((p) => p.isHighlighted) ?? pages[0];
                      if (target) {
                        makePageArray(target.id, arrayCount);
                      }
                      setModalState('split', false);
                    }}
                    className="rounded-lg bg-sky-600 px-4 py-1.5 font-bold text-white hover:bg-sky-500 cursor-pointer"
                  >
                    {isFa
                      ? `ساخت آرایه ${arrayCount}تایی`
                      : `Make Array of ${arrayCount}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. SETTINGS MODAL (K1) */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-sky-400" />
                <h2 className="text-base font-extrabold">
                  {isFa
                    ? 'تنظیمات عمومی، واحد اندازه‌گیری، تقویم شمسی و تعرفه (K1)'
                    : 'Application Settings, Units & Print Shop Tariffs (K1)'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModalState('settings', false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="mb-1 block text-slate-400">
                  {isFa ? 'زبان رابط کاربری:' : 'Interface Language:'}
                </label>
                <select
                  value={settings.language}
                  onChange={(e) =>
                    updateSettings({ language: e.target.value as 'fa' | 'en' })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                >
                  <option value="fa">فارسی (راست‌به‌چپ - RTL)</option>
                  <option value="en">English (Left-to-Right - LTR)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-slate-400">
                  {isFa ? 'واحد خط‌کش و ابعاد:' : 'Measurement Unit:'}
                </label>
                <select
                  value={settings.unit}
                  onChange={(e) =>
                    updateSettings({
                      unit: e.target.value as 'mm' | 'cm' | 'inch',
                    })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                >
                  <option value="mm">میلی‌متر (mm)</option>
                  <option value="cm">سانتی‌متر (cm)</option>
                  <option value="inch">اینچ (inch)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-slate-400">
                  {isFa ? 'تقویم پیش‌فرض:' : 'Calendar System:'}
                </label>
                <select
                  value={settings.calendar}
                  onChange={(e) =>
                    updateSettings({
                      calendar: e.target.value as 'shamsi' | 'gregorian',
                    })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                >
                  <option value="shamsi">
                    هجری شمسی ({formatShamsiDate(new Date(), true)})
                  </option>
                  <option value="gregorian">میلادی (Gregorian)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-slate-400">
                  {isFa ? 'نام اپراتور (ماکرو {user}):' : 'Operator Name:'}
                </label>
                <input
                  type="text"
                  value={settings.userName}
                  onChange={(e) => updateSettings({ userName: e.target.value })}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-slate-400">
                  {isFa ? 'تعرفه صفحه سیاه‌وسفید (ریال):' : 'B&W Page Tariff (IRR):'}
                </label>
                <input
                  type="number"
                  value={settings.bwPageTariffRials}
                  onChange={(e) =>
                    updateSettings({
                      bwPageTariffRials: Math.max(0, Number(e.target.value)),
                    })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-slate-400">
                  {isFa ? 'تعرفه صفحه رنگی (ریال):' : 'Color Page Tariff (IRR):'}
                </label>
                <input
                  type="number"
                  value={settings.colorPageTariffRials}
                  onChange={(e) =>
                    updateSettings({
                      colorPageTariffRials: Math.max(0, Number(e.target.value)),
                    })
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-white"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setModalState('settings', false)}
                className="rounded-xl bg-sky-600 px-5 py-2 text-xs font-bold text-white hover:bg-sky-500 cursor-pointer"
              >
                {isFa ? 'ذخیره و بستن' : 'Save & Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. 6-STEP INTERACTIVE ONBOARDING TOUR MODAL */}
      {showOnboardingTour && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-sky-500/40 bg-slate-900 p-6 text-slate-100 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sky-400">
                <HelpCircle className="h-5 w-5" />
                <span className="text-xs font-bold">
                  {isFa
                    ? `تور راهنمای سریع PrintStudio Pro (${tourStep + 1} از 6)`
                    : `PrintStudio Pro Quick Tour (${tourStep + 1} of 6)`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setModalState('tour', false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <h3 className="text-base font-extrabold text-white">
              {isFa
                ? tourSteps[tourStep].titleFa
                : tourSteps[tourStep].titleEn}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              {isFa ? tourSteps[tourStep].descFa : tourSteps[tourStep].descEn}
            </p>

            <div className="mt-6 flex items-center justify-between">
              <div className="flex gap-1">
                {tourSteps.map((_, idx) => (
                  <span
                    key={idx}
                    className={`h-1.5 w-5 rounded-full ${
                      idx === tourStep ? 'bg-sky-400' : 'bg-slate-700'
                    }`}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                {tourStep > 0 && (
                  <button
                    type="button"
                    onClick={() => setTourStep(tourStep - 1)}
                    className="rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs text-slate-200 cursor-pointer"
                  >
                    {isFa ? 'قبلی' : 'Back'}
                  </button>
                )}
                {tourStep < tourSteps.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setTourStep(tourStep + 1)}
                    className="rounded-xl bg-sky-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-sky-500 cursor-pointer"
                  >
                    {isFa ? 'بعدی' : 'Next'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setTourStep(0);
                      setModalState('tour', false);
                    }}
                    className="rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 cursor-pointer"
                  >
                    {isFa ? 'شروع کار با برنامه' : 'Finish Tour'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NON-INTRUSIVE TOAST NOTIFICATIONS */}
      <div className="pointer-events-none fixed bottom-11 end-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            onClick={() => dismissToast(toast.id)}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border p-3 text-xs shadow-2xl backdrop-blur-md transition cursor-pointer ${
              toast.type === 'error'
                ? 'border-rose-500/50 bg-rose-950/90 text-rose-100'
                : toast.type === 'warning'
                  ? 'border-amber-500/50 bg-amber-950/90 text-amber-100'
                  : toast.type === 'success'
                    ? 'border-emerald-500/50 bg-emerald-950/90 text-emerald-100'
                    : 'border-sky-500/50 bg-slate-900/95 text-slate-100'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : toast.type === 'error' || toast.type === 'warning' ? (
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
            ) : (
              <Info className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
            )}
            <div className="leading-relaxed">
              <div className="font-bold">{toast.title}</div>
              {toast.message && (
                <div className="mt-0.5 text-[11px] opacity-90">
                  {toast.message}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
};
