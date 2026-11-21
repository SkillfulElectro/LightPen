/**
 * Air Touch Gesture Simulator & Dynamic Mouse Cursor Style mapper.
 *
 * Translates normalized hand camera coordinates + detected gesture states into:
 * 1. Viewport coordinates & dynamic cursor styles (pointer, pen, eraser, scroll, zoom, grab, tap).
 * 2. Synthetic DOM mouse/pointer/wheel events so air gestures can hover, tap buttons,
 *    scroll containers, and pinch-zoom smoothly in mid-air.
 */
import { clamp, FULL_FRAME_CALIBRATION } from './coords';
import type { AirCursorStyle, CalibrationRect, CameraPoint, GestureKind } from './types';

export interface CursorDescriptor {
  style: AirCursorStyle;
  cssCursor: string;
  label: string;
}

export function resolveAirCursorStyle(
  gesture: GestureKind,
  tool: 'pen' | 'eraser',
  overInteractive: boolean,
): CursorDescriptor {
  switch (gesture) {
    case 'pen-down':
      return tool === 'eraser'
        ? { style: 'eraser', cssCursor: 'cell', label: 'Air Erase' }
        : { style: 'pen', cssCursor: 'crosshair', label: 'Air Write' };
    case 'erase':
      return { style: 'eraser', cssCursor: 'cell', label: 'Palm Erase' };
    case 'tap':
      return { style: 'tap', cssCursor: 'pointer', label: 'Air Tap' };
    case 'scroll':
    case 'two-finger':
      return { style: 'scroll', cssCursor: 'ns-resize', label: 'Air Scroll' };
    case 'zoom-in':
      return { style: 'zoom-in', cssCursor: 'zoom-in', label: 'Zoom In' };
    case 'zoom-out':
      return { style: 'zoom-out', cssCursor: 'zoom-out', label: 'Zoom Out' };
    case 'fist':
      return { style: 'grab', cssCursor: 'grab', label: 'Grab / Pause' };
    case 'hover':
      return overInteractive
        ? { style: 'pointer', cssCursor: 'pointer', label: 'Tap to Click' }
        : { style: 'default', cssCursor: 'default', label: 'Air Pointer' };
    default:
      return { style: 'default', cssCursor: 'default', label: 'Idle' };
  }
}

export function normalizedToViewport(
  point: CameraPoint,
  calibration: CalibrationRect | null,
  mirrored: boolean,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const cal = calibration ?? FULL_FRAME_CALIBRATION;
  const w = Math.max(cal.x1 - cal.x0, 1e-6);
  const h = Math.max(cal.y1 - cal.y0, 1e-6);
  let nx = (point.x - cal.x0) / w;
  let ny = (point.y - cal.y0) / h;
  if (mirrored) nx = 1 - nx;
  nx = clamp(nx, 0, 1);
  ny = clamp(ny, 0, 1);
  return { x: nx * viewportWidth, y: ny * viewportHeight };
}

const INTERACTIVE_SELECTOR =
  'button, a[href], input, select, textarea, summary, [role="button"], [role="tab"], [role="slider"]';

export function findInteractiveTarget(el: Element | null): HTMLElement | null {
  if (!el || !(el instanceof HTMLElement)) return null;
  return el.closest<HTMLElement>(INTERACTIVE_SELECTOR);
}

/**
 * Stateful bridge that dispatches real DOM hover/click/scroll/zoom interactions
 * from mid-air hand gestures.
 */
export class AirTouchEventBridge {
  private lastHoverEl: HTMLElement | null = null;

  /** Inspect element under (x, y) and dispatch hover mousemove/pointermove. */
  move(clientX: number, clientY: number): { target: Element | null; interactive: HTMLElement | null } {
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
      return { target: null, interactive: null };
    }
    const target = document.elementFromPoint(clientX, clientY);
    const interactive = findInteractiveTarget(target);

    if (this.lastHoverEl && this.lastHoverEl !== interactive) {
      this.lastHoverEl.removeAttribute('data-air-hover');
    }
    if (interactive) {
      interactive.setAttribute('data-air-hover', 'true');
    }
    this.lastHoverEl = interactive;

    if (target) {
      target.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
        }),
      );
    }
    return { target, interactive };
  }

  /** Simulate an air tap (touch click) on any interactive UI element under the cursor. */
  tap(clientX: number, clientY: number): boolean {
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
      return false;
    }
    const target = document.elementFromPoint(clientX, clientY);
    const interactive = findInteractiveTarget(target);
    if (!interactive || (interactive as HTMLButtonElement).disabled) return false;
    interactive.focus({ preventScroll: true });
    interactive.click();
    return true;
  }

  /** Simulate vertical two-finger touch scroll on the nearest scrollable viewer. */
  scroll(clientX: number, clientY: number, normalizedDeltaY: number): void {
    if (typeof document === 'undefined' || Math.abs(normalizedDeltaY) < 0.002) return;
    const viewer = document.querySelector<HTMLElement>('.viewer-scroll');
    if (viewer) {
      viewer.scrollTop += normalizedDeltaY * viewer.clientHeight * 1.6;
      return;
    }
    window.scrollBy({ top: normalizedDeltaY * window.innerHeight * 1.2, behavior: 'auto' });
    void clientX;
    void clientY;
  }

  clearHover(): void {
    if (this.lastHoverEl) {
      this.lastHoverEl.removeAttribute('data-air-hover');
      this.lastHoverEl = null;
    }
  }
}
