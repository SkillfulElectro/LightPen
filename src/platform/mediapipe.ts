/**
 * MediaPipe Tasks Vision HandLandmarker (bundled WASM + model, no CDN).
 * All inference is on-device; frames never leave the device.
 */

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { Handedness, Landmark } from '../core/types';

export interface HandResult {
  landmarks: Landmark[];
  handedness: Handedness;
}

let landmarkerPromise: Promise<HandLandmarker> | null = null;

function wasmPath(): string {
  // WASM files are copied to public/wasm/ by scripts/copy-wasm.mjs (postinstall).
  return `${import.meta.env.BASE_URL}wasm`;
}

function modelPath(): string {
  // Model is fetched by scripts/fetch-model.mjs into public/models/.
  return `${import.meta.env.BASE_URL}models/hand_landmarker.task`;
}

/** Create (once) the HandLandmarker. GPU delegate with CPU fallback. */
export function getHandLandmarker(): Promise<HandLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(wasmPath());
      const options = {
        baseOptions: { modelAssetPath: modelPath(), delegate: 'GPU' as const },
        runningMode: 'VIDEO' as const,
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      };
      try {
        return await HandLandmarker.createFromOptions(vision, options);
      } catch {
        // GPU delegate unavailable (some mobile webviews) — retry on CPU.
        return HandLandmarker.createFromOptions(vision, {
          ...options,
          baseOptions: { modelAssetPath: modelPath(), delegate: 'CPU' as const },
        });
      }
    })();
  }
  return landmarkerPromise;
}

/**
 * MediaPipe rejects a timestamp that is not strictly greater than the previous
 * one. `detectForVideo` can be reached twice with the same millisecond (a
 * watchdog poll racing a video-frame callback, or a stalled stream answered
 * from the timer), which throws and — before the loop learned to survive it —
 * killed tracking outright. Timestamps are therefore made monotonic here.
 */
const lastTimestamp = new WeakMap<HandLandmarker, number>();

/** Detect hands in the current video frame. Returns null when no hand. */
export function detectHand(
  landmarker: HandLandmarker,
  video: HTMLVideoElement,
  nowMs: number,
): HandResult | null {
  if (video.readyState < 2 || video.videoWidth === 0) return null;
  let timestamp = nowMs;
  const previous = lastTimestamp.get(landmarker);
  if (previous !== undefined && timestamp <= previous) timestamp = previous + 1;
  lastTimestamp.set(landmarker, timestamp);
  const result = landmarker.detectForVideo(video, timestamp);
  const landmarks = result.landmarks?.[0];
  if (!landmarks) return null;
  const handedness = result.handedness?.[0]?.[0]?.categoryName === 'Left' ? 'Left' : 'Right';
  return { landmarks: landmarks as Landmark[], handedness };
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
