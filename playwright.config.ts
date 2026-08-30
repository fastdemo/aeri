import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYBACK_BASE_URL || 'http://localhost:5173/aeri/'

export default defineConfig({
  testDir: 'tests',
  fullyParallel: false, // playback probes are heavy; avoid thundering
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 2,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 10_000,
  },
  webServer: process.env.PLAYBACK_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --port 5173 --host 127.0.0.1',
        url: 'http://127.0.0.1:5173/aeri/',
        reuseExistingServer: true,
        timeout: 30_000,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'], viewport: { width: 375, height: 667 } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    },
  ],
})
