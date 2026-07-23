import './styles/main.css';
import { App } from './App';
import type { EarlyError } from './bootstrap/sentry';
import { initAnalytics, initGtm } from './bootstrap/analytics';

// Telemetry (Sentry — ~460 KB raw / ~130 KB gzip) is code-split out of the entry
// chunk. On a low-end laptop every eager KB is main-thread parse/compile time
// before first paint; deferring Sentry keeps the shell + map off the critical
// path. Error tracking still installs within the first second (whenIdle, below),
// and a tiny synchronous buffer captures anything thrown before it loads and
// replays it — so no early boot error is lost.
const earlyErrors: EarlyError[] = [];
const bufferError = (e: ErrorEvent | PromiseRejectionEvent): void => {
  const err = (e as ErrorEvent).error ?? (e as PromiseRejectionEvent).reason ?? (e as ErrorEvent).message;
  if (err !== undefined && earlyErrors.length < 20) earlyErrors.push({ error: err });
};
window.addEventListener('error', bufferError);
window.addEventListener('unhandledrejection', bufferError);

// Suppress NotAllowedError from YouTube IFrame API's internal play() — browser autoplay policy,
// not actionable. The YT IFrame API doesn't expose the play() promise so it leaks as unhandled.
window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.name === 'NotAllowedError') e.preventDefault();
});

const whenIdle = (cb: () => void): void => {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(cb, { timeout: 2000 });
  else setTimeout(cb, 1200);
};

// After first paint, install telemetry off the critical path: Sentry (heavy, so
// code-split and dynamically imported here, replaying any buffered errors) and
// product analytics (tiny — track() is used synchronously by App so it lives in
// the main chunk; only its script-injecting init is deferred). Both are env-gated
// no-ops until their IDs are provisioned, and best-effort so they never break boot.
whenIdle(() => {
  import('./bootstrap/sentry').then(({ initSentry }) => {
    initSentry(earlyErrors);
    window.removeEventListener('error', bufferError);
    window.removeEventListener('unhandledrejection', bufferError);
    earlyErrors.length = 0;
  }).catch(() => { /* telemetry is best-effort — never break boot */ });
  try { initAnalytics(); initGtm(); } catch { /* telemetry is best-effort — never break boot */ }
});

import { debugInjectTestEvents, debugGetCells, getCellCount } from '@/services/geo-convergence';
import { initMetaTags } from '@/services/meta-tags';
import { installRuntimeFetchPatch } from '@/services/runtime';
import { isCallback, handleCallback } from '@/services/iam';
import { initDashboardSync } from '@/services/dashboard';
import { loadDesktopSecrets } from '@/services/runtime-config';
import { applyStoredTheme } from '@/utils/theme-manager';
import { applyStoredUiScale } from '@/utils/ui-scale';
import { clearChunkReloadGuard, installChunkReloadGuard } from '@/bootstrap/chunk-reload';
import { installServiceWorker } from '@/services/sw-update';

// Auto-reload on stale chunk 404s after deployment (Vite fires this for modulepreload failures).
const chunkReloadStorageKey = installChunkReloadGuard(__APP_VERSION__);

// Initialize dynamic meta tags for sharing
initMetaTags();

// In desktop mode, route /v1/world/* calls to the local Tauri sidecar backend.
installRuntimeFetchPatch();
void loadDesktopSecrets();

// Apply stored theme preference before app initialization (safety net for inline script)
applyStoredTheme();

// Apply the user's saved text-size / UI scale before first paint (accessibility).
applyStoredUiScale();

// Remove no-transition class after first paint to enable smooth theme transitions
requestAnimationFrame(() => {
  document.documentElement.classList.remove('no-transition');
});

async function boot(): Promise<void> {
  // Complete the hanzo.id OIDC PKCE redirect before the dashboard renders, then
  // restore a clean URL (the SPA server returns index.html for /auth/callback).
  if (isCallback()) {
    try {
      const returnTo = await handleCallback();
      history.replaceState({}, '', returnTo);
    } catch (err) {
      console.error('[iam] login callback failed', err);
      history.replaceState({}, '', '/');
    }
  }

  // Signed in? Pull this identity's dashboard from the server into localStorage
  // before the app reads it (server precedence, cross-device), then observe further
  // changes so they auto-sync. Anonymous is untouched. Best-effort, never blocks boot.
  await initDashboardSync();

  const app = new App('app');
  // Dev/e2e observability: expose the running App so tests can drive layout
  // invariants (e.g. the full-width-map anchor heal) without any production hook.
  // Set BEFORE init so it never depends on the (slow) initial data load.
  if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
    (window as unknown as { __app?: unknown }).__app = app;
  }
  await app.init();
  // Live-value flash: changed numbers bump briefly (one observer, zero panel coupling).
  const { installLiveFlash } = await import('@/services/live-flash');
  installLiveFlash();
  // Clear the one-shot guard after a successful boot so future stale-chunk incidents can recover.
  clearChunkReloadGuard(chunkReloadStorageKey);
}

void boot().catch(console.error);

// Debug helpers for geo-convergence testing (remove in production)
(window as unknown as Record<string, unknown>).geoDebug = {
  inject: debugInjectTestEvents,
  cells: debugGetCells,
  count: getCellCount,
};

// Beta mode toggle: type `beta=true` / `beta=false` in console
Object.defineProperty(window, 'beta', {
  get() {
    const on = localStorage.getItem('worldmonitor-beta-mode') === 'true';
    console.log(`[Beta] ${on ? 'ON' : 'OFF'}`);
    return on;
  },
  set(v: boolean) {
    if (v) localStorage.setItem('worldmonitor-beta-mode', 'true');
    else localStorage.removeItem('worldmonitor-beta-mode');
    location.reload();
  },
});

// Register the service worker and keep long-lived tabs on the latest build. All
// SW lifecycle lives in one place; see src/services/sw-update.ts.
installServiceWorker();
