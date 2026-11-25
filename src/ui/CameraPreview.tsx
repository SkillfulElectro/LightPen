/**
 * Camera preview + high-FPS hybrid CPU+GPU hand-tracking loop.
 * - Hybrid CPU + GPU acceleration via MediaPipe high-performance WebGL2 GPU
 *   delegate paired with multi-core CPU preprocessing & InferenceLoadBalancer.
 * - Eliminates main-thread stalls: skips DOM `elementFromPoint` reflows while
 *   actively writing ink, gates tutorial gesture notifications on `tutorialOpen`,
 *   and deduplicates tracking store updates.
 * - Runtime GPU -> CPU automatic failover on thrown errors, silent zero-hand
 *   streams, or sustained GPU latency spikes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AirTouchEventBridge,
  normalizedToViewport,
  resolveAirCursorStyle,
} from '../core/airTouchSimulator';
import { addPoint, createStroke } from '../core/annotations';
import { videoWrapClass } from '../core/cameraDom';
import { InferenceLoadBalancer } from '../core/computeBackend';
import {
  cameraToPage,
  clampToPage,
  frameBrightness,
  isLowLight,
  trackingHint,
} from '../core/coords';
import { GestureClassifier } from '../core/gesture';
import { OneEuroPoint } from '../core/oneEuro';
import { DEFAULT_TOUCH_CONFIG, TouchGestureClassifier } from '../core/touchGestures';
import {
  diagnoseTracker,
  diagnosticText,
  longHandAbsence,
  TRACKER_FAILURE_MESSAGE_KEY,
  type TrackerFailure,
} from '../core/trackerHealth';
import type { GestureKind, PageSize, Stroke } from '../core/types';
import {
  CAMERA_ERROR_MESSAGE_KEY,
  CameraError,
  listCameras,
  runFrameLoop,
  startCamera,
  stopCamera,
  waitForVideoFrames,
  type CameraDevice,
} from '../platform/camera';
import {
  closeHandLandmarker,
  detectHand,
  fallbackToCpuLandmarker,
  getActiveBackendLabel,
  getActiveDelegate,
  getHandLandmarker,
  hasDetectedHand,
  resetDetectionSession,
  setInferenceInputWidth,
} from '../platform/mediapipe';
import { useStore } from '../store/useStore';
import { CameraIcon, CpuIcon } from './Icons';
import {
  publishCameraStream,
  publishCameraVideo,
  publishLiveFrame,
  publishTrackerStatus,
  registerTrackingStarter,
} from './trackingHandle';

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
  const startingRef = useRef(false);
  const pageSizeRef = useRef<PageSize>(pageSize);
  pageSizeRef.current = pageSize;

  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modelMissing, setModelMissing] = useState(false);
  const [failure, setFailure] = useState<TrackerFailure | null>(null);
  const [failureDetail, setFailureDetail] = useState<string | null>(null);

  const updateSettings = useStore((s) => s.updateSettings);
  const active = useStore((s) => s.tracking.active);
  const fps = useStore((s) => s.tracking.fps);
  const backend = useStore((s) => s.tracking.backend);
  const hint = useStore((s) => s.tracking.hint);
  const settings = useStore((s) => s.settings);
  const collapsed = !settings.showPreview;
  const setTracking = useStore((s) => s.setTracking);

  const refreshCameras = useCallback(async () => {
    setCameras(await listCameras());
  }, []);

  useEffect(() => {
    void refreshCameras();
  }, [refreshCameras]);

  const stop = useCallback(
    (preserveErrorStatus = false) => {
      setFailure(null);
      setFailureDetail(null);
      stopLoopRef.current?.();
      stopLoopRef.current = null;
      stopCamera(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      publishCameraStream(null);
      publishCameraVideo(null);
      if (!preserveErrorStatus) {
        publishTrackerStatus({ phase: 'idle', error: null, detail: null, fps: 0 });
      }
      publishLiveFrame({
        landmarks: null,
        mirrored: useStore.getState().settings.mirrored,
        gestureKind: 'none',
        pinchDistance: 1,
        handPresent: false,
        indexTip: null,
        contact: false,
        holdProgress: 0,
      });
      useStore.setState({ handCursor: null, airCursor: null, activeStroke: null });
      setTracking({ active: false, fps: 0, handPresent: false, hint: null });
    },
    [setTracking],
  );

  const start = useCallback(async () => {
    if (startingRef.current || streamRef.current) return;
    startingRef.current = true;
    setError(null);
    setModelMissing(false);
    setFailure(null);
    setFailureDetail(null);
    publishTrackerStatus({ phase: 'starting', error: null, detail: null, fps: 0 });
    resetDetectionSession();
    try {
      const initialSettings = useStore.getState().settings;
      const stream = await startCamera(initialSettings.cameraId);
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new CameraError('unknown', 'Video element missing.');
      video.srcObject = stream;
      publishCameraVideo(video);
      publishCameraStream(stream);
      await video.play();
      await waitForVideoFrames(video, 4000);
      await refreshCameras();

      publishTrackerStatus({ phase: 'loading-model', error: null, detail: null });
      let landmarker: Awaited<ReturnType<typeof getHandLandmarker>>;
      try {
        landmarker = await getHandLandmarker(
          initialSettings.computeBackend,
          initialSettings.dominantHand,
        );
      } catch (err) {
        const msg = t('camera.modelMissing');
        const detail = err instanceof Error ? err.message : String(err);
        setModelMissing(true);
        publishTrackerStatus({ phase: 'error', error: msg, detail, fps: 0 });
        stop(true);
        return;
      }

      setTracking({ backend: getActiveBackendLabel() });

      let classifier = new GestureClassifier({
        pinchThreshold: initialSettings.pinchThreshold,
        pinchReleaseThreshold: initialSettings.pinchReleaseThreshold,
        enableErase: initialSettings.enableErase,
        enablePageSwipe: initialSettings.enablePageSwipe,
        enablePauseFist: initialSettings.enablePauseFist,
      });
      let touch = new TouchGestureClassifier({
        ...DEFAULT_TOUCH_CONFIG,
        tapThreshold: initialSettings.pinchThreshold,
        releaseThreshold: initialSettings.pinchReleaseThreshold,
        zoomSensitivity: initialSettings.zoomSensitivity,
      });
      let smoother = new OneEuroPoint({
        minCutoff: initialSettings.smoothingMinCutoff,
        beta: initialSettings.smoothingBeta,
        dCutoff: initialSettings.smoothingDCutoff,
      });
      const loadBalancer = new InferenceLoadBalancer(512);
      let lastThresholdKey = `${initialSettings.pinchThreshold}:${initialSettings.pinchReleaseThreshold}:${initialSettings.enableErase}:${initialSettings.enablePageSwipe}:${initialSettings.enablePauseFist}:${initialSettings.zoomSensitivity}`;
      let lastSmoothKey = `${initialSettings.smoothingMinCutoff}:${initialSettings.smoothingBeta}:${initialSettings.smoothingDCutoff}`;
      let lastBackendKey = `${initialSettings.computeBackend}:${initialSettings.dominantHand}`;

      const airBridge = new AirTouchEventBridge();
      let lastHoverX = -9999;
      let lastHoverY = -9999;
      let lastInteractive: HTMLElement | null = null;
      let tapPulseSeq = 0;
      let activeStroke: Stroke | null = null;
      let switchingBackend = false;
      let triedSilentCpuFallback = false;
      let scrollAccum = 0;
      const lightCanvas = document.createElement('canvas');
      lightCanvas.width = 48;
      lightCanvas.height = 36;
      const lightCtx = lightCanvas.getContext('2d', { willReadFrequently: true });
      let lowLight = false;
      let lastLightCheck = 0;
      let lostFrames = 0;
      let skipNextFrame = false;

      const finishStroke = () => {
        if (activeStroke && activeStroke.points.length > 0) {
          useStore.getState().addStroke(activeStroke);
        }
        activeStroke = null;
        useStore.setState({ activeStroke: null });
      };

      let detectorErrors = 0;
      let consecutiveErrors = 0;
      let fps = 0;
      let reportedFailure: TrackerFailure | null = null;
      const healthGraceMs = 2500;
      const loopStartedAt = performance.now();

      const triggerCpuFallback = () => {
        if (getActiveDelegate() !== 'GPU' || switchingBackend) return;
        switchingBackend = true;
        void fallbackToCpuLandmarker()
          .then((cpuLm) => {
            landmarker = cpuLm;
            consecutiveErrors = 0;
            loadBalancer.reset(384);
            setTracking({ backend: getActiveBackendLabel() });
          })
          .catch(() => {
            // Keep existing landmarker if CPU init fails; health check will report it.
          })
          .finally(() => {
            switchingBackend = false;
          });
      };

      const reportHealth = () => {
        if (performance.now() - loopStartedAt < healthGraceMs) return;
        const sample = {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          readyState: video.readyState,
          fps,
          lostFrames,
          detectorErrors,
        };
        const diagnosis = diagnoseTracker(sample) ?? longHandAbsence(sample);
        const next = diagnosis ? diagnosis.failure : null;
        if (next === reportedFailure) return;
        reportedFailure = next;
        setFailure(next);
        const detail = diagnosis ? diagnosticText(diagnosis, navigator.userAgent) : null;
        setFailureDetail(detail);
        if (next) {
          publishTrackerStatus({
            phase: next === 'no-hand' ? 'running' : 'error',
            error: t(TRACKER_FAILURE_MESSAGE_KEY[next]),
            detail,
          });
        } else {
          publishTrackerStatus({ phase: 'running', error: null, detail: null });
        }
      };

      const stopLoop = runFrameLoop(
        video,
        (nowMs) => {
          if (skipNextFrame) {
            skipNextFrame = false;
            return;
          }

          const liveState = useStore.getState();
          const liveSettings = liveState.settings;
          const liveTool = liveState.tool;
          const livePageSize = pageSizeRef.current;

          // Hot-switch CPU+GPU / GPU / CPU backend if user changes Settings while running.
          const bKey = `${liveSettings.computeBackend}:${liveSettings.dominantHand}`;
          if (bKey !== lastBackendKey && !switchingBackend) {
            lastBackendKey = bKey;
            switchingBackend = true;
            void getHandLandmarker(liveSettings.computeBackend, liveSettings.dominantHand)
              .then((nextLm) => {
                landmarker = nextLm;
                consecutiveErrors = 0;
                loadBalancer.reset(512);
                setTracking({ backend: getActiveBackendLabel() });
              })
              .catch(() => {
                // Retain previous landmarker on switch failure.
              })
              .finally(() => {
                switchingBackend = false;
              });
          }

          // Hot-sync classifier & smoother whenever the user adjusts sliders live.
          const tKey = `${liveSettings.pinchThreshold}:${liveSettings.pinchReleaseThreshold}:${liveSettings.enableErase}:${liveSettings.enablePageSwipe}:${liveSettings.enablePauseFist}:${liveSettings.zoomSensitivity}`;
          if (tKey !== lastThresholdKey) {
            lastThresholdKey = tKey;
            classifier = new GestureClassifier({
              pinchThreshold: liveSettings.pinchThreshold,
              pinchReleaseThreshold: liveSettings.pinchReleaseThreshold,
              enableErase: liveSettings.enableErase,
              enablePageSwipe: liveSettings.enablePageSwipe,
              enablePauseFist: liveSettings.enablePauseFist,
            });
            touch = new TouchGestureClassifier({
              ...DEFAULT_TOUCH_CONFIG,
              tapThreshold: liveSettings.pinchThreshold,
              releaseThreshold: liveSettings.pinchReleaseThreshold,
              zoomSensitivity: liveSettings.zoomSensitivity,
            });
          }
          const sKey = `${liveSettings.smoothingMinCutoff}:${liveSettings.smoothingBeta}:${liveSettings.smoothingDCutoff}`;
          if (sKey !== lastSmoothKey) {
            lastSmoothKey = sKey;
            smoother = new OneEuroPoint({
              minCutoff: liveSettings.smoothingMinCutoff,
              beta: liveSettings.smoothingBeta,
              dCutoff: liveSettings.smoothingDCutoff,
            });
          }

          let result;
          const t0 = performance.now();
          try {
            result = detectHand(
              landmarker,
              video,
              nowMs,
              liveSettings.dominantHand,
              liveSettings.mirrored,
            );
            consecutiveErrors = 0;
          } catch {
            detectorErrors += 1;
            consecutiveErrors += 1;
            if (!liveSettings.showPreview) {
              // Skip skeleton canvas work when self-view is hidden.
            } else {
              drawOverlay(video, null, liveSettings.mirrored);
            }
            // Automatic GPU -> CPU recovery if GPU WebGL delegate fails at runtime.
            if (consecutiveErrors === 3) triggerCpuFallback();
            if (consecutiveErrors === 15) reportHealth();
            return;
          }
          const inferMs = performance.now() - t0;

          // Hybrid CPU+GPU adaptive resolution & failover balancer.
          const balance = loadBalancer.record(
            inferMs,
            getActiveDelegate(),
            liveSettings.computeBackend === 'hybrid',
          );
          setInferenceInputWidth(balance.inputWidth);
          skipNextFrame = balance.skipNextFrame;
          if (balance.shouldFallbackToCpu) {
            triggerCpuFallback();
          }

          if (liveSettings.showPreview) {
            drawOverlay(video, result?.landmarks ?? null, liveSettings.mirrored);
          }

          if (!result) {
            lostFrames += 1;
            scrollAccum = 0;
            if (
              !triedSilentCpuFallback &&
              !hasDetectedHand() &&
              lostFrames >= 45 &&
              video.videoWidth > 0 &&
              getActiveDelegate() === 'GPU'
            ) {
              triedSilentCpuFallback = true;
              triggerCpuFallback();
            }
            setTracking({ handPresent: false, hint: lostFrames > 30 ? 'out-of-frame' : null });
            if (lostFrames > 8) finishStroke();
            airBridge.clearHover();
            lastInteractive = null;
            useStore.setState({ handCursor: null, airCursor: null });
            publishLiveFrame({
              landmarks: null,
              mirrored: liveSettings.mirrored,
              gestureKind: 'none',
              pinchDistance: 1,
              handPresent: false,
              indexTip: null,
              contact: false,
              holdProgress: 0,
            });
            return;
          }

          lostFrames = 0;
          // Sample brightness infrequently (every 1.2s) to keep CPU hot path lean.
          if (lightCtx && nowMs - lastLightCheck > 1200) {
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

          const page = liveState.currentPage;
          const tutorialOpen = liveState.tutorialOpen;
          const emitTutorialGesture = (kind: string) => {
            if (tutorialOpen) onGesture?.(kind);
          };

          const updateAirCursor = (
            normPt: { x: number; y: number },
            gestureKind: GestureKind,
            holdProgress = 0,
            didTap = false,
          ) => {
            const vp = normalizedToViewport(
              normPt,
              liveSettings.calibration,
              liveSettings.mirrored,
              window.innerWidth,
              window.innerHeight,
            );
            // Skip DOM hit-testing (`elementFromPoint` forces layout) while writing ink
            // or when pointer moved less than 3px — huge FPS boost!
            const writing = gestureKind === 'pen-down' || gestureKind === 'erase';
            let interactive = lastInteractive;
            if (!writing) {
              if (Math.hypot(vp.x - lastHoverX, vp.y - lastHoverY) >= 3 || didTap) {
                lastHoverX = vp.x;
                lastHoverY = vp.y;
                interactive = airBridge.move(vp.x, vp.y).interactive;
                lastInteractive = interactive;
              }
            } else if (lastInteractive) {
              airBridge.clearHover();
              lastInteractive = null;
              interactive = null;
            }
            if (didTap) {
              tapPulseSeq += 1;
              if (!tutorialOpen) {
                airBridge.tap(vp.x, vp.y);
              }
            }
            const desc = resolveAirCursorStyle(gestureKind, liveTool, interactive !== null);
            useStore.setState({
              airCursor: {
                screenX: vp.x,
                screenY: vp.y,
                normalizedX: normPt.x,
                normalizedY: normPt.y,
                style: desc.style,
                cssCursor: desc.cssCursor,
                label: desc.label,
                color: liveSettings.penColor,
                active:
                  gestureKind === 'pen-down' || gestureKind === 'erase' || gestureKind === 'tap',
                holdProgress,
                tapPulseSeq,
                overInteractive: interactive !== null,
              },
            });
          };

          if (liveSettings.gestureMode === 'touch') {
            const frame = touch.classify(result.landmarks, nowMs);
            const smoothed = smoother.filter(frame.point.x, frame.point.y, nowMs);
            const where = clampToPage(
              cameraToPage(smoothed, liveSettings.calibration, livePageSize, liveSettings.mirrored),
              livePageSize,
            );
            setTracking({
              handPresent: true,
              hint: trackingHint(frame.handSize) ?? (lowLight ? 'low-light' : null),
            });

            let gestureKind: GestureKind = 'hover';
            if (frame.twoFingers) {
              finishStroke();
              if (frame.zoomFactor !== 1) {
                scrollAccum = 0;
                gestureKind = frame.zoomDirection === 'out' ? 'zoom-out' : 'zoom-in';
                if (!tutorialOpen) {
                  useStore.getState().setZoom(useStore.getState().zoom * frame.zoomFactor);
                }
                emitTutorialGesture('zoom');
              } else {
                gestureKind = 'scroll';
                if (Math.abs(frame.scrollDeltaY) > 0.003) {
                  scrollAccum += frame.scrollDeltaY;
                  if (!tutorialOpen) {
                    const vp = normalizedToViewport(
                      smoothed,
                      liveSettings.calibration,
                      liveSettings.mirrored,
                      window.innerWidth,
                      window.innerHeight,
                    );
                    airBridge.scroll(vp.x, vp.y, frame.scrollDeltaY);
                  }
                  if (Math.abs(scrollAccum) >= 0.055) {
                    emitTutorialGesture(scrollAccum > 0 ? 'scroll-next' : 'scroll-prev');
                    scrollAccum = 0;
                  }
                }
                if (frame.pageDelta !== 0) {
                  if (!tutorialOpen) {
                    useStore.getState().setCurrentPage(page + frame.pageDelta);
                  }
                  emitTutorialGesture(frame.pageDelta > 0 ? 'scroll-next' : 'scroll-prev');
                  scrollAccum = 0;
                }
              }
              useStore.setState({ handCursor: { x: where.x, y: where.y, kind: gestureKind } });
              updateAirCursor(smoothed, gestureKind, 0, false);
            } else if (frame.action === 'erase') {
              scrollAccum = 0;
              finishStroke();
              gestureKind = 'erase';
              if (!tutorialOpen) {
                const palmPage = clampToPage(
                  cameraToPage(
                    frame.palmCenter,
                    liveSettings.calibration,
                    livePageSize,
                    liveSettings.mirrored,
                  ),
                  livePageSize,
                );
                useStore.getState().eraseAt(page, palmPage, 22);
                useStore.setState({ handCursor: { x: palmPage.x, y: palmPage.y, kind: 'erase' } });
              }
              emitTutorialGesture('erase');
              updateAirCursor(frame.palmCenter, 'erase', 0, false);
            } else if (frame.action === 'grab') {
              scrollAccum = 0;
              finishStroke();
              gestureKind = 'fist';
              useStore.setState({ handCursor: { x: where.x, y: where.y, kind: 'fist' } });
              updateAirCursor(frame.palmCenter, 'fist', 0, false);
            } else if (frame.contact) {
              scrollAccum = 0;
              const erasing = liveTool === 'eraser';
              gestureKind = erasing ? 'erase' : 'pen-down';
              if (!tutorialOpen) {
                if (erasing) {
                  finishStroke();
                  useStore.getState().eraseAt(page, where, 18);
                } else {
                  if (activeStroke && activeStroke.page !== page) finishStroke();
                  if (!activeStroke) {
                    activeStroke = createStroke(
                      page,
                      liveSettings.penColor,
                      liveSettings.penWidth,
                      where,
                    );
                    useStore.setState({ activeStroke });
                  } else {
                    addPoint(activeStroke, where);
                  }
                }
              }
              emitTutorialGesture(gestureKind);
              useStore.setState({ handCursor: { x: where.x, y: where.y, kind: gestureKind } });
              updateAirCursor(smoothed, gestureKind, frame.holdProgress, false);
              if (frame.action === 'pause') {
                emitTutorialGesture('pause');
                if (!tutorialOpen) {
                  stop();
                  return;
                }
              }
            } else {
              scrollAccum = 0;
              finishStroke();
              gestureKind = frame.tap ? 'tap' : frame.action === 'hover' ? 'hover' : 'none';
              if (frame.tap) emitTutorialGesture('tap');
              else if (gestureKind === 'hover') emitTutorialGesture('hover');
              useStore.setState({ handCursor: { x: where.x, y: where.y, kind: gestureKind } });
              updateAirCursor(smoothed, gestureKind, 0, frame.tap);
            }

            publishLiveFrame({
              landmarks: result.landmarks,
              mirrored: liveSettings.mirrored,
              gestureKind,
              pinchDistance: frame.pinchDistance,
              handPresent: true,
              indexTip: smoothed,
              contact: frame.contact,
              holdProgress: frame.holdProgress,
            });
            return;
          }

          // ---- Air gesture mode ----
          scrollAccum = 0;
          const g = classifier.classify(result.landmarks, nowMs);
          setTracking({
            handPresent: true,
            hint: trackingHint(g.handSize) ?? (lowLight ? 'low-light' : null),
          });
          emitTutorialGesture(g.kind);
          const smoothed = smoother.filter(g.indexTip.x, g.indexTip.y, nowMs);
          const pagePoint = clampToPage(
            cameraToPage(smoothed, liveSettings.calibration, livePageSize, liveSettings.mirrored),
            livePageSize,
          );
          const palmPage = clampToPage(
            cameraToPage(
              g.palmCenter,
              liveSettings.calibration,
              livePageSize,
              liveSettings.mirrored,
            ),
            livePageSize,
          );

          if (activeStroke && activeStroke.page !== page) finishStroke();

          if (!tutorialOpen) {
            if (g.kind === 'pen-down') {
              if (!activeStroke) {
                activeStroke = createStroke(
                  page,
                  liveSettings.penColor,
                  liveSettings.penWidth,
                  pagePoint,
                );
                useStore.setState({ activeStroke });
              } else {
                addPoint(activeStroke, pagePoint);
              }
            } else if (g.kind === 'erase') {
              finishStroke();
              useStore.getState().eraseAt(page, palmPage, 20);
            } else {
              finishStroke();
            }
          }

          if (g.swipe) {
            if (!tutorialOpen) {
              const s = useStore.getState();
              s.setCurrentPage(s.currentPage + (g.swipe === 'next' ? 1 : -1));
            }
            emitTutorialGesture(`swipe-${g.swipe}`);
          }

          if (g.pauseTriggered) {
            emitTutorialGesture('pause');
            if (!tutorialOpen) {
              stop();
              return;
            }
          }

          const cursorNorm = g.kind === 'erase' ? g.palmCenter : smoothed;
          useStore.setState({
            handCursor: {
              x: g.kind === 'erase' ? palmPage.x : pagePoint.x,
              y: g.kind === 'erase' ? palmPage.y : pagePoint.y,
              kind: g.kind,
            },
          });
          updateAirCursor(cursorNorm, g.kind, g.holdProgress, false);

          publishLiveFrame({
            landmarks: result.landmarks,
            mirrored: liveSettings.mirrored,
            gestureKind: g.kind,
            pinchDistance: g.pinchDistance,
            handPresent: true,
            indexTip: smoothed,
            contact: g.kind === 'pen-down',
            holdProgress: g.holdProgress,
          });
        },
        (measuredFps) => {
          fps = measuredFps;
          const rounded = Math.round(measuredFps);
          setTracking({ fps: rounded, backend: getActiveBackendLabel() });
          publishTrackerStatus({ fps: rounded });
          reportHealth();
        },
      );

      stopLoopRef.current = () => {
        airBridge.clearHover();
        stopLoop();
      };
      setTracking({ active: true, backend: getActiveBackendLabel() });
      publishTrackerStatus({ phase: 'running', error: null, detail: null });
    } catch (err) {
      const msg =
        err instanceof CameraError
          ? t(CAMERA_ERROR_MESSAGE_KEY[err.kind])
          : t('camera.unsupported');
      setError(msg);
      publishTrackerStatus({
        phase: 'error',
        error: msg,
        detail: err instanceof Error ? err.message : null,
        fps: 0,
      });
      stop(true);
    } finally {
      startingRef.current = false;
    }
  }, [refreshCameras, stop, setTracking, onGesture, t]);

  useEffect(() => registerTrackingStarter(start), [start]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stop]);

  useEffect(() => {
    return () => {
      stop();
      void closeHandLandmarker();
    };
  }, [stop]);

  const drawOverlay = (
    video: HTMLVideoElement,
    landmarks: { x: number; y: number }[] | null,
    mirrored: boolean,
  ) => {
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
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i]!;
      ctx.beginPath();
      ctx.arc(px(lm.x), py(lm.y), i === 8 || i === 4 ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = i === 8 ? '#e11d48' : i === 4 ? '#f59e0b' : '#22c55e';
      ctx.fill();
    }
  };

  return (
    <div className={`camera-panel ${collapsed ? 'collapsed' : ''}`} aria-label="Camera preview">
      <div className="camera-header">
        <button
          type="button"
          className="camera-collapse"
          onClick={() => updateSettings({ showPreview: collapsed })}
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? 'camera.expand' : 'camera.collapse')}
        >
          <CameraIcon />
          <span>{t('toolbar.camera')}</span>
        </button>
        {active && (
          <span className="camera-live-badge" role="status">
            <CpuIcon />
            <span>
              {t('camera.fps', { fps })} · {backend}
            </span>
          </span>
        )}
      </div>

      <div className={videoWrapClass(collapsed)}>
        <video
          ref={videoRef}
          className="camera-video"
          playsInline
          muted
          aria-label="Camera preview"
          style={{ transform: settings.mirrored ? 'scaleX(-1)' : undefined }}
        />
        <canvas ref={overlayRef} className="camera-overlay" aria-hidden="true" />
      </div>

      <div className="camera-controls">
        <button
          type="button"
          className={active ? 'btn-stop' : 'btn-primary'}
          onClick={() => (active ? stop() : void start())}
          aria-pressed={active}
        >
          {active ? t('camera.stop') : t('camera.start')}
        </button>

        <label className="field-label">
          <span>{t('settings.camera')}</span>
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
          <span>{t('camera.mirrored')}</span>
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
      {failure && (
        <div className="camera-error" role="alert">
          <p>{t(TRACKER_FAILURE_MESSAGE_KEY[failure])}</p>
          {failureDetail && <p className="camera-diagnostic">{failureDetail}</p>}
        </div>
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
