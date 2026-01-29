export const config = { runtime: 'edge' };

const ALLOWED_ORDER = ['volume', 'liquidity', 'startDate', 'endDate', 'spread'];
const MAX_LIMIT = 100;
const MIN_LIMIT = 1;

function validateBoolean(val, defaultVal) {
  if (val === 'true' || val === 'false') return val;
  return defaultVal;
}

function validateLimit(val) {
  const num = parseInt(val, 10);
  if (isNaN(num)) return 50;
  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, num));
}

function validateOrder(val) {
  return ALLOWED_ORDER.includes(val) ? val : 'volume';
}

function sanitizeTagSlug(val) {
  if (!val) return null;
  return val.replace(/[^a-z0-9-]/gi, '').slice(0, 100) || null;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const endpoint = url.searchParams.get('endpoint') || 'markets';

  const closed = validateBoolean(url.searchParams.get('closed'), 'false');
  const order = validateOrder(url.searchParams.get('order'));
  const ascending = validateBoolean(url.searchParams.get('ascending'), 'false');
  const limit = validateLimit(url.searchParams.get('limit'));

  try {
    let polyUrl;

    if (endpoint === 'events') {
      const tag = sanitizeTagSlug(url.searchParams.get('tag'));
      const params = new URLSearchParams({
        closed: closed,
        order: order,
        ascending: ascending,
        limit: String(limit),
      });
      if (tag) params.set('tag_slug', tag);
      polyUrl = `https://gamma-api.polymarket.com/events?${params}`;
    } else {
      polyUrl = `https://gamma-api.polymarket.com/markets?closed=${closed}&order=${order}&ascending=${ascending}&limit=${limit}`;
    }

    const response = await fetch(polyUrl, {
      headers: { 'Accept': 'application/json' },
    });

    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
