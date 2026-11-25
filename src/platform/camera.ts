/**
 * Camera access via getUserMedia. All frames stay on-device.
 *
 * Permission is a native concern, not a browser prompt, in the packaged
 * app: `src-tauri/src/lib.rs` answers the webview's permission request
 * (`Builder::on_permission_request`, camera-only). Without that handler
 * WebKitGTK denied every request on Linux — the CachyOS “camera
 * permission is not granted” report — and no retry or looser constraint
 * in this file could have fixed it. A `denied` result here therefore
 * means a genuine system-level refusal (OS settings, portal, device
 * node permissions), which is what `camera.denied` now tells the user
 * to check.
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
        ? {
            deviceId: { exact: deviceId },
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 60, min: 24 },
          }
        : {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 60, min: 24 },
          },
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
 * How long without a single frame before the loop falls back to a timer.
 *
 * `requestVideoFrameCallback` only fires when the webview hands us a new
 * frame. If the capture pipeline stalls (a frozen AppImage GStreamer stack, a
 * camera that was yanked, a WebKitGTK decoder hiccup) it never fires again:
 * FPS stays at 0, no error is raised, and nothing can recover because the
 * loop is waiting for a frame that will never come. A watchdog turns that
 * silent death into a polled retry, so the app either recovers or can say why.
 */
export const FRAME_STALL_MS = 1000;

/**
 * Run a per-frame callback with `requestVideoFrameCallback` when available,
 * falling back to `requestAnimationFrame` and finally to a timer watchdog.
 * Returns a stop function. Also reports measured FPS via `onFps`.
 *
 * `onFrame` exceptions are the caller's problem (it reports them); they are
 * caught here so one bad frame cannot kill the loop.
 */
export function runFrameLoop(
  video: HTMLVideoElement,
  onFrame: (nowMs: number) => void,
  onFps?: (fps: number) => void,
  watchdogMs = FRAME_STALL_MS,
): () => void {
  let stopped = false;
  let frames = 0;
  let lastFpsTime = performance.now();
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  // Incremented on every schedule; a stale callback (or the watchdog racing a
  // late video-frame callback) is ignored instead of producing a double tick.
  let generation = 0;

  const report = (nowMs: number) => {
    if (!onFps || nowMs - lastFpsTime < 1000) return;
    onFps((frames * 1000) / (nowMs - lastFpsTime));
    frames = 0;
    lastFpsTime = nowMs;
  };

  const tick = (nowMs: number, gen: number) => {
    if (stopped || gen !== generation) return;
    generation += 1; // invalidate the watchdog and any queued callback
    clearWatchdog();
    try {
      onFrame(nowMs);
    } catch {
      // The caller reports detector failures; never let one abort the loop.
    }
    frames += 1;
    report(nowMs);
    schedule();
  };

  const clearWatchdog = () => {
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };

  const rvfc = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: unknown) => void) => number;
  };
  const usesVideoFrames = typeof rvfc.requestVideoFrameCallback === 'function';

  function schedule() {
    if (stopped) return;
    generation += 1;
    const gen = generation;
    if (usesVideoFrames) {
      rvfc.requestVideoFrameCallback!((now) => tick(now, gen));
      clearWatchdog();
      watchdog = setTimeout(() => {
        watchdog = null;
        // No frame arrived: poll once so the stall is visible as 0 FPS and
        // the health check can name it, then keep going.
        tick(performance.now(), gen);
      }, watchdogMs);
    } else {
      requestAnimationFrame(() => tick(performance.now(), gen));
    }
  }

  schedule();
  return () => {
    stopped = true;
    clearWatchdog();
  };
}

/** True when the element currently holds a decodable frame. */
export function hasLiveFrames(video: HTMLVideoElement): boolean {
  return video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
}

/**
 * Wait until the <video> element actually has decoded frame dimensions before
 * starting MediaPipe detection, avoiding premature 0x0 frame failures.
 */
export function waitForVideoFrames(video: HTMLVideoElement, timeoutMs = 4000): Promise<boolean> {
  if (hasLiveFrames(video)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ok);
    };
    const check = () => {
      if (hasLiveFrames(video)) finish(true);
    };
    const onEvent = () => check();
    video.addEventListener('loadeddata', onEvent);
    video.addEventListener('playing', onEvent);
    video.addEventListener('resize', onEvent);
    const poll = setInterval(check, 60);
    const timer = setTimeout(() => finish(hasLiveFrames(video)), timeoutMs);
    const cleanup = () => {
      clearInterval(poll);
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onEvent);
      video.removeEventListener('playing', onEvent);
      video.removeEventListener('resize', onEvent);
    };
  });
}
