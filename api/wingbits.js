// Wingbits API proxy - keeps API key server-side
export const config = { runtime: 'edge' };

// In-memory cache for aircraft details (they rarely change)
const detailsCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace('/api/wingbits', '');

  // Get API key from server-side env
  const apiKey = process.env.WINGBITS_API_KEY;

  if (!apiKey) {
    return Response.json({
      error: 'Wingbits not configured',
      configured: false
    }, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  // Route: GET /details/:icao24 - Aircraft details with caching
  const detailsMatch = path.match(/^\/details\/([a-fA-F0-9]+)$/);
  if (detailsMatch) {
    const icao24 = detailsMatch[1].toLowerCase();

    // Check cache
    const cached = detailsCache.get(icao24);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return Response.json(cached.data, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'X-Cache': 'HIT',
        },
      });
    }

    try {
      const response = await fetch(`https://customer-api.wingbits.com/v1/flights/details/${icao24}`, {
        headers: {
          'x-api-key': apiKey,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return Response.json({
          error: `Wingbits API error: ${response.status}`,
          icao24,
        }, {
          status: response.status,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }

      const data = await response.json();

      // Cache the result
      detailsCache.set(icao24, { data, timestamp: Date.now() });

      // Cleanup old cache entries periodically
      if (detailsCache.size > 1000) {
        const cutoff = Date.now() - CACHE_TTL;
        for (const [key, value] of detailsCache) {
          if (value.timestamp < cutoff) {
            detailsCache.delete(key);
          }
        }
      }

      return Response.json(data, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
          'X-Cache': 'MISS',
        },
      });
    } catch (error) {
      return Response.json({
        error: `Fetch failed: ${error.message}`,
        icao24,
      }, {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  // Route: POST /details/batch - Batch lookup multiple aircraft
  if (path === '/details/batch' && req.method === 'POST') {
    try {
      const body = await req.json();
      const icao24List = body.icao24s || [];

      if (!Array.isArray(icao24List) || icao24List.length === 0) {
        return Response.json({ error: 'icao24s array required' }, {
          status: 400,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Limit batch size
      const limitedList = icao24List.slice(0, 50);
      const results = {};
      const toFetch = [];

      // Check cache first
      for (const icao24 of limitedList) {
        const key = icao24.toLowerCase();
        const cached = detailsCache.get(key);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          results[key] = cached.data;
        } else {
          toFetch.push(key);
        }
      }

      // Fetch uncached items (with rate limiting)
      for (const icao24 of toFetch.slice(0, 20)) { // Max 20 new fetches per batch
        try {
          const response = await fetch(`https://customer-api.wingbits.com/v1/flights/details/${icao24}`, {
            headers: {
              'x-api-key': apiKey,
              'Accept': 'application/json',
            },
          });

          if (response.ok) {
            const data = await response.json();
            results[icao24] = data;
            detailsCache.set(icao24, { data, timestamp: Date.now() });
          }
        } catch {
          // Skip failed lookups
        }
      }

      return Response.json({
        results,
        cached: limitedList.length - toFetch.length,
        fetched: Math.min(toFetch.length, 20),
      }, {
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      return Response.json({
        error: `Batch lookup failed: ${error.message}`,
      }, {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  // Route: GET /health - Check Wingbits status
  if (path === '/health' || path === '') {
    try {
      const response = await fetch('https://customer-api.wingbits.com/health', {
        headers: { 'x-api-key': apiKey },
      });
      const data = await response.json();
      return Response.json({
        ...data,
        configured: true,
        cacheSize: detailsCache.size,
      }, {
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    } catch (error) {
      return Response.json({
        error: error.message,
        configured: true,
      }, {
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  return Response.json({ error: 'Not found' }, {
    status: 404,
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
