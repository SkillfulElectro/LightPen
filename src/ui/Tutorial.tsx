/**
 * First-run interactive tutorial (skippable, re-openable from Help).
 * Features:
 * - Live Face & Hand Camera Stage embedded directly in Placement, Calibration, and Practice steps.
 * - Tutorial Pace control (Guided / Normal / Quick) adapting gesture feedback cadence.
 * - Practice sandbox accepts BOTH mouse/touch AND live air-writing strokes directly from the camera.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TutorialPace } from '../core/types';
import { useStore } from '../store/useStore';
import { DistanceIllustration, PlacementIllustration } from './illustrations';
import {
  getCameraStream,
  startTracking,
  subscribeCameraStream,
  subscribeLiveFrame,
  type LiveCameraFrame,
} from './trackingHandle';

type Exercise =
  | 'hover'
  | 'write'
  | 'erase'
  | 'swipe'
  | 'pause'
  | 'tap'
  | 'scroll'
  | 'zoom'
  | 'longPress';

const EXERCISES_AIR: Exercise[] = ['hover', 'write', 'erase', 'swipe', 'pause'];
const EXERCISES_TOUCH: Exercise[] = ['write', 'tap', 'scroll', 'zoom', 'longPress'];
const INTRO_STEPS = 4;

const PACE_ADVANCE_MS: Record<TutorialPace, number> = {
  guided: 1600,
  normal: 950,
  quick: 450,
};

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
  const stillSinceRef = useRef<number | null>(null);
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
    }
  }, [open, startStep]);

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

  // Live feedback from real air gestures + live ink in practice sandbox.
  useEffect(() => {
    if (!open || step < INTRO_STEPS || step >= INTRO_STEPS + exercises.length) return;
    const current = exercises[step - INTRO_STEPS];
    if (!current) return;
    const kind = lastGesture.kind;
    const matched =
      (current === 'write' && (kind === 'pen-down' || kind === 'tap')) ||
      (current === 'hover' && kind === 'hover') ||
      (current === 'erase' && kind === 'erase') ||
      (current === 'swipe' && kind.startsWith('swipe-')) ||
      (current === 'pause' && kind === 'pause') ||
      (current === 'tap' && kind === 'tap') ||
      (current === 'scroll' && kind.startsWith('scroll-')) ||
      (current === 'zoom' && kind === 'zoom') ||
      (current === 'longPress' && kind === 'pause');
    if (matched) markDone(current);
  }, [lastGesture.seq, lastGesture.kind, open, step, exercises, markDone]);

  // Pipe live camera hand coordinates into the practice sandbox canvas so the user
  // sees their real air handwriting right inside the tutorial!
  useEffect(() => {
    if (!open || step < INTRO_STEPS || step >= INTRO_STEPS + exercises.length) return;
    return subscribeLiveFrame((frame) => {
      const canvas = sandboxRef.current;
      if (!canvas || !frame.handPresent || !frame.indexTip) {
        airDrawingRef.current = false;
        drawSandbox();
        return;
      }
      const x = (frame.mirrored ? 1 - frame.indexTip.x : frame.indexTip.x) * canvas.width;
      const y = frame.indexTip.y * canvas.height;
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

  // Pace-driven auto-advance when a practice step completes in quick/normal/guided mode.
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
    const rect = sandboxRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onSandboxDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drawingRef.current = true;
    stillSinceRef.current = null;
    const p = sandboxPos(e);
    if (sandboxMode === 'pen') {
      strokesRef.current.push({ pts: [p], color: '#e11d48' });
      if (exercise === 'write') markDone('write');
    } else if (exercise === 'erase' && strokesRef.current.length > 0) {
      strokesRef.current = strokesRef.current.filter(
        (s) => !s.pts.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < 24),
      );
      markDone('erase');
    }
    drawSandbox();
  };

  const onSandboxMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = sandboxPos(e);
    if (exercise === 'hover' && !drawingRef.current) markDone('hover');
    if (drawingRef.current && sandboxMode === 'pen') {
      const cur = strokesRef.current[strokesRef.current.length - 1];
      if (cur) {
        const last = cur.pts[cur.pts.length - 1];
        if (last && Math.hypot(last.x - p.x, last.y - p.y) > 2) {
          cur.pts.push(p);
          if (exercise === 'swipe' && cur.pts.length > 6) {
            const first = cur.pts[0]!;
            if (Math.abs(p.x - first.x) > 120 && Math.abs(p.y - first.y) < 40) markDone('swipe');
          }
        }
      }
      drawSandbox();
    }
  };

  const onSandboxUp = () => {
    drawingRef.current = false;
    if (exercise === 'pause' || exercise === 'longPress') {
      stillSinceRef.current = performance.now();
      const check = () => {
        if (stillSinceRef.current && performance.now() - stillSinceRef.current >= 1000) {
          markDone(exercise);
        } else if (stillSinceRef.current) {
          requestAnimationFrame(check);
        }
      };
      requestAnimationFrame(check);
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

/**
 * Live Face & Hand Camera Stage rendered inside the Tutorial pace so the user
 * sees their face framing, lighting, and hand skeleton in real time.
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(() => getCameraStream());
  const [liveStatus, setLiveStatus] = useState<Pick<LiveCameraFrame, 'handPresent' | 'gestureKind' | 'pinchDistance'>>({
    handPresent: false,
    gestureKind: 'none',
    pinchDistance: 1,
  });

  useEffect(() => subscribeCameraStream(setStream), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) {
      void video.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    return subscribeLiveFrame((frame) => {
      setLiveStatus({
        handPresent: frame.handPresent,
        gestureKind: frame.gestureKind,
        pinchDistance: frame.pinchDistance,
      });
      const canvas = overlayRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!frame.landmarks) return;
      const px = (x: number) => (frame.mirrored ? 1 - x : x) * canvas.width;
      const py = (y: number) => y * canvas.height;
      const links: [number, number][] = [
        [0, 1], [1, 2], [2, 3], [3, 4],
        [0, 5], [5, 6], [6, 7], [7, 8],
        [5, 9], [9, 10], [10, 11], [11, 12],
        [9, 13], [13, 14], [14, 15], [15, 16],
        [13, 17], [17, 18], [18, 19], [19, 20],
        [0, 17],
      ];
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [a, b] of links) {
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
    });
  }, []);

  if (!stream) {
    return (
      <div className={`tutorial-camera-stage empty ${compact ? 'compact' : ''}`}>
        <p>{t('tutorial.cameraOffPrompt')}</p>
        <button type="button" className="btn-primary" onClick={() => void startTracking()}>
          {t('camera.start')}
        </button>
      </div>
    );
  }

  return (
    <div className={`tutorial-camera-stage ${compact ? 'compact' : ''}`}>
      <video
        ref={videoRef}
        className="tutorial-camera-video"
        playsInline
        muted
        style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
      />
      <canvas ref={overlayRef} className="tutorial-camera-overlay" width={360} height={240} />
      {showFaceGuide && (
        <div className="tutorial-face-guide" aria-hidden="true">
          <div className="tutorial-face-oval" />
          <span className="tutorial-face-caption">
            {liveStatus.handPresent
              ? t('tutorial.faceAndHandReady', { gesture: liveStatus.gestureKind })
              : t('tutorial.faceGuideCaption')}
          </span>
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(() => getCameraStream());

  useEffect(() => subscribeCameraStream(setStream), []);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => {});
  }, [stream]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
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
        <video
          ref={videoRef}
          className="calibration-video"
          playsInline
          muted
          style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
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
