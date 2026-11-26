import type { MarginsMm, RulerGuide } from '@shared/models';

export interface SheetRectMm {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PeerBoxMm extends SheetRectMm {
  id: string;
}

export interface SnapContext {
  sheetWidthMm: number;
  sheetHeightMm: number;
  marginsMm: MarginsMm;
  rulerGuides: RulerGuide[];
  cells: SheetRectMm[];
  spineGap?: { leftMm: number; rightMm: number };
  peerBoxes: PeerBoxMm[];
  excludeId?: string;
  thresholdMm: number;
  snapEnabled: boolean;
  smartGuidesEnabled: boolean;
}

export type SnapTargetKind = 'ruler' | 'center' | 'edge' | 'third' | 'peer' | 'spacing';

export interface SmartGuideLine {
  id: string;
  axis: 'x' | 'y';
  positionMm: number;
  kind: SnapTargetKind;
  label?: string;
  spanStartMm?: number;
  spanEndMm?: number;
}

export interface SmartSpacingGuide {
  id: string;
  axis: 'x' | 'y';
  startMm: number;
  endMm: number;
  crossPosMm: number;
  gapMm: number;
}

export interface ActiveSmartGuides {
  lines: SmartGuideLine[];
  spacings: SmartSpacingGuide[];
  referenceLines: SmartGuideLine[];
}

export type SnapResizeEdge = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

export interface SnapResult {
  rectMm: SheetRectMm;
  snappedX: boolean;
  snappedY: boolean;
  guides: ActiveSmartGuides;
}

interface AxisTarget {
  positionMm: number;
  kind: Exclude<SnapTargetKind, 'spacing'>;
  label?: string;
  spanStartMm?: number;
  spanEndMm?: number;
}

const PRIORITY: Record<SnapTargetKind, number> = {
  ruler: 0,
  center: 1,
  edge: 2,
  third: 3,
  spacing: 4,
  peer: 5,
};

function buildReferenceLines(ctx: SnapContext): SmartGuideLine[] {
  const w = ctx.sheetWidthMm;
  const h = ctx.sheetHeightMm;
  const lines: SmartGuideLine[] = [
    { id: 'ref-x-third-1', axis: 'x', positionMm: w / 3, kind: 'third', label: '1/3' },
    { id: 'ref-x-center', axis: 'x', positionMm: w / 2, kind: 'center', label: '1/2' },
    { id: 'ref-x-third-2', axis: 'x', positionMm: (2 * w) / 3, kind: 'third', label: '2/3' },
    { id: 'ref-y-third-1', axis: 'y', positionMm: h / 3, kind: 'third', label: '1/3' },
    { id: 'ref-y-center', axis: 'y', positionMm: h / 2, kind: 'center', label: '1/2' },
    { id: 'ref-y-third-2', axis: 'y', positionMm: (2 * h) / 3, kind: 'third', label: '2/3' },
  ];
  const pCenterX = (ctx.marginsMm.left + (w - ctx.marginsMm.right)) / 2;
  if (Math.abs(pCenterX - w / 2) > 0.5) {
    lines.push({ id: 'ref-x-pcenter', axis: 'x', positionMm: pCenterX, kind: 'center', label: '1/2' });
  }
  const pCenterY = (ctx.marginsMm.top + (h - ctx.marginsMm.bottom)) / 2;
  if (Math.abs(pCenterY - h / 2) > 0.5) {
    lines.push({ id: 'ref-y-pcenter', axis: 'y', positionMm: pCenterY, kind: 'center', label: '1/2' });
  }
  return lines;
}

function collectAxisTargets(axis: 'x' | 'y', ctx: SnapContext, peers: PeerBoxMm[]): AxisTarget[] {
  const len = axis === 'x' ? ctx.sheetWidthMm : ctx.sheetHeightMm;
  const mStart = axis === 'x' ? ctx.marginsMm.left : ctx.marginsMm.top;
  const mEnd = axis === 'x' ? ctx.marginsMm.right : ctx.marginsMm.bottom;
  const printableEnd = Math.max(mStart, len - mEnd);
  const targets: AxisTarget[] = [];

  for (const g of ctx.rulerGuides) {
    if (g.axis === axis && g.positionMm >= 0 && g.positionMm <= len) {
      targets.push({ positionMm: g.positionMm, kind: 'ruler' });
    }
  }

  targets.push({ positionMm: 0, kind: 'edge' });
  targets.push({ positionMm: len, kind: 'edge' });
  if (mStart > 0.1) targets.push({ positionMm: mStart, kind: 'edge' });
  if (printableEnd < len - 0.1) targets.push({ positionMm: printableEnd, kind: 'edge' });

  targets.push({ positionMm: len / 2, kind: 'center', label: '1/2' });
  const pCenter = (mStart + printableEnd) / 2;
  if (Math.abs(pCenter - len / 2) > 0.5) {
    targets.push({ positionMm: pCenter, kind: 'center', label: '1/2' });
  }

  targets.push({ positionMm: len / 3, kind: 'third', label: '1/3' });
  targets.push({ positionMm: (2 * len) / 3, kind: 'third', label: '2/3' });

  for (const cell of ctx.cells) {
    const start = axis === 'x' ? cell.x : cell.y;
    const size = axis === 'x' ? cell.width : cell.height;
    targets.push({ positionMm: start, kind: 'edge' });
    targets.push({ positionMm: start + size, kind: 'edge' });
    targets.push({ positionMm: start + size / 2, kind: 'center' });
  }

  if (axis === 'x' && ctx.spineGap) {
    targets.push({ positionMm: ctx.spineGap.leftMm, kind: 'edge' });
    targets.push({ positionMm: ctx.spineGap.rightMm, kind: 'edge' });
    targets.push({ positionMm: (ctx.spineGap.leftMm + ctx.spineGap.rightMm) / 2, kind: 'center', label: '1/2' });
  }

  for (const peer of peers) {
    const start = axis === 'x' ? peer.x : peer.y;
    const size = axis === 'x' ? peer.width : peer.height;
    const crossStart = axis === 'x' ? peer.y : peer.x;
    const crossSize = axis === 'x' ? peer.height : peer.width;
    targets.push({ positionMm: start, kind: 'peer', spanStartMm: crossStart, spanEndMm: crossStart + crossSize });
    targets.push({ positionMm: start + size / 2, kind: 'peer', spanStartMm: crossStart, spanEndMm: crossStart + crossSize });
    targets.push({ positionMm: start + size, kind: 'peer', spanStartMm: crossStart, spanEndMm: crossStart + crossSize });
  }

  return targets;
}

interface SpacingProposal {
  snappedStartMm: number;
  bars: Array<{ startMm: number; endMm: number; crossPosMm: number; gapMm: number }>;
}

function collectSpacingProposals(
  axis: 'x' | 'y',
  rect: SheetRectMm,
  ctx: SnapContext,
  peers: PeerBoxMm[],
): SpacingProposal[] {
  const proposals: SpacingProposal[] = [];
  const len = axis === 'x' ? ctx.sheetWidthMm : ctx.sheetHeightMm;
  const mStart = axis === 'x' ? ctx.marginsMm.left : ctx.marginsMm.top;
  const mEnd = axis === 'x' ? ctx.marginsMm.right : ctx.marginsMm.bottom;
  const printableEnd = Math.max(mStart, len - mEnd);

  const itemSize = axis === 'x' ? rect.width : rect.height;
  const itemCrossMid = axis === 'x' ? rect.y + rect.height / 2 : rect.x + rect.width / 2;
  const itemCrossStart = axis === 'x' ? rect.y : rect.x;
  const itemCrossEnd = itemCrossStart + (axis === 'x' ? rect.height : rect.width);

  // Overlapping peers along the perpendicular axis (fall back to all peers if none overlap cleanly)
  const crossOverlapping = peers.filter(p => {
    const cStart = axis === 'x' ? p.y : p.x;
    const cEnd = cStart + (axis === 'x' ? p.height : p.width);
    return Math.min(itemCrossEnd, cEnd) > Math.max(itemCrossStart, cStart) - 2;
  });
  const lanePeers = crossOverlapping.length > 0 ? crossOverlapping : peers;

  const intervals = lanePeers
    .map(p => ({
      start: axis === 'x' ? p.x : p.y,
      end: (axis === 'x' ? p.x + p.width : p.y + p.height),
      crossMid: axis === 'x' ? p.y + p.height / 2 : p.x + p.width / 2,
    }))
    .sort((a, b) => a.start - b.start);

  // 1. Centered inside printable area (and full sheet if margins differ)
  if (printableEnd - mStart > itemSize + 1) {
    const idealStart = mStart + (printableEnd - mStart - itemSize) / 2;
    const gap = idealStart - mStart;
    if (gap > 0.4) {
      proposals.push({
        snappedStartMm: idealStart,
        bars: [
          { startMm: mStart, endMm: idealStart, crossPosMm: itemCrossMid, gapMm: gap },
          { startMm: idealStart + itemSize, endMm: printableEnd, crossPosMm: itemCrossMid, gapMm: gap },
        ],
      });
    }
  }
  if (mStart > 0.5 || mEnd > 0.5) {
    const idealSheetStart = (len - itemSize) / 2;
    if (idealSheetStart > 0.4) {
      proposals.push({
        snappedStartMm: idealSheetStart,
        bars: [
          { startMm: 0, endMm: idealSheetStart, crossPosMm: itemCrossMid, gapMm: idealSheetStart },
          { startMm: idealSheetStart + itemSize, endMm: len, crossPosMm: itemCrossMid, gapMm: idealSheetStart },
        ],
      });
    }
  }

  // 2. Centered symmetrically inside the nearest containing cell
  for (const cell of ctx.cells) {
    const cStart = axis === 'x' ? cell.x : cell.y;
    const cSize = axis === 'x' ? cell.width : cell.height;
    const cEnd = cStart + cSize;
    const cCrossStart = axis === 'x' ? cell.y : cell.x;
    const cCrossEnd = cCrossStart + (axis === 'x' ? cell.height : cell.width);
    if (Math.min(itemCrossEnd, cCrossEnd) <= Math.max(itemCrossStart, cCrossStart)) continue;
    if (cSize > itemSize + 1) {
      const idealStart = cStart + (cSize - itemSize) / 2;
      const gap = idealStart - cStart;
      if (gap > 0.4) {
        proposals.push({
          snappedStartMm: idealStart,
          bars: [
            { startMm: cStart, endMm: idealStart, crossPosMm: itemCrossMid, gapMm: gap },
            { startMm: idealStart + itemSize, endMm: cEnd, crossPosMm: itemCrossMid, gapMm: gap },
          ],
        });
      }
    }
  }

  // 3. Equal gap between immediate left and right bounding peers (A |<-- d -->| rect |<-- d -->| B)
  const itemStart = axis === 'x' ? rect.x : rect.y;
  const itemEnd = itemStart + itemSize;
  const leftPeer = intervals.filter(p => p.end <= itemStart + 3).sort((a, b) => b.end - a.end)[0];
  const rightPeer = intervals.filter(p => p.start >= itemEnd - 3).sort((a, b) => a.start - b.start)[0];

  if (leftPeer && rightPeer && rightPeer.start - leftPeer.end > itemSize + 0.8) {
    const idealStart = leftPeer.end + (rightPeer.start - leftPeer.end - itemSize) / 2;
    const gap = idealStart - leftPeer.end;
    const cross = (itemCrossMid + (leftPeer.crossMid + rightPeer.crossMid) / 2) / 2;
    proposals.push({
      snappedStartMm: idealStart,
      bars: [
        { startMm: leftPeer.end, endMm: idealStart, crossPosMm: cross, gapMm: gap },
        { startMm: idealStart + itemSize, endMm: rightPeer.start, crossPosMm: cross, gapMm: gap },
      ],
    });
  } else if (leftPeer && printableEnd - leftPeer.end > itemSize + 0.8) {
    const idealStart = leftPeer.end + (printableEnd - leftPeer.end - itemSize) / 2;
    const gap = idealStart - leftPeer.end;
    proposals.push({
      snappedStartMm: idealStart,
      bars: [
        { startMm: leftPeer.end, endMm: idealStart, crossPosMm: itemCrossMid, gapMm: gap },
        { startMm: idealStart + itemSize, endMm: printableEnd, crossPosMm: itemCrossMid, gapMm: gap },
      ],
    });
  } else if (rightPeer && rightPeer.start - mStart > itemSize + 0.8) {
    const idealStart = mStart + (rightPeer.start - mStart - itemSize) / 2;
    const gap = idealStart - mStart;
    proposals.push({
      snappedStartMm: idealStart,
      bars: [
        { startMm: mStart, endMm: idealStart, crossPosMm: itemCrossMid, gapMm: gap },
        { startMm: idealStart + itemSize, endMm: rightPeer.start, crossPosMm: itemCrossMid, gapMm: gap },
      ],
    });
  }

  // 4. Matching an existing inter-item gap sequentially (A |<- d ->| B |<- d ->| rect or reverse)
  for (let i = 0; i < intervals.length - 1; i++) {
    const first = intervals[i];
    const second = intervals[i + 1];
    const d = second.start - first.end;
    if (d <= 0.5) continue;
    const barCross = (first.crossMid + second.crossMid + itemCrossMid) / 3;

    // Candidate placed after `second`
    const afterStart = second.end + d;
    if (afterStart + itemSize <= len + 5) {
      proposals.push({
        snappedStartMm: afterStart,
        bars: [
          { startMm: first.end, endMm: second.start, crossPosMm: barCross, gapMm: d },
          { startMm: second.end, endMm: afterStart, crossPosMm: barCross, gapMm: d },
        ],
      });
    }

    // Candidate placed before `first`
    const beforeStart = first.start - d - itemSize;
    if (beforeStart >= -5) {
      proposals.push({
        snappedStartMm: beforeStart,
        bars: [
          { startMm: beforeStart + itemSize, endMm: first.start, crossPosMm: barCross, gapMm: d },
          { startMm: first.end, endMm: second.start, crossPosMm: barCross, gapMm: d },
        ],
      });
    }
  }

  return proposals;
}

interface BestAxisDelta {
  deltaMm: number;
  kind: SnapTargetKind;
}

function findBestMoveAxisSnap(
  startMm: number,
  sizeMm: number,
  targets: AxisTarget[],
  spacings: SpacingProposal[],
  thresholdMm: number,
): BestAxisDelta | null {
  const sourcePositions = [startMm, startMm + sizeMm / 2, startMm + sizeMm];
  let best: BestAxisDelta | null = null;

  const consider = (deltaMm: number, kind: SnapTargetKind) => {
    const dist = Math.abs(deltaMm);
    if (dist > thresholdMm) return;
    if (
      !best ||
      dist < Math.abs(best.deltaMm) - 0.05 ||
      (Math.abs(dist - Math.abs(best.deltaMm)) <= 0.05 && PRIORITY[kind] < PRIORITY[best.kind])
    ) {
      best = { deltaMm, kind };
    }
  };

  for (const target of targets) {
    for (const src of sourcePositions) {
      consider(target.positionMm - src, target.kind);
    }
  }
  for (const prop of spacings) {
    consider(prop.snappedStartMm - startMm, 'spacing');
  }

  return best;
}

function findBestResizeEdgeSnap(
  edgePosMm: number,
  targets: AxisTarget[],
  thresholdMm: number,
): BestAxisDelta | null {
  let best: BestAxisDelta | null = null;
  for (const target of targets) {
    const deltaMm = target.positionMm - edgePosMm;
    const dist = Math.abs(deltaMm);
    if (dist > thresholdMm) continue;
    if (
      !best ||
      dist < Math.abs(best.deltaMm) - 0.05 ||
      (Math.abs(dist - Math.abs(best.deltaMm)) <= 0.05 && PRIORITY[target.kind] < PRIORITY[best.kind])
    ) {
      best = { deltaMm, kind: target.kind };
    }
  }
  return best;
}

function collectMatchedGuidesForAxis(
  axis: 'x' | 'y',
  rect: SheetRectMm,
  targets: AxisTarget[],
  spacings: SpacingProposal[],
  matchTolMm: number,
  activeEdges: { start: boolean; center: boolean; end: boolean },
): { lines: SmartGuideLine[]; spacingBars: SmartSpacingGuide[] } {
  const start = axis === 'x' ? rect.x : rect.y;
  const size = axis === 'x' ? rect.width : rect.height;
  const crossStart = axis === 'x' ? rect.y : rect.x;
  const crossEnd = crossStart + (axis === 'x' ? rect.height : rect.width);
  const checkPositions: number[] = [];
  if (activeEdges.start) checkPositions.push(start);
  if (activeEdges.center) checkPositions.push(start + size / 2);
  if (activeEdges.end) checkPositions.push(start + size);

  const linesByPos = new Map<string, SmartGuideLine>();
  for (const t of targets) {
    const hit = checkPositions.some(pos => Math.abs(pos - t.positionMm) <= matchTolMm);
    if (!hit) continue;
    const key = `${axis}-${t.positionMm.toFixed(2)}`;
    const existing = linesByPos.get(key);
    const spanStart = t.spanStartMm !== undefined ? Math.min(crossStart, t.spanStartMm) : undefined;
    const spanEnd = t.spanEndMm !== undefined ? Math.max(crossEnd, t.spanEndMm) : undefined;
    if (!existing || PRIORITY[t.kind] < PRIORITY[existing.kind]) {
      linesByPos.set(key, {
        id: `guide-${key}`,
        axis,
        positionMm: t.positionMm,
        kind: t.kind,
        label: t.label ?? existing?.label,
        spanStartMm: existing?.spanStartMm !== undefined || spanStart === undefined ? undefined : spanStart,
        spanEndMm: existing?.spanEndMm !== undefined || spanEnd === undefined ? undefined : spanEnd,
      });
    } else if (existing.label === undefined && t.label) {
      existing.label = t.label;
    }
  }

  const spacingBars: SmartSpacingGuide[] = [];
  if (activeEdges.start && activeEdges.end) {
    for (let pIdx = 0; pIdx < spacings.length; pIdx++) {
      const prop = spacings[pIdx];
      if (Math.abs(start - prop.snappedStartMm) <= matchTolMm) {
        prop.bars.forEach((bar, bIdx) => {
          if (bar.endMm - bar.startMm > 0.3) {
            spacingBars.push({
              id: `space-${axis}-${pIdx}-${bIdx}`,
              axis,
              startMm: bar.startMm,
              endMm: bar.endMm,
              crossPosMm: bar.crossPosMm,
              gapMm: bar.gapMm,
            });
          }
        });
      }
    }
  }

  return { lines: Array.from(linesByPos.values()), spacingBars };
}

export function computeSnapAndGuides(
  candidateMm: SheetRectMm,
  mode: 'move' | 'resize',
  ctx: SnapContext,
  resizeHandle?: SnapResizeEdge,
  keepAspect = false,
): SnapResult {
  const emptyGuides: ActiveSmartGuides = { lines: [], spacings: [], referenceLines: [] };
  if (!ctx.snapEnabled && !ctx.smartGuidesEnabled) {
    return { rectMm: candidateMm, snappedX: false, snappedY: false, guides: emptyGuides };
  }

  const peers = ctx.excludeId
    ? ctx.peerBoxes.filter(p => p.id !== ctx.excludeId)
    : ctx.peerBoxes;
  const xTargets = collectAxisTargets('x', ctx, peers);
  const yTargets = collectAxisTargets('y', ctx, peers);
  const xSpacings = mode === 'move' ? collectSpacingProposals('x', candidateMm, ctx, peers) : [];
  const ySpacings = mode === 'move' ? collectSpacingProposals('y', candidateMm, ctx, peers) : [];

  let finalRect: SheetRectMm = { ...candidateMm };
  let snappedX = false;
  let snappedY = false;

  const moveEdges = { start: true, center: true, end: true };
  const resizeEdgesX = {
    start: !!resizeHandle?.includes('w'),
    center: false,
    end: !!resizeHandle?.includes('e'),
  };
  const resizeEdgesY = {
    start: !!resizeHandle?.includes('n'),
    center: false,
    end: !!resizeHandle?.includes('s'),
  };

  if (ctx.snapEnabled) {
    if (mode === 'move') {
      const bestX = findBestMoveAxisSnap(candidateMm.x, candidateMm.width, xTargets, xSpacings, ctx.thresholdMm);
      const bestY = findBestMoveAxisSnap(candidateMm.y, candidateMm.height, yTargets, ySpacings, ctx.thresholdMm);
      if (bestX) {
        finalRect.x = candidateMm.x + bestX.deltaMm;
        snappedX = true;
      }
      if (bestY) {
        finalRect.y = candidateMm.y + bestY.deltaMm;
        snappedY = true;
      }
    } else if (resizeHandle) {
      const xEdgePos = resizeEdgesX.end
        ? candidateMm.x + candidateMm.width
        : resizeEdgesX.start
          ? candidateMm.x
          : null;
      const yEdgePos = resizeEdgesY.end
        ? candidateMm.y + candidateMm.height
        : resizeEdgesY.start
          ? candidateMm.y
          : null;
      const bestX = xEdgePos !== null ? findBestResizeEdgeSnap(xEdgePos, xTargets, ctx.thresholdMm) : null;
      const bestY = yEdgePos !== null ? findBestResizeEdgeSnap(yEdgePos, yTargets, ctx.thresholdMm) : null;

      const applyXResize = (dx: number) => {
        const nextW = Math.max(2, resizeEdgesX.end ? candidateMm.width + dx : candidateMm.width - dx);
        finalRect.x = resizeEdgesX.start ? candidateMm.x + candidateMm.width - nextW : candidateMm.x;
        finalRect.width = nextW;
        snappedX = true;
      };
      const applyYResize = (dy: number) => {
        const nextH = Math.max(2, resizeEdgesY.end ? candidateMm.height + dy : candidateMm.height - dy);
        finalRect.y = resizeEdgesY.start ? candidateMm.y + candidateMm.height - nextH : candidateMm.y;
        finalRect.height = nextH;
        snappedY = true;
      };

      if (keepAspect && resizeHandle.length === 2 && candidateMm.width > 0 && candidateMm.height > 0) {
        const aspect = candidateMm.width / candidateMm.height;
        const pickX =
          bestX && (!bestY || Math.abs(bestX.deltaMm) <= Math.abs(bestY.deltaMm));
        if (pickX && bestX) {
          applyXResize(bestX.deltaMm);
          const nextH = Math.max(2, finalRect.width / aspect);
          finalRect.y = resizeEdgesY.start ? candidateMm.y + candidateMm.height - nextH : candidateMm.y;
          finalRect.height = nextH;
        } else if (bestY) {
          applyYResize(bestY.deltaMm);
          const nextW = Math.max(2, finalRect.height * aspect);
          finalRect.x = resizeEdgesX.start ? candidateMm.x + candidateMm.width - nextW : candidateMm.x;
          finalRect.width = nextW;
        }
      } else {
        if (bestX) applyXResize(bestX.deltaMm);
        if (bestY) applyYResize(bestY.deltaMm);
      }
    }
  }

  if (!ctx.smartGuidesEnabled) {
    return { rectMm: finalRect, snappedX, snappedY, guides: emptyGuides };
  }

  const alignTol = ctx.snapEnabled ? 0.35 : Math.min(0.8, ctx.thresholdMm * 0.4);
  const xFinalSpacings = mode === 'move' ? collectSpacingProposals('x', finalRect, ctx, peers) : [];
  const yFinalSpacings = mode === 'move' ? collectSpacingProposals('y', finalRect, ctx, peers) : [];

  const xMatched = collectMatchedGuidesForAxis(
    'x',
    finalRect,
    xTargets,
    xFinalSpacings,
    alignTol,
    mode === 'move' ? moveEdges : resizeEdgesX,
  );
  const yMatched = collectMatchedGuidesForAxis(
    'y',
    finalRect,
    yTargets,
    yFinalSpacings,
    alignTol,
    mode === 'move' ? moveEdges : resizeEdgesY,
  );

  return {
    rectMm: finalRect,
    snappedX,
    snappedY,
    guides: {
      lines: [...xMatched.lines, ...yMatched.lines],
      spacings: [...xMatched.spacingBars, ...yMatched.spacingBars],
      referenceLines: buildReferenceLines(ctx),
    },
  };
}
