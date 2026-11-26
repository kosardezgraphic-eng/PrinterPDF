import React, { type ReactNode } from 'react';
import {
  BookOpen,
  Droplets,
  Image as ImageIcon,
  ListOrdered,
  Shapes,
  Type,
  Wrench,
  X,
} from 'lucide-react';
import { ToolButton } from './ToolButton';

export type PropertiesPanelId = 'text' | 'numbering' | 'image' | 'shape' | 'watermark' | 'booklet';

export interface PropertiesDockLabels {
  title: string;
  showTools: string;
  showToolsReturn: string;
  close: string;
  tabs: Record<PropertiesPanelId, string>;
}

interface PropertiesDockProps {
  activePanel: PropertiesPanelId;
  onSelectPanel: (panel: PropertiesPanelId) => void;
  onShowTools: () => void;
  onClose: () => void;
  labels: PropertiesDockLabels;
  children: ReactNode;
}

const panelOrder: PropertiesPanelId[] = ['text', 'numbering', 'image', 'shape', 'watermark', 'booklet'];

const panelIcons: Record<PropertiesPanelId, React.ReactNode> = {
  text: <Type className="h-3.5 w-3.5" />,
  numbering: <ListOrdered className="h-3.5 w-3.5" />,
  image: <ImageIcon className="h-3.5 w-3.5" />,
  shape: <Shapes className="h-3.5 w-3.5" />,
  watermark: <Droplets className="h-3.5 w-3.5" />,
  booklet: <BookOpen className="h-3.5 w-3.5" />,
};

export const PropertiesDock: React.FC<PropertiesDockProps> = ({
  activePanel,
  onSelectPanel,
  onShowTools,
  onClose,
  labels,
  children,
}) => (
  <aside
    data-properties-dock
    className="psp-properties-dock flex min-h-0 min-w-0 shrink-0 flex-col border-s border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
    aria-label={labels.title}
  >
    <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-2 dark:border-slate-700 dark:bg-slate-950/80">
      <strong className="min-w-0 truncate text-xs text-slate-800 dark:text-slate-100">{labels.title}</strong>
      <div className="flex shrink-0 items-center gap-1">
        <ToolButton icon={<Wrench className="h-3.5 w-3.5" />} label={labels.showTools} size="sm" onClick={onShowTools} />
        <ToolButton icon={<X className="h-3.5 w-3.5" />} label={labels.close} size="sm" variant="danger" onClick={onClose} />
      </div>
    </header>
    <nav className="grid shrink-0 grid-cols-3 gap-1 border-b border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900" aria-label={labels.title}>
      {panelOrder.map(panel => (
        <ToolButton
          key={panel}
          icon={panelIcons[panel]}
          label={labels.tabs[panel]}
          active={activePanel === panel}
          showLabel
          size="sm"
          onClick={() => onSelectPanel(panel)}
          className="w-full min-w-0 justify-start rounded-md text-[10px]"
        />
      ))}
    </nav>
    <div className="psp-properties-dock__body min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
  </aside>
);
