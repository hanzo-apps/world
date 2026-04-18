/**
 * Frontend billing service — reads subscription state from /v1/world/*.
 *
 * Replaces the previous Convex + Dodo implementation. Subscriptions live
 * in @hanzo/base (accessed via the world-api HTTP client) and billing flows
 * route through Hanzo Commerce (commerce.hanzo.ai).
 *
 * The public surface is unchanged:
 *   initSubscriptionWatch, onSubscriptionChange, destroySubscriptionWatch,
 *   getSubscription, openBillingPortal.
 */

import * as Sentry from '@sentry/browser';
import { listSubscriptions, type WorldSubscription } from './world-api';
import { subscribe as subscribeIam, isLoggedIn } from './iam';

export interface SubscriptionInfo {
  planKey: string;
  displayName: string;
  status: 'active' | 'on_hold' | 'cancelled' | 'expired';
  currentPeriodEnd: number;
}

const listeners = new Set<(sub: SubscriptionInfo | null) => void>();
const POLL_INTERVAL_MS = 60_000;

let currentSubscription: SubscriptionInfo | null = null;
let subscriptionLoaded = false;
let initialized = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let authUnsubscribe: (() => void) | null = null;

function toSubInfo(s: WorldSubscription | null): SubscriptionInfo | null {
  if (!s) return null;
  return {
    planKey: s.planKey,
    displayName: s.displayName,
    status: s.status,
    currentPeriodEnd: s.currentPeriodEnd,
  };
}

function fanout(sub: SubscriptionInfo | null): void {
  currentSubscription = sub;
  subscriptionLoaded = true;
  for (const cb of listeners) {
    try {
      cb(sub);
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
    const subs = await listSubscriptions();
    // Pick the active subscription (or the most recent one if multiple).
    const active = subs.find((s) => s.status === 'active') ?? subs[0] ?? null;
    fanout(toSubInfo(active));
  } catch (err) {
    console.warn('[billing] Failed to fetch subscriptions:', (err as Error).message);
    // Don't break the dashboard — treat as "no subscription" and keep polling.
    fanout(null);
    Sentry.captureException(err, {
      tags: { component: 'billing', action: 'fetchSubscription' },
    });
  }
}

/** Start polling /v1/world/subscriptions and fanning out changes. Idempotent. */
export async function initSubscriptionWatch(_userId?: string): Promise<void> {
  if (initialized) return;
  initialized = true;

  await fetchOnce();

  // Re-fetch on auth changes
  authUnsubscribe = subscribeIam(() => {
    fetchOnce().catch(() => { /* swallow */ });
  });

  // Periodic refresh so cancellations / plan changes propagate.
  pollTimer = setInterval(() => {
    fetchOnce().catch(() => { /* swallow */ });
  }, POLL_INTERVAL_MS);
}

/**
 * Register a callback for subscription changes. Callback fires immediately
 * with the current state if already loaded. Returns an unsubscribe function.
 */
export function onSubscriptionChange(
  cb: (sub: SubscriptionInfo | null) => void,
): () => void {
  listeners.add(cb);
  if (subscriptionLoaded) cb(currentSubscription);
  return () => {
    listeners.delete(cb);
  };
}

/** Tear down polling + listeners. Safe to call on panel destroy. */
export function destroySubscriptionWatch(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (authUnsubscribe) {
    authUnsubscribe();
    authUnsubscribe = null;
  }
  initialized = false;
  subscriptionLoaded = false;
  currentSubscription = null;
  // Keep listeners intact — callers register once and expect them to survive reinit.
}

/** Synchronous snapshot of the current subscription, or null if not loaded. */
export function getSubscription(): SubscriptionInfo | null {
  return currentSubscription;
}

const COMMERCE_PORTAL_URL = 'https://commerce.hanzo.ai/account/billing';

/**
 * Open the Hanzo Commerce self-service billing portal in a new tab.
 * Commerce handles session auth via IAM (same SSO session).
 */
export async function openBillingPortal(): Promise<string> {
  window.open(COMMERCE_PORTAL_URL, '_blank');
  return COMMERCE_PORTAL_URL;
}
