/**
 * MediaPipe Tasks Vision HandLandmarker (bundled WASM + model, no CDN).
 * All inference is on-device; frames never leave the device.
 *
 * Hybrid CPU + GPU acceleration (v0.1.10):
 * - Probes hardware CPU core count + WebGL2/WebGL GPU renderer up front and
 *   automatically rejects CPU software WebGL renderers (llvmpipe / SwiftShader).
 * - Uses 320–384px adaptive snapshots (matching MediaPipe's 192/224px input
 *   tensors) with cached 2D contexts so Linux WebKitGTK never pays 512px
 *   software readback + re-upload penalties.
 * - Guards every `HandLandmarker` against post-close Use-After-Free during
 *   GPU -> CPU failover or backend switching.
 * - Emits structured lifecycle diagnostics via `platform/logger`.
 */

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import {
  probeComputeCapabilities,
  resolveExecutionPlan,
  type ComputeCapabilities,
  type ExecutionPlan,
} from '../core/computeBackend';
import type {
  ActiveComputeBackend,
  ComputeBackend,
  DominantHand,
  Handedness,
  Landmark,
} from '../core/types';
import { logError, logInfo, logWarn } from './logger';

export interface HandResult {
  landmarks: Landmark[];
  handedness: Handedness;
}

export type FrameSourceMode = 'video' | 'canvas' | 'imagedata';

let landmarkerPromise: Promise<HandLandmarker> | null = null;
let cachedModelBuffer: Uint8Array | null = null;
let cachedCapabilities: ComputeCapabilities | null = null;
let activeDelegate: 'GPU' | 'CPU' = 'GPU';
let activeBackendLabel: ActiveComputeBackend = 'CPU+GPU';
let currentPreferredBackend: ComputeBackend = 'hybrid';
let currentNumHands = 1;
let gpuSnapCanvas: HTMLCanvasElement | null = null;
let gpuSnapCtx: CanvasRenderingContext2D | null = null;
let cpuSnapCanvas: HTMLCanvasElement | null = null;
let cpuSnapCtx: CanvasRenderingContext2D | null = null;
let targetInputWidth = 384;
let frameSourceMode: FrameSourceMode = isLinuxWebKit() ? 'canvas' : 'video';
let consecutiveEmptyFrames = 0;
let hasDetectedAnyHand = false;

/**
 * Track closed WASM instances so an in-flight frame callback can NEVER invoke
 * `detectForVideo` on a freed C++/Emscripten HandLandmarker (prevents crashes
 * while writing during automatic GPU -> CPU failover).
 */
const closedLandmarkers = new WeakSet<HandLandmarker>();

function safeCloseLandmarker(lm: HandLandmarker | null | undefined): void {
  if (!lm || closedLandmarkers.has(lm)) return;
  closedLandmarkers.add(lm);
  try {
    lm.close();
  } catch {
    // ignore close errors on already-torn-down contexts
  }
}

/**
 * WebKitGTK on Linux frequently lacks a hardware GL video sink (ADR-025), so
 * WebGL `texImage2D(HTMLVideoElement)` silently uploads black frames without
 * throwing. Using 2D canvas readback avoids dead 0-hand streams while still
 * allowing WebGL2 GPU inference when supported.
 */
export function isLinuxWebKit(
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): boolean {
  return (
    /Linux/i.test(userAgent) &&
    /AppleWebKit/i.test(userAgent) &&
    !/Chrome|Chromium|Edg|Android/i.test(userAgent)
  );
}

/** Probe and cache CPU + GPU hardware capabilities once per session. */
export function getComputeCapabilities(): ComputeCapabilities {
  if (!cachedCapabilities) {
    cachedCapabilities = probeComputeCapabilities();
    logInfo('compute', 'Probed hardware capabilities', {
      cpuCores: cachedCapabilities.cpuCores,
      hasWebGL2: cachedCapabilities.hasWebGL2,
      hasWebGL: cachedCapabilities.hasWebGL,
      hasWebGPU: cachedCapabilities.hasWebGPU,
      gpuRenderer: cachedCapabilities.gpuRenderer,
      isSoftwareGpu: cachedCapabilities.isSoftwareGpu,
      linuxWebKit: isLinuxWebKit(),
    });
  }
  return cachedCapabilities;
}

