/**
 * First-run interactive tutorial (skippable, re-openable from Help).
 * Steps: welcome/privacy → permission → placement → calibration →
 * practice sandbox (5 guided exercises) → cheat sheet.
 * The sandbox works with mouse/touch AND with live air gestures.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';
import { DistanceIllustration, PlacementIllustration } from './illustrations';
import { startTracking } from './trackingHandle';

type Exercise =
  'hover' | 'write' | 'erase' | 'swipe' | 'pause' | 'tap' | 'scroll' | 'zoom' | 'longPress';

/** Air mode's grammar, taught as-is. */
const EXERCISES_AIR: Exercise[] = ['hover', 'write', 'erase', 'swipe', 'pause'];
/**
 * Touch mode's grammar. It covers the same ground (write, erase, pages, pause)
 * plus the two verb a phone has that air mode does not — tap and pinch-zoom.
 */
const EXERCISES_TOUCH: Exercise[] = ['write', 'tap', 'scroll', 'zoom', 'longPress'];
const INTRO_STEPS = 4;

export default function Tutorial() {
  const { t } = useTranslation();
  const open = useStore((s) => s.tutorialOpen);
  const setOpen = useStore((s) => s.setTutorialOpen);
  const startStep = useStore((s) => s.tutorialStartStep);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<Set<Exercise>>(new Set());
  const [calRect, setCalRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  const sandboxRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<{ pts: { x: number; y: number }[]; color: string }[]>([]);
  const drawingRef = useRef(false);
  const stillSinceRef = useRef<number | null>(null);
  const [sandboxMode, setSandboxMode] = useState<'pen' | 'eraser'>('pen');
  const [sandboxMsg, setSandboxMsg] = useState('');
  const lastGesture = useStore((s) => s.lastGesture);
  const gestureMode = useStore((s) => s.settings.gestureMode);
  const exercises = gestureMode === 'touch' ? EXERCISES_TOUCH : EXERCISES_AIR;
  const totalSteps = INTRO_STEPS + exercises.length + 1;

  useEffect(() => {
    if (open) {
      setStep(startStep);
      setDone(new Set());
    }
  }, [open, startStep]);

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
  // Live feedback from real air gestures: the sandbox step completes when the
  // tracker reports the gesture the user is being taught.
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
      // Touch mode reports its own vocabulary.
      (current === 'tap' && kind === 'tap') ||
      (current === 'scroll' && kind.startsWith('scroll-')) ||
      (current === 'zoom' && kind === 'zoom') ||
      (current === 'longPress' && kind === 'pause');
    if (matched) markDone(current);
  }, [lastGesture.seq, lastGesture.kind, open, step, exercises, markDone]);

  if (!open) return null;

  const exercise =
    step >= INTRO_STEPS && step < INTRO_STEPS + exercises.length
      ? exercises[step - INTRO_STEPS]
      : null;
  const isPractice = exercise !== null;

  const drawSandbox = () => {
    const canvas = sandboxRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokesRef.current) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      s.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
  };

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
          // Swipe detection: fast horizontal movement.
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
    if (exercise === 'pause') {
      // Holding still for ~1s counts as the pause gesture in the sandbox.
      stillSinceRef.current = performance.now();
      const check = () => {
        if (stillSinceRef.current && performance.now() - stillSinceRef.current >= 1000) {
          markDone('pause');
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
        <p className="step-label">
          {t('tutorial.stepOf', { current: step + 1, total: totalSteps })}
        </p>
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
              <CalibrationBox rect={calRect} onChange={setCalRect} />
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
                height={300}
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

/** Drag-to-define the writing area in the camera frame (normalized coords). */
function CalibrationBox({
  rect,
  onChange,
}: {
  rect: { x0: number; y0: number; x1: number; y1: number } | null;
  onChange: (r: { x0: number; y0: number; x1: number; y1: number } | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

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
