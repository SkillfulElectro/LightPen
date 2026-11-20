import { describe, expect, it } from 'vitest';
import { contentKey, sidecarFileName } from './docIdentity';

const bytes = (...n: number[]) => new Uint8Array(n);

describe('contentKey', () => {
  it('is stable for identical bytes', () => {
    expect(contentKey(bytes(1, 2, 3))).toBe(contentKey(bytes(1, 2, 3)));
  });

  it('differs when a single byte changes', () => {
    expect(contentKey(bytes(1, 2, 3))).not.toBe(contentKey(bytes(1, 2, 4)));
  });

  it('differs for different lengths, even with equal prefixes', () => {
    expect(contentKey(bytes(1, 2, 3))).not.toBe(contentKey(bytes(1, 2, 3, 0)));
  });

  it('separates two same-named files with different content (ADR-020)', () => {
    expect(contentKey(bytes(9, 9, 9))).not.toBe(contentKey(bytes(9, 9, 8)));
  });

  it('is a short, path-safe token', () => {
    expect(contentKey(new Uint8Array(1000))).toMatch(/^[0-9a-z]+-[0-9a-f]{8}$/);
  });

  it('handles empty input', () => {
    expect(contentKey(new Uint8Array(0))).toMatch(/^0-[0-9a-f]{8}$/);
  });
});

describe('sidecarFileName', () => {
  it('uses only the content key, never the document name', () => {
    expect(sidecarFileName('2a-1f2e3d4c')).toBe('2a-1f2e3d4c.lightpen.json');
  });

  it('gives same-named documents different sidecars', () => {
    expect(sidecarFileName(contentKey(bytes(1)))).not.toBe(sidecarFileName(contentKey(bytes(2))));
  });

  it('cannot produce a path traversal or an empty name', () => {
    expect(sidecarFileName('../../etc/passwd')).toBe('etcpasswd.lightpen.json');
    expect(sidecarFileName('')).toBe('unknown.lightpen.json');
    expect(sidecarFileName('<>:"|?*')).toBe('unknown.lightpen.json');
  });

  it('caps the length', () => {
    expect(sidecarFileName('x'.repeat(500)).length).toBeLessThanOrEqual(
      64 + '.lightpen.json'.length,
    );
  });
});
