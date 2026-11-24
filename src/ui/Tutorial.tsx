/**
 * First-run interactive tutorial with live Face & Hand Camera Stage and
 * customizable tutorial pace (Guided / Normal / Quick).
 *
 * Renders the camera preview by drawing from CameraPreview's single active
 * `<video>` element onto a canvas (instead of attaching the same MediaStream
 * to a second `<video>`), avoiding WebKitGTK/GStreamer decoder starvation and
 * keeping the 21-point hand skeleton pixel-aligned with the video frame.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clamp, FULL_FRAME_CALIBRATION } from '../core/coords';
import type { TutorialPace } from '../core/types';
import { useStore } from '../store/useStore';
import { DistanceIllustration, PlacementIllustration } from './illustrations';
import {
  getCameraStream,
  getCameraVideo,
  getTrackerStatus,
  startTracking,
  subscribeCameraStream,
  subscribeLiveFrame,
  subscribeTrackerStatus,
  type LiveCameraFrame,
  type TrackerStatus,
} from './trackingHandle';

type Exercise =
  'hover' | 'write' | 'erase' | 'swipe' | 'pause' | 'tap' | 'scroll' | 'zoom' | 'longPress';

const EXERCISES_AIR: Exercise[] = ['hover', 'write', 'erase', 'swipe', 'pause'];
const EXERCISES_TOUCH: Exercise[] = ['write', 'tap', 'scroll', 'zoom', 'longPress'];
const INTRO_STEPS = 4;

const PACE_ADVANCE_MS: Record<TutorialPace, number> = {
  guided: 1600,
  normal: 950,
  quick: 450,
};

const HAND_LINKS: [number, number][] = [
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

/** Match a live tracker gesture name against the active tutorial exercise. */
function matchesTutorialExercise(exercise: Exercise, kind: string): boolean {
  return (
    (exercise === 'write' && (kind === 'pen-down' || kind === 'tap')) ||
    (exercise === 'hover' && kind === 'hover') ||
    (exercise === 'erase' && kind === 'erase') ||
    (exercise === 'swipe' && kind.startsWith('swipe-')) ||
    (exercise === 'pause' && kind === 'pause') ||
    (exercise === 'tap' && kind === 'tap') ||
    (exercise === 'scroll' && (kind === 'scroll' || kind.startsWith('scroll-'))) ||
    (exercise === 'zoom' && (kind === 'zoom' || kind === 'zoom-in' || kind === 'zoom-out')) ||
    (exercise === 'longPress' && kind === 'pause')
  );
}

