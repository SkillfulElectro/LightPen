/**
 * Camera access via getUserMedia. All frames stay on-device.
 */

export type CameraErrorKind =
  | 'denied'
  | 'not-found'
  | 'in-use'
  | 'unsupported'
  /**
   * The webview has a camera but no way to read it. On Linux this is the
   * AppImage's missing GStreamer capture plugins: WebKitGTK logs "Video capture
   * was requested but no device was found amongst 0 devices" and rejects with
   * OverconstrainedError even though the device exists. It needs its own
   * message, because "check that one is connected" sends people to the wrong
   * place.
   */
  | 'no-capture'
  | 'unknown';

/** i18n key for each camera failure, so the UI never shows a raw key. */
export const CAMERA_ERROR_MESSAGE_KEY: Record<CameraErrorKind, string> = {
  denied: 'camera.denied',
  'not-found': 'camera.notFound',
  'in-use': 'camera.inUse',
  unsupported: 'camera.unsupported',
  'no-capture': 'camera.noCapturePlugins',
  unknown: 'camera.unsupported',
};

const isLinuxDesktop = (): boolean =>
  typeof navigator !== 'undefined' && /Linux/i.test(navigator.userAgent);

/**
 * `OverconstrainedError` means "no device matches these constraints". Browsers
 * raise it for a genuinely missing camera *and* for a webview that cannot
 * capture at all, so the two are told apart by enumeration: on Linux, if no
 * videoinput is listed while the OS almost certainly has one, the webview is
 * missing its capture stack rather than the user missing a camera.
 */
export async function hasAnyVideoInput(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === 'videoinput');
  } catch {
    return false;
  }
}

/** The same constraints, loosened all the way — a last attempt before giving up. */
export async function startCameraUnconstrained(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
}

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

/**
 * Start a camera stream. Caller owns the stream and must stop it.
 *
 * Tries the preferred constraints, then a bare `{ video: true }` (some webviews
 * refuse the ideal width/height or the facingMode), and only then decides the
 * failure was real — with a better message on Linux, where an AppImage without
 * GStreamer plugins reports "no device" for a camera that exists.
 */
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
  } catch (first) {
    // A denied permission will not become allowed by asking more loosely.
    const mapped = mapError(first);
    if (mapped.kind === 'denied' || mapped.kind === 'in-use') throw mapped;
    try {
      return await startCameraUnconstrained();
    } catch {
      // Only OverconstrainedError is ambiguous: the spec uses it both for
      // "no camera matches" and for "this webview has no capture pipeline at
      // all". NotFoundError already means there is no device.
      const ambiguous = (first as { name?: string }).name === 'OverconstrainedError';
      if (ambiguous && isLinuxDesktop() && !(await hasAnyVideoInput())) {
        throw new CameraError(
          'no-capture',
          'This build cannot read from the camera (missing GStreamer capture plugins).',
        );
      }
      throw mapped;
    }
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
