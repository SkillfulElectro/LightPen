import { describe, expect, it } from 'vitest';
import { loadSidecar, saveSidecar } from './tauri';

describe('sidecar round trip (web build)', () => {
  const data = { version: 1 as const, strokes: [], updatedAt: 1 };

  it('stores per document key, so same-named files do not collide', async () => {
    localStorage.clear();
    await saveSidecar('2a-aaaaaaaa', { ...data, updatedAt: 111 });
    expect((await loadSidecar('2a-aaaaaaaa'))?.updatedAt).toBe(111);
    await expect(loadSidecar('2a-bbbbbbbb')).resolves.toBeNull();
  });

  it('keeps the last write for the same document', async () => {
    localStorage.clear();
    await saveSidecar('k', { ...data, updatedAt: 1 });
    await saveSidecar('k', { ...data, updatedAt: 2 });
    expect((await loadSidecar('k'))?.updatedAt).toBe(2);
  });

  it('returns null instead of throwing on unreadable storage', async () => {
    localStorage.clear();
    localStorage.setItem('lightpen:sidecar:x', 'not json');
    await expect(loadSidecar('x')).resolves.toBeNull();
  });
});
