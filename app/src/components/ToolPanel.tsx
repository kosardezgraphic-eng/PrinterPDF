import React from 'react';
import { ChevronLeft, SlidersHorizontal } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { t } from '../i18n/translations';
import { ToolButton } from './ToolButton';
import { Ribbon } from './Ribbon';

interface ToolPanelProps {
  onOpenWatermarkPanel: () => void;
  onOpenBookletPanel: () => void;
  onOpenProperties: () => void;
  hasSelectedOverlay: boolean;
}

export const ToolPanel: React.FC<ToolPanelProps> = ({
  onOpenWatermarkPanel,
  onOpenBookletPanel,
  onOpenProperties,
  hasSelectedOverlay,
}) => {
  const { activeRibbonTab, ribbonCollapsed, settings, setRibbonCollapsed } = useAppStore();
  const tr = t(settings.language);

  return (
    <aside
      className={`psp-tool-panel ${ribbonCollapsed ? 'psp-tool-panel--collapsed' : ''}`}
      aria-label={tr.shell.toolPanel}
      aria-hidden={ribbonCollapsed}
      data-tool-panel
    >
      {!ribbonCollapsed && (
        <>
          <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/80 px-3">
            <h2 className="min-w-0 truncate text-xs font-bold text-slate-100">
              {tr.ribbonTabs[activeRibbonTab]}
            </h2>
            {hasSelectedOverlay && (
              <ToolButton
                icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
                label={tr.shell.propertiesDock.showToolsReturn}
                size="sm"
                onClick={onOpenProperties}
              />
            )}
            <ToolButton
              icon={<ChevronLeft className="h-4 w-4 rtl:rotate-180" />}
              label={tr.shell.collapseToolPanel}
              size="sm"
              onClick={() => setRibbonCollapsed(true)}
            />
          </header>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <Ribbon
              panelMode
              onOpenWatermarkPanel={onOpenWatermarkPanel}
              onOpenBookletPanel={onOpenBookletPanel}
            />
          </div>
        </>
      )}
    </aside>
  );
};
