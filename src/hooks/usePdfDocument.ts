/**
 * pdf.js document handling: loading, page sizes, queued rendering with
 * cancellation and canvas cleanup (lazy rendering for large documents).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageSize } from '../core/types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfErrorKind = 'encrypted' | 'corrupt' | 'too-large' | 'unknown';

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB

export interface LoadedPdf {
  doc: pdfjs.PDFDocumentProxy;
  pageCount: number;
  pageSizes: PageSize[];
}

export function classifyPdfError(err: unknown): PdfErrorKind {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? '';
  if (name === 'PasswordException' || /password/i.test(message)) return 'encrypted';
  if (/invalid|corrupt|malformed|unexpected/i.test(message)) return 'corrupt';
  return 'unknown';
}

export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  if (bytes.length > MAX_BYTES) {
    const err = new Error('PDF exceeds 200 MB limit') as Error & { kind?: PdfErrorKind };
    err.kind = 'too-large';
    throw err;
  }
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  // Page sizes are read lazily (getPageGeometry) so large documents open fast;
  // only the first page is probed here, as a sensible initial default.
  const pageSizes: PageSize[] = new Array<PageSize>(doc.numPages).fill({
    width: 612,
    height: 792,
  });
  try {
    const first = await doc.getPage(1);
    const viewport = first.getViewport({ scale: 1 });
    pageSizes[0] = { width: viewport.width, height: viewport.height };
    first.cleanup();
  } catch {
    // Fall back to Letter; the viewer reports real page errors.
  }
  return { doc, pageCount: doc.numPages, pageSizes };
}

/** Page geometry (size in PDF points + rotation) of an arbitrary page. */
export interface PageGeometry {
  width: number;
  height: number;
  rotate: 0 | 90 | 180 | 270;
}

/** Page geometry of an arbitrary page, loading it on demand and caching it. */
export async function getPageGeometry(
  doc: pdfjs.PDFDocumentProxy,
  pageIndex: number,
  cache: (PageGeometry | undefined)[],
): Promise<PageGeometry> {
  const cached = cache[pageIndex];
  if (cached) return cached;
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const rotate = ((page.rotate % 360) + 360) % 360;
  const geometry: PageGeometry = {
    width: viewport.width,
    height: viewport.height,
    rotate: (rotate === 90 || rotate === 180 || rotate === 270
      ? rotate
      : 0) as PageGeometry['rotate'],
  };
  page.cleanup();
  cache[pageIndex] = geometry;
  return geometry;
}

/**
 * Render a page into a canvas with a render queue: starting a new render
 * cancels the previous one. Only the visible page is rendered (lazy).
 */
export function usePageRenderer(doc: pdfjs.PDFDocumentProxy | null) {
  const renderTaskRef = useRef<pdfjs.RenderTask | null>(null);
  const [rendering, setRendering] = useState(false);

  const renderPage = useCallback(
    async (pageIndex: number, canvas: HTMLCanvasElement, scale: number): Promise<void> => {
      if (!doc) return;
      try {
        renderTaskRef.current?.cancel();
      } catch {
        // ignore
      }
      setRendering(true);
      try {
        const page = await doc.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
        page.cleanup();
      } catch (err) {
        // RenderingCancelledException is expected when superseded.
        if ((err as { name?: string })?.name !== 'RenderingCancelledException') throw err;
      } finally {
        setRendering(false);
      }
    },
    [doc],
  );

  useEffect(() => {
    return () => {
      try {
        renderTaskRef.current?.cancel();
      } catch {
        // ignore
      }
    };
  }, []);

  return { renderPage, rendering };
}
