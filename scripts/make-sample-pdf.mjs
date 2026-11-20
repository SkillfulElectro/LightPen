/**
 * Generate public/sample.pdf — a small built-in practice PDF for the tutorial.
 * Run with: npm run make:sample
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.HelveticaBold);
const body = await doc.embedFont(StandardFonts.Helvetica);

function page(title, lines) {
  const p = doc.addPage([612, 792]);
  p.drawText(title, { x: 56, y: 720, size: 28, font, color: rgb(0.1, 0.1, 0.2) });
  p.drawLine({
    start: { x: 56, y: 706 },
    end: { x: 556, y: 706 },
    thickness: 2,
    color: rgb(0.89, 0.11, 0.28),
  });
  let y = 660;
  for (const line of lines) {
    p.drawText(line, { x: 56, y, size: 14, font: body, color: rgb(0.2, 0.2, 0.25) });
    y -= 28;
  }
  return p;
}

page('LightPen practice sheet', [
  'Welcome! This is a sample PDF for practicing air-writing.',
  '',
  'Try the gestures from the tutorial:',
  '  - Pinch thumb + index to write',
  '  - Open palm to erase',
  '  - Swipe sideways to change page',
  '  - Fist held for 1 second to pause',
  '',
  'You can also draw with your mouse or finger.',
  'Everything is processed on this device.',
]);
page('Page 2 — draw something!', [
  'Draw a star, a circle, or your signature.',
  '',
  'Tip: hold your hand steady and move slowly',
  'for the smoothest lines.',
]);
page('Page 3 — you are ready!', [
  'Open your own PDF from the toolbar to start.',
  'Use the cheat sheet (Help menu) anytime.',
  '',
  'Happy writing!',
]);

const bytes = await doc.save();
writeFileSync(join(root, 'public', 'sample.pdf'), bytes);
console.log('[make-sample] Wrote public/sample.pdf');
