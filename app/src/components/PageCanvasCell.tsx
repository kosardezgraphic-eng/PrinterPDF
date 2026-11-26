import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCw, SlidersHorizontal } from 'lucide-react';
import type { ComputedCellPlacement, PageItem, PageRotation, PageTransform } from '@shared/models';
import { useAppStore, type CanvasTool, type PageEditScope } from '../store/useAppStore';
import {
  dragFullCrop,
  IDENTITY_TRANSFORM,
  normalizeAngle,
  pageCropFractions,
  panFullCrop,
  resizeProportionally,
  resizeRect,
  rotateInsets,
  rotateVector,
  rotationFromPointer,
  ZERO_INSETS,
  type Handle,
  type Insets,
  type Rect,
} from '../engine/pageGeometry';
import {
  clampPoint01,
  clonePerspectiveQuad,
  DEFAULT_PERSPECTIVE_QUAD,
  evaluateHomography,
  isConvexQuad,
  orderCornersClockwise,
  solveUnitSquareToQuadHomography,
  sourcePointToDisplay,
  type PerspectiveCornerKey,
  type PerspectiveQuad,
} from '../engine/perspectiveCrop';
import { PageContentImage, pageImageStyle } from './PageContentImage';
import { CrispPageCanvas, useCrispPageFrame } from './CrispPageCanvas';
import { useSmartGuides } from './SmartGuidesOverlay';
import { PageEraserLayer } from './PageEraserLayer';
import { eraseMaskCss, erasePaintCss } from '../engine/imageErase';

export type { CanvasTool };

