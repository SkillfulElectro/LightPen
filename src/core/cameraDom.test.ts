/**
 * The offscreen-box contract.
 *
 * Regression under test: the self-view is hidden by default, and hiding it with
 * `display: none` made the camera open while tracking stayed at 0 FPS on
 * Linux/WebKitGTK, because a <video> that is not rendered stops delivering
 * frames. The wrapper class and the CSS must therefore stay in lock-step, and
 * nothing may quietly reintroduce a "hide the video" declaration.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFSCREEN_DECLARATIONS, VISUALLY_HIDDEN_CLASS, videoWrapClass } from './cameraDom';

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

/** Declaration block of a selector, whitespace-normalized. */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`selector not found: ${selector}`);
  return match[1]!
    .split(';')
    .map((d) => d.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('; ');
}

describe('videoWrapClass', () => {
  it('marks only the collapsed wrapper as offscreen', () => {
    expect(videoWrapClass(true)).toBe(`camera-video-wrap ${VISUALLY_HIDDEN_CLASS}`);
    expect(videoWrapClass(false)).toBe('camera-video-wrap');
  });
});

describe('offscreen CSS', () => {
  it('has exactly the declarations the TS constant promises', () => {
    expect(block(`.camera-panel .${VISUALLY_HIDDEN_CLASS}`)).toBe(
      OFFSCREEN_DECLARATIONS.join('; '),
    );
  });

  it('never hides the video with display, visibility, opacity or the hidden attribute', () => {
    for (const declaration of ['display: none', 'visibility: hidden', 'opacity: 0']) {
      expect(block(`.camera-panel .${VISUALLY_HIDDEN_CLASS}`)).not.toContain(declaration);
    }
    // A 1px box is also unreliable in WebKitGTK: decoding can be skipped.
    expect(block(`.camera-panel .${VISUALLY_HIDDEN_CLASS}`)).not.toMatch(/width: 1px/);
    expect(block(`.camera-panel .${VISUALLY_HIDDEN_CLASS}`)).toContain('left: -10000px');
  });

  it('does not combine the collapsed state with the base wrapper block', () => {
    // `.camera-panel.collapsed .camera-video-wrap { display: none }` was the bug.
    expect(css).not.toMatch(/\.camera-panel\.collapsed[^{]*\{[^}]*display:\s*none/);
  });
});
