/**
 * Camera access via getUserMedia. All frames stay on-device.
 */

export type CameraErrorKind = 'denied' | 'not-found' | 'in-use' | 'unsupported' | 'unknown';

export class CameraError extends Error {
  constructor(
    public readonly kind: CameraErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export function isCameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** List video input devices (labels require permission in most browsers). */
export async function listCameras(): Promise<CameraDevice[]> {
  if (!isCameraSupported()) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  } catch {
    return [];
  }
}

function mapError(err: unknown): CameraError {
  const name = err instanceof DOMException ? err.name : (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new CameraError('denied', 'Camera permission was denied.');
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new CameraError('not-found', 'No camera was found on this device.');
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return new CameraError('in-use', 'The camera is already in use by another app.');
  }
  return new CameraError('unknown', 'Could not start the camera.');
}

/** Start a camera stream. Caller owns the stream and must stop it. */
export async function startCamera(deviceId: string | null): Promise<MediaStream> {
  if (!isCameraSupported()) {
    throw new CameraError('unsupported', 'Camera is not supported in this browser.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    throw mapError(err);
  }
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/**
 * Run a per-frame callback with `requestVideoFrameCallback` when available,
 * falling back to `requestAnimationFrame`. Returns a stop function.
 * Also reports measured FPS via `onFps`.
 */
export function runFrameLoop(
  video: HTMLVideoElement,
  onFrame: (nowMs: number) => void,
  onFps?: (fps: number) => void,
): () => void {
  let stopped = false;
  let frames = 0;
  let lastFpsTime = performance.now();
  const tick = (nowMs: number) => {
    if (stopped) return;
    onFrame(nowMs);
    frames += 1;
    if (onFps && nowMs - lastFpsTime >= 1000) {
      onFps((frames * 1000) / (nowMs - lastFpsTime));
      frames = 0;
      lastFpsTime = nowMs;
    }
    schedule();
  };
  const rvfc = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number) => void) => number;
  };
  const schedule = () => {
    if (typeof rvfc.requestVideoFrameCallback === 'function') {
      rvfc.requestVideoFrameCallback(tick);
    } else {
      requestAnimationFrame(tick);
    }
  };
  schedule();
  return () => {
    stopped = true;
  };
}
