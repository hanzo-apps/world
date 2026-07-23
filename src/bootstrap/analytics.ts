// Marketing tags — Google Tag Manager, one env-gated container that manages the
// GA / Facebook / LinkedIn / X marketing tags from GTM's UI (no per-pixel code).
// This is an orthogonal concern to first-party product/web/error telemetry, which
// flows through @hanzo/event (see bootstrap/telemetry.ts) to the ONE Hanzo Cloud
// door and is fanned server-side into the web-analytics lens (analytics.hanzo.ai),
// so the app never loads that collector's page script directly. No-op until
// VITE_GTM_ID is provisioned from KMS.

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