function wasmPath(): string {
  return `${import.meta.env.BASE_URL}wasm`;
}

function modelPath(): string {
  return `${import.meta.env.BASE_URL}models/hand_landmarker.task`;
}

/**
 * Fetch and sanity-check the bundled model once. In Vite dev mode a missing file
 * in `public/models/` returns HTTP 200 with `index.html`, which would otherwise
 * fail deep inside WASM with an opaque FlatBuffer error.
 */
async function loadModelBuffer(): Promise<Uint8Array | null> {
  if (cachedModelBuffer) return cachedModelBuffer;
  if (typeof fetch !== 'function') return null;

  const res = await fetch(modelPath());
  if (!res.ok) {
    throw new Error(`Hand-tracking model request failed (HTTP ${res.status}).`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  // A valid .task bundle is a ZIP archive ("PK") of several megabytes; reject HTML fallbacks.
  if (bytes.byteLength < 1024 || bytes[0] === 0x3c /* '<' */) {
    throw new Error('Hand-tracking model file is missing or invalid.');
  }
  cachedModelBuffer = bytes;
  return cachedModelBuffer;
}

/**
 * Allocate a dedicated canvas pre-warmed with a high-performance WebGL2 context.
 * Avoids `desynchronized: true` on Linux WebKitGTK where front-buffer EGL access
 * can trigger compositor stalls or WebKitWebProcess crashes on NVIDIA drivers.
 */
function createHighPerfGpuCanvas(): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined;
  try {
    const canvas = document.createElement('canvas');
    const linuxWk = isLinuxWebKit();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      logWarn('mediapipe', 'WebGL context lost on GPU inference canvas');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      logInfo('mediapipe', 'WebGL context restored on GPU inference canvas');
    });
    canvas.getContext('webgl2', {
      powerPreference: 'high-performance',
      antialias: false,
      alpha: false,
      ...(linuxWk ? {} : { desynchronized: true }),
    });
    return canvas;
  } catch {
    return undefined;
  }
}

async function createLandmarker(
  delegate: 'GPU' | 'CPU',
  numHands: number,
  hybridLabel: boolean,
): Promise<HandLandmarker> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const vision = await FilesetResolver.forVisionTasks(wasmPath());
  const buffer = await loadModelBuffer();
  const baseOptions = buffer
    ? { modelAssetBuffer: buffer.slice(), delegate }
    : { modelAssetPath: modelPath(), delegate };
  const canvas =
    delegate === 'GPU'
      ? createHighPerfGpuCanvas()
      : typeof document !== 'undefined' && isLinuxWebKit()
        ? document.createElement('canvas')
        : undefined;

  activeDelegate = delegate;
  activeBackendLabel = delegate === 'GPU' ? (hybridLabel ? 'CPU+GPU' : 'GPU') : 'CPU';

  const landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions,
    ...(canvas ? { canvas } : {}),
    runningMode: 'VIDEO',
    numHands,
    minHandDetectionConfidence: 0.25,
    minHandPresenceConfidence: 0.25,
    minTrackingConfidence: 0.25,
  });

  const elapsedMs =
    typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : undefined;
  logInfo('mediapipe', 'HandLandmarker ready', {
    delegate,
    backendLabel: activeBackendLabel,
    numHands,
    frameSourceMode,
    targetInputWidth,
    initMs: elapsedMs,
  });
  return landmarker;
}

/**
 * Create (once) or reconfigure the HandLandmarker for the requested compute backend.
 * Defaults to `hybrid` (CPU + GPU) with automatic CPU failover if GPU init fails.
 */
