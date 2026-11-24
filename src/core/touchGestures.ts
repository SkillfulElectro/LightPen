/**
 * Smartphone-style air-touch gesture classifier. Pure logic, no DOM.
 *
 * Designed around natural human hand geometry so every gesture works reliably
 * in front of a real webcam:
 * - Pinching thumb + index naturally bends the index finger at the PIP joint,
 *   so contact does not require a rigidly straight index finger (`indexExt`).
 * - Two-finger zoom accumulates spread relative to a stable anchor instead of
 *   demanding a large single-frame jump at 30 FPS.
 * - Tap and long-press still-tolerances accommodate real mid-air hand tremor.
 */
import type { Landmark } from './types';

export interface TouchGestureConfig {
  /** Thumb↔index normalized distance below which the finger touches down. */
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
  tapThreshold: 0.42,
  releaseThreshold: 0.56,
  tapMaxMs: 480,
  stillTolerance: 0.075,
  zoomStep: 0.1,
  scrollStep: 0.11,
  longPressMs: 950,
  zoomSensitivity: 1,
};

export type TouchAction =
  'none' | 'hover' | 'point' | 'scroll' | 'zoom' | 'erase' | 'grab' | 'pause';

export interface TouchFrame {
  /** What the page should do this frame. */
  action: TouchAction;
  /** Fingertip (index tip) in normalized camera coords. */
  point: { x: number; y: number };
  /** Palm center in normalized camera coords (used for open-palm erase). */
  palmCenter: { x: number; y: number };
  /** True only on the frame a tap is recognised (contact already released). */
  tap: boolean;
  /** Pages to turn this frame; negative is previous. */
  pageDelta: number;
  /** Continuous vertical two-finger scroll delta in normalized camera units. */
  scrollDeltaY: number;
  /** Multiplicative zoom this frame (1 = unchanged). */
  zoomFactor: number;
  /** Direction of active zoom gesture if zooming this frame. */
  zoomDirection: 'in' | 'out' | null;
  /** True while the index finger counts as touching the page. */
  contact: boolean;
  /** True while two fingers are up. */
  twoFingers: boolean;
  /** Normalized thumb↔index distance, for the preview and for tests. */
  pinchDistance: number;
  /** Estimated hand size in normalized frame units (for distance hints). */
  handSize: number;
  /** 0..1 progress while holding a still pinch / fist toward pause. */
  holdProgress: number;
}

const IDLE: TouchFrame = {
  action: 'none',
  point: { x: 0, y: 0 },
  palmCenter: { x: 0, y: 0 },
  tap: false,
  pageDelta: 0,
  scrollDeltaY: 0,
  zoomFactor: 1,
  zoomDirection: null,
  contact: false,
  twoFingers: false,
  pinchDistance: 1,
  handSize: 0,
  holdProgress: 0,
};

const WRIST = 0;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pinchDist3D(a: Landmark, b: Landmark): number {
  const dz = ((a.z ?? 0) - (b.z ?? 0)) * 0.35;
  return Math.hypot(a.x - b.x, a.y - b.y, dz);
}

export class TouchGestureClassifier {
  private contact = false;
  private contactSince = 0;
  private startPoint = { x: 0, y: 0 };
  private maxMoved = 0;
  private longPressFired = false;
  private zoomAnchor: number | null = null;
  private scrollAnchor: number | null = null;
  private lastScrollY: number | null = null;

  constructor(private readonly config: TouchGestureConfig = DEFAULT_TOUCH_CONFIG) {}

  reset(): void {
    this.contact = false;
    this.contactSince = 0;
    this.startPoint = { x: 0, y: 0 };
    this.maxMoved = 0;
    this.longPressFired = false;
    this.zoomAnchor = null;
    this.scrollAnchor = null;
    this.lastScrollY = null;
  }

  get isContact(): boolean {
    return this.contact;
  }

