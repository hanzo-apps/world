// /v1/world/chat — Zen AI chat proxy grounded in the user's current map context
//
// POST { messages, mapContext?: { lat, lon, zoom, layers } } with IAM auth.
// Streams OpenAI-compatible chat completions from api.hanzo.ai (Zen).
// Model chosen by user's zenTier: tier_zen_pro → zen4-thinking, else zen4-mini.

import { corsHeaders } from '../../_cors.js';
import { jsonResponse } from '../../_json-response.js';

const IAM_ENDPOINT = process.env.IAM_ENDPOINT || 'https://hanzo.id';
const ZEN_ENDPOINT = process.env.ZEN_ENDPOINT || 'https://api.hanzo.ai/v1';

const MODEL_BY_TIER = {
  tier_zen_enterprise: 'zen4-thinking',
  tier_zen_team: 'zen4-thinking',
  tier_zen_pro: 'zen4-thinking',
  tier_zen_free: 'zen4-mini',
};

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, cors);

  const auth = req.headers.get('authorization') || '';
  const cookie = req.headers.get('cookie') || '';
  if (!auth && !cookie) return jsonResponse({ error: 'unauthenticated' }, 401, cors);

  // Resolve user + entitlements
  const userInfoResp = await fetch(`${IAM_ENDPOINT}/api/userinfo`, {
    headers: {
      ...(auth ? { Authorization: auth } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  if (!userInfoResp.ok) return jsonResponse({ error: 'unauthenticated' }, 401, cors);
  const user = await userInfoResp.json();
  const zenTier = user.properties?.zenTier || 'tier_zen_free';
  const model = MODEL_BY_TIER[zenTier] || 'zen4-mini';

  let body;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'invalid_json' }, 400, cors); }
  const { messages = [], mapContext } = body || {};

  // Inject map context as a system message so Zen answers are grounded
  const systemMsg = {
    role: 'system',
    content: [
      'You are Zen, Hanzo World\'s live geopolitical / OSINT analyst.',
      'Answer grounded in the live dashboard state the user is currently viewing.',
      mapContext
        ? `Map context: viewport lat=${mapContext.lat}, lon=${mapContext.lon}, zoom=${mapContext.zoom}. Active layers: ${(mapContext.layers || []).join(', ') || 'default'}.`
        : '',
      'Be concise. Cite sources from the live feeds where possible.',
    ].filter(Boolean).join(' '),
  };

  const zenBody = {
    model,
    messages: [systemMsg, ...messages],
    stream: true,
    temperature: 0.6,
    max_tokens: 2048,
    metadata: {
      user_id: `${user.owner}/${user.name}`,
      org_id: user.owner,
      zen_tier: zenTier,
      source: 'world.hanzo.ai/chat',
    },
  };

  const zenResp = await fetch(`${ZEN_ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth || '',
    },
    body: JSON.stringify(zenBody),
  });

  // Stream through unchanged
  return new Response(zenResp.body, {
    status: zenResp.status,
    headers: {
      ...cors,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Zen-Model': model,
      'X-Zen-Tier': zenTier,
    },
  });
}
