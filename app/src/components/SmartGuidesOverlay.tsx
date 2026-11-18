import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ComputedSheetSide, MarginsMm, MeasurementUnit, PageItem, PageOverlay, RulerGuide } from '@shared/models';
import { convertMmToUnit } from '../engine/layoutEngine';
import { overlayPlacements } from '../engine/overlayPlacements';
import {
  computeSnapAndGuides,
  type ActiveSmartGuides,
  type PeerBoxMm,
  type SheetRectMm,
  type SnapContext,
  type SnapResizeEdge,
  type SnapResult,
} from '../engine/snapEngine';

interface SmartGuideController {
  snapEnabled: boolean;
  smartGuidesEnabled: boolean;
  pxPerMm: number;
  applySnap: (params: {
    rectMm: SheetRectMm;
    mode: 'move' | 'resize';
    resizeHandle?: SnapResizeEdge;
    keepAspect?: boolean;
    excludeId?: string;
    commit?: boolean;
  }) => SnapResult;
  clearGuides: () => void;
}

const SmartGuideCtx = createContext<SmartGuideController | null>(null);

export function useSmartGuides() {
  return useContext(SmartGuideCtx);
}

interface ProviderProps {
  sheet: ComputedSheetSide;
  totalSheets: number;
  pages: PageItem[];
  pageIndices: Map<string, number>;
  overlays: PageOverlay[];
  marginsMm: MarginsMm;
  rulerGuides: RulerGuide[];
  spineGap?: { leftMm: number; rightMm: number };
  pxPerMm: number;
  unit: MeasurementUnit;
  snapEnabled: boolean;
  smartGuidesEnabled: boolean;
  children: React.ReactNode;
}

export function SmartGuideProvider({
  sheet,
  totalSheets,
  pages,
  pageIndices,
  overlays,
  marginsMm,
  rulerGuides,
  spineGap,
  pxPerMm,
  unit,
  snapEnabled,
  smartGuidesEnabled,
  children,
}: ProviderProps) {
  const [activeGuides, setActiveGuides] = useState<ActiveSmartGuides | null>(null);

  useEffect(() => {
    if (!smartGuidesEnabled) setActiveGuides(null);
  }, [smartGuidesEnabled]);

  useEffect(() => {
    const clear = () => setActiveGuides(null);
    window.addEventListener('blur', clear);
    return () => window.removeEventListener('blur', clear);
  }, []);

  const cells = useMemo<SheetRectMm[]>(
    () =>
      sheet.cells.map(c => ({
        x: c.cellXMm,
        y: c.cellYMm,
        width: c.cellWidthMm,
        height: c.cellHeightMm,
      })),
    [sheet.cells],
  );

  const peerBoxes = useMemo<PeerBoxMm[]>(() => {
    const boxes: PeerBoxMm[] = [];
    for (const c of sheet.cells) {
      if (c.page && c.occurrenceKey && c.contentWidthMm > 0 && c.contentHeightMm > 0) {
        boxes.push({
          id: `cell:${c.occurrenceKey}`,
          x: c.contentXMm,
          y: c.contentYMm,
          width: c.contentWidthMm,
          height: c.contentHeightMm,
        });
      }
    }
    const placements = overlayPlacements(sheet, totalSheets, pages, overlays, pageIndices);
    for (const p of placements) {
      const id = 'text' in p ? p.text.id : 'image' in p ? p.image.id : p.shape.id;
      if (p.width > 0 && p.height > 0) {
        boxes.push({
          id: `overlay:${id}`,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
        });
      }
    }
    return boxes;
  }, [sheet, totalSheets, pages, overlays, pageIndices]);

  const thresholdMm = useMemo(
    () => Math.max(1.0, Math.min(3.0, 4.0 / Math.max(0.25, pxPerMm))),
    [pxPerMm],
  );

  const ctxRef = useRef({
    sheetWidthMm: sheet.widthMm,
    sheetHeightMm: sheet.heightMm,
    marginsMm,
    rulerGuides,
    cells,
    spineGap,
    peerBoxes,
    thresholdMm,
    snapEnabled,
    smartGuidesEnabled,
  });
  ctxRef.current = {
    sheetWidthMm: sheet.widthMm,
    sheetHeightMm: sheet.heightMm,
    marginsMm,
    rulerGuides,
    cells,
    spineGap,
    peerBoxes,
    thresholdMm,
    snapEnabled,
    smartGuidesEnabled,
  };

  const applySnap = useCallback(
    ({
      rectMm,
      mode,
      resizeHandle,
      keepAspect = false,
      excludeId,
      commit = false,
    }: {
      rectMm: SheetRectMm;
      mode: 'move' | 'resize';
      resizeHandle?: SnapResizeEdge;
      keepAspect?: boolean;
      excludeId?: string;
      commit?: boolean;
    }): SnapResult => {
      const latest = ctxRef.current;
      const ctx: SnapContext = {
        ...latest,
        excludeId,
      };
      const result = computeSnapAndGuides(rectMm, mode, ctx, resizeHandle, keepAspect);
      if (commit) {
        setActiveGuides(null);
      } else if (latest.smartGuidesEnabled) {
        setActiveGuides(result.guides);
      } else {
        setActiveGuides(null);
      }
      return result;
    },
    [],
  );

  const clearGuides = useCallback(() => setActiveGuides(null), []);

  const controller = useMemo<SmartGuideController>(
    () => ({ snapEnabled, smartGuidesEnabled, pxPerMm, applySnap, clearGuides }),
    [snapEnabled, smartGuidesEnabled, pxPerMm, applySnap, clearGuides],
  );

  return (
    <SmartGuideCtx.Provider value={controller}>
      {children}
      {smartGuidesEnabled && activeGuides && (
        <SmartGuidesLayer
          guides={activeGuides}
          sheetWidthMm={sheet.widthMm}
          sheetHeightMm={sheet.heightMm}
          pxPerMm={pxPerMm}
          unit={unit}
        />
      )}
    </SmartGuideCtx.Provider>
  );
}

