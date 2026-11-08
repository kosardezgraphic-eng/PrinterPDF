import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

/**
 * Principle #1: Global Error Boundary with clear Persian diagnosis and recovery action.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'خطای غیرمنتظره در رندر رابط کاربری',
    };
  }

  private handleRecover = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 p-6 text-slate-100"
        >
          <div className="max-w-lg rounded-2xl border border-rose-500/40 bg-slate-900 p-8 shadow-2xl">
            <div className="mb-4 flex items-center gap-3 text-rose-400">
              <AlertTriangle className="h-8 w-8 shrink-0" />
              <h1 className="text-xl font-bold">
                خطایی در نمایش بخش فعلی رخ داد (بدون از دست رفتن پروژه)
              </h1>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-slate-300">
              پرونده‌ها و تنظیمات چیدمان شما در حافظه ایمن هستند. برای ادامه کار روی دکمه زیر کلیک کنید.
            </p>
            <div className="mb-6 rounded-lg bg-slate-950/90 p-3 font-mono text-xs text-slate-400">
              {this.state.errorMessage}
            </div>
            <button
              type="button"
              onClick={this.handleRecover}
              className="flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-500"
            >
              <RotateCcw className="h-4 w-4" />
              <span>بازگردانی فوری محیط کار</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
