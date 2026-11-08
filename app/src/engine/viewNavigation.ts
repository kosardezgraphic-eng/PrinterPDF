/** Navigation helpers shared by the preview and its tests. */
export const WHEEL_THROTTLE_MS = 180;
export const PREVIEW_PX_PER_MM = 1.95;

export function wheelSheetStep(deltaY: number, now: number, lastStep: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0 || now - lastStep < WHEEL_THROTTLE_MS) return 0;
  return deltaY > 0 ? 1 : -1;
}

export function fitPageZoom(viewWidth: number, viewHeight: number, paperWidthMm: number, paperHeightMm: number, rulers: boolean): number {
  if (paperWidthMm <= 0 || paperHeightMm <= 0) return 100;
  // Workspace padding on both sides, the sheet badge, ruler and the gap.
  const width = Math.max(1, viewWidth - 48 - (rulers ? 28 : 0));
  const height = Math.max(1, viewHeight - 48 - 32 - (rulers ? 24 : 0));
  return Math.max(5, Math.min(400, Math.floor(Math.min(width / paperWidthMm, height / paperHeightMm) / PREVIEW_PX_PER_MM * 100)));
}
