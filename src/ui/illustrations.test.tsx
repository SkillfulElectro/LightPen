import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DistanceIllustration, PauseIllustration, PlacementIllustration } from './illustrations';

describe('tutorial illustrations', () => {
  it('exposes an accessible name and no visible text (all copy stays in i18n)', () => {
    render(
      <div>
        <PlacementIllustration label="placement" />
        <DistanceIllustration label="distance" />
        <PauseIllustration label="pause" />
      </div>,
    );
    const images = screen.getAllByRole('img');
    expect(images.map((img) => img.getAttribute('aria-label'))).toEqual([
      'placement',
      'distance',
      'pause',
    ]);
    for (const img of images) expect(img.textContent).toBe('');
  });

  it('draws with theme tokens instead of hard-coded colours', () => {
    const { container } = render(<PlacementIllustration label="placement" />);
    const markup = container.innerHTML;
    expect(markup).toContain('var(--success)');
    expect(markup).toContain('var(--error)');
    // The only literal colour allowed is white, used inside the verdict marks.
    expect(markup.replace(/#fff\b|#ffffff\b/g, '')).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
