/**
 * Global viewport-level Air Cursor Overlay.
 * Morphs visual mouse cursor style dynamically based on the active air touch gesture
 * (hover arrow, interactive pointer hand, pen nib, eraser ring, two-finger scroll,
 * pinch-zoom magnifier, fist grab, and air-tap ripple).
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

function cursorSvgForStyle(style: string, color: string, holdProgress: number): string {
  switch (style) {
    case 'pen':
      return `<svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M5 23L9.5 21.5L22 9L19 6L6.5 18.5L5 23Z" fill="${color}" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
        <circle cx="4.5" cy="23.5" r="2.5" fill="${color}" stroke="#ffffff" stroke-width="1.2"/>
      </svg>`;
    case 'eraser':
      return `<svg width="34" height="34" viewBox="0 0 34 34" fill="none">
        <circle cx="17" cy="17" r="13" fill="rgba(217,119,6,0.18)" stroke="#d97706" stroke-width="2" stroke-dasharray="4 3"/>
        <circle cx="17" cy="17" r="2.5" fill="#d97706"/>
      </svg>`;
    case 'pointer':
      return `<svg width="26" height="26" viewBox="0 0 26 26" fill="none">
        <path d="M9 3.5C9 2.67 9.67 2 10.5 2C11.33 2 12 2.67 12 3.5V11H13.5C14.33 11 15 11.67 15 12.5V11.5C15 10.67 15.67 10 16.5 10C17.33 10 18 10.67 18 11.5V13H19.5C20.33 13 21 13.67 21 14.5V18C21 21.31 18.31 24 15 24H12.5C9.8 24 7.7 22.1 6.7 19.6L4.2 14.3C3.85 13.55 4.18 12.66 4.93 12.31C5.68 11.96 6.57 12.29 6.92 13.04L9 16V3.5Z" fill="#2563eb" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
      </svg>`;
    case 'scroll':
      return `<svg width="30" height="30" viewBox="0 0 30 30" fill="none">
        <circle cx="15" cy="15" r="12" fill="rgba(15,23,42,0.82)" stroke="#ffffff" stroke-width="1.6"/>
        <path d="M15 7L11.5 11H18.5L15 7ZM15 23L11.5 19H18.5L15 23Z" fill="#ffffff"/>
      </svg>`;
    case 'zoom-in':
    case 'zoom-out': {
      const sign = style === 'zoom-in'
        ? '<path d="M13 9V17M9 13H17" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>'
        : '<path d="M9 13H17" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>';
      return `<svg width="30" height="30" viewBox="0 0 30 30" fill="none">
        <circle cx="13" cy="13" r="9" fill="rgba(15,23,42,0.85)" stroke="#ffffff" stroke-width="1.8"/>
        <path d="M20 20L26 26" stroke="#0f172a" stroke-width="4" stroke-linecap="round"/>
        <path d="M20 20L26 26" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
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

  useEffect(() => {
    let raf = 0;
    let lastSig = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const node = nodeRef.current;
      const icon = iconRef.current;
      const label = labelRef.current;
      if (!node || !icon || !label) return;

      const cursor = useStore.getState().airCursor;
      if (!cursor) {
        if (node.style.opacity !== '0') {
          node.style.opacity = '0';
          document.documentElement.style.removeProperty('--air-cursor-style');
        }
        return;
      }

      node.style.opacity = '1';
      node.style.transform = `translate3d(${Math.round(cursor.screenX)}px, ${Math.round(cursor.screenY)}px, 0)`;
      document.documentElement.dataset.airCursor = cursor.cssCursor;

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
  }, []);

  return (
    <div className="air-cursor-layer" aria-hidden="true">
      <div ref={nodeRef} className="air-cursor-pointer" style={{ opacity: 0 }}>
        <div ref={iconRef} className="air-cursor-icon" />
        <span ref={labelRef} className="air-cursor-label" />
      </div>
    </div>
  );
}
