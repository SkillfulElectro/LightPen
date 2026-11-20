/**
 * Coordinate mapping between camera space, PDF space and canvas space.
 * Pure logic, no DOM.
 *
 * Camera space: normalized 0..1, top-left origin (MediaPipe convention).
 * PDF space: points, bottom-left origin.
 * Canvas space: CSS pixels, top-left origin.
 */

import type { CalibrationRect, CameraPoint, PageSize, PdfPoint } from './types';

/** Default calibration: full camera frame. */
export const FULL_FRAME_CALIBRATION: CalibrationRect = { x0: 0, y0: 0, x1: 1, y1: 1 };

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Map a normalized camera point into PDF points.
 * - `mirrored`: when the preview is mirrored (selfie view), flip x so the
 *   hand appears where the user expects it.
 * - `calibration`: the user-defined "writing area" in the camera frame;
 *   points outside are clamped to the page edge.
 */
export function cameraToPage(
  point: CameraPoint,
  calibration: CalibrationRect | null,
  page: PageSize,
  mirrored: boolean,
): PdfPoint {
  const cal = calibration ?? FULL_FRAME_CALIBRATION;
  const w = Math.max(cal.x1 - cal.x0, 1e-6);
  const h = Math.max(cal.y1 - cal.y0, 1e-6);
  let nx = (point.x - cal.x0) / w;
  let ny = (point.y - cal.y0) / h;
  if (mirrored) nx = 1 - nx;
  nx = clamp(nx, 0, 1);
  ny = clamp(ny, 0, 1);
  return { x: nx * page.width, y: (1 - ny) * page.height };
}

/** Map PDF points to canvas CSS pixels (top-left origin). */
export function pageToCanvas(
  point: PdfPoint,
  page: PageSize,
  canvasW: number,
  canvasH: number,
): { x: number; y: number } {
  const sx = page.width > 0 ? canvasW / page.width : 1;
  const sy = page.height > 0 ? canvasH / page.height : 1;
  return { x: point.x * sx, y: canvasH - point.y * sy };
}

/** Map canvas CSS pixels back to PDF points. */
export function canvasToPage(
  x: number,
  y: number,
  page: PageSize,
  canvasW: number,
  canvasH: number,
): PdfPoint {
  const sx = page.width > 0 ? canvasW / page.width : 1;
  const sy = page.height > 0 ? canvasH / page.height : 1;
  return { x: x / sx, y: (canvasH - y) / sy };
}

/** Clamp a PDF point inside the page with a small margin. */
export function clampToPage(point: PdfPoint, page: PageSize, margin = 0): PdfPoint {
  return {
    x: clamp(point.x, margin, Math.max(page.width - margin, margin)),
    y: clamp(point.y, margin, Math.max(page.height - margin, margin)),
  };
}

/** Distance between two PDF points. */
export function pdfDistance(a: PdfPoint, b: PdfPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Tracking-quality heuristics from hand size: too small = too far away,
 * too large = too close. Returns a hint key or null when fine.
 */
export function trackingHint(handSize: number): 'too-far' | 'too-close' | null {
  if (handSize < 0.06) return 'too-far';
  if (handSize > 0.45) return 'too-close';
  return null;
}
