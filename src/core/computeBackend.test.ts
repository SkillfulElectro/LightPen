import { describe, expect, it } from 'vitest';
import { addPoint, createStroke, MAX_STROKE_POINTS } from './annotations';
import {
  InferenceLoadBalancer,
  resolveExecutionPlan,
  type ComputeCapabilities,
} from './computeBackend';
import { clamp, computeSafeCanvasSize } from './coords';
import { OneEuroFilter } from './oneEuro';
import { strokeToSvgPath } from './pdfExport';
import { sanitizeSettings } from './settings';

const FULL_CAPS: ComputeCapabilities = {
  cpuCores: 8,
  hasWebGL2: true,
  hasWebGL: true,
  hasWebGPU: true,
  hasOffscreenCanvas: true,
  gpuRenderer: 'Test GPU',
};

const CPU_ONLY_CAPS: ComputeCapabilities = {
  cpuCores: 4,
  hasWebGL2: false,
  hasWebGL: false,
  hasWebGPU: false,
  hasOffscreenCanvas: false,
  gpuRenderer: null,
};

describe('resolveExecutionPlan', () => {
  it('selects CPU+GPU hybrid plan when GPU and multi-core CPU are present', () => {
    const plan = resolveExecutionPlan('hybrid', FULL_CAPS, false);
    expect(plan.delegate).toBe('GPU');
    expect(plan.label).toBe('CPU+GPU');
    expect(plan.hybrid).toBe(true);
    expect(plan.preferVideoSource).toBe(true);
  });

  it('uses GPU + 2D canvas readback on Linux WebKitGTK when WebGL2 is available', () => {
    const plan = resolveExecutionPlan('hybrid', FULL_CAPS, true);
    expect(plan.delegate).toBe('GPU');
    expect(plan.label).toBe('CPU+GPU');
    expect(plan.preferVideoSource).toBe(false);
  });

  it('falls back cleanly to CPU when no WebGL GPU is available', () => {
    const plan = resolveExecutionPlan('hybrid', CPU_ONLY_CAPS, false);
    expect(plan.delegate).toBe('CPU');
    expect(plan.label).toBe('CPU');
  });

  it('honors explicit cpu and gpu preferences', () => {
    expect(resolveExecutionPlan('cpu', FULL_CAPS, false).delegate).toBe('CPU');
    expect(resolveExecutionPlan('gpu', FULL_CAPS, false).label).toBe('GPU');
  });
});

describe('InferenceLoadBalancer', () => {
  it('scales down input width when inference exceeds frame budget and recovers when fast', () => {
    const lb = new InferenceLoadBalancer(512);
    for (let i = 0; i < 15; i++) {
      lb.record(40, 'GPU', true);
    }
    expect(lb.inputWidth).toBeLessThan(512);
    const reduced = lb.inputWidth;
    for (let i = 0; i < 20; i++) {
      lb.record(6, 'GPU', true);
    }
    expect(lb.inputWidth).toBeGreaterThan(reduced);
  });

  it('triggers GPU -> CPU failover only after sustained GPU stalls in hybrid mode', () => {
    const lb = new InferenceLoadBalancer(512);
    let triggered = false;
    for (let i = 0; i < 35; i++) {
      const action = lb.record(110, 'GPU', true);
      if (action.shouldFallbackToCpu) {
        triggered = true;
        break;
      }
    }
    expect(triggered).toBe(true);
  });
});

describe('PDF writing crash prevention', () => {
  it('caps high-zoom HiDPI canvas dimensions within safe pixel and edge budgets', () => {
    const safe = computeSafeCanvasSize(2448, 3168, 2);
    expect(safe.width).toBeLessThanOrEqual(4096);
    expect(safe.height).toBeLessThanOrEqual(4096);
    expect(safe.width * safe.height).toBeLessThanOrEqual(12_000_000);
    expect(safe.scaleX).toBeGreaterThan(0);
    expect(safe.scaleY).toBeGreaterThan(0);
  });

  it('prevents NaN from poisoning clamp, OneEuroFilter, strokes, and SVG export', () => {
    expect(clamp(Number.NaN, 0, 1)).toBe(0);

    const filter = new OneEuroFilter();
    expect(filter.filter(0.5, 100)).toBe(0.5);
    expect(filter.filter(Number.NaN, 116)).toBe(0.5);
    expect(Number.isFinite(filter.filter(0.6, 132))).toBe(true);

    const stroke = createStroke(0, '#e11d48', 2.5, { x: 10, y: 20 });
    expect(addPoint(stroke, { x: Number.NaN, y: 30 })).toBe(false);
    expect(stroke.points).toHaveLength(1);
    expect(strokeToSvgPath(stroke, 792)).not.toContain('NaN');
  });

  it('enforces MAX_STROKE_POINTS cap to avoid unbounded memory growth', () => {
    const stroke = createStroke(0, '#e11d48', 2.5, { x: 0, y: 0 });
    for (let i = 1; i <= MAX_STROKE_POINTS + 50; i++) {
      addPoint(stroke, { x: i * 2, y: i * 2 });
    }
    expect(stroke.points.length).toBe(MAX_STROKE_POINTS);
  });

  it('sanitizes computeBackend setting safely', () => {
    expect(sanitizeSettings(null).computeBackend).toBe('hybrid');
    expect(sanitizeSettings({ computeBackend: 'gpu' }).computeBackend).toBe('gpu');
    expect(sanitizeSettings({ computeBackend: 'cpu' }).computeBackend).toBe('cpu');
    expect(sanitizeSettings({ computeBackend: 'invalid' as never }).computeBackend).toBe('hybrid');
  });
});
