/**
 * Why tracking produced no frames.
 *
 * The bug behind "the camera opened but it stayed at 0 FPS and never saw my
 * hand": the frame loop stopped on its first frame (MediaPipe threw, or the
 * <video> never delivered a frame), the exception was swallowed, and the UI
 * showed "0 FPS" with no hint at all. A tracker that dies silently is
 * unmaintainable, so every failure mode gets a name and a message.
 *
 * Pure logic (no DOM) so the wording and the thresholds are unit-tested.
 */

export type TrackerFailure =
  /** The <video> element stayed black/empty: no frames from the camera. */
  | 'no-frames'
  /** MediaPipe threw ("no video frame", "already in use", WASM/CPU trouble). */
  | 'detector-error'
  /** The detector runs but finds nothing for a long time (lens covered,
   *  wall in view, hand never in frame, or a broken capture pipeline that
   *  delivers frozen frames). */
  | 'no-hand';

export const TRACKER_FAILURE_MESSAGE_KEY: Record<TrackerFailure, string> = {
  'no-frames': 'camera.failureNoFrames',
  'detector-error': 'camera.failureDetectorError',
  'no-hand': 'camera.failureNoHand',
};

/** The measured frame rate is meaningless below this. */
export const USABLE_FPS = 5;

export interface TrackerSample {
  /** Video dimensions as the webview reports them (0 = no frame yet). */
  videoWidth: number;
  videoHeight: number;
  /** `video.readyState` (>= 2 means a frame is available). */
  readyState: number;
  /** Measured frames per second of the tracking loop. */
  fps: number;
  /** Consecutive frames where no hand was found. */
  lostFrames: number;
  /** Exceptions thrown by the detector since the loop started. */
  detectorErrors: number;
}

export interface TrackerDiagnosis {
  failure: TrackerFailure;
  /** Prefix for the user-facing hint. */
  messageKey: string;
  /** Short machine-readable detail for the log/copy-to-clipboard text. */
  detail: string;
}

/**
 * Decide what is wrong, or null when the tracker is healthy enough.
 *
 * Order matters: "the detector threw" explains an empty screen better than
 * "no hand", and "the video has no frames" explains an exception better than
 * the detector's own wording.
 */
export function diagnoseTracker(s: TrackerSample): TrackerDiagnosis | null {
  if (s.videoWidth <= 0 || s.videoHeight <= 0 || s.readyState < 2) {
    return {
      failure: 'no-frames',
      messageKey: TRACKER_FAILURE_MESSAGE_KEY['no-frames'],
      detail: `video ${s.videoWidth}x${s.videoHeight}, readyState ${s.readyState}`,
    };
  }
  if (s.detectorErrors > 0 && s.fps < USABLE_FPS) {
    return {
      failure: 'detector-error',
      messageKey: TRACKER_FAILURE_MESSAGE_KEY['detector-error'],
      detail: `${s.detectorErrors} detector error(s), ${Math.round(s.fps)} FPS`,
    };
  }
  if (s.fps < USABLE_FPS) {
    return {
      failure: 'no-frames',
      messageKey: TRACKER_FAILURE_MESSAGE_KEY['no-frames'],
      detail: `${Math.round(s.fps)} FPS from a ${s.videoWidth}x${s.videoHeight} stream`,
    };
  }
  return null;
}

/**
 * A hand has been missing for a long time on a stream that *is* running.
 * Kept separate from `diagnoseTracker` so a briefly empty frame never nags.
 */
export function longHandAbsence(
  s: TrackerSample,
  lostFramesThreshold = 300,
  minFps = USABLE_FPS,
): TrackerDiagnosis | null {
  if (s.fps < minFps) return null; // 'no-frames' already explains this
  if (s.lostFrames < lostFramesThreshold) return null;
  return {
    failure: 'no-hand',
    messageKey: TRACKER_FAILURE_MESSAGE_KEY['no-hand'],
    detail: `${s.lostFrames} frames without a hand at ${Math.round(s.fps)} FPS`,
  };
}

/** Human-readable text for a bug report (shown under the message). */
export function diagnosticText(d: TrackerDiagnosis, userAgent: string): string {
  return `${d.failure}: ${d.detail}\nUA: ${userAgent}`;
}
