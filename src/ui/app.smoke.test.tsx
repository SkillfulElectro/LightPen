import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';

// The bundler worker URL import is Vite-only; the test setup gives pdf.js the
// Node build, so a placeholder URL is enough here.
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }));

beforeAll(async () => {
  await initI18n();
  localStorage.clear();
  localStorage.setItem('lightpen:tutorial-seen', '1');
});

describe('App shell', () => {
  it('renders the toolbar and the empty viewer state', async () => {
    const { default: App } = await import('../App');
    render(<App />);
    expect((await screen.findAllByRole('button', { name: 'Open PDF' })).length).toBeGreaterThan(0);
    expect(screen.getByText('Drop a PDF here, or use Open PDF')).toBeTruthy();
  });

  it('opens settings and switches the theme', async () => {
    const { default: App } = await import('../App');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    const themeSelect = await screen.findByLabelText('Theme');
    fireEvent.change(themeSelect, { target: { value: 'dark' } });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });

  it('shows the gesture cheat sheet from the toolbar', async () => {
    const { default: App } = await import('../App');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Gesture cheat sheet' }));
    expect(await screen.findByRole('dialog', { name: 'Gesture cheat sheet' })).toBeTruthy();
  });

  it('runs the tutorial to the practice sandbox', async () => {
    const { default: App } = await import('../App');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tutorial' }));
    expect(await screen.findByRole('dialog', { name: 'Welcome to LightPen' })).toBeTruthy();
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByLabelText('Practice area')).toBeTruthy();
  });
});

describe('tutorial reacts to live gestures', () => {
  it('completes the write exercise when the tracker reports pen-down', async () => {
    const { useStore } = await import('../store/useStore');
    const { default: App } = await import('../App');
    render(<App />);
    useStore.setState({ tutorialOpen: true });
    const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('dialog', { name: 'Welcome to LightPen' });
    next(); // permission
    next(); // placement
    next(); // calibration
    next(); // practice: hover
    await screen.findByLabelText('Practice area');
    useStore.getState().noteGesture('hover');
    // The success badge renders inside the practice step.
    await waitFor(() => expect(screen.getByText(/Nice! Step complete/)).toBeTruthy());
    next(); // practice: write
    await waitFor(() =>
      expect(document.querySelector('.step-label')?.textContent).toBe('Step 6 of 10'),
    );
    useStore.getState().noteGesture('pen-down');
    await waitFor(() => expect(screen.getByText(/Nice! Step complete/)).toBeTruthy());
  });
});

describe('settings completeness', () => {
  it('offers calibration re-run and every documented gesture toggle', async () => {
    const { useStore } = await import('../store/useStore');
    const { default: App } = await import('../App');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));

    // Gesture toggles + sensitivity controls from the brief.
    for (const name of [
      'Pinch sensitivity',
      'Smoothing \\(jitter vs\\. lag\\)',
      'Dominant hand',
      'Theme',
      'Language',
      'Page swipe',
      'Fist pause',
      'Palm erase',
      'Default pen width',
      'Default pen colour',
      'Preview mirroring',
    ]) {
      expect(screen.getByLabelText(new RegExp(name))).toBeTruthy();
    }

    // Calibration can be re-run from Settings; the tutorial opens on its step.
    expect(screen.getByText(/Not calibrated yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Re-run calibration' }));
    await waitFor(() => expect(useStore.getState().tutorialOpen).toBe(true));
    expect(useStore.getState().tutorialStartStep).toBe(3);
    expect(await screen.findByText('Step 4 of 10')).toBeTruthy();
  });

  it('resets settings to defaults', async () => {
    const { useStore } = await import('../store/useStore');
    const { DEFAULT_SETTINGS } = await import('../core/types');
    const { default: App } = await import('../App');
    render(<App />);
    useStore.getState().updateSettings({ penWidth: 9 });
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    await waitFor(() =>
      expect(useStore.getState().settings.penWidth).toBe(DEFAULT_SETTINGS.penWidth),
    );
  });
});

describe('calibration step', () => {
  it('lets the user skip the rectangle (whole frame is a valid mapping)', async () => {
    const { useStore } = await import('../store/useStore');
    const { default: App } = await import('../App');
    render(<App />);
    useStore.setState({ tutorialOpen: true, tutorialStartStep: 3 });
    await screen.findByText('Step 4 of 10');
    expect(screen.getByText(/Nothing drawn yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(useStore.getState().settings.calibration).toBeNull());
    expect(await screen.findByText('Step 5 of 10')).toBeTruthy();
  });
});

describe('corrupt PDF handling', () => {
  it('shows the friendly error, not a crash', async () => {
    const { default: App } = await import('../App');
    render(<App />);
    window.dispatchEvent(
      new CustomEvent('lightpen:file', {
        detail: { name: 'broken.pdf', bytes: new Uint8Array([1, 2, 3, 4, 5]) },
      }),
    );
    const alert = await screen.findByRole('alert', undefined, { timeout: 5000 });
    expect(alert.textContent).toMatch(/could not be opened|could not be read as a PDF/i);
  });
});

// The sample PDF is served over HTTP in the app; jsdom has no network, so the
// real bytes are dispatched through the same event the drag-and-drop path uses.
async function openSample() {
  const { default: App } = await import('../App');
  render(<App />);
  const bytes = new Uint8Array(readFileSync('public/sample.pdf'));
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent('lightpen:file', { detail: { name: 'sample.pdf', bytes } }),
    );
  });
  await screen.findByLabelText('Ink layer', undefined, { timeout: 5000 });
  return document.querySelector('.viewer-scroll') as HTMLElement;
}

