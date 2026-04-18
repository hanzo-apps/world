// /v1/world/me — current user + entitlements
//
// GET with Cookie (IAM session) OR Authorization: Bearer <iam-token>
// Returns: { user, entitlements: { plan, tier, worldTrial, zenTier, balance } }

import { corsHeaders } from '../../_cors.js';
import { jsonResponse } from '../../_json-response.js';

const IAM_ENDPOINT = process.env.IAM_ENDPOINT || 'https://hanzo.id';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405, cors);

  const auth = req.headers.get('authorization') || '';
  const cookie = req.headers.get('cookie') || '';
  if (!auth && !cookie) return jsonResponse({ error: 'unauthenticated' }, 401, cors);

  const userInfoResp = await fetch(`${IAM_ENDPOINT}/api/userinfo`, {
    headers: {
      ...(auth ? { Authorization: auth } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  if (!userInfoResp.ok) return jsonResponse({ error: 'unauthenticated' }, 401, cors);
  const user = await userInfoResp.json();

  // Derive entitlements from user.properties (set on the IAM user record)
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