  classify(landmarks: Landmark[], nowMs: number): TouchFrame {
    if (landmarks.length < 21) {
      this.reset();
      return { ...IDLE };
    }
    const wrist = landmarks[WRIST] ?? { x: 0, y: 0, z: 0 };
    const thumbIp = landmarks[THUMB_IP] ?? wrist;
    const thumbTip = landmarks[THUMB_TIP] ?? wrist;
    const indexMcp = landmarks[INDEX_MCP] ?? wrist;
    const indexTip = landmarks[INDEX_TIP] ?? wrist;
    const middleMcp = landmarks[MIDDLE_MCP] ?? wrist;
    const pinkyMcp = landmarks[PINKY_MCP] ?? wrist;

    const palmWidth = dist(indexMcp, pinkyMcp);
    const handSize = Math.max(dist(wrist, middleMcp), palmWidth * 0.72, 1e-6);
    const point = { x: indexTip.x, y: indexTip.y };
    const palmCenter = { x: (wrist.x + middleMcp.x) / 2, y: (wrist.y + middleMcp.y) / 2 };

    const tipPinch = pinchDist3D(thumbTip, indexTip) / handSize;
    const padPinch = (pinchDist3D(thumbIp, indexTip) / handSize) * 1.15;
    const pinchDistance = Math.min(tipPinch, padPinch);

    const extended = (tipIdx: number, pipIdx: number): boolean =>
      dist(landmarks[tipIdx] ?? wrist, wrist) > dist(landmarks[pipIdx] ?? wrist, wrist) * 1.05;

    const indexExt = extended(INDEX_TIP, INDEX_PIP);
    const middleExt = extended(MIDDLE_TIP, MIDDLE_PIP);
    const ringExt = extended(RING_TIP, RING_PIP);
    const pinkyExt = extended(PINKY_TIP, PINKY_PIP);

    const indexTipDist = dist(indexTip, wrist);
    const indexMcpDist = dist(indexMcp, wrist);
    // A real pinched index finger bends at the PIP joint to meet the thumb, so
    // `indexExt` often flips false even though the fingertip is still out past
    // the knuckle (unlike a tucked fist or curled-down lifted finger).
    const indexPinchable = indexExt || indexTipDist > indexMcpDist * 0.92;
    // Slightly foreshortened pointing (angled toward the camera) still counts as hover.
    const indexPointing = indexExt || indexTipDist > indexMcpDist * 1.08;

    const pinching =
      pinchDistance < (this.contact ? this.config.releaseThreshold : this.config.tapThreshold);

    const openPalm = indexExt && middleExt && ringExt && pinkyExt && !pinching;
    const twoFingerPose = indexExt && middleExt && !ringExt && !pinkyExt && !pinching;
    const fist = !indexExt && !middleExt && !ringExt && !pinkyExt && !pinching;

    // Two fingers up (V-sign / scroll & zoom): index + middle extended, ring & pinky curled.
    if (twoFingerPose) {
      return this.twoFinger(landmarks, point, palmCenter, pinchDistance, handSize);
    }

    // Open palm erase in air-touch mode (all 4 fingers open, clearly not pinching).
    if (!this.contact && openPalm) {
      this.zoomAnchor = null;
      this.scrollAnchor = null;
      this.lastScrollY = null;
      return {
        ...IDLE,
        action: 'erase',
        point: palmCenter,
        palmCenter,
        pinchDistance,
        handSize,
      };
    }

    // Closed fist (grab / rest cursor without writing).
    if (!this.contact && fist) {
      this.zoomAnchor = null;
      this.scrollAnchor = null;
      this.lastScrollY = null;
      return {
        ...IDLE,
        action: 'grab',
        point: palmCenter,
        palmCenter,
        pinchDistance,
        handSize,
      };
    }

    // ---- one finger (hover, pinch-write, tap, long-press) ----
    this.zoomAnchor = null;
    this.scrollAnchor = null;
    this.lastScrollY = null;
    let tap = false;

    if (!this.contact && indexPinchable && pinching) {
      this.contact = true;
      this.contactSince = nowMs;
      this.startPoint = { ...point };
      this.maxMoved = 0;
      this.longPressFired = false;
    } else if (this.contact && (!indexPinchable || pinchDistance > this.config.releaseThreshold)) {
      tap =
        nowMs - this.contactSince <= this.config.tapMaxMs &&
        this.maxMoved < this.config.stillTolerance;
      this.contact = false;
      this.longPressFired = false;
      if (indexExt && middleExt && !ringExt && !pinkyExt) {
        return { ...this.twoFinger(landmarks, point, palmCenter, pinchDistance, handSize), tap };
      }
    }

    if (!this.contact) {
      return {
        ...IDLE,
        action: indexPointing ? 'hover' : 'none',
        point,
        palmCenter,
        tap,
        pinchDistance,
        handSize,
      };
    }

    this.maxMoved = Math.max(
      this.maxMoved,
      Math.hypot(point.x - this.startPoint.x, point.y - this.startPoint.y),
    );
    const still = this.maxMoved < this.config.stillTolerance;
    const heldMs = Math.max(0, nowMs - this.contactSince);
    const holdProgress = still ? Math.min(1, heldMs / Math.max(this.config.longPressMs, 1)) : 0;
    let longPress = false;
    if (!this.longPressFired && heldMs >= this.config.longPressMs && still) {
      longPress = true;
      this.longPressFired = true;
    }

    return {
      action: longPress ? 'pause' : 'point',
      point,
      palmCenter,
      tap: false,
      pageDelta: 0,
      scrollDeltaY: 0,
      zoomFactor: 1,
      zoomDirection: null,
      contact: true,
      twoFingers: false,
      pinchDistance,
      handSize,
      holdProgress,
    };
  }

