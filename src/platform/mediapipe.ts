/**
 * MediaPipe Tasks Vision HandLandmarker (bundled WASM + model, no CDN).
 * All inference is on-device; frames never leave the device.
 *
 * Reliability fixes:
 * - Lowered detection/presence/tracking thresholds (0.32) for pinched writing hands
 * - Tracks up to 2 hands and selects dominant/largest hand instead of blindly taking index 0
 * - Automatic runtime GPU -> CPU fallback if detectForVideo throws on WebViews
 * - Automatic 2D canvas readback fallback for WebKitGTK / Android hardware video textures
 */
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { DominantHand, Handedness, Landmark } from '../core/types';

export interface HandResult {
  landmarks: Landmark[];
  handedness: Handedness;
}

let landmarkerPromise: Promise<HandLandmarker> | null = null;
let activeDelegate: 'GPU' | 'CPU' = 'GPU';
let fallbackCanvas: HTMLCanvasElement | null = null;

function wasmPath(): string {
  return `${import.meta.env.BASE_URL}wasm`;
}

function modelPath(): string {
  return `${import.meta.env.BASE_URL}models/hand_landmarker.task`;
}

async function createLandmarker(delegate: 'GPU' | 'CPU'): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(wasmPath());
  activeDelegate = delegate;
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelPath(), delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.32,
    minHandPresenceConfidence: 0.32,
    minTrackingConfidence: 0.32,
  });
}

/** Create (once) the HandLandmarker. GPU delegate with CPU fallback. */
export function getHandLandmarker(): Promise<HandLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      try {
        return await createLandmarker('GPU');
      } catch {
        return createLandmarker('CPU');
      }
    })();
  }
  return landmarkerPromise;
}

/** Switch to CPU delegate if GPU created cleanly but fails during detectForVideo. */
export async function fallbackToCpuLandmarker(): Promise<HandLandmarker> {
  await closeHandLandmarker();
  landmarkerPromise = createLandmarker('CPU');
  return landmarkerPromise;
}

export function getActiveDelegate(): 'GPU' | 'CPU' {
  return activeDelegate;
}

const lastTimestamp = new WeakMap<HandLandmarker, number>();

function pickBestHand(
  landmarksList: Landmark[][],
  handednessList: { categoryName?: string }[][],
  dominantHand: DominantHand,
): HandResult | null {
  if (!landmarksList.length) return null;
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < landmarksList.length; i++) {
    const lm = landmarksList[i];
    if (!lm || lm.length < 21) continue;
    const rawHand = handednessList?.[i]?.[0]?.categoryName === 'Left' ? 'Left' : 'Right';
    if (dominantHand !== 'auto' && rawHand.toLowerCase() !== dominantHand) continue;
    const wrist = lm[0]!;
    const mcp = lm[9]!;
    const size = Math.hypot(wrist.x - mcp.x, wrist.y - mcp.y);
    if (size > bestScore) {
      bestScore = size;
      bestIdx = i;
    }
  }

  if (bestScore < 0) return null;
  const landmarks = landmarksList[bestIdx]!;
  const handedness: Handedness =
    handednessList?.[bestIdx]?.[0]?.categoryName === 'Left' ? 'Left' : 'Right';
  return { landmarks, handedness };
}

function getVideoSnapshotCanvas(video: HTMLVideoElement): HTMLCanvasElement | null {
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
  return fallbackCanvas;
}

/** Detect hands in the current video frame. Returns null when no hand. */
export function detectHand(
  landmarker: HandLandmarker,
  video: HTMLVideoElement,
  nowMs: number,
  dominantHand: DominantHand = 'auto',
): HandResult | null {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null;
  let timestamp = Math.floor(nowMs);
  const previous = lastTimestamp.get(landmarker);
  if (previous !== undefined && timestamp <= previous) timestamp = previous + 1;
  lastTimestamp.set(landmarker, timestamp);

  let result;
  try {
    result = landmarker.detectForVideo(video, timestamp);
  } catch (videoErr) {
    // Hardware-decoded <video> readback can fail on WebKitGTK / Android WebView:
    // copy the frame to a 2D canvas and retry before surfacing a detector error.
    const snap = getVideoSnapshotCanvas(video);
    if (!snap) throw videoErr;
    const retryTs = timestamp + 1;
    lastTimestamp.set(landmarker, retryTs);
    result = landmarker.detectForVideo(snap, retryTs);
  }

  const landmarksList = (result.landmarks ?? []) as Landmark[][];
  const handednessList = (result.handedness ?? []) as { categoryName?: string }[][];
  return pickBestHand(landmarksList, handednessList, dominantHand);
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
