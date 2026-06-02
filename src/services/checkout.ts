/**
 * Checkout service — thin wrapper over /v1/world/checkout.
 *
 * The previous Dodo Payments overlay is retired. This module posts to the
 * worldmonitor edge handler which creates a Commerce session and returns a
 * hosted Stripe Checkout URL. Callers redirect the browser.
 */

import * as Sentry from '@sentry/browser';
import { getAccessToken, getCurrentUser } from './iam';

const CHECKOUT_PRODUCT_PARAM = 'checkoutProduct';
const CHECKOUT_REFERRAL_PARAM = 'checkoutReferral';
const CHECKOUT_DISCOUNT_PARAM = 'checkoutDiscount';
const PENDING_CHECKOUT_KEY = 'wm-pending-checkout';
const APP_CHECKOUT_BASE_URL = 'https://world.hanzo.ai/';

/**
 * Session flag set just before the post-overlay reload. Lets panel-layout
 * detect "we just returned from an overlay checkout" on the reloaded page —
 * the overlay uses manualRedirect:true so there are no subscription_id URL
 * params to key off, unlike the full-page redirect return handled by
 * handleCheckoutReturn. Exported as a pair (consume+mark) to keep the key
 * centralized with the rest of the checkout storage constants.
 */
export function consumePostCheckoutFlag(): boolean {
  try {
    if (sessionStorage.getItem(POST_CHECKOUT_FLAG_KEY) === '1') {
      sessionStorage.removeItem(POST_CHECKOUT_FLAG_KEY);
      return true;
    }
  } catch {
    // Private browsing / storage disabled — fall through to false.
  }
  return false;
}

function markPostCheckout(): void {
  try {
    sessionStorage.setItem(POST_CHECKOUT_FLAG_KEY, '1');
  } catch {
    // Storage denied — the reload will still run; transition detector will
    // fall back to its null baseline, matching the pre-flag behavior.
  }
}

interface PendingCheckoutIntent {
  productId: string;
  referralCode?: string;
  discountCode?: string;
  /**
   * User id who saved this intent, or null if saved anonymously (the
   * common "click Buy, get sign-in modal" path). On resume, we only
   * fire the auto-checkout if:
   *   - savedByUserId === current user id (mid-flow redirect return), OR
   *   - savedByUserId === null AND current user is authenticated
   *     (anonymous intent → user just signed up/in — THIS IS the
   *     auto-resume case)
   * Anything else (A saved, B is now signed in) is a cross-user leak
   * and the intent is discarded.
   */
  savedByUserId?: string | null;
  /**
   * Unix-ms when this intent was saved. Stale intents (closed Clerk
   * modal without signing in, then hours later another sign-in for
   * unrelated reasons) must not auto-resume checkout — the user's
   * intent to buy has expired. Loaders apply PENDING_INTENT_TTL_MS
   * and discard anything older.
   */
  savedAt?: number;
}

interface StartCheckoutOptions {
  productId: string;
  referralCode?: string;
  discountCode?: string;
}

type NoopFn = () => void;

/** Legacy API — kept as a no-op so call sites don't break. */
export function initCheckoutOverlay(_onSuccess?: NoopFn): void {}
export function destroyCheckoutOverlay(): void {}
export function showCheckoutSuccess(): void {}

/** Build a deep-link URL that captures the pending-checkout intent in query params. */
export function buildCheckoutLaunchUrl(opts: StartCheckoutOptions): string {
  const u = new URL(APP_CHECKOUT_BASE_URL);
  u.searchParams.set(CHECKOUT_PRODUCT_PARAM, opts.productId);
  if (opts.referralCode) u.searchParams.set(CHECKOUT_REFERRAL_PARAM, opts.referralCode);
  if (opts.discountCode) u.searchParams.set(CHECKOUT_DISCOUNT_PARAM, opts.discountCode);
  return u.toString();
}

/** Lift a pending checkout intent out of the current URL (for post-login resume). */
export function capturePendingCheckoutIntentFromUrl(): PendingCheckoutIntent | null {
  try {
    const u = new URL(location.href);
    const productId = u.searchParams.get(CHECKOUT_PRODUCT_PARAM);
    if (!productId) return null;
    const intent: PendingCheckoutIntent = { productId };
    const ref = u.searchParams.get(CHECKOUT_REFERRAL_PARAM);
    const disc = u.searchParams.get(CHECKOUT_DISCOUNT_PARAM);
    if (ref) intent.referralCode = ref;
    if (disc) intent.discountCode = disc;
    localStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(intent));
    u.searchParams.delete(CHECKOUT_PRODUCT_PARAM);
    u.searchParams.delete(CHECKOUT_REFERRAL_PARAM);
    u.searchParams.delete(CHECKOUT_DISCOUNT_PARAM);
    history.replaceState(null, '', u.toString());
    return intent;
  } catch {
    return null;
  }
}

/** Resume a checkout left pending before login (e.g. anon clicks /pro, then signs in). */
export async function resumePendingCheckout(_options?: { onSuccess?: NoopFn }): Promise<boolean> {
  try {
    const raw = localStorage.getItem(PENDING_CHECKOUT_KEY);
    if (!raw) return false;
    const intent = JSON.parse(raw) as PendingCheckoutIntent;
    localStorage.removeItem(PENDING_CHECKOUT_KEY);
    await startCheckout(intent);
    return true;
  } catch (err) {
    Sentry.captureException(err);
    return false;
  }
}

/** Redirect the browser to a hosted checkout URL. */
export function openCheckout(checkoutUrl: string): void {
  if (!checkoutUrl) return;
  location.href = checkoutUrl;
}

/** Kick off a new checkout. Requires the user to be logged in (IAM). */
export async function startCheckout(opts: StartCheckoutOptions): Promise<void> {
  const token = getAccessToken();
  if (!token) {
    location.href = buildCheckoutLaunchUrl(opts);
    return;
  }
  const user = getCurrentUser();
  if (!user) {
    location.href = buildCheckoutLaunchUrl(opts);
    return;
  }

  const resp = await fetch('/v1/world/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      planId: opts.productId,
      referralCode: opts.referralCode,
      discountCode: opts.discountCode,
      successUrl: `${APP_CHECKOUT_BASE_URL}?checkout=success`,
      cancelUrl: `${APP_CHECKOUT_BASE_URL}?checkout=cancel`,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    Sentry.captureMessage(`world-checkout failed: ${resp.status} ${txt}`);
    throw new Error(`checkout failed: ${resp.status}`);
  }
  const data = (await resp.json()) as { checkoutUrl?: string };
  if (!data.checkoutUrl) throw new Error('checkout: no URL returned');
  openCheckout(data.checkoutUrl);
}
