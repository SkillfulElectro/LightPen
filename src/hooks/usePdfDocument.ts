/**
 * pdf.js document handling: loading, page sizes, serialized render queue with
 * awaited cancellation, safe canvas memory budgets, and canvas cleanup.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { computeSafeCanvasSize } from '../core/coords';
import type { PageSize } from '../core/types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * pdf.js API surface used here. Injectable so tests (and future embedders) can
 * supply a build that runs without a module worker — under Node the bundler
 * worker cannot be imported, so tests pass `pdfjs-dist/legacy/build/pdf.mjs`.
 */
export type PdfJsApi = Pick<typeof pdfjs, 'getDocument'>;
type PdfModule = typeof pdfjs & { default?: typeof pdfjs };

/** Resolve a dynamically imported pdf.js module (ESM namespace or default). */
export function resolveApi(mod: PdfModule | undefined): PdfJsApi {
  return (mod?.getDocument ? mod : (mod?.default ?? pdfjs)) as PdfJsApi;
}

/** Set once at start-up (or by tests) to override the pdf.js implementation. */
export function setPdfJsApi(api: PdfJsApi): void {
  activeApi = api;
}

let activeApi: PdfJsApi | null = null;
function api(): PdfJsApi {
  return activeApi ?? pdfjs;
}

export type PdfErrorKind = 'encrypted' | 'corrupt' | 'too-large' | 'unknown';

/** i18n key (under `viewer.`) for each error kind. Explicit, so a rename of one
 * side cannot silently fall back to showing the raw key to the user. */
export const PDF_ERROR_MESSAGE_KEY: Record<PdfErrorKind, string> = {
  encrypted: 'viewer.encrypted',
  corrupt: 'viewer.corrupt',
  'too-large': 'viewer.tooLarge',
  unknown: 'viewer.unknown',
};

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
  const doc = await api().getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  // Page sizes are read lazily (getPageGeometry) so large documents open fast;
  // only the first page is probed here, as a sensible initial default.
  const pageSizes: PageSize[] = new Array<PageSize>(doc.numPages).fill({
    width: 612,
    height: 792,
  });
  try {
    const first = await doc.getPage(1);
    const viewport = first.getViewport({ scale: 1 });
    if (Number.isFinite(viewport.width) && Number.isFinite(viewport.height)) {
      pageSizes[0] = { width: viewport.width, height: viewport.height };
    }
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
  const safeIndex = Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : 0;
  const cached = cache[safeIndex];
  if (cached) return cached;
  const page = await doc.getPage(safeIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const rotate = ((page.rotate % 360) + 360) % 360;
  const geometry: PageGeometry = {
    width: Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : 612,
    height: Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : 792,
    rotate: (rotate === 90 || rotate === 180 || rotate === 270
      ? rotate
      : 0) as PageGeometry['rotate'],
  };
  cache[safeIndex] = geometry;
  return geometry;
}

/**
 * Render a page into a canvas with a strictly serialized render queue:
 * starting a new render cancels any active pdf.js RenderTask and *awaits* its
 * cancellation before reusing the canvas, preventing the fatal pdf.js crash
 * "Cannot use the same canvas during multiple render() operations".
 */
export function usePageRenderer(doc: pdfjs.PDFDocumentProxy | null) {
  const renderTaskRef = useRef<pdfjs.RenderTask | null>(null);
  const renderGenRef = useRef(0);
  const [rendering, setRendering] = useState(false);

  const renderPage = useCallback(
    async (pageIndex: number, canvas: HTMLCanvasElement, scale: number): Promise<void> => {
      if (!doc) return;
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.numPages) return;
      if (!Number.isFinite(scale) || scale <= 0) return;

      const gen = ++renderGenRef.current;

      // Cancel any in-flight render and wait for pdf.js to release the canvas.
      const prevTask = renderTaskRef.current;
      if (prevTask) {
        renderTaskRef.current = null;
        try {
          prevTask.cancel();
        } catch {
          // ignore
        }
        try {
          await prevTask.promise;
        } catch {
          // Expected RenderingCancelledException when superseded.
        }
      }

      if (gen !== renderGenRef.current) return;

      setRendering(true);
      try {
        const page = await doc.getPage(pageIndex + 1);
        if (gen !== renderGenRef.current) return;

        const viewport = page.getViewport({ scale });
        if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) return;

        const safe = computeSafeCanvasSize(
          viewport.width,
          viewport.height,
          window.devicePixelRatio || 1,
        );
        canvas.width = safe.width;
        canvas.height = safe.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx || gen !== renderGenRef.current) return;
        ctx.setTransform(safe.scaleX, 0, 0, safe.scaleY, 0, 0);

        const task = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
        if (renderTaskRef.current === task) {
          renderTaskRef.current = null;
        }
      } catch (err) {
        const name = (err as { name?: string })?.name ?? '';
        const message = (err as { message?: string })?.message ?? '';
        // RenderingCancelledException or destroyed document is expected on page/doc switch.
        if (
          name !== 'RenderingCancelledException' &&
          !/Rendering cancelled|Transport destroyed/i.test(message)
        ) {
          throw err;
        }
      } finally {
        if (gen === renderGenRef.current) {
          setRendering(false);
        }
      }
    },
    [doc],
  );

  useEffect(() => {
    return () => {
      renderGenRef.current += 1;
      const task = renderTaskRef.current;
      renderTaskRef.current = null;
      try {
        task?.cancel();
      } catch {
        // ignore
      }
    };
  }, [doc]);

  return { renderPage, rendering };
}
