import { describe, expect, it } from 'vitest';
import {
  pinchThresholdToSensitivity,
  releaseThresholdFor,
  sanitizeSettings,
  sensitivityToPinchThreshold,
} from './settings';
import { DEFAULT_SETTINGS } from './types';

describe('sanitizeSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps out-of-range numbers', () => {
    const s = sanitizeSettings({ pinchThreshold: 99, penWidth: -5 });
    expect(s.pinchThreshold).toBeLessThanOrEqual(0.9);
    expect(s.penWidth).toBeGreaterThanOrEqual(0.5);
  });

  it('enforces pinch hysteresis gap', () => {
    const s = sanitizeSettings({ pinchThreshold: 0.5, pinchReleaseThreshold: 0.51 });
    expect(s.pinchReleaseThreshold).toBeGreaterThan(s.pinchThreshold);
  });

  it('rejects invalid calibration', () => {
    expect(
      sanitizeSettings({ calibration: { x0: 0.8, y0: 0, x1: 0.2, y1: 1 } }).calibration,
    ).toBeNull();
  });
});

describe('sanitizeSettings extra rules', () => {
  it('keeps pinch release above the enter threshold', () => {
    const s = sanitizeSettings({ pinchThreshold: 0.5, pinchReleaseThreshold: 0.4 });
    expect(s.pinchReleaseThreshold).toBeGreaterThan(s.pinchThreshold);
  });

  it('accepts a valid calibration rectangle and rejects degenerate ones', () => {
    expect(
      sanitizeSettings({ calibration: { x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.9 } }).calibration,
    ).toEqual({
      x0: 0.1,
      y0: 0.2,
      x1: 0.8,
      y1: 0.9,
    });
    expect(
      sanitizeSettings({ calibration: { x0: 0.8, y0: 0.2, x1: 0.1, y1: 0.9 } }).calibration,
    ).toBeNull();
    expect(sanitizeSettings({ calibration: { x0: 'a' } }).calibration).toBeNull();
  });

  it('validates enums, booleans and strings', () => {
    expect(sanitizeSettings({ dominantHand: 'left' }).dominantHand).toBe('left');
    expect(sanitizeSettings({ dominantHand: 'both' }).dominantHand).toBe('auto');
    expect(sanitizeSettings({ theme: 'dark' }).theme).toBe('dark');
    expect(sanitizeSettings({ theme: 'neon' }).theme).toBe('system');
    expect(sanitizeSettings({ enableErase: false }).enableErase).toBe(false);
    expect(sanitizeSettings({ enableErase: 'yes' }).enableErase).toBe(true);
    expect(sanitizeSettings({ language: '' }).language).toBe(DEFAULT_SETTINGS.language);
    expect(sanitizeSettings({ language: 'fr' }).language).toBe('fr');
    expect(sanitizeSettings({ cameraId: 'abc' }).cameraId).toBe('abc');
    expect(sanitizeSettings({ cameraId: 42 }).cameraId).toBeNull();
  });

  it('ignores non-finite numbers', () => {
    expect(sanitizeSettings({ penWidth: Number.NaN }).penWidth).toBe(DEFAULT_SETTINGS.penWidth);
    expect(sanitizeSettings({ smoothingBeta: Number.POSITIVE_INFINITY }).smoothingBeta).toBe(
      DEFAULT_SETTINGS.smoothingBeta,
    );
  });
});

describe('camera preview (self-view)', () => {
  it('is hidden by default — you do not need to watch yourself to write', () => {
    expect(DEFAULT_SETTINGS.showPreview).toBe(false);
    expect(sanitizeSettings(null).showPreview).toBe(false);
  });

  it('keeps an explicit choice across a save and reload', () => {
    expect(sanitizeSettings({ showPreview: true }).showPreview).toBe(true);
    expect(sanitizeSettings({ showPreview: false }).showPreview).toBe(false);
    expect(sanitizeSettings({ showPreview: 'yes' }).showPreview).toBe(false);
  });
});

describe('gesture mode', () => {
  it('defaults to air, so an upgrade does not change what a gesture means', () => {
    expect(sanitizeSettings(null).gestureMode).toBe('air');
    expect(DEFAULT_SETTINGS.gestureMode).toBe('air');
  });

  it('keeps touch mode across a save and reload', () => {
    expect(sanitizeSettings({ gestureMode: 'touch' }).gestureMode).toBe('touch');
  });

  it('falls back to air for an unknown mode rather than failing to load', () => {
    expect(sanitizeSettings({ gestureMode: 'kinect' } as never).gestureMode).toBe('air');
  });

  it('clamps the zoom sensitivity to a usable range', () => {
    expect(sanitizeSettings({ zoomSensitivity: 100 }).zoomSensitivity).toBeLessThanOrEqual(4);
    expect(sanitizeSettings({ zoomSensitivity: 0 }).zoomSensitivity).toBeGreaterThanOrEqual(0.25);
    expect(sanitizeSettings({ zoomSensitivity: 1.5 }).zoomSensitivity).toBe(1.5);
  });
});

describe('sensitivity helpers', () => {
  it('maps sensitivity onto a bounded pinch threshold, monotonically', () => {
    expect(sensitivityToPinchThreshold(1)).toBeCloseTo(0.15);
    expect(sensitivityToPinchThreshold(0)).toBeCloseTo(0.65);
    expect(sensitivityToPinchThreshold(0.5)).toBeCloseTo(0.4);
    for (let s = 0; s <= 1.0001; s += 0.1) {
      const t = sensitivityToPinchThreshold(s);
      expect(t).toBeGreaterThanOrEqual(0.15);
      expect(t).toBeLessThanOrEqual(0.65);
    }
    expect(sensitivityToPinchThreshold(2)).toBeLessThan(sensitivityToPinchThreshold(0.5));
    expect(sensitivityToPinchThreshold(Number.NaN)).toBeCloseTo(sensitivityToPinchThreshold(0.5));
  });

  it('round-trips between the slider and the threshold', () => {
    for (const s of [0, 0.25, 0.5, 0.75, 1]) {
      expect(pinchThresholdToSensitivity(sensitivityToPinchThreshold(s))).toBeCloseTo(s, 6);
    }
    expect(pinchThresholdToSensitivity(9)).toBe(0);
    expect(pinchThresholdToSensitivity(0)).toBe(1);
  });

  it('always keeps the release threshold above the enter threshold', () => {
    for (const enter of [0.15, 0.3, 0.5, 0.65]) {
      expect(releaseThresholdFor(enter)).toBeGreaterThan(enter);
      expect(releaseThresholdFor(enter)).toBeLessThanOrEqual(0.95);
    }
  });
});
