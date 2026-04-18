/**
 * User preferences sync endpoint.
 *
 * GET  /api/user-prefs?variant=<variant>  — returns current cloud prefs
 * POST /api/user-prefs                    — saves prefs blob
 *
 * Auth: IAM Bearer token. Persistence: Hanzo Base (REST collections API).
 */

export const config = { runtime: 'edge' };

// @ts-expect-error — JS module, no declaration file
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
// @ts-expect-error — JS module, no declaration file
import { jsonResponse } from './_json-response.js';
import { validateBearerToken } from '../server/auth-session';

const BASE_URL = process.env.BASE_URL || 'https://base.hanzo.ai';
const BASE_TOKEN = process.env.BASE_TOKEN || '';

function baseHeaders(userToken: string): Record<string, string> {
  // Prefer user's IAM token for Base's IAM-bridged auth; fall back to service token.
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${userToken || BASE_TOKEN}`,
  };
}

export default async function handler(req: Request): Promise<Response> {
  if (isDisallowedOrigin(req)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403);
  }

  const cors = getCorsHeaders(req, 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return jsonResponse({ error: 'UNAUTHENTICATED' }, 401, cors);
  }

  const session = await validateBearerToken(token);
  if (!session.valid || !session.userId) {
    return jsonResponse({ error: 'UNAUTHENTICATED' }, 401, cors);
  }

  const userId = session.userId;

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const variant = url.searchParams.get('variant') ?? 'full';
    const filter = encodeURIComponent(`userId="${userId}" && variant="${variant}"`);
    try {
      const r = await fetch(
        `${BASE_URL}/api/collections/userPreferences/records?filter=${filter}&perPage=1`,
        { headers: baseHeaders(token), signal: AbortSignal.timeout(5000) },
      );
      if (!r.ok) return jsonResponse(null, 200, cors);
      const data = await r.json();
      const rec = Array.isArray(data.items) && data.items.length ? data.items[0] : null;
      return jsonResponse(rec, 200, cors);
    } catch (err) {
      console.error('[user-prefs] GET error:', err);
      return jsonResponse({ error: 'Failed to fetch preferences' }, 500, cors);
    }
  }

  // POST — save prefs
  let body: { variant?: unknown; data?: unknown; expectedSyncVersion?: unknown; schemaVersion?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400, cors);
  }

  if (
    typeof body.variant !== 'string' ||
    body.data === undefined ||
    typeof body.expectedSyncVersion !== 'number'
  ) {
    return jsonResponse({ error: 'MISSING_FIELDS' }, 400, cors);
  }

  try {
    // Upsert: find existing record, then PATCH or POST.
    const filter = encodeURIComponent(`userId="${userId}" && variant="${body.variant}"`);
    const findResp = await fetch(
      `${BASE_URL}/api/collections/userPreferences/records?filter=${filter}&perPage=1`,
      { headers: baseHeaders(token), signal: AbortSignal.timeout(5000) },
    );
    const find = findResp.ok ? await findResp.json() : { items: [] };
    const existing = Array.isArray(find.items) && find.items.length ? find.items[0] : null;

    const payload = {
      userId,
      variant: body.variant,
      data: body.data,
      schemaVersion: typeof body.schemaVersion === 'number' ? body.schemaVersion : 1,
      syncVersion: (typeof body.expectedSyncVersion === 'number' ? body.expectedSyncVersion : 0) + 1,
      updatedAt: Date.now(),
    };

    if (existing) {
      if (existing.syncVersion !== body.expectedSyncVersion) {
        return jsonResponse({ error: 'CONFLICT' }, 409, cors);
      }
      const upd = await fetch(
        `${BASE_URL}/api/collections/userPreferences/records/${existing.id}`,
        { method: 'PATCH', headers: baseHeaders(token), body: JSON.stringify(payload) },
      );
      if (!upd.ok) throw new Error(`Base PATCH ${upd.status}`);
      return jsonResponse(await upd.json(), 200, cors);
    } else {
      const created = await fetch(
        `${BASE_URL}/api/collections/userPreferences/records`,
        { method: 'POST', headers: baseHeaders(token), body: JSON.stringify(payload) },
      );
      if (!created.ok) throw new Error(`Base POST ${created.status}`);
      return jsonResponse(await created.json(), 200, cors);
    }
  } catch (err: unknown) {
    console.error('[user-prefs] POST error:', err);
    return jsonResponse({ error: 'Failed to save preferences' }, 500, cors);
  }
}
