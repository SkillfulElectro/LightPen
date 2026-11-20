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
