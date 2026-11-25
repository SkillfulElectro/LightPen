/**
 * Viewport-level dynamic cursor driven by mid-air hand gestures.
 *
 * Updates DOM transforms directly inside a lightweight rAF loop (zero React
 * re-renders per frame) and caches previous coordinates/style so WebKitGTK
 * skips redundant style recalculations when stationary.
 */

import { useEffect, useRef } from 'react';
import type { AirCursorStyle } from '../core/types';
import { useStore } from '../store/useStore';

function cursorSvgForStyle(style: AirCursorStyle, color: string, holdProgress: number): string {
  switch (style) {
    case 'pen':
      return `<svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M5 23L9.5 21.5L22 9L19 6L6.5 18.5L5 23Z" fill="${color}" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
        <circle cx="5" cy="23" r="2.2" fill="${color}" stroke="#ffffff" stroke-width="1.2"/>
      </svg>`;
    case 'eraser':
      return `<svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="12" fill="rgba(217,119,6,0.18)" stroke="#d97706" stroke-width="2" stroke-dasharray="4 3"/>
        <rect x="11" y="13" width="10" height="6" rx="1.5" fill="#d97706" stroke="#ffffff" stroke-width="1.2"/>
      </svg>`;
    case 'pointer':
      return `<svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <circle cx="14" cy="14" r="10" fill="rgba(37,99,235,0.22)" stroke="#2563eb" stroke-width="2"/>
        <circle cx="14" cy="14" r="3.5" fill="#2563eb" stroke="#ffffff" stroke-width="1.4"/>
      </svg>`;
    case 'scroll':
      return `<svg width="30" height="30" viewBox="0 0 30 30" fill="none">
        <circle cx="15" cy="15" r="12" fill="rgba(15,23,42,0.82)" stroke="#ffffff" stroke-width="1.6"/>
        <path d="M15 7L11 11H19L15 7ZM15 23L19 19H11L15 23Z" fill="#ffffff"/>
      </svg>`;
    case 'zoom-in':
    case 'zoom-out': {
      const sign =
        style === 'zoom-in'
          ? '<path d="M13 10V16M10 13H16" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>'
          : '<path d="M10 13H16" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>';
      return `<svg width="30" height="30" viewBox="0 0 30 30" fill="none">
        <circle cx="13" cy="13" r="9" fill="rgba(37,99,235,0.88)" stroke="#ffffff" stroke-width="1.8"/>
        <path d="M19.5 19.5L25 25" stroke="#2563eb" stroke-width="3" stroke-linecap="round"/>
        <path d="M19.5 19.5L25 25" stroke="#ffffff" stroke-width="1.4" stroke-linecap="round"/>
        ${sign}
      </svg>`;
    }
    case 'grab':
    case 'pause': {
      const pct = Math.round(Math.max(0, Math.min(1, holdProgress)) * 75);
      return `<svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="12" fill="rgba(15,23,42,0.82)" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>
        <circle cx="16" cy="16" r="12" stroke="#f59e0b" stroke-width="2.5" stroke-dasharray="${pct} 100" transform="rotate(-90 16 16)"/>
        <rect x="12" y="11" width="3" height="10" rx="1" fill="#ffffff"/>
        <rect x="17" y="11" width="3" height="10" rx="1" fill="#ffffff"/>
      </svg>`;
    }
    case 'tap':
      return `<svg width="34" height="34" viewBox="0 0 34 34" fill="none">
        <circle cx="17" cy="17" r="14" stroke="#2563eb" stroke-width="2.2" opacity="0.65"/>
        <circle cx="17" cy="17" r="6" fill="#2563eb" stroke="#ffffff" stroke-width="2"/>
      </svg>`;
    default:
      return `<svg width="26" height="26" viewBox="0 0 26 26" fill="none">
        <path d="M4 3L20 12.5L13 14.5L10.5 21.5L4 3Z" fill="#0f172a" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>`;
  }
}

export default function AirCursorOverlay() {
  const nodeRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const trackingActive = useStore((s) => s.tracking.active);

  useEffect(() => {
    const node = nodeRef.current;
    if (!trackingActive) {
      if (node) node.style.opacity = '0';
      delete document.documentElement.dataset.airCursor;
      return;
    }

    let raf = 0;
    let lastSig = '';
    let lastX = Number.NaN;
    let lastY = Number.NaN;
    let lastCssCursor = '';
    let visible = false;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const curNode = nodeRef.current;
      const icon = iconRef.current;
      const label = labelRef.current;
      if (!curNode || !icon || !label) return;
      const cursor = useStore.getState().airCursor;
      if (!cursor) {
        if (visible) {
          curNode.style.opacity = '0';
          delete document.documentElement.dataset.airCursor;
          visible = false;
          lastCssCursor = '';
        }
        return;
      }

      if (!visible) {
        curNode.style.opacity = '1';
        visible = true;
      }

      const rx = Math.round(cursor.screenX);
      const ry = Math.round(cursor.screenY);
      if (rx !== lastX || ry !== lastY) {
        lastX = rx;
        lastY = ry;
        curNode.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      }

      if (cursor.cssCursor !== lastCssCursor) {
        lastCssCursor = cursor.cssCursor;
        document.documentElement.dataset.airCursor = cursor.cssCursor;
      }

      const sig = `${cursor.style}:${cursor.color}:${Math.round(cursor.holdProgress * 20)}`;
      if (sig !== lastSig) {
        lastSig = sig;
        icon.innerHTML = cursorSvgForStyle(cursor.style, cursor.color, cursor.holdProgress);
        label.textContent = cursor.label;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      delete document.documentElement.dataset.airCursor;
    };
  }, [trackingActive]);

  return (
    <div className="air-cursor-layer" aria-hidden="true">
      <div ref={nodeRef} className="air-cursor-pointer" style={{ opacity: 0 }}>
        <div ref={iconRef} className="air-cursor-icon" />
        <span ref={labelRef} className="air-cursor-label" />
      </div>
    </div>
  );
}
