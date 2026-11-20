/**
 * Camera preview + hand-tracking loop.
 * - Picture-in-picture video with hand-skeleton overlay.
 * - Gesture → ink mapping through One Euro smoothing + calibration.
 * - Adaptive quality: drops to half-rate detection when FPS is low.
 * - All processing on-device; stream stops when tracking stops or the
 *   page is hidden (privacy requirement).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addPoint, createStroke } from '../core/annotations';
import {
  cameraToPage,
  clampToPage,
  frameBrightness,
  isLowLight,
  trackingHint,
} from '../core/coords';
import { GestureClassifier } from '../core/gesture';
import { DEFAULT_TOUCH_CONFIG, TouchGestureClassifier } from '../core/touchGestures';
import { OneEuroPoint } from '../core/oneEuro';
import type { PageSize, Stroke } from '../core/types';
import {
  CAMERA_ERROR_MESSAGE_KEY,
  CameraError,
  listCameras,
  runFrameLoop,
  startCamera,
  stopCamera,
  type CameraDevice,
} from '../platform/camera';
import { closeHandLandmarker, detectHand, getHandLandmarker } from '../platform/mediapipe';
import { useStore } from '../store/useStore';
import { registerTrackingStarter } from './trackingHandle';

interface Props {
  pageSize: PageSize;
  onGesture?: (kind: string) => void;
}

export default function CameraPreview({ pageSize, onGesture }: Props) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modelMissing, setModelMissing] = useState(false);
  // On phones the panel floats over the page so the user can see their hand
  // and the PDF at the same time; on desktop it stays in the side column.
  const [collapsed, setCollapsed] = useState(true);
  const active = useStore((s) => s.tracking.active);
  const fps = useStore((s) => s.tracking.fps);
  const hint = useStore((s) => s.tracking.hint);
  const settings = useStore((s) => s.settings);
  const setTracking = useStore((s) => s.setTracking);
  const tool = useStore((s) => s.tool);

  const refreshCameras = useCallback(async () => {
    setCameras(await listCameras());
  }, []);

  useEffect(() => {
    void refreshCameras();
  }, [refreshCameras]);

  const stop = useCallback(() => {
    stopLoopRef.current?.();
    stopLoopRef.current = null;
    stopCamera(streamRef.current);
    streamRef.current = null;
    useStore.setState({ handCursor: null, activeStroke: null });
    setTracking({ active: false, fps: 0, handPresent: false, hint: null });
  }, [setTracking]);

  const start = useCallback(async () => {
    setError(null);
    setModelMissing(false);
    try {
      const stream = await startCamera(settings.cameraId);
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new CameraError('unknown', 'Video element missing.');
      video.srcObject = stream;
      await video.play();
      await refreshCameras();

      let landmarker;
      try {
        landmarker = await getHandLandmarker();
      } catch {
        setModelMissing(true);
        stop();
        return;
      }

      const classifier = new GestureClassifier({
        pinchThreshold: settings.pinchThreshold,
        pinchReleaseThreshold: settings.pinchReleaseThreshold,
        enableErase: settings.enableErase,
        enablePageSwipe: settings.enablePageSwipe,
        enablePauseFist: settings.enablePauseFist,
      });
      // Touch mode uses its own classifier; only one of the two runs per frame,
      // decided by `settings.gestureMode`.
      const touch = new TouchGestureClassifier({
        ...DEFAULT_TOUCH_CONFIG,
        tapThreshold: settings.pinchThreshold,
        releaseThreshold: settings.pinchReleaseThreshold,
        zoomSensitivity: settings.zoomSensitivity,
      });
      const smoother = new OneEuroPoint({
        minCutoff: settings.smoothingMinCutoff,
        beta: settings.smoothingBeta,
        dCutoff: settings.smoothingDCutoff,
      });
      let activeStroke: Stroke | null = null;
      // Coarse offscreen canvas for luminance sampling (never leaves memory).
      const lightCanvas = document.createElement('canvas');
      lightCanvas.width = 64;
      lightCanvas.height = 48;
      const lightCtx = lightCanvas.getContext('2d', { willReadFrequently: true });
      let lowLight = false;
      let lastLightCheck = 0;

      let lostFrames = 0;
      let frameSkip = 0;
      let adaptiveSkip = 1;

      const finishStroke = () => {
        if (activeStroke && activeStroke.points.length > 0) {
          useStore.getState().addStroke(activeStroke);
        }
        activeStroke = null;
        useStore.setState({ activeStroke: null });
      };

      const stopLoop = runFrameLoop(
        video,
        (nowMs) => {
          frameSkip += 1;
          if (frameSkip < adaptiveSkip) return;
          frameSkip = 0;
          const result = detectHand(landmarker, video, nowMs);
          drawOverlay(video, result?.landmarks ?? null);
          if (!result) {
            lostFrames += 1;
            // After ~1 s without a hand, tell the user it is probably out of frame.
            setTracking({ handPresent: false, hint: lostFrames > 30 ? 'out-of-frame' : null });
            // Debounce hand-loss: tolerate a few dropped frames before ending a stroke.
            if (lostFrames > 8) finishStroke();
            useStore.setState({ handCursor: null });
            return;
          }
          lostFrames = 0;
          // Low-light hint: sample a small grid at most twice a second.
          if (lightCtx && nowMs - lastLightCheck > 500) {
            lastLightCheck = nowMs;
            lightCtx.drawImage(video, 0, 0, lightCanvas.width, lightCanvas.height);
            const { data } = lightCtx.getImageData(0, 0, lightCanvas.width, lightCanvas.height);
            const brightness = frameBrightness(
              (x, y) => {
                const i = (y * lightCanvas.width + x) * 4;
                return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
              },
              lightCanvas.width,
              lightCanvas.height,
            );
            lowLight = isLowLight(brightness);
          }
          // Dominant-hand filtering.
          if (
            settings.dominantHand !== 'auto' &&
            result.handedness.toLowerCase() !== settings.dominantHand
          ) {
            setTracking({ handPresent: false });
            return;
          }
          setTracking({ handPresent: true });

          if (settings.gestureMode === 'touch') {
            const frame = touch.classify(result.landmarks, nowMs);
            const page = useStore.getState().currentPage;
            if (frame.twoFingers) {
              // Two fingers: scroll turns pages, spread zooms. Never draws.
              finishStroke();
              if (frame.pageDelta !== 0) {
                useStore.getState().setCurrentPage(page + frame.pageDelta);
                onGesture?.(frame.pageDelta > 0 ? 'scroll-next' : 'scroll-prev');
              }
              if (frame.zoomFactor !== 1) {
                useStore.getState().setZoom(useStore.getState().zoom * frame.zoomFactor);
                onGesture?.('zoom');
              }
            } else if (frame.contact) {
              const where = clampToPage(
                cameraToPage(frame.point, settings.calibration, pageSize, settings.mirrored),
                pageSize,
              );
              const erasing = tool === 'eraser';
              if (erasing) {
                finishStroke();
                useStore.getState().eraseAt(page, where, 18);
              } else {
                if (activeStroke && activeStroke.page !== page) finishStroke();
                if (!activeStroke) {
                  activeStroke = createStroke(page, settings.penColor, settings.penWidth, where);
                  useStore.setState({ activeStroke });
                } else {
                  addPoint(activeStroke, where);
                }
              }
              setTracking({
                hint: trackingHint(frame.pinchDistance) ?? (lowLight ? 'low-light' : null),
              });
              useStore.setState({
                handCursor: { x: where.x, y: where.y, kind: erasing ? 'erase' : 'pen-down' },
              });
            } else {
              finishStroke();
              useStore.setState({ handCursor: null });
              if (frame.tap) onGesture?.('tap');
              if (frame.action === 'pause') {
                onGesture?.('pause');
                stop();
              }
            }
            return;
          }

          const g = classifier.classify(result.landmarks, nowMs);
          setTracking({ hint: trackingHint(g.handSize) ?? (lowLight ? 'low-light' : null) });
          onGesture?.(g.kind);

          const smoothed = smoother.filter(g.indexTip.x, g.indexTip.y, nowMs);
          const pagePoint = clampToPage(
            cameraToPage(smoothed, settings.calibration, pageSize, settings.mirrored),
            pageSize,
          );
          const palmPage = clampToPage(
            cameraToPage(g.palmCenter, settings.calibration, pageSize, settings.mirrored),
            pageSize,
          );

          // Read the live page index: a swipe inside this loop changes it, and a
          // captured value would keep drawing on the page we left.
          const page = useStore.getState().currentPage;
          if (activeStroke && activeStroke.page !== page) finishStroke();

          if (g.kind === 'pen-down') {
            if (!activeStroke) {
              activeStroke = createStroke(page, settings.penColor, settings.penWidth, pagePoint);
              useStore.setState({ activeStroke });
            } else {
              addPoint(activeStroke, pagePoint);
            }
          } else if (g.kind === 'erase') {
            finishStroke();
            useStore.getState().eraseAt(page, palmPage, 18);
          } else {
            finishStroke();
          }

          if (g.swipe) {
            const s = useStore.getState();
            s.setCurrentPage(s.currentPage + (g.swipe === 'next' ? 1 : -1));
            onGesture?.(`swipe-${g.swipe}`);
          }
          if (g.pauseTriggered) {
            onGesture?.('pause');
            stop();
          }

          useStore.setState({
            handCursor: {
              x: g.kind === 'erase' ? palmPage.x : pagePoint.x,
              y: g.kind === 'erase' ? palmPage.y : pagePoint.y,
              kind: g.kind,
            },
          });
        },
        (measuredFps) => {
          setTracking({ fps: Math.round(measuredFps) });
          // Adaptive quality: halve detection rate when FPS drops.
          adaptiveSkip = measuredFps < 20 ? 2 : 1;
        },
      );
      stopLoopRef.current = stopLoop;
      setTracking({ active: true });
    } catch (err) {
      if (err instanceof CameraError) setError(t(CAMERA_ERROR_MESSAGE_KEY[err.kind]));
      else setError(t('camera.unsupported'));
      stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, pageSize, stop, setTracking, onGesture]);

  // Let the permission dialog trigger tracking.
  useEffect(() => registerTrackingStarter(start), [start]);

  // Privacy: stop the stream when the page is hidden.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stop]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stop();
      void closeHandLandmarker();
    };
  }, [stop]);

  const drawOverlay = (video: HTMLVideoElement, landmarks: { x: number; y: number }[] | null) => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const w = video.videoWidth || 320;
    const h = video.videoHeight || 240;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!landmarks) return;
    const mirrored = settings.mirrored;
    const px = (x: number) => (mirrored ? 1 - x : x) * w;
    const py = (y: number) => y * h;
    const connections: [number, number][] = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [0, 5],
      [5, 6],
      [6, 7],
      [7, 8],
      [5, 9],
      [9, 10],
      [10, 11],
      [11, 12],
      [9, 13],
      [13, 14],
      [14, 15],
      [15, 16],
      [13, 17],
      [17, 18],
      [18, 19],
      [19, 20],
      [0, 17],
    ];
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a, b] of connections) {
      const pa = landmarks[a];
      const pb = landmarks[b];
      if (!pa || !pb) continue;
      ctx.moveTo(px(pa.x), py(pa.y));
      ctx.lineTo(px(pb.x), py(pb.y));
    }
    ctx.stroke();
    ctx.fillStyle = '#22c55e';
    for (const lm of landmarks) {
      ctx.beginPath();
      ctx.arc(px(lm.x), py(lm.y), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  return (
    <div className={`camera-panel ${collapsed ? 'collapsed' : ''}`} aria-label="Camera preview">
      <button
        type="button"
        className="camera-collapse"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-label={t(collapsed ? 'camera.expand' : 'camera.collapse')}
      >
        📷 {t('toolbar.camera')}
      </button>
      <div className="camera-video-wrap">
        <video
          ref={videoRef}
          className="camera-video"
          playsInline
          muted
          aria-label="Camera preview"
          style={{ transform: settings.mirrored ? 'scaleX(-1)' : undefined }}
        />
        <canvas ref={overlayRef} className="camera-overlay" aria-hidden="true" />
        {active && (
          <span className="camera-live" role="status">
            ● {t('camera.fps', { fps })}
          </span>
        )}
      </div>
      <div className="camera-controls">
        <button
          type="button"
          onClick={() => (active ? stop() : void start())}
          aria-pressed={active}
        >
          {active ? t('camera.stop') : t('camera.start')}
        </button>
        <label>
          {t('settings.camera')}
          <select
            value={settings.cameraId ?? ''}
            onChange={(e) =>
              useStore.getState().updateSettings({ cameraId: e.target.value || null })
            }
            aria-label={t('settings.camera')}
          >
            <option value="">{t('settings.auto')}</option>
            {cameras.map((c) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.mirrored}
            onChange={(e) => useStore.getState().updateSettings({ mirrored: e.target.checked })}
          />
          {t('camera.mirrored')}
        </label>
      </div>
      {error && (
        <p className="camera-error" role="alert">
          {error}
        </p>
      )}
      {modelMissing && (
        <p className="camera-error" role="alert">
          {t('camera.modelMissing')}
        </p>
      )}
      {hint && (
        <p className="camera-hint" role="status">
          {t(
            hint === 'too-far'
              ? 'camera.hintTooFar'
              : hint === 'too-close'
                ? 'camera.hintTooClose'
                : hint === 'out-of-frame'
                  ? 'camera.hintOutOfFrame'
                  : 'camera.hintLowLight',
          )}
        </p>
      )}
      <p className="camera-privacy">{t('camera.privacy')}</p>
    </div>
  );
}
