/**
 * Catch-all fallback for unknown domains.
 *
 * All 21 known domains now have dedicated edge functions (e.g. api/seismology/v1/[rpc].ts).
 * Vercel routes exact directory names before dynamic [domain], so this only fires for
 * unrecognised domain slugs — returning a lightweight 404 without importing any handler code.
 */

export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from '../../../server/cors';

export default async function handler(request: Request): Promise<Response> {
  if (isDisallowedOrigin(request)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let corsHeaders: Record<string, string>;
  try {
    corsHeaders = getCorsHeaders(request);
  } catch {
    corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
