import React, { type ReactNode } from 'react';

export type TooltipSide = 'top' | 'bottom' | 'inline-start' | 'inline-end';

interface TooltipProps {
  label: string;
  side?: TooltipSide;
  children: ReactNode;
}

/**
 * Lightweight tooltip rendered inside the application tree (no document.body portal).
 * The visual delay is controlled by --psp-tooltip-delay in index.css.
 */
export const Tooltip: React.FC<TooltipProps> = ({
  label,
  side = 'top',
  children,
}) => (
  <span
    className={`psp-tooltip psp-tooltip--${side}`}
    data-tooltip={label}
  >
    {children}
  </span>
);
