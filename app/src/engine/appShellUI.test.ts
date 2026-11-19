import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../components/AppShell';
import { ToolButton } from '../components/ToolButton';

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
