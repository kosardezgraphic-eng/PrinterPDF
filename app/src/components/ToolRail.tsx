import React from 'react';
import {
  FolderOpen,
  LayoutGrid,
  Sparkles,
  Type,
  Crop,
  FileStack,
  Layers,
  Printer,
  Eye,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAppStore, type RibbonTabId } from '../store/useAppStore';
import { t } from '../i18n/translations';
import { ToolButton } from './ToolButton';

export const ToolRail: React.FC = () => {
  const {
    activeRibbonTab,
    ribbonCollapsed,
    settings,
    batchQueue,
    effects,
    workspaceDrawer,
    setActiveRibbonTab,
    setRibbonCollapsed,
    setWorkspaceDrawer,
  } = useAppStore();

  const tr = t(settings.language);
  const tabs: Array<{ id: RibbonTabId; label: string; icon: React.ReactNode }> = [
    { id: 'file', label: tr.ribbonTabs.file, icon: <FolderOpen className="h-4 w-4" /> },
    { id: 'layout', label: tr.ribbonTabs.layout, icon: <LayoutGrid className="h-4 w-4" /> },
    { id: 'effects', label: tr.ribbonTabs.effects, icon: <Sparkles className="h-4 w-4" /> },
    { id: 'insert', label: tr.ribbonTabs.insert, icon: <Type className="h-4 w-4" /> },
    { id: 'crop', label: tr.ribbonTabs.crop, icon: <Crop className="h-4 w-4" /> },
    { id: 'pdf', label: tr.ribbonTabs.pdf, icon: <FileStack className="h-4 w-4" /> },
    { id: 'batch', label: tr.ribbonTabs.batch, icon: <Layers className="h-4 w-4" /> },
    { id: 'printers', label: tr.ribbonTabs.printers, icon: <Printer className="h-4 w-4" /> },
    { id: 'view', label: tr.ribbonTabs.view, icon: <Eye className="h-4 w-4" /> },
  ];

  return (
    <aside
      className="psp-tool-rail flex h-full min-h-0 shrink-0 flex-col items-center gap-1 border-e border-slate-800 bg-slate-950/95 px-1.5 py-2"
      aria-label={tr.shell.toolRail}
      data-tool-rail
    >
      <div className="flex min-h-0 w-full flex-col items-center gap-1">
        {tabs.map((tab) => (
          <div key={tab.id} className="relative">
            <ToolButton
              icon={tab.icon}
              label={tab.label}
              active={activeRibbonTab === tab.id}
              size="md"
              tooltipSide="inline-end"
              onClick={() => {
                const drawerAlreadyOpen = workspaceDrawer === tab.id
                  || (workspaceDrawer === null && activeRibbonTab === tab.id);
                setActiveRibbonTab(tab.id);
                if (ribbonCollapsed) setRibbonCollapsed(false);
                if (tab.id === 'batch' || tab.id === 'printers') {
                  setWorkspaceDrawer(drawerAlreadyOpen ? 'closed' : tab.id);
                } else {
                  setWorkspaceDrawer(null);
                }
              }}
              className="h-9 w-9"
            />
            {tab.id === 'batch' && batchQueue.length > 0 && (
              <span
                className="pointer-events-none absolute -end-1 -top-1 min-w-4 rounded-full bg-sky-500 px-1 text-center text-[9px] font-bold leading-4 text-white"
                aria-label={settings.language === 'fa'
                  ? `${batchQueue.length} کار در صف`
                  : `${batchQueue.length} batch jobs`}
              >
                {batchQueue.length}
              </span>
            )}
            {tab.id === 'effects' && effects.invert && (
              <span
                className="pointer-events-none absolute end-0 top-0 h-2 w-2 rounded-full bg-fuchsia-400 ring-2 ring-slate-950"
                aria-label={tr.statusBar.invertActive}
              />
            )}
          </div>
        ))}
      </div>
      {ribbonCollapsed && (
        <ToolButton
          icon={settings.language === 'fa'
            ? <ChevronLeft className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />}
          label={tr.shell.expandToolPanel}
          size="md"
          tooltipSide="inline-end"
          onClick={() => setRibbonCollapsed(false)}
          className="h-9 w-9"
        />
      )}
    </aside>
  );
};
