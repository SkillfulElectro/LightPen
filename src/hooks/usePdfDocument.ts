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
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const pageSizes: PageSize[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    pageSizes.push({ width: viewport.width, height: viewport.height });
    page.cleanup();
  }
  return { doc, pageCount: doc.numPages, pageSizes };
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
