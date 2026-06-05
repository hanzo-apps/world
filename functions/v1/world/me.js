// GET /v1/world/me — current IAM user + Hanzo World entitlements.
//
// Auth: IAM Bearer or hanzo.id session cookie.
// Returns: { user, entitlements: { plan, tier, worldTrial, zenTier, balance } }

import { iamUserinfo, unauthenticated } from '../../_shared/iam.js';
import { jsonResponse } from '../../_shared/json.js';
import { corsHeaders } from '../../_shared/cors.js';

export async function onRequestOptions({ request }) {
  return new Response(null, { headers: corsHeaders(request, 'GET, OPTIONS') });
}

export async function onRequestGet({ request }) {
  const cors = corsHeaders(request, 'GET, OPTIONS');
  const user = await iamUserinfo(request);
  if (!user) return unauthenticated(cors);

  // Entitlements are mirrored on the IAM user under `properties.*` by the
  // Hanzo Commerce subscription webhook; if the property is missing the
  // free tier is the right default.
  const props = user.properties || {};
  const entitlements = {
    plan: props.plan || 'world-free',
    tier: props.tier || 'free',
    worldTrial: props.worldTrial || null,
    zenTier: props.zenTier || 'tier_zen_free',
    balance: user.balance || 0,
    giftedBy: props.giftedBy || null,
  };

  return jsonResponse({ user, entitlements }, 200, cors);
}
