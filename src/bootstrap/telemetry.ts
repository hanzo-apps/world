// The ONE telemetry client for Hanzo World.
//
// Every kind of signal — pageview, product event, identify/group, AND errors —
// leaves the app through a single client (@hanzo/event) to the ONE Hanzo Cloud
// front door:
//
//   POST {host}/v1/event   body: { batch: [Event, …] }   ->  { accepted, dropped }
//
// Cloud resolves the tenant server-side (from the validated bearer, never from a
// field the client sends) and fans the one stream into three lenses: web
// analytics (analytics.hanzo.ai), product analytics (insights.hanzo.ai), and
// error tracking (sentry.hanzo.ai). Errors are just `type:'error'` events on the
// same pipe, so this subsumes both the standalone @sentry client and a direct
// analytics.hanzo.ai (Umami) page-script — one door, fanned out server-side.
//
// @hanzo/event is dependency-free and a few KB, so — unlike the old ~460 KB
// Sentry bundle — it rides the entry chunk with negligible parse cost and starts
// capturing from the first line, no lazy split needed.

import { createAnalytics, EVENTS, type Analytics, type WireEvent } from '@hanzo/event';

export { EVENTS };

/** An error caught by the synchronous boot buffer before the client is live. */
export interface EarlyError {
  error?: unknown;
  message?: string;
}

type Commerce = Pick<WireEvent, 'productId' | 'quantity' | 'revenue' | 'currency'>;

const isBrowser = (): boolean => typeof window !== 'undefined' && typeof document !== 'undefined';

// A write-only publishable ingest key (pk_…), if the deployment ships one. It is
// safe to bundle (cannot read, only ingest) and lets logged-out visitors reach
// the fail-closed door: the door HMAC-verifies it to an org, so anonymous
// marketing/public pageviews + errors are accepted with no session. Mint via
// POST /v1/ingest/keys. Absent → logged-out events post anonymously (best-effort).
function ingestKey(): string | undefined {
  const k = import.meta.env.VITE_HANZO_INGEST_KEY;
  return k && k.trim() ? k.trim() : undefined;
}

// Cloud front door by brand — mirrors services/iam.ts issuer resolution so a Lux
// or Zoo white-label fork sends its telemetry to its own cloud, never Hanzo's.
function resolveHost(): string {
  const h = isBrowser() ? location.hostname : '';
  if (h.endsWith('lux.network') || h.endsWith('lux.id')) return 'https://api.lux.network';
  if (h.endsWith('zoo.ngo') || h.endsWith('zoo.network') || h.endsWith('zoo.id')) return 'https://api.zoo.network';
  return 'https://api.hanzo.ai';
}

// Telemetry runs on the deployed site only — never localhost dev or the Tauri
// desktop shell (matches the prior Sentry/analytics enable policy).
function enabledEnv(): boolean {
  if (!isBrowser()) return false;
  const h = location.hostname;
  if (h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]') return false;
  if ('__TAURI_INTERNALS__' in window) return false;
  return true;
}

// Consent gate: honor Do-Not-Track / Global Privacy Control and an explicit
// opt-out. The client is anonymous and tenant-safe by default (a random visitor
// id, first-touch attribution, no org) so there is no PII to leak; a signed-in
// session only adds the user's stable id via identify().
function consented(): boolean {
  if (!isBrowser()) return false;
  const nav = navigator as Navigator & {
    doNotTrack?: string | null;
    msDoNotTrack?: string | null;
    globalPrivacyControl?: boolean;
  };
  const dnt = nav.doNotTrack ?? (window as unknown as { doNotTrack?: string }).doNotTrack ?? nav.msDoNotTrack;
  if (dnt === '1' || dnt === 'yes' || nav.globalPrivacyControl === true) return false;
  try {
    if (localStorage.getItem('hanzo-telemetry-optout') === '1') return false;
  } catch {
    /* private mode — treat as consented */
  }
  return true;
}

// Curated error noise-filter, preserved verbatim from the Sentry setup this
// client replaces: a WebGL + map dashboard throws a steady stream of non-
// actionable browser/graphics errors that would otherwise drown the error lens.
const IGNORE: (RegExp | string)[] = [
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
];

const MODULE_IMPORT = /Importing a module script failed/;
const EXTENSION_FRAME = /^(chrome|moz)-extension:/m;
const MAP_NULL = /this\.style\._layers|this\.light is null|can't access property "type", \w+ is undefined|Cannot read properties of null \(reading '(id|type)'\)/;
const MAP_CHUNK = /\/map-[A-Za-z0-9]+\.js/;

function describe(err: unknown, fallback?: string): { primary: string; hay: string; stack: string } {
  if (err instanceof Error) {
    const composed = `${err.name}: ${err.message}`;
    return { primary: err.message, hay: `${err.message}\n${composed}\n${String(err)}`, stack: err.stack ?? '' };
  }
  if (typeof err === 'string') return { primary: err, hay: err, stack: '' };
  let s: string;
  try {
    s = JSON.stringify(err);
  } catch {
    s = String(err);
  }
  const primary = fallback ?? s;
  return { primary, hay: `${primary}\n${s}`, stack: '' };
}

