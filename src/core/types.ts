/**
 * Shared domain types for LightPen core.
 * All coordinates in the annotation model are in PDF points (bottom-left origin),
 * independent of zoom or screen size.
 */

/** A single 2D point in PDF points (bottom-left origin). */
export interface PdfPoint {
  x: number;
  y: number;
}

/** A single 2D point in normalized camera coordinates (top-left origin, 0..1). */
export interface CameraPoint {
  x: number;
  y: number;
}

/** One MediaPipe hand landmark, normalized 0..1 (x/y), z relative. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** A vector ink stroke stored in PDF coordinate space. */
export interface Stroke {
  id: string;
  page: number; // 0-based page index
  color: string; // CSS hex, e.g. "#e11d48"
  width: number; // in PDF points
  points: PdfPoint[];
  createdAt: number; // epoch ms
}

/** Page dimensions in PDF points. */
export interface PageSize {
  width: number;
  height: number;
}

/** Calibration rectangle in normalized camera coordinates (top-left origin). */
export interface CalibrationRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Handedness reported by the tracker. */
export type Handedness = 'Left' | 'Right';

/** Gestures the classifier can emit. */
export type GestureKind = 'pen-down' | 'hover' | 'erase' | 'fist' | 'none';

export type DominantHand = 'left' | 'right' | 'auto';
export type Theme = 'light' | 'dark' | 'system';

/** User-tunable settings (persisted). */
export interface Settings {
  pinchThreshold: number; // normalized pinch distance that starts ink (enter)
  pinchReleaseThreshold: number; // normalized pinch distance that stops ink (exit, hysteresis)
  smoothingMinCutoff: number; // One Euro min cutoff (Hz)
  smoothingBeta: number; // One Euro beta
  smoothingDCutoff: number; // One Euro derivative cutoff (Hz)
  dominantHand: DominantHand;
  cameraId: string | null;
  mirrored: boolean;
  theme: Theme;
  language: string;
  penColor: string;
  penWidth: number;
  calibration: CalibrationRect | null;
  enablePageSwipe: boolean;
  enablePauseFist: boolean;
  enableErase: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  pinchThreshold: 0.32,
  pinchReleaseThreshold: 0.45,
  smoothingMinCutoff: 1.2,
  smoothingBeta: 0.02,
  smoothingDCutoff: 1.0,
  dominantHand: 'auto',
  cameraId: null,
  mirrored: true,
  theme: 'system',
  language: 'en',
  penColor: '#e11d48',
  penWidth: 2.5,
  calibration: null,
  enablePageSwipe: true,
  enablePauseFist: true,
  enableErase: true,
};

/** Serialized sidecar format (`<name>.lightpen.json`). */
export interface SidecarData {
  version: 1;
  strokes: Stroke[];
  updatedAt: number;
}
