// POST /v1/world/checkout — IAM-authed checkout session via Hanzo Commerce.
//
// Body: { planId | planKey, returnUrl?, cancelUrl?, referralCode?, discountCode? }
// Auth: IAM Bearer or hanzo.id session cookie.
// Returns: { checkoutUrl, sessionId, planId }
//
// Stack: Cloudflare Pages Function → api.hanzo.ai/v1/checkout/charge (Hanzo
// Commerce gateway). Commerce holds the Stripe/Square/etc. credentials in
// KMS for the `world` tenant; the world dashboard never sees a payment
// processor secret. The tenant is selected via the X-Org-Id header.

import { iamUserinfo, unauthenticated } from '../../_shared/iam.js';
import { jsonResponse } from '../../_shared/json.js';
import { corsHeaders } from '../../_shared/cors.js';

const TENANT = 'world';
const COMMERCE_ENDPOINT = 'https://api.hanzo.ai';
const APP_BASE_URL = 'https://world.hanzo.ai';

const VALID_PLAN_IDS = new Set([
  'world-pro',
  'world-pro-annual',
  'world-team',
  'world-team-annual',
]);

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
  if (!VALID_PLAN_IDS.has(planId)) {
    return jsonResponse({ error: 'unknown_plan', planId }, 400, cors);
  }

  const user = await iamUserinfo(request);
  if (!user) return unauthenticated(cors);

  const returnUrl = sanitizeReturnUrl(body?.returnUrl) || `${APP_BASE_URL}/?checkout=success`;
  const cancelUrl = sanitizeReturnUrl(body?.cancelUrl) || `${APP_BASE_URL}/?checkout=cancel`;

  // Hand off to Hanzo Commerce. The world tenant in Commerce has its
  // payment-provider credentials stored in KMS; Commerce routes to the
  // active provider (Stripe / Square / etc.) based on the org config.
  let resp;
  try {
    resp = await fetch(`${COMMERCE_ENDPOINT}/v1/checkout/charge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: request.headers.get('Authorization') || '',
        'X-Org-Id': TENANT,
      },
      body: JSON.stringify({
        tenant: TENANT,
        planId,
        buyer: {
          id: user.sub || user.id,
          email: user.email,
          name: user.displayName || user.name,
        },
        items: [{ planId, quantity: 1 }],
        successUrl: returnUrl,
        cancelUrl,
        metadata: {
          source: 'world.hanzo.ai',
          iamUserId: user.sub || user.id,
          ...(body?.referralCode ? { referralCode: String(body.referralCode) } : {}),
        },
        ...(body?.discountCode ? { couponCodes: [String(body.discountCode)] } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return jsonResponse({
      error: 'commerce_unreachable',
      message: err?.message || String(err),
    }, 502, cors);
  }

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return jsonResponse({
      error: 'commerce_error',
      status: resp.status,
      commerceError: data?.error || data,
    }, 502, cors);
  }
  if (!data?.checkoutUrl && !data?.url) {
    return jsonResponse({ error: 'commerce_no_url', payload: data }, 502, cors);
  }

  return jsonResponse({
    checkoutUrl: data.checkoutUrl || data.url,
    sessionId: data.sessionId || data.id || null,
    planId,
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
