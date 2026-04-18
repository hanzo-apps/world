// /v1/world/login — IAM password login (server-side, no Clerk)
//
// POST { email, password } → { token, user }
// Talks directly to Hanzo IAM at IAM_ENDPOINT/api/login.
// Stores token in a signed cookie + returns it in the body for clients that
// want to attach it as a Bearer.

import { corsHeaders } from '../../_cors.js';
import { jsonResponse } from '../../_json-response.js';

const IAM_ENDPOINT = process.env.IAM_ENDPOINT || 'https://hanzo.id';
const IAM_APP = process.env.IAM_APP || 'hanzo-app';
const IAM_ORG = process.env.IAM_ORG || 'hanzo';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, cors);

  let body;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'invalid_json' }, 400, cors); }
  const { email, password } = body || {};
  if (!email || !password) return jsonResponse({ error: 'email_and_password_required' }, 400, cors);

  // Login against IAM
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
  const loginData = await loginResp.json().catch(() => ({}));
  if (loginData.status !== 'ok') {
    return jsonResponse({ error: 'invalid_credentials', msg: loginData.msg }, 401, cors);
  }

  // Resolve user + access token via IAM token exchange
  const userInfoResp = await fetch(`${IAM_ENDPOINT}/api/userinfo`, {
    headers: { Cookie: loginResp.headers.get('set-cookie') || '' },
  });
  const user = await userInfoResp.json().catch(() => null);

  return jsonResponse({
    ok: true,
    token: loginResp.headers.get('set-cookie') || null,
    user,
  }, 200, cors);
}
