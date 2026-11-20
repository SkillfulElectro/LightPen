import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { inflateSync } from 'node:zlib';
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

/**
 * pdf-lib compresses content streams, so assertions on drawing operators need
 * the streams inflated. This keeps the tests independent of pdf-lib internals.
 */
function contentStreams(pdfBytes: Uint8Array): string {
  const text = new TextDecoder('latin1').decode(pdfBytes);
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const start = match.index + match[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    const raw = pdfBytes.slice(start, end);
    try {
      out.push(new TextDecoder('latin1').decode(inflateSync(raw)));
    } catch {
      out.push(new TextDecoder('latin1').decode(raw));
    }
  }
  return out.join('\n');
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
  it('strokes the path instead of filling it, so handwriting stays a line', async () => {
    const original = await blankPdf([[612, 792]]);
    const out = await buildAnnotatedPdf(original, [stroke()]);
    const text = contentStreams(out);
    // pdf-lib's SVG path helper emits `B` (fill + stroke) when a fill colour is
    // set and `S` (stroke only) otherwise. We must never fill.
    expect(text).toContain('100 92 m');
    expect(text).toMatch(/\bl\s*\nS/);
  });

  it('anchors the path at the page height so ink lands where it was drawn', async () => {
    const original = await blankPdf([[612, 792]]);
    const out = await buildAnnotatedPdf(original, [stroke()]);
    const text = contentStreams(out);
    // translate(0, pageHeight) followed by pdf-lib's own y flip.
    expect(text).toContain('1 0 0 1 0 792 cm');
  });

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
