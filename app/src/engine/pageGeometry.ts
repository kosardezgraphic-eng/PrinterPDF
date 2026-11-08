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
