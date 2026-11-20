import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from './settings';
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
