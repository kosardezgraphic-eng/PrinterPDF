import React, { useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Copy,
  FilePlus2,
  FolderPlus,
  Layers,
  Pause,
  Play,
  Printer,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Upload,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Ban,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { VirtualPrinterCard } from './VirtualPrinterCard';
import { PrinterRetryButton, PrinterServiceStatus } from './PrinterStatus';
import {
  estimateBatchJobMetrics,
  resolveBatchJobPageNumbers,
} from '../engine/batchService';
import {
  STANDARD_PAPER_SIZES,
  type BatchJobItem,
  type DuplexMode,
  type PageOrientation,
  type PaperSizeId,
} from '@shared/models';

export const BatchPrintWorkspace: React.FC = () => {
  const {
    settings,
    pages,
    printers,
    selectedPrinterName,
    spoolerJobs,
    batchQueue,
    batchSelectedJobId,
    isBatchRunning,
    setAppMode,
    selectBatchJob,
    addBatchFiles,
    addCurrentWorkspaceToBatch,
    updateBatchJob,
    applyPrinterProfileToAllBatchJobs,
    moveBatchJob,
    duplicateBatchJob,
    clearCompletedBatchJobs,
    clearAllBatchJobs,
    cancelBatchJob,
    runBatchQueue,
    pauseBatchQueue,
    removeBatchJob,
    retryFailedBatchJobs,
    selectPrinter,
    autoSelectBestPrinter,
    updatePrinterProfile,
    openPrinterPreferences,
    controlSpoolerJob,
    purgePrinterQueue,
  } = useAppStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const lang = settings.language;
  const isFa = lang === 'fa';

  const selectedJob: BatchJobItem | undefined =
    batchQueue.find((j) => j.id === batchSelectedJobId) ?? batchQueue[0];

  const activePrinter =
    printers.find((p) => p.name === selectedPrinterName) ?? printers[0];
  const caps = activePrinter?.capabilities;
  const prof = activePrinter?.activeProfile;

  const hwPaperOptions = caps?.paperOptions?.length
    ? caps.paperOptions
    : (
        caps?.supportedPapers ??
        (Object.keys(STANDARD_PAPER_SIZES) as PaperSizeId[])
      ).map((id) => {
        const d =
          id !== 'Custom'
            ? STANDARD_PAPER_SIZES[id]
            : { widthMm: 210, heightMm: 297 };
        return { id, name: String(id), widthMm: d.widthMm, heightMm: d.heightMm };
      });

  const selectedHwPaperName = (() => {
    if (!activePrinter || !prof) return 'A4';
    const byName = hwPaperOptions.find(
      (o) => prof.paperName && o.name.toLowerCase() === prof.paperName.toLowerCase()
    );
    if (byName) return byName.name;
    const byId = hwPaperOptions.find((o) => o.id === prof.paperSize);
    return byId?.name ?? hwPaperOptions[0]?.name ?? prof.paperSize;
  })();

  const studioSelectedCount = pages.filter((p) => p.selectedForPrint).length;
  const queuedCount = batchQueue.filter(
    (b) => b.status === 'queued' || b.status === 'paused'
  ).length;
  const completedCount = batchQueue.filter((b) => b.status === 'completed').length;
  const failedCount = batchQueue.filter((b) => b.status === 'failed').length;
  const totalBatchSheets = batchQueue.reduce(
    (sum, j) => sum + estimateBatchJobMetrics(j).totalSheets,
    0
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (dropped.length > 0) {
      void addBatchFiles(dropped);
    }
  };

  const renderStatusPill = (status: BatchJobItem['status']) => {
    switch (status) {
      case 'completed':
        return (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
            {isFa ? 'ارسال شد' : 'Completed'}
          </span>
        );
      case 'processing':
        return (
          <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300">
            {isFa ? 'در حال چاپ...' : 'Printing...'}
          </span>
        );
      case 'paused':
        return (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
            {isFa ? 'متوقف' : 'Paused'}
          </span>
        );
      case 'failed':
        return (
          <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
            {isFa ? 'خطا' : 'Failed'}
          </span>
        );
      case 'canceled':
        return (
          <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            {isFa ? 'لغو شد' : 'Canceled'}
          </span>
        );
      default:
        return (
          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {isFa ? 'در صف' : 'Queued'}
          </span>
        );
    }
  };

  const selectedJobMetrics = selectedJob ? estimateBatchJobMetrics(selectedJob) : null;
  const selectedJobPages = selectedJob ? resolveBatchJobPageNumbers(selectedJob) : [];

  return (
    <div
      data-batch-workspace
      dir={isFa ? 'rtl' : 'ltr'}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
    >
      {/* Standalone Batch Print Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900 shrink-0">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <button
            type="button"
            data-exit-batch-mode
            onClick={() => setAppMode('studio')}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 cursor-pointer"
          >
            {isFa ? (
              <ArrowRight className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
            ) : (
              <ArrowLeft className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
            )}
            <span>{isFa ? 'بازگشت به استودیو' : 'Back to Studio'}</span>
          </button>

          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-sky-600 dark:text-sky-400 shrink-0" />
            <div>
              <h1 className="text-sm font-black text-slate-900 dark:text-white">
                {isFa
                  ? 'محیط مستقل چاپ دسته‌ای (Batch Print Center)'
                  : 'Standalone Batch Print Center'}
              </h1>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                {isFa
                  ? 'صف چاپ مجزا با تنظیم بازه صفحات، تعداد سری، چیدمان و دسترسی کامل سخت‌افزار پرینتر'
                  : 'Dedicated multi-file print queue with per-file page ranges, copies/sets & full printer hardware control'}
              </p>
            </div>
          </div>

          <div className="hidden xl:flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] dark:border-slate-800 dark:bg-slate-950/70 tabular-nums">
            <span>
              {isFa ? 'فایل‌ها:' : 'Jobs:'} <strong>{batchQueue.length}</strong>
            </span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <span>
              {isFa ? 'در صف:' : 'Queued:'} <strong className="text-sky-600 dark:text-sky-400">{queuedCount}</strong>
            </span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <span>
              {isFa ? 'تکمیل:' : 'Done:'} <strong className="text-emerald-600 dark:text-emerald-400">{completedCount}</strong>
            </span>
            {failedCount > 0 && (
              <>
                <span className="text-slate-300 dark:text-slate-700">|</span>
                <span>
                  {isFa ? 'خطا:' : 'Failed:'} <strong className="text-rose-600 dark:text-rose-400">{failedCount}</strong>
                </span>
              </>
            )}
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <span>
              {isFa ? 'برگ کاغذ:' : 'Sheets:'} <strong>{totalBatchSheets}</strong>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              if (list.length) void addBatchFiles(list);
              e.target.value = '';
            }}
          />

          <button
            type="button"
            data-batch-add-files
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-300 dark:hover:bg-sky-500/25 cursor-pointer"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>{isFa ? 'افزودن فایل PDF / عکس' : 'Add PDF / Image Files'}</span>
          </button>

          <button
            type="button"
            disabled={studioSelectedCount === 0}
            onClick={addCurrentWorkspaceToBatch}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          >
            <FilePlus2 className="h-3.5 w-3.5 text-indigo-500" />
            <span>
              {isFa
                ? `آوردن سند استودیو (${studioSelectedCount} ص)`
                : `Import Studio (${studioSelectedCount}p)`}
            </span>
          </button>

          {!isBatchRunning ? (
            <button
              type="button"
              data-batch-run
              disabled={queuedCount === 0}
              onClick={() => void runBatchQueue()}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40 cursor-pointer"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{isFa ? 'شروع چاپ صف' : 'Run Batch'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={pauseBatchQueue}
              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-amber-500 cursor-pointer"
            >
              <Pause className="h-3.5 w-3.5" />
              <span>{isFa ? 'توقف موقت' : 'Pause'}</span>
            </button>
          )}

          <button
            type="button"
            disabled={failedCount === 0 && !batchQueue.some((b) => b.status === 'paused' || b.status === 'canceled')}
            onClick={retryFailedBatchJobs}
            className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{isFa ? 'تلاش مجدد' : 'Retry'}</span>
          </button>

          <button
            type="button"
            disabled={completedCount === 0}
            onClick={clearCompletedBatchJobs}
            className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span>{isFa ? 'پاک‌کردن انجام‌شده‌ها' : 'Clear Done'}</span>
          </button>
        </div>
      </div>

      {/* Main Batch Content Grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-12 gap-4 overflow-y-auto p-4">
        {/* Column 1: Queue Inbox + File List (5 cols) */}
        <div className="lg:col-span-5 flex min-h-0 flex-col gap-3">
          {/* Drag & Drop File Inbox */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOver(false);
            }}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition ${
              dragOver
                ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40'
                : 'border-slate-300 bg-white hover:border-sky-400 dark:border-slate-700 dark:bg-slate-900/70 dark:hover:border-sky-500/60'
            }`}
          >
            <Upload className="mb-1.5 h-6 w-6 text-sky-500" />
            <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
              {isFa
                ? 'فایل‌های PDF یا تصویر را اینجا بکشید و رها کنید'
                : 'Drag & drop PDF or image files directly into Batch Queue'}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
              {isFa
                ? 'اسناد صف چاپ دسته‌ای مستقل از پروژه باز استودیو نگهداری می‌شوند'
                : 'Files stay independent from your active Studio canvas'}
            </div>
          </div>

          {/* Queue List */}
          <div className="flex min-h-[260px] flex-1 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                {isFa
                  ? `فهرست صف چاپ (${batchQueue.length} فایل)`
                  : `Batch Queue (${batchQueue.length} files)`}
              </span>
              {batchQueue.length > 0 && (
                <button
                  type="button"
                  onClick={clearAllBatchJobs}
                  className="text-[11px] font-semibold text-rose-600 hover:underline dark:text-rose-400 cursor-pointer"
                >
                  {isFa ? 'خالی کردن صف' : 'Clear All'}
                </button>
              )}
            </div>

            <div className="flex-1 divide-y divide-slate-200 overflow-y-auto dark:divide-slate-800">
              {batchQueue.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  <Layers className="mb-2 h-8 w-8 text-slate-300 dark:text-slate-700" />
                  <p>
                    {isFa
                      ? 'صف چاپ دسته‌ای خالی است. از دکمه «افزودن فایل» یا رها کردن فایل استفاده کنید.'
                      : 'Batch queue is empty. Add PDF/image files or import from Studio.'}
                  </p>
                </div>
              ) : (
                batchQueue.map((item, idx) => {
                  const isSel = selectedJob?.id === item.id;
                  const m = estimateBatchJobMetrics(item);
                  const rangeLabel =
                    item.pageRangeMode === 'custom' && item.customRangeText?.trim()
                      ? item.customRangeText
                      : isFa
                        ? 'همه'
                        : 'All';
                  return (
                    <div
                      key={item.id}
                      data-batch-job-row={item.id}
                      onClick={() => selectBatchJob(item.id)}
                      className={`cursor-pointer p-3 transition ${
                        isSel
                          ? 'bg-sky-50/90 dark:bg-sky-500/10'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              #{idx + 1}
                            </span>
                            <span className="truncate text-xs font-bold text-slate-900 dark:text-white">
                              {item.fileName}
                            </span>
                            {renderStatusPill(item.status)}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-600 dark:text-slate-400 tabular-nums">
                            <span>
                              {m.selectedPagesCount}/{item.pageCount}{' '}
                              {isFa ? 'صفحه' : 'p'}
                            </span>
                            <span>•</span>
                            <span>
                              {isFa ? 'بازه:' : 'Range:'} {rangeLabel}
                            </span>
                            <span>•</span>
                            <span className="font-bold text-sky-700 dark:text-sky-300">
                              {item.copies} {isFa ? 'سری' : 'set(s)'}
                            </span>
                            <span>•</span>
                            <span>{item.nUp}-Up</span>
                            <span>•</span>
                            <span>{item.duplexMode}</span>
                            {item.invert && (
                              <span className="rounded bg-fuchsia-100 px-1 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300">
                                Invert
                              </span>
                            )}
                          </div>

                          <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            <Printer className="inline h-3 w-3 me-1 text-slate-400" />
                            {item.printerName || (isFa ? 'پرینتر انتخاب نشده' : 'No printer')}
                            {item.spoolerJobId ? ` • Spool #${item.spoolerJobId}` : ''}
                          </div>

                          {item.errorMessage && (
                            <div className="mt-1 text-[10px] text-rose-600 dark:text-rose-400">
                              {item.errorMessage}
                            </div>
                          )}

                          {(item.status === 'processing' || item.progressPercent > 0) && (
                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                              <div
                                style={{ width: `${item.progressPercent}%` }}
                                className={`h-full transition-all ${
                                  item.status === 'completed'
                                    ? 'bg-emerald-500'
                                    : 'bg-sky-500'
                                }`}
                              />
                            </div>
                          )}
                        </div>

                        <div
                          className="flex items-center gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => moveBatchJob(item.id, 'up')}
                            title={isFa ? 'انتقال به بالا' : 'Move Up'}
                            className="rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-700 cursor-pointer"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === batchQueue.length - 1}
                            onClick={() => moveBatchJob(item.id, 'down')}
                            title={isFa ? 'انتقال به پایین' : 'Move Down'}
                            className="rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-700 cursor-pointer"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => duplicateBatchJob(item.id)}
                            title={isFa ? 'تکثیر ردیف در صف' : 'Duplicate Job'}
                            className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700 cursor-pointer"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          {item.status !== 'queued' && item.status !== 'processing' && (
                            <button
                              type="button"
                              onClick={() =>
                                updateBatchJob(item.id, {
                                  status: 'queued',
                                  progressPercent: 0,
                                  errorMessage: undefined,
                                })
                              }
                              title={isFa ? 'بازنشانی به صف' : 'Re-queue Job'}
                              className="rounded p-1 text-sky-600 hover:bg-sky-100 dark:text-sky-400 dark:hover:bg-sky-500/20 cursor-pointer"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {item.status === 'processing' ? (
                            <button
                              type="button"
                              onClick={() => cancelBatchJob(item.id)}
                              title={isFa ? 'لغو چاپ' : 'Cancel'}
                              className="rounded p-1 text-amber-600 hover:bg-amber-100 dark:text-amber-400 cursor-pointer"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => removeBatchJob(item.id)}
                              title={isFa ? 'حذف از صف' : 'Remove'}
                              className="rounded p-1 text-rose-600 hover:bg-rose-100 dark:text-rose-400 dark:hover:bg-rose-500/20 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Column 2: Selected File Print Rules, Ranges, Sets & Overrides (3 cols) */}
        <div
          data-batch-job-editor
          className="lg:col-span-3 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-xs dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between border-b border-slate-200 pb-2 dark:border-slate-800">
            <h2 className="font-bold text-slate-900 dark:text-white">
              {isFa
                ? 'تنظیمات اختصاصی فایل انتخاب‌شده'
                : 'Selected File Print Settings'}
            </h2>
            {selectedJobMetrics && (
              <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-500/20 dark:text-sky-300 tabular-nums">
                {selectedJobMetrics.totalSheets}{' '}
                {isFa ? 'برگ کاغذ' : 'sheet(s)'}
              </span>
            )}
          </div>

          {!selectedJob ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              {isFa
                ? 'یک فایل را از فهرست صف انتخاب کنید تا بازه صفحات، تعداد سری و امکانات چاپ آن تنظیم شود.'
                : 'Select a job from the batch queue to configure page ranges, copies/sets, and layout.'}
            </div>
          ) : (
            <div className="space-y-3.5 overflow-y-auto pr-0.5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="truncate font-bold text-slate-900 dark:text-white">
                  {selectedJob.fileName}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {selectedJob.pageCount}{' '}
                  {isFa ? 'صفحه کل' : 'total pages'} •{' '}
                  {Math.max(1, Math.round(selectedJob.fileSize / 1024))} KB
                </div>
              </div>

              {/* Page Ranges */}
              <div className="space-y-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {isFa ? 'بازه صفحات فایل (Page Range)' : 'File Page Range'}
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      updateBatchJob(selectedJob.id, { pageRangeMode: 'all' })
                    }
                    className={`rounded-lg py-1.5 text-[11px] font-semibold cursor-pointer ${
                      (selectedJob.pageRangeMode ?? 'all') === 'all'
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {isFa ? 'همه صفحات' : 'All Pages'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateBatchJob(selectedJob.id, { pageRangeMode: 'custom' })
                    }
                    className={`rounded-lg py-1.5 text-[11px] font-semibold cursor-pointer ${
                      selectedJob.pageRangeMode === 'custom'
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {isFa ? 'بازه سفارشی' : 'Custom Range'}
                  </button>
                </div>

                {selectedJob.pageRangeMode === 'custom' && (
                  <div>
                    <input
                      type="text"
                      dir="ltr"
                      aria-label={isFa ? 'بازه صفحات دلخواه' : 'Custom page range'}
                      placeholder="1-5, 8, 10-12"
                      value={selectedJob.customRangeText ?? ''}
                      onChange={(e) =>
                        updateBatchJob(selectedJob.id, {
                          customRangeText: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                    <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {isFa
                        ? `صفحات انتخاب‌شده: ${selectedJobPages.length} از ${selectedJob.pageCount}`
                        : `Selected pages: ${selectedJobPages.length} of ${selectedJob.pageCount}`}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <select
                    aria-label={isFa ? 'فیلتر فرد و زوج' : 'Odd/Even filter'}
                    value={selectedJob.oddEvenFilter ?? 'all'}
                    onChange={(e) =>
                      updateBatchJob(selectedJob.id, {
                        oddEvenFilter: e.target.value as 'all' | 'odd' | 'even',
                      })
                    }
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="all">{isFa ? 'همه (فرد و زوج)' : 'All'}</option>
                    <option value="odd">{isFa ? 'فقط صفحات فرد' : 'Odd only'}</option>
                    <option value="even">{isFa ? 'فقط صفحات زوج' : 'Even only'}</option>
                  </select>

                  <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-[11px] dark:border-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedJob.reverseOrder)}
                      onChange={(e) =>
                        updateBatchJob(selectedJob.id, {
                          reverseOrder: e.target.checked,
                        })
                      }
                      className="accent-sky-600"
                    />
                    <span>{isFa ? 'چاپ معکوس' : 'Reverse'}</span>
                  </label>
                </div>
              </div>

              {/* Copies / Sets & Imposition */}
              <div className="space-y-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {isFa ? 'تعداد سری، چیدمان و رنگ' : 'Copies / Sets, N-Up & Color'}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      {isFa ? 'تعداد سری / کپی (Copies)' : 'Copies / Sets'}
                    </span>
                    <input
                      type="number"
                      aria-label={isFa ? 'تعداد سری فایل' : 'Batch Job Copies'}
                      min={1}
                      max={999}
                      value={selectedJob.copies}
                      onChange={(e) =>
                        updateBatchJob(selectedJob.id, {
                          copies: Math.max(1, Math.min(999, Number(e.target.value) || 1)),
                        })
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white tabular-nums"
                    />
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      {isFa ? 'تعداد در شیت (N-Up)' : 'Pages per Sheet'}
                    </span>
                    <select
                      aria-label={isFa ? 'تعداد صفحه در برگ' : 'Pages per sheet'}
                      value={selectedJob.nUp}
                      onChange={(e) =>
                        updateBatchJob(selectedJob.id, {
                          nUp: Number(e.target.value),
                        })
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      {[1, 2, 4, 6, 9].map((n) => (
                        <option key={n} value={n}>
                          {n}-Up
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      {isFa ? 'مقیاس چاپ' : 'Scale Mode'}
                    </span>
                    <select
                      value={selectedJob.scaleMode ?? 'fit'}
                      onChange={(e) =>
                        updateBatchJob(selectedJob.id, {
                          scaleMode: e.target.value as 'fit' | 'actual',
                        })
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="fit">{isFa ? 'متناسب با کاغذ (Fit)' : 'Fit to Paper'}</option>
                      <option value="actual">{isFa ? 'اندازه واقعی ۱۰۰٪' : 'Actual Size (100%)'}</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      {isFa ? 'حالت رنگ' : 'Color Mode'}
                    </span>
                    <select
                      value={selectedJob.colorMode ?? 'color'}
                      onChange={(e) =>
                        updateBatchJob(selectedJob.id, {
                          colorMode: e.target.value as 'color' | 'bw',
                        })
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="color">{isFa ? 'رنگی (Color)' : 'Color'}</option>
                      <option value="bw">{isFa ? 'سیاه‌وسفید (B&W)' : 'Black & White'}</option>
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedJob.collate ?? true}
                      onChange={(e) =>
                        updateBatchJob(selectedJob.id, {
                          collate: e.target.checked,
                        })
                      }
                      className="accent-sky-600"
                    />
                    <span>{isFa ? 'مرتب‌سازی سری‌ها (Collate)' : 'Collate Sets'}</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedJob.invert}
                      onChange={(e) =>
                        updateBatchJob(selectedJob.id, {
                          invert: e.target.checked,
                        })
                      }
                      className="accent-fuchsia-600"
                    />
                    <span>{isFa ? 'معکوس رنگ (Invert)' : 'Invert Colors'}</span>
                  </label>
                </div>
              </div>

              {/* Per-File Printer & Hardware Overrides */}
              <div className="space-y-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {isFa ? 'تنظیمات سخت‌افزاری این فایل' : 'Per-File Printer Hardware'}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={selectedJob.useGlobalPrinterSettings !== false}
                      onChange={(e) =>
                        updateBatchJob(selectedJob.id, {
                          useGlobalPrinterSettings: e.target.checked,
                        })
                      }
                      className="accent-sky-600"
                    />
                    {isFa ? 'پیروی از پرینتر اصلی' : 'Follow Main Printer'}
                  </span>
                </label>

                {selectedJob.useGlobalPrinterSettings === false && (
                  <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                    <label className="col-span-2 flex flex-col gap-1">
                      <span className="text-[10px] text-slate-500">
                        {isFa ? 'پرینتر اختصاصی فایل:' : 'Target Printer:'}
                      </span>
                      <select
                        value={selectedJob.printerName}
                        onChange={(e) =>
                          updateBatchJob(selectedJob.id, {
                            printerName: e.target.value,
                          })
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {printers.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] text-slate-500">
                        {isFa ? 'کاغذ:' : 'Paper:'}
                      </span>
                      <select
                        value={selectedJob.paperSize ?? 'A4'}
                        onChange={(e) => {
                          const id = e.target.value as PaperSizeId;
                          const std =
                            id !== 'Custom'
                              ? STANDARD_PAPER_SIZES[id as Exclude<PaperSizeId, 'Custom'>]
                              : null;
                          updateBatchJob(selectedJob.id, {
                            paperSize: id,
                            paperName: id,
                            ...(std
                              ? { paperWidthMm: std.widthMm, paperHeightMm: std.heightMm }
                              : {}),
                          });
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {hwPaperOptions.map((o) => (
                          <option key={`${o.id}-${o.name}`} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] text-slate-500">
                        {isFa ? 'جهت:' : 'Orientation:'}
                      </span>
                      <select
                        value={selectedJob.orientation ?? 'portrait'}
                        onChange={(e) =>
                          updateBatchJob(selectedJob.id, {
                            orientation: e.target.value as PageOrientation,
                          })
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="portrait">{isFa ? 'عمودی' : 'Portrait'}</option>
                        <option value="landscape">{isFa ? 'افقی' : 'Landscape'}</option>
                      </select>
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] text-slate-500">
                        {isFa ? 'چاپ دورو:' : 'Duplex:'}
                      </span>
                      <select
                        value={selectedJob.duplexMode}
                        onChange={(e) =>
                          updateBatchJob(selectedJob.id, {
                            duplexMode: e.target.value as DuplexMode,
                          })
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="none">{isFa ? 'تک‌رو' : 'Simplex'}</option>
                        <option value="long-edge">{isFa ? 'دورو لبه بلند' : 'Long-Edge'}</option>
                        <option value="short-edge">{isFa ? 'دورو لبه کوتاه' : 'Short-Edge'}</option>
                      </select>
                    </label>

                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] text-slate-500">
                        {isFa ? 'رزولوشن (DPI):' : 'DPI:'}
                      </span>
                      <select
                        value={selectedJob.dpi ?? 600}
                        onChange={(e) =>
                          updateBatchJob(selectedJob.id, { dpi: Number(e.target.value) })
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {(caps?.supportedDpi?.length ? caps.supportedDpi : [300, 600, 1200]).map((d) => (
                          <option key={d} value={d}>
                            {d} DPI
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Column 3: Full Printer Hardware Capabilities, Virtual Printer & Spooler (4 cols) */}
        <div
          data-batch-hardware-panel
          className="lg:col-span-4 flex flex-col gap-3"
        >
          {/* Active Printer Hardware Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
              <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-white">
                <SlidersHorizontal className="h-4 w-4 text-emerald-500" />
                <span>
                  {isFa
                    ? 'پرینتر و امکانات کامل سخت‌افزاری'
                    : 'Printer & Full Driver Hardware'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <PrinterRetryButton compact />
                <button
                  type="button"
                  onClick={autoSelectBestPrinter}
                  className="flex items-center gap-1 rounded bg-sky-100 px-2 py-1 text-[10px] font-bold text-sky-700 hover:bg-sky-200 dark:bg-sky-500/20 dark:text-sky-300 cursor-pointer"
                >
                  <Cpu className="h-3 w-3" />
                  <span>{isFa ? 'خودکار' : 'Auto'}</span>
                </button>
              </div>
            </div>

            <PrinterServiceStatus />

            <div className="mt-2 space-y-2.5">
              <div className="flex items-center gap-2">
                <select
                  aria-label={isFa ? 'انتخاب پرینتر در چاپ دسته‌ای' : 'Batch target printer'}
                  value={selectedPrinterName}
                  onChange={(e) => selectPrinter(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {printers.length === 0 && (
                    <option value="">
                      {isFa ? '— پرینتری شناسایی نشد —' : '— No printer detected —'}
                    </option>
                  )}
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!activePrinter}
                  onClick={() => activePrinter && void openPrinterPreferences(activePrinter.name)}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 dark:border-emerald-500/40 dark:bg-emerald-600/15 dark:text-emerald-300 cursor-pointer whitespace-nowrap"
                >
                  {isFa ? 'درایور ویندوز' : 'Driver UI'}
                </button>
              </div>

              {activePrinter && caps && prof && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 tabular-nums">
                    <span className="flex items-center gap-1 font-semibold">
                      {activePrinter.status === 'Ready' ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      ) : (
                        <AlertCircle className="h-3 w-3 text-amber-500" />
                      )}
                      {activePrinter.driverName}
                    </span>
                    <span>
                      {isFa ? 'حداکثر کپی:' : 'Max Copies:'} <strong>{caps.maxCopies}</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {isFa ? 'اندازه کاغذ درایور' : 'Driver Paper Size'}
                      </span>
                      <select
                        value={selectedHwPaperName}
                        onChange={(e) => {
                          const opt = hwPaperOptions.find(
                            (o) => o.name === e.target.value || o.id === e.target.value
                          );
                          if (!opt) return;
                          void updatePrinterProfile(activePrinter.name, {
                            paperSize: opt.id,
                            paperName: opt.name,
                            paperWidthMm: Math.min(opt.widthMm, opt.heightMm),
                            paperHeightMm: Math.max(opt.widthMm, opt.heightMm),
                          });
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white tabular-nums"
                      >
                        {hwPaperOptions.map((o) => (
                          <option key={`${o.id}-${o.name}`} value={o.name}>
                            {o.name} ({Math.round(o.widthMm)}×{Math.round(o.heightMm)} mm)
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {isFa ? 'سینی کاغذ (Tray)' : 'Paper Tray'}
                      </span>
                      <select
                        value={prof.tray}
                        onChange={(e) =>
                          void updatePrinterProfile(activePrinter.name, { tray: e.target.value })
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {(caps.supportedTrays.length ? caps.supportedTrays : ['Auto Select']).map((trItem) => (
                          <option key={trItem} value={trItem}>
                            {trItem}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {isFa ? 'جنس کاغذ (Media)' : 'Media Type'}
                      </span>
                      <select
                        value={prof.mediaType}
                        onChange={(e) =>
                          void updatePrinterProfile(activePrinter.name, {
                            mediaType: e.target.value,
                          })
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {(caps.supportedMediaTypes.length ? caps.supportedMediaTypes : ['Plain Paper']).map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {isFa ? 'جهت و دورو' : 'Orientation & Duplex'}
                      </span>
                      <div className="flex gap-1">
                        <select
                          value={prof.orientation}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, {
                              orientation: e.target.value as PageOrientation,
                            })
                          }
                          className="w-1/2 rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="portrait">{isFa ? 'عمودی' : 'Portrait'}</option>
                          <option value="landscape">{isFa ? 'افقی' : 'Landscape'}</option>
                        </select>
                        <select
                          value={prof.duplexMode}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, {
                              duplexMode: e.target.value as DuplexMode,
                            })
                          }
                          className="w-1/2 rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="none">{isFa ? 'تک‌رو' : 'Simplex'}</option>
                          <option value="long-edge">{isFa ? 'لبه بلند' : 'Long-Edge'}</option>
                          <option value="short-edge">{isFa ? 'لبه کوتاه' : 'Short-Edge'}</option>
                        </select>
                      </div>
                    </label>

                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {isFa ? 'رزولوشن (DPI) و رنگ' : 'DPI & Color'}
                      </span>
                      <div className="flex gap-1">
                        <select
                          value={prof.dpi}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, {
                              dpi: Number(e.target.value),
                            })
                          }
                          className="w-1/2 rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white tabular-nums"
                        >
                          {(caps.supportedDpi.length ? caps.supportedDpi : [300, 600]).map((d) => (
                            <option key={d} value={d}>
                              {d} DPI
                            </option>
                          ))}
                        </select>
                        <select
                          disabled={!caps.supportsColor}
                          value={caps.supportsColor ? prof.colorMode : 'monochrome'}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, {
                              colorMode: e.target.value as 'color' | 'monochrome',
                            })
                          }
                          className="w-1/2 rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-slate-900 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          {caps.supportsColor && (
                            <option value="color">{isFa ? 'رنگی' : 'Color'}</option>
                          )}
                          <option value="monochrome">{isFa ? 'تک‌رنگ' : 'Mono'}</option>
                        </select>
                      </div>
                    </label>

                    <label className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {isFa ? 'کیفیت چاپ' : 'Print Quality'}
                      </span>
                      <select
                        value={prof.quality}
                        onChange={(e) =>
                          void updatePrinterProfile(activePrinter.name, {
                            quality: e.target.value as 'draft' | 'normal' | 'high',
                          })
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        <option value="draft">{isFa ? 'سریع (Draft)' : 'Draft'}</option>
                        <option value="normal">{isFa ? 'معمولی (Normal)' : 'Normal'}</option>
                        <option value="high">{isFa ? 'عالی (High)' : 'High'}</option>
                      </select>
                    </label>

                    {((caps.supportedStapleModes?.length ?? 0) > 1 || caps.supportsStaple) && (
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {isFa ? 'منگنه (Staple)' : 'Staple'}
                        </span>
                        <select
                          value={prof.staple ?? 'None'}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, { staple: e.target.value })
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          {(caps.supportedStapleModes ?? ['None', 'TopLeft']).map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {(caps.supportedOutputBins?.length ?? 0) > 0 && (
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {isFa ? 'سینی خروجی' : 'Output Bin'}
                        </span>
                        <select
                          value={prof.outputBin ?? caps.supportedOutputBins![0]}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, {
                              outputBin: e.target.value,
                            })
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          {caps.supportedOutputBins!.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2 dark:border-slate-800">
                    <div className="flex items-center gap-3 text-[11px]">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={prof.collate ?? true}
                          onChange={(e) =>
                            void updatePrinterProfile(activePrinter.name, {
                              collate: e.target.checked,
                            })
                          }
                          className="accent-sky-600"
                        />
                        <span>Collate</span>
                      </label>
                      {caps.supportsBorderless && (
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(prof.borderless)}
                            onChange={(e) =>
                              void updatePrinterProfile(activePrinter.name, {
                                borderless: e.target.checked,
                              })
                            }
                            className="accent-sky-600"
                          />
                          <span>{isFa ? 'بدون حاشیه' : 'Borderless'}</span>
                        </label>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={batchQueue.length === 0}
                      onClick={applyPrinterProfileToAllBatchJobs}
                      className="rounded-lg bg-sky-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-40 cursor-pointer"
                    >
                      {isFa ? 'اعمال به کل صف' : 'Apply to All Jobs'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Windows Virtual Printer Settings & Installer */}
          <VirtualPrinterCard compact />

          {/* Compact Live Spooler Queue Manager */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-bold text-slate-900 dark:text-white">
                {isFa
                  ? `صف Spooler ویندوز (${spoolerJobs.length})`
                  : `Windows Spooler Queue (${spoolerJobs.length})`}
              </span>
              {selectedPrinterName && (
                <button
                  type="button"
                  onClick={() => void purgePrinterQueue(selectedPrinterName)}
                  className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-200 dark:bg-rose-500/15 dark:text-rose-300 cursor-pointer"
                >
                  {isFa ? 'پاک‌سازی صف' : 'Purge'}
                </button>
              )}
            </div>
            {spoolerJobs.length === 0 ? (
              <div className="py-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
                {isFa ? 'کار فعالی در صف اسپولر نیست' : 'No active jobs in Windows Spooler'}
              </div>
            ) : (
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {spoolerJobs.map((job) => (
                  <div
                    key={job.jobId}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] dark:border-slate-800"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">
                        #{job.jobId} {job.documentTitle}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {job.status} • {job.pagesPrinted}/{job.totalPages}p
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          void controlSpoolerJob(
                            job.printerName,
                            job.jobId,
                            job.status === 'Paused' ? 'resume' : 'pause'
                          )
                        }
                        className="rounded p-1 text-amber-600 hover:bg-amber-50 dark:text-amber-300 cursor-pointer"
                      >
                        {job.status === 'Paused' ? (
                          <Play className="h-3 w-3" />
                        ) : (
                          <Pause className="h-3 w-3" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void controlSpoolerJob(job.printerName, job.jobId, 'cancel')
                        }
                        className="rounded p-1 text-rose-600 hover:bg-rose-50 dark:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
