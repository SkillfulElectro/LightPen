/**
 * Gesture classifier over the 21 MediaPipe hand landmarks.
 * Pure logic, no DOM — fully unit-testable with synthetic landmarks.
 *
 * Landmark indices (MediaPipe Hands):
 *   0 wrist, 4 thumb tip, 5 index MCP, 8 index tip, 9 middle MCP,
 *   12 middle tip, 16 ring tip, 20 pinky tip.
 */

import type { GestureKind, Landmark } from './types';

export interface GestureConfig {
  pinchThreshold: number; // enter pen-down below this (normalized)
  pinchReleaseThreshold: number; // exit pen-down above this (hysteresis)
  enableErase: boolean;
  enablePageSwipe: boolean;
  enablePauseFist: boolean;
}

export interface GestureResult {
  kind: GestureKind;
  /** Index fingertip (landmark 8) in normalized camera coords. */
  indexTip: { x: number; y: number };
  /** Palm center (wrist↔middle-MCP midpoint) in normalized camera coords. */
  palmCenter: { x: number; y: number };
  /** Normalized thumb↔index distance (hand-size normalized). */
  pinchDistance: number;
  /** Hand size estimate (wrist→middle-MCP distance, normalized). */
  handSize: number;
  /** True when the pinch state changed this frame. */
  pinchChanged: boolean;
  /** True when a page-swipe was detected this frame. */
  swipe: 'next' | 'prev' | null;
  /** True when the fist-hold pause gesture completed this frame. */
  pauseTriggered: boolean;
}

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;

