/**
 * Module-level handle to the camera tracking session and live camera feed.
 * Shares the active MediaStream and real-time hand landmarks with the Tutorial
 * so the user sees their face, posture, and hand skeleton while learning.
 */
import type { GestureKind, Landmark } from '../core/types';

export interface LiveCameraFrame {
  landmarks: Landmark[] | null;
  mirrored: boolean;
  gestureKind: GestureKind;
  pinchDistance: number;
  handPresent: boolean;
  indexTip: { x: number; y: number } | null;
  contact: boolean;
}

let startTrackingRef: (() => Promise<void>) | null = null;
let activeStream: MediaStream | null = null;
let latestFrame: LiveCameraFrame | null = null;

const streamListeners = new Set<(stream: MediaStream | null) => void>();
const frameListeners = new Set<(frame: LiveCameraFrame) => void>();

export function registerTrackingStarter(start: () => Promise<void>): () => void {
  startTrackingRef = start;
  return () => {
    if (startTrackingRef === start) startTrackingRef = null;
  };
}

/** Start hand tracking if the camera panel is mounted. */
export async function startTracking(): Promise<void> {
  await startTrackingRef?.();
}

export function isTrackingAvailable(): boolean {
  return startTrackingRef !== null;
}

export function publishCameraStream(stream: MediaStream | null): void {
  activeStream = stream;
  for (const listener of streamListeners) listener(stream);
}

export function getCameraStream(): MediaStream | null {
  return activeStream;
}

export function subscribeCameraStream(listener: (stream: MediaStream | null) => void): () => void {
  streamListeners.add(listener);
  listener(activeStream);
  return () => {
    streamListeners.delete(listener);
  };
}

export function publishLiveFrame(frame: LiveCameraFrame): void {
  latestFrame = frame;
  for (const listener of frameListeners) listener(frame);
}

export function getLatestLiveFrame(): LiveCameraFrame | null {
  return latestFrame;
}

export function subscribeLiveFrame(listener: (frame: LiveCameraFrame) => void): () => void {
  frameListeners.add(listener);
  if (latestFrame) listener(latestFrame);
  return () => {
    frameListeners.delete(listener);
  };
}
