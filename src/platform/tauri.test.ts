import { describe, expect, it } from 'vitest';
import { sidecarFileName } from './tauri';

describe('sidecarFileName', () => {
  it('appends the sidecar suffix', () => {
    expect(sidecarFileName('report.pdf')).toBe('report.pdf.lightpen.json');
  });

  it('strips characters that are illegal in a file name', () => {
    // The important property: no path separator survives.
    expect(sidecarFileName('../../etc/passwd')).not.toContain('/');
    expect(sidecarFileName('a/b:c*d?e"f<g>h|i.pdf')).toBe('abcdefghi.pdf.lightpen.json');
  });

  it('never returns an empty base name', () => {
    expect(sidecarFileName('')).toBe('document.lightpen.json');
  });

  it('caps the length so the path stays usable', () => {
    expect(sidecarFileName(`${'x'.repeat(500)}.pdf`).length).toBeLessThanOrEqual(140);
  });
});
