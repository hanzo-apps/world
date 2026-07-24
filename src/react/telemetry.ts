// The React entry's binding to the ONE telemetry client.
//
// There is exactly one @hanzo/event integration in this repo —
// `src/bootstrap/telemetry.ts` (createAnalytics · product 'world' · the Hanzo
// Cloud front door · pageviews + product events + filtered errors on one pipe).
// This module does NOT re-create that client; it reuses it verbatim, wiring it
// into the React root the same way `src/main.ts` wires it into the vanilla root:
// inject the IAM bearer getter so telemetry stays decoupled from auth, buffer any
// boot-time errors, install, then retire the buffer. One door, one client, two
// entries.

import { installTelemetry, telemetry, type EarlyError } from '@/bootstrap/telemetry';
import { accessToken, type IamUser } from '@/services/iam';

export { telemetry };

let installed = false;

/**
 * Wire the ONE @hanzo/event client for the React surface. Idempotent, so a
 * StrictMode double-invoke or a re-import can never mint a second client. Mirrors
 * `src/main.ts` lines 14-42: a synchronous buffer catches anything thrown before
 * the client is live, `installTelemetry` replays it on install, then the buffer's
 * listeners retire (the client's own filtered handlers become the one error path).
 * Inert off the deployed site (dev / desktop / DNT / opt-out) — the gate lives in
 * `installTelemetry`, so calling this unconditionally is safe.
 */
export function initTelemetry(): void {
  if (installed) return;
  installed = true;

  const earlyErrors: EarlyError[] = [];
  const buffer = (e: ErrorEvent | PromiseRejectionEvent): void => {
    const err = (e as ErrorEvent).error ?? (e as PromiseRejectionEvent).reason ?? (e as ErrorEvent).message;
    if (err !== undefined && earlyErrors.length < 20) earlyErrors.push({ error: err });
  };
  window.addEventListener('error', buffer);
  window.addEventListener('unhandledrejection', buffer);

  // The bearer getter is the vanilla IAM port's sync token read — Cloud resolves
  // the tenant from the validated bearer, never a client field; signed-out
  // visitors post anonymously (publishable key or best-effort).
  installTelemetry({ getToken: accessToken, earlyErrors });

  window.removeEventListener('error', buffer);
  window.removeEventListener('unhandledrejection', buffer);
  earlyErrors.length = 0;
}

/**
 * Bind the signed-in identity to the telemetry stream so product events are
 * attributed to the person and their org. Mirrors `src/main.ts` boot() lines
 * 103-107 verbatim: identify by the stable subject, group by the owner (org)
 * claim. No-op fields when absent; anonymous sessions stay anonymous.
 */
export function identifyUser(user: IamUser): void {
  telemetry.identify(user.sub);
  if (user.owner) telemetry.group(user.owner);
}