const HANDLES: { id: Handle; left: string; top: string; cursor: string }[] = [
  { id: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
  { id: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
  { id: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
  { id: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
  { id: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
  { id: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
  { id: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
  { id: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
];

const PERSPECTIVE_CORNERS: { key: PerspectiveCornerKey; cursor: string }[] = [
  { key: 'tl', cursor: 'nwse-resize' },
  { key: 'tr', cursor: 'nesw-resize' },
  { key: 'br', cursor: 'nwse-resize' },
  { key: 'bl', cursor: 'nesw-resize' },
];

type GestureHandle = Handle | PerspectiveCornerKey | 'move' | 'rotate';

type Gesture = {
  x: number;
  y: number;
  pointerId: number;
  handle: GestureHandle;
  rect: Rect;
  transform: PageTransform;
  crop: Insets;
  quad: PerspectiveQuad;
  centerX: number;
  centerY: number;
};

interface Props {
  cell: ComputedCellPlacement;
  sheetIndex: number;
  isActive: boolean;
  readOnly?: boolean;
  pxPerMm: number;
  tool: CanvasTool;
  scope: PageEditScope;
  spaceDown: boolean;
  onCurrentPage: (id: string, preserveSelection: boolean, occurrenceKey: string) => void;
}

/** Limit resize preview to exactly the same scale range as the stored transform. */
function resizeForMove(rect: Rect, handle: Handle, dx: number, dy: number, transform: PageTransform): Rect {
  const proposed = resizeProportionally(rect, handle, dx, dy);
  if (handle.length === 2) {
    const factor = Math.max(
      0.05 / transform.scaleX,
      0.05 / transform.scaleY,
      Math.min(10 / transform.scaleX, 10 / transform.scaleY, proposed.width / rect.width)
    );
    const width = rect.width * factor;
    const height = rect.height * factor;
    return {
      x: handle.includes('w') ? rect.x + rect.width - width : rect.x,
      y: handle.includes('n') ? rect.y + rect.height - height : rect.y,
      width,
      height,
    };
  }
  const width = Math.max((rect.width * 0.05) / transform.scaleX, Math.min((rect.width * 10) / transform.scaleX, proposed.width));
  const height = Math.max((rect.height * 0.05) / transform.scaleY, Math.min((rect.height * 10) / transform.scaleY, proposed.height));
  return {
    x: handle.includes('w') ? rect.x + rect.width - width : rect.x,
    y: handle.includes('n') ? rect.y + rect.height - height : rect.y,
    width,
    height,
  };
}

/** Resize in the rotated local axes while keeping the opposite point fixed on screen. */
function rotatedResize(
  rect: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  angle: number,
  resize: (rect: Rect, handle: Handle, dx: number, dy: number) => Rect
): Rect {
  const local = rotateVector(dx, dy, -angle);
  const next = resize(rect, handle, local.x, local.y);
  const shift = rotateVector(
    next.x + next.width / 2 - (rect.x + rect.width / 2),
    next.y + next.height / 2 - (rect.y + rect.height / 2),
    angle
  );
  return {
    ...next,
    x: rect.x + rect.width / 2 + shift.x - next.width / 2,
    y: rect.y + rect.height / 2 + shift.y - next.height / 2,
  };
}

function isRectHandle(handle: GestureHandle): handle is Handle {
  return handle === 'n' || handle === 'ne' || handle === 'e' || handle === 'se' || handle === 's' || handle === 'sw' || handle === 'w' || handle === 'nw';
}

function isPerspectiveCorner(handle: GestureHandle): handle is PerspectiveCornerKey {
  return handle === 'tl' || handle === 'tr' || handle === 'br' || handle === 'bl';
}

function updateQuadFromDrag(
  startQuad: PerspectiveQuad,
  handle: PerspectiveCornerKey | 'move',
  dx: number,
  dy: number,
  angleDeg: number,
  fullWidth: number,
  fullHeight: number
): PerspectiveQuad {
  const local = rotateVector(dx, dy, -angleDeg);
  const fx = local.x / Math.max(1, fullWidth);
  const fy = local.y / Math.max(1, fullHeight);
  const next = clonePerspectiveQuad(startQuad);

  if (handle === 'move') {
    const pts = [next.tl, next.tr, next.br, next.bl];
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const sx = Math.max(-minX, Math.min(1 - maxX, fx));
    const sy = Math.max(-minY, Math.min(1 - maxY, fy));
    next.tl = clampPoint01({ x: next.tl.x + sx, y: next.tl.y + sy });
    next.tr = clampPoint01({ x: next.tr.x + sx, y: next.tr.y + sy });
    next.br = clampPoint01({ x: next.br.x + sx, y: next.br.y + sy });
    next.bl = clampPoint01({ x: next.bl.x + sx, y: next.bl.y + sy });
    return next;
  }

  next[handle] = clampPoint01({ x: next[handle].x + fx, y: next[handle].y + fy });
  return next;
}

export function PageCanvasCell({
  cell,
  sheetIndex,
  isActive,
  readOnly = false,
  pxPerMm,
  tool,
  scope,
  spaceDown,
  onCurrentPage,
}: Props) {
  const effects = useAppStore((state) => state.effects);
  const language = useAppStore((state) => state.settings.language);
  const unit = useAppStore((state) => state.settings.unit);
  const cornerMagnifierEnabled = useAppStore((state) => state.cornerMagnifierEnabled);
  const cropDrafts = useAppStore((state) => state.cropDrafts);
  const perspectiveDrafts = useAppStore((state) => state.perspectiveDrafts);
  const applyPageGeometry = useAppStore((state) => state.applyPageGeometry);
  const setCropDraft = useAppStore((state) => state.setCropDraft);
  const setPerspectiveDraft = useAppStore((state) => state.setPerspectiveDraft);
  const applyCellTransform = useAppStore((state) => state.applyCellTransform);
  const reorderCellLayer = useAppStore((state) => state.reorderCellLayer);
  const openPageSetup = useAppStore((state) => state.openPageSetup);
  const crispEnabled = useAppStore((state) => state.settings.previewFidelity === 'crisp');
  const eraseTool = useAppStore((state) => state.eraseTool);
  const smartGuides = useSmartGuides();
  const smartGuidesRef = useRef(smartGuides);
  smartGuidesRef.current = smartGuides;
  const page = cell.page!;
  const storePage = useAppStore((state) => state.pages.find((p) => p.id === page.id)) ?? page;
  const occurrenceKey = cell.occurrenceKey!;
  const interaction = useRef<Gesture | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [delta, setDelta] = useState({ x: 0, y: 0, shift: false });
  const [snappedDisplay, setSnappedDisplay] = useState<Rect | null>(null);
  const [active, setActive] = useState(false);
  const [hoveredCorner, setHoveredCorner] = useState<PerspectiveCornerKey | null>(null);
  const [hoveredCropHandle, setHoveredCropHandle] = useState<Handle | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const longPress = useRef<{
    pointerId: number;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout> | null;
    fired: boolean;
  } | null>(null);
  const suppressTouchClick = useRef<{ x: number; y: number } | null>(null);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (longPress.current?.timer) clearTimeout(longPress.current.timer);
      if (suppressTimer.current) clearTimeout(suppressTimer.current);
    },
    []
  );

  useEffect(() => {
    // Changing tools during a touch/drag cancels the pending gesture.
    if (longPress.current?.timer) clearTimeout(longPress.current.timer);
    longPress.current = null;
    setHoveredCorner(null);
    setHoveredCropHandle(null);
    if (interaction.current) {
      interaction.current = null;
      setActive(false);
      setDelta({ x: 0, y: 0, shift: false });
      setSnappedDisplay(null);
      smartGuidesRef.current?.clearGuides();
    }
  }, [tool]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menu]);

  const isCropMode = tool === 'crop';
  const isPerspectiveMode = tool === 'perspective-crop';
  const showFullUncropped = isCropMode || isPerspectiveMode;
  const canEdit =
    !readOnly &&
    (tool === 'move' ? isActive && page.isHighlighted : showFullUncropped && page.isHighlighted);

  // Sheet coordinates rather than cell coordinates let a layer move anywhere on the sheet.
  const base: Rect = {
    x: cell.contentXMm * pxPerMm,
    y: cell.contentYMm * pxPerMm,
    width: cell.contentWidthMm * pxPerMm,
    height: cell.contentHeightMm * pxPerMm,
  };
  const gesture = interaction.current;
  const baseAngle = normalizeAngle(cell.transform?.rotationDeg ?? 0);
  const angle =
    active && gesture?.handle === 'rotate'
      ? rotationFromPointer(
          gesture.transform.rotationDeg ?? 0,
          gesture.centerX,
          gesture.centerY,
          gesture.x,
          gesture.y,
          gesture.x + delta.x,
          gesture.y + delta.y,
          delta.shift
        )
      : baseAngle;
  const rawDisplay =
    active && gesture && tool === 'move'
      ? gesture.handle === 'move'
        ? { ...base, x: base.x + delta.x, y: base.y + delta.y }
        : gesture.handle === 'rotate'
          ? base
          : isRectHandle(gesture.handle)
            ? rotatedResize(base, gesture.handle, delta.x, delta.y, baseAngle, (r, h, x, y) =>
                resizeForMove(r, h, x, y, gesture.transform)
              )
            : base
      : base;
  const display = active && snappedDisplay ? snappedDisplay : rawDisplay;

  // In Crop mode, the entire uncropped page is shown underneath and the active crop box
  // floats over it using either the deferred draft crop or the existing committed crop.
  const storedCrop: Insets = cropDrafts[page.id] ?? pageCropFractions(storePage);
  const liveCrop: Insets =
    active && gesture && isCropMode && gesture.handle !== 'rotate'
      ? (() => {
          const local = rotateVector(delta.x, delta.y, -baseAngle);
          if (gesture.handle === 'move') {
            return panFullCrop(gesture.crop, cell.effectiveRotation, local.x, local.y, base.width, base.height);
          }
          if (isRectHandle(gesture.handle)) {
            return dragFullCrop(
              gesture.crop,
              cell.effectiveRotation,
              gesture.handle,
              local.x,
              local.y,
              base.width,
              base.height
            );
          }
          return gesture.crop;
        })()
      : storedCrop;
  const liveRotCrop = rotateInsets(liveCrop, cell.effectiveRotation);
  const cropBoxRect: Rect = {
    x: liveRotCrop.left * display.width,
    y: liveRotCrop.top * display.height,
    width: Math.max(4, (1 - liveRotCrop.left - liveRotCrop.right) * display.width),
    height: Math.max(4, (1 - liveRotCrop.top - liveRotCrop.bottom) * display.height),
  };

  // Re-editable perspective crop: show the full original image before the previous perspective crop.
  const perspSrc = isPerspectiveMode ? (storePage.overrides?.perspectiveSource ?? page.overrides?.perspectiveSource) : undefined;
  const perspRotation: PageRotation = perspSrc
    ? (perspectiveDrafts[page.id]?.effectiveRotation ?? perspSrc.effectiveRotation ?? perspSrc.rotation)
    : cell.effectiveRotation;
  const effectivePageRotation: PageRotation = perspSrc ? perspRotation : cell.effectiveRotation;
  const perspFullRect: Rect | null = perspSrc
    ? (() => {
        const origW = perspRotation === 90 || perspRotation === 270 ? perspSrc.heightMm : perspSrc.widthMm;
        const origH = perspRotation === 90 || perspRotation === 270 ? perspSrc.widthMm : perspSrc.heightMm;
        const cellWpx = Math.max(1, cell.cellWidthMm * pxPerMm);
        const cellHpx = Math.max(1, cell.cellHeightMm * pxPerMm);
        const fitScale = Math.min(cellWpx / Math.max(1, origW), cellHpx / Math.max(1, origH));
        const fitW = origW * fitScale;
        const fitH = origH * fitScale;
        return {
          x: cell.cellXMm * pxPerMm + (cellWpx - fitW) / 2,
          y: cell.cellYMm * pxPerMm + (cellHpx - fitH) / 2,
          width: fitW,
          height: fitH,
        };
      })()
    : null;
  const effectiveBase = perspFullRect ?? base;
  const effectiveDisplay = perspFullRect ?? display;
  const effectiveDisplayAngle = perspFullRect ? 0 : angle;

  const detectedScan = storePage.overrides?.detectedBoundaries ?? page.overrides?.detectedBoundaries;
  const detectedDispQuad: PerspectiveQuad | null = detectedScan
    ? orderCornersClockwise([
        sourcePointToDisplay(detectedScan.corners.tl, effectivePageRotation),
        sourcePointToDisplay(detectedScan.corners.tr, effectivePageRotation),
        sourcePointToDisplay(detectedScan.corners.br, effectivePageRotation),
        sourcePointToDisplay(detectedScan.corners.bl, effectivePageRotation),
      ])
    : null;

  // Perspective Crop quad (in [0..1] display-rotated space)
  const storedQuad: PerspectiveQuad =
    perspectiveDrafts[page.id]?.quad ??
    (perspSrc?.quad
      ? clonePerspectiveQuad(perspSrc.quad)
      : detectedDispQuad && isConvexQuad(detectedDispQuad, 0.06)
        ? detectedDispQuad
        : DEFAULT_PERSPECTIVE_QUAD);
  const liveQuad: PerspectiveQuad =
    active && gesture && isPerspectiveMode && (gesture.handle === 'move' || isPerspectiveCorner(gesture.handle))
      ? updateQuadFromDrag(
          gesture.quad,
          gesture.handle,
          delta.x,
          delta.y,
          effectiveDisplayAngle,
          effectiveBase.width,
          effectiveBase.height
        )
      : storedQuad;
  const quadValid = isConvexQuad(liveQuad);

  // Unedited fill-mode content keeps its historical cell clip. Moved/resized or crop-mode content is not clipped to cell.
  const clipToCell = !cell.allowOverflow && !(active && tool === 'move') && !showFullUncropped;
  const inset = clipToCell
    ? `inset(${Math.max(0, cell.cellYMm * pxPerMm - display.y)}px ${Math.max(0, display.x + display.width - (cell.cellXMm + cell.cellWidthMm) * pxPerMm)}px ${Math.max(0, display.y + display.height - (cell.cellYMm + cell.cellHeightMm) * pxPerMm)}px ${Math.max(0, cell.cellXMm * pxPerMm - display.x)}px)`
    : undefined;

  const computeSnappedRect = (start: Gesture, dx: number, dy: number, commit: boolean): Rect | null => {
    if (!smartGuides || tool !== 'move' || start.handle === 'rotate' || isPerspectiveCorner(start.handle)) {
      return null;
    }
    const gAngle = normalizeAngle(start.transform.rotationDeg ?? 0);
    if (start.handle !== 'move' && Math.abs(gAngle) > 0.5) return null;
    const raw =
      start.handle === 'move'
        ? { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy }
        : rotatedResize(start.rect, start.handle, dx, dy, gAngle, (r, h, x, y) =>
            resizeForMove(r, h, x, y, start.transform)
          );
    const scale = Math.max(0.01, pxPerMm);
    const res = smartGuides.applySnap({
      rectMm: { x: raw.x / scale, y: raw.y / scale, width: raw.width / scale, height: raw.height / scale },
      mode: start.handle === 'move' ? 'move' : 'resize',
      resizeHandle: start.handle === 'move' ? undefined : start.handle,
      keepAspect: start.handle !== 'move' && start.handle.length === 2,
      excludeId: `cell:${occurrenceKey}`,
      commit,
    });
    return {
      x: res.rectMm.x * scale,
      y: res.rectMm.y * scale,
      width: res.rectMm.width * scale,
      height: res.rectMm.height * scale,
    };
  };

  const begin = (event: React.PointerEvent<HTMLElement>, handle: GestureHandle) => {
    if (!canEdit || spaceDown || interaction.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    onCurrentPage(page.id, true, occurrenceKey);
    const bounds = contentRef.current?.getBoundingClientRect();
    interaction.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      handle,
      rect: effectiveBase,
      transform: perspFullRect ? IDENTITY_TRANSFORM : (cell.transform ?? IDENTITY_TRANSFORM),
      crop: { ...storedCrop },
      quad: clonePerspectiveQuad(storedQuad),
      centerX: bounds ? bounds.left + bounds.width / 2 : event.clientX,
      centerY: bounds ? bounds.top + bounds.height / 2 : event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDelta({ x: 0, y: 0, shift: false });
    setSnappedDisplay(null);
    setActive(true);
  };

  const move = (event: React.PointerEvent<HTMLElement>) => {
    const press = longPress.current;
    if (press && press.pointerId === event.pointerId) {
      if (press.fired) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8 && press.timer) {
        clearTimeout(press.timer);
        press.timer = null;
      }
    }
    const start = interaction.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    setDelta({ x: dx, y: dy, shift: event.shiftKey });
    setSnappedDisplay(computeSnappedRect(start, dx, dy, false));
  };

  const end = (event: React.PointerEvent<HTMLElement>, canceled = false) => {
    const start = interaction.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    interaction.current = null;
    setActive(false);
    setDelta({ x: 0, y: 0, shift: false });
    setSnappedDisplay(null);
    smartGuides?.clearGuides();
    if (canceled || Math.hypot(dx, dy) < (event.pointerType === 'touch' ? 8 : 0.5)) return;

    if (tool === 'move' && start.handle === 'rotate') {
      const rotationDeg = rotationFromPointer(
        start.transform.rotationDeg ?? 0,
        start.centerX,
        start.centerY,
        start.x,
        start.y,
        event.clientX,
        event.clientY,
        event.shiftKey
      );
      const transform = { ...start.transform, rotationDeg };
      if (scope === 'current') applyCellTransform(page.id, occurrenceKey, transform);
      else applyPageGeometry(page.id, scope, { kind: 'transform', transform });
    } else if (tool === 'crop' && start.handle !== 'rotate') {
      const local = rotateVector(dx, dy, -(start.transform.rotationDeg ?? 0));
      const nextCrop =
        start.handle === 'move'
          ? panFullCrop(start.crop, cell.effectiveRotation, local.x, local.y, start.rect.width, start.rect.height)
          : isRectHandle(start.handle)
            ? dragFullCrop(
                start.crop,
                cell.effectiveRotation,
                start.handle,
                local.x,
                local.y,
                start.rect.width,
                start.rect.height
              )
            : start.crop;
      // Hold in deferred draft state while Crop tool stays open so full image stays visible.
      setCropDraft(page.id, scope, nextCrop);
    } else if (tool === 'perspective-crop' && (start.handle === 'move' || isPerspectiveCorner(start.handle))) {
      const nextQuad = updateQuadFromDrag(
        start.quad,
        start.handle,
        dx,
        dy,
        start.transform.rotationDeg ?? 0,
        start.rect.width,
        start.rect.height
      );
      setPerspectiveDraft(page.id, nextQuad, { effectiveRotation: effectivePageRotation });
    } else if (tool === 'move' && start.handle !== 'rotate' && !isPerspectiveCorner(start.handle)) {
      const rawRect =
        start.handle === 'move'
          ? { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy }
          : rotatedResize(start.rect, start.handle, dx, dy, start.transform.rotationDeg ?? 0, (r, h, x, y) =>
              resizeForMove(r, h, x, y, start.transform)
            );
      const rect = computeSnappedRect(start, dx, dy, true) ?? rawRect;
      const prev = start.transform;
      const transform: PageTransform = {
        ...prev,
        x: prev.x + (rect.x - start.rect.x + (rect.width - start.rect.width) / 2) / Math.max(1, cell.cellWidthMm * pxPerMm),
        y: prev.y + (rect.y - start.rect.y + (rect.height - start.rect.height) / 2) / Math.max(1, cell.cellHeightMm * pxPerMm),
        scaleX: Math.max(0.05, Math.min(10, (prev.scaleX * rect.width) / start.rect.width)),
        scaleY: Math.max(0.05, Math.min(10, (prev.scaleY * rect.height) / start.rect.height)),
      };
      if (scope === 'current') applyCellTransform(page.id, occurrenceKey, transform);
      else applyPageGeometry(page.id, scope, { kind: 'transform', transform });
    }
  };

  const openMenu = (x: number, y: number) => {
    onCurrentPage(page.id, true, occurrenceKey);
    setMenu({
      x: Math.max(0, Math.min(window.innerWidth - 215, x)),
      y: Math.max(0, Math.min(window.innerHeight - 240, y)),
    });
  };

  const consumeTouchClick = (event: React.MouseEvent<HTMLElement>) => {
    const point = suppressTouchClick.current;
    if (!point || Math.hypot(event.clientX - point.x, event.clientY - point.y) > 12) return false;
    suppressTouchClick.current = null;
    if (suppressTimer.current) clearTimeout(suppressTimer.current);
    suppressTimer.current = null;
    return true;
  };

  const finishPress = (event: React.PointerEvent<HTMLElement>, canceled = false) => {
    const press = longPress.current;
    if (press && press.pointerId === event.pointerId) {
      if (press.timer) clearTimeout(press.timer);
      longPress.current = null;
      if (press.fired) {
        event.preventDefault();
        event.stopPropagation();
        suppressTouchClick.current = { x: event.clientX, y: event.clientY };
        if (suppressTimer.current) clearTimeout(suppressTimer.current);
        suppressTimer.current = setTimeout(() => {
          suppressTouchClick.current = null;
          suppressTimer.current = null;
        }, 700);
        return;
      }
    }
    end(event, canceled);
  };

  const startTouchHold = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch' || spaceDown || (tool !== 'move' && tool !== 'crop')) return;
    if (longPress.current) {
      if (longPress.current.timer) clearTimeout(longPress.current.timer);
      longPress.current.timer = null;
      return;
    }
    const press = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: null as ReturnType<typeof setTimeout> | null,
      fired: false,
    };
    longPress.current = press;
    event.currentTarget.setPointerCapture(event.pointerId);
    press.timer = setTimeout(() => {
      if (longPress.current !== press) return;
      press.timer = null;
      press.fired = true;
      interaction.current = null;
      setActive(false);
      setDelta({ x: 0, y: 0, shift: false });
      suppressTouchClick.current = { x: press.x, y: press.y };
      openMenu(press.x + 16, press.y + 16);
    }, 600);
  };

  const displayPage: PageItem = perspSrc
    ? {
        ...page,
        documentId: perspSrc.documentId,
        documentName: perspSrc.documentName,
        sourcePageNumber: perspSrc.sourcePageNumber,
        widthMm: perspSrc.widthMm,
        heightMm: perspSrc.heightMm,
        rotation: perspSrc.rotation,
        thumbnailDataUrl: perspSrc.thumbnailDataUrl,
        overrides: page.overrides
          ? { ...page.overrides, cropBoxMm: undefined, transform: undefined }
          : undefined,
      }
    : showFullUncropped && page.overrides?.cropBoxMm
      ? { ...page, overrides: { ...page.overrides, cropBoxMm: undefined } }
      : page;
  const crisp = useCrispPageFrame({
    page: displayPage,
    enabled: crispEnabled,
    width: effectiveDisplay.width,
    height: effectiveDisplay.height,
    hostRef: contentRef,
  });
  const pageEraseBox = {
    width: display.width,
    height: display.height,
    widthMm: display.width / Math.max(0.01, pxPerMm),
    heightMm: display.height / Math.max(0.01, pxPerMm),
  };
  const pageEraseMask = eraseMaskCss(page.erase, pageEraseBox);
  const pageErasePaint = erasePaintCss(page.erase, pageEraseBox);
  const pointerEvents = {
    onPointerMove: move,
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => finishPress(e),
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => finishPress(e, true),
    onLostPointerCapture: (e: React.PointerEvent<HTMLElement>) => finishPress(e, true),
  };
  const fa = language === 'fa';
  const menuActions = [
    { id: 'front' as const, label: fa ? 'انتقال به روی همه' : 'Bring to front' },
    { id: 'forward' as const, label: fa ? 'یک لایه جلوتر' : 'Bring forward' },
    { id: 'backward' as const, label: fa ? 'یک لایه عقب‌تر' : 'Send backward' },
    { id: 'back' as const, label: fa ? 'انتقال به پشت همه' : 'Send to back' },
  ];

  // Perspective grid lines evaluated with exact planar homography
  const perspH = isPerspectiveMode && canEdit ? solveUnitSquareToQuadHomography(liveQuad) : null;
  const perspGridLines = perspH
    ? [0.25, 0.5, 0.75].flatMap((t) => {
        const vStart = evaluateHomography(perspH, t, 0);
        const vEnd = evaluateHomography(perspH, t, 1);
        const hStart = evaluateHomography(perspH, 0, t);
        const hEnd = evaluateHomography(perspH, 1, t);
        return [
          { x1: vStart.x * 1000, y1: vStart.y * 1000, x2: vEnd.x * 1000, y2: vEnd.y * 1000 },
          { x1: hStart.x * 1000, y1: hStart.y * 1000, x2: hEnd.x * 1000, y2: hEnd.y * 1000 },
        ];
      })
    : [];

  return (
    <div
      data-canvas-page-id={page.id}
      data-occurrence-key={occurrenceKey}
      className="pointer-events-none absolute inset-0"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (readOnly) return;
        const press = longPress.current;
        if (press?.fired) return;
        if (press) {
          if (press.timer) clearTimeout(press.timer);
          press.timer = null;
          press.fired = true;
          interaction.current = null;
          setActive(false);
          setDelta({ x: 0, y: 0, shift: false });
          suppressTouchClick.current = { x: press.x, y: press.y };
        }
        openMenu(press ? press.x + 16 : e.clientX, press ? press.y + 16 : e.clientY);
      }}
    >
      <div
        ref={contentRef}
        data-page-content
        data-uncropped-preview={showFullUncropped ? 'true' : undefined}
        onClick={(e) => {
          if (tool === 'layout') return;
          e.stopPropagation();
          if (readOnly) return;
          if (consumeTouchClick(e)) {
            e.preventDefault();
            return;
          }
          if (tool === 'move' || showFullUncropped) onCurrentPage(page.id, page.isHighlighted, occurrenceKey);
        }}
        onPointerDown={(e) => {
          if (readOnly) return;
          startTouchHold(e);
          if (tool === 'move') begin(e, 'move');
        }}
        {...pointerEvents}
        style={{
          left: effectiveDisplay.x,
          top: effectiveDisplay.y,
          width: effectiveDisplay.width,
          height: effectiveDisplay.height,
          transform: `rotate(${effectiveDisplayAngle}deg)`,
          clipPath: inset,
          pointerEvents: readOnly ? 'none' : 'auto',
          touchAction: canEdit ? 'none' : 'auto',
          WebkitTouchCallout: 'none',
          userSelect: 'none',
          cursor: canEdit && tool === 'move' ? 'move' : 'pointer',
        }}
        className={`pointer-events-auto absolute overflow-hidden ${
          (tool === 'move' ? isActive && page.isHighlighted : page.isHighlighted) ? 'ring-2 ring-inset ring-sky-500' : ''
        }`}
      >
        <div
          className="absolute inset-0"
          style={
            pageEraseMask
              ? {
                  maskImage: pageEraseMask,
                  WebkitMaskImage: pageEraseMask,
                  maskSize: '100% 100%',
                  WebkitMaskSize: '100% 100%',
                  maskRepeat: 'no-repeat',
                  WebkitMaskRepeat: 'no-repeat',
                  maskPosition: '0 0',
                  WebkitMaskPosition: '0 0',
                  maskMode: 'alpha',
                }
              : undefined
          }
        >
          <PageContentImage
            page={displayPage}
            effects={effects}
            rotation={effectivePageRotation}
            width={effectiveDisplay.width}
            height={effectiveDisplay.height}
          />
          {crispEnabled && (
            <CrispPageCanvas
              page={displayPage}
              effects={effects}
              width={effectiveDisplay.width}
              height={effectiveDisplay.height}
              frame={crisp.frame}
              onStaleFrame={crisp.askAgain}
              style={pageImageStyle(displayPage, effectivePageRotation, effectiveDisplay.width, effectiveDisplay.height)}
            />
          )}
        </div>
        {(eraseTool === 'off' || readOnly) && pageErasePaint && (
          <div
            aria-hidden="true"
            data-page-paint
            className="pointer-events-none absolute inset-0 z-[4]"
            style={{
              backgroundImage: pageErasePaint,
              backgroundSize: '100% 100%',
              backgroundRepeat: 'no-repeat',
            }}
          />
        )}
        {eraseTool !== 'off' && !readOnly && (
          <PageEraserLayer page={page} width={display.width} height={display.height} pxPerMm={pxPerMm} />
        )}
      </div>

      {/* Move / Resize / Rotate handles */}
      {canEdit && tool === 'move' && (
        <div
          style={{
            left: display.x,
            top: display.y,
            width: display.width,
            height: display.height,
            transform: `rotate(${angle}deg)`,
          }}
          className="pointer-events-none absolute z-20 border-2 border-sky-500"
        >
          {HANDLES.map((handle) => (
            <button
              key={handle.id}
              type="button"
              aria-label={`move ${handle.id}`}
              onPointerDown={(e) => begin(e, handle.id)}
              onClick={(e) => e.stopPropagation()}
              {...pointerEvents}
              style={{
                left: handle.left,
                top: handle.top,
                cursor: handle.cursor,
                touchAction: 'none',
                transform: 'translate(-50%, -50%)',
              }}
              className="pointer-events-auto absolute h-5 w-5 rounded-sm border-2 border-white bg-sky-600 shadow"
            />
          ))}
          <button
            type="button"
            data-rotation-handle
            aria-label={fa ? 'چرخش تصویر' : 'Rotate image'}
            title={fa ? 'چرخش آزاد؛ با Shift گام‌های ۴۵ درجه' : 'Rotate freely; hold Shift to snap to 45°'}
            onPointerDown={(e) => begin(e, 'rotate')}
            onClick={(e) => e.stopPropagation()}
            {...pointerEvents}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              e.stopPropagation();
              const direction = e.key === 'ArrowRight' ? 1 : -1;
              const rotationDeg = normalizeAngle(
                e.shiftKey
                  ? (direction > 0 ? Math.floor(baseAngle / 45 + 1e-9) + 1 : Math.ceil(baseAngle / 45 - 1e-9) - 1) * 45
                  : baseAngle + direction
              );
              const transform = { ...(cell.transform ?? IDENTITY_TRANSFORM), rotationDeg };
              if (scope === 'current') applyCellTransform(page.id, occurrenceKey, transform);
              else applyPageGeometry(page.id, scope, { kind: 'transform', transform });
            }}
            style={{ left: '50%', top: 'min(22px, 20%)', transform: 'translate(-50%, -50%)', touchAction: 'none' }}
            className="pointer-events-auto absolute flex h-8 w-8 cursor-grab items-center justify-center rounded-full border-2 border-white bg-indigo-600 text-white shadow"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
          </button>
          {active && gesture?.handle === 'rotate' && (
            <span
              data-rotation-value
              dir="ltr"
              className="absolute left-1/2 top-10 -translate-x-1/2 rounded bg-slate-900/90 px-1 text-xs text-white"
            >
              {Math.round(angle * 10) / 10}°
            </span>
          )}
        </div>
      )}

      {/* Deferred Crop Mode: full uncropped image underneath + darkened outside scrim + draggable crop box & 8 handles */}
      {canEdit && isCropMode && (
        <div
          data-crop-overlay
          data-has-detected-boundaries={detectedDispQuad ? 'true' : undefined}
          style={{
            left: display.x,
            top: display.y,
            width: display.width,
            height: display.height,
            transform: `rotate(${angle}deg)`,
          }}
          className="pointer-events-none absolute z-20"
        >
          {detectedDispQuad && isConvexQuad(detectedDispQuad, 0.06) && (
            <svg
              data-crop-detected-quad
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[1] h-full w-full overflow-visible"
            >
              <polygon
                points={`${detectedDispQuad.tl.x * 1000},${detectedDispQuad.tl.y * 1000} ${detectedDispQuad.tr.x * 1000},${detectedDispQuad.tr.y * 1000} ${detectedDispQuad.br.x * 1000},${detectedDispQuad.br.y * 1000} ${detectedDispQuad.bl.x * 1000},${detectedDispQuad.bl.y * 1000}`}
                fill="none"
                stroke="#10b981"
                strokeWidth={2}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
          {/* Semi-transparent dark scrim outside the crop box */}
          <div data-crop-scrim aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div
              className="absolute inset-x-0 top-0 bg-slate-950/55"
              style={{ height: cropBoxRect.y }}
            />
            <div
              className="absolute inset-x-0 bottom-0 bg-slate-950/55"
              style={{ top: cropBoxRect.y + cropBoxRect.height }}
            />
            <div
              className="absolute left-0 bg-slate-950/55"
              style={{
                top: cropBoxRect.y,
                height: cropBoxRect.height,
                width: cropBoxRect.x,
              }}
            />
            <div
              className="absolute right-0 bg-slate-950/55"
              style={{
                top: cropBoxRect.y,
                height: cropBoxRect.height,
                left: cropBoxRect.x + cropBoxRect.width,
              }}
            />
          </div>

          {/* Crop Box + Rule-of-thirds + 8 Handles */}
          <div
            data-crop-box
            style={{
              left: cropBoxRect.x,
              top: cropBoxRect.y,
              width: cropBoxRect.width,
              height: cropBoxRect.height,
              touchAction: 'none',
            }}
            onPointerDown={(e) => begin(e, 'move')}
            onClick={(e) => e.stopPropagation()}
            {...pointerEvents}
            className="pointer-events-auto absolute border-2 border-amber-500 cursor-move"
          >
            {/* Rule-of-thirds interior lines */}
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/40" />
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/40" />
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/40" />
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/40" />

            {HANDLES.map((handle) => (
              <button
                key={handle.id}
                type="button"
                aria-label={`crop ${handle.id}`}
                onPointerDown={(e) => begin(e, handle.id)}
                onPointerEnter={() => setHoveredCropHandle(handle.id)}
                onMouseEnter={() => setHoveredCropHandle(handle.id)}
                onPointerLeave={() => setHoveredCropHandle((prev) => (prev === handle.id ? null : prev))}
                onMouseLeave={() => setHoveredCropHandle((prev) => (prev === handle.id ? null : prev))}
                onClick={(e) => e.stopPropagation()}
                {...pointerEvents}
                style={{
                  left: handle.left,
                  top: handle.top,
                  cursor: handle.cursor,
                  touchAction: 'none',
                  transform: 'translate(-50%, -50%)',
                }}
                className="pointer-events-auto absolute h-5 w-5 rounded-sm border-2 border-white bg-amber-500 shadow"
              />
            ))}
          </div>
          {(() => {
            const draggedCropHandle =
              active && gesture && isRectHandle(gesture.handle) ? gesture.handle : null;
            const inspectedCropHandle = draggedCropHandle ?? hoveredCropHandle;
            if (!inspectedCropHandle) return null;
            const rot = cell.effectiveRotation;
            const baseW = rot === 90 || rot === 270 ? page.heightMm : page.widthMm;
            const baseH = rot === 90 || rot === 270 ? page.widthMm : page.heightMm;
            const factor = unit === 'cm' ? 0.1 : unit === 'in' ? 1 / 25.4 : 1;
            const unitSuffix = unit === 'cm' ? 'cm' : unit === 'in' ? 'in' : 'mm';
            const cropWMm = (1 - liveRotCrop.left - liveRotCrop.right) * baseW * factor;
            const cropHMm = (1 - liveRotCrop.top - liveRotCrop.bottom) * baseH * factor;
            const leftPct = (cropBoxRect.x / Math.max(1, display.width)) * 100;
            const rightPct = ((cropBoxRect.x + cropBoxRect.width) / Math.max(1, display.width)) * 100;
            const topPct = (cropBoxRect.y / Math.max(1, display.height)) * 100;
            const bottomPct = ((cropBoxRect.y + cropBoxRect.height) / Math.max(1, display.height)) * 100;
            const hx = inspectedCropHandle.includes('w')
              ? leftPct
              : inspectedCropHandle.includes('e')
                ? rightPct
                : (leftPct + rightPct) / 2;
            const hy = inspectedCropHandle.includes('n')
              ? topPct
              : inspectedCropHandle.includes('s')
                ? bottomPct
                : (topPct + bottomPct) / 2;
            const placeBelow = hy < 22;
            return (
              <div
                data-crop-tooltip={inspectedCropHandle}
                dir="ltr"
                style={{
                  left: `${Math.min(88, Math.max(12, hx))}%`,
                  ...(placeBelow
                    ? { top: `calc(${hy}% + 14px)` }
                    : { bottom: `calc(${100 - hy}% + 14px)` }),
                  transform: 'translateX(-50%)',
                }}
                className="pointer-events-none absolute z-30 whitespace-nowrap rounded border border-amber-400/70 bg-slate-950/95 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-100 shadow-lg"
              >
                {inspectedCropHandle.toUpperCase()} · {cropWMm.toFixed(1)}×{cropHMm.toFixed(1)} {unitSuffix}
              </div>
            );
          })()}
        </div>
      )}

      {/* Perspective Crop Mode: 4-corner polygon + exact projective grid + corner handles */}
      {canEdit && isPerspectiveMode && (
        <div
          data-perspective-overlay
          data-showing-original-source={perspSrc ? 'true' : undefined}
          data-has-detected-boundaries={detectedDispQuad ? 'true' : undefined}
          style={{
            left: effectiveDisplay.x,
            top: effectiveDisplay.y,
            width: effectiveDisplay.width,
            height: effectiveDisplay.height,
            transform: `rotate(${effectiveDisplayAngle}deg)`,
          }}
          className="pointer-events-none absolute z-20"
        >
          <svg
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          >
            {/* Dark mask outside the quad */}
            <path
              fillRule="evenodd"
              fill="rgba(15, 23, 42, 0.58)"
              d={`M0 0 H1000 V1000 H0 Z M${liveQuad.tl.x * 1000} ${liveQuad.tl.y * 1000} L${liveQuad.tr.x * 1000} ${liveQuad.tr.y * 1000} L${liveQuad.br.x * 1000} ${liveQuad.br.y * 1000} L${liveQuad.bl.x * 1000} ${liveQuad.bl.y * 1000} Z`}
            />
            {/* Exact projective perspective interior grid */}
            {quadValid &&
              perspGridLines.map((ln, idx) => (
                <line
                  key={idx}
                  x1={ln.x1}
                  y1={ln.y1}
                  x2={ln.x2}
                  y2={ln.y2}
                  stroke="rgba(255, 255, 255, 0.5)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            {/* Interactive interior polygon to drag all 4 corners together */}
            <polygon
              data-perspective-quad
              points={`${liveQuad.tl.x * 1000},${liveQuad.tl.y * 1000} ${liveQuad.tr.x * 1000},${liveQuad.tr.y * 1000} ${liveQuad.br.x * 1000},${liveQuad.br.y * 1000} ${liveQuad.bl.x * 1000},${liveQuad.bl.y * 1000}`}
              fill="transparent"
              stroke={quadValid ? '#0ea5e9' : '#f43f5e'}
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
              className="pointer-events-auto cursor-move"
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => begin(e as unknown as React.PointerEvent<HTMLElement>, 'move')}
              onClick={(e) => e.stopPropagation()}
              {...(pointerEvents as unknown as React.SVGProps<SVGPolygonElement>)}
            />
          </svg>

          {!quadValid && (
            <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded bg-rose-600/95 px-2 py-0.5 text-[10px] font-bold text-white shadow">
              {fa ? 'چهارضلعی نامعتبر (نقاط متقاطع)' : 'Invalid quad (edges cross)'}
            </div>
          )}

          {PERSPECTIVE_CORNERS.map((corner) => {
            const pt = liveQuad[corner.key];
            const isInspected =
              (active && gesture?.handle === corner.key) || hoveredCorner === corner.key;
            return (
              <button
                key={corner.key}
                type="button"
                data-perspective-corner={corner.key}
                aria-label={`perspective ${corner.key}`}
                onPointerDown={(e) => begin(e, corner.key)}
                onPointerEnter={() => setHoveredCorner(corner.key)}
                onMouseEnter={() => setHoveredCorner(corner.key)}
                onPointerLeave={() => setHoveredCorner((prev) => (prev === corner.key ? null : prev))}
                onMouseLeave={() => setHoveredCorner((prev) => (prev === corner.key ? null : prev))}
                onClick={(e) => e.stopPropagation()}
                {...pointerEvents}
                style={{
                  left: `${pt.x * 100}%`,
                  top: `${pt.y * 100}%`,
                  cursor: corner.cursor,
                  touchAction: 'none',
                  transform: 'translate(-50%, -50%)',
                }}
                className={`pointer-events-auto absolute flex h-6 w-6 items-center justify-center rounded-full border-2 border-white shadow-md ${
                  quadValid ? 'bg-sky-500' : 'bg-rose-500'
                } ${isInspected ? 'ring-2 ring-amber-300 ring-offset-1 ring-offset-slate-900' : ''}`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
              </button>
            );
          })}

          {(() => {
            const draggedCorner: PerspectiveCornerKey | null =
              active && gesture && isPerspectiveCorner(gesture.handle) ? gesture.handle : null;
            const inspectedCorner = draggedCorner ?? hoveredCorner;
            if (!inspectedCorner) return null;
            const pt = liveQuad[inspectedCorner];
            const lensSize = 96;
            const mag = 3;
            const rot = effectivePageRotation;
            const srcW = perspSrc ? perspSrc.widthMm : page.widthMm;
            const srcH = perspSrc ? perspSrc.heightMm : page.heightMm;
            const dispW = rot === 90 || rot === 270 ? srcH : srcW;
            const dispH = rot === 90 || rot === 270 ? srcW : srcH;
            const factor = unit === 'cm' ? 0.1 : unit === 'in' ? 1 / 25.4 : 1;
            const unitSuffix = unit === 'cm' ? 'cm' : unit === 'in' ? 'in' : 'mm';
            const xVal = (pt.x * dispW * factor).toFixed(1);
            const yVal = (pt.y * dispH * factor).toFixed(1);
            const cornerLabels: Record<PerspectiveCornerKey, string> = fa
              ? { tl: 'بالا-چپ (TL)', tr: 'بالا-راست (TR)', br: 'پایین-راست (BR)', bl: 'پایین-چپ (BL)' }
              : { tl: 'TL', tr: 'TR', br: 'BR', bl: 'BL' };
            const placeBelow = pt.y < 0.28;
            const translateX = pt.x > 0.72 ? '-85%' : pt.x < 0.28 ? '-15%' : '-50%';
            const zoomW = Math.max(24, effectiveDisplay.width * mag);
            const zoomH = Math.max(24, effectiveDisplay.height * mag);
            const offsetX = lensSize / 2 - pt.x * zoomW;
            const offsetY = lensSize / 2 - pt.y * zoomH;

            return (
              <div
                style={{
                  left: `${pt.x * 100}%`,
                  ...(placeBelow
                    ? { top: `calc(${pt.y * 100}% + 18px)` }
                    : { bottom: `calc(${100 - pt.y * 100}% + 18px)` }),
                  transform: `translateX(${translateX})`,
                }}
                className={`pointer-events-none absolute z-30 flex items-center gap-1.5 ${
                  placeBelow ? 'flex-col' : 'flex-col-reverse'
                }`}
              >
                <div
                  data-corner-tooltip={inspectedCorner}
                  dir="ltr"
                  className="whitespace-nowrap rounded border border-sky-400/60 bg-slate-950/95 px-2 py-0.5 font-mono text-[10px] font-semibold text-sky-100 shadow-xl"
                >
                  {cornerLabels[inspectedCorner]} · X:{xVal}{unitSuffix} Y:{yVal}{unitSuffix} ({Math.round(pt.x * 100)}%,{Math.round(pt.y * 100)}%)
                </div>

                {cornerMagnifierEnabled && (
                  <div
                    data-corner-magnifier={inspectedCorner}
                    style={{ width: lensSize, height: lensSize }}
                    className="relative overflow-hidden rounded-full border-2 border-sky-400 bg-slate-900 shadow-2xl ring-2 ring-slate-950/80"
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: offsetX,
                        top: offsetY,
                        width: zoomW,
                        height: zoomH,
                      }}
                    >
                      <PageContentImage
                        page={displayPage}
                        effects={effects}
                        rotation={effectivePageRotation}
                        width={zoomW}
                        height={zoomH}
                      />
                    </div>
                    <svg
                      width={lensSize}
                      height={lensSize}
                      viewBox={`0 0 ${lensSize} ${lensSize}`}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0"
                    >
                      <line x1={lensSize / 2} y1={0} x2={lensSize / 2} y2={lensSize / 2 - 7} stroke="#38bdf8" strokeWidth={1.2} />
                      <line x1={lensSize / 2} y1={lensSize / 2 + 7} x2={lensSize / 2} y2={lensSize} stroke="#38bdf8" strokeWidth={1.2} />
                      <line x1={0} y1={lensSize / 2} x2={lensSize / 2 - 7} y2={lensSize / 2} stroke="#38bdf8" strokeWidth={1.2} />
                      <line x1={lensSize / 2 + 7} y1={lensSize / 2} x2={lensSize} y2={lensSize / 2} stroke="#38bdf8" strokeWidth={1.2} />
                      <circle cx={lensSize / 2} cy={lensSize / 2} r={6} fill="none" stroke="#f59e0b" strokeWidth={1.5} />
                    </svg>
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-slate-950/85 px-1 font-mono text-[9px] font-bold text-sky-300">
                      3×
                    </span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {menu &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999]"
            onClickCapture={(e) => {
              if (consumeTouchClick(e)) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              setMenu(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu(null);
            }}
          >
            <div
              data-layer-menu
              role="menu"
              style={{ position: 'fixed', left: menu.x, top: menu.y }}
              className="min-w-48 rounded-lg border border-slate-600 bg-slate-900 p-1 text-sm text-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {menuActions.map((action) => (
                <button
                  role="menuitem"
                  key={action.id}
                  type="button"
                  className="block w-full rounded px-3 py-2 text-start hover:bg-slate-700"
                  onClick={() => {
                    reorderCellLayer(sheetIndex, occurrenceKey, action.id);
                    setMenu(null);
                  }}
                >
                  {action.label}
                </button>
              ))}
              <div className="my-1 h-px bg-slate-700/80" />
              <button
                role="menuitem"
                type="button"
                data-context-action="page-setup"
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-start text-sky-300 hover:bg-slate-700"
                onClick={() => {
                  setMenu(null);
                  openPageSetup('margins');
                }}
              >
                <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{fa ? 'تنظیمات صفحه...' : 'Page Setup...'}</span>
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
