/**
 * Product catalog API endpoint.
 *
 * Returns live pricing for Hanzo World plans, proxied from Commerce
 * (commerce.hanzo.ai /api/v1/billing/plans?category=world). Falls back to a
 * baked-in catalog when Commerce is unreachable.
 *
 *   GET    /api/product-catalog → { tiers: [...], fetchedAt, cachedUntil }
 *   DELETE /api/product-catalog → purge edge cache (requires RELAY_SHARED_SECRET)
 */

// @ts-check

export const config = { runtime: 'edge' };

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { jsonResponse } from './_json-response.js';
import { getFallbackCatalog } from './_product-fallback-prices.js';

const COMMERCE_ENDPOINT = process.env.COMMERCE_ENDPOINT || 'https://commerce.hanzo.ai';
const CACHE_TTL_SECONDS = Number(process.env.PRODUCT_CATALOG_CACHE_TTL || '300');

async function fetchTiersFromCommerce() {
  try {
    const r = await fetch(`${COMMERCE_ENDPOINT}/api/v1/billing/plans?category=world`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`commerce ${r.status}`);
    const data = await r.json();
    const plans = Array.isArray(data.plans) ? data.plans : [];
    if (plans.length === 0) throw new Error('no plans returned');
    return {
      tiers: plans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        priceMonthly: p.priceMonthly,
        priceAnnual: p.priceAnnual,
        features: p.features || [],
        limits: p.limits || {},
        popular: !!p.popular,
      })),
      source: 'commerce',
    };
  } catch (err) {
    console.warn('[product-catalog] commerce fetch failed, using fallback:', err);
    return { tiers: getFallbackCatalog(), source: 'fallback' };
  }
}

export default async function handler(req) {
  if (isDisallowedOrigin(req)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403);
  }

  const cors = getCorsHeaders(req, 'GET, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method === 'DELETE') {
    const secret = req.headers.get('x-relay-secret') || '';
    if (!secret || secret !== process.env.RELAY_SHARED_SECRET) {
      return jsonResponse({ error: 'Forbidden' }, 403, cors);
    }
    return jsonResponse({ status: 'purged' }, 200, cors);
  }

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  const result = await fetchTiersFromCommerce();
  const now = Math.floor(Date.now() / 1000);
  return new Response(
    JSON.stringify({
      ...result,
      fetchedAt: now,
      cachedUntil: now + CACHE_TTL_SECONDS,
    }),
    {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    },
  );
}