function dist(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Stateful classifier: keeps pinch hysteresis, swipe history and fist timer. */
export class GestureClassifier {
  private penDown = false;
  private palmHistory: { x: number; y: number; t: number }[] = [];
  private fistSince: number | null = null;
  private lastSwipeAt = Number.NEGATIVE_INFINITY;
  private pauseFired = false;

  constructor(private readonly config: GestureConfig) {}

  reset(): void {
    this.penDown = false;
    this.palmHistory = [];
    this.fistSince = null;
    this.lastSwipeAt = Number.NEGATIVE_INFINITY;
    this.pauseFired = false;
  }

  /** True while a stroke is in progress (pinch held). */
  get isPenDown(): boolean {
    return this.penDown;
  }

  classify(landmarks: Landmark[], nowMs: number): GestureResult {
    if (landmarks.length < 21) {
      // No usable hand this frame: release pen state so strokes end cleanly.
      this.penDown = false;
      this.fistSince = null;
      this.pauseFired = false;
      this.palmHistory = [];
      return {
        kind: 'none',
        indexTip: { x: 0, y: 0 },
        palmCenter: { x: 0, y: 0 },
        pinchDistance: 1,
        handSize: 0,
        pinchChanged: false,
        swipe: null,
        pauseTriggered: false,
      };
    }
    const wrist = landmarks[WRIST] ?? { x: 0, y: 0, z: 0 };
    const indexTipLm = landmarks[INDEX_TIP] ?? wrist;
    const middleMcp = landmarks[MIDDLE_MCP] ?? wrist;
    const thumbTip = landmarks[THUMB_TIP] ?? wrist;

    const handSize = Math.max(dist(wrist, middleMcp), 1e-6);
    const pinchDistance = dist(thumbTip, indexTipLm) / handSize;
    const palmCenter = {
      x: (wrist.x + middleMcp.x) / 2,
      y: (wrist.y + middleMcp.y) / 2,
    };
    const indexTip = { x: indexTipLm.x, y: indexTipLm.y };

    // --- pinch with hysteresis ---
    let pinchChanged = false;
    if (!this.penDown && pinchDistance < this.config.pinchThreshold) {
      this.penDown = true;
      pinchChanged = true;
    } else if (this.penDown && pinchDistance > this.config.pinchReleaseThreshold) {
      this.penDown = false;
      pinchChanged = true;
    }

    // --- finger extension helpers ---
    const extended = (tipIdx: number, pipIdx: number): boolean =>
      dist(landmarks[tipIdx] ?? wrist, wrist) > dist(landmarks[pipIdx] ?? wrist, wrist) * 1.05;
    const indexExt = extended(INDEX_TIP, 6);
    const middleExt = extended(12, 10);
    const ringExt = extended(16, 14);
    const pinkyExt = extended(20, 18);
    const thumbExt = dist(thumbTip, wrist) > dist(landmarks[2] ?? wrist, wrist) * 1.02;

    const openPalm = indexExt && middleExt && ringExt && pinkyExt && thumbExt;
    const twoFinger = indexExt && middleExt && !ringExt && !pinkyExt;
    const fist = !indexExt && !middleExt && !ringExt && !pinkyExt;

    // --- swipe detection (open palm, horizontal, with cooldown) ---
    let swipe: 'next' | 'prev' | null = null;
    this.palmHistory.push({ x: palmCenter.x, y: palmCenter.y, t: nowMs });
    this.palmHistory = this.palmHistory.filter((p) => nowMs - p.t < 400);
    if (this.config.enablePageSwipe && openPalm && nowMs - this.lastSwipeAt > 1500) {
      const first = this.palmHistory[0];
      const last = this.palmHistory[this.palmHistory.length - 1];
      if (first && last) {
        const dx = last.x - first.x;
        const dy = Math.abs(last.y - first.y);
        const dt = Math.max(last.t - first.t, 1);
        if (Math.abs(dx) > 0.22 && dy < Math.abs(dx) * 0.6 && dt < 350) {
          swipe = dx > 0 ? 'prev' : 'next';
          this.lastSwipeAt = nowMs;
          this.palmHistory = [];
        }
      }
    }

    // --- fist-hold pause (~1 s) ---
    let pauseTriggered = false;
    if (this.config.enablePauseFist && fist) {
      if (this.fistSince === null) this.fistSince = nowMs;
      if (nowMs - this.fistSince >= 1000 && !this.pauseFired) {
        pauseTriggered = true;
        this.pauseFired = true;
      }
    } else {
      this.fistSince = null;
      this.pauseFired = false;
    }

    // --- primary kind (priority: pen-down > erase > fist > hover) ---
    let kind: GestureKind = 'none';
    if (this.penDown) kind = 'pen-down';
    else if (this.config.enableErase && (openPalm || twoFinger)) kind = 'erase';
    else if (fist) kind = 'fist';
    else if (indexExt) kind = 'hover';

    return {
      kind,
      indexTip,
      palmCenter,
      pinchDistance,
      handSize,
      pinchChanged,
      swipe,
      pauseTriggered,
    };
  }
}

/** How a finger is posed in a synthetic hand. */
export type FingerPose = 'extended' | 'curled';

export interface SyntheticHandPose {
  /** Palm centre in normalized camera coords (default 0.5, 0.5). */
  palm?: { x: number; y: number };
  /** Wrist→middle-MCP distance in normalized units (default 0.12). */
  handSize?: number;
  thumb?: FingerPose;
  index?: FingerPose;
  middle?: FingerPose;
  ring?: FingerPose;
  pinky?: FingerPose;
  /** Place the thumb tip on the index tip (pen-down). */
  pinch?: boolean;
}

/**
 * Build a synthetic 21-landmark hand with plausible geometry.
 * Used by unit tests and the practice sandbox. Coordinates are normalized
 * camera coords with y pointing down (as MediaPipe returns them).
 */
export function makeSyntheticHand(pose: SyntheticHandPose = {}): Landmark[] {
  const palm = pose.palm ?? { x: 0.5, y: 0.5 };
  const hs = pose.handSize ?? 0.12;
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ x: palm.x, y: palm.y, z: 0 }));

  const wrist = { x: palm.x, y: palm.y + hs * 0.5 };
  const middleMcp = { x: palm.x, y: palm.y - hs * 0.5 };
  lm[0] = { ...wrist, z: 0 };
  lm[5] = { x: palm.x - hs * 0.45, y: palm.y - hs * 0.45, z: 0 };
  lm[9] = { ...middleMcp, z: 0 };
  lm[13] = { x: palm.x + hs * 0.45, y: palm.y - hs * 0.4, z: 0 };
  lm[17] = { x: palm.x + hs * 0.85, y: palm.y - hs * 0.3, z: 0 };

  // Finger chains: [mcp, pip, dip, tip]
  const chains: [number, number, number, number, FingerPose][] = [
    [5, 6, 7, 8, pose.index ?? 'extended'],
    [9, 10, 11, 12, pose.middle ?? 'extended'],
    [13, 14, 15, 16, pose.ring ?? 'extended'],
    [17, 18, 19, 20, pose.pinky ?? 'extended'],
  ];
  for (const [mcp, pip, dip, tip, fingerPose] of chains) {
    const base = lm[mcp]!;
    if (fingerPose === 'extended') {
      lm[pip] = { x: base.x, y: base.y - hs * 0.4, z: 0 };
      lm[dip] = { x: base.x, y: base.y - hs * 0.7, z: 0 };
      lm[tip] = { x: base.x, y: base.y - hs * 1.0, z: 0 };
    } else {
      lm[pip] = { x: base.x, y: base.y - hs * 0.25, z: 0 };
      lm[dip] = { x: base.x, y: base.y + hs * 0.05, z: 0 };
      lm[tip] = { x: base.x, y: base.y + hs * 0.10, z: 0 };
    }
  }

  // Thumb chain: [cmc(1), mcp(2), ip(3), tip(4)]
  const thumbBase = { x: palm.x - hs * 0.6, y: palm.y + hs * 0.15 };
  lm[1] = { x: palm.x - hs * 0.35, y: palm.y + hs * 0.3, z: 0 };
  lm[2] = { ...thumbBase, z: 0 };
  if ((pose.thumb ?? 'extended') === 'extended') {
    lm[3] = { x: thumbBase.x - hs * 0.5, y: thumbBase.y - hs * 0.35, z: 0 };
    lm[4] = { x: thumbBase.x - hs * 1.0, y: thumbBase.y - hs * 0.7, z: 0 };
  } else {
    lm[3] = { x: thumbBase.x + hs * 0.05, y: thumbBase.y + hs * 0.05, z: 0 };
    lm[4] = { x: thumbBase.x + hs * 0.1, y: thumbBase.y + hs * 0.15, z: 0 };
  }
  if (pose.pinch) {
    const indexTip = lm[8]!;
    lm[4] = { x: indexTip.x + hs * 0.02, y: indexTip.y + hs * 0.02, z: 0 };
  }
  return lm;
}
