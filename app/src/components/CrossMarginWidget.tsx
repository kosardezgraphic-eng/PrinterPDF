import React from 'react';
import { Crosshair } from 'lucide-react';

export type MarginSide = 'top' | 'right' | 'bottom' | 'left';
export type GutterField = 'horizontalGutterMm' | 'verticalGutterMm';

interface MarginWidgetProps {
  language: 'fa' | 'en';
  margins: Record<MarginSide, number>;
  minimums: Record<MarginSide, number>;
  step: number;
  horizontalGutterMm: number;
  verticalGutterMm: number;
  bookletEnabled: boolean;
  onMarginChange: (side: MarginSide, value: number) => void;
  onGutterChange: (field: GutterField, value: number) => void;
}

export const CrossMarginWidget: React.FC<MarginWidgetProps> = ({
  language,
  margins,
  minimums,
  step,
  horizontalGutterMm,
  verticalGutterMm,
  bookletEnabled,
  onMarginChange,
  onGutterChange,
}) => {
  const fa = language === 'fa';
  const labels: Record<MarginSide, string> = fa
    ? { top: 'بالا', right: 'راست', bottom: 'پایین', left: 'چپ' }
    : { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' };

  const field = (side: MarginSide) => (
    <label
      key={side}
      data-margin-side={side}
      className="flex min-w-0 flex-col items-center gap-0.5 text-[9px] text-slate-400"
      title={fa ? `حاشیه ${labels[side]}؛ حداقل ${minimums[side]} میلی‌متر` : `${labels[side]} margin; printer minimum ${minimums[side]} mm`}
    >
      <span>{labels[side]}</span>
      <input
        type="number"
        min={minimums[side]}
        max={200}
        step={step}
        aria-label={fa ? `حاشیه ${labels[side]}` : `${labels[side]} margin`}
        value={Math.max(minimums[side], margins[side])}
        onChange={event => onMarginChange(side, Number(event.target.value) || 0)}
        className="w-full min-w-0 rounded border border-slate-700 bg-slate-800 px-1 py-1 text-center text-[10px] font-mono text-white tabular-nums"
      />
    </label>
  );

  return (
    <section data-cross-margin-widget className="flex min-w-0 flex-col gap-2 rounded-lg border border-slate-700 bg-slate-950/40 p-2">
      <div className="mx-auto grid w-full max-w-[13rem] grid-cols-3 items-center gap-1">
        <span />
        {field('top')}
        <span />
        {field('left')}
        <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-900/70 text-sky-400">
          <Crosshair className="h-5 w-5" aria-hidden="true" />
        </div>
        {field('right')}
        <span />
        {field('bottom')}
        <span />
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-slate-800 pt-2">
        <label className="flex min-w-0 flex-col gap-0.5 text-[9px] text-slate-400">
          <span>{fa ? 'فاصله افقی / شیرازه' : 'Horizontal gutter / spine'} (mm)</span>
          <input
            type="number"
            min={0}
            max={bookletEnabled ? 30 : 200}
            step={bookletEnabled ? 0.5 : 1}
            aria-label={fa ? 'فاصله افقی و شیرازه' : 'Horizontal gutter and booklet spine'}
            data-gutter-axis="horizontal"
            value={horizontalGutterMm}
            onChange={event => onGutterChange('horizontalGutterMm', Math.max(0, Math.min(200, Number(event.target.value) || 0)))}
            className="w-full min-w-0 rounded border border-slate-700 bg-slate-800 px-1 py-1 text-center text-[10px] font-mono text-white tabular-nums"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 text-[9px] text-slate-400">
          <span>{fa ? 'فاصله عمودی' : 'Vertical gutter'} (mm)</span>
          <input
            type="number"
            min={0}
            max={200}
            step={1}
            disabled={bookletEnabled}
            aria-label={fa ? 'فاصله عمودی' : 'Vertical gutter'}
            data-gutter-axis="vertical"
            value={verticalGutterMm}
            onChange={event => onGutterChange('verticalGutterMm', Math.max(0, Math.min(200, Number(event.target.value) || 0)))}
            className="w-full min-w-0 rounded border border-slate-700 bg-slate-800 px-1 py-1 text-center text-[10px] font-mono text-white tabular-nums disabled:opacity-40"
          />
        </label>
      </div>
    </section>
  );
};
