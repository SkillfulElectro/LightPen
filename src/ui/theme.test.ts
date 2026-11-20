/**
 * WCAG 2.2 AA colour checks for the theme tokens in src/index.css.
 * The palette is the single source of truth, so the test parses the CSS
 * instead of duplicating the hex values.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/types';

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

/** Extract `--token: value;` declarations for one selector block. */
function tokensFor(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `selector ${selector} not found in index.css`).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    out[match[1]!] = match[2]!;
  }
  return out;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES: [string, string][] = [
  ['light', ':root'],
  ['dark', "[data-theme='dark']"],
];

describe.each(THEMES)('%s theme meets WCAG 2.2 AA', (_name, selector) => {
  const t = tokensFor(selector);

  it('defines all required tokens', () => {
    const keys = [
      'bg',
      'bg-secondary',
      'text',
      'text-secondary',
      'accent',
      'accent-text',
      'border',
      'focus',
      'error',
      'success',
      'warning',
    ];
    for (const key of keys) {
      expect(t[key], `missing --${key}`).toBeDefined();
    }
  });

  it('uses body text with at least 4.5:1 contrast on both surfaces', () => {
    for (const surface of ['bg', 'bg-secondary'] as const) {
      expect(contrast(t['text']!, t[surface]!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['text-secondary']!, t[surface]!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses an accent that is legible as text and as a button fill', () => {
    for (const surface of ['bg', 'bg-secondary'] as const) {
      expect(contrast(t['accent']!, t[surface]!)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(t['accent-text']!, t['accent']!)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps borders and focus rings visible against the surfaces (3:1)', () => {
    expect(contrast(t['border']!, t['bg']!)).toBeGreaterThanOrEqual(3);
    expect(contrast(t['border']!, t['bg-secondary']!)).toBeGreaterThanOrEqual(3);
    expect(contrast(t['focus']!, t['bg']!)).toBeGreaterThanOrEqual(3);
  });

  it('keeps status colours readable', () => {
    expect(contrast(t['error']!, t['bg-secondary']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['success']!, t['bg-secondary']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['warning']!, t['bg-secondary']!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('default ink colour', () => {
  it('is visible on a white page (PDF content is usually white)', () => {
    const accentTokens = tokensFor(':root');
    expect(contrast(DEFAULT_SETTINGS.penColor, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(accentTokens['accent']).toBeDefined();
  });
});
