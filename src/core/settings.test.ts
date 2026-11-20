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
