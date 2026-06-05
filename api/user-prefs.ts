/**
 * User preferences sync endpoint.
 *
 * GET  /api/user-prefs?variant=<variant>  — returns current cloud prefs
 * POST /api/user-prefs                    — saves prefs blob
 *
 * Auth: IAM Bearer token. Persistence: Hanzo Base (REST collections API).
 */

export const config = { runtime: 'edge' };

// @ts-expect-error — JS module, no declaration file
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
// @ts-expect-error — JS module, no declaration file
import { jsonResponse } from './_json-response.js';
// @ts-expect-error — JS module, no declaration file
import { extractConvexErrorKind, readConvexErrorNumber } from './_convex-error.js';
// @ts-expect-error — JS module, no declaration file
import { captureSilentError } from './_sentry-edge.js';
import { validateBearerToken } from '../server/auth-session';

const BASE_URL = process.env.BASE_URL || 'https://base.hanzo.ai';
const BASE_TOKEN = process.env.BASE_TOKEN || '';

function baseHeaders(userToken: string): Record<string, string> {
  // Prefer user's IAM token for Base's IAM-bridged auth; fall back to service token.
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${userToken || BASE_TOKEN}`,
  };
}

export default async function handler(
  req: Request,
  ctx?: { waitUntil: (p: Promise<unknown>) => void },
): Promise<Response> {
  if (isDisallowedOrigin(req)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403);
  }

  const cors = getCorsHeaders(req, 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return jsonResponse({ error: 'UNAUTHENTICATED' }, 401, cors);
  }

  const session = await validateBearerToken(token);
  if (!session.valid || !session.userId) {
    return jsonResponse({ error: 'UNAUTHENTICATED' }, 401, cors);
  }

  const userId = session.userId;

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const variant = url.searchParams.get('variant') ?? 'full';
    const filter = encodeURIComponent(`userId="${userId}" && variant="${variant}"`);
    try {
      const r = await fetch(
        `${BASE_URL}/api/collections/userPreferences/records?filter=${filter}&perPage=1`,
        { headers: baseHeaders(token), signal: AbortSignal.timeout(5000) },
      );
      if (!r.ok) return jsonResponse(null, 200, cors);
      const data = await r.json();
      const rec = Array.isArray(data.items) && data.items.length ? data.items[0] : null;
      return jsonResponse(rec, 200, cors);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const kind = extractConvexErrorKind(err, msg);
      // UNAUTHENTICATED on this path means the Clerk token PASSED our edge's
      // `validateBearerToken` but Convex still rejected it — i.e. genuine
      // auth/audience/issuer drift between our Clerk JWKS validation and
      // Convex's auth config (a Clerk JWKS rotation lag, an audience mismatch,
      // a stale CLERK_JWT_ISSUER_DOMAIN env var). User-bad-token cases are
      // caught earlier (the `validateBearerToken` 401 above) and never reach
      // this catch. Capture before returning 401 so the drift surfaces under
      // a stable Sentry bucket instead of silently 401'ing every request.
      //
      // `level: 'warning'` because the observed pattern is one transient
      // event per user (5ev/5u over a week — WORLDMONITOR-QK), which a
      // client retry recovers cleanly. Keeping the capture at error
      // drowned real bugs in the dashboard while delivering no operational
      // signal beyond "drift happened" (already evident from the warning
      // bucket). A genuine systemic drift incident would still surface
      // because volume would escalate and reopen the archived issue.
      if (kind === 'UNAUTHENTICATED') {
        console.warn('[user-prefs] GET convex auth drift:', err);
        captureSilentError(err, buildSentryContext(err, msg, {
          method: 'GET', convexFn: 'userPreferences:getPreferences',
          userId: session.userId, variant, ctx,
          level: 'warning',
        }));
        return jsonResponse({ error: 'UNAUTHENTICATED' }, 401, cors);
      }
      if (kind === 'SERVICE_UNAVAILABLE') {
        // Convex platform-level 503 — transient and self-recovering. Map to
        // 503 with `Retry-After` so the client backs off rather than treating
        // it as a permanent 500. Still capture so we can spot regressions /
        // sustained outages, but use `level: 'warning'` so this expected
        // transient external-system event doesn't drown the error
        // dashboard or page on-call (WORLDMONITOR-QA).
        console.warn('[user-prefs] GET convex service unavailable:', msg);
        captureSilentError(err, buildSentryContext(err, msg, {
          method: 'GET', convexFn: 'userPreferences:getPreferences',
          userId: session.userId, variant, ctx,
          level: 'warning',
        }));
        return jsonResponse({ error: 'SERVICE_UNAVAILABLE' }, 503, { ...cors, 'Retry-After': '5' });
      }
      console.error('[user-prefs] GET error:', err);
      captureSilentError(err, buildSentryContext(err, msg, {
        method: 'GET', convexFn: 'userPreferences:getPreferences',
        userId: session.userId, variant, ctx,
      }));
      return jsonResponse({ error: 'Failed to fetch preferences' }, 500, cors);
    }
  }

  // POST — save prefs
  let body: { variant?: unknown; data?: unknown; expectedSyncVersion?: unknown; schemaVersion?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, cors);
  }

  if (
    typeof body.variant !== 'string' ||
    body.data === undefined ||
    typeof body.expectedSyncVersion !== 'number'
  ) {
    return jsonResponse({ error: 'MISSING_FIELDS' }, 400, cors);
  }

  try {
    // Upsert: find existing record, then PATCH or POST.
    const filter = encodeURIComponent(`userId="${userId}" && variant="${body.variant}"`);
    const findResp = await fetch(
      `${BASE_URL}/api/collections/userPreferences/records?filter=${filter}&perPage=1`,
      { headers: baseHeaders(token), signal: AbortSignal.timeout(5000) },
    );
    const find = findResp.ok ? await findResp.json() : { items: [] };
    const existing = Array.isArray(find.items) && find.items.length ? find.items[0] : null;

    const payload = {
      userId,
      variant: body.variant,
      data: body.data,
      schemaVersion: typeof body.schemaVersion === 'number' ? body.schemaVersion : 1,
      syncVersion: (typeof body.expectedSyncVersion === 'number' ? body.expectedSyncVersion : 0) + 1,
      updatedAt: Date.now(),
    };

    if (existing) {
      if (existing.syncVersion !== body.expectedSyncVersion) {
        return jsonResponse({ error: 'CONFLICT' }, 409, cors);
      }
      const upd = await fetch(
        `${BASE_URL}/api/collections/userPreferences/records/${existing.id}`,
        { method: 'PATCH', headers: baseHeaders(token), body: JSON.stringify(payload) },
      );
      if (!upd.ok) throw new Error(`Base PATCH ${upd.status}`);
      return jsonResponse(await upd.json(), 200, cors);
    } else {
      const created = await fetch(
        `${BASE_URL}/api/collections/userPreferences/records`,
        { method: 'POST', headers: baseHeaders(token), body: JSON.stringify(payload) },
      );
      if (!created.ok) throw new Error(`Base POST ${created.status}`);
      return jsonResponse(await created.json(), 200, cors);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[user-prefs] POST error:', err);
    captureSilentError(err, buildSentryContext(err, msg, {
      method: 'POST', convexFn: 'userPreferences:setPreferences',
      userId: session.userId, variant: body.variant, ctx,
      schemaVersion: typeof body.schemaVersion === 'number' ? body.schemaVersion : null,
      expectedSyncVersion: body.expectedSyncVersion,
      blobSize: body.data !== undefined ? JSON.stringify(body.data).length : 0,
    }));
    return jsonResponse({ error: 'Failed to save preferences' }, 500, cors);
  }
}


/**
 * 409-CONFLICT response builder for setPreferences — DEPLOY-WINDOW BRIDGE.
 *
 * Post PR 3 (post-launch-stabilization), CAS-guard CONFLICTs RETURN from
 * `userPreferences:setPreferences` rather than throw, so this catch-side
 * helper is only reached during the deploy-ordering window where the edge
 * runs against an OLD convex deployment that still throws. Once both
 * layers have soaked, this helper becomes unreachable dead code and can
 * be removed.
 *
 * While reachable, it preserves stuck-bundle Sentry attribution: captures
 * the user_id + actualSyncVersion at level=warning so we can spot a single
 * stuck client looping (constant actualSyncVersion across timestamps) vs.
 * real concurrency (broadly-distributed user_ids). At level=error it
 * drowned real bugs; level=warning keeps it queryable but out of error
 * totals and alerting (per WORLDMONITOR-PX 2026-04-30 triage).
 *
 * Echoes `actualSyncVersion` from the structured ConvexError when present
 * and numeric so the client can refresh its local sync state without a
 * follow-up GET. Type-guarded — drops non-numeric values rather than
 * forwarding them as `unknown`.
 *
 * Convex has been retired; setPreferences is now a Hanzo Base PATCH which
 * never throws this shape, so the helper is unreachable. Kept as a deleted
 * marker so a future grep for `handleConflictResponse` finds this note.
 */

/**
 * Build a captureSilentError context that carries enough provenance to triage
 * a 500 from this endpoint without re-running the request:
 *   - `convex_request_id` tag: the `[Request ID: X]` from Convex's error message,
 *     queryable in Sentry and grep-able against Convex's dashboard logs.
 *   - `error_shape` tag: classifies what KIND of failure this is so a single
 *     Sentry filter splits "Convex internal 500" from "transport timeout" from
 *     "everything else", instead of every flavor sharing the same opaque bucket.
 *   - Stable `fingerprint`: forces Sentry to group by (route, method, error_shape)
 *     rather than by the ever-varying request-id-bearing message — without this,
 *     each request_id would create a new "issue" and drown the dashboard.
 *
 * Exported for unit tests. The Vercel edge runtime ignores non-default
 * exports, so this has no production-side effect.
 */
export function buildSentryContext(
  err: unknown,
  msg: string,
  opts: {
    method: 'GET' | 'POST';
    convexFn: string;
    userId: string;
    variant?: unknown;
    ctx?: { waitUntil: (p: Promise<unknown>) => void };
    schemaVersion?: number | null;
    expectedSyncVersion?: unknown;
    blobSize?: number;
    // Override the message-pattern classification when the caller already
    // knows the error shape (e.g. CONFLICT, where the throw is intentional
    // and routing through msg-pattern matching would mis-classify it as
    // 'unknown'). Skipped through the same `errorShape` field so
    // fingerprint and tags stay stable.
    errorShapeOverride?: string;
    // Additional tags (queryable in Sentry, unlike `extra`). Used e.g. to
    // pass `actual_sync_version` so on-call can group/filter by it.
    extraTags?: Record<string, string | number>;
    // Sentry severity. Default 'error'. Pass 'warning' for expected-but-
    // trackable conditions (CONFLICT from optimistic-concurrency) so the
    // capture stays queryable in the dashboard but doesn't count toward
    // error totals or page on-call.
    level?: 'warning' | 'info' | 'error' | 'fatal';
  },
): {
  tags: Record<string, string | number>;
  extra: Record<string, unknown>;
  fingerprint: string[];
  ctx?: { waitUntil: (p: Promise<unknown>) => void };
  level?: 'warning' | 'info' | 'error' | 'fatal';
} {
  const errName = err instanceof Error ? err.name : 'unknown';
  const requestIdMatch = msg.match(/\[Request ID:\s*([a-f0-9]+)\]/i);
  const convexRequestId = requestIdMatch?.[1];
  // Order matters: UNAUTHENTICATED is more specific than the request-id
  // server-error shape and must be checked first. Auth drift is its own bucket
  // so it groups separately from genuine Convex 5xx in the Sentry dashboard.
  // SERVICE_UNAVAILABLE (Convex platform 503) is also its own bucket — it
  // would otherwise fall into 'unknown' and conflate transient outages with
  // genuinely-novel failure modes that haven't been classified yet.
  const errorShape = opts.errorShapeOverride
    // Match both the structured-data `UNAUTHENTICATED` kind (uppercase, from
    // `ConvexError({kind:'UNAUTHENTICATED'})`) AND the platform-level JSON-
    // shape `"code":"Unauthenticated"` (mixed case, from Convex's runtime
    // when Clerk OIDC token verification fails). Both are auth drift —
    // WORLDMONITOR-PG: the JSON-cased variant was previously falling
    // through to 'unknown' because the `/UNAUTHENTICATED/` regex is
    // case-sensitive.
    // The `"code":\s*"X"` forms tolerate the optional post-colon whitespace a
    // non-default serializer may emit (`"code": "X"`), mirroring `hasConvexCode`
    // in _convex-error.js so this Sentry bucket and the kind→503 mapping stay in
    // lockstep — a with-whitespace body classifies identically on both sides.
    ?? (/UNAUTHENTICATED|"code":\s*"Unauthenticated"/.test(msg) ? 'convex_auth_drift'
      : /"code":\s*"ServiceUnavailable"/.test(msg) ? 'convex_service_unavailable'
      // Convex platform 500 — runtime can't recover the request. Same
      // 503-with-Retry-After remediation as ServiceUnavailable in
      // _convex-error.js, but kept as its own Sentry bucket so on-call can
      // tell internal-500s apart from genuine 503s when triaging
      // (WORLDMONITOR-PG/PH).
      : /"code":\s*"InternalServerError"/.test(msg) ? 'convex_internal_error'
      // Convex platform worker saturation: `{"code":"WorkerOverloaded",
      // "message":"There are no available workers to process the request"}`.
      // Mapped to SERVICE_UNAVAILABLE (503 + Retry-After) in _convex-error.js,
      // same as InternalServerError/ServiceUnavailable; kept as its own Sentry
      // bucket so on-call can tell worker-saturation apart from internal-500s
      // and genuine 503s when triaging (WORLDMONITOR-PG).
      : /"code":\s*"WorkerOverloaded"/.test(msg) ? 'convex_worker_overloaded'
      : /\[Request ID:\s*[a-f0-9]+\]\s*Server Error/i.test(msg) ? 'convex_server_error'
      // Cloudflare edge error (520-527) fronting the Convex deployment — see
      // _convex-error.js. Mapped to SERVICE_UNAVAILABLE (503 + Retry-After)
      // there; kept as its own Sentry bucket so on-call can tell CDN-layer
      // transients apart from genuine Convex platform 5xx (WORLDMONITOR-PG).
      // Checked BEFORE the /timeout/ branch: Cloudflare 524's error page body
      // is literally "A timeout occurred", so a 524 whose message carries the
      // CF body text would otherwise be mis-bucketed as transport_timeout.
      // A genuine client AbortSignal.timeout never carries an `error code: 52x`
      // substring, so this ordering steals no real-timeout events.
      : /error code:\s*52[0-7]\b/i.test(msg) ? 'transport_cloudflare'
      : /timeout|timed out|aborted/i.test(msg) ? 'transport_timeout'
      : /fetch failed|network|ECONN|ENOTFOUND|getaddrinfo/i.test(msg) ? 'transport_network'
      : 'unknown');

  return {
    tags: {
      route: 'api/user-prefs',
      method: opts.method,
      convex_fn: opts.convexFn,
      error_shape: errorShape,
      // Promote userId from `extra` to `tags` so Sentry can group conflicts
      // by user. Clerk user IDs are opaque strings (e.g. `user_2x8K3...`),
      // not numbers — pass through as-is.
      user_id: opts.userId,
      ...(convexRequestId ? { convex_request_id: convexRequestId } : {}),
      // Skip the minified `errName` (e.g. 'I') — it's noise, not signal — but
      // keep meaningful names like ConvexError / TypeError / SyntaxError.
      // `> 1` is the minimal guard for single-character noise; all real built-in
      // error class names are well above that.
      ...(errName !== 'unknown' && errName !== 'Error' && errName.length > 1
        ? { error_name: errName }
        : {}),
      ...(opts.extraTags ?? {}),
    },
    extra: {
      variant: typeof opts.variant === 'string' ? opts.variant : 'unknown',
      messageHead: msg.slice(0, 300),
      ...(opts.schemaVersion !== undefined ? { schemaVersion: opts.schemaVersion } : {}),
      ...(opts.expectedSyncVersion !== undefined ? { expectedSyncVersion: opts.expectedSyncVersion } : {}),
      ...(opts.blobSize !== undefined ? { blobSize: opts.blobSize } : {}),
    },
    fingerprint: ['api/user-prefs', opts.method, errorShape],
    ctx: opts.ctx,
    ...(opts.level ? { level: opts.level } : {}),
  };
}
