/**
 * The one "invisible but alive" box the <video> lives in when the self-view
 * is off.
 *
 * The self-view is hidden by default (settings.showPreview = false), and on
 * Linux/WebKitGTK a `<video>` that is not rendered stops delivering frames:
 * `requestVideoFrameCallback` never fires, MediaPipe's `detectForVideo`
 * throws "no video frame", FPS stays at 0 and the hand is never seen — even
 * though the camera opened fine and the OS LED is on. That is the reported
 * bug behind "it opened my camera but stayed at 0 FPS".
 *
 * So the element is never `display: none`, `visibility: hidden`, `hidden`,
 * `opacity: 0` or clipped to a pixel: it is moved entirely *outside* the
 * viewport with `position: fixed; left: -10000px` at a real size. The box is
 * laid out, painted and decoded as usual; nobody can see it, and the classic
 * "video keeps playing while scrolled out of view" behaviour applies.
 *
 * `index.css` has `.camera-video-wrap--offscreen` with exactly the same
 * declarations; `src/core/cameraDom.test.ts` fails if the two drift apart.
 */
export const VISUALLY_HIDDEN_CLASS = 'camera-video-wrap--offscreen';

/** Declarations of `.camera-video-wrap--offscreen`, mirrored in index.css. */
export const OFFSCREEN_DECLARATIONS = [
  'position: fixed',
  'top: 0',
  'left: -10000px',
  'width: 320px',
  'height: 240px',
  'pointer-events: none',
] as const;

/**
 * Classes for the wrapper around `<video>` + skeleton overlay.
 *
 * `collapsed` means "no self-view". It must never become `display: none`,
 * `visibility: hidden`, the `hidden` attribute, `opacity: 0` or a 1px box:
 * WebKitGTK stops decoding frames in all of those.
 */
export function videoWrapClass(collapsed: boolean): string {
  return collapsed ? `camera-video-wrap ${VISUALLY_HIDDEN_CLASS}` : 'camera-video-wrap';
}
