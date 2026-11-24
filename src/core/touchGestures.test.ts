/**
 * Touch mode exists so the camera gestures match what people already know from
 * a smartphone. These tests pin the vocabulary itself, not just the code:
 * finger-down draws, finger-up does not, a quick tap leaves no ink, two fingers
 * scroll and zoom, and a still hold pauses.
 */
import { describe, expect, it } from 'vitest';
import { makeSyntheticHand } from './gesture';
import {
  DEFAULT_TOUCH_CONFIG,
  TouchGestureClassifier,
  type TouchGestureConfig,
} from './touchGestures';

const CFG: TouchGestureConfig = { ...DEFAULT_TOUCH_CONFIG };

/** Index extended, thumb either pinched (contact) or away (lifted). */
const touching = (x = 0.5, y = 0.5) =>
  makeSyntheticHand({ palm: { x, y }, index: 'extended', pinch: true });
const lifted = (x = 0.5, y = 0.5) =>
  makeSyntheticHand({ palm: { x, y }, index: 'curled', thumb: 'extended' });
/** Two fingers up, `spread` controls the gap (zoom). */
const twoFingers = (x = 0.5, y = 0.5, spread = 0) =>
  makeSyntheticHand({
    palm: { x, y },
    index: 'extended',
    middle: 'extended',
    ring: 'curled',
    pinky: 'curled',
    thumb: 'extended',
  }).map((lm, i) => (i === 12 ? { x: lm.x + spread, y: lm.y, z: 0 } : lm));

