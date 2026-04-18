/**
 * Convex compatibility stub.
 *
 * Convex has been removed from World Monitor. All persistence lives in
 * @hanzo/base (see `./base.ts`) and the `/v1/world/*` HTTP API. This module
 * exists only so callers that still import `getConvexClient` / `getConvexApi`
 * / `waitForConvexAuth` continue to type-check while we migrate them off.
 *
 * Every function is a no-op that resolves to null or false. Downstream
 * services already handle a null client gracefully (see billing.ts,
 * entitlements.ts) so behavior is: skip the Convex path, fall through to
 * HTTP / no-op.
 */

export async function getConvexClient(): Promise<null> {
  return null;
}

export async function waitForConvexAuth(_timeoutMs?: number): Promise<boolean> {
  return false;
}

export async function getConvexApi(): Promise<null> {
  return null;
}
