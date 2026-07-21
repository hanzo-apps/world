import { defineConfig, devices } from '@playwright/test';

// TEMP preview-based harness for the globe-render proof (deleted after the run).
// Serves the Rollup e2e-mode build via `vite preview` — NO dep optimizer, prod-
// representative — with readiness gated on the actual app route so it is warm.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 90000,
  expect: { timeout: 30000 },
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 720 },
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--use-angle=swiftshader', '--use-gl=swiftshader'] },
      },
    },
  ],
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/?variant=cloud',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
