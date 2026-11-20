import { describe, expect, it } from 'vitest';
import { AnnotationStore, addPoint, createStroke, hexToRgb, strokeHit } from './annotations';
import type { Stroke } from './types';

function stroke(overrides: Partial<Stroke> = {}): Stroke {
  return (
    createStroke(overrides.page ?? 0, overrides.color ?? '#e11d48', overrides.width ?? 2, {
      x: 0,
      y: 0,
    }) && { ...createStroke(0, '#e11d48', 2, { x: 0, y: 0 }), ...overrides }
  );
}

describe('strokes', () => {
  it('addPoint enforces minimum distance', () => {
    const s = createStroke(0, '#ff0000', 2, { x: 0, y: 0 });
    expect(addPoint(s, { x: 0.1, y: 0 })).toBe(false);
    expect(addPoint(s, { x: 5, y: 0 })).toBe(true);
    expect(s.points).toHaveLength(2);
  });

  it('strokeHit detects proximity to segments', () => {
    const s = createStroke(0, '#ff0000', 2, { x: 0, y: 0 });
    addPoint(s, { x: 10, y: 0 });
    expect(strokeHit(s, { x: 5, y: 1 }, 2)).toBe(true);
    expect(strokeHit(s, { x: 5, y: 10 }, 2)).toBe(false);
  });
});

describe('AnnotationStore', () => {
  it('undo/redo for add, erase and clear', () => {
    const store = new AnnotationStore();
    const s1 = createStroke(0, '#ff0000', 2, { x: 0, y: 0 });
    addPoint(s1, { x: 10, y: 0 });
    store.addStroke(s1);
    expect(store.countForPage(0)).toBe(1);
    expect(store.undo()).toBe(true);
    expect(store.countForPage(0)).toBe(0);
    expect(store.redo()).toBe(true);
    expect(store.countForPage(0)).toBe(1);

    const erased = store.eraseAt(0, { x: 5, y: 0 }, 3);
    expect(erased).toHaveLength(1);
    expect(store.countForPage(0)).toBe(0);
    store.undo();
    expect(store.countForPage(0)).toBe(1);

    store.clearPage(0);
    expect(store.countForPage(0)).toBe(0);
    store.undo();
    expect(store.countForPage(0)).toBe(1);
  });

  it('new action clears the redo stack', () => {
    const store = new AnnotationStore();
    store.addStroke(createStroke(0, '#f00', 2, { x: 0, y: 0 }));
    store.undo();
    store.addStroke(createStroke(0, '#0f0', 2, { x: 1, y: 1 }));
    expect(store.canRedo()).toBe(false);
  });

  it('serialize/deserialize round-trips and tolerates garbage', () => {
    const store = new AnnotationStore();
    store.addStroke(createStroke(2, '#00f', 3, { x: 1, y: 2 }));
    const data = store.serialize();
    const restored = AnnotationStore.deserialize(JSON.parse(JSON.stringify(data)));
    expect(restored.countForPage(2)).toBe(1);
    expect(restored.all[0]?.points[0]).toEqual({ x: 1, y: 2 });
    expect(AnnotationStore.deserialize(null).all).toEqual([]);
    expect(AnnotationStore.deserialize({ strokes: [{ page: 'x' }] }).all).toEqual([]);
  });
});

describe('hexToRgb', () => {
  it('parses hex and falls back on invalid input', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 1, g: 0, b: 0 });
    expect(hexToRgb('nope')).toEqual({ r: 1, g: 0, b: 0 });
  });
});

describe('AnnotationStore persistence and edge cases', () => {
  it('reports counts per page and never exposes the internal array', () => {
    const store = new AnnotationStore();
    store.addStroke(stroke({ id: 'a', page: 0 }));
    store.addStroke(stroke({ id: 'b', page: 1 }));
    expect(store.countForPage(0)).toBe(1);
    expect(store.countForPage(1)).toBe(1);
    expect(store.countForPage(9)).toBe(0);
    const all = store.all;
    all.push(stroke({ id: 'c' }));
    expect(store.all).toHaveLength(2);
  });

  it('undoes and redoes a page clear', () => {
    const store = new AnnotationStore();
    store.addStroke(stroke({ id: 'a', page: 0 }));
    store.clearPage(0);
    expect(store.countForPage(0)).toBe(0);
    expect(store.undo()).toBe(true);
    expect(store.countForPage(0)).toBe(1);
    expect(store.redo()).toBe(true);
    expect(store.countForPage(0)).toBe(0);
  });

  it('returns false from undo/redo on an empty history and ignores empty erases', () => {
    const store = new AnnotationStore();
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
    expect(store.eraseAt(0, { x: 0, y: 0 }, 5)).toEqual([]);
    expect(store.clearPage(0)).toEqual([]);
    expect(store.canUndo()).toBe(false);
  });

  it('clears everything including history', () => {
    const store = new AnnotationStore();
    store.addStroke(stroke({ id: 'a' }));
    store.clearAll();
    expect(store.all).toHaveLength(0);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });

  it('round-trips through serialize/deserialize', () => {
    const store = new AnnotationStore();
    store.addStroke(stroke({ id: 'a', page: 2, color: '#00ff00', width: 4 }));
    const data = store.serialize();
    expect(data.version).toBe(1);
    const restored = AnnotationStore.deserialize(JSON.parse(JSON.stringify(data)));
    expect(restored.all).toHaveLength(1);
    expect(restored.all[0]?.page).toBe(2);
    expect(restored.all[0]?.color).toBe('#00ff00');
    expect(restored.canUndo()).toBe(false);
  });

  it('rejects malformed sidecar data instead of throwing', () => {
    expect(AnnotationStore.deserialize(null).all).toEqual([]);
    expect(AnnotationStore.deserialize('nope').all).toEqual([]);
    expect(AnnotationStore.deserialize({ strokes: 'nope' }).all).toEqual([]);
    const messy = {
      strokes: [
        null,
        { page: 'x', points: [{ x: 1, y: 1 }] },
        { page: 0, points: [] },
        {
          page: 0,
          points: [
            { x: 1, y: 2 },
            { x: 'bad', y: 3 },
          ],
        },
      ],
    };
    const store = AnnotationStore.deserialize(messy);
    expect(store.all).toHaveLength(1);
    const only = store.all[0]!;
    expect(only.points).toHaveLength(1);
    expect(only.color).toBe('#e11d48');
    expect(only.width).toBe(2.5);
    expect(typeof only.id).toBe('string');
    expect(typeof only.createdAt).toBe('number');
  });

  it('parses hex colors with and without the leading hash', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 1, g: 0, b: 0 });
    expect(hexToRgb('00ff00')).toEqual({ r: 0, g: 1, b: 0 });
    expect(hexToRgb('not-a-color')).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('does not add points that are too close together', () => {
    const s = stroke({ points: [{ x: 0, y: 0 }] });
    expect(addPoint(s, { x: 0.1, y: 0 })).toBe(false);
    expect(addPoint(s, { x: 5, y: 0 })).toBe(true);
    expect(s.points).toHaveLength(2);
  });

  it('hit-tests single-point strokes', () => {
    const dot = stroke({ points: [{ x: 10, y: 10 }] });
    expect(strokeHit(dot, { x: 12, y: 10 }, 3)).toBe(true);
    expect(strokeHit(dot, { x: 30, y: 10 }, 3)).toBe(false);
    expect(strokeHit(stroke({ points: [] }), { x: 0, y: 0 }, 3)).toBe(false);
  });
});
