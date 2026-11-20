import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }));

beforeAll(async () => {
  await initI18n();
  localStorage.clear();
  localStorage.setItem('lightpen:tutorial-seen', '1');
});

describe('accessibility basics', () => {
  it('closes a dialog with the Escape key and restores focus', async () => {
    const { default: App } = await import('../App');
    render(<App />);
    const opener = await screen.findByRole('button', { name: 'Settings' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('gives every toolbar control an accessible name', async () => {
    const { default: App } = await import('../App');
    render(<App />);
    const toolbar = await screen.findByRole('toolbar');
    const buttons = toolbar.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(10);
    for (const button of Array.from(buttons)) {
      const name = button.getAttribute('aria-label') ?? button.textContent?.trim();
      expect(name && name.length > 0).toBe(true);
    }
  });

  it('marks the toggle buttons with aria-pressed', async () => {
    const { default: App } = await import('../App');
    render(<App />);
    const pen = await screen.findByRole('button', { name: 'Pen' });
    expect(pen.getAttribute('aria-pressed')).toBe('true');
    const eraser = screen.getByRole('button', { name: 'Eraser' });
    fireEvent.click(eraser);
    expect(eraser.getAttribute('aria-pressed')).toBe('true');
    expect(pen.getAttribute('aria-pressed')).toBe('false');
  });

  it('announces the page counter politely', async () => {
    const { default: App } = await import('../App');
    render(<App />);
    const counter = await screen.findByText(/Page 1 of/);
    expect(counter.getAttribute('aria-live')).toBe('polite');
  });
});
