import { describe, expect, it } from 'vitest';
import { GestureClassifier, makeSyntheticHand, type GestureConfig } from './gesture';

const CFG: GestureConfig = {
  pinchThreshold: 0.32,
  pinchReleaseThreshold: 0.45,
  enableErase: true,
  enablePageSwipe: true,
  enablePauseFist: true,
};

/** A hand far enough from the index tip that it is clearly not pinched. */
function unPinched(pose: Parameters<typeof makeSyntheticHand>[0] = {}) {
  return makeSyntheticHand({ ...pose, thumb: 'extended' });
}

describe('GestureClassifier', () => {
  it('detects pen-down when thumb and index are pinched', () => {
    const c = new GestureClassifier(CFG);
    const r = c.classify(makeSyntheticHand({ pinch: true, index: 'extended' }), 0);
    expect(r.kind).toBe('pen-down');
    expect(r.pinchChanged).toBe(true);
    expect(r.pinchDistance).toBeLessThan(CFG.pinchThreshold);
    expect(c.isPenDown).toBe(true);
  });

  it('uses hysteresis: stays down between thresholds, releases above', () => {
    const c = new GestureClassifier(CFG);
    c.classify(makeSyntheticHand({ pinch: true }), 0);
    expect(c.isPenDown).toBe(true);

    // Thumb tip at 0.4 × handSize from the index tip: inside the hysteresis band.
    const band = makeSyntheticHand({ index: 'extended', thumb: 'extended' });
    const indexTip = band[8]!;
    const hs = 0.12;
    band[4] = { x: indexTip.x + hs * 0.38, y: indexTip.y, z: 0 };
    const r1 = c.classify(band, 16);
    expect(r1.kind).toBe('pen-down');
    expect(r1.pinchChanged).toBe(false);

    // Thumb far away from the index tip → release.
    const far = makeSyntheticHand({ index: 'extended', thumb: 'extended' });
    far[4] = { x: 0.05, y: 0.05, z: 0 };
    const r2 = c.classify(far, 32);
    expect(r2.pinchChanged).toBe(true);
    expect(r2.kind).not.toBe('pen-down');
    expect(c.isPenDown).toBe(false);
  });

  it('reports hover when the index is extended without a pinch', () => {
    const c = new GestureClassifier(CFG);
    const hand = makeSyntheticHand({
      index: 'extended',
      middle: 'curled',
      ring: 'curled',
      pinky: 'curled',
      thumb: 'curled',
    });
    expect(c.classify(hand, 0).kind).toBe('hover');
  });

  it('detects erase for an open palm and for a two-finger pose', () => {
    const c = new GestureClassifier(CFG);
    expect(c.classify(unPinched(), 0).kind).toBe('erase');

    const two = makeSyntheticHand({
      index: 'extended',
      middle: 'extended',
      ring: 'curled',
      pinky: 'curled',
    });
    expect(c.classify(two, 16).kind).toBe('erase');

    const disabled = new GestureClassifier({ ...CFG, enableErase: false });
    expect(disabled.classify(unPinched(), 0).kind).not.toBe('erase');
  });

  it('detects fist and triggers pause after ~1s hold', () => {
    const c = new GestureClassifier(CFG);
    const fist = makeSyntheticHand({
      index: 'curled',
      middle: 'curled',
      ring: 'curled',
      pinky: 'curled',
      thumb: 'curled',
    });
    expect(c.classify(fist, 0).kind).toBe('fist');
    expect(c.classify(fist, 500).pauseTriggered).toBe(false);
    expect(c.classify(fist, 1100).pauseTriggered).toBe(true);
    expect(c.classify(fist, 1300).pauseTriggered).toBe(false);
  });

  it('detects a horizontal swipe with an open palm and respects the cooldown', () => {
    const c = new GestureClassifier(CFG);
    const at = (x: number) => unPinched({ palm: { x, y: 0.5 } });
    c.classify(at(0.8), 0);
    c.classify(at(0.7), 60);
    c.classify(at(0.6), 120);
    const r = c.classify(at(0.5), 180);
    expect(r.swipe).toBe('next');
    expect(c.classify(at(0.4), 300).swipe).toBeNull();
  });

  it('does not detect a swipe when the gesture is disabled', () => {
    const c = new GestureClassifier({ ...CFG, enablePageSwipe: false });
    const at = (x: number) => unPinched({ palm: { x, y: 0.5 } });
    c.classify(at(0.8), 0);
    c.classify(at(0.7), 60);
    expect(c.classify(at(0.5), 120).swipe).toBeNull();
  });

  it('reports none for an empty landmark array', () => {
    const c = new GestureClassifier(CFG);
    const r = c.classify([], 0);
    expect(r.kind).toBe('none');
  });

  it('reset clears pinch state', () => {
    const c = new GestureClassifier(CFG);
    c.classify(makeSyntheticHand({ pinch: true }), 0);
    expect(c.isPenDown).toBe(true);
    c.reset();
    expect(c.isPenDown).toBe(false);
  });
  it('detects a horizontal open-palm swipe even after holding the hand still for over a second', () => {
    const c = new GestureClassifier(CFG);
    const at = (x: number) => unPinched({ palm: { x, y: 0.5 } });
    // Hold hand still at 30 FPS for 1.2 s so palmHistory is full.
    for (let t = 0; t <= 1200; t += 33) {
      expect(c.classify(at(0.75), t).swipe).toBeNull();
    }
    // Now swipe left across ~160 ms.
    let swipe: 'next' | 'prev' | null = null;
    const xs = [0.7, 0.64, 0.58, 0.52, 0.46];
    xs.forEach((x, idx) => {
      const r = c.classify(at(x), 1233 + idx * 33);
      if (r.swipe) swipe = r.swipe;
    });
    expect(swipe).toBe('next');
  });

  it('detects a rightward swipe as prev and reports fist holdProgress', () => {
    const c = new GestureClassifier(CFG);
    const at = (x: number) => unPinched({ palm: { x, y: 0.5 } });
    c.classify(at(0.25), 0);
    c.classify(at(0.38), 60);
    const r = c.classify(at(0.52), 120);
    expect(r.swipe).toBe('prev');

    const fist = makeSyntheticHand({
      index: 'curled',
      middle: 'curled',
      ring: 'curled',
      pinky: 'curled',
      thumb: 'curled',
    });
    expect(c.classify(fist, 200).holdProgress).toBe(0);
    expect(c.classify(fist, 700).holdProgress).toBeCloseTo(0.5, 1);
    const done = c.classify(fist, 1250);
    expect(done.holdProgress).toBe(1);
    expect(done.pauseTriggered).toBe(true);
  });
});
