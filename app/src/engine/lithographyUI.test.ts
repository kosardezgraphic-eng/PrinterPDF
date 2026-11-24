// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LithographyWorkspace } from '../components/LithographyWorkspace';
import { QuickBar } from '../components/QuickBar';
import { DEFAULT_SETTINGS, useAppStore } from '../store/useAppStore';
import { createDefaultLithoColorSettings, createDefaultLithoPresets } from './lithographyColor';
import * as lithographyPreflight from './lithographyPreflight';

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

  it('supports standard paper sizes (A3/B4), interactive form transform (move/resize/rotate), and ruler measurement tool in Lithography UI', async () => {
    vi.spyOn(lithographyPreflight, 'renderPdfPageToRgba').mockResolvedValue({
      width: 24,
      height: 36,
      rgba: new Uint8ClampedArray(24 * 36 * 4).fill(210),
    });

    const sampleJob = {
      id: 'job-ui-form-1',
      fileName: 'card-test.pdf',
      sourceFormat: 'PDF' as const,
      fileSizeBytes: 4096,
      sourceBytes: new Uint8Array([37, 80, 68, 70]),
      status: 'done' as const,
      addedAt: new Date().toISOString(),
      metadata: {
        fileName: 'card-test.pdf',
        sourceFormat: 'PDF' as const,
        pdfVersion: '1.7',
        pageCount: 1,
        fileSizeBytes: 4096,
        colorSpaces: ['DeviceCMYK'],
        overallColorMode: 'CMYK' as const,
        detectedSpots: [],
        hasAnyTransparency: false,
        hasAnyOverprint: false,
        unembeddedFonts: [],
        embeddedFontsCount: 1,
        pages: [
          {
            pageNumber: 1,
            widthMm: 100,
            heightMm: 150,
            mediaBoxMm: { x: 0, y: 0, width: 100, height: 150 },
            trimBoxMm: { x: 3, y: 3, width: 94, height: 144 },
            bleedBoxMm: { x: 0, y: 0, width: 100, height: 150 },
            hasExplicitTrimBox: true,
            hasExplicitBleedBox: true,
            hasMinBleed3Mm: true,
            minBleedMm: 3,
            colorSpaces: ['DeviceCMYK'],
            imageCount: 1,
            minEffectiveDpi: 300,
            lowResImages: [],
            hairlineCount: 0,
            hasRgbOrLab: false,
            hasTransparency: false,
            hasSuspiciousOverprint: false,
            estimatedMaxTacPercent: 210,
            tacExceedAreaPercent: 0,
            textColorSummary: '100% K',
          },
        ],
      },
    };

    useAppStore.setState({
      lithoJobs: [sampleJob],
      lithoSelectedJobId: sampleJob.id,
      lithoSelectedPageNumber: 1,
    });

    await act(async () => {
      root.render(React.createElement(LithographyWorkspace));
    });

    // Quick paper/plate selector supports A3 & B4 directly from toolbar
    const quickSelect = host.querySelector('[data-litho-quick-plate-size]') as HTMLSelectElement;
    expect(quickSelect).toBeTruthy();
    await act(async () => {
      quickSelect.value = 'a3';
      quickSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useAppStore.getState().lithoExportSettings.plateSizeId).toBe('a3');
    expect(useAppStore.getState().lithoExportSettings.plateWidthMm).toBe(297);
    expect(useAppStore.getState().lithoExportSettings.plateHeightMm).toBe(420);

    // Switch to 'فرم و اندازه' inspector tab
    const formTab = host.querySelector('[data-litho-tab="form"]') as HTMLButtonElement;
    expect(formTab).toBeTruthy();
    await act(async () => {
      formTab.click();
    });
    expect(host.querySelector('[data-litho-form-panel]')).toBeTruthy();

    // Rotate 90° and Fit onto A3
    const rotate90Btn = host.querySelector('[data-litho-rotate-90]') as HTMLButtonElement;
    await act(async () => {
      rotate90Btn.click();
    });
    expect(useAppStore.getState().lithoExportSettings.formPlacement?.rotationDeg).toBe(90);

    const fitBtn = host.querySelector('[data-litho-fit-form]') as HTMLButtonElement;
    await act(async () => {
      fitBtn.click();
    });
    expect(useAppStore.getState().lithoExportSettings.formPlacement?.scaleXPercent).toBeGreaterThan(150);

    // Numeric Offset X / Scale X updates store accurately
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const offXInput = host.querySelector('[data-litho-offset-x]') as HTMLInputElement;
    await act(async () => {
      setter.call(offXInput, '18');
      offXInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useAppStore.getState().lithoExportSettings.formPlacement?.offsetXMm).toBe(18);

    // Pointer drag on artwork box moves artwork in form
    const artBox = host.querySelector('[data-litho-artwork-box]') as HTMLElement;
    expect(artBox).toBeTruthy();
    const beforeX = useAppStore.getState().lithoExportSettings.formPlacement?.offsetXMm ?? 0;
    await act(async () => {
      artBox.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 })
      );
      window.dispatchEvent(new Event('pointermove'));
    });
    const viewport = host.querySelector('[data-litho-plate-frame]')?.closest('[dir]') as HTMLElement;
    expect(viewport).toBeTruthy();
    await act(async () => {
      artBox.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 140, clientY: 120 })
      );
      artBox.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 140, clientY: 120 }));
    });
    expect(useAppStore.getState().lithoExportSettings.formPlacement?.offsetXMm).toBeGreaterThan(beforeX);

    // Resize via SE handle scales artwork cleanly
    const seHandle = host.querySelector('[data-litho-handle="se"]') as HTMLElement;
    expect(seHandle).toBeTruthy();
    const beforeScale = useAppStore.getState().lithoExportSettings.formPlacement?.scaleXPercent ?? 100;
    await act(async () => {
      seHandle.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 200, clientY: 200 })
      );
      seHandle.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 250, clientY: 250 })
      );
      seHandle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 250, clientY: 250 }));
    });
    expect(useAppStore.getState().lithoExportSettings.formPlacement?.scaleXPercent).toBeGreaterThan(
      beforeScale
    );

    // Activate Measure / Ruler tool and drag a measurement line on the form
    const measureBtn = host.querySelector('[data-litho-form-tool="measure"]') as HTMLButtonElement;
    await act(async () => {
      measureBtn.click();
    });
    const overlay = host.querySelector('[data-litho-measure-overlay]') as HTMLElement;
    expect(overlay).toBeTruthy();

    await act(async () => {
      overlay.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 20 })
      );
      overlay.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 120, clientY: 20 })
      );
      overlay.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 120, clientY: 20 }));
    });

    expect(host.querySelector('[data-litho-measure-readout]')).toBeTruthy();
    expect(host.querySelectorAll('[data-litho-measurement-item]').length).toBeGreaterThanOrEqual(1);

    // Reset placement restores 100% / 0 offset / 0°
    const resetBtn = host.querySelector('[data-litho-reset-placement]') as HTMLButtonElement;
    await act(async () => {
      resetBtn.click();
    });
    expect(useAppStore.getState().lithoExportSettings.formPlacement).toMatchObject({
      offsetXMm: 0,
      offsetYMm: 0,
      scaleXPercent: 100,
      scaleYPercent: 100,
      rotationDeg: 0,
    });
  });
});

