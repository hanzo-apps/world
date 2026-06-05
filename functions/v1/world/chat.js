// POST /v1/world/chat — Zen AI chat proxy grounded in the live dashboard.
//
// Body: { messages, mapContext?: { lat, lon, zoom, layers } }
// Auth: IAM Bearer or hanzo.id session cookie.
// Returns: streamed OpenAI-compatible chat completions from api.hanzo.ai (Zen).

import { iamUserinfo, unauthenticated } from '../../_shared/iam.js';
import { jsonResponse } from '../../_shared/json.js';
import { corsHeaders } from '../../_shared/cors.js';

const ZEN_ENDPOINT = 'https://api.hanzo.ai/v1';

const MODEL_BY_TIER = {
  tier_zen_enterprise: 'zen4-thinking',
  tier_zen_team: 'zen4-thinking',
  tier_zen_pro: 'zen4-thinking',
  tier_zen_free: 'zen4-mini',
};

export async function onRequestOptions({ request }) {
  return new Response(null, { headers: corsHeaders(request, 'POST, OPTIONS') });
}

export async function onRequestPost({ request }) {
  const cors = corsHeaders(request, 'POST, OPTIONS');
  const user = await iamUserinfo(request);
  if (!user) return unauthenticated(cors);

  const zenTier = user.properties?.zenTier || 'tier_zen_free';
  const model = MODEL_BY_TIER[zenTier] || 'zen4-mini';

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, cors);
  }
  const { messages = [], mapContext } = body || {};

  const systemMsg = {
    role: 'system',
    content: [
      "You are Zen, Hanzo World's live geopolitical / OSINT analyst.",
      'Answer grounded in the live dashboard state the user is currently viewing.',
      mapContext
        ? `Map context: viewport lat=${mapContext.lat}, lon=${mapContext.lon}, zoom=${mapContext.zoom}. Active layers: ${(mapContext.layers || []).join(', ') || 'default'}.`
        : '',
      'Be concise. Cite sources from the live feeds where possible.',
    ].filter(Boolean).join(' '),
  };

  const zenResp = await fetch(`${ZEN_ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: request.headers.get('Authorization') || '',
    },
    body: JSON.stringify({
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
    }),
  });

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
