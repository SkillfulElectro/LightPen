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

/** Detect hands in the current video frame. Returns null when no hand. */
export function detectHand(landmarker: HandLandmarker, video: HTMLVideoElement, nowMs: number): HandResult | null {
  if (video.readyState < 2) return null;
  const result = landmarker.detectForVideo(video, nowMs);
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
