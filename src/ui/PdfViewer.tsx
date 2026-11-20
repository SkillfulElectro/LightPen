/**
 * PDF viewer: pdf.js page canvas + dedicated ink canvas overlay.
 * Ink is drawn imperatively on the overlay canvas (never through React
 * state in the hot path). Supports mouse/touch/stylus drawing and
 * air-writing via the tracking loop (see CameraPreview).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addPoint, createStroke, hexToRgb } from '../core/annotations';
import { canvasToPage, clampToPage, pageToCanvas } from '../core/coords';
import type { PageSize, Stroke } from '../core/types';
import {
  classifyPdfError,
  getPageSize,
  loadPdf,
  usePageRenderer,
  type PdfErrorKind,
} from '../hooks/usePdfDocument';
import { restoreAnnotations, useStore } from '../store/useStore';
import { openPdfFile } from '../platform/tauri';

interface Props {
  pdfBytes: Uint8Array | null;
  pdfName: string | null;
  onPdfLoaded: (name: string, bytes: Uint8Array, pageCount: number, pageSizes: PageSize[]) => void;
}

export default function PdfViewer({ pdfBytes, pdfName, onPdfLoaded }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const pageCanvasRef = useRef<HTMLCanvasElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<Awaited<ReturnType<typeof loadPdf>>['doc'] | null>(null);
  const [error, setError] = useState<PdfErrorKind | null>(null);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [containerWidth, setContainerWidth] = useState(800);
  const [containerHeight, setContainerHeight] = useState(700);
  const [dragOver, setDragOver] = useState(false);
  const drawingRef = useRef<Stroke | null>(null);

  const currentPage = useStore((s) => s.currentPage);
  const zoom = useStore((s) => s.zoom);
  const fitMode = useStore((s) => s.fitMode);
  const tool = useStore((s) => s.tool);
  const strokesVersion = useStore((s) => s.strokesVersion);
  const settings = useStore((s) => s.settings);
  const { renderPage } = usePageRenderer(doc);

  // ---- load pdf.js document when bytes change ----
  useEffect(() => {
    if (!pdfBytes) {
      setDoc(null);
      setPageSizes([]);
      return;
    }
    let cancelled = false;
    setError(null);
    loadPdf(pdfBytes)
      .then(async (loaded) => {
        if (cancelled) return;
        setDoc(loaded.doc);
        setPageSizes(loaded.pageSizes);
        onPdfLoaded(pdfName ?? 'document.pdf', pdfBytes, loaded.pageCount, loaded.pageSizes);
        await restoreAnnotations(pdfName ?? 'document.pdf');
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfBytes]);

  // ---- track container width for fit modes ----
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect?.width) setContainerWidth(rect.width);
      if (rect?.height) setContainerHeight(rect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fallback size for pages whose dimensions have not been read yet.
  const [dynSize, setDynSize] = useState<PageSize | null>(null);
  const pageSize = useMemo<PageSize>(() => {
    const known = pageSizes[currentPage];
    if (known && known.width !== 612) return known;
    return dynSize ?? { width: 612, height: 792 };
  }, [pageSizes, currentPage, dynSize]);

  // Read the size of the visible page on demand (large documents are lazy).
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    setDynSize(null);
    getPageSize(doc, currentPage, pageSizes)
      .then((size) => {
        if (!cancelled) setDynSize(size);
      })
      .catch(() => {
        // Keep the Letter fallback; the render path reports real errors.
      });
    return () => {
      cancelled = true;
    };
  }, [doc, currentPage, pageSizes]);
  const scale =
    fitMode === 'fit-width'
      ? Math.max((containerWidth - 32) / pageSize.width, 0.1)
      : fitMode === 'fit-page'
        ? Math.max(
            Math.min(
              (containerWidth - 32) / pageSize.width,
              (containerHeight - 32) / pageSize.height,
            ),
            0.1,
          )
        : zoom;

  // Keep the zoom percentage in the toolbar in sync with fit modes.
  useEffect(() => {
    if (fitMode === 'manual') return;
    if (Math.abs(useStore.getState().zoom - scale) > 0.01) useStore.getState().setFitScale(scale);
  }, [scale, fitMode]);

  // ---- render page + ink whenever inputs change ----
  useEffect(() => {
    const canvas = pageCanvasRef.current;
    if (!doc || !canvas) return;
    void renderPage(currentPage, canvas, scale);
  }, [doc, currentPage, scale, renderPage]);

  const drawInk = useCallback(() => {
    const canvas = inkCanvasRef.current;
    if (!canvas) return;
    const cssW = pageSize.width * scale;
    const cssH = pageSize.height * scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const strokes = useStore.getState().annotations.strokesForPage(currentPage);
    for (const stroke of strokes) drawStroke(ctx, stroke, pageSize, cssW, cssH);
    const active = drawingRef.current ?? useStore.getState().activeStroke;
    if (active && active.page === currentPage) drawStroke(ctx, active, pageSize, cssW, cssH);
  }, [currentPage, pageSize, scale]);

  useEffect(() => {
    drawInk();
  }, [drawInk, strokesVersion]);

  // ---- hand cursor overlay (drawn by tracking loop via rAF) ----
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = cursorCanvasRef.current;
      const cursor = useStore.getState().handCursor;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cssW = pageSize.width * scale;
      const cssH = pageSize.height * scale;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.floor(cssW * dpr)) {
        canvas.width = Math.floor(cssW * dpr);
        canvas.height = Math.floor(cssH * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      if (!cursor) return;
      const p = pageToCanvas({ x: cursor.x, y: cursor.y }, pageSize, cssW, cssH);
      ctx.beginPath();
      ctx.arc(p.x, p.y, cursor.kind === 'pen-down' ? 5 : 8, 0, Math.PI * 2);
      ctx.fillStyle =
        cursor.kind === 'pen-down' ? '#e11d48' : cursor.kind === 'erase' ? '#f59e0b' : '#3b82f6';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [pageSize, scale]);

  // ---- manual drawing (mouse / touch / stylus) ----
  const toPdfPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = inkCanvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const cssW = pageSize.width * scale;
    const cssH = pageSize.height * scale;
    return clampToPage(
      canvasToPage(e.clientX - rect.left, e.clientY - rect.top, pageSize, cssW, cssH),
      pageSize,
    );
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!doc) return;
    const p = toPdfPoint(e);
    if (!p) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (tool === 'eraser') {
      useStore.getState().eraseAt(currentPage, p, 12);
      drawingRef.current = null;
      return;
    }
    const stroke = createStroke(currentPage, settings.penColor, settings.penWidth, p);
    drawingRef.current = stroke;
    useStore.setState({ activeStroke: stroke });
    drawInk();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toPdfPoint(e);
    if (!p) return;
    if (tool === 'eraser' && e.buttons > 0) {
      useStore.getState().eraseAt(currentPage, p, 12);
      return;
    }
    const stroke = drawingRef.current;
    if (stroke) {
      addPoint(stroke, p);
      drawInk();
    }
  };

  const onPointerUp = () => {
    const stroke = drawingRef.current;
    drawingRef.current = null;
    useStore.setState({ activeStroke: null });
    if (stroke && stroke.points.length > 0) {
      useStore.getState().addStroke(stroke);
    }
    drawInk();
  };

  // ---- drag & drop ----
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    void file.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf);
      // Handled by App via a custom event so the store stays the source of truth.
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
        <p>{t(`viewer.${error}`)}</p>
        <button type="button" onClick={() => void openViaDialog()}>
          {t('toolbar.open')}
        </button>
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
        <p className="viewer-empty-title">{t('app.title')}</p>
        <p>{t('viewer.dropHint')}</p>
        <button type="button" className="btn-primary" onClick={() => void openViaDialog()}>
          {t('toolbar.open')}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="viewer-scroll"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div
        className="page-stack"
        style={{ width: pageSize.width * scale, height: pageSize.height * scale }}
      >
        <canvas ref={pageCanvasRef} className="page-canvas" aria-label="PDF page" />
        <canvas
          ref={inkCanvasRef}
          className="ink-canvas"
          aria-label="Ink layer"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ touchAction: 'none', cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
        />
        <canvas ref={cursorCanvasRef} className="cursor-canvas" aria-hidden="true" />
      </div>
    </div>
  );
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  page: PageSize,
  cssW: number,
  cssH: number,
): void {
  const pts = stroke.points;
  if (pts.length === 0) return;
  const { r, g, b } = hexToRgb(stroke.color);
  ctx.strokeStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  ctx.lineWidth = Math.max(stroke.width * (cssW / page.width), 0.5);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const first = pageToCanvas(pts[0]!, page, cssW, cssH);
  ctx.moveTo(first.x, first.y);
  if (pts.length === 1) {
    ctx.lineTo(first.x + 0.5, first.y);
  } else {
    for (let i = 1; i < pts.length; i++) {
      const p = pageToCanvas(pts[i]!, page, cssW, cssH);
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();
}
