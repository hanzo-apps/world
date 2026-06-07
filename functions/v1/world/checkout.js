// POST /v1/world/checkout — IAM-authed checkout session for Hanzo World.
//
// Body: { planId | planKey, returnUrl?, cancelUrl?, referralCode?, discountCode? }
// Auth: IAM Bearer or hanzo.id session cookie.
// Returns: { checkoutUrl, sessionId, planId }
//
// Flow:
//   world SPA → POST /v1/world/checkout
//     → resolve plan price from PLAN_PRICE_CENTS
//     → return a pay.hanzo.ai URL with amount + IAM context
//   pay.hanzo.ai (Hanzo Pay SPA) → Square Web Payments SDK
//     → POST commerce-api.hanzo.ai /v1/billing/topup/token (charges card)
//     → redirect back to returnUrl with the user's balance credited
//
// Hanzo Pay (pay.hanzo.ai) is the single canonical payment surface for
// every Hanzo product — world, chat, search, app, hanzo.ai. It loads the
// tenant config from commerce, renders the Square Web Payments SDK card
// form, drives the charge through commerce's billing/topup_token, and
// redirects back to returnUrl. world.hanzo.ai never has to embed a
// payment widget; the redirect IS the integration.

import { iamUserinfo, unauthenticated } from '../../_shared/iam.js';
import { jsonResponse } from '../../_shared/json.js';
import { corsHeaders } from '../../_shared/cors.js';

const APP_BASE_URL = 'https://world.hanzo.ai';
const PAY_BASE_URL = 'https://pay.hanzo.ai';

// USD cents per plan slug. Source of truth: ~/work/hanzo/plans/subscription.json
// (mirrored into commerce's embedded catalog and surfaced as
// commerce-api.hanzo.ai/v1/billing/plans). Anything here is also a
// valid POST /v1/billing/subscriptions planId — Hanzo's bundled plans
// (pro/team/etc.) grant world-pro/world-team entitlements for free via
// commerce's bundle expansion, so a customer who buys Pro at $49 gets
// the World Pro tier rolled in. world-pro / world-team stay live as
// standalone $29 / $99 SKUs for customers who only want the OSINT
// dashboard.
const PLAN_PRICE_CENTS = {
  // Standalone Hanzo World tiers (OSINT dashboard only).
  'world-pro': 2900,
  'world-pro-annual': 29000,
  'world-team': 9900,
  'world-team-annual': 99000,
  // Hanzo platform tiers that bundle World Pro / World Team.
  pro: 4900,
  'pro-annual': 39 * 12 * 100,
  max: 20000,
  'max-annual': 160 * 12 * 100,
  team: 19900,
  'team-annual': 159 * 12 * 100,
  'team-max': 22500,
  'team-max-annual': 180 * 12 * 100,
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

  // Forward the user's IAM bearer so pay.hanzo.ai can authenticate the
  // /v1/billing/topup/token POST without a second sign-in. The token lives
  // in the query string for one navigation hop; the Pay SPA reads it
  // from `token=` and immediately swaps it into a same-origin cookie
  // before discarding the URL parameter.
  const authz = request.headers.get('Authorization') || '';
  const bearer = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : '';

  // Hanzo Pay SPA route shape: `/confirm/card?amount=29.00&plan=...`
  // skips the keypad and goes straight to the Square card form with
  // the price preset. `plan=` lets the Pay SPA POST the matching
  // /v1/billing/subscriptions record after a successful charge.
  // Amount is a dollar string (e.g. "29.00") because that's what the
  // existing /confirm/$method route expects; the Pay SPA's
  // depositsApi.confirm converts to cents on the way to topup_token.
  const amountDollars = (amountCents / 100).toFixed(2);
  const url = new URL(`${PAY_BASE_URL}/confirm/card`);
  url.searchParams.set('amount', amountDollars);
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
