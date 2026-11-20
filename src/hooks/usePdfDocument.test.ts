import { describe, expect, it, vi } from 'vitest';
import {
  classifyPdfError,
  getPageGeometry,
  loadPdf,
  resolveApi,
  setPdfJsApi,
  type PageGeometry,
  type PdfJsApi,
} from './usePdfDocument';

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

describe('injectable pdf.js API', () => {
  const fakeDoc = {
    numPages: 2,
    getPage: vi.fn(async () => ({
      rotate: 0,
      cleanup: vi.fn(),
      getViewport: () => ({ width: 300, height: 400 }),
    })),
  };

  it('routes loadPdf through the injected implementation and restores it', async () => {
    const legacy = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const getDocument = vi.fn(() => ({ promise: Promise.resolve(fakeDoc) }));
    setPdfJsApi({ getDocument } as unknown as PdfJsApi);
    try {
      const loaded = await loadPdf(new Uint8Array([1, 2, 3]));
      expect(getDocument).toHaveBeenCalledTimes(1);
      expect(loaded.pageCount).toBe(2);
      expect(loaded.pageSizes[0]).toEqual({ width: 300, height: 400 });
      // Later pages keep the Letter default until they are visited.
      expect(loaded.pageSizes[1]).toEqual({ width: 612, height: 792 });
    } finally {
      setPdfJsApi(legacy as unknown as PdfJsApi);
    }
  });

  it('resolves an ES module namespace or a default export', () => {
    const api = { getDocument: vi.fn() } as unknown as PdfJsApi;
    expect(resolveApi(api as never)).toBe(api);
    expect(resolveApi({ default: api } as never)).toBe(api);
    expect(resolveApi(undefined)).toBeTruthy();
  });
});
