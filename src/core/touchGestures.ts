/**
 * Phone-style gestures, for people who would rather drive LightPen the way they
 * drive a touchscreen than learn a new vocabulary.
 *
 * One hand, the same mapping a phone uses:
 *
 * | Phone                 | LightPen (touch mode)                            |
 * | --------------------- | ------------------------------------------------ |
 * | finger on the glass   | index extended + pinch closed = contact           |
 * | finger lifted         | index curled back = no contact, nothing happens   |
 * | touch and drag        | keep it closed and move = draw                    |
 * | quick tap             | pinch closed and released fast = tap (no ink)     |
 * | two-finger drag       | scroll / turn the page                            |
 * | two-finger spread     | zoom                                              |
 * | long press            | hold a still, closed pinch = pause tracking       |
 *
 * The one place a camera differs from a touchscreen is the *lift*: it cannot
 * see contact, only pose. So "finger up" is the index finger curled back
 * towards the palm instead of extended. That is what stops a lifted finger from
 * inking while you reposition your hand.
 *
 * Erasing is not a gesture here — it is the toolbar's eraser tool, exactly like
 * a phone app: pick the eraser, then touch-and-drag. That keeps "what a tap
 * does" under the user's control instead of guessing from a pose.
 *
 * Pure logic, no DOM — unit-tested with synthetic landmarks.
 */

import type { Landmark } from './types';

export interface TouchGestureConfig {
  /** Normalized thumb↔index distance below which contact starts. */
  tapThreshold: number;
  /** Release threshold, higher than `tapThreshold` (hysteresis). */
  releaseThreshold: number;
  /** A pinch closed and released within this long, without moving, is a tap. */
  tapMaxMs: number;
  /** Movement (normalized) below which the finger still counts as "still". */
  stillTolerance: number;
  /** Two-finger spread change (ratio) that counts as a zoom step. */
  zoomStep: number;
  /** Vertical two-finger travel (normalized) that turns one page. */
  scrollStep: number;
  /** Holding a still, closed pinch this long is a long press. */
  longPressMs: number;
  /** Multiplier on the measured two-finger spread ratio. */
  zoomSensitivity: number;
}

export const DEFAULT_TOUCH_CONFIG: TouchGestureConfig = {
  tapThreshold: 0.32,
  releaseThreshold: 0.45,
  tapMaxMs: 350,
  stillTolerance: 0.04,
  zoomStep: 0.18,
  scrollStep: 0.25,
  longPressMs: 900,
  zoomSensitivity: 1,
};

export type TouchAction = 'none' | 'point' | 'scroll' | 'zoom' | 'pause';

export interface TouchFrame {
  /** What the page should do this frame. */
  action: TouchAction;
  /** Fingertip (index tip) in normalized camera coords. */
  point: { x: number; y: number };
  /** True only on the frame a tap is recognised (contact already released). */
  tap: boolean;
  /** Pages to turn this frame; negative is previous. */
  pageDelta: number;
  /** Multiplicative zoom this frame (1 = unchanged). */
  zoomFactor: number;
  /** True while the index finger counts as touching the page. */
  contact: boolean;
  /** True while two fingers are up. */
  twoFingers: boolean;
  /** Normalized thumb↔index distance, for the preview and for tests. */
  pinchDistance: number;
}

const IDLE: TouchFrame = {
  action: 'none',
  point: { x: 0, y: 0 },
  tap: false,
  pageDelta: 0,
  zoomFactor: 1,
  contact: false,
  twoFingers: false,
  pinchDistance: 1,
};

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Stateful classifier: contact hysteresis, tap-vs-drag timing, long press and
 * the previous two-finger spread (zoom is a *change* in distance, so it needs
 * one frame of history).
 */
export class TouchGestureClassifier {
  private contact = false;
  private contactSince = 0;
  private startPoint = { x: 0, y: 0 };
  private maxMoved = 0;
  private longPressFired = false;
  private lastSpread: number | null = null;
  /** Anchor for the two-finger scroll, re-set after each page turn. */
  private scrollAnchor: number | null = null;

  constructor(private readonly config: TouchGestureConfig = DEFAULT_TOUCH_CONFIG) {}

  reset(): void {
    this.contact = false;
    this.contactSince = 0;
    this.startPoint = { x: 0, y: 0 };
    this.maxMoved = 0;
    this.longPressFired = false;
    this.lastSpread = null;
    this.scrollAnchor = null;
  }

  /** True while the index finger counts as touching the page. */
  get isContact(): boolean {
    return this.contact;
  }