function SmartGuidesLayer({
  guides,
  sheetWidthMm,
  sheetHeightMm,
  pxPerMm,
  unit,
}: {
  guides: ActiveSmartGuides;
  sheetWidthMm: number;
  sheetHeightMm: number;
  pxPerMm: number;
  unit: MeasurementUnit;
}) {
  const matchedKeys = new Set(guides.lines.map(l => `${l.axis}-${l.positionMm.toFixed(2)}`));

  return (
    <div
      data-smart-guides-overlay
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[26] overflow-hidden"
    >
      {/* Subtle reference lines for middle (1/2) & thirds (1/3, 2/3) shown only while dragging */}
      {guides.referenceLines.map(ref => {
        const isMatched = matchedKeys.has(`${ref.axis}-${ref.positionMm.toFixed(2)}`);
        if (isMatched) return null;
        const style: React.CSSProperties =
          ref.axis === 'x'
            ? {
                left: ref.positionMm * pxPerMm,
                top: 0,
                bottom: 0,
                borderLeft: '1px dashed rgba(168, 85, 247, 0.38)',
              }
            : {
                top: ref.positionMm * pxPerMm,
                left: 0,
                right: 0,
                borderTop: '1px dashed rgba(168, 85, 247, 0.38)',
              };
        return (
          <div key={ref.id} data-smart-guide-ref={ref.label} className="absolute" style={style}>
            {ref.label && (
              <span
                dir="ltr"
                className="absolute rounded bg-purple-600/20 px-1 py-0.5 text-[9px] font-semibold text-purple-700"
                style={ref.axis === 'x' ? { top: 4, left: 3 } : { left: 4, top: 3 }}
              >
                {ref.label}
              </span>
            )}
          </div>
        );
      })}

      {/* Active snapped / aligned vivid purple guide lines */}
      {guides.lines.map(line => {
        const startPx = (line.spanStartMm ?? 0) * pxPerMm;
        const endPx =
          (line.spanEndMm ?? (line.axis === 'x' ? sheetHeightMm : sheetWidthMm)) * pxPerMm;
        const style: React.CSSProperties =
          line.axis === 'x'
            ? {
                left: line.positionMm * pxPerMm,
                top: startPx,
                height: Math.max(2, endPx - startPx),
                width: 1.5,
                backgroundColor: '#9333ea',
                boxShadow: '0 0 6px rgba(168, 85, 247, 0.65)',
              }
            : {
                top: line.positionMm * pxPerMm,
                left: startPx,
                width: Math.max(2, endPx - startPx),
                height: 1.5,
                backgroundColor: '#9333ea',
                boxShadow: '0 0 6px rgba(168, 85, 247, 0.65)',
              };
        return (
          <div
            key={line.id}
            data-smart-guide-line={line.axis}
            data-smart-guide-kind={line.kind}
            className="absolute"
            style={style}
          >
            {line.label && (
              <span
                dir="ltr"
                className="absolute whitespace-nowrap rounded bg-purple-600 px-1.5 py-0.5 text-[9px] font-bold text-white shadow"
                style={line.axis === 'x' ? { top: 6, left: 4 } : { left: 6, top: 4 }}
              >
                {line.label}
              </span>
            )}
          </div>
        );
      })}

      {/* Equal spacing / interval division purple measurement bars */}
      {guides.spacings.map(sp => {
        const startPx = sp.startMm * pxPerMm;
        const lengthPx = Math.max(2, (sp.endMm - sp.startMm) * pxPerMm);
        const crossPx = sp.crossPosMm * pxPerMm;
        const distLabel = `${convertMmToUnit(sp.gapMm, unit)} ${unit}`;
        if (sp.axis === 'x') {
          return (
            <div
              key={sp.id}
              data-smart-spacing-guide="x"
              className="absolute flex items-center justify-center"
              style={{ left: startPx, width: lengthPx, top: crossPx - 8, height: 16 }}
            >
              <div className="h-[1.5px] w-full bg-purple-600 shadow-[0_0_4px_rgba(168,85,247,0.6)]" />
              <span className="absolute left-0 h-3 w-[1.5px] bg-purple-600" />
              <span className="absolute right-0 h-3 w-[1.5px] bg-purple-600" />
              <span
                dir="ltr"
                className="relative rounded bg-purple-600 px-1.5 py-0.5 text-[9px] font-bold text-white shadow"
              >
                {distLabel}
              </span>
            </div>
          );
        }
        return (
          <div
            key={sp.id}
            data-smart-spacing-guide="y"
            className="absolute flex items-center justify-center"
            style={{ top: startPx, height: lengthPx, left: crossPx - 8, width: 16 }}
          >
            <div className="h-full w-[1.5px] bg-purple-600 shadow-[0_0_4px_rgba(168,85,247,0.6)]" />
            <span className="absolute top-0 h-[1.5px] w-3 bg-purple-600" />
            <span className="absolute bottom-0 h-[1.5px] w-3 bg-purple-600" />
            <span
              dir="ltr"
              className="relative whitespace-nowrap rounded bg-purple-600 px-1.5 py-0.5 text-[9px] font-bold text-white shadow"
            >
              {distLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}
