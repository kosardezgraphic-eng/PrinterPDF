import type { PageItem, PageRotation, PagePerPageOverrides } from '@shared/models';

export interface Insets { top: number; right: number; bottom: number; left: number }
export const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
export const IDENTITY_TRANSFORM = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export interface Rect { x: number; y: number; width: number; height: number }

/** Crop in fractions of the unrotated source dimensions. */
export function pageCropFractions(page: PageItem): Insets {
  const crop = page.overrides?.cropBoxMm ?? ZERO_INSETS;
  const width = Math.max(page.widthMm, 0.01), height = Math.max(page.heightMm, 0.01);
  return normalizeInsets({ top: crop.top / height, right: crop.right / width, bottom: crop.bottom / height, left: crop.left / width });
}
export function normalizeInsets(insets: Insets): Insets {
  const clamp = (v: number) => Number.isFinite(v) ? Math.max(0, Math.min(0.98, v)) : 0;
  let { top, right, bottom, left } = { top: clamp(insets.top), right: clamp(insets.right), bottom: clamp(insets.bottom), left: clamp(insets.left) };
  if (left + right > 0.98) { const scale = 0.98 / (left + right); left *= scale; right *= scale; }
  if (top + bottom > 0.98) { const scale = 0.98 / (top + bottom); top *= scale; bottom *= scale; }
  return { top, right, bottom, left };
}
export function rotateInsets(value: Insets, angle: PageRotation): Insets {
  switch (angle) {
    case 90: return { top: value.left, right: value.top, bottom: value.right, left: value.bottom };
    case 180: return { top: value.bottom, right: value.left, bottom: value.top, left: value.right };
    case 270: return { top: value.right, right: value.bottom, bottom: value.left, left: value.top };
    default: return { ...value };
  }
}
export function cropToMm(page: PageItem, crop: Insets): NonNullable<PagePerPageOverrides['cropBoxMm']> {
  const v = normalizeInsets(crop);
  return { top: v.top * page.heightMm, right: v.right * page.widthMm, bottom: v.bottom * page.heightMm, left: v.left * page.widthMm };
}
/** Resize a rectangle, keeping the opposite edge fixed. */
export function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number, minimum = 8): Rect {
  let { x, y, width, height } = rect;
  if (handle.includes('e')) width = Math.max(minimum, rect.width + dx);
  if (handle.includes('s')) height = Math.max(minimum, rect.height + dy);
  if (handle.includes('w')) { width = Math.max(minimum, rect.width - dx); x = rect.x + rect.width - width; }
  if (handle.includes('n')) { height = Math.max(minimum, rect.height - dy); y = rect.y + rect.height - height; }
  return { x, y, width, height };
}
/** Corner handles scale proportionally around the opposite corner; edge handles remain one-dimensional. */
export function resizeProportionally(rect: Rect, handle: Handle, dx: number, dy: number, minimum = 8): Rect {
  if (handle.length === 1) return resizeRect(rect, handle, dx, dy, minimum);
  const sx = handle.includes('e') ? 1 : -1;
  const sy = handle.includes('s') ? 1 : -1;
  const denominator = rect.width * rect.width + rect.height * rect.height;
  const factor = Math.max(minimum / rect.width, minimum / rect.height,
    1 + (sx * dx * rect.width + sy * dy * rect.height) / Math.max(1, denominator));
  const width = rect.width * factor, height = rect.height * factor;
  return { x: sx < 0 ? rect.x + rect.width - width : rect.x,
    y: sy < 0 ? rect.y + rect.height - height : rect.y, width, height };
}
/** Adjust crop by dragging the visible boundary; outward movement reveals previously cropped pixels. */
export function dragCrop(crop: Insets, rotation: PageRotation, handle: Handle, dx: number, dy: number, displayWidth: number, displayHeight: number): Insets {
  const c = rotateInsets(crop, rotation);
  const visibleW = 1 - c.left - c.right, visibleH = 1 - c.top - c.bottom;
  const fx = dx / Math.max(1, displayWidth) * visibleW, fy = dy / Math.max(1, displayHeight) * visibleH;
  if (handle.includes('w')) c.left = Math.max(0, Math.min(0.98 - c.right, c.left + fx));
  if (handle.includes('e')) c.right = Math.max(0, Math.min(0.98 - c.left, c.right - fx));
  if (handle.includes('n')) c.top = Math.max(0, Math.min(0.98 - c.bottom, c.top + fy));
  if (handle.includes('s')) c.bottom = Math.max(0, Math.min(0.98 - c.top, c.bottom - fy));
  return normalizeInsets(rotateInsets(c, ((360 - rotation) % 360) as PageRotation));
}

/** Largest centered rectangle of the requested source-width/source-height ratio inside the existing crop.
 * Returns null when it cannot be represented with the engine's 2% minimum remaining size. */
export function centeredAspectCrop(page: PageItem, ratio: number): Insets | null {
  if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(page.widthMm) || !Number.isFinite(page.heightMm) || page.widthMm <= 0 || page.heightMm <= 0) return null;
  const crop = pageCropFractions(page);
  const width = page.widthMm * (1 - crop.left - crop.right);
  const height = page.heightMm * (1 - crop.top - crop.bottom);
  const newWidth = Math.min(width, height * ratio);
  const newHeight = Math.min(height, width / ratio);
  if (newWidth < page.widthMm * 0.02 - 1e-8 || newHeight < page.heightMm * 0.02 - 1e-8) return null;
  const horizontalInset = (width - newWidth) / (2 * page.widthMm);
  const verticalInset = (height - newHeight) / (2 * page.heightMm);
  return normalizeInsets({left:crop.left + horizontalInset, right:crop.right + horizontalInset,
    top:crop.top + verticalInset, bottom:crop.bottom + verticalInset});
}

/** Clockwise angle used by CSS/screen coordinates, normalized for persistence. */
export function normalizeAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}
export function rotateVector(x: number, y: number, degrees: number) {
  const radians = degrees * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  return { x: cos * x - sin * y, y: sin * x + cos * y };
}
export function rotationFromPointer(initial: number, centerX: number, centerY: number,
  startX: number, startY: number, x: number, y: number, snap: boolean): number {
  if (Math.hypot(startX-centerX,startY-centerY) < 0.001 || Math.hypot(x-centerX,y-centerY) < 0.001) return normalizeAngle(initial);
  const start = Math.atan2(startY-centerY,startX-centerX), end = Math.atan2(y-centerY,x-centerX);
  const angle = initial + (end-start)*180/Math.PI;
  return normalizeAngle(snap ? Math.round(angle / 45) * 45 : angle);
}
/** Axis-aligned bounds of the rotated content, for preflight clipping warnings. */
export function rotatedBounds(rect: Rect, angle: number): Rect {
  const r=normalizeAngle(angle)*Math.PI/180, c=Math.abs(Math.cos(r)), s=Math.abs(Math.sin(r));
  const width=rect.width*c+rect.height*s, height=rect.width*s+rect.height*c;
  return {x:rect.x+(rect.width-width)/2,y:rect.y+(rect.height-height)/2,width,height};
}
