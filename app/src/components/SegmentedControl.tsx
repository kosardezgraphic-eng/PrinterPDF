import React, { type ReactNode } from 'react';

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedControlProps<Value extends string> {
  ariaLabel: string;
  value: Value;
  options: readonly SegmentedOption<Value>[];
  onChange: (value: Value) => void;
  className?: string;
}

export function SegmentedControl<Value extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  className = '',
}: SegmentedControlProps<Value>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-segmented-control
      className={`psp-segmented-control flex min-w-0 flex-wrap items-center gap-1 rounded-lg border border-slate-700 bg-slate-950/60 p-1 ${className}`}
    >
      {options.map(option => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.label}
            data-segment-option={option.value}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${active
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
          >
            {option.icon && <span className="shrink-0" aria-hidden="true">{option.icon}</span>}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
