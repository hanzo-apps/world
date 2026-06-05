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
    return await res.json();
  } catch {
    return null;
  }
}

export function unauthenticated(cors) {
  return jsonResponse({ error: 'unauthenticated' }, 401, cors);
}
