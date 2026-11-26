import React, { type ReactNode } from 'react';

export interface AppShellLabels {
  topbar: string;
  navigation: string;
  workspace: string;
  status: string;
}

interface AppShellProps {
  theme: string;
  labels: AppShellLabels;
  topbar: ReactNode;
  navigation?: ReactNode;
  workspace: ReactNode;
  statusBar: ReactNode;
  overlays?: ReactNode;
}

/**
 * Owns the fixed application chrome. The workspace is the only flexible grid row,
 * so the viewport—not nested toolbars—controls the available canvas height.
 */
export const AppShell: React.FC<AppShellProps> = ({
  theme,
  labels,
  topbar,
  navigation,
  workspace,
  statusBar,
  overlays,
}) => {
  const prefersDark =
    theme === 'system' &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolvedDark = theme === 'dark' || prefersDark;

  return (
    <div
      className={`psp-app-shell ${resolvedDark ? 'theme-dark dark' : 'theme-light'}`}
      data-psp-app-shell
      style={
        navigation
          ? undefined
          : { gridTemplateRows: 'max-content minmax(0, 1fr) max-content' }
      }
    >
      <header className="psp-app-shell__topbar" aria-label={labels.topbar}>
        {topbar}
      </header>
      {navigation ? (
        <nav className="psp-app-shell__navigation" aria-label={labels.navigation}>
          {navigation}
        </nav>
      ) : null}
      <main className="psp-app-shell__workspace" aria-label={labels.workspace}>
        {workspace}
      </main>
      <div className="psp-app-shell__status" role="region" aria-label={labels.status}>
        {statusBar}
      </div>
      <div className="psp-app-shell__layers">{overlays}</div>
    </div>
  );
};

