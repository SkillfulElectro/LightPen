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

/**
 * Average luminance of a video frame (0 = black, 1 = white).
 * Samples a coarse grid so it costs well under a millisecond.
 * Used for the "low light" hint; the frame never leaves memory.
 */
export function frameBrightness(
  readPixel: (x: number, y: number) => [number, number, number],
  width: number,
  height: number,
  grid = 8,
): number {
  if (width <= 0 || height <= 0) return 1;
  let total = 0;
  let count = 0;
  for (let gx = 0; gx < grid; gx++) {
    for (let gy = 0; gy < grid; gy++) {
      const x = Math.floor(((gx + 0.5) / grid) * width);
      const y = Math.floor(((gy + 0.5) / grid) * height);
      const [r, g, b] = readPixel(x, y);
      total += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      count += 1;
    }
  }
  return count > 0 ? total / count : 1;
}

/** True when the frame is too dark for reliable hand tracking. */
export function isLowLight(brightness: number): boolean {
  return brightness < 0.12;
}

/**
 * pdf.js viewport transform: `[a, b, c, d, e, f]` mapping PDF user space
 * (bottom-left origin) to canvas CSS pixels (top-left origin). It already
 * accounts for page rotation, so every conversion goes through this matrix
 * instead of ad-hoc arithmetic.
 */
export type ViewportMatrix = readonly [number, number, number, number, number, number];

/** PDF point → canvas CSS pixel. */
export function pdfToViewport(point: PdfPoint, m: ViewportMatrix): { x: number; y: number } {
  const [a, b, c, d, e, f] = m;
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

/** Canvas CSS pixel → PDF point (inverse of `pdfToViewport`). */
export function viewportToPdf(x: number, y: number, m: ViewportMatrix): PdfPoint {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0) return { x: 0, y: 0 };
  const dx = x - e;
  const dy = y - f;
  return { x: (d * dx - c * dy) / det, y: (-b * dx + a * dy) / det };
}

/** Page rotation in degrees, as reported by pdf.js (`page.rotate`). */
export type PageRotation = 0 | 90 | 180 | 270;

/** Displayed page size in CSS pixels for a rotation and zoom scale. */
export function pageDisplaySize(
  page: PageSize,
  rotation: PageRotation,
  scale: number,
): { width: number; height: number } {
  const w = page.width * scale;
  const h = page.height * scale;
  return rotation === 90 || rotation === 270 ? { width: h, height: w } : { width: w, height: h };
}

/**
 * Viewport transform for a page at a zoom scale, equivalent to pdf.js's
 * `page.getViewport({ scale }).transform` but computed without a page proxy.
 * Values verified against pdf.js for rotations 0/90/180/270.
 */
export function pageViewportMatrix(
  page: PageSize,
  rotation: PageRotation,
  scale: number,
): ViewportMatrix {
  const s = scale;
  const w = page.width * s;
  const h = page.height * s;
  switch (rotation) {
    case 90:
      return [0, s, s, 0, 0, 0];
    case 180:
      return [-s, 0, 0, s, w, 0];
    case 270:
      return [0, -s, -s, 0, h, w];
    default:
      return [s, 0, 0, -s, 0, h];
  }
}
