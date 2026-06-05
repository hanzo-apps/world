// /v1/world/checkout — IAM-authed Stripe Checkout session creation.
//
// POST { planId | planKey, referralCode?, discountCode?, successUrl?, cancelUrl? }
//   Authorization: Bearer <iam-token>  OR  Cookie: iam_session_id=...
// Returns: { checkoutUrl, sessionId, planId }
//
// Validates the IAM bearer against /api/userinfo, maps the plan slug to a
// Stripe Price via env (STRIPE_PRICE_<UPPER_PLAN_SLUG>), and creates a Stripe
// Checkout Session. Returns the hosted-checkout URL for client redirect.
//
// Env:
//   IAM_ENDPOINT                 IAM base URL (default https://hanzo.id)
//   STRIPE_SECRET_KEY            Stripe restricted/secret key (sk_live_... | sk_test_...)
//   STRIPE_PRICE_WORLD_PRO       Stripe price ID for World Pro monthly
//   STRIPE_PRICE_WORLD_PRO_ANNUAL Stripe price ID for World Pro annual (optional)
//   STRIPE_PRICE_WORLD_TEAM      Stripe price ID for World Team monthly
//   STRIPE_PRICE_WORLD_TEAM_ANNUAL Stripe price ID for World Team annual (optional)
//   STRIPE_API_VERSION           Pin Stripe API version (default 2025-02-24.acacia)
//
// The endpoint is intentionally Stripe-direct (not relayed through Hanzo
// Commerce) so payments work the moment STRIPE_SECRET_KEY is set on Vercel.
// Subscription state syncs back via the Stripe webhook at /api/stripe/webhook.

import { getCorsHeaders } from '../../_cors.js';
import { jsonResponse } from '../../_json-response.js';

// Env is read inside the handler, not at module load, so per-request
// env overrides (and the unit tests' env reset between cases) work
// without re-importing the module.
function iamEndpoint() {
  return process.env.IAM_ENDPOINT || process.env.IAM_URL || 'https://hanzo.id';
}
function stripeSecret() {
  return process.env.STRIPE_SECRET_KEY || '';
}
function stripeApiVersion() {
  return process.env.STRIPE_API_VERSION || '2025-02-24.acacia';
}
function appBaseUrl() {
  return process.env.APP_BASE_URL || 'https://world.hanzo.ai';
}

// Plan slug → env var name holding the Stripe price ID. Adding a plan?
// Add to both this map and Stripe's product/price catalog.
const PLAN_PRICE_ENV = Object.freeze({
  'world-pro': 'STRIPE_PRICE_WORLD_PRO',
  'world-pro-monthly': 'STRIPE_PRICE_WORLD_PRO',
  'world-pro-annual': 'STRIPE_PRICE_WORLD_PRO_ANNUAL',
  'world-team': 'STRIPE_PRICE_WORLD_TEAM',
  'world-team-monthly': 'STRIPE_PRICE_WORLD_TEAM',
  'world-team-annual': 'STRIPE_PRICE_WORLD_TEAM_ANNUAL',
});

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405, cors);
  }

  const stripeKey = stripeSecret();
  if (!stripeKey) {
    return jsonResponse({
      error: 'service_unavailable',
      message: 'STRIPE_SECRET_KEY is not configured on the server',
    }, 503, cors);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, cors);
  }

  // Accept both `planId` (legacy) and `planKey` (typed client) for the same field.
  const planId = String(body?.planId || body?.planKey || '').trim();
  if (!planId) {
    return jsonResponse({ error: 'planId_required' }, 400, cors);
  }

  const priceEnvVar = PLAN_PRICE_ENV[planId];
  if (!priceEnvVar) {
    return jsonResponse({ error: 'unknown_plan', planId }, 400, cors);
  }
  const priceId = process.env[priceEnvVar];
  if (!priceId) {
    return jsonResponse({
      error: 'plan_unconfigured',
      message: `${priceEnvVar} is not set on the server`,
      planId,
    }, 503, cors);
  }

  // Validate IAM bearer / cookie via /api/userinfo. We use the simple
  // userinfo round-trip rather than local JWKS verification because the
  // edge runtime doesn't bundle the server/ folder and the latency hit
  // is amortized inside Vercel's edge cache for repeat callers.
  const auth = req.headers.get('authorization') || '';
  const cookie = req.headers.get('cookie') || '';
  if (!auth && !cookie) {
    return jsonResponse({ error: 'unauthenticated' }, 401, cors);
  }

  let user;
  try {
    const userInfoResp = await fetch(`${iamEndpoint()}/api/userinfo`, {
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!userInfoResp.ok) {
      return jsonResponse({ error: 'unauthenticated' }, 401, cors);
    }
    user = await userInfoResp.json();
  } catch (err) {
    return jsonResponse({
      error: 'iam_unreachable',
      message: err?.message || String(err),
    }, 502, cors);
  }

  const userId = user?.sub || user?.id || user?.name;
  const email = user?.email;
  if (!userId || !email) {
    return jsonResponse({ error: 'iam_user_missing_fields' }, 401, cors);
  }

  const appBase = appBaseUrl();
  const successUrl = sanitizeReturnUrl(body?.successUrl)
    || `${appBase}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = sanitizeReturnUrl(body?.cancelUrl)
    || `${appBase}/?checkout=cancel`;

  // Build Stripe Checkout Session params (form-encoded for /v1/checkout/sessions)
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('line_items[0][price]', priceId);
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  params.set('customer_email', email);
  params.set('client_reference_id', userId);
  params.set('allow_promotion_codes', body?.discountCode ? 'false' : 'true');
  if (body?.discountCode) {
    params.set('discounts[0][promotion_code]', String(body.discountCode));
  }
  // Surface plan + IAM user on the session so the webhook can sync
  // entitlements back to IAM without re-querying.
  params.set('metadata[planId]', planId);
  params.set('metadata[iamUserId]', userId);
  if (body?.referralCode) {
    params.set('metadata[referralCode]', String(body.referralCode));
  }
  params.set('subscription_data[metadata][planId]', planId);
  params.set('subscription_data[metadata][iamUserId]', userId);

  let session;
  try {
    const stripeResp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': stripeApiVersion(),
        // Idempotency: same (user, plan, minute-bucket) collapses to one session.
        // Avoids double-charging on retries / double-clicks.
        'Idempotency-Key': `${userId}:${planId}:${Math.floor(Date.now() / 60_000)}`,
      },
      body: params.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await stripeResp.json();
    if (!stripeResp.ok) {
      return jsonResponse({
        error: 'stripe_error',
        status: stripeResp.status,
        stripeError: data?.error || data,
      }, 502, cors);
    }
    session = data;
  } catch (err) {
    return jsonResponse({
      error: 'stripe_unreachable',
      message: err?.message || String(err),
    }, 502, cors);
  }

  if (!session?.url) {
    return jsonResponse({ error: 'stripe_no_url' }, 502, cors);
  }

  return jsonResponse({
    checkoutUrl: session.url,
    sessionId: session.id,
    planId,
  }, 200, cors);
}

// Only allow http(s) return URLs on our origins. Blocks open-redirect via
// crafted successUrl/cancelUrl and javascript:/data: schemes that Stripe
// would otherwise relay back to the browser.
function sanitizeReturnUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const allowedHosts = [
      'world.hanzo.ai',
      'tech.world.hanzo.ai',
      'finance.world.hanzo.ai',
      'commodity.world.hanzo.ai',
      'happy.world.hanzo.ai',
      'energy.world.hanzo.ai',
      'localhost',
      '127.0.0.1',
    ];
    if (!allowedHosts.includes(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}
