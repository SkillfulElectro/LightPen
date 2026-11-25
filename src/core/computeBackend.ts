/**
 * Hybrid CPU + GPU compute capability detection and adaptive load balancing.
 * Pure logic with defensive DOM/WebGL probes so it works identically in browsers,
 * Tauri WebViews, and headless unit tests.
 */
import type { ActiveComputeBackend, ComputeBackend } from './types';

export interface ComputeCapabilities {
  cpuCores: number;
  hasWebGL2: boolean;
  hasWebGL: boolean;
  hasWebGPU: boolean;
  hasOffscreenCanvas: boolean;
  gpuRenderer: string | null;
}

export interface ExecutionPlan {
  /** Requested MediaPipe delegate. */
  delegate: 'GPU' | 'CPU';
  /** User-facing active backend label (e.g. "CPU+GPU", "GPU", "CPU"). */
  label: ActiveComputeBackend;
  /** Whether CPU preprocessing / dynamic load-balancing is paired with GPU inference. */
  hybrid: boolean;
  /** Target capture / snapshot width for optimal inference throughput. */
  inputWidth: number;
  /** Whether to try direct `<video>` textures before 2D canvas readback. */
  preferVideoSource: boolean;
}

/** Probe available CPU and GPU compute capabilities in the current environment. */
export function probeComputeCapabilities(): ComputeCapabilities {
  const cpuCores =
    typeof navigator !== 'undefined' &&
    typeof navigator.hardwareConcurrency === 'number' &&
    Number.isFinite(navigator.hardwareConcurrency) &&
    navigator.hardwareConcurrency > 0
      ? Math.floor(navigator.hardwareConcurrency)
      : 4;

  const hasWebGPU =
    typeof navigator !== 'undefined' &&
    'gpu' in navigator &&
    Boolean((navigator as unknown as { gpu?: unknown }).gpu);

  const hasOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';

  let hasWebGL2 = false;
  let hasWebGL = false;
  let gpuRenderer: string | null = null;

  if (typeof document !== 'undefined') {
    try {
      const probe = document.createElement('canvas');
      const attrs: WebGLContextAttributes = {
        powerPreference: 'high-performance',
        antialias: false,
        alpha: false,
        desynchronized: true,
      };
      const gl2 = probe.getContext('webgl2', attrs) as WebGL2RenderingContext | null;
      const gl = gl2 ?? (probe.getContext('webgl', attrs) as WebGLRenderingContext | null);
      if (gl2) {
        hasWebGL2 = true;
        hasWebGL = true;
      } else if (gl) {
        hasWebGL = true;
      }
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
          if (typeof renderer === 'string' && renderer.trim().length > 0) {
            gpuRenderer = renderer.trim();
          }
        }
        const loseCtx = gl.getExtension('WEBGL_lose_context');
        loseCtx?.loseContext();
      }
    } catch {
      // Headless / jsdom or restricted WebGL environment.
    }
  }

  return {
    cpuCores,
    hasWebGL2,
    hasWebGL,
    hasWebGPU,
    hasOffscreenCanvas,
    gpuRenderer,
  };
}

/**
 * Resolve the optimal CPU/GPU execution plan from user preference and hardware capabilities.
 *
 * In `hybrid` mode (default), GPU accelerates MediaPipe neural hand inference via a
 * high-performance WebGL2 context while multi-core CPU handles camera preprocessing,
 * brightness estimation, One-Euro kinematic smoothing, gesture state machines, and
 * hardware-composited 2D ink rendering.
 */
