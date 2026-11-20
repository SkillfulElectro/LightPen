import { describe, expect, it } from 'vitest';
import {
  cameraToPage,
  canvasToPage,
  clampToPage,
  frameBrightness,
  isLowLight,
  pageToCanvas,
  pdfToViewport,
  pageDisplaySize,
  pageViewportMatrix,
  viewportToPdf,
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

describe('viewport matrix helpers', () => {
  // pdf.js matrix for an unrotated A4 page at scale 1: y is flipped, origin top-left.
  const PORTRAIT = [1, 0, 0, -1, 0, 842] as const;
  // Rotated 90°: pdf.js swaps the axes.
  const LANDSCAPE_90 = [0, 1, 1, 0, 0, 0] as const;

  it('maps PDF corners to canvas corners', () => {
    expect(pdfToViewport({ x: 0, y: 842 }, PORTRAIT)).toEqual({ x: 0, y: 0 });
    expect(pdfToViewport({ x: 595, y: 0 }, PORTRAIT)).toEqual({ x: 595, y: 842 });
  });

  it('round-trips through the inverse transform', () => {
    for (const m of [PORTRAIT, LANDSCAPE_90]) {
      const start = { x: 123.5, y: 456.25 };
      const back = viewportToPdf(pdfToViewport(start, m).x, pdfToViewport(start, m).y, m);
      expect(back.x).toBeCloseTo(start.x);
      expect(back.y).toBeCloseTo(start.y);
    }
  });

  it('respects page rotation', () => {
    const p = pdfToViewport({ x: 100, y: 200 }, LANDSCAPE_90);
    expect(p).toEqual({ x: 200, y: 100 });
  });

  it('returns the origin for a degenerate matrix instead of NaN', () => {
    expect(viewportToPdf(5, 5, [0, 0, 0, 0, 0, 0])).toEqual({ x: 0, y: 0 });
  });

  it('computes displayed size for each rotation', () => {
    const letter = { width: 612, height: 792 };
    expect(pageDisplaySize(letter, 0, 1)).toEqual({ width: 612, height: 792 });
    expect(pageDisplaySize(letter, 90, 1)).toEqual({ width: 792, height: 612 });
    expect(pageDisplaySize(letter, 180, 2)).toEqual({ width: 1224, height: 1584 });
    expect(pageDisplaySize(letter, 270, 1)).toEqual({ width: 792, height: 612 });
  });

  it('builds matrices that match pdf.js for every rotation', () => {
    const letter = { width: 612, height: 792 };
    // Expected matrices taken from pdf.js `page.getViewport({ scale: 1 })`.
    expect(pageViewportMatrix(letter, 0, 1)).toEqual([1, 0, 0, -1, 0, 792]);
    expect(pageViewportMatrix(letter, 90, 1)).toEqual([0, 1, 1, 0, 0, 0]);
    expect(pageViewportMatrix(letter, 180, 1)).toEqual([-1, 0, 0, 1, 612, 0]);
    expect(pageViewportMatrix(letter, 270, 1)).toEqual([0, -1, -1, 0, 792, 612]);
  });

  it('maps a display point back to the same PDF point for rotated pages', () => {
    const letter = { width: 612, height: 792 };
    for (const rotation of [0, 90, 180, 270] as const) {
      const m = pageViewportMatrix(letter, rotation, 1.5);
      const start = { x: 200, y: 300 };
      const disp = pdfToViewport(start, m);
      const back = viewportToPdf(disp.x, disp.y, m);
      expect(back.x).toBeCloseTo(start.x);
      expect(back.y).toBeCloseTo(start.y);
      const size = pageDisplaySize(letter, rotation, 1.5);
      expect(disp.x).toBeGreaterThanOrEqual(0);
      expect(disp.y).toBeGreaterThanOrEqual(0);
      expect(disp.x).toBeLessThanOrEqual(size.width + 1e-6);
      expect(disp.y).toBeLessThanOrEqual(size.height + 1e-6);
    }
  });
});
