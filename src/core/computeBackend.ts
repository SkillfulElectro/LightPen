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
  /** True when WebGL is backed by a CPU software rasterizer (e.g. llvmpipe, SwiftShader). */
  isSoftwareGpu?: boolean;
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

const SOFTWARE_GPU_PATTERN =
  /llvmpipe|softpipe|swiftshader|lavapipe|software|subzero|basic render driver/i;

/** Detect CPU-emulated WebGL renderers where GPU delegate is much slower than WASM CPU. */
export function isSoftwareGpuRenderer(renderer: string | null | undefined): boolean {
  return typeof renderer === 'string' && SOFTWARE_GPU_PATTERN.test(renderer);
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
    isSoftwareGpu: isSoftwareGpuRenderer(gpuRenderer),
  };
}

/**
 * Resolve the optimal CPU/GPU execution plan from user preference and hardware capabilities.
 *
 * MediaPipe's palm detector operates at 192x192 and the hand landmarker at 224x224, so
 * feeding 320–384px frames matches full-frame accuracy while slashing CPU/GPU pixel
 * copy bandwidth by 2.5x–4x compared to 512px+.
 */
export function resolveExecutionPlan(
  preferred: ComputeBackend,
  caps: ComputeCapabilities,
  linuxWebKit = false,
): ExecutionPlan {
  const softwareGpu = caps.isSoftwareGpu ?? isSoftwareGpuRenderer(caps.gpuRenderer);
  const gpuUsable = (caps.hasWebGL2 || caps.hasWebGL) && !softwareGpu;
  const multiCore = caps.cpuCores >= 2;
  const cpuWidth = caps.cpuCores >= 6 ? 384 : 320;

  if (preferred === 'cpu') {
    return {
      delegate: 'CPU',
      label: 'CPU',
      hybrid: false,
      inputWidth: cpuWidth,
      preferVideoSource: false,
    };
  }

  if (preferred === 'gpu') {
    if (caps.hasWebGL2 || caps.hasWebGL) {
      return {
        delegate: 'GPU',
        label: 'GPU',
        hybrid: false,
        inputWidth: 384,
        preferVideoSource: !linuxWebKit,
      };
    }
    return {
      delegate: 'CPU',
      label: 'CPU',
      hybrid: false,
      inputWidth: cpuWidth,
      preferVideoSource: false,
    };
  }

  // Hybrid CPU + GPU mode (default):
  // Never run WebGL2 GPU delegate on a CPU software rasterizer (e.g. Mesa llvmpipe).
  // On Linux WebKitGTK with a real GPU, keep 384px CPU-backed 2D canvas readback (ADR-025)
  // so hands at desk distance stay crisp for palm detection, and rely on
  // InferenceLoadBalancer's post-warmup GPU -> CPU failover if WebKitGTK GL stalls.
  const canUseGpu = linuxWebKit ? caps.hasWebGL2 && !softwareGpu : gpuUsable;
  if (canUseGpu) {
    return {
      delegate: 'GPU',
      label: multiCore ? 'CPU+GPU' : 'GPU',
      hybrid: true,
      inputWidth: multiCore ? 384 : 320,
      preferVideoSource: !linuxWebKit,
    };
  }

  return {
    delegate: 'CPU',
    label: 'CPU',
    hybrid: true,
    inputWidth: cpuWidth,
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
 * GPU -> CPU failover in hybrid mode when GPU stalls below ~25 FPS (>40ms/frame),
 * avoiding both 16-FPS WebKitGTK GPU stalls and harmonic 30->15 FPS frame skipping.
 */
export class InferenceLoadBalancer {
  private emaMs = 12;
  private slowStreak = 0;
  private framesSeen = 0;
  private currentWidth: number;
  private readonly minWidth = 320;
  private readonly maxWidth: number;
  private readonly warmupFrames: number;

  constructor(initialWidth = 384, warmupFrames = 15) {
    this.currentWidth = Math.max(this.minWidth, initialWidth);
    this.maxWidth = this.currentWidth;
    this.warmupFrames = Math.max(0, Math.floor(warmupFrames));
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
    this.framesSeen = 0;
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

    this.framesSeen += 1;
    this.emaMs = this.emaMs * 0.78 + durationMs * 0.22;

    // Step down input width promptly if inference approaches 30 FPS budget (>24ms),
    // while never dropping below 320px so palm detection remains reliable at desk distance.
    if (this.emaMs > 24 && this.currentWidth > this.minWidth) {
      this.currentWidth = Math.max(this.minWidth, this.currentWidth - 32);
    } else if (this.emaMs < 11 && this.currentWidth < this.maxWidth) {
      this.currentWidth = Math.min(this.maxWidth, this.currentWidth + 16);
    }

    // Track sustained GPU stalls (>40ms per frame => <25 FPS) in hybrid mode after
    // initial WebGL shader warmup so transient startup spikes never kick off the GPU.
    if (
      this.framesSeen > this.warmupFrames &&
      hybrid &&
      activeDelegate === 'GPU' &&
      this.emaMs > 40
    ) {
      this.slowStreak += 1;
    } else {
      this.slowStreak = Math.max(0, this.slowStreak - 1);
    }

    return {
      inputWidth: this.currentWidth,
      shouldFallbackToCpu: this.slowStreak >= 12,
      // Only drop a frame on severe stalls (>95ms) to avoid locking 30 FPS cameras to 15 FPS.
      skipNextFrame: durationMs > 95,
    };
  }
}
