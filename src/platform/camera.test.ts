/**
 * Camera startup, focused on the failure that made the Linux AppImage useless:
 * WebKitGTK reports "no device" for a camera that exists, because the build has
 * no GStreamer capture plugins. Telling that user to "check that one is
 * connected" sends them to the wrong place, so the error kind must differ.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraError, startCamera, type CameraErrorKind } from './camera';

type Behaviour =
  { kind: 'ok' } | { kind: 'throw'; name: string } | { kind: 'throw-once-then-ok'; name: string };

/** Replace navigator.mediaDevices with a scripted fake. */
function fakeMedia({ getUserMedia, devices }: { getUserMedia: Behaviour; devices: string[] }) {
  let calls = 0;
  const gUM = vi.fn(async () => {
    calls += 1;
    const b = getUserMedia;
    if (b.kind === 'ok') return {} as MediaStream;
    if (b.kind === 'throw-once-then-ok') {
      if (calls === 1) {
        const e = new Error('nope');
        e.name = b.name;
        throw e;
      }
      return {} as MediaStream;
    }
    const e = new Error('nope');
    e.name = b.name;
    throw e;
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: gUM,
      enumerateDevices: vi.fn(async () => devices.map((kind) => ({ kind }))),
    },
  });
  return gUM;
}

/** Run startCamera against a scripted fake and report how it failed. */
async function failure(
  behaviour: Behaviour,
  devices: string[],
): Promise<{ kind: CameraErrorKind; calls: number }> {
  const gUM = fakeMedia({ getUserMedia: behaviour, devices });
  try {
    await startCamera(null);
  } catch (err) {
    expect(err).toBeInstanceOf(CameraError);
    return { kind: (err as CameraError).kind, calls: gUM.mock.calls.length };
  }
  throw new Error('expected startCamera to reject');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('startCamera', () => {
  it('returns the stream on the first attempt', async () => {
    const gUM = fakeMedia({ getUserMedia: { kind: 'ok' }, devices: ['videoinput'] });
    await expect(startCamera(null)).resolves.toBeTruthy();
    expect(gUM).toHaveBeenCalledTimes(1);
  });

  it('retries once with loose constraints before giving up', async () => {
    // Some webviews refuse the ideal width/height but accept a bare request.
    const gUM = fakeMedia({
      getUserMedia: { kind: 'throw-once-then-ok', name: 'OverconstrainedError' },
      devices: ['videoinput'],
    });
    await expect(startCamera(null)).resolves.toBeTruthy();
    expect(gUM).toHaveBeenCalledTimes(2);
    expect(gUM.mock.calls[1]).toEqual([{ video: true, audio: false }]);
  });

  it('reports a denied permission as denied, without retrying', async () => {
    const result = await failure({ kind: 'throw', name: 'NotAllowedError' }, []);
    expect(result.kind).toBe('denied');
    // Exactly one attempt: a denial does not become an approval because we ask
    // again with looser constraints.
    expect(result.calls).toBe(1);
  });

  it('reports a camera held by another app as in-use', async () => {
    await expect(
      failure({ kind: 'throw', name: 'NotReadableError' }, ['videoinput']),
    ).resolves.toMatchObject({ kind: 'in-use' });
  });

  it('reports a genuinely absent camera as not-found', async () => {
    // NotFoundError is not ambiguous: the webview already said there is no
    // device, so a missing-plugin message would be a wrong guess.
    await expect(failure({ kind: 'throw', name: 'NotFoundError' }, [])).resolves.toMatchObject({
      kind: 'not-found',
    });
  });

  it('reports the missing GStreamer stack on Linux as no-capture, not not-found', async () => {
    // The AppImage failure: the OS has a camera, the webview enumerates zero
    // video inputs and rejects with OverconstrainedError. That is a packaging
    // bug, and the message has to say so.
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 WebKitGTK/2.48.0',
    );
    const result = await failure({ kind: 'throw', name: 'OverconstrainedError' }, []);
    expect(result.kind).toBe('no-capture');
    // It tried the loose constraints first, so the message is about the build,
    // not about the request being too specific.
    expect(result.calls).toBe(2);
  });

  it('keeps not-found on Linux when the webview does list a camera', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)');
    // A listed camera plus OverconstrainedError means the constraints were
    // wrong, not the build.
    await expect(
      failure({ kind: 'throw', name: 'OverconstrainedError' }, ['videoinput']),
    ).resolves.toMatchObject({ kind: 'not-found' });
  });
});