export default function Tutorial() {
  const { t } = useTranslation();
  const open = useStore((s) => s.tutorialOpen);
  const setOpen = useStore((s) => s.setTutorialOpen);
  const startStep = useStore((s) => s.tutorialStartStep);
  const pace = useStore((s) => s.tutorialPace);
  const setPace = useStore((s) => s.setTutorialPace);

  const [step, setStep] = useState(0);
  const [done, setDone] = useState<Set<Exercise>>(new Set());
  const [calRect, setCalRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  const sandboxRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<{ pts: { x: number; y: number }[]; color: string }[]>([]);
  const drawingRef = useRef(false);
  const airDrawingRef = useRef(false);
  const pointerDownAtRef = useRef<number>(0);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerMaxMoveRef = useRef<number>(0);
  const stillSinceRef = useRef<number | null>(null);
  const stepEnteredSeqRef = useRef<number>(0);
  const [sandboxMode, setSandboxMode] = useState<'pen' | 'eraser'>('pen');
  const [sandboxMsg, setSandboxMsg] = useState('');
  const lastGesture = useStore((s) => s.lastGesture);
  const gestureMode = useStore((s) => s.settings.gestureMode);
  const mirrored = useStore((s) => s.settings.mirrored);
  const exercises = gestureMode === 'touch' ? EXERCISES_TOUCH : EXERCISES_AIR;
  const totalSteps = INTRO_STEPS + exercises.length + 1;

  useEffect(() => {
    if (open) {
      setStep(startStep);
      setDone(new Set());
      strokesRef.current = [];
      stepEnteredSeqRef.current = useStore.getState().lastGesture.seq;
    }
  }, [open, startStep]);

  // Ignore stale gestures emitted before entering a new practice step.
  useEffect(() => {
    stepEnteredSeqRef.current = useStore.getState().lastGesture.seq;
  }, [step]);

  const drawSandbox = useCallback((cursor?: { x: number; y: number; active: boolean }) => {
    const canvas = sandboxRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokesRef.current) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      s.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
    if (cursor) {
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, cursor.active ? 6 : 9, 0, Math.PI * 2);
      ctx.fillStyle = cursor.active ? '#e11d48' : 'rgba(37, 99, 235, 0.25)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = cursor.active ? '#ffffff' : '#2563eb';
      ctx.stroke();
    }
  }, []);

  const markDone = useCallback(
    (ex: Exercise) => {
      setDone((prev) => {
        if (prev.has(ex)) return prev;
        const next = new Set(prev);
        next.add(ex);
        return next;
      });
      setSandboxMsg(t('tutorial.success'));
    },
    [t],
  );

  // Live feedback from real air gestures in practice steps.
  useEffect(() => {
    if (!open || step < INTRO_STEPS || step >= INTRO_STEPS + exercises.length) return;
    if (lastGesture.seq <= stepEnteredSeqRef.current) return;
    const current = exercises[step - INTRO_STEPS];
    if (!current) return;
    if (matchesTutorialExercise(current, lastGesture.kind)) {
      markDone(current);
    }
  }, [lastGesture.seq, lastGesture.kind, open, step, exercises, markDone]);

  // Pipe live camera hand coordinates into the practice sandbox canvas so the user
  // sees their real air handwriting right inside the tutorial.
  useEffect(() => {
    if (!open || step < INTRO_STEPS || step >= INTRO_STEPS + exercises.length) return;
    return subscribeLiveFrame((frame) => {
      const canvas = sandboxRef.current;
      if (!canvas || !frame.handPresent || !frame.indexTip) {
        airDrawingRef.current = false;
        drawSandbox();
        return;
      }
      const cal = useStore.getState().settings.calibration ?? FULL_FRAME_CALIBRATION;
      const cw = Math.max(cal.x1 - cal.x0, 1e-6);
      const ch = Math.max(cal.y1 - cal.y0, 1e-6);
      let nx = (frame.indexTip.x - cal.x0) / cw;
      const ny = clamp((frame.indexTip.y - cal.y0) / ch, 0, 1);
      if (frame.mirrored) nx = 1 - nx;
      nx = clamp(nx, 0, 1);
      const x = nx * canvas.width;
      const y = ny * canvas.height;
      if (frame.contact || frame.gestureKind === 'pen-down') {
        if (!airDrawingRef.current) {
          strokesRef.current.push({ pts: [{ x, y }], color: '#e11d48' });
          airDrawingRef.current = true;
        } else {
          const cur = strokesRef.current[strokesRef.current.length - 1];
          const last = cur?.pts[cur.pts.length - 1];
          if (cur && last && Math.hypot(x - last.x, y - last.y) > 2) {
            cur.pts.push({ x, y });
          }
        }
      } else {
        airDrawingRef.current = false;
        if (frame.gestureKind === 'erase' && strokesRef.current.length > 0) {
          strokesRef.current = strokesRef.current.filter(
            (s) => !s.pts.some((pt) => Math.hypot(pt.x - x, pt.y - y) < 28),
          );
        }
      }
      drawSandbox({ x, y, active: frame.contact || frame.gestureKind === 'pen-down' });
    });
  }, [open, step, exercises.length, drawSandbox]);

  // Pace-driven auto-advance when a practice step completes in normal/quick mode.
  const currentExercise =
    step >= INTRO_STEPS && step < INTRO_STEPS + exercises.length
      ? exercises[step - INTRO_STEPS]
      : null;

  useEffect(() => {
    if (!open || !currentExercise || !done.has(currentExercise)) return;
    if (pace === 'guided') return; // Guided pace waits for user to press Next.
    const timer = setTimeout(() => {
      setStep((s) => Math.min(s + 1, totalSteps - 1));
    }, PACE_ADVANCE_MS[pace]);
    return () => clearTimeout(timer);
  }, [open, currentExercise, done, pace, totalSteps]);

  if (!open) return null;
  const exercise = currentExercise;
  const isPractice = exercise !== null;

  const sandboxPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = sandboxRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!canvas || !rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startHoldTimer = (targetExercise: Exercise) => {
    stillSinceRef.current = performance.now();
    const check = () => {
      if (stillSinceRef.current && performance.now() - stillSinceRef.current >= 950) {
        stillSinceRef.current = null;
        markDone(targetExercise);
      } else if (stillSinceRef.current) {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);
  };

  const onSandboxDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drawingRef.current = true;
    stillSinceRef.current = null;
    const p = sandboxPos(e);
    pointerDownAtRef.current = performance.now();
    pointerStartRef.current = p;
    pointerMaxMoveRef.current = 0;

    if (exercise === 'pause' || exercise === 'longPress') {
      startHoldTimer(exercise);
    }

    if (sandboxMode === 'pen') {
      strokesRef.current.push({ pts: [p], color: '#e11d48' });
      if (exercise === 'write') markDone('write');
    } else if (exercise === 'erase') {
      if (strokesRef.current.length > 0) {
        strokesRef.current = strokesRef.current.filter(
          (s) => !s.pts.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < 28),
        );
      }
      markDone('erase');
    }
    drawSandbox();
  };

  const onSandboxMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = sandboxPos(e);
    if (exercise === 'hover') {
      markDone('hover');
    }
    if (!drawingRef.current) return;

    if (pointerStartRef.current) {
      const moved = Math.hypot(p.x - pointerStartRef.current.x, p.y - pointerStartRef.current.y);
      pointerMaxMoveRef.current = Math.max(pointerMaxMoveRef.current, moved);
      if (moved > 18) stillSinceRef.current = null;
      if (exercise === 'scroll' && Math.abs(p.y - pointerStartRef.current.y) > 48) {
        markDone('scroll');
      }
    }

    if (sandboxMode === 'eraser') {
      const before = strokesRef.current.length;
      strokesRef.current = strokesRef.current.filter(
        (s) => !s.pts.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < 28),
      );
      if (exercise === 'erase' && (strokesRef.current.length < before || before === 0)) {
        markDone('erase');
      }
      drawSandbox();
      return;
    }

    const cur = strokesRef.current[strokesRef.current.length - 1];
    if (cur) {
      const last = cur.pts[cur.pts.length - 1];
      if (last && Math.hypot(last.x - p.x, last.y - p.y) > 2) {
        cur.pts.push(p);
        if (exercise === 'swipe' && cur.pts.length > 4) {
          const first = cur.pts[0]!;
          if (Math.abs(p.x - first.x) > 100 && Math.abs(p.y - first.y) < 50) markDone('swipe');
        }
      }
      drawSandbox();
    }
  };

  const onSandboxUp = () => {
    drawingRef.current = false;
    const elapsed = performance.now() - pointerDownAtRef.current;
    if (exercise === 'tap' && elapsed <= 500 && pointerMaxMoveRef.current < 18) {
      markDone('tap');
    }
    if (exercise === 'pause' || exercise === 'longPress') {
      startHoldTimer(exercise);
    }
  };

  const onSandboxWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (exercise === 'zoom') {
      e.preventDefault();
      markDone('zoom');
    } else if (exercise === 'scroll') {
      e.preventDefault();
      markDone('scroll');
    }
  };

  const onSandboxLeave = () => {
    stillSinceRef.current = null;
  };

  const next = () => {
    if (step >= totalSteps - 1) setOpen(false);
    else setStep(step + 1);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal tutorial-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('tutorial.title')}
      >
        <div className="modal-header">
          <h2>{t('tutorial.title')}</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label={t('tutorial.skip')}>
            ✕
          </button>
        </div>

        <div className="tutorial-pace-bar">
          <p className="step-label">
            {t('tutorial.stepOf', { current: step + 1, total: totalSteps })}
          </p>
          <div className="pace-selector" role="group" aria-label={t('tutorial.paceLabel')}>
            {(['guided', 'normal', 'quick'] as TutorialPace[]).map((p) => (
              <button
                key={p}
                type="button"
                className={pace === p ? 'active' : ''}
                onClick={() => setPace(p)}
              >
                {t(`tutorial.pace${p.charAt(0).toUpperCase()}${p.slice(1)}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-body">
          {step === 0 && (
            <>
              <p>{t('tutorial.welcome')}</p>
              <p className="privacy-note">{t('tutorial.privacy')}</p>
            </>
          )}
          {step === 1 && (
            <>
              <p>{t('tutorial.permission')}</p>
              <p className="privacy-note">{t('tutorial.privacy')}</p>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  useStore.getState().updateSettings({ showPreview: true });
                  void startTracking();
                  setStep(Math.min(2, totalSteps - 1));
                }}
              >
                {t('camera.allow')}
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <p>{t('tutorial.placement')}</p>
              <TutorialCameraStage showFaceGuide mirrored={mirrored} />
              <PlacementIllustration label={t('tutorial.placementArt')} />
              <ul className="art-captions">
                <li className="ok">✓ {t('tutorial.placementGood')}</li>
                <li className="bad">✕ {t('tutorial.placementBad')}</li>
              </ul>
              <DistanceIllustration label={t('tutorial.placementDistanceArt')} />
              <p className="art-caption">{t('tutorial.placementDistance')}</p>
            </>
          )}
          {step === 3 && (
            <>
              <p>{t('tutorial.calibration')}</p>
              <p className="sandbox-hint">{t('tutorial.calibrationHint')}</p>
              <CalibrationBox rect={calRect} onChange={setCalRect} mirrored={mirrored} />
              {!calRect && <p className="sandbox-hint">{t('tutorial.calibrationUnset')}</p>}
            </>
          )}
          {isPractice && exercise && (
            <>
              <p>
                {t('tutorial.practice', {
                  exercise: t(`tutorial.ex${exercise.charAt(0).toUpperCase()}${exercise.slice(1)}`),
                })}
              </p>
              <TutorialCameraStage showFaceGuide compact mirrored={mirrored} />
              <div className="sandbox-tools">
                <button
                  type="button"
                  className={sandboxMode === 'pen' ? 'active' : ''}
                  onClick={() => setSandboxMode('pen')}
                >
                  🖊
                </button>
                <button
                  type="button"
                  className={sandboxMode === 'eraser' ? 'active' : ''}
                  onClick={() => setSandboxMode('eraser')}
                >
                  🧽
                </button>
                {done.has(exercise) && <span className="sandbox-success">✓ {sandboxMsg}</span>}
              </div>
              <canvas
                ref={sandboxRef}
                className="sandbox-canvas"
                width={480}
                height={260}
                onPointerDown={onSandboxDown}
                onPointerMove={onSandboxMove}
                onPointerUp={onSandboxUp}
                onPointerLeave={onSandboxLeave}
                onWheel={onSandboxWheel}
                style={{ touchAction: 'none' }}
                aria-label="Practice area"
              />
              <p className="sandbox-hint">
                {gestureMode === 'touch' ? (
                  <>{t('tutorial.practiceTouchHint')}</>
                ) : (
                  <>
                    {t('gestures.penDown')} · {t('gestures.erase')} · {t('gestures.swipe')} ·{' '}
                    {t('gestures.pause')}
                  </>
                )}
              </p>
            </>
          )}
          {step === totalSteps - 1 && (
            <>
              <p>{gestureMode === 'touch' ? t('tutorial.doneTouch') : t('tutorial.done')}</p>
              <ul className="cheat-list">
                {gestureMode === 'touch' ? (
                  <>
                    <li>☝️ {t('gestures.touchPoint')}</li>
                    <li>🤏 {t('gestures.touchDrag')}</li>
                    <li>⚡ {t('gestures.touchTap')}</li>
                    <li>✌️ {t('gestures.touchScroll')}</li>
                    <li>🤏 {t('gestures.touchZoom')}</li>
                    <li>✊ {t('gestures.touchLongPress')}</li>
                  </>
                ) : (
                  <>
                    <li>✌️ {t('gestures.penDown')}</li>
                    <li>👉 {t('gestures.hover')}</li>
                    <li>🖐️ {t('gestures.erase')}</li>
                    <li>👋 {t('gestures.swipe')}</li>
                    <li>✊ {t('gestures.pause')}</li>
                  </>
                )}
              </ul>
            </>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={() => setOpen(false)}>
            {t('tutorial.skip')}
          </button>
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)}>
              {t('tutorial.back')}
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              if (step === 3 && calRect) {
                useStore.getState().updateSettings({ calibration: calRect });
              }
              next();
            }}
          >
            {step === totalSteps - 1 ? t('tutorial.finish') : t('tutorial.next')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Draw the live video frame + aligned 21-point hand skeleton onto a single canvas. */
function drawVideoWithLandmarks(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement | null,
  frame: LiveCameraFrame | null,
  mirrored: boolean,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cw = canvas.width;
  const ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, cw, ch);

  let dx = 0;
  let dy = 0;
  let dw = cw;
  let dh = ch;

  if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    const scale = Math.min(cw / video.videoWidth, ch / video.videoHeight);
    dw = video.videoWidth * scale;
    dh = video.videoHeight * scale;
    dx = (cw - dw) / 2;
    dy = (ch - dh) / 2;

    ctx.save();
    if (mirrored) {
      ctx.translate(dx + dw, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, dw, dh);
    } else {
      ctx.drawImage(video, dx, dy, dw, dh);
    }
    ctx.restore();
  }

  if (!frame?.landmarks) return;
  const useMirror = frame.mirrored;
  const px = (x: number) => dx + (useMirror ? 1 - x : x) * dw;
  const py = (y: number) => dy + y * dh;

  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [a, b] of HAND_LINKS) {
    const pa = frame.landmarks[a];
    const pb = frame.landmarks[b];
    if (!pa || !pb) continue;
    ctx.moveTo(px(pa.x), py(pa.y));
    ctx.lineTo(px(pb.x), py(pb.y));
  }
  ctx.stroke();

  for (let i = 0; i < frame.landmarks.length; i++) {
    const lm = frame.landmarks[i]!;
    ctx.beginPath();
    ctx.arc(px(lm.x), py(lm.y), i === 8 || i === 4 ? 4.5 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = i === 8 ? '#e11d48' : i === 4 ? '#f59e0b' : '#22c55e';
    ctx.fill();
  }
}

/**
 * Live Face & Hand Camera Stage rendered inside the Tutorial so the user sees
 * their face framing, lighting, hand skeleton, and any camera/tracker status
 * without creating a competing `<video>` element on the MediaStream.
 */
function TutorialCameraStage({
  showFaceGuide,
  compact = false,
  mirrored,
}: {
  showFaceGuide?: boolean;
  compact?: boolean;
  mirrored: boolean;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestFrameRef = useRef<LiveCameraFrame | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(() => getCameraStream());
  const [status, setStatus] = useState<TrackerStatus>(() => getTrackerStatus());
  const [liveStatus, setLiveStatus] = useState<
    Pick<LiveCameraFrame, 'handPresent' | 'gestureKind' | 'pinchDistance' | 'holdProgress'>
  >({
    handPresent: false,
    gestureKind: 'none',
    pinchDistance: 1,
    holdProgress: 0,
  });

  useEffect(() => subscribeCameraStream(setStream), []);
  useEffect(() => subscribeTrackerStatus(setStatus), []);

  useEffect(() => {
    return subscribeLiveFrame((frame) => {
      latestFrameRef.current = frame;
      setLiveStatus({
        handPresent: frame.handPresent,
        gestureKind: frame.gestureKind,
        pinchDistance: frame.pinchDistance,
        holdProgress: frame.holdProgress,
      });
    });
  }, []);

  useEffect(() => {
    if (!stream) return;
    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const canvas = canvasRef.current;
      if (!canvas) return;
      drawVideoWithLandmarks(canvas, getCameraVideo(), latestFrameRef.current, mirrored);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [stream, mirrored]);

  if (status.phase === 'error' && !stream) {
    return (
      <div className={`tutorial-camera-stage empty ${compact ? 'compact' : ''}`} role="alert">
        <p className="camera-error">{status.error}</p>
        {status.detail && <p className="camera-diagnostic">{status.detail}</p>}
        <button type="button" className="btn-primary" onClick={() => void startTracking()}>
          {t('tutorial.retryCamera')}
        </button>
      </div>
    );
  }

  if (!stream) {
    return (
      <div className={`tutorial-camera-stage empty ${compact ? 'compact' : ''}`}>
        <p>
          {status.phase === 'starting'
            ? t('tutorial.startingCamera')
            : status.phase === 'loading-model'
              ? t('tutorial.loadingTracker')
              : t('tutorial.cameraOffPrompt')}
        </p>
        {status.phase !== 'starting' && status.phase !== 'loading-model' && (
          <button type="button" className="btn-primary" onClick={() => void startTracking()}>
            {t('camera.start')}
          </button>
        )}
      </div>
    );
  }

  const caption =
    status.phase === 'loading-model'
      ? t('tutorial.loadingTracker')
      : status.error
        ? status.error
        : liveStatus.handPresent
          ? t('tutorial.faceAndHandReady', { gesture: liveStatus.gestureKind })
          : t('tutorial.faceGuideCaption');

  return (
    <div className={`tutorial-camera-stage ${compact ? 'compact' : ''}`}>
      <canvas
        ref={canvasRef}
        className="tutorial-camera-canvas"
        width={480}
        height={270}
        aria-label="Camera preview"
      />
      {showFaceGuide && (
        <div className="tutorial-face-guide" aria-hidden="true">
          {!compact && <div className="tutorial-face-oval" />}
          <span className="tutorial-face-caption">
            {caption}
            {status.fps > 0 ? ` · ${t('camera.fps', { fps: status.fps })}` : ''}
          </span>
        </div>
      )}
      {liveStatus.holdProgress > 0 && liveStatus.holdProgress < 1 && (
        <div className="tutorial-hold-bar" aria-hidden="true">
          <div
            className="tutorial-hold-fill"
            style={{ width: `${Math.round(liveStatus.holdProgress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Drag-to-define the writing area directly over the live camera view. */
function CalibrationBox({
  rect,
  onChange,
  mirrored,
}: {
  rect: { x0: number; y0: number; x1: number; y1: number } | null;
  onChange: (r: { x0: number; y0: number; x1: number; y1: number } | null) => void;
  mirrored: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(() => getCameraStream());

  useEffect(() => subscribeCameraStream(setStream), []);

  useEffect(() => {
    if (!stream) return;
    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const canvas = canvasRef.current;
      if (!canvas) return;
      drawVideoWithLandmarks(canvas, getCameraVideo(), null, mirrored);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [stream, mirrored]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp((e.clientX - r.left) / r.width, 0, 1),
      y: clamp((e.clientY - r.top) / r.height, 0, 1),
    };
  };
  return (
    <div
      ref={ref}
      className="calibration-box"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        startRef.current = pos(e);
      }}
      onPointerMove={(e) => {
        const s = startRef.current;
        if (!s) return;
        const p = pos(e);
        onChange({
          x0: Math.min(s.x, p.x),
          y0: Math.min(s.y, p.y),
          x1: Math.max(s.x, p.x),
          y1: Math.max(s.y, p.y),
        });
      }}
      onPointerUp={() => {
        startRef.current = null;
      }}
      style={{ touchAction: 'none' }}
      aria-label="Calibration area"
    >
      {stream && (
        <canvas
          ref={canvasRef}
          className="calibration-video"
          width={480}
          height={360}
          aria-hidden="true"
        />
      )}
      {rect && (
        <div
          className="calibration-rect"
          style={{
            left: `${rect.x0 * 100}%`,
            top: `${rect.y0 * 100}%`,
            width: `${(rect.x1 - rect.x0) * 100}%`,
            height: `${(rect.y1 - rect.y0) * 100}%`,
          }}
        />
      )}
    </div>
  );
}
