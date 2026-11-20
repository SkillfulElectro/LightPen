/**
 * One Euro filter (Casiez, Roussel &amp;amp; Vogel, 2012) — adaptive low-pass
 * smoothing that removes jitter at rest while keeping latency low in motion.
 * Pure logic, no DOM. See https://github.com/casiez/OneEuroFilter
 */

export interface OneEuroParams {
  minCutoff: number; // Hz — lower = smoother at rest
  beta: number; // higher = less lag in fast motion
  dCutoff: number; // Hz — derivative low-pass cutoff
}

const DEFAULT_PARAMS: OneEuroParams = { minCutoff: 1.2, beta: 0.02, dCutoff: 1.0 };

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function clampDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 1 / 60;
  return Math.min(dt, 0.25);
}

/** 1-D One Euro filter. */
export class OneEuroFilter {
  private readonly params: OneEuroParams;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(params: Partial<OneEuroParams> = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  filter(x: number, timestampMs: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = x;
      this.tPrev = timestampMs;
      return x;
    }
    const dt = clampDt((timestampMs - this.tPrev) / 1000);
    const dx = (x - this.xPrev) / dt;
    const aD = alpha(this.params.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(dxHat);
    const a = alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = timestampMs;
    return xHat;
  }
}

/** 2-D One Euro filter (one instance per axis). */
export class OneEuroPoint {
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;

  constructor(params: Partial<OneEuroParams> = {}) {
    this.fx = new OneEuroFilter(params);
    this.fy = new OneEuroFilter(params);
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }

  filter(x: number, y: number, timestampMs: number): { x: number; y: number } {
    return {
      x: this.fx.filter(x, timestampMs),
      y: this.fy.filter(y, timestampMs),
    };
  }
}
