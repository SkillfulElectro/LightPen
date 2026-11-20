/**
 * Annotation model: vector strokes per page in PDF coordinates,
 * with undo/redo, eraser hit-testing and sidecar serialization.
 * Pure logic, no DOM.
 */

import type { PdfPoint, SidecarData, Stroke } from './types';
import { pdfDistance } from './coords';

let idCounter = 0;

export function newStrokeId(): string {
  idCounter += 1;
  return `s${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function createStroke(page: number, color: string, width: number, first: PdfPoint): Stroke {
  return {
    id: newStrokeId(),
    page,
    color,
    width,
    points: [first],
    createdAt: Date.now(),
  };
}

/** Append a point if it is at least `minDistance` from the last point. */
export function addPoint(stroke: Stroke, point: PdfPoint, minDistance = 0.5): boolean {
  const last = stroke.points[stroke.points.length - 1];
  if (last && pdfDistance(last, point) < minDistance) return false;
  stroke.points.push(point);
  return true;
}

/** Distance from a point to a segment. */
export function pointToSegmentDistance(p: PdfPoint, a: PdfPoint, b: PdfPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return pdfDistance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return pdfDistance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** True when the stroke passes within `radius` of `point`. */
export function strokeHit(stroke: Stroke, point: PdfPoint, radius: number): boolean {
  const pts = stroke.points;
  if (pts.length === 0) return false;
  if (pts.length === 1) return pdfDistance(pts[0]!, point) <= radius;
  for (let i = 0; i < pts.length - 1; i++) {
    if (pointToSegmentDistance(point, pts[i]!, pts[i + 1]!) <= radius) return true;
  }
  return false;
}

type UndoEntry =
  | { type: 'add'; stroke: Stroke }
  | { type: 'erase'; strokes: Stroke[] }
  | { type: 'clear'; strokes: Stroke[] };

/** In-memory annotation store with unlimited undo/redo. */
export class AnnotationStore {
  private strokes: Stroke[] = [];
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];

  get all(): Stroke[] {
    return [...this.strokes];
  }

  strokesForPage(page: number): Stroke[] {
    return this.strokes.filter((s) => s.page === page);
  }

  countForPage(page: number): number {
    return this.strokes.filter((s) => s.page === page).length;
  }

  addStroke(stroke: Stroke): void {
    this.strokes.push(stroke);
    this.undoStack.push({ type: 'add', stroke });
    this.redoStack = [];
  }

  /** Erase strokes under `point` on `page`. Returns erased strokes. */
  eraseAt(page: number, point: PdfPoint, radius: number): Stroke[] {
    const erased = this.strokes.filter((s) => s.page === page && strokeHit(s, point, radius));
    if (erased.length === 0) return [];
    const ids = new Set(erased.map((s) => s.id));
    this.strokes = this.strokes.filter((s) => !ids.has(s.id));
    this.undoStack.push({ type: 'erase', strokes: erased });
    this.redoStack = [];
    return erased;
  }

  clearPage(page: number): Stroke[] {
    const cleared = this.strokes.filter((s) => s.page === page);
    if (cleared.length === 0) return [];
    this.strokes = this.strokes.filter((s) => s.page !== page);
    this.undoStack.push({ type: 'clear', strokes: cleared });
    this.redoStack = [];
    return cleared;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    if (entry.type === 'add') {
      this.strokes = this.strokes.filter((s) => s.id !== entry.stroke.id);
    } else {
      this.strokes.push(...entry.strokes);
    }
    this.redoStack.push(entry);
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    if (entry.type === 'add') {
      this.strokes.push(entry.stroke);
    } else {
      const ids = new Set(entry.strokes.map((s) => s.id));
      this.strokes = this.strokes.filter((s) => !ids.has(s.id));
    }
    this.undoStack.push(entry);
    return true;
  }

  serialize(): SidecarData {
    return { version: 1, strokes: this.strokes, updatedAt: Date.now() };
  }

  static deserialize(data: unknown): AnnotationStore {
    const store = new AnnotationStore();
    if (typeof data !== 'object' || data === null) return store;
    const raw = (data as { strokes?: unknown }).strokes;
    if (!Array.isArray(raw)) return store;
    for (const s of raw) {
      if (typeof s !== 'object' || s === null) continue;
      const st = s as Partial<Stroke>;
      if (typeof st.page !== 'number' || !Array.isArray(st.points)) continue;
      const points = st.points.filter(
        (p): p is PdfPoint =>
          typeof p === 'object' && p !== null && typeof p.x === 'number' && typeof p.y === 'number',
      );
      if (points.length === 0) continue;
      store.strokes.push({
        id: typeof st.id === 'string' ? st.id : newStrokeId(),
        page: st.page,
        color: typeof st.color === 'string' ? st.color : '#e11d48',
        width: typeof st.width === 'number' && st.width > 0 ? st.width : 2.5,
        points,
        createdAt: typeof st.createdAt === 'number' ? st.createdAt : Date.now(),
      });
    }
    return store;
  }

  clearAll(): void {
    this.strokes = [];
    this.undoStack = [];
    this.redoStack = [];
  }
}

/** Parse a hex color like "#e11d48" into 0..1 RGB. Falls back to red. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return { r: 1, g: 0, b: 0 };
  const n = parseInt(m[1]!, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
