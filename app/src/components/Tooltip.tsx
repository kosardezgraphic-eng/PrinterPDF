import React, { type ReactNode } from 'react';
import { formatTooltipWithShortcut } from '../engine/shortcutsCatalog';

export type TooltipSide = 'top' | 'bottom' | 'inline-start' | 'inline-end';

interface TooltipProps {
  label: string;
  shortcut?: string;
  side?: TooltipSide;
  children: ReactNode;
}

/**
 * Lightweight tooltip rendered inside the application tree (no document.body portal).
 * The visual delay is controlled by --psp-tooltip-delay in index.css.
 */
export const Tooltip: React.FC<TooltipProps> = ({
  label,
  shortcut,
  side = 'top',
  children,
}) => (
  <span
    className={`psp-tooltip psp-tooltip--${side}`}
    data-tooltip={formatTooltipWithShortcut(label, shortcut)}
  >
    {children}
  </span>
);