export function getHandLandmarker(
  preferredBackend: ComputeBackend = currentPreferredBackend,
  dominantHand: DominantHand = 'auto',
): Promise<HandLandmarker> {
  // Single-hand inference is ~1.8x faster when no left/right disambiguation is required.
  const desiredHands = dominantHand === 'auto' ? 1 : 2;
  const plan: ExecutionPlan = resolveExecutionPlan(
    preferredBackend,
    getComputeCapabilities(),
    isLinuxWebKit(),
  );

  if (
    landmarkerPromise &&
    preferredBackend === currentPreferredBackend &&
    desiredHands === currentNumHands
  ) {
    return landmarkerPromise;
  }

  const prev = landmarkerPromise;
  currentPreferredBackend = preferredBackend;
  currentNumHands = desiredHands;
  targetInputWidth = plan.inputWidth;
  frameSourceMode = plan.preferVideoSource ? 'video' : 'canvas';

  logInfo('mediapipe', 'Resolved execution plan', {
    preferredBackend,
    delegate: plan.delegate,
    label: plan.label,
    inputWidth: plan.inputWidth,
    frameSourceMode,
    desiredHands,
  });

  landmarkerPromise = (async () => {
    if (prev) {
      try {
        safeCloseLandmarker(await prev);
      } catch {
        // ignore previous close errors
      }
    }

    try {
      if (plan.delegate === 'CPU') {
        return await createLandmarker('CPU', desiredHands, false);
      }
      try {
        return await createLandmarker('GPU', desiredHands, plan.label === 'CPU+GPU');
      } catch (gpuErr) {
        logWarn('mediapipe', 'GPU delegate init failed; falling back to CPU', {
          error: gpuErr instanceof Error ? gpuErr.message : String(gpuErr),
        });
        frameSourceMode = 'canvas';
        targetInputWidth = Math.min(targetInputWidth, 320);
        return await createLandmarker('CPU', desiredHands, false);
      }
    } catch (err) {
      logError('mediapipe', 'HandLandmarker initialization failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Never cache a rejected promise: allow the user to retry cleanly.
      landmarkerPromise = null;
      throw err;
    }
  })();

  return landmarkerPromise;
}

/** Switch to CPU delegate if GPU created cleanly but fails or stalls at runtime. */
export async function fallbackToCpuLandmarker(reason = 'runtime-stall'): Promise<HandLandmarker> {
  logWarn('mediapipe', 'Falling back from GPU to CPU delegate', {
    reason,
    previousWidth: targetInputWidth,
    previousSource: frameSourceMode,
  });
  await closeHandLandmarker();
  frameSourceMode = 'canvas';
  consecutiveEmptyFrames = 0;
  targetInputWidth = Math.min(targetInputWidth, 320);
  landmarkerPromise = createLandmarker('CPU', currentNumHands, false).catch((err) => {
    landmarkerPromise = null;
    logError('mediapipe', 'CPU fallback initialization failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  });
  return landmarkerPromise;
}

/** Dynamically adjust snapshot canvas width for hybrid load balancing. */
export function setInferenceInputWidth(width: number): void {
  if (Number.isFinite(width) && width >= 192 && width <= 640) {
    targetInputWidth = Math.round(width);
  }
}

export function getTargetInputWidth(): number {
  return targetInputWidth;
}

export function getActiveDelegate(): 'GPU' | 'CPU' {
  return activeDelegate;
}

export function getActiveBackendLabel(): ActiveComputeBackend {
  return activeBackendLabel;
}

export function getFrameSourceMode(): FrameSourceMode {
  return frameSourceMode;
}

export function hasDetectedHand(): boolean {
  return hasDetectedAnyHand;
}

/** Reset per-session adaptive readback counters when starting a fresh camera session. */
export function resetDetectionSession(): void {
  frameSourceMode = isLinuxWebKit() ? 'canvas' : 'video';
  consecutiveEmptyFrames = 0;
  hasDetectedAnyHand = false;
}

const lastTimestamp = new WeakMap<HandLandmarker, number>();

function nextTimestamp(landmarker: HandLandmarker, nowMs: number): number {
  let timestamp = Math.floor(nowMs);
  const previous = lastTimestamp.get(landmarker);
  if (previous !== undefined && timestamp <= previous) timestamp = previous + 1;
  lastTimestamp.set(landmarker, timestamp);
  return timestamp;
}

/**
 * Select the best hand from MediaPipe's detections.
 *
 * When a specific `dominantHand` is requested, prefer hands matching it
 * (accounting for MediaPipe's unmirrored handedness convention on selfie cameras),
 * but fall back to the largest visible hand instead of dropping detection
 * completely when the user raises their other hand or the camera flips labels.
 */
export function pickBestHand(
  landmarksList: Landmark[][],
  handednessList: { categoryName?: string }[][],
  dominantHand: DominantHand,
  mirrored = true,
): HandResult | null {
  if (!landmarksList.length) return null;

  const select = (enforceDominant: boolean): HandResult | null => {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < landmarksList.length; i++) {
      const lm = landmarksList[i];
      if (!lm || lm.length < 21) continue;
      const rawHand: Handedness =
        handednessList?.[i]?.[0]?.categoryName === 'Left' ? 'Left' : 'Right';
      // On front-facing (mirrored) cameras, MediaPipe's unmirrored classifier
      // labels the user's physical right hand as "Left" and vice-versa.
      const userHand: Handedness = mirrored ? (rawHand === 'Left' ? 'Right' : 'Left') : rawHand;
      if (enforceDominant && dominantHand !== 'auto' && userHand.toLowerCase() !== dominantHand) {
        continue;
      }
      const wrist = lm[0]!;
      const mcp = lm[9]!;
      const size = Math.hypot(wrist.x - mcp.x, wrist.y - mcp.y);
      if (size > bestScore) {
        bestScore = size;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return null;
    const landmarks = landmarksList[bestIdx]!;
    const handedness: Handedness =
      handednessList?.[bestIdx]?.[0]?.categoryName === 'Left' ? 'Left' : 'Right';
    return { landmarks, handedness };
  };

  return select(true) ?? select(false);
}

function getVideoSnapshotCanvas(
  video: HTMLVideoElement,
  cpuReadback: boolean,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined' || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return null;
  }

  let canvas: HTMLCanvasElement | null;
  let ctx: CanvasRenderingContext2D | null;
  if (cpuReadback) {
    if (!cpuSnapCanvas) {
      cpuSnapCanvas = document.createElement('canvas');
      cpuSnapCtx = cpuSnapCanvas.getContext('2d', { willReadFrequently: true });
    }
    canvas = cpuSnapCanvas;
    ctx = cpuSnapCtx ?? canvas.getContext('2d', { willReadFrequently: true });
    cpuSnapCtx = ctx;
  } else {
    if (!gpuSnapCanvas) {
      gpuSnapCanvas = document.createElement('canvas');
      gpuSnapCtx = gpuSnapCanvas.getContext('2d');
    }
    canvas = gpuSnapCanvas;
    ctx = gpuSnapCtx ?? canvas.getContext('2d');
    gpuSnapCtx = ctx;
  }

  if (!canvas || !ctx) return null;

  const targetW = Math.min(video.videoWidth, targetInputWidth);
  const targetH = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * targetW));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  ctx.drawImage(video, 0, 0, targetW, targetH);
  return { canvas, ctx };
}

function runWithSource(
  landmarker: HandLandmarker,
  video: HTMLVideoElement,
  nowMs: number,
  mode: FrameSourceMode,
) {
  const ts = nextTimestamp(landmarker, nowMs);
  if (mode === 'video') {
    return landmarker.detectForVideo(video, ts);
  }
  const needsCpuReadback = mode === 'imagedata' || activeDelegate === 'CPU';
  const snap = getVideoSnapshotCanvas(video, needsCpuReadback);
  if (!snap) return landmarker.detectForVideo(video, ts);
  if (mode === 'imagedata') {
    const imgData = snap.ctx.getImageData(0, 0, snap.canvas.width, snap.canvas.height);
    return landmarker.detectForVideo(imgData, ts);
  }
  return landmarker.detectForVideo(snap.canvas, ts);
}

/** Detect hands in the current video frame. Returns null when no hand or landmarker is closed. */
export function detectHand(
  landmarker: HandLandmarker,
  video: HTMLVideoElement,
  nowMs: number,
  dominantHand: DominantHand = 'auto',
  mirrored = true,
): HandResult | null {
  if (closedLandmarkers.has(landmarker)) return null;
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null;

  let result;
  try {
    result = runWithSource(landmarker, video, nowMs, frameSourceMode);
  } catch (err) {
    // Hardware-decoded <video> or canvas texture readback failed: step down to
    // 2D canvas, then raw ImageData, before surfacing an error.
    const nextMode: FrameSourceMode | null =
      frameSourceMode === 'video' ? 'canvas' : frameSourceMode === 'canvas' ? 'imagedata' : null;
    if (!nextMode) throw err;
    logWarn('mediapipe', 'Frame source threw; stepping down readback mode', {
      from: frameSourceMode,
      to: nextMode,
      error: err instanceof Error ? err.message : String(err),
    });
    frameSourceMode = nextMode;
    result = runWithSource(landmarker, video, nowMs, nextMode);
  }

  let landmarksList = (result.landmarks ?? []) as Landmark[][];
  let handednessList = (result.handedness ?? []) as { categoryName?: string }[][];

  // Silent WebGL texImage2D(video) failure recovery: when direct video input
  // produces sustained empty results without throwing, probe 2D canvas and
  // ImageData readback automatically so broken video textures never stall tracking.
  if (landmarksList.length === 0) {
    consecutiveEmptyFrames += 1;
    if (!hasDetectedAnyHand && frameSourceMode === 'video' && consecutiveEmptyFrames >= 12) {
      try {
        const probe = runWithSource(landmarker, video, nowMs, 'canvas');
        const probeLm = (probe.landmarks ?? []) as Landmark[][];
        if (probeLm.length > 0 || consecutiveEmptyFrames >= 20) {
          logInfo('mediapipe', 'Switched frame source from video to canvas after empty frames', {
            detectedOnProbe: probeLm.length > 0,
            consecutiveEmptyFrames,
          });
          frameSourceMode = 'canvas';
          landmarksList = probeLm;
          handednessList = (probe.handedness ?? []) as { categoryName?: string }[][];
        }
      } catch {
        // Ignore probe failure and keep existing source.
      }
    } else if (
      !hasDetectedAnyHand &&
      frameSourceMode === 'canvas' &&
      consecutiveEmptyFrames >= 28
    ) {
      try {
        const probe = runWithSource(landmarker, video, nowMs, 'imagedata');
        const probeLm = (probe.landmarks ?? []) as Landmark[][];
        if (probeLm.length > 0) {
          logInfo('mediapipe', 'Switched frame source from canvas to imagedata after empty frames');
          frameSourceMode = 'imagedata';
          landmarksList = probeLm;
          handednessList = (probe.handedness ?? []) as { categoryName?: string }[][];
        }
      } catch {
        // Ignore probe failure.
      }
    }
  } else {
    consecutiveEmptyFrames = 0;
    hasDetectedAnyHand = true;
  }

  return pickBestHand(landmarksList, handednessList, dominantHand, mirrored);
}

export async function closeHandLandmarker(): Promise<void> {
  const current = landmarkerPromise;
  landmarkerPromise = null;
  if (current) {
    try {
      safeCloseLandmarker(await current);
    } catch {
      // ignore
    }
  }
}