  classify(landmarks: Landmark[], nowMs: number): TouchFrame {
    if (landmarks.length < 21) {
      this.reset();
      return { ...IDLE };
    }
    const wrist = landmarks[WRIST] ?? { x: 0, y: 0, z: 0 };
    const thumbTip = landmarks[THUMB_TIP] ?? wrist;
    const indexTip = landmarks[INDEX_TIP] ?? wrist;
    const middleMcp = landmarks[MIDDLE_MCP] ?? wrist;
    const handSize = Math.max(dist(wrist, middleMcp), 1e-6);

    const point = { x: indexTip.x, y: indexTip.y };
    const pinchDistance = dist(thumbTip, indexTip) / handSize;

    // Same "extended" test as the air classifier, so a pose reads identically
    // in both modes: the tip is further from the wrist than its middle joint.
    const extended = (tipIdx: number, pipIdx: number): boolean =>
      dist(landmarks[tipIdx] ?? wrist, wrist) > dist(landmarks[pipIdx] ?? wrist, wrist) * 1.05;
    const indexExt = extended(INDEX_TIP, INDEX_PIP);
    const middleExt = extended(MIDDLE_TIP, MIDDLE_PIP);

    // Priority matters. A pinch is a *contact*, even when the middle finger
    // happens to be extended — people do not fold the other three fingers to
    // draw. So the pinch wins, and "two fingers" means two fingers up with the
    // thumb clearly away (not pinching).
    const pinching =
      pinchDistance < (this.contact ? this.config.releaseThreshold : this.config.tapThreshold);

    if (!this.contact && indexExt && middleExt && !pinching) {
      return this.twoFinger(landmarks, point, pinchDistance);
    }

    // ---- one finger ----
    this.lastSpread = null;
    this.scrollAnchor = null;

    let tap = false;
    if (!this.contact && indexExt && pinching) {
      // Touch down.
      this.contact = true;
      this.contactSince = nowMs;
      this.startPoint = { ...point };
      this.maxMoved = 0;
      this.longPressFired = false;
    } else if (this.contact && (!indexExt || pinchDistance > this.config.releaseThreshold)) {
      // Lift. A short, still touch is a tap — it must not leave a dot behind.
      tap =
        nowMs - this.contactSince <= this.config.tapMaxMs &&
        this.maxMoved < this.config.stillTolerance;
      this.contact = false;
      this.longPressFired = false;
      // Two fingers arriving can also be what ended the contact, in which case
      // this same frame should start scrolling rather than return nothing.
      if (indexExt && middleExt) return { ...this.twoFinger(landmarks, point, pinchDistance), tap };
    }

    if (!this.contact) return { ...IDLE, point, tap, pinchDistance };

    this.maxMoved = Math.max(
      this.maxMoved,
      Math.hypot(point.x - this.startPoint.x, point.y - this.startPoint.y),
    );
    const still = this.maxMoved < this.config.stillTolerance;
    let longPress = false;
    if (!this.longPressFired && nowMs - this.contactSince >= this.config.longPressMs && still) {
      longPress = true;
      this.longPressFired = true;
    }

    return {
      action: longPress ? 'pause' : 'point',
      point,
      tap: false,
      pageDelta: 0,
      zoomFactor: 1,
      contact: true,
      twoFingers: false,
      pinchDistance,
    };
  }

  /** Two fingers up: scroll by vertical travel, zoom by spread change. */
  private twoFinger(
    landmarks: Landmark[],
    point: { x: number; y: number },
    pinchDistance: number,
  ): TouchFrame {
    // Two fingers cancel a one-finger gesture that was in progress.
    this.contact = false;
    this.longPressFired = false;

    const wrist = landmarks[WRIST] ?? { ...point, z: 0 };
    const indexTip = landmarks[INDEX_TIP] ?? { ...point, z: 0 };
    const middleTip = landmarks[MIDDLE_TIP] ?? { ...point, z: 0 };
    const handSize = Math.max(dist(wrist, landmarks[MIDDLE_MCP] ?? wrist), 1e-6);
    const spread = Math.max(dist(indexTip, middleTip) / handSize, 1e-6);

    // Zoom first: a change in spread is unambiguous, and a simultaneous scroll
    // would fight it.
    let zoomFactor = 1;
    if (this.lastSpread !== null) {
      const ratio = spread / this.lastSpread;
      if (Math.abs(ratio - 1) > this.config.zoomStep) {
        zoomFactor = 1 + (ratio - 1) * this.config.zoomSensitivity;
      }
    }
    this.lastSpread = spread;

    let pageDelta = 0;
    if (zoomFactor === 1) {
      // Scroll: fingers moving down the frame pulls the next page in, the same
      // direction as dragging a page with two fingers on a touchscreen.
      if (this.scrollAnchor === null) this.scrollAnchor = point.y;
      const travel = point.y - this.scrollAnchor;
      if (Math.abs(travel) > this.config.scrollStep) {
        pageDelta = travel > 0 ? 1 : -1;
        this.scrollAnchor = point.y;
      }
    } else {
      this.scrollAnchor = point.y;
    }

    const action: TouchAction = zoomFactor !== 1 ? 'zoom' : pageDelta !== 0 ? 'scroll' : 'none';
    return {
      action,
      point,
      tap: false,
      pageDelta,
      zoomFactor,
      contact: false,
      twoFingers: true,
      pinchDistance,
    };
  }
}
