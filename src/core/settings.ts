/**
 * Settings validation/merging. Pure logic, no DOM.
 */

import { DEFAULT_SETTINGS, type Settings } from './types';

function num(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/** Merge unknown persisted data over defaults, clamping every value. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Settings>;
  const pinch = num(r.pinchThreshold, d.pinchThreshold, 0.05, 0.9);
  const pinchRelease = num(r.pinchReleaseThreshold, d.pinchReleaseThreshold, 0.05, 0.95);
  const cal = r.calibration;
  const calibration =
    cal &&
    typeof cal.x0 === 'number' &&
    typeof cal.y0 === 'number' &&
    typeof cal.x1 === 'number' &&
    typeof cal.y1 === 'number' &&
    cal.x1 > cal.x0 &&
    cal.y1 > cal.y0
      ? { x0: cal.x0, y0: cal.y0, x1: cal.x1, y1: cal.y1 }
      : null;
  return {
    pinchThreshold: pinch,
    pinchReleaseThreshold: Math.max(pinchRelease, pinch + 0.02),
    smoothingMinCutoff: num(r.smoothingMinCutoff, d.smoothingMinCutoff, 0.1, 10),
    smoothingBeta: num(r.smoothingBeta, d.smoothingBeta, 0, 0.5),
    smoothingDCutoff: num(r.smoothingDCutoff, d.smoothingDCutoff, 0.1, 10),
    dominantHand: r.dominantHand === 'left' || r.dominantHand === 'right' ? r.dominantHand : 'auto',
    cameraId: typeof r.cameraId === 'string' ? r.cameraId : null,
    mirrored: bool(r.mirrored, d.mirrored),
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : 'system',
    language: str(r.language, d.language),
    penColor: str(r.penColor, d.penColor),
    penWidth: num(r.penWidth, d.penWidth, 0.5, 20),
    calibration,
    enablePageSwipe: bool(r.enablePageSwipe, d.enablePageSwipe),
    enablePauseFist: bool(r.enablePauseFist, d.enablePauseFist),
    enableErase: bool(r.enableErase, d.enableErase),
  };
}
