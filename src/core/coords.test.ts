import { describe, expect, it } from 'vitest';
import { cameraToPage, canvasToPage, clampToPage, pageToCanvas, trackingHint } from './coords';

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