/** shouldDrop replicates the prior Sentry ignoreErrors + beforeSend filter:
 *  unconditional noise, minified single-token junk, extension-origin module
 *  import failures, and maplibre internal null-access from the map chunk. */
function shouldDrop(err: unknown, fallback?: string, filename?: string): boolean {
  const { primary, hay, stack } = describe(err, fallback);
  if (primary.length <= 3 && /^[a-zA-Z_$]+$/.test(primary)) return true;
  if (IGNORE.some((p) => (typeof p === 'string' ? hay.includes(p) : p.test(hay)))) return true;
  const frames = filename ? `${stack}\n${filename}` : stack;
  if (MODULE_IMPORT.test(hay) && EXTENSION_FRAME.test(frames)) return true;
  if (MAP_NULL.test(hay) && MAP_CHUNK.test(frames)) return true;
  return false;
}

let client: Analytics | null = null;

/** The app-facing telemetry surface. Every method is a no-op when telemetry is
 *  uninstalled or gated off, so call sites never guard. */
export const telemetry = {
  pageview(path?: string): void {
    client?.pageview(path);
  },
  capture(event: string, properties?: Record<string, unknown>, commerce?: Commerce): void {
    client?.capture(event, properties, commerce);
  },
  identify(personId: string, traits?: Record<string, unknown>): void {
    client?.identify(personId, traits);
  },
  group(groupId: string, traits?: Record<string, unknown>): void {
    client?.group(groupId, traits);
  },
  captureError(err: unknown, properties?: Record<string, unknown>): void {
    if (shouldDrop(err)) return;
    client?.captureError(err, { handled: true, properties });
  },
};

// Paths that are transient redirect landings, not real pages — no pageview.
const IGNORE_PATHS = new Set(['/auth/callback']);

// Fire a pageview only when the path changes. World rewrites the query string
// heavily (share URLs, ?country=) via pushState/replaceState — those are state,
// not navigation, and the interactions they reflect are captured as product
// events instead, so keying pageviews on pathname keeps the web-analytics count
// honest (one per real page, not per URL churn).
function installPageviews(): void {
  let lastPath = location.pathname;
  const fire = (): void => {
    if (location.pathname === lastPath || IGNORE_PATHS.has(location.pathname)) return;
    lastPath = location.pathname;
    telemetry.pageview(location.pathname);
  };
  const patch = (name: 'pushState' | 'replaceState'): void => {
    const orig = history[name];
    history[name] = function patched(this: History, ...args: Parameters<History['pushState']>): void {
      orig.apply(this, args);
      fire();
    } as History['pushState'];
  };
  patch('pushState');
  patch('replaceState');
  window.addEventListener('popstate', fire);
}

// Global error + rejection capture — the drop-in @sentry replacement. The client
// runs with captureErrors:false so these filtered handlers are the ONE error
// path; each survivor becomes a type:'error' event Cloud stamps event_type='error'
// → the sentry.hanzo.ai lens.
function installErrorHandlers(buffered: EarlyError[]): void {
  window.addEventListener('error', (e: ErrorEvent) => {
    const err = e.error ?? e.message;
    if (!shouldDrop(err, e.message, e.filename)) client?.captureError(err, { handled: false });
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    if (!shouldDrop(e.reason)) client?.captureError(e.reason, { handled: false });
  });
  // Replay anything the synchronous boot buffer caught before we loaded.
  for (const e of buffered) {
    if (e.error !== undefined) {
      if (!shouldDrop(e.error)) client?.captureError(e.error, { handled: false });
    } else if (e.message && !shouldDrop(e.message)) {
      client?.captureError(e.message, { handled: false });
    }
  }
}

/** installTelemetry wires the ONE client: the bearer getter is injected by the
 *  composition root (main.ts) so this module stays decoupled from IAM. Idempotent,
 *  browser-only, and inert when gated off (dev/desktop/DNT/opt-out) — logged-out
 *  marketing views still get pageviews + errors, anonymously. */
export function installTelemetry(opts: { getToken?: () => string | undefined; earlyErrors?: EarlyError[] } = {}): void {
  if (client || !isBrowser()) return;
  if (!enabledEnv() || !consented()) return;

  // Auth precedence per event: the signed-in user's bearer (Cloud resolves their
  // tenant), else the publishable key (anonymous org). Both ride Authorization:
  // Bearer on fetch — so the unload keepalive flush carries auth either way —
  // rather than the config `ingestKey`, which would statically override the user
  // bearer and mis-attribute signed-in events to the publishable org.
  const bearer = opts.getToken;
  const pk = ingestKey();
  client = createAnalytics({
    product: 'world',
    host: resolveHost(),
    getToken: () => bearer?.() ?? pk,
    captureErrors: false, // the filtered handlers below are the one error path
  });
  client.init();
  installErrorHandlers(opts.earlyErrors ?? []);
  installPageviews();
  if (!IGNORE_PATHS.has(location.pathname)) telemetry.pageview(location.pathname);
}
