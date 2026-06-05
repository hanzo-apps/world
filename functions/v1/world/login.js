// POST /v1/world/login — IAM password login (server-side, no Clerk).
//
// Body: { email, password }
// Returns: { ok: true, token, user }

import { jsonResponse } from '../../_shared/json.js';
import { corsHeaders } from '../../_shared/cors.js';

const IAM_ENDPOINT = 'https://hanzo.id';
const IAM_APP = 'app-world';
const IAM_ORG = 'hanzo';

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
  const { email, password } = body || {};
  if (!email || !password) {
    return jsonResponse({ error: 'email_and_password_required' }, 400, cors);
  }

  // Casdoor /api/login: returns { status: 'ok' } + sets a session cookie.
  // We forward that cookie back so the SPA can use it for the next round
  // trip to /v1/iam/oauth/userinfo.
  const loginResp = await fetch(`${IAM_ENDPOINT}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      application: IAM_APP,
      organization: IAM_ORG,
      username: email,
      password,
      type: 'login',
      autoSignin: true,
    }),
  });
  const data = await loginResp.json().catch(() => ({}));
  if (data.status !== 'ok') {
    return jsonResponse({ error: 'invalid_credentials', msg: data.msg }, 401, cors);
  }

  const setCookie = loginResp.headers.get('set-cookie') || null;
  const userResp = await fetch(`${IAM_ENDPOINT}/api/userinfo`, {
    headers: setCookie ? { Cookie: setCookie } : {},
  });
  const user = await userResp.json().catch(() => null);

  return jsonResponse({ ok: true, token: setCookie, user }, 200, cors);
}
