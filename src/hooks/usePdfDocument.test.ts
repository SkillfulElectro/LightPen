import { describe, expect, it, vi } from 'vitest';
import { classifyPdfError, getPageGeometry, loadPdf, type PageGeometry } from './usePdfDocument';

describe('classifyPdfError', () => {
  it('recognises password-protected documents', () => {
    expect(classifyPdfError({ name: 'PasswordException', message: 'no password' })).toBe(
      'encrypted',
    );
    expect(classifyPdfError(new Error('Please enter a password'))).toBe('encrypted');
  });

  it('recognises corrupt documents', () => {
    expect(classifyPdfError(new Error('Invalid PDF structure'))).toBe('corrupt');
    expect(classifyPdfError(new Error('malformed header'))).toBe('corrupt');
  });

  it('falls back to unknown', () => {
    expect(classifyPdfError(new Error('something odd'))).toBe('unknown');
    expect(classifyPdfError(undefined)).toBe('unknown');
  });
});

describe('getPageGeometry', () => {
  const fakeDoc = (rotate: number, width = 612, height = 792) =>
    ({
      getPage: vi.fn(async () => ({
        rotate,
        cleanup: vi.fn(),
        getViewport: () => ({ width, height }),
      })),
    }) as unknown as Parameters<typeof getPageGeometry>[0];

  it('normalises the rotation to 0/90/180/270 and caches the result', async () => {
    const cache: (PageGeometry | undefined)[] = [];
    const doc = fakeDoc(450); // 450 % 360 = 90
    const first = await getPageGeometry(doc, 0, cache);
    expect(first).toEqual({ width: 612, height: 792, rotate: 90 });
    const second = await getPageGeometry(doc, 0, cache);
    expect(second).toBe(first);
    expect((doc as unknown as { getPage: ReturnType<typeof vi.fn> }).getPage).toHaveBeenCalledTimes(
      1,
    );
  });

  it('treats unexpected rotations as unrotated', async () => {
    const cache: (PageGeometry | undefined)[] = [];
    expect((await getPageGeometry(fakeDoc(45), 0, cache)).rotate).toBe(0);
  });
});

describe('loadPdf', () => {
  it('rejects documents above the size cap before parsing', async () => {
    const huge = new Uint8Array(201 * 1024 * 1024);
    await expect(loadPdf(huge)).rejects.toMatchObject({ kind: 'too-large' });
  });
});
