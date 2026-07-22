// Sentry, code-split out of the entry chunk.
//
// @sentry/browser is ~460 KB raw / ~130 KB gzip — dead weight in the critical
// path on a low-end laptop, where every eager KB is main-thread parse/compile
// time before first paint. main.ts imports this lazily once the browser is idle
// (see main.ts), so error tracking still installs within the first second but
// never blocks the shell or the map from painting. A tiny synchronous error
// buffer in main.ts captures anything thrown before this loads and replays it.

import * as Sentry from '@sentry/browser';

export interface EarlyError {
  error?: unknown;
  message?: string;
}

export function initSentry(buffered: EarlyError[] = []): void {
  // DSN is provisioned at build time from KMS (VITE_SENTRY_DSN). With none set,
  // stay a no-op rather than POSTing to a stale endpoint (403 on every event).
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    release: `hanzo-world@${__APP_VERSION__}`,
    environment: location.hostname === 'world.hanzo.ai' ? 'production'
      : location.hostname.includes('vercel.app') ? 'preview'
      : 'development',
    enabled: !location.hostname.startsWith('localhost') && !('__TAURI_INTERNALS__' in window),
    sendDefaultPii: true,
    tracesSampleRate: 0.1,
    ignoreErrors: [
      'Invalid WebGL2RenderingContext',
      'WebGL context lost',
      /reading 'imageManager'/,
      /ResizeObserver loop/,
      /NotAllowedError/,
      /InvalidAccessError/,
      /importScripts/,
      /^TypeError: Load failed$/,
      /^TypeError: Failed to fetch( \(.*\))?$/,
      /^TypeError: cancelled$/,
      /^TypeError: NetworkError/,
      /runtime\.sendMessage\(\)/,
      /Java object is gone/,
      /^Object captured as promise rejection with keys:/,
      /Unable to load image/,
      /Non-Error promise rejection captured with value:/,
      /Connection to Indexed Database server lost/,
      /webkit\.messageHandlers/,
      /unsafe-eval.*Content Security Policy/,
      /Fullscreen request denied/,
      /requestFullscreen/,
      /vc_text_indicators_context/,
      /Program failed to link: null/,
      /too much recursion/,
    ],
    beforeSend(event) {
      const msg = event.exception?.values?.[0]?.value ?? '';
      if (msg.length <= 3 && /^[a-zA-Z_$]+$/.test(msg)) return null;
      const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
      // Suppress module-import failures only when originating from browser extensions
      if (/Importing a module script failed/.test(msg)) {
        if (frames.some(f => /^(chrome|moz)-extension:/.test(f.filename ?? ''))) return null;
      }
      // Suppress maplibre internal null-access crashes (light, placement) only when stack is in map chunk
      if (/this\.style\._layers|this\.light is null|can't access property "type", \w+ is undefined|Cannot read properties of null \(reading '(id|type)'\)/.test(msg)) {
        if (frames.some(f => /\/map-[A-Za-z0-9]+\.js/.test(f.filename ?? ''))) return null;
      }
      return event;
    },
  });

  // Replay anything the synchronous boot buffer caught before we loaded.
  for (const e of buffered) {
    if (e.error !== undefined) Sentry.captureException(e.error);
    else if (e.message) Sentry.captureMessage(e.message);
  }
}
