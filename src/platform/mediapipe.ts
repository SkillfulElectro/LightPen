/**
 * MediaPipe Tasks Vision HandLandmarker (bundled WASM + model, no CDN).
 * All inference is on-device; frames never leave the device.
 *
 * Reliability fixes:
 * - Lowered detection/presence/tracking thresholds (0.25) for pinched & fast-moving hands
 * - Tracks up to 2 hands and selects dominant/largest hand with selfie-mirror awareness
 *   (falling back to the largest visible hand rather than dropping tracking on mismatch)
 * - Pre-fetches and validates `hand_landmarker.task` once (reused across GPU->CPU switch,
 *   rejects SPA HTML fallbacks cleanly, and never caches a rejected initialization promise)
 * - Proactive 2D canvas & ImageData readback fallback (handles silent WebGL `texImage2D`
 *   black-texture failures on Linux/WebKitGTK & Android WebViews, not only thrown errors)
 * - Runtime GPU -> CPU fallback for both thrown errors and silent zero-detection streams
 */
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { DominantHand, Handedness, Landmark } from '../core/types';

export interface HandResult {
  landmarks: Landmark[];
  handedness: Handedness;
}

export type FrameSourceMode = 'video' | 'canvas' | 'imagedata';

let landmarkerPromise: Promise<HandLandmarker> | null = null;
let cachedModelBuffer: Uint8Array | null = null;
let activeDelegate: 'GPU' | 'CPU' = 'GPU';
let fallbackCanvas: HTMLCanvasElement | null = null;
let frameSourceMode: FrameSourceMode = isLinuxWebKit() ? 'canvas' : 'video';
let consecutiveEmptyFrames = 0;
let hasDetectedAnyHand = false;

/**
 * WebKitGTK on Linux frequently lacks a hardware GL video sink (ADR-025), so
 * WebGL `texImage2D(HTMLVideoElement)` silently uploads black frames without
 * throwing. Starting on CPU + 2D canvas readback avoids dead 0-hand streams.
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

async function createLandmarker(delegate: 'GPU' | 'CPU'): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(wasmPath());
  const buffer = await loadModelBuffer();
  const baseOptions = buffer
    ? { modelAssetBuffer: buffer.slice(), delegate }
    : { modelAssetPath: modelPath(), delegate };

  // Avoid OffscreenCanvas WebGL2 bugs on WebKitGTK by providing a normal canvas element.
  const canvas =
    typeof document !== 'undefined' && isLinuxWebKit()
      ? document.createElement('canvas')
      : undefined;

  activeDelegate = delegate;
  return HandLandmarker.createFromOptions(vision, {
    baseOptions,
    ...(canvas ? { canvas } : {}),
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.25,
    minHandPresenceConfidence: 0.25,
    minTrackingConfidence: 0.25,
  });
}

/** Create (once) the HandLandmarker. GPU delegate with automatic CPU fallback. */
export function getHandLandmarker(): Promise<HandLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      try {
        if (isLinuxWebKit()) {
          return await createLandmarker('CPU');
        }
        try {
          return await createLandmarker('GPU');
        } catch {
          return await createLandmarker('CPU');
        }
      } catch (err) {
        // Never cache a rejected promise: allow the user to retry cleanly.
        landmarkerPromise = null;
        throw err;
      }
    })();
  }
  return landmarkerPromise;
}

/** Switch to CPU delegate if GPU created cleanly but fails or detects nothing at runtime. */
export async function fallbackToCpuLandmarker(): Promise<HandLandmarker> {
  await closeHandLandmarker();
  frameSourceMode = 'canvas';
  consecutiveEmptyFrames = 0;
  landmarkerPromise = createLandmarker('CPU').catch((err) => {
    landmarkerPromise = null;
    throw err;
  });
  return landmarkerPromise;
}

export function getActiveDelegate(): 'GPU' | 'CPU' {
  return activeDelegate;
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
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined' || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return null;
  }
  if (!fallbackCanvas) fallbackCanvas = document.createElement('canvas');
  const targetW = Math.min(video.videoWidth, 640);
  const targetH = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * targetW));
  if (fallbackCanvas.width !== targetW || fallbackCanvas.height !== targetH) {
    fallbackCanvas.width = targetW;
    fallbackCanvas.height = targetH;
  }
  const ctx = fallbackCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, targetW, targetH);
  return { canvas: fallbackCanvas, ctx };
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
  const snap = getVideoSnapshotCanvas(video);
  if (!snap) return landmarker.detectForVideo(video, ts);
  if (mode === 'imagedata') {
    const imgData = snap.ctx.getImageData(0, 0, snap.canvas.width, snap.canvas.height);
    return landmarker.detectForVideo(imgData, ts);
  }
  return landmarker.detectForVideo(snap.canvas, ts);
}

/** Detect hands in the current video frame. Returns null when no hand. */
export function detectHand(
  landmarker: HandLandmarker,
  video: HTMLVideoElement,
  nowMs: number,
  dominantHand: DominantHand = 'auto',
  mirrored = true,
): HandResult | null {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null;

  let result;
  try {
    result = runWithSource(landmarker, video, nowMs, frameSourceMode);
  } catch (err) {
    // Hardware-decoded <video> or canvas texture readback failed: step down to
    // CPU-backed 2D canvas, then raw ImageData, before surfacing an error.
    const nextMode: FrameSourceMode | null =
      frameSourceMode === 'video' ? 'canvas' : frameSourceMode === 'canvas' ? 'imagedata' : null;
    if (!nextMode) throw err;
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
  if (landmarkerPromise) {
    try {
      (await landmarkerPromise).close();
    } catch {
      // ignore
    }
    landmarkerPromise = null;
  }
}
