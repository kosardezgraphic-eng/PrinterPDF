import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../components/AppShell';
import { ToolButton } from '../components/ToolButton';

describe('application shell UI', () => {
  it('keeps the chrome, workspace, status and overlay layers in distinct regions', () => {
    const markup = renderToStaticMarkup(
      <AppShell
        theme="dark"
        labels={{
          topbar: 'Quick access toolbar',
          navigation: 'Tool navigation',
          workspace: 'Workspace and preview',
          status: 'Application status',
        }}
        topbar={<span>topbar-content</span>}
        navigation={<span>navigation-content</span>}
        workspace={<span>workspace-content</span>}
        statusBar={<span>status-content</span>}
        overlays={<span>overlay-content</span>}
      />,
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
      <AppShell
        theme="light"
        labels={{ topbar: 'Top', navigation: 'Nav', workspace: 'Work', status: 'Status' }}
        topbar={null}
        navigation={null}
        workspace={null}
        statusBar={null}
      />,
    );

    expect(markup).toContain('theme-light invert hue-rotate-180');
  });
});

describe('ToolButton UI', () => {
  it('exposes an accessible label, a delayed-tooltip hook and pressed state', () => {
    const markup = renderToStaticMarkup(
      <ToolButton
        icon={<span>icon</span>}
        label="Save document"
        active
        variant="primary"
      />,
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
      <ToolButton icon={<span>icon</span>} label="Print now" showLabel size="lg" />,
    );

    expect(markup).toContain('whitespace-nowrap');
    expect(markup).toContain('Print now');
  });
});