  private twoFinger(
    landmarks: Landmark[],
    point: { x: number; y: number },
    palmCenter: { x: number; y: number },
    pinchDistance: number,
    handSize: number,
  ): TouchFrame {
    this.contact = false;
    this.longPressFired = false;
    const indexTip = landmarks[INDEX_TIP] ?? { ...point, z: 0 };
    const middleTip = landmarks[MIDDLE_TIP] ?? { ...point, z: 0 };
    const spread = Math.max(dist(indexTip, middleTip) / handSize, 1e-6);

    let zoomFactor = 1;
    let zoomDirection: 'in' | 'out' | null = null;
    if (this.zoomAnchor === null) {
      this.zoomAnchor = spread;
    } else {
      const ratio = spread / this.zoomAnchor;
      if (Math.abs(ratio - 1) > this.config.zoomStep) {
        zoomFactor = 1 + (ratio - 1) * this.config.zoomSensitivity;
        zoomDirection = zoomFactor > 1 ? 'in' : 'out';
        this.zoomAnchor = spread;
      }
    }

    let pageDelta = 0;
    let scrollDeltaY = 0;
    if (zoomFactor === 1) {
      if (this.scrollAnchor === null) this.scrollAnchor = point.y;
      if (this.lastScrollY !== null) {
        scrollDeltaY = point.y - this.lastScrollY;
      }
      this.lastScrollY = point.y;
      const travel = point.y - this.scrollAnchor;
      if (Math.abs(travel) > this.config.scrollStep) {
        pageDelta = travel > 0 ? 1 : -1;
        this.scrollAnchor = point.y;
        // Re-anchor zoom after a clear vertical scroll so perspective changes don't misfire zoom.
        this.zoomAnchor = spread;
      }
    } else {
      this.scrollAnchor = point.y;
      this.lastScrollY = point.y;
    }

    const action: TouchAction = zoomFactor !== 1 ? 'zoom' : 'scroll';

    return {
      action,
      point,
      palmCenter,
      tap: false,
      pageDelta,
      scrollDeltaY,
      zoomFactor,
      zoomDirection,
      contact: false,
      twoFingers: true,
      pinchDistance,
      handSize,
      holdProgress: 0,
    };
  }
}
