/**
 * PDF viewer: pdf.js page canvas + committed ink canvas + low-latency live stroke/cursor canvas.
 *
 * Crash & FPS fixes (v0.1.9):
 * - Committed strokes stay on `inkCanvasRef`; in-progress strokes render ONLY on
 *   `cursorCanvasRef`, eliminating O(N^2) full-page redraws on every pointermove.
 * - Safe canvas backing-store budgets (`computeSafeCanvasSize`) prevent OOM crashes
 *   when zooming to 400% on HiDPI displays.
 * - Defensive pointer capture (`try/catch`), finite coordinate validation, smooth
 *   quadratic ink curves, and clean `doc.destroy()` lifecycle management.
 * - Hardware-composited `desynchronized: true` 2D context where available.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addPoint, createStroke, hexToRgb } from '../core/annotations';
import {
  clampToPage,
  computeSafeCanvasSize,
  pageDisplaySize,
  pageViewportMatrix,
  pdfToViewport,
  viewportToPdf,
} from '../core/coords';
import type { ViewportMatrix } from '../core/coords';
import type { PageSize, Stroke } from '../core/types';
import {
  classifyPdfError,
  getPageGeometry,
  PDF_ERROR_MESSAGE_KEY,
  loadPdf,
  usePageRenderer,
  type PageGeometry,
  type PdfErrorKind,
} from '../hooks/usePdfDocument';
import { restoreAnnotations, useStore } from '../store/useStore';
import { contentKey } from '../core/docIdentity';
import { openPdfFile } from '../platform/tauri';
import { BrandNibIcon, FolderOpenIcon } from './Icons';

interface Props {
  pdfBytes: Uint8Array | null;
  pdfName: string | null;
  onPdfLoaded: (
    name: string,
    bytes: Uint8Array,
    pageCount: number,
    pageSizes: PageSize[],
    key: string,
  ) => void;
}

function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d', { desynchronized: true }) ?? canvas.getContext('2d');
  } catch {
    return canvas.getContext('2d');
  }
}

export default function PdfViewer({ pdfBytes, pdfName, onPdfLoaded }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const pageCanvasRef = useRef<HTMLCanvasElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<Awaited<ReturnType<typeof loadPdf>>['doc'] | null>(null);
  const [error, setError] = useState<PdfErrorKind | null>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [containerHeight, setContainerHeight] = useState(700);
  const [dragOver, setDragOver] = useState(false);
  const drawingRef = useRef<Stroke | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const manualDirtyRef = useRef(false);

  const currentPage = useStore((s) => s.currentPage);
  const zoom = useStore((s) => s.zoom);
  const fitMode = useStore((s) => s.fitMode);
  const tool = useStore((s) => s.tool);
  const strokesVersion = useStore((s) => s.strokesVersion);
  const settings = useStore((s) => s.settings);

  const { renderPage } = usePageRenderer(doc);

  // ---- load pdf.js document when bytes change ----
  useEffect(() => {
    drawingRef.current = null;
    activePointerIdRef.current = null;
    useStore.setState({ activeStroke: null });

    if (!pdfBytes) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    let loadedDoc: Awaited<ReturnType<typeof loadPdf>>['doc'] | null = null;
    setError(null);
    loadPdf(pdfBytes)
      .then(async (loaded) => {
        if (cancelled) {
          void loaded.doc.destroy?.();
          return;
        }
        loadedDoc = loaded.doc;
        geometryCache.current = [];
        setDoc(loaded.doc);
        const key = contentKey(pdfBytes);
        onPdfLoaded(pdfName ?? 'document.pdf', pdfBytes, loaded.pageCount, loaded.pageSizes, key);
        await restoreAnnotations(key);
        // Validate annotations against the real page count: a sidecar from a
        // different document must not create strokes on pages that do not exist.
        const store = useStore.getState().annotations;
        const stray = store.all.filter((s) => s.page >= loaded.pageCount);
        if (stray.length > 0) store.clearAll();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const kind = (err as { kind?: PdfErrorKind })?.kind;
        setError(kind ?? classifyPdfError(err));
      });
    return () => {
      cancelled = true;
      if (loadedDoc) {
        void loadedDoc.destroy?.();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfBytes]);

  // ---- track container width for fit modes ----
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect?.width && rect.width > 0) setContainerWidth(rect.width);
      if (rect?.height && rect.height > 0) setContainerHeight(rect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  // Geometry (size + rotation) of the visible page, read on demand so large
  // documents are not parsed up front.
  const geometryCache = useRef<(PageGeometry | undefined)[]>([]);
  const [geometry, setGeometry] = useState<PageGeometry | null>(null);
  useEffect(() => {
    if (!doc) {
      setGeometry(null);
      return;
    }
    let cancelled = false;
    setGeometry(null);
    getPageGeometry(doc, currentPage, geometryCache.current)
      .then((g) => {
        if (!cancelled) setGeometry(g);
      })
      .catch(() => {
        // Keep the Letter fallback; the render path reports real errors.
      });
    return () => {
      cancelled = true;
    };
  }, [doc, currentPage]);

  // Finalize any active manual stroke safely if the user switches pages mid-stroke.
  useEffect(() => {
    const stroke = drawingRef.current;
    if (stroke && stroke.page !== currentPage) {
      drawingRef.current = null;
      activePointerIdRef.current = null;
      useStore.setState({ activeStroke: null });
      if (stroke.points.length > 0) {
        useStore.getState().addStroke(stroke);
      }
    }
  }, [currentPage]);

  const pageGeometry = useMemo<PageGeometry>(
    () => geometry ?? { width: 612, height: 792, rotate: 0 },
    [geometry],
  );
  const pageSize = useMemo<PageSize>(
    () => ({ width: pageGeometry.width, height: pageGeometry.height }),
    [pageGeometry],
  );
  const rotation = pageGeometry.rotate;

  // Publish the on-screen page size so air-writing maps onto the right page.
  const setCurrentPageSize = useStore((s) => s.setCurrentPageSize);
  useEffect(() => {
    setCurrentPageSize(pageSize);
  }, [pageSize, setCurrentPageSize]);

  const display = pageDisplaySize(pageSize, rotation, 1);
  const scale =
    fitMode === 'fit-width'
      ? Math.max((containerWidth - 48) / display.width, 0.1)
      : fitMode === 'fit-page'
        ? Math.max(
            Math.min(
              (containerWidth - 48) / display.width,
              (containerHeight - 48) / display.height,
            ),
            0.1,
          )
        : zoom;

  /** PDF user space → canvas CSS pixels (rotation-aware, mirrors pdf.js). */
  const matrix = useMemo(
    () => pageViewportMatrix(pageSize, rotation, scale),
    [pageSize, rotation, scale],
  );
  const cssW = Math.max(1, display.width * scale);
  const cssH = Math.max(1, display.height * scale);

  // Keep the zoom percentage in the toolbar in sync with fit modes.
  useEffect(() => {
    if (fitMode === 'manual') return;
    if (Math.abs(useStore.getState().zoom - scale) > 0.01) useStore.getState().setFitScale(scale);
  }, [scale, fitMode]);

  // ---- render page whenever inputs change (serialized, never crashes on concurrent renders) ----
  useEffect(() => {
    const canvas = pageCanvasRef.current;
    if (!doc || !canvas) return;
    renderPage(currentPage, canvas, scale).catch((err: unknown) => {
      // Never leak an unhandled promise rejection from pdf.js.
      const kind = classifyPdfError(err);
      if (kind !== 'unknown') setError(kind);
    });
  }, [doc, currentPage, scale, renderPage]);

  // ---- render committed ink strokes ONLY when strokes or viewport change ----
  const drawCommittedInk = useCallback(() => {
    const canvas = inkCanvasRef.current;
    if (!canvas) return;
    const safe = computeSafeCanvasSize(cssW, cssH, window.devicePixelRatio || 1);
    if (canvas.width !== safe.width || canvas.height !== safe.height) {
      canvas.width = safe.width;
      canvas.height = safe.height;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    const ctx = get2dContext(canvas);
    if (!ctx) return;
    ctx.setTransform(safe.scaleX, 0, 0, safe.scaleY, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const strokes = useStore.getState().annotations.strokesForPage(currentPage);
    for (const stroke of strokes) {
      drawStroke(ctx, stroke, matrix, scale);
    }
  }, [currentPage, matrix, cssW, cssH, scale]);

  useEffect(() => {
    drawCommittedInk();
  }, [drawCommittedInk, strokesVersion]);

  // ---- live overlay: renders ONLY the single active stroke + hand cursor ----
  useEffect(() => {
    let raf = 0;
    let hadOverlayContent = false;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = cursorCanvasRef.current;
      if (!canvas) return;

      const state = useStore.getState();
      const cursor = state.handCursor;
      const liveStroke = drawingRef.current ?? state.activeStroke;
      const hasLiveStroke = Boolean(liveStroke && liveStroke.page === state.currentPage);
      const needsDraw = hasLiveStroke || Boolean(cursor) || manualDirtyRef.current;

      if (!needsDraw) {
        if (hadOverlayContent) {
          const ctx = get2dContext(canvas);
          if (ctx) {
            const safe = computeSafeCanvasSize(cssW, cssH, window.devicePixelRatio || 1);
            ctx.setTransform(safe.scaleX, 0, 0, safe.scaleY, 0, 0);
            ctx.clearRect(0, 0, cssW, cssH);
          }
          hadOverlayContent = false;
        }
        return;
      }

      manualDirtyRef.current = false;
      const safe = computeSafeCanvasSize(cssW, cssH, window.devicePixelRatio || 1);
      if (canvas.width !== safe.width || canvas.height !== safe.height) {
        canvas.width = safe.width;
        canvas.height = safe.height;
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
      }
      const ctx = get2dContext(canvas);
      if (!ctx) return;

      ctx.setTransform(safe.scaleX, 0, 0, safe.scaleY, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      if (hasLiveStroke && liveStroke) {
        drawStroke(ctx, liveStroke, matrix, scale);
      }

      if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) {
        const p = pdfToViewport({ x: cursor.x, y: cursor.y }, matrix);
        ctx.save();
        if (cursor.kind === 'erase') {
          ctx.beginPath();
          ctx.setLineDash([4, 3]);
          ctx.arc(p.x, p.y, 18 * scale, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(217, 119, 6, 0.14)';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#b45309';
          ctx.stroke();
        } else if (cursor.kind === 'pen-down') {
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(4, state.settings.penWidth * scale * 0.9), 0, Math.PI * 2);
          ctx.fillStyle = state.settings.penColor;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(37, 99, 235, 0.25)';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#2563eb';
          ctx.stroke();
        }
        ctx.restore();
      }
      hadOverlayContent = hasLiveStroke || Boolean(cursor);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cssW, cssH, matrix, scale]);

  // ---- manual drawing (mouse / touch / stylus) ----
  const toPdfPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = inkCanvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return clampToPage(viewportToPdf(x, y, matrix), pageSize);
  };

  const finishManualStroke = useCallback((pointerId?: number) => {
    if (
      pointerId !== undefined &&
      activePointerIdRef.current !== null &&
      pointerId !== activePointerIdRef.current
    ) {
      return;
    }
    const stroke = drawingRef.current;
    drawingRef.current = null;
    activePointerIdRef.current = null;
    manualDirtyRef.current = true;
    useStore.setState({ activeStroke: null });
    if (stroke && stroke.points.length > 0) {
      useStore.getState().addStroke(stroke);
    }
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!doc) return;
    // Ignore secondary mouse buttons (right-click context menu).
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = toPdfPoint(e);
    if (!p) return;

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or cancelled pointer events can reject setPointerCapture; safe to continue.
    }

    if (tool === 'eraser') {
      useStore.getState().eraseAt(currentPage, p, 12);
      drawingRef.current = null;
      activePointerIdRef.current = e.pointerId;
      return;
    }

    const stroke = createStroke(currentPage, settings.penColor, settings.penWidth, p);
    drawingRef.current = stroke;
    activePointerIdRef.current = e.pointerId;
    manualDirtyRef.current = true;
    useStore.setState({ activeStroke: stroke });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
    const p = toPdfPoint(e);
    if (!p) return;
    if (tool === 'eraser' && e.buttons > 0) {
      useStore.getState().eraseAt(currentPage, p, 12);
      return;
    }
    const stroke = drawingRef.current;
    if (stroke) {
      if (addPoint(stroke, p)) {
        manualDirtyRef.current = true;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      if ((e.currentTarget as HTMLElement).hasPointerCapture?.(e.pointerId)) {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }
    finishManualStroke(e.pointerId);
  };

  // ---- ctrl/cmd + wheel and trackpad pinch zoom around the pointer ----
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const px = e.clientX - rect.left + container.scrollLeft;
    const py = e.clientY - rect.top + container.scrollTop;
    const factor = Math.exp(-e.deltaY * 0.002);
    const current = useStore.getState().zoom;
    const next = Math.min(4, Math.max(0.25, current * factor));
    if (next === current) return;
    useStore.getState().setZoom(next);
    requestAnimationFrame(() => {
      const ratio = next / current;
      container.scrollLeft = px * ratio - (e.clientX - rect.left);
      container.scrollTop = py * ratio - (e.clientY - rect.top);
    });
  };

  // ---- drag & drop ----
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    void file.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf);
      window.dispatchEvent(
        new CustomEvent('lightpen:file', { detail: { name: file.name, bytes } }),
      );
    });
  };

  const openViaDialog = async () => {
    const opened = await openPdfFile();
    if (opened) {
      window.dispatchEvent(new CustomEvent('lightpen:file', { detail: opened }));
    }
  };

  // Toolbar "Open PDF" button (and Ctrl/Cmd+O) dispatch this event.
  useEffect(() => {
    const handler = () => void openViaDialog();
    window.addEventListener('lightpen:open-dialog', handler);
    return () => window.removeEventListener('lightpen:open-dialog', handler);
  }, []);

  if (error) {
    return (
      <div className="viewer-error" role="alert">
        <div className="empty-card">
          <p>{t(PDF_ERROR_MESSAGE_KEY[error])}</p>
          <button type="button" className="btn-primary" onClick={() => void openViaDialog()}>
            <FolderOpenIcon />
            <span>{t('toolbar.open')}</span>
          </button>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div
        className={`viewer-empty ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="empty-card">
          <div className="empty-icon" aria-hidden="true">
            <BrandNibIcon size={32} />
          </div>
          <p className="viewer-empty-title">{t('app.title')}</p>
          <p className="viewer-empty-subtitle">{t('viewer.dropHint')}</p>
          <button type="button" className="btn-primary btn-lg" onClick={() => void openViaDialog()}>
            <FolderOpenIcon />
            <span>{t('toolbar.open')}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="viewer-scroll"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onWheel={onWheel}
    >
      <div className="page-stack" style={{ width: cssW, height: cssH }}>
        <canvas ref={pageCanvasRef} className="page-canvas" aria-label="PDF page" />
        <canvas
          ref={inkCanvasRef}
          className="ink-canvas"
          aria-label="Ink layer"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onLostPointerCapture={() => finishManualStroke()}
          style={{ touchAction: 'none', cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
        />
        <canvas ref={cursorCanvasRef} className="cursor-canvas" aria-hidden="true" />
      </div>
    </div>
  );
}

/** Smooth vector stroke renderer with quadratic midpoint interpolation and NaN guards. */
function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  matrix: ViewportMatrix,
  scale: number,
): void {
  const pts = stroke.points;
  if (pts.length === 0) return;
  const { r, g, b } = hexToRgb(stroke.color);
  ctx.strokeStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  ctx.lineWidth = Math.max((Number.isFinite(stroke.width) ? stroke.width : 2.5) * scale, 0.5);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  let started = false;
  let prevX = 0;
  let prevY = 0;

  for (let i = 0; i < pts.length; i++) {
    const raw = pts[i]!;
    if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) continue;
    const p = pdfToViewport(raw, matrix);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;

    if (!started) {
      ctx.moveTo(p.x, p.y);
      prevX = p.x;
      prevY = p.y;
      started = true;
    } else if (pts.length === 2 || i === pts.length - 1) {
      ctx.lineTo(p.x, p.y);
      prevX = p.x;
      prevY = p.y;
    } else {
      const midX = (prevX + p.x) * 0.5;
      const midY = (prevY + p.y) * 0.5;
      ctx.quadraticCurveTo(prevX, prevY, midX, midY);
      prevX = p.x;
      prevY = p.y;
    }
  }

  if (started) {
    if (pts.length === 1) {
      ctx.lineTo(prevX + 0.5, prevY);
    }
    ctx.stroke();
  }
}
