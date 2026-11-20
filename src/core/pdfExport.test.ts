import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildAnnotatedPdf, buildBlankAnnotatedPdf, strokeToSvgPath } from './pdfExport';
import type { Stroke } from './types';

function stroke(overrides: Partial<Stroke> = {}): Stroke {
  return {
    id: 's1',
    page: 0,
    color: '#e11d48',
    width: 2,
    points: [
      { x: 100, y: 700 },
      { x: 150, y: 650 },
      { x: 200, y: 600 },
    ],
    createdAt: 0,
    ...overrides,
  };
}

async function blankPdf(pages: [number, number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [w, h] of pages) doc.addPage([w, h]);
  return doc.save();
}

describe('strokeToSvgPath', () => {
  it('flips the y axis to pdf-lib top-left origin', () => {
    expect(strokeToSvgPath(stroke(), 792)).toBe('M 100 92 L 150 142 L 200 192');
  });

  it('returns an empty string for a stroke with no points', () => {
    expect(strokeToSvgPath(stroke({ points: [] }), 792)).toBe('');
  });

  it('gives single-point strokes a tiny visible segment', () => {
    expect(strokeToSvgPath(stroke({ points: [{ x: 10, y: 20 }] }), 100)).toBe('M 10 80 L 10.01 80');
  });
});

describe('buildAnnotatedPdf', () => {
  it('produces a valid PDF containing every original page', async () => {
    const original = await blankPdf([
      [612, 792],
      [612, 792],
    ]);
    const out = await buildAnnotatedPdf(original, [stroke(), stroke({ page: 1 })]);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(out.slice(0, 5))).toBe('%PDF-');
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(2);
  });

  it('ignores strokes that point at pages that do not exist', async () => {
    const original = await blankPdf([[612, 792]]);
    const out = await buildAnnotatedPdf(original, [stroke({ page: 5 })]);
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(1);
  });
});

describe('buildBlankAnnotatedPdf', () => {
  it('creates one page per page size with the ink embedded', async () => {
    const out = await buildBlankAnnotatedPdf(
      [stroke()],
      [
        { width: 595, height: 842 },
        { width: 595, height: 842 },
      ],
    );
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(2);
    expect(reloaded.getPage(0).getWidth()).toBeCloseTo(595, 0);
    expect(reloaded.getPage(0).getHeight()).toBeCloseTo(842, 0);
  });
});
