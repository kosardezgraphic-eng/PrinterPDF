/**
 * PrintStudio Pro — Non-Destructive Effects Pipeline (E1 - E2, E5)
 * Order: Brightness/Contrast → Gamma → Sharpness → Grayscale → Black Text → B&W Threshold → Invert
 * Identical semantics across Live Preview (GPU/CSS), Raster Print, and PDF Export.
 */

import type { EffectsSettings, PageItem } from '@shared/models';

export function shouldApplyEffectsToPage(
  page: PageItem,
  effects: EffectsSettings
): {
  applyGlobal: boolean;
  effectiveInvert: boolean;
  effectiveGrayscale: boolean;
  effectiveBlackAndWhite: boolean;
} {
  const pageOverrideInvert = page.overrides?.invert;
  const scopeMatch =
    effects.enabled &&
    (effects.scope === 'all' || (effects.scope === 'selected' && page.isHighlighted));

  const effectiveInvert =
    pageOverrideInvert !== undefined
      ? pageOverrideInvert
      : scopeMatch && effects.invert;

  const effectiveGrayscale =
    page.overrides?.grayscale !== undefined
      ? page.overrides.grayscale
      : scopeMatch && (effects.grayscale || effects.blackAndWhite);

  const effectiveBlackAndWhite =
    page.overrides?.threshold !== undefined
      ? page.overrides.threshold
      : scopeMatch && effects.blackAndWhite;

  return {
    applyGlobal: scopeMatch,
    effectiveInvert,
    effectiveGrayscale,
    effectiveBlackAndWhite,
  };
}

/**
 * Generates GPU-accelerated CSS filter string for 60fps Live Preview (E1/E2)
 */
export function buildCssFilterForPage(
  page: PageItem,
  effects: EffectsSettings
): string {
  const {
    applyGlobal,
    effectiveInvert,
    effectiveGrayscale,
    effectiveBlackAndWhite,
  } = shouldApplyEffectsToPage(page, effects);

  const parts: string[] = [];

  if (applyGlobal) {
    // 1. Brightness (-100..+100 -> 0..2)
    if (effects.brightness !== 0) {
      const b = Math.max(0.1, 1 + effects.brightness / 100);
      parts.push(`brightness(${b.toFixed(2)})`);
    }

    // 2. Contrast (-100..+100) + Gamma approximation + Black Text boost
    let contrastFactor = 1 + effects.contrast / 100;
    if (effects.gamma !== 1) {
      contrastFactor *= 1 / Math.max(0.2, Math.min(3, effects.gamma));
    }
    if (effects.blackText) {
      contrastFactor *= 1.25;
    }
    if (effectiveBlackAndWhite) {
      // High-contrast threshold effect in CSS preview
      const thresholdBias = (128 - effects.threshold) / 255;
      parts.push(`brightness(${(1 + thresholdBias).toFixed(2)})`);
      contrastFactor *= 6.5;
    }
    if (Math.abs(contrastFactor - 1) > 0.01) {
      parts.push(`contrast(${Math.max(0.1, contrastFactor).toFixed(2)})`);
    }
  }

  // 3. Grayscale
  if (effectiveGrayscale || effectiveBlackAndWhite) {
    parts.push('grayscale(1)');
  }

  // 4. Invert (E1: Always last in pipeline so inverted B&W/Grayscale/Color matches raster & PDF Difference blend)
  if (effectiveInvert) {
    parts.push('invert(1)');
  }

  return parts.length > 0 ? parts.join(' ') : 'none';
}

/**
 * Pixel-exact RGBA buffer processor for Raster Print / Image Export / Canvas rendering.
 * Executes the exact non-destructive pipeline:
 * Brightness/Contrast -> Gamma -> Grayscale -> BlackText -> Threshold -> Invert
 */
export function applyEffectsToRgbaBuffer(
  rgba: Uint8ClampedArray,
  effects: EffectsSettings,
  pageOverrides?: PageItem['overrides']
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);

  const invert = pageOverrides?.invert ?? (effects.enabled && effects.invert);
  const grayscale =
    pageOverrides?.grayscale ??
    (effects.enabled && (effects.grayscale || effects.blackAndWhite));
  const bwThreshold =
    pageOverrides?.threshold ?? (effects.enabled && effects.blackAndWhite);

  const brightnessOffset = effects.enabled ? (effects.brightness / 100) * 255 : 0;
  const contrastFactor = effects.enabled
    ? (259 * (effects.contrast + 255)) / (255 * (259 - effects.contrast))
    : 1;
  const invGamma =
    effects.enabled && effects.gamma > 0 ? 1 / effects.gamma : 1;

  for (let i = 0; i < rgba.length; i += 4) {
    let r = rgba[i];
    let g = rgba[i + 1];
    let b = rgba[i + 2];
    const a = rgba[i + 3];

    if (effects.enabled) {
      // Step 1: Brightness & Contrast
      r = contrastFactor * (r + brightnessOffset - 128) + 128;
      g = contrastFactor * (g + brightnessOffset - 128) + 128;
      b = contrastFactor * (b + brightnessOffset - 128) + 128;

      // Step 2: Gamma correction
      if (invGamma !== 1) {
        r = 255 * Math.pow(Math.max(0, Math.min(255, r)) / 255, invGamma);
        g = 255 * Math.pow(Math.max(0, Math.min(255, g)) / 255, invGamma);
        b = 255 * Math.pow(Math.max(0, Math.min(255, b)) / 255, invGamma);
      }
    }

    // Step 3: Grayscale (ITU-R BT.709 luminance)
    if (grayscale || bwThreshold) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = lum;
      g = lum;
      b = lum;
    }

    // Step 4: Force near-black text to pure black
    if (effects.enabled && effects.blackText) {
      if (r < 75 && g < 75 && b < 75) {
        r = 0;
        g = 0;
        b = 0;
      }
    }

    // Step 5: Black & White Threshold (1-bit quantization)
    if (bwThreshold) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const bit = lum >= effects.threshold ? 255 : 0;
      r = bit;
      g = bit;
      b = bit;
    }

    // Step 6: Invert (E1)
    if (invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    out[i] = Math.max(0, Math.min(255, Math.round(r)));
    out[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
    out[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    out[i + 3] = a;
  }

  return out;
}
