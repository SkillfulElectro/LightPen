/**
 * "The camera opened but it stayed at 0 FPS and never saw my hand" must never
 * be a silent state again: every way the loop can fail has a name, a message
 * key and a diagnostics line.
 */
import { describe, expect, it } from 'vitest';
import {
  TRACKER_FAILURE_MESSAGE_KEY,
  USABLE_FPS,
  diagnoseTracker,
  diagnosticText,
  longHandAbsence,
  type TrackerSample,
} from './trackerHealth';

const healthy: TrackerSample = {
  videoWidth: 640,
  videoHeight: 480,
  readyState: 4,
  fps: 30,
  lostFrames: 0,
  detectorErrors: 0,
};

describe('diagnoseTracker', () => {
  it('says nothing while frames and detection are flowing', () => {
    expect(diagnoseTracker(healthy)).toBeNull();
    expect(diagnoseTracker({ ...healthy, lostFrames: 120 })).toBeNull();
  });

  it('reports no-frames when the stream has no dimensions yet', () => {
    const d = diagnoseTracker({ ...healthy, videoWidth: 0, videoHeight: 0, readyState: 0 });
    expect(d?.failure).toBe('no-frames');
    expect(d?.detail).toContain('readyState 0');
  });

  it('reports no-frames when the element has metadata but delivers nothing', () => {
    // readyState 1 = HAVE_METADATA: exactly the "camera opened, 0 FPS" case.
    const d = diagnoseTracker({ ...healthy, readyState: 1, fps: 0 });
    expect(d?.failure).toBe('no-frames');
  });

  it('blames the detector, not the camera, when it throws and nothing moves', () => {
    const d = diagnoseTracker({ ...healthy, fps: 0, detectorErrors: 5 });
    expect(d?.failure).toBe('detector-error');
    expect(d?.detail).toContain('5 detector error(s)');
  });

  it('prefers no-frames when both a dead stream and detector errors are present', () => {
    const d = diagnoseTracker({ ...healthy, readyState: 0, fps: 0, detectorErrors: 9 });
    expect(d?.failure).toBe('no-frames');
  });

  it('tolerates a slow-but-working stream instead of crying failure', () => {
    expect(diagnoseTracker({ ...healthy, fps: USABLE_FPS })).toBeNull();
    expect(diagnoseTracker({ ...healthy, fps: USABLE_FPS - 1 })?.failure).toBe('no-frames');
  });
});

describe('longHandAbsence', () => {
  it('stays quiet during the first few seconds without a hand', () => {
    expect(longHandAbsence({ ...healthy, lostFrames: 120 })).toBeNull();
  });

  it('nags once the stream runs but no hand has appeared for a long time', () => {
    const d = longHandAbsence({ ...healthy, lostFrames: 400 });
    expect(d?.failure).toBe('no-hand');
  });

  it('does not duplicate the no-frames message on a dead stream', () => {
    expect(longHandAbsence({ ...healthy, fps: 0, lostFrames: 400 })).toBeNull();
  });
});

describe('diagnosticText', () => {
  it('includes the failure, the measurements and the UA for a bug report', () => {
    const d = diagnoseTracker({ ...healthy, readyState: 1, fps: 0 })!;
    const text = diagnosticText(d, 'Mozilla/5.0 (X11; Linux)');
    expect(text).toContain('no-frames');
    expect(text).toContain('readyState 1');
    expect(text).toContain('UA: Mozilla/5.0 (X11; Linux)');
  });

  it('maps every failure to an existing camera message key', () => {
    expect(Object.values(TRACKER_FAILURE_MESSAGE_KEY).every((k) => k.startsWith('camera.'))).toBe(
      true,
    );
    // Flat keys: the catalogue has no nested namespaces under `camera`.
    expect(new Set(Object.values(TRACKER_FAILURE_MESSAGE_KEY)).size).toBe(3);
  });
});
