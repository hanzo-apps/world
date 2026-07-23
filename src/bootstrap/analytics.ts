// Product analytics, code-split out of the entry chunk (loaded lazily from
// main.ts once the browser is idle, like Sentry). Injects the analytics.hanzo.ai
// tracking script, guarded on a build-time website id so it stays a no-op until
// one is provisioned from KMS (VITE_ANALYTICS_WEBSITE_ID). track() forwards
// custom product events to the same collector and no-ops when the script or id
// is absent, so call sites never branch on availability.

declare global {
  interface Window {
    umami?: { track?: (name: string, data?: Record<string, unknown>) => void };
  }
}

export function initAnalytics(): void {
  const id = import.meta.env.VITE_ANALYTICS_WEBSITE_ID;
  if (!id) return;
  // Same enable guard as Sentry: never POST to the shared collector from a dev
  // machine (localhost) or the offline Tauri desktop shell.
  if (location.hostname.startsWith('localhost') || '__TAURI_INTERNALS__' in window) return;
  if (document.querySelector('script[data-website-id]')) return;
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://analytics.hanzo.ai/script.js';
  s.dataset.websiteId = id;
  document.head.appendChild(s);
}

/** Forward a custom product event to analytics.hanzo.ai. No-op until the script loads. */
export function track(name: string, data?: Record<string, unknown>): void {
  window.umami?.track?.(name, data);
}

/** Google Tag Manager container — one env-gated container that manages the GA /
 * Facebook / LinkedIn / X marketing tags from GTM's UI (no per-pixel code). No-op
 * until VITE_GTM_ID is provisioned from KMS. */
export function initGtm(): void {
  const id = import.meta.env.VITE_GTM_ID;
  if (!id) return;
  if (location.hostname.startsWith('localhost') || '__TAURI_INTERNALS__' in window) return;
  if (document.querySelector('script[data-gtm]')) return;
  const dl = ((window as unknown as { dataLayer?: unknown[] }).dataLayer ||= []);
  dl.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
  s.dataset.gtm = '1';
  document.head.appendChild(s);
}
