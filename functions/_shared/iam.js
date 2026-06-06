// Hanzo IAM helpers.
//
// `iamUserinfo(request)` exchanges the caller's Authorization header or
// hanzo.id session cookie for the userinfo payload. Returns null on any
// failure so callers can short-circuit with a 401.

import { jsonResponse } from './json.js';

const IAM_ENDPOINT = 'https://hanzo.id';

export async function iamUserinfo(request) {
  const auth = request.headers.get('authorization') || '';
  const cookie = request.headers.get('cookie') || '';
  if (!auth && !cookie) return null;
  try {
    const res = await fetch(`${IAM_ENDPOINT}/v1/iam/oauth/userinfo`, {
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // IAM returns 200 OK with {status:"error"} for invalid/expired tokens
    // (Casdoor convention). Treat anything without a stable subject as
    // unauthenticated regardless of HTTP status.
    if (!data || data.status === 'error') return null;
    if (!data.sub && !data.id && !data.email) return null;
    return data;
  } catch {
    return null;
  }
}

export function unauthenticated(cors) {
  return jsonResponse({ error: 'unauthenticated' }, 401, cors);
}
