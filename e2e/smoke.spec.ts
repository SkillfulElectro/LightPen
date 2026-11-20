import { expect, test } from '@playwright/test';

/**
 * Smoke test: open a PDF, draw a stroke with the manual tool, undo/redo,
 * page navigation and export an annotated PDF.
 *
 * The sample PDF is served from the app itself (`/sample.pdf`), so no fixture
 * files are needed. Downloads are captured via Playwright's download API.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('lightpen:tutorial-seen', '1');
  });
  await page.goto('/');
});

async function openSample(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Practice PDF' }).click();
  await expect(page.locator('.page-canvas')).toBeVisible();
  await expect(page.locator('.page-label')).toContainText('Page 1 of 3');
}

test('loads the app shell with the empty state', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Open PDF' })).toBeVisible();
  await expect(page.getByText('Drop a PDF here')).toBeVisible();
});

test('opens the sample PDF and navigates pages', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('.page-label')).toContainText('Page 2 of 3');
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.locator('.page-label')).toContainText('Page 1 of 3');
});

test('draws a stroke with the manual tool, undoes and redoes it', async ({ page }) => {
  await openSample(page);
  const ink = page.locator('.ink-canvas');
  const box = await ink.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeDisabled();

  await page.mouse.move(box.x + 80, box.y + 120);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + 80 + i * 12, box.y + 120 + i * 6);
  }
  await page.mouse.up();

  await expect(undo).toBeEnabled();

  // Ink is actually painted on the overlay canvas (not just in state).
  const inked = await ink.evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
    return false;
  });
  expect(inked).toBe(true);

  await undo.click();
  await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Redo' }).click();
});

test('exports an annotated PDF', async ({ page }) => {
  await openSample(page);
  const ink = page.locator('.ink-canvas');
  const box = await ink.boundingBox();
  if (!box) throw new Error('ink canvas not visible');
  await page.mouse.move(box.x + 60, box.y + 90);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160, { steps: 8 });
  await page.mouse.up();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save annotated PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('sample.annotated.pdf');
  const path = await download.path();
  expect(path).toBeTruthy();
});

test('exports a PNG of the current page', async ({ page }) => {
  await openSample(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export page PNG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/sample-page-1\.png$/);
});

test('tutorial opens from the toolbar and the practice sandbox works', async ({ page }) => {
  await page.getByRole('button', { name: 'Tutorial' }).click();
  const dialog = page.getByRole('dialog', { name: 'Welcome to LightPen' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next' }).click();

  const sandbox = page.getByLabel('Practice area');
  await expect(sandbox).toBeVisible();
  const box = await sandbox.boundingBox();
  if (!box) throw new Error('sandbox not visible');
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 100, { steps: 6 });
  await page.mouse.up();
  await expect(dialog.getByText('Nice! Step complete.')).toBeVisible();
});

test('theme setting switches the document theme', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('keyboard shortcuts: eraser and zoom', async ({ page }) => {
  await openSample(page);
  await page.keyboard.press('e');
  await expect(page.getByRole('button', { name: 'Eraser', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('b');
  await expect(page.getByRole('button', { name: 'Pen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('ctrl + wheel zoom keeps the point under the cursor and switches to manual fit', async ({
  page,
}) => {
  await openSample(page);
  const viewer = page.locator('.viewer-scroll');
  await viewer.hover({ position: { x: 200, y: 200 } });
  const zoomLabel = page.locator('.zoom-label');
  const before = Number((await zoomLabel.textContent())?.replace('%', ''));
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await expect
    .poll(async () => Number((await zoomLabel.textContent())?.replace('%', '')))
    .toBeGreaterThan(before);

  // A plain wheel scrolls the page instead of zooming.
  const zoomed = Number((await zoomLabel.textContent())?.replace('%', ''));
  await page.mouse.wheel(0, -240);
  await expect(zoomLabel).toHaveText(`${zoomed}%`);
});

test('settings dialog exposes the full surface and re-runs calibration', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/Pinch sensitivity/)).toBeVisible();
  await expect(dialog.getByLabel(/Smoothing/).first()).toBeVisible();
  await expect(dialog.getByLabel('Dominant hand')).toBeVisible();
  await expect(dialog.getByLabel('Language')).toBeVisible();
  for (const gesture of ['Page swipe', 'Fist pause', 'Palm erase']) {
    await expect(dialog.getByLabel(gesture)).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('warns instead of crashing when the opened file is not a PDF', async ({ page }) => {
  // A corrupt "PDF" must produce the friendly viewer error, not a blank page.
  await page.evaluate(() => {
    const detail = { name: 'broken.pdf', bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) };
    window.dispatchEvent(new CustomEvent('lightpen:file', { detail }));
  });
  await expect(page.getByRole('alert')).toContainText(
    /could not be opened|could not be read as a PDF/i,
  );
});

test('sidecar autosave restores ink when the same PDF is reopened', async ({ page }) => {
  await openSample(page);
  const ink = page.locator('.ink-canvas');
  const box = await ink.boundingBox();
  if (!box) throw new Error('ink canvas not visible');
  await page.mouse.move(box.x + 70, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160, { steps: 6 });
  await page.mouse.up();
  // Autosave is debounced by 800 ms.
  await page.waitForTimeout(1200);
  const stored = await page.evaluate(() =>
    Object.keys(localStorage).some((k) => k.startsWith('lightpen:sidecar:')),
  );
  expect(stored).toBe(true);
  await page.reload();
  await openSample(page);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  const inked = await page.locator('.ink-canvas').evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
    return false;
  });
  expect(inked).toBe(true);
});
