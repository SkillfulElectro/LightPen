import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SidecarData } from '../core/types';
import { createSidecarWriter, restoreAnnotations } from './sidecar';

const empty = (): SidecarData => ({ version: 1, strokes: [], updatedAt: 0 });

describe('createSidecarWriter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('waits for the debounce before writing, once', async () => {
    const save = vi.fn(async () => {});
    const writer = createSidecarWriter(800, save);
    writer.schedule({ key: 'k1', serialize: empty });
    writer.schedule({ key: 'k1', serialize: empty });
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('k1', expect.objectContaining({ version: 1 }));
  });

  it('does not let continuous drawing postpone the save past the cap', async () => {
    // Drawing without pause used to keep restarting the debounce, so a crash
    // lost everything drawn in the session.
    let clock = 0;
    const save = vi.fn(async () => {});
    const writer = createSidecarWriter(800, save, () => clock);
    for (let i = 0; i < 8; i += 1) {
      writer.schedule({ key: 'k1', serialize: empty });
      clock += 700;
      await vi.advanceTimersByTimeAsync(700);
    }
    expect(save).toHaveBeenCalled();
  });

  it('writes the newest state for the newest document', async () => {
    const calls: string[] = [];
    const save = vi.fn(async (key: string, data: SidecarData) => {
      calls.push(`${key}:${data.version}`);
    });
    const writer = createSidecarWriter(800, save);
    writer.schedule({ key: 'old', serialize: empty });
    writer.schedule({ key: 'new', serialize: empty });
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toEqual(['new:1']);
  });

  it('flush writes immediately and cancels the timer', async () => {
    const save = vi.fn(async () => {});
    const writer = createSidecarWriter(800, save);
    writer.schedule({ key: 'k', serialize: empty });
    await writer.flush();
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush is a no-op when nothing is pending', async () => {
    const save = vi.fn(async () => {});
    await createSidecarWriter(800, save).flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('cancel drops the pending write', async () => {
    const save = vi.fn(async () => {});
    const writer = createSidecarWriter(800, save);
    writer.schedule({ key: 'k', serialize: empty });
    writer.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('restoreAnnotations', () => {
  it('starts clean when a document has no sidecar', async () => {
    localStorage.clear();
    const store = await restoreAnnotations('nope');
    expect(store.all).toEqual([]);
  });

  it('round-trips strokes written under a content key', async () => {
    const { saveSidecar } = await import('../platform/tauri');
    await saveSidecar('key-1', {
      version: 1,
      updatedAt: 5,
      strokes: [
        {
          id: 's1',
          page: 0,
          color: '#000',
          width: 2,
          createdAt: 1,
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
        },
      ],
    });
    const store = await restoreAnnotations('key-1');
    expect(store.all).toHaveLength(1);
    // A different document with the same name must not see these strokes.
    expect((await restoreAnnotations('key-2')).all).toHaveLength(0);
    localStorage.clear();
  });
});
