import { useId, useMemo } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { EffectsSettings, PageItem, PageRotation } from '@shared/models';
import {
  buildCssFilterForPage,
  buildSvgEffectFilterSpec,
  needsExactSvgEffectFilter,
  type SvgEffectFilterSpec,
} from '../engine/effectsPipeline';
import { pageCropFractions, rotateInsets } from '../engine/pageGeometry';

const isJsdomEnv = (): boolean =>
  typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);

/** Identical crop and rotation mapping for the canvas and its sidebar preview. */
export function pageImageStyle(page: PageItem, rotation: PageRotation, width: number, height: number): CSSProperties {
  const crop = rotateInsets(pageCropFractions(page), rotation);
  const fullW = width / (1 - crop.left - crop.right);
  const fullH = height / (1 - crop.top - crop.bottom);
  const ninety = rotation % 180 !== 0;
  return {
    position: 'absolute',
    left: `${100 * fullW * (0.5 - crop.left) / width}%`,
    top: `${100 * fullH * (0.5 - crop.top) / height}%`,
    width: `${100 * (ninety ? fullH : fullW) / width}%`,
    height: `${100 * (ninety ? fullW : fullH) / height}%`,
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  };
}

export function SvgEffectFilterDef({ id, spec }: { id: string; spec: SvgEffectFilterSpec }) {
  let prev = 'SourceGraphic';
  const primitives: ReactElement[] = [];

  if (spec.toneTableValues) {
    const out = 'fxTone';
    primitives.push(
      <feComponentTransfer key={out} in={prev} result={out}>
        <feFuncR type="table" tableValues={spec.toneTableValues} />
        <feFuncG type="table" tableValues={spec.toneTableValues} />
        <feFuncB type="table" tableValues={spec.toneTableValues} />
        <feFuncA type="identity" />
      </feComponentTransfer>
    );
    prev = out;
  }

  if (spec.grayscale) {
    const out = 'fxGray';
    primitives.push(
      <feColorMatrix
        key={out}
        in={prev}
        result={out}
        type="matrix"
        values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
      />
    );
    prev = out;
  }

  if (spec.blackTextTableValues) {
    primitives.push(
      <feComponentTransfer key="fxBtMask" in={prev} result="fxBtMask">
        <feFuncR type="discrete" tableValues={spec.blackTextTableValues} />
        <feFuncG type="discrete" tableValues={spec.blackTextTableValues} />
        <feFuncB type="discrete" tableValues={spec.blackTextTableValues} />
        <feFuncA type="identity" />
      </feComponentTransfer>,
      <feColorMatrix
        key="fxBtGate"
        in="fxBtMask"
        result="fxBtGate"
        type="matrix"
        values="100 100 100 0 0  100 100 100 0 0  100 100 100 0 0  0 0 0 0 1"
      />,
      <feComposite
        key="fxBtApply"
        in={prev}
        in2="fxBtGate"
        result="fxBt"
        operator="arithmetic"
        k1="1"
        k2="0"
        k3="0"
        k4="0"
      />
    );
    prev = 'fxBt';
  }

  if (spec.thresholdTableValues) {
    const out = 'fxThresh';
    primitives.push(
      <feComponentTransfer key={out} in={prev} result={out}>
        <feFuncR type="discrete" tableValues={spec.thresholdTableValues} />
        <feFuncG type="discrete" tableValues={spec.thresholdTableValues} />
        <feFuncB type="discrete" tableValues={spec.thresholdTableValues} />
        <feFuncA type="identity" />
      </feComponentTransfer>
    );
    prev = out;
  }

  if (spec.invert) {
    const out = 'fxInvert';
    primitives.push(
      <feComponentTransfer key={out} in={prev} result={out}>
        <feFuncR type="linear" slope="-1" intercept="1" />
        <feFuncG type="linear" slope="-1" intercept="1" />
        <feFuncB type="linear" slope="-1" intercept="1" />
        <feFuncA type="identity" />
      </feComponentTransfer>
    );
  }

  return (
    <svg
      aria-hidden="true"
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none', overflow: 'hidden' }}
    >
      <defs>
        <filter id={id} colorInterpolationFilters="sRGB">
          {primitives}
        </filter>
      </defs>
    </svg>
  );
}

export function useExactPageFilter(page: PageItem, effects: EffectsSettings): {
  filterStyle: string;
  svgFilterId: string | null;
  svgFilterSpec: SvgEffectFilterSpec | null;
} {
  const reactId = useId();
  const useExact = !isJsdomEnv() && needsExactSvgEffectFilter(page, effects);
  const spec = useMemo(
    () => (useExact ? buildSvgEffectFilterSpec(page, effects) : null),
    [useExact, page, effects]
  );
  if (useExact && spec) {
    const svgFilterId = `ps-fx-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    return { filterStyle: `url(#${svgFilterId})`, svgFilterId, svgFilterSpec: spec };
  }
  return { filterStyle: buildCssFilterForPage(page, effects), svgFilterId: null, svgFilterSpec: null };
}

export function PageContentImage({ page, effects, rotation, width, height }: {
  page: PageItem; effects: EffectsSettings; rotation: PageRotation; width: number; height: number;
}) {
  const { filterStyle, svgFilterId, svgFilterSpec } = useExactPageFilter(page, effects);
  if (width <= 0 || height <= 0) return null;
  const pageOpacity =
    typeof page.overrides?.opacity === 'number' &&
    Number.isFinite(page.overrides.opacity) &&
    page.overrides.opacity < 0.999
      ? Math.max(0.05, Math.min(1, page.overrides.opacity))
      : undefined;
  if (page.isBlankPage && page.sourcePageNumber === 0) {
    return (
      <>
        {svgFilterId && svgFilterSpec && <SvgEffectFilterDef id={svgFilterId} spec={svgFilterSpec} />}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-white"
          style={{ filter: filterStyle, ...(pageOpacity !== undefined ? { opacity: pageOpacity } : {}) }}
        />
      </>
    );
  }
  if (!page.thumbnailDataUrl) return null;
  return (
    <>
      {svgFilterId && svgFilterSpec && <SvgEffectFilterDef id={svgFilterId} spec={svgFilterSpec} />}
      <img draggable={false} src={page.thumbnailDataUrl} alt="" aria-hidden="true"
        style={{
          ...pageImageStyle(page, rotation, width, height),
          filter: filterStyle,
          ...(pageOpacity !== undefined ? { opacity: pageOpacity } : {}),
        }}
        className="max-w-none select-none pointer-events-none" />
    </>
  );
}
