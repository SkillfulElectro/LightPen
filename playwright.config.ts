import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against the web build (`npm run dev`), which shares 100% of
 * the app code with the Tauri shell. Camera/hand tracking is not exercised
 * here (no camera in CI); the manual drawing path, export and tutorial are.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:1420',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: [],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 1420 --strictPort',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
