import './styles/main.css';
import { App } from './App';
import { installTelemetry, telemetry, type EarlyError } from '@/bootstrap/telemetry';
import { initGtm } from './bootstrap/analytics';

// The ONE telemetry client (@hanzo/event): pageviews, product events, and errors
// all leave through POST /v1/event to Hanzo Cloud, lensed server-side into web
// analytics, product analytics, and error tracking. It subsumes both the old
// ~460 KB third-party Sentry client and the direct analytics.hanzo.ai page
// script — one door, fanned out server-side. It is dependency-free and tiny, so
// it rides the entry chunk and starts capturing immediately; a synchronous
// buffer still catches anything thrown before install and replays it, so no
// early boot error is lost.
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

// Install the ONE telemetry client eagerly — it is dependency-free and tiny, so
// unlike the old Sentry bundle it need not wait for idle, and installing now
// captures boot-time errors live. The bearer getter is injected so telemetry
// stays decoupled from IAM; signed-out visitors are captured anonymously. The
// synchronous buffer's errors are replayed inside, then its listeners retire.
installTelemetry({ getToken: accessToken, earlyErrors });
window.removeEventListener('error', bufferError);
window.removeEventListener('unhandledrejection', bufferError);
earlyErrors.length = 0;

// Marketing tags (Google Tag Manager) are an orthogonal, env-gated concern the
// telemetry client does not cover — defer the external script off first paint.
whenIdle(() => {
  try { initGtm(); } catch { /* best-effort — never break boot */ }
});

import { debugInjectTestEvents, debugGetCells, getCellCount } from '@/services/geo-convergence';
import { initMetaTags } from '@/services/meta-tags';
import { installRuntimeFetchPatch } from '@/services/runtime';
import { isCallback, handleCallback, accessToken, getUser } from '@/services/iam';
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

  // Bind the signed-in identity to the telemetry stream so product events are
  // attributed to the person + their org (cached; anonymous stays anonymous).
  // Best-effort — telemetry never blocks or breaks boot.
  void getUser().then((u) => {
    if (!u) return;
    telemetry.identify(u.sub);
    if (u.owner) telemetry.group(u.owner);
  }).catch(() => { /* best effort */ });

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
