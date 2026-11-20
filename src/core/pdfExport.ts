/**
 * Annotated-PDF export with pdf-lib: strokes are embedded as vector paths
 * (SVG path strings), so the result opens in any third-party viewer.
 * Pure logic (Uint8Array in → Uint8Array out), no DOM.
 */

import { PDFDocument, rgb } from 'pdf-lib';
import { hexToRgb } from './annotations';
import type { PageSize, Stroke } from './types';

function strokeToSvgPath(stroke: Stroke): string {
  const pts = stroke.points;
  if (pts.length === 0) return '';
  if (pts.length === 1) {
    const p = pts[0]!;
    return `M ${p.x} ${p.y} L ${p.x + 0.01} ${p.y}`;
  }
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i]!.x} ${pts[i]!.y}`;
  }
  return d;
}

/**
 * Build a new PDF: the original pages plus vector ink strokes per page.
 * `pageSizes` are the pdf.js viewport sizes in PDF points (must match the
 * original PDF page sizes for correct placement).
 */
export async function buildAnnotatedPdf(
  originalBytes: Uint8Array,
  strokes: Stroke[],
  pageSizes: PageSize[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes.slice(), { ignoreEncryption: true });
  const pages = doc.getPages();
  for (const stroke of strokes) {
    const page = pages[stroke.page];
    if (!page) continue;
    const size = pageSizes[stroke.page];
    void size; // pdf-lib page coordinates already match PDF points
    const { r, g, b } = hexToRgb(stroke.color);
    page.drawSvgPath(strokeToSvgPath(stroke), {
      color: rgb(r, g, b),
      borderColor: rgb(r, g, b),
      borderWidth: Math.max(stroke.width, 0.5),
      opacity: 1,
    });
  }
  return doc.save();
}

/** Build a blank annotated PDF from strokes only (used when no source PDF). */
export async function buildBlankAnnotatedPdf(strokes: Stroke[], pageSizes: PageSize[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageSizes.length; i++) {
    const size = pageSizes[i]!;
    doc.addPage([size.width, size.height]);
  }
  const pages = doc.getPages();
  for (const stroke of strokes) {
    const page = pages[stroke.page];
    if (!page) continue;
    const { r, g, b } = hexToRgb(stroke.color);
    page.drawSvgPath(strokeToSvgPath(stroke), {
      color: rgb(r, g, b),
      borderColor: rgb(r, g, b),
      borderWidth: Math.max(stroke.width, 0.5),
    });
  }
  return doc.save();
}
