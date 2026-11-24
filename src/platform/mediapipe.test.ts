import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { makeSyntheticHand } from '../core/gesture';
import {
  detectHand,
  getFrameSourceMode,
  isLinuxWebKit,
  pickBestHand,
  resetDetectionSession,
} from './mediapipe';

describe('isLinuxWebKit', () => {
  it('identifies Linux WebKitGTK user agents', () => {
    expect(
      isLinuxWebKit(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15',
      ),
    ).toBe(true);
  });

  it('does not flag Chrome, Chromium, or Android', () => {
    expect(
      isLinuxWebKit(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      ),
    ).toBe(false);
    expect(
      isLinuxWebKit(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36',
      ),
    ).toBe(false);
  });
});

describe('pickBestHand', () => {
  it('matches dominant hand accounting for selfie mirroring and falls back rather than dropping', () => {
    const big = makeSyntheticHand({ handSize: 0.18 });
    const small = makeSyntheticHand({ handSize: 0.1 });
    // In a mirrored front camera, MediaPipe labels the user right hand as "Left".
    const pickedRight = pickBestHand(
      [small, big],
      [[{ categoryName: 'Left' }], [{ categoryName: 'Right' }]],
      'right',
      true,
    );
    expect(pickedRight?.landmarks).toBe(small);

    // If only the other handedness is visible, fall back instead of returning null.
    const fallback = pickBestHand([big], [[{ categoryName: 'Right' }]], 'right', true);
    expect(fallback?.landmarks).toBe(big);
  });
});

describe('detectHand recovery', () => {
  afterEach(() => {
    resetDetectionSession();
    vi.restoreAllMocks();
  });

  it('steps down from video to canvas readback when detectForVideo throws on the video element', () => {
    resetDetectionSession();
    const fakeCtx = { drawImage: vi.fn(), getImageData: vi.fn() };
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'canvas') {
        (el as HTMLCanvasElement).getContext = (() =>
          fakeCtx) as unknown as HTMLCanvasElement['getContext'];
      }
      return el;
    });

    const hand = makeSyntheticHand();
    const video = { readyState: 4, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;
    const landmarker = {
      detectForVideo: vi.fn((source: unknown) => {
        if (source === video) throw new Error('texImage2D failed');
        return { landmarks: [hand], handedness: [[{ categoryName: 'Right' }]] };
      }),
    } as unknown as HandLandmarker;

    const res = detectHand(landmarker, video, 100, 'auto', true);
    expect(res?.landmarks).toBe(hand);
    expect(getFrameSourceMode()).toBe('canvas');
  });

  it('probes 2D canvas readback after silent empty video frames and locks onto canvas when found', () => {
    resetDetectionSession();
    const fakeCtx = { drawImage: vi.fn(), getImageData: vi.fn() };
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'canvas') {
        (el as HTMLCanvasElement).getContext = (() =>
          fakeCtx) as unknown as HTMLCanvasElement['getContext'];
      }
      return el;
    });

    const hand = makeSyntheticHand();
    const video = { readyState: 4, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;
    const landmarker = {
      detectForVideo: vi.fn((source: unknown) => {
        // Simulate silent black texture upload on direct <video> input.
        if (source === video) return { landmarks: [], handedness: [] };
        return { landmarks: [hand], handedness: [[{ categoryName: 'Right' }]] };
      }),
    } as unknown as HandLandmarker;

    let detected = null;
    for (let i = 0; i < 15; i++) {
      detected = detectHand(landmarker, video, 100 + i * 33, 'auto', true);
      if (detected) break;
    }
    expect(detected?.landmarks).toBe(hand);
    expect(getFrameSourceMode()).toBe('canvas');
  });
});
