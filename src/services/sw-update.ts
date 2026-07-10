// Service-worker lifecycle for the web PWA. The desktop (Tauri) build loads its
// bundled assets directly and never registers a worker.
//
// The problem this solves: with several releases a day, a stale precache used to
// serve an OLD index.html that referenced hashed bundles the newer build had
// already replaced — the app flashed the old build, then went black when old and
// new chunks mixed. The cure lives in one place across two files:
//
//   1. vite.config PWA — registerType 'autoUpdate' + workbox skipWaiting/clientsClaim
//      make a freshly-deployed worker activate immediately, and index.html is served
//      network-first (never precached) so the shell always names current bundles.
//   2. This module — register the worker and, through vite-plugin-pwa's autoUpdate
//      flow (workbox-window), reload the tab exactly once when a NEW worker takes
//      control: only on a real update, never on first install, never in a loop. It
//      also asks the worker to re-check for a deploy whenever the tab becomes
//      visible, so a day-old tab picks up a new build on the user's next glance
//      rather than waiting out the hourly poll.

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
    // autoUpdate: vite-plugin-pwa (via workbox-window) reloads the page exactly
    // once when a new worker activates as an update — the guarded controllerchange
    // reload, done correctly (fires on `activated`/isUpdate, so it skips the
    // first-install claim and cannot loop). We add only the update *checks*.
    registerSW({
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;

        const checkForUpdate = (): void => {
          if (!navigator.onLine) return;
          registration.update().catch(() => {});
        };

        // Long-lived foreground tab: poll hourly as a backstop.
        setInterval(checkForUpdate, UPDATE_POLL_MS);

        // The instant a backgrounded tab is foregrounded, learn about any deploy
        // that shipped while it was hidden — before the user interacts and triggers
        // a lazy chunk import the server may have already purged.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate();
        });
      },
      onOfflineReady() {
        console.log('[PWA] ready for offline use');
      },
    });
  });
}
