/**
 * Frontend entitlement service — polls /v1/world/me for the current plan.
 *
 * Replaces the previous Convex reactive subscription. Entitlements live
 * in @hanzo/base and are projected by /v1/world/me based on the active
 * subscription in Hanzo Commerce.
 *
 * The public surface is unchanged:
 *   initEntitlementSubscription, onEntitlementChange, destroyEntitlementSubscription,
 *   resetEntitlementState, getEntitlementState, hasFeature, hasTier, isEntitled.
 */

import { getMe } from './world-api';
import { subscribe as subscribeIam, isLoggedIn } from './iam';

export interface EntitlementState {
  planKey: string;
  features: {
    tier: number;
    apiAccess: boolean;
    apiRateLimit: number;
    maxDashboards: number;
    prioritySupport: boolean;
    exportFormats: string[];
    /**
     * Pro MCP access (plan 2026-05-10-001). Undefined on legacy entitlement
     * snapshots that pre-date the catalog field. `hasFeature('mcpAccess')`
     * coerces undefined → false via Boolean(), so the settings tab
     * fails-closed for unrefreshed Pro users (they'll see it appear once
     * Dodo's next webhook repopulates the field).
     */
    mcpAccess?: boolean;
  };
  validUntil: number;
}

const listeners = new Set<(state: EntitlementState | null) => void>();
const POLL_INTERVAL_MS = 60_000;

let currentState: EntitlementState | null = null;
let initialized = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let authUnsubscribe: (() => void) | null = null;

function fanout(state: EntitlementState | null): void {
  currentState = state;
  for (const cb of listeners) {
    try {
      cb(state);
    } catch {
      // isolate listener errors
    }
  }
}

async function fetchOnce(): Promise<void> {
  if (!isLoggedIn()) {
    fanout(null);
    return;
  }
  try {
    const me = await getMe();
    fanout(me.entitlements);
  } catch (err) {
    console.warn('[entitlements] Failed to fetch /v1/world/me:', (err as Error).message);
    // Don't break the dashboard — preserve last known good state.
  }
}

/**
 * Initialize the entitlement watch. Idempotent. Failures are logged
 * but never thrown — the dashboard must survive auth/network issues.
 */
export async function initEntitlementSubscription(_userId?: string): Promise<void> {
  if (initialized) return;
  initialized = true;

  await fetchOnce();

  authUnsubscribe = subscribeIam(() => {
    fetchOnce().catch(() => { /* swallow */ });
  });

  pollTimer = setInterval(() => {
    fetchOnce().catch(() => { /* swallow */ });
  }, POLL_INTERVAL_MS);
}

/**
 * Stop polling and unwire auth listener. Preserves currentState across
 * reconnects; call resetEntitlementState() on explicit sign-out.
 */
export function destroyEntitlementSubscription(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (authUnsubscribe) {
    authUnsubscribe();
    authUnsubscribe = null;
  }
  initialized = false;
  // Leave listeners/state intact across reinit cycles.
}

/** Explicitly null currentState. Call on sign-out so stale plan doesn't leak. */
export function resetEntitlementState(): void {
  currentState = null;
}

/**
 * Register a callback for entitlement changes. If state is already loaded,
 * the callback fires immediately. Returns unsubscribe.
 */
export function onEntitlementChange(
  cb: (state: EntitlementState | null) => void,
): () => void {
  listeners.add(cb);
  if (currentState !== null) cb(currentState);
  return () => {
    listeners.delete(cb);
  };
}

/** Synchronous snapshot of the current entitlement state, or null. */
export function getEntitlementState(): EntitlementState | null {
  return currentState;
}

/** True if the given feature flag is enabled in the current state. */
export function hasFeature(flag: keyof EntitlementState['features']): boolean {
  if (currentState === null) return false;
  return Boolean(currentState.features[flag]);
}

/** True if the current tier meets or exceeds the given minimum. */
export function hasTier(minTier: number): boolean {
  if (currentState === null) return false;
  return currentState.features.tier >= minTier;
}

/** True if the user is on a paid plan that hasn't expired. */
export function isEntitled(): boolean {
  return (
    currentState !== null
    && currentState.planKey !== 'free'
    && currentState.validUntil >= Date.now()
  );
}

/**
 * Decides whether to reload the page when an entitlement snapshot arrives.
 *
 * Rules:
 *   - First snapshot ever (last === null): never reload. A legacy-pro user
 *     whose first snapshot is already `true` must not trigger a reload loop
 *     on every page load.
 *   - Free → pro transition (last === false, next === true): reload. This is
 *     the post-payment activation case — panels rendered against free-tier
 *     gating need to re-render to pick up the new entitlement.
 *   - Everything else (free→free, pro→pro, pro→free): no reload.
 */
export function shouldReloadOnEntitlementChange(
  last: boolean | null,
  next: boolean,
): boolean {
  return last === false && next === true;
}