describe('PDF flow', () => {
  it('renders a real 3-page PDF and publishes its page size', async () => {
    const { useStore } = await import('../store/useStore');
    await openSample();
    expect(useStore.getState().pdf?.pageCount).toBe(3);
    expect(useStore.getState().pdf?.name).toBe('sample.pdf');
    expect(useStore.getState().currentPageSize).toEqual({ width: 612, height: 792 });
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
  });

  it('navigates pages and refuses to go before the first page', async () => {
    const { useStore } = await import('../store/useStore');
    await openSample();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Previous page' }).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(useStore.getState().currentPage).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await waitFor(() => expect(useStore.getState().currentPage).toBe(0));
  });
});

describe('zoom', () => {
  it('ctrl + wheel zooms around the pointer and switches to manual fit', async () => {
    const { useStore } = await import('../store/useStore');
    const viewer = await openSample();
    const before = useStore.getState().zoom;
    fireEvent.wheel(viewer, { deltaY: -120, ctrlKey: true, clientX: 100, clientY: 100 });
    await waitFor(() => expect(useStore.getState().zoom).toBeGreaterThan(before));
    expect(useStore.getState().fitMode).toBe('manual');
    const zoomed = useStore.getState().zoom;
    fireEvent.wheel(viewer, { deltaY: 120, ctrlKey: true, clientX: 100, clientY: 100 });
    await waitFor(() => expect(useStore.getState().zoom).toBeLessThan(zoomed));
  });

  it('clamps zoom to the supported range', async () => {
    const { useStore } = await import('../store/useStore');
    const viewer = await openSample();
    const big = { deltaY: -100000, ctrlKey: true, clientX: 0, clientY: 0 };
    fireEvent.wheel(viewer, big);
    fireEvent.wheel(viewer, big);
    fireEvent.wheel(viewer, big);
    await waitFor(() => expect(useStore.getState().zoom).toBe(4));
  });

  it('ignores a plain wheel event (normal page scrolling)', async () => {
    const { useStore } = await import('../store/useStore');
    const viewer = await openSample();
    const before = useStore.getState().zoom;
    fireEvent.wheel(viewer, { deltaY: -300, clientX: 10, clientY: 10 });
    expect(useStore.getState().zoom).toBe(before);
  });
});

describe('sidecar identity (ADR-020)', () => {
  it('keeps ink when the file is renamed, and never shares it between documents', async () => {
    const { useStore } = await import('../store/useStore');
    const { buildAnnotatedPdf } = await import('../core/pdfExport');
    const origError = console.error;
    console.error = () => {};
    await openSample();
    const bytes = new Uint8Array(readFileSync('public/sample.pdf'));
    useStore.getState().addStroke({
      id: 'identity-test',
      page: 0,
      color: '#e11d48',
      width: 2,
      createdAt: 1,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
    });
    await waitFor(() => expect(useStore.getState().annotations.all).toHaveLength(1));
    // Let the debounced autosave land.
    await new Promise((r) => setTimeout(r, 1000));

    // Same content, different name → same annotations.
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('lightpen:file', { detail: { name: 'renamed.pdf', bytes } }),
      );
    });
    await waitFor(() => expect(useStore.getState().annotations.all).toHaveLength(1), {
      timeout: 5000,
    });

    // Same name, different content → a clean document.
    const other = new Uint8Array(await buildAnnotatedPdf(bytes, []));
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('lightpen:file', { detail: { name: 'renamed.pdf', bytes: other } }),
      );
    });
    await waitFor(() => expect(useStore.getState().annotations.all).toHaveLength(0), {
      timeout: 5000,
    });
    console.error = origError;
  });
});

describe('camera panel', () => {
  it('hides the self-view by default and can show it again', async () => {
    const { useStore } = await import('../store/useStore');
    const { DEFAULT_SETTINGS } = await import('../core/types');
    const { default: App } = await import('../App');
    useStore.getState().updateSettings({ showPreview: DEFAULT_SETTINGS.showPreview });
    render(<App />);
    const toggle = await screen.findByRole('button', { name: 'Show camera preview' });
    // Off by default on every viewport — watching yourself is opt-in.
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Hide camera preview' })).toBeTruthy();
  });

  it('keeps the tracking controls in the panel while the self-view is hidden', async () => {
    const { useStore } = await import('../store/useStore');
    const { default: App } = await import('../App');
    useStore.getState().updateSettings({ showPreview: false });
    render(<App />);
    // Hiding the video must never hide how to start/stop the camera: the
    // start button and the privacy note stay part of the collapsed panel.
    const startButton = await screen.findByRole('button', { name: 'Start camera' });
    expect(startButton).toBeTruthy();
    expect(screen.getByText(/No frames ever leave your device/)).toBeTruthy();
    expect(document.querySelector('.camera-panel')?.className).toContain('collapsed');
  });

  it('shows the live status even when the self-view is hidden', async () => {
    const { useStore } = await import('../store/useStore');
    const { default: App } = await import('../App');
    useStore.getState().updateSettings({ showPreview: false });
    render(<App />);
    await screen.findByRole('button', { name: 'Show camera preview' });
    // Hiding the preview must not hide that the camera is running.
    act(() => useStore.getState().setTracking({ active: true, fps: 27 }));
    expect(await screen.findByText(/27 FPS/)).toBeTruthy();
  });
});
