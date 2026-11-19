import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../components/AppShell';
import { ToolButton } from '../components/ToolButton';
import { ToolRail } from '../components/ToolRail';
import { QuickBar } from '../components/QuickBar';
import { StatusBar } from '../components/StatusBar';
import { useAppStore } from '../store/useAppStore';

const labels = {
  topbar: 'Quick access toolbar',
  navigation: 'Tool navigation',
  workspace: 'Workspace and preview',
  status: 'Application status',
};

describe('application shell UI', () => {
  it('keeps the chrome, workspace, status and overlay layers in distinct regions', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AppShell, {
        theme: 'dark',
        labels,
        topbar: React.createElement('span', null, 'topbar-content'),
        navigation: React.createElement('span', null, 'navigation-content'),
        workspace: React.createElement('span', null, 'workspace-content'),
        statusBar: React.createElement('span', null, 'status-content'),
        overlays: React.createElement('span', null, 'overlay-content'),
      }),
    );

    expect(markup).toContain('data-psp-app-shell');
    expect(markup).toContain('aria-label="Quick access toolbar"');
    expect(markup).toContain('aria-label="Tool navigation"');
    expect(markup).toContain('aria-label="Workspace and preview"');
    expect(markup).toContain('aria-label="Application status"');
    expect(markup).toContain('psp-app-shell__workspace');
    expect(markup).toContain('psp-app-shell__layers');
    expect(markup.indexOf('topbar-content')).toBeLessThan(markup.indexOf('workspace-content'));
    expect(markup.indexOf('workspace-content')).toBeLessThan(markup.indexOf('status-content'));
  });

  it('retains the light theme class at the shell boundary', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AppShell, {
        theme: 'light',
        labels: { topbar: 'Top', navigation: 'Nav', workspace: 'Work', status: 'Status' },
        topbar: null,
        navigation: null,
        workspace: null,
        statusBar: null,
      }),
    );

    expect(markup).toContain('theme-light invert hue-rotate-180');
  });
});

describe('ToolButton UI', () => {
  it('exposes an accessible label, a tooltip hook and pressed state', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ToolButton, {
        icon: React.createElement('span', null, 'icon'),
        label: 'Save document',
        active: true,
        variant: 'primary',
      }),
    );

    expect(markup).toContain('data-tooltip="Save document"');
    expect(markup).toContain('aria-label="Save document"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('data-tool-button');
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain('class="sr-only"');
  });

  it('can show its label for controls that need text as well as an icon', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ToolButton, {
        icon: React.createElement('span', null, 'icon'),
        label: 'Print now',
        showLabel: true,
        size: 'lg',
      }),
    );

    expect(markup).toContain('whitespace-nowrap');
    expect(markup).toContain('Print now');
  });
});

describe('ToolRail UI', () => {
  it('renders all nine canonical ribbon groups as accessible icon-first controls', () => {
    const markup = renderToStaticMarkup(React.createElement(ToolRail));

    expect(markup).toContain('data-tool-rail');
    expect((markup.match(/data-tool-button/g) ?? []).length).toBe(9);
    expect(markup).toContain('aria-label="چیدمان صفحه (Layout)"');
    expect(markup).toContain('aria-pressed="true"');
  });
});

describe('workspace drawer state', () => {
  it('keeps Batch and Printers drawers mutually exclusive and allows explicit close', () => {
    const store = useAppStore.getState();
    store.setWorkspaceDrawer('batch');
    expect(useAppStore.getState().workspaceDrawer).toBe('batch');
    useAppStore.getState().setWorkspaceDrawer('printers');
    expect(useAppStore.getState().workspaceDrawer).toBe('printers');
    useAppStore.getState().setWorkspaceDrawer('closed');
    expect(useAppStore.getState().workspaceDrawer).toBe('closed');
    useAppStore.getState().setActiveRibbonTab('layout');
    expect(useAppStore.getState().workspaceDrawer).toBeNull();
  });
});

describe('topbar and status bar roles', () => {
  it('keeps the Counter trigger in QuickBar and leaves StatusBar informational', () => {
    const quickBarMarkup = renderToStaticMarkup(React.createElement(QuickBar));
    const statusMarkup = renderToStaticMarkup(
      React.createElement(StatusBar, { cursorPos: null }),
    );

    expect((quickBarMarkup.match(/data-counter-trigger/g) ?? []).length).toBe(1);
    expect(statusMarkup).toContain('data-status-bar-info');
    expect(statusMarkup).not.toContain('data-counter-trigger');
    expect(statusMarkup).not.toContain('type="range"');
    expect(statusMarkup).not.toContain('Zoom Slider');
  });
});
