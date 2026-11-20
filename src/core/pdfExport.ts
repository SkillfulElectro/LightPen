/**
 * Annotated-PDF export with pdf-lib: strokes are embedded as vector paths
 * (SVG path strings), so the result opens in any third-party viewer.
 * Pure logic (Uint8Array in → Uint8Array out), no DOM.
 */

import { LineCapStyle, PDFDocument, rgb } from 'pdf-lib';
import { hexToRgb } from './annotations';
import type { PageSize, Stroke } from './types';

/**
 * Convert a stroke (PDF points, bottom-left origin) into an SVG path string
 * for pdf-lib.
 *
 * pdf-lib's `drawSvgPath` flips the y axis itself (`scale(1, -1)`) and anchors
 * the origin at the `y` option, so the caller must pass `y = pageHeight` and
 * express the path top-down. That combination maps SVG y back onto native PDF
 * y, which is verified by rendering the export in an independent viewer.
 */
export function strokeToSvgPath(stroke: Stroke, pageHeight: number): string {
  const pts = stroke.points;
  if (pts.length === 0) return '';
  const fy = (y: number) => pageHeight - y;
  if (pts.length === 1) {
    const p = pts[0]!;
    return `M ${p.x} ${fy(p.y)} L ${p.x + 0.01} ${fy(p.y)}`;
  }
  let d = `M ${pts[0]!.x} ${fy(pts[0]!.y)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i]!.x} ${fy(pts[i]!.y)}`;
  }
  return d;
}

/**
 * Build a new PDF: the original pages plus vector ink strokes per page.
 * Page heights are read from the loaded document itself, so strokes are placed
 * relative to the real page box even if pdf.js viewports differ slightly.
 */
export async function buildAnnotatedPdf(
  originalBytes: Uint8Array,
  strokes: Stroke[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes.slice(), { ignoreEncryption: true });
  const pages = doc.getPages();
  for (const stroke of strokes) {
    const page = pages[stroke.page];
    if (!page) continue;
    const pageHeight = page.getHeight();
    const { r, g, b } = hexToRgb(stroke.color);
    // Stroke only (no `color`): passing a fill colour would close and fill the
    // polyline, turning handwriting into a polygon.
    page.drawSvgPath(strokeToSvgPath(stroke, pageHeight), {
      x: 0,
      y: pageHeight,
      borderColor: rgb(r, g, b),
      borderWidth: Math.max(stroke.width, 0.5),
      borderOpacity: 1,
      borderLineCap: LineCapStyle.Round,
    });
  }
  return doc.save();
}

/** Build a blank annotated PDF from strokes only (used when no source PDF). */
export async function buildBlankAnnotatedPdf(
  strokes: Stroke[],
  pageSizes: PageSize[],
): Promise<Uint8Array> {
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
    page.drawSvgPath(strokeToSvgPath(stroke, page.getHeight()), {
      x: 0,
      y: page.getHeight(),
      borderColor: rgb(r, g, b),
      borderWidth: Math.max(stroke.width, 0.5),
      borderLineCap: LineCapStyle.Round,
    });
  }
  return doc.save();
}
