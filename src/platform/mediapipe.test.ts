import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { makeSyntheticHand } from '../core/gesture';
import {
  detectHand,
  getFrameSourceMode,
  hasLiveFramePixels,
  imageDataHasPixels,
  isLandmarkerClosed,
  isLinuxWebKit,
  pickBestHand,
  resetDetectionSession,
} from './mediapipe';

describe('isLinuxWebKit', () => {
  it('identifies Linux WebKitGTK user agents', () => {
    expect(
      isLinuxWebKit(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/605.1.15 Safari/605.1.15',
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

describe('imageDataHasPixels & isLandmarkerClosed', () => {
  it('detects black vs non-black RGBA buffers cleanly', () => {
    expect(imageDataHasPixels(null)).toBe(false);
    const black = { data: new Uint8ClampedArray(64) } as unknown as ImageData;
    expect(imageDataHasPixels(black)).toBe(false);
    const lit = {
      data: new Uint8ClampedArray([0, 0, 0, 255, 80, 90, 100, 255, 0, 0, 0, 255]),
    } as unknown as ImageData;
    expect(imageDataHasPixels(lit)).toBe(true);
  });

  it('flags null or undefined landmarker as closed and live mocks as open', () => {
    expect(isLandmarkerClosed(null)).toBe(true);
    expect(isLandmarkerClosed(undefined)).toBe(true);
    expect(isLandmarkerClosed({} as HandLandmarker)).toBe(false);
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
    const fakeImageData = { data: new Uint8ClampedArray([12, 24, 36, 255]) } as ImageData;
    const fakeCtx = { drawImage: vi.fn(), getImageData: vi.fn(() => fakeImageData) };
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
    expect(hasLiveFramePixels()).toBe(true);
  });

  it('probes 2D canvas readback after silent empty video frames and locks onto canvas when found', () => {
    resetDetectionSession();
    const fakeImageData = { data: new Uint8ClampedArray([40, 50, 60, 255]) } as ImageData;
    const fakeCtx = { drawImage: vi.fn(), getImageData: vi.fn(() => fakeImageData) };
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

  it('progresses from video -> canvas -> raw imagedata after sustained empty frames so RGBA bytes reach MediaPipe', () => {
    resetDetectionSession();
    const fakeImageData = {
      data: new Uint8ClampedArray([55, 66, 77, 255]),
      width: 384,
      height: 288,
    } as unknown as ImageData;
    const fakeCtx = { drawImage: vi.fn(), getImageData: vi.fn(() => fakeImageData) };
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
        // Only raw ImageData succeeds (simulating broken WebKitGTK video & canvas textures).
        if (source === fakeImageData) {
          return { landmarks: [hand], handedness: [[{ categoryName: 'Right' }]] };
        }
        return { landmarks: [], handedness: [] };
      }),
    } as unknown as HandLandmarker;

    let detected = null;
    for (let i = 0; i < 45; i++) {
      detected = detectHand(landmarker, video, 100 + i * 33, 'auto', true);
      if (detected) break;
    }
    expect(detected?.landmarks).toBe(hand);
    expect(getFrameSourceMode()).toBe('imagedata');
    expect(hasLiveFramePixels()).toBe(true);
  });
});
