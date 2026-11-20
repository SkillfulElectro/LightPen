import { describe, expect, it } from 'vitest';
import {
  cameraToPage,
  canvasToPage,
  clampToPage,
  frameBrightness,
  isLowLight,
  pageToCanvas,
  trackingHint,
} from './coords';

const PAGE = { width: 612, height: 792 }; // US Letter in points

describe('cameraToPage', () => {
  it('maps full-frame center to page center', () => {
    const p = cameraToPage({ x: 0.5, y: 0.5 }, null, PAGE, false);
    expect(p.x).toBeCloseTo(306);
    expect(p.y).toBeCloseTo(396);
  });

  it('flips Y (camera top → PDF top)', () => {
    const top = cameraToPage({ x: 0.5, y: 0 }, null, PAGE, false);
    const bottom = cameraToPage({ x: 0.5, y: 1 }, null, PAGE, false);
    expect(top.y).toBeCloseTo(792);
    expect(bottom.y).toBeCloseTo(0);
  });

  it('mirrors X when mirrored', () => {
    const left = cameraToPage({ x: 0.25, y: 0.5 }, null, PAGE, true);
    const right = cameraToPage({ x: 0.75, y: 0.5 }, null, PAGE, true);
    expect(left.x).toBeGreaterThan(right.x);
  });

  it('respects calibration rect and clamps outside points', () => {
    const cal = { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 };
    const center = cameraToPage({ x: 0.5, y: 0.5 }, cal, PAGE, false);
    expect(center.x).toBeCloseTo(306);
    const outside = cameraToPage({ x: 0, y: 0 }, cal, PAGE, false);
    expect(outside.x).toBe(0);
    expect(outside.y).toBe(792);
  });
});

describe('canvas round-trip', () => {
  it('pageToCanvas and canvasToPage are inverses', () => {
    const p = { x: 100, y: 200 };
    const c = pageToCanvas(p, PAGE, 306, 396);
    const back = canvasToPage(c.x, c.y, PAGE, 306, 396);
    expect(back.x).toBeCloseTo(100);
    expect(back.y).toBeCloseTo(200);
  });
});

describe('helpers', () => {
  it('clampToPage clamps with margin', () => {
    expect(clampToPage({ x: -10, y: 9999 }, PAGE, 5)).toEqual({ x: 5, y: 787 });
  });

  it('trackingHint flags far/close hands', () => {
    expect(trackingHint(0.03)).toBe('too-far');
    expect(trackingHint(0.5)).toBe('too-close');
    expect(trackingHint(0.15)).toBeNull();
  });
});

describe('edge cases', () => {
  it('falls back gracefully for a zero-sized page or canvas', () => {
    // Degenerate sizes fall back to a 1:1 scale instead of dividing by zero.
    expect(pageToCanvas({ x: 10, y: 10 }, { width: 0, height: 0 }, 100, 100)).toEqual({
      x: 10,
      y: 90,
    });
    const back = canvasToPage(50, 50, { width: 0, height: 0 }, 100, 100);
    expect(Number.isFinite(back.x) && Number.isFinite(back.y)).toBe(true);
    expect(Number.isFinite(canvasToPage(50, 50, { width: 100, height: 100 }, 0, 0).x)).toBe(true);
  });

  it('clamps camera points outside the calibration rectangle to the page', () => {
    const page = { width: 100, height: 200 };
    const cal = { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 };
    expect(cameraToPage({ x: 0, y: 0 }, cal, page, false)).toEqual({ x: 0, y: 200 });
    expect(cameraToPage({ x: 1, y: 1 }, cal, page, false)).toEqual({ x: 100, y: 0 });
  });

  it('clampToPage keeps points inside the page', () => {
    const page = { width: 100, height: 100 };
    expect(clampToPage({ x: -5, y: 150 }, page)).toEqual({ x: 0, y: 100 });
  });
});

describe('lighting heuristics', () => {
  it('averages pixel luminance and flags dark frames', () => {
    const dark = frameBrightness(() => [0, 0, 0], 64, 48);
    expect(dark).toBe(0);
    expect(isLowLight(dark)).toBe(true);

    const bright = frameBrightness(() => [255, 255, 255], 64, 48);
    expect(bright).toBeCloseTo(1);
    expect(isLowLight(bright)).toBe(false);

    expect(isLowLight(frameBrightness(() => [128, 128, 128], 64, 48))).toBe(false);
  });

  it('returns 1 (not dark) for a degenerate frame', () => {
    expect(frameBrightness(() => [0, 0, 0], 0, 0)).toBe(1);
  });
});
