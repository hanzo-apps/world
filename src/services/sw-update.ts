// Service-worker lifecycle for the web PWA. The desktop (Tauri) build loads its
// bundled assets directly and never registers a worker.
//
// The problem this solves: with several releases a day, a stale precache used to
// serve an OLD index.html that referenced hashed bundles the newer build had
// already replaced — the app flashed the old build, then went black when old and
// new chunks mixed. The cure lives in one place across two files:
//
//   1. vite.config PWA — registerType 'prompt' + workbox skipWaiting/clientsClaim +
//      cleanupOutdatedCaches make a freshly-deployed worker take over on next load
//      and purge stale precache, and index.html is served network-first (never
//      precached) so the shell always names current bundles.
//   2. This module — register the worker, aggressively re-check for a deploy
//      (immediately on load, on every tab-focus, hourly), and when a NEW worker is
//      ready show a subtle "new version — reload" toast (never a surprise reload,
//      never a loop). A stranded tab still self-heals via the network-first shell +
//      the stale-chunk reload guard (see bootstrap/chunk-reload); the toast just
//      offers a clean one-tap reload.

// Hourly backstop for a tab left in the foreground; visibilitychange covers the
// far more common "tab was hidden, now it's looked at again" case.
const UPDATE_POLL_MS = 60 * 60 * 1000;

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

export function installServiceWorker(): void {
  if (isTauri()) return;
  if (!('serviceWorker' in navigator)) return;

  void import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;

        const checkForUpdate = (): void => {
          if (!navigator.onLine) return;
          registration.update().catch(() => {});
        };

        // Heal a tab stuck on a pre-fix worker as early as possible: re-check the
        // instant we register, then on every foreground and hourly as a backstop.
        checkForUpdate();
        setInterval(checkForUpdate, UPDATE_POLL_MS);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate();
        });

        // Framework-agnostic "new worker ready" detection — robust even with
        // skipWaiting (which never enters the classic `waiting` state): a freshly
        // INSTALLED worker while a controller already exists means a new build
        // shipped. Offer a one-tap reload rather than yanking the page.
        registration.addEventListener('updatefound', () => {
          const sw = registration.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateToast(() => updateSW(true));
            }
          });
        });
      },
      onOfflineReady() {
        console.log('[PWA] ready for offline use');
      },
    });
  });
}

// A single, subtle "new version — reload" toast. Bottom-center, theme-aware, and
// interactive (the shared .toast-notification is pointer-events:none). Shown at most
// once per page life; Reload triggers the guarded skip-waiting reload.
let updateToastShown = false;
function showUpdateToast(reload: () => void): void {
  if (updateToastShown) return;
  updateToastShown = true;
  const el = document.createElement('div');
  el.className = 'sw-update-toast';
  el.setAttribute('role', 'status');
  el.innerHTML =
    '<span class="sw-update-msg">A new version is available.</span>' +
    '<button type="button" class="sw-update-reload">Reload</button>' +
    '<button type="button" class="sw-update-dismiss" aria-label="Dismiss">×</button>';
  el.querySelector('.sw-update-reload')?.addEventListener('click', () => reload());
  el.querySelector('.sw-update-dismiss')?.addEventListener('click', () => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 300);
    updateToastShown = false;
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
}