export function resolveExecutionPlan(
  preferred: ComputeBackend,
  caps: ComputeCapabilities,
  linuxWebKit = false,
): ExecutionPlan {
  const gpuUsable = caps.hasWebGL2 || caps.hasWebGL;
  const multiCore = caps.cpuCores >= 2;

  if (preferred === 'cpu') {
    return {
      delegate: 'CPU',
      label: 'CPU',
      hybrid: false,
      inputWidth: caps.cpuCores >= 6 ? 480 : 384,
      preferVideoSource: false,
    };
  }

  if (preferred === 'gpu') {
    if (gpuUsable) {
      return {
        delegate: 'GPU',
        label: 'GPU',
        hybrid: false,
        inputWidth: 512,
        preferVideoSource: !linuxWebKit,
      };
    }
    return {
      delegate: 'CPU',
      label: 'CPU',
      hybrid: false,
      inputWidth: 384,
      preferVideoSource: false,
    };
  }

  // Hybrid CPU + GPU mode (default):
  // Pair GPU neural inference with multi-core CPU preprocessing & kinematic pipeline.
  // On Linux WebKitGTK, allow GPU only when WebGL2 is genuinely available, and still use
  // 2D canvas readback to avoid silent texImage2D(video) black textures (ADR-025).
  const canUseGpu = linuxWebKit ? caps.hasWebGL2 : gpuUsable;
  if (canUseGpu) {
    return {
      delegate: 'GPU',
      label: multiCore ? 'CPU+GPU' : 'GPU',
      hybrid: true,
      inputWidth: multiCore ? 512 : 448,
      preferVideoSource: !linuxWebKit,
    };
  }

  return {
    delegate: 'CPU',
    label: 'CPU',
    hybrid: true,
    inputWidth: caps.cpuCores >= 6 ? 480 : 384,
    preferVideoSource: false,
  };
}

export interface LoadBalanceAction {
  /** Recommended input canvas width (pixels) for next frame. */
  inputWidth: number;
  /** True when GPU inference is persistently too slow and should fail over to CPU. */
  shouldFallbackToCpu: boolean;
  /** Skip the next frame only under severe overload to protect UI responsiveness. */
  skipNextFrame: boolean;
}

/**
 * Smooth EMA latency tracker that dynamically tunes resolution and triggers
 * GPU -> CPU failover in hybrid mode without halving FPS at arbitrary thresholds.
 */
export class InferenceLoadBalancer {
  private emaMs = 12;
  private slowStreak = 0;
  private currentWidth: number;
  private readonly minWidth = 288;
  private readonly maxWidth: number;

  constructor(initialWidth = 512) {
    this.currentWidth = Math.max(this.minWidth, initialWidth);
    this.maxWidth = this.currentWidth;
  }

  get averageInferenceMs(): number {
    return this.emaMs;
  }

  get inputWidth(): number {
    return this.currentWidth;
  }

  reset(width?: number): void {
    this.emaMs = 12;
    this.slowStreak = 0;
    if (width !== undefined) {
      this.currentWidth = Math.max(this.minWidth, width);
    }
  }

  /** Record one inference duration (ms) and return tuning recommendations. */
  record(durationMs: number, activeDelegate: 'GPU' | 'CPU', hybrid: boolean): LoadBalanceAction {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return {
        inputWidth: this.currentWidth,
        shouldFallbackToCpu: false,
        skipNextFrame: false,
      };
    }

    this.emaMs = this.emaMs * 0.8 + durationMs * 0.2;

    // Step down input width gracefully if inference approaches 30 FPS budget (> 26ms)
    if (this.emaMs > 28 && this.currentWidth > this.minWidth) {
      this.currentWidth = Math.max(this.minWidth, this.currentWidth - 32);
    } else if (this.emaMs < 14 && this.currentWidth < this.maxWidth) {
      this.currentWidth = Math.min(this.maxWidth, this.currentWidth + 16);
    }

    // Track sustained GPU stalls (> 85ms per frame) in hybrid mode for automatic CPU failover
    if (hybrid && activeDelegate === 'GPU' && this.emaMs > 85) {
      this.slowStreak += 1;
    } else {
      this.slowStreak = Math.max(0, this.slowStreak - 1);
    }

    return {
      inputWidth: this.currentWidth,
      shouldFallbackToCpu: this.slowStreak >= 20,
      skipNextFrame: durationMs > 60,
    };
  }
}
