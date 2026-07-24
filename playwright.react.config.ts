import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the REACT entry (index.react.html → src/react/main.tsx).
 *
 * The shipping vanilla suite (playwright.config.ts) drives index.html through the
 * tests/*.html harnesses. This is the SECOND, isolated e2e path — the cutover gate —
 * that serves the React + @hanzo/gui surface and runs the CORE specs against it:
 * globe island renders, the variant tabs switch the panel set, PanelGrid drag/reorder
 * persists to the SHARED `panel-order` key, a panel's live fetch renders, and the
 * unified shell/auth mounts. It is deliberately separate so `npm run test:e2e` (the
 * vanilla contract) is never perturbed while the React surface is proven cutover-ready.
 *
 * The React dev server serves the vanilla app at `/` and the React entry at
 * `/index.react.html`, so every spec here navigates to `/index.react.html`.
 */
export default defineConfig({
  testDir: './e2e-react',
  workers: 1,
  timeout: 90000,
  expect: {
    timeout: 30000,
  },
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4273',
    viewport: { width: 1280, height: 720 },
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-react',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-angle=swiftshader', '--use-gl=swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: 'VITE_E2E=1 npm run dev:react -- --host 127.0.0.1 --port 4273',
    url: 'http://127.0.0.1:4273/index.react.html',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
