// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LithographyWorkspace } from '../components/LithographyWorkspace';
import { QuickBar } from '../components/QuickBar';
import { DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { createDefaultLithoColorSettings, createDefaultLithoPresets } from './lithographyColor';

let root: Root;
let host: HTMLDivElement;

describe('LithographyWorkspace & QuickBar UI', () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useAppStore.setState({
      appMode: 'lithography',
      settings: { ...DEFAULT_SETTINGS, language: 'fa' },
      lithoJobs: [],
      lithoSelectedJobId: null,
      lithoSelectedPageNumber: 1,
      lithoColorSettings: createDefaultLithoColorSettings(),
      lithoTacThreshold: 300,
      lithoPresets: createDefaultLithoPresets(),
      lithoActivePresetId: 'preset-fogra39-coated',
      lithoLastExportFiles: [],
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.restoreAllMocks();
  });

  it('switches into Lithography mode via QuickBar button and renders all 3 Prepress panels cleanly', async () => {
    useAppStore.setState({ appMode: 'studio' });
    await act(async () => {
      root.render(
        React.createElement(
          'div',
          null,
          React.createElement(QuickBar),
          React.createElement(LithographyWorkspace)
        )
      );
    });

    const lithoBtn = host.querySelector('[data-app-mode-lithography]') as HTMLButtonElement;
    expect(lithoBtn).toBeTruthy();
    await act(async () => {
      lithoBtn.click();
    });
    expect(useAppStore.getState().appMode).toBe('lithography');

    // Empty state & main panes exist
    expect(host.querySelector('[data-lithography-workspace]')).toBeTruthy();
    expect(host.querySelector('[data-litho-ink-inspector]')).toBeTruthy();

    // Switch between Preflight / Color / Export tabs
    const colorTab = host.querySelector('[data-litho-tab="color"]') as HTMLButtonElement;
    await act(async () => {
      colorTab.click();
    });
    expect(host.textContent).toContain('پروفایل رنگ ماشین چاپ');
    expect(host.textContent).toContain('قانون مشکی');

    const exportTab = host.querySelector('[data-litho-tab="export"]') as HTMLButtonElement;
    await act(async () => {
      exportTab.click();
    });
    expect(host.querySelector('[data-litho-output-format]')).toBeTruthy();
    expect(host.querySelector('[data-litho-dpi]')).toBeTruthy();
    expect(host.querySelector('[data-litho-export-btn]')).toBeTruthy();

    // Plate toggles exist and toggle cleanly
    const cBtn = host.querySelector('[data-plate-toggle="C"]') as HTMLButtonElement;
    expect(cBtn).toBeTruthy();
    await act(async () => {
      cBtn.click();
    });
    expect(cBtn.className).toContain('line-through');

    // Plate Size selector & Studio transfer CTA exist cleanly
    expect(host.querySelector('[data-litho-from-studio]')).toBeTruthy();
    const plateSelect = host.querySelector('[data-litho-plate-size]') as HTMLSelectElement;
    expect(plateSelect).toBeTruthy();

    await act(async () => {
      plateSelect.value = 'sm52';
      plateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useAppStore.getState().lithoExportSettings.plateSizeId).toBe('sm52');
    expect(host.querySelector('[data-litho-plate-width]')).toBeTruthy();
    expect(host.querySelector('[data-litho-plate-height]')).toBeTruthy();

    // Save custom plate size from UI
    const nameInput = host.querySelector('[data-litho-plate-save-name]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(nameInput, 'زینک ۵۰×۷۰');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const savePlateBtn = host.querySelector('[data-litho-plate-save-btn]') as HTMLButtonElement;
    await act(async () => {
      savePlateBtn.click();
    });
    expect(useAppStore.getState().lithoSavedPlateSizes).toHaveLength(1);
    expect(host.querySelector('[data-litho-plate-delete]')).toBeTruthy();

    // Press Marks toggle exists
    const marksToggle = host.querySelector('[data-litho-toggle-marks]') as HTMLInputElement;
    expect(marksToggle).toBeTruthy();
    expect(marksToggle.checked).toBe(true);
  });
});