describe('TouchGestureClassifier', () => {
  it('touches down when the index is extended and pinched', () => {
    const c = new TouchGestureClassifier(CFG);
    const f = c.classify(touching(), 0);
    expect(f.contact).toBe(true);
    expect(f.action).toBe('point');
    expect(c.isContact).toBe(true);
  });

  it('reports no contact while the index is curled, so a lifted finger never inks', () => {
    const c = new TouchGestureClassifier(CFG);
    const f = c.classify(lifted(), 0);
    expect(f.contact).toBe(false);
    expect(f.action).toBe('none');
  });

  it('keeps contact while the pinch stays closed (drag to draw)', () => {
    const c = new TouchGestureClassifier(CFG);
    const first = c.classify(touching(0.5, 0.5), 0);
    const f = c.classify(touching(0.55, 0.52), 40);
    expect(f.contact).toBe(true);
    expect(f.action).toBe('point');
    // The fingertip follows the hand; compare with the first frame rather than
    // with an absolute position (the synthetic index tip sits left of the palm).
    expect(f.point.x).toBeGreaterThan(first.point.x);
    expect(f.point.y).toBeGreaterThan(first.point.y);
  });

  it('treats a quick closed-and-released pinch as a tap, with no drag', () => {
    const c = new TouchGestureClassifier(CFG);
    c.classify(touching(), 0);
    const f = c.classify(lifted(), 120);
    expect(f.tap).toBe(true);
    expect(f.contact).toBe(false);
  });

  it('does not call a slow release a tap', () => {
    const c = new TouchGestureClassifier(CFG);
    c.classify(touching(), 0);
    const f = c.classify(lifted(), 2000);
    expect(f.tap).toBe(false);
  });

  it('does not call a moving contact a tap (that was a stroke)', () => {
    const c = new TouchGestureClassifier(CFG);
    c.classify(touching(0.3, 0.5), 0);
    c.classify(touching(0.5, 0.6), 100);
    const f = c.classify(lifted(0.5, 0.6), 150);
    expect(f.tap).toBe(false);
  });

  it('turns a page when two fingers travel vertically', () => {
    const c = new TouchGestureClassifier(CFG);
    c.classify(twoFingers(0.5, 0.2), 0);
    // Move down past the scroll step, keeping the spread identical.
    const f = c.classify(twoFingers(0.5, 0.7), 100);
    expect(f.twoFingers).toBe(true);
    expect(f.action).toBe('scroll');
    expect(f.pageDelta).toBe(1);
    expect(f.contact).toBe(false);
  });

  it('zooms when the two-finger spread changes, and does not also scroll', () => {
    const c = new TouchGestureClassifier(CFG);
    c.classify(twoFingers(0.5, 0.5, 0), 0);
    const f = c.classify(twoFingers(0.5, 0.5, 0.15), 60);
    expect(f.action).toBe('zoom');
    expect(f.zoomFactor).toBeGreaterThan(1);
    expect(f.pageDelta).toBe(0);
  });

  it('ignores landmark jitter in the two-finger spread', () => {
    const c = new TouchGestureClassifier(CFG);
    c.classify(twoFingers(0.5, 0.5, 0), 0);
    const f = c.classify(twoFingers(0.5, 0.5, 0.002), 16);
    expect(f.zoomFactor).toBe(1);
  });

  it('pauses after a still contact is held for the long-press time', () => {
    const c = new TouchGestureClassifier(CFG);
    c.classify(touching(), 0);
    expect(c.classify(touching(), 300).action).toBe('point');
    const f = c.classify(touching(), CFG.longPressMs + 50);
    expect(f.action).toBe('pause');
    // Only once per contact: holding on must not stop tracking repeatedly.
    expect(c.classify(touching(), CFG.longPressMs + 200).action).toBe('point');
  });

  it('cancels a one-finger gesture when the second finger arrives', () => {
    const c = new TouchGestureClassifier(CFG);
    c.classify(touching(), 0);
    expect(c.isContact).toBe(true);
    const f = c.classify(twoFingers(), 40);
    expect(f.twoFingers).toBe(true);
    expect(c.isContact).toBe(false);
  });

  it('is inert with no hand and clears its state', () => {
    const c = new TouchGestureClassifier(CFG);
    c.classify(touching(), 0);
    const f = c.classify([], 40);
    expect(f.action).toBe('none');
    expect(c.isContact).toBe(false);
  });
  it('detects pinch and tap even when the index finger bends at the PIP joint to meet the thumb', () => {
    const c = new TouchGestureClassifier(CFG);
    // Realistic human pinch: index PIP is higher than index tip (so indexExt is false),
    // yet index tip is clearly past the index MCP and touching the thumb tip.
    const bentPinch = makeSyntheticHand({
      index: 'extended',
      middle: 'curled',
      ring: 'curled',
      pinky: 'curled',
    });
    const pip = bentPinch[6]!;
    bentPinch[8] = { x: pip.x + 0.005, y: pip.y + 0.006, z: 0 };
    bentPinch[4] = { x: bentPinch[8]!.x + 0.004, y: bentPinch[8]!.y + 0.004, z: 0 };

    const down = c.classify(bentPinch, 0);
    expect(down.contact).toBe(true);
    expect(down.action).toBe('point');

    const open = makeSyntheticHand({
      index: 'extended',
      middle: 'curled',
      ring: 'curled',
      pinky: 'curled',
      thumb: 'extended',
    });
    const up = c.classify(open, 180);
    expect(up.contact).toBe(false);
    expect(up.tap).toBe(true);
  });

  it('accumulates smooth multi-frame two-finger spread at 30 FPS to trigger zoom', () => {
    const c = new TouchGestureClassifier(CFG);
    let zoomed = false;
    // Small 4% spread increments per frame (each below single-frame zoomStep = 10%)
    // must still accumulate against the zoom anchor and fire zoom.
    for (let i = 0; i < 8; i++) {
      const f = c.classify(twoFingers(0.5, 0.5, i * 0.004), i * 33);
      if (f.zoomFactor > 1 && f.action === 'zoom') zoomed = true;
    }
    expect(zoomed).toBe(true);
  });

  it('reports grab for a closed fist and supports two-finger zoom-out and upward scroll', () => {
    const c = new TouchGestureClassifier(CFG);
    const fist = makeSyntheticHand({
      index: 'curled',
      middle: 'curled',
      ring: 'curled',
      pinky: 'curled',
      thumb: 'curled',
    });
    expect(c.classify(fist, 0).action).toBe('grab');

    // Smooth two-finger pinch-close triggers zoom-out (zoomFactor < 1).
    let zoomedOut = false;
    for (let i = 0; i < 8; i++) {
      const f = c.classify(twoFingers(0.5, 0.5, 0.04 - i * 0.004), 50 + i * 33);
      if (f.zoomFactor < 1 && f.action === 'zoom') zoomedOut = true;
    }
    expect(zoomedOut).toBe(true);

    // Upward two-finger drag triggers scroll-prev.
    c.reset();
    c.classify(twoFingers(0.5, 0.65, 0), 400);
    const up = c.classify(twoFingers(0.5, 0.45, 0), 460);
    expect(up.pageDelta).toBe(-1);
    expect(up.action).toBe('scroll');
  });
});
