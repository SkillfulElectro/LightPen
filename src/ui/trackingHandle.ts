/**
 * Module-level handle to the camera tracking session, live `<video>` element,
 * tracker lifecycle status, and real-time hand landmarks.
 *
 * Sharing the single `<video>` element (drawn onto canvases in the Tutorial and
 * Calibration views) avoids attaching the same `MediaStream` to multiple
 * `<video>` elements, which can starve decoding on WebKitGTK / GStreamer.
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
  holdProgress: number;
}

export type TrackerPhase = 'idle' | 'starting' | 'loading-model' | 'running' | 'error';

export interface TrackerStatus {
  phase: TrackerPhase;
  error: string | null;
  detail: string | null;
  fps: number;
}

const DEFAULT_STATUS: TrackerStatus = {
  phase: 'idle',
  error: null,
  detail: null,
  fps: 0,
};

let startTrackingRef: (() => Promise<void>) | null = null;
let activeStream: MediaStream | null = null;
let activeVideo: HTMLVideoElement | null = null;
let latestFrame: LiveCameraFrame | null = null;
let trackerStatus: TrackerStatus = { ...DEFAULT_STATUS };

const streamListeners = new Set<(stream: MediaStream | null) => void>();
const frameListeners = new Set<(frame: LiveCameraFrame) => void>();
const statusListeners = new Set<(status: TrackerStatus) => void>();

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

export function publishCameraVideo(video: HTMLVideoElement | null): void {
  activeVideo = video;
}

export function getCameraVideo(): HTMLVideoElement | null {
  return activeVideo;
}

export function publishTrackerStatus(patch: Partial<TrackerStatus>): void {
  trackerStatus = { ...trackerStatus, ...patch };
  for (const listener of statusListeners) listener(trackerStatus);
}

export function getTrackerStatus(): TrackerStatus {
  return trackerStatus;
}

export function subscribeTrackerStatus(listener: (status: TrackerStatus) => void): () => void {
  statusListeners.add(listener);
  listener(trackerStatus);
  return () => {
    statusListeners.delete(listener);
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
