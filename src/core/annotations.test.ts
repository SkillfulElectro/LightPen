import { describe, expect, it } from 'vitest';
import { AnnotationStore, addPoint, createStroke, hexToRgb, strokeHit } from './annotations';

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
