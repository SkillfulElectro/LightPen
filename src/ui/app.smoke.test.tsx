import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';

// pdf.js needs a worker; stub the hook's heavy parts for the smoke test.
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
