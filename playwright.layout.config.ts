import { defineConfig, devices } from '@playwright/test';

// Private config for the layout-engine work: runs on port 4273 so it never
// collides with the concurrent responsive-fix agent's server on 4173.
// 1440x900 viewport per the gate.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 90000,
  expect: { timeout: 30000 },
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4273',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: ['--use-angle=swiftshader', '--use-gl=swiftshader'] },
      },
    },
  ],
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}{ext}',
  webServer: {
    command: 'VITE_E2E=1 npm run dev -- --host 127.0.0.1 --port 4273',
    url: 'http://127.0.0.1:4273/tests/panel-drag-harness.html',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
