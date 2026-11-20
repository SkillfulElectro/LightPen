import { describe, expect, it } from 'vitest';
import { OneEuroFilter, OneEuroPoint } from './oneEuro';

describe('OneEuroFilter', () => {
  it('passes through the first sample unchanged', () => {
    const f = new OneEuroFilter();
    expect(f.filter(0.5, 0)).toBe(0.5);
  });

  it('smooths jitter around a constant value', () => {
    const f = new OneEuroFilter({ minCutoff: 1.0, beta: 0.0, dCutoff: 1.0 });
    let out = 0.5;
    for (let i = 0; i < 120; i++) {
      const jitter = i % 2 === 0 ? 0.02 : -0.02;
      out = f.filter(0.5 + jitter, i * 16.7);
    }
    // After settling, output should be closer to the true value than raw jitter.
    expect(Math.abs(out - 0.5)).toBeLessThan(0.02);
  });

  it('follows a step quickly (low latency in motion)', () => {
    const f = new OneEuroFilter({ minCutoff: 1.2, beta: 0.05, dCutoff: 1.0 });
    f.filter(0, 0);
    let out = 0;
    for (let i = 1; i <= 10; i++) out = f.filter(1, i * 16.7);
    expect(out).toBeGreaterThan(0.5);
  });

  it('reset restores pass-through behaviour', () => {
    const f = new OneEuroFilter();
    f.filter(0.1, 0);
    f.filter(0.9, 16);
    f.reset();
    expect(f.filter(0.3, 1000)).toBe(0.3);
  });

  it('tolerates non-monotonic timestamps', () => {
    const f = new OneEuroFilter();
    f.filter(0.5, 100);
    expect(() => f.filter(0.6, 50)).not.toThrow();
  });
});

describe('OneEuroPoint', () => {
  it('filters x and y independently', () => {
    const p = new OneEuroPoint();
    expect(p.filter(0.2, 0.8, 0)).toEqual({ x: 0.2, y: 0.8 });
    const out = p.filter(0.3, 0.7, 16.7);
    expect(out.x).toBeGreaterThan(0.2);
    expect(out.y).toBeLessThan(0.8);
  });
});
