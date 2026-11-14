import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

/**
 * Retry control that sits next to any printer picker. The list is only ever as good as the
 * sidecar call behind it, so refreshing has to be one click away rather than an app restart.
 */
export function PrinterRetryButton({ compact = false }: { compact?: boolean }) {
  const retryPrinters = useAppStore((s) => s.retryPrinters);
  const isRefreshing = useAppStore((s) => s.isRefreshingPrinters);
  const isFa = useAppStore((s) => s.settings.language === 'fa');

  const label = isFa ? 'تلاش مجدد برای خواندن پرینترها' : 'Retry reading printers';

  return (
    <button
      type="button"
      onClick={() => void retryPrinters()}
      disabled={isRefreshing}
      title={label}
      aria-label={label}
      className={`flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/70 font-medium text-slate-200 hover:bg-slate-700 disabled:cursor-progress disabled:opacity-50 cursor-pointer ${
        compact ? 'p-1.5' : 'px-3 py-2 text-xs'
      }`}
    >
      <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
      {!compact && (isFa ? 'تلاش مجدد' : 'Retry')}
    </button>
  );
}

/**
 * Explains why the printer list is empty or stale. An empty select is never a diagnosis: this
 * prints the sidecar's own words (missing PrinterService.exe, unreachable named pipe, dead or
 * failed-to-start service, spooler error) so the fix is obvious.
 */
export function PrinterServiceStatus() {
  const printers = useAppStore((s) => s.printers);
  const error = useAppStore((s) => s.printerServiceError);
  const note = useAppStore((s) => s.printerServiceNote);
  const isFa = useAppStore((s) => s.settings.language === 'fa');

  const message = error ?? note;
  const show = printers.length === 0 || Boolean(error);
  if (!show) return null;

  const text =
    message ??
    (isFa
      ? 'سرویس چاپگر فهرست خالی برگرداند: ویندوز پرینتری نصب نکرده یا Spooler آن را نمی‌بیند.'
      : 'The print service returned an empty list: Windows has no printers installed, or the spooler does not see them.');

  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-xl border border-amber-700/50 bg-amber-950/30 p-3 text-xs leading-5 text-amber-200"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <div className="min-w-0 space-y-2">
        <p className="font-bold text-amber-100">
          {isFa ? 'فهرست پرینترها خوانده نشد' : 'The printer list could not be read'}
        </p>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-sans text-[11px] text-amber-200/90">
          {text}
        </pre>
        <p className="text-[11px] text-amber-200/70">
          {isFa
            ? 'روی ویندوز: npm run build:service و بعد npm run electron:dev. در مرورگر، این برنامه عملاً به پرینتر واقعی دسترسی ندارد.'
            : 'On Windows run: npm run build:service, then npm run electron:dev. A browser preview can never reach real printers.'}
        </p>
        <PrinterRetryButton />
      </div>
    </div>
  );
}
