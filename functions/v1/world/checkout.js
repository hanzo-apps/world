// POST /v1/world/checkout — IAM-authed checkout session for Hanzo World.
//
// Body: { planId | planKey, returnUrl?, cancelUrl?, referralCode?, discountCode? }
// Auth: IAM Bearer or hanzo.id session cookie.
// Returns: { checkoutUrl, sessionId, planId }
//
// Flow:
//   world SPA → POST /v1/world/checkout
//     → resolve plan price from FALLBACK_PRICES
//     → return a billing.hanzo.ai/topup URL with amount + IAM context
//   billing.hanzo.ai/topup → Square Web Payments SDK
//     → POST commerce.hanzo.ai /v1/billing/topup/token (charges card)
//     → redirect back to returnUrl with the user's balance credited
//
// Hanzo plans bill through Hanzo Commerce's billing/topup_token surface
// (Square is the active processor). The Liquidity-style BD deposits proxy
// in commerce is for broker-dealer flows and is unrelated to Hanzo's
// hosted plans — we hand off to billing.hanzo.ai directly so a single
// Square-authed page handles the charge and the credit in one round-trip.

import { iamUserinfo, unauthenticated } from '../../_shared/iam.js';
import { jsonResponse } from '../../_shared/json.js';
import { corsHeaders } from '../../_shared/cors.js';

const APP_BASE_URL = 'https://world.hanzo.ai';
const BILLING_BASE_URL = 'https://billing.hanzo.ai';

// USD cents per plan slug. Mirrors api/_product-fallback-prices.js so the
// SPA's displayed price and the checkout charge agree without an extra
// catalog hop. Source of truth: ~/work/hanzo/plans/subscription.json.
const PLAN_PRICE_CENTS = {
  'world-pro': 2900,
  'world-pro-annual': 29000,
  'world-team': 9900,
  'world-team-annual': 99000,
};

export async function onRequestOptions({ request }) {
  return new Response(null, { headers: corsHeaders(request, 'POST, OPTIONS') });
}

export async function onRequestPost({ request }) {
  const cors = corsHeaders(request, 'POST, OPTIONS');

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, cors);
  }

  const planId = String(body?.planId || body?.planKey || '').trim();
  if (!planId) return jsonResponse({ error: 'planId_required' }, 400, cors);

  const amountCents = PLAN_PRICE_CENTS[planId];
  if (!amountCents) {
    return jsonResponse({ error: 'unknown_plan', planId }, 400, cors);
  }

  const user = await iamUserinfo(request);
  if (!user) return unauthenticated(cors);

  const returnUrl = sanitizeReturnUrl(body?.returnUrl) || `${APP_BASE_URL}/?checkout=success&plan=${encodeURIComponent(planId)}`;

  // Forward the user's IAM bearer so billing.hanzo.ai can authenticate the
  // /v1/billing/topup/token POST without a second sign-in. The token lives
  // in the query string for one navigation hop; billing.hanzo.ai reads it
  // from `token=` and immediately swaps it into a same-origin cookie.
  const authz = request.headers.get('Authorization') || '';
  const bearer = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';

  const url = new URL(`${BILLING_BASE_URL}/topup`);
  url.searchParams.set('amount', String(amountCents));
  url.searchParams.set('plan', planId);
  url.searchParams.set('returnUrl', returnUrl);
  if (user.sub || user.id) url.searchParams.set('userId', user.sub || user.id);
  if (bearer) url.searchParams.set('token', bearer);
  if (body?.referralCode) url.searchParams.set('referral', String(body.referralCode));
  if (body?.discountCode) url.searchParams.set('coupon', String(body.discountCode));

  return jsonResponse({
    checkoutUrl: url.toString(),
    sessionId: null,
    planId,
    amountCents,
  }, 200, cors);
}

function sanitizeReturnUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const allowed = [
      'world.hanzo.ai',
      'localhost',
      '127.0.0.1',
    ];
    if (!allowed.includes(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}
