/** jsdom lacks a few browser APIs the app relies on; provide minimal stubs. */
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// pdf.js: the bundler-style fake worker cannot be imported under Node, so the
// hook is given the Node-compatible legacy build instead.
await import('pdfjs-dist/legacy/build/pdf.mjs').then(async (legacy) => {
  const { setPdfJsApi } = await import('./hooks/usePdfDocument');
  setPdfJsApi(legacy as unknown as Parameters<typeof setPdfJsApi>[0]);
});

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

if (!HTMLCanvasElement.prototype.getContext) {
  HTMLCanvasElement.prototype.getContext = vi.fn();
}

afterEach(() => {
  cleanup();
});
