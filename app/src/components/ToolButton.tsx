import React, { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip, type TooltipSide } from './Tooltip';

export type ToolButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ToolButtonSize = 'sm' | 'md' | 'lg';

export interface ToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  active?: boolean;
  variant?: ToolButtonVariant;
  size?: ToolButtonSize;
  showLabel?: boolean;
  tooltipSide?: TooltipSide;
}

const variantClasses: Record<ToolButtonVariant, string> = {
  primary: 'border border-sky-500/60 bg-sky-600 text-white hover:bg-sky-500',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
  ghost: 'border border-transparent bg-transparent text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white',
  danger: 'border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200 dark:hover:bg-rose-500/20',
};

const sizeClasses: Record<ToolButtonSize, string> = {
  sm: 'min-h-7 min-w-7 gap-1 px-1.5 text-[11px]',
  md: 'min-h-9 min-w-9 gap-1.5 px-2 text-xs',
  lg: 'min-h-10 min-w-10 gap-2 px-2.5 text-sm',
};

/** Icon-first action button with a consistent tooltip and keyboard-accessible label. */
export const ToolButton: React.FC<ToolButtonProps> = ({
  icon,
  label,
  active,
  variant = 'ghost',
  size = 'md',
  showLabel = false,
  tooltipSide = 'top',
  className = '',
  type = 'button',
  ...buttonProps
}) => (
  <Tooltip label={label} side={tooltipSide}>
    <button
      {...buttonProps}
      type={type}
      aria-label={label}
      aria-pressed={active}
      data-tool-button
      data-active={active ? 'true' : undefined}
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-[var(--psp-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
        'disabled:pointer-events-none disabled:opacity-40',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].filter(Boolean).join(' ')}
    >
      <span className="inline-flex shrink-0 items-center justify-center" aria-hidden="true">
        {icon}
      </span>
      <span className={showLabel ? 'whitespace-nowrap' : 'sr-only'}>
        {label}
      </span>
    </button>
  </Tooltip>
);
