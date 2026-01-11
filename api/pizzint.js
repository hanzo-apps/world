export const config = { runtime: 'edge' };

const PIZZINT_BASE = 'https://www.pizzint.watch/api';

export default async function handler(req) {
  const url = new URL(req.url);
  const pathParts = url.pathname.replace('/api/pizzint', '').split('/').filter(Boolean);
  const endpoint = pathParts[0] || 'dashboard';

  try {
    let targetUrl;
    let cacheTime = 120;

    switch (endpoint) {
      case 'dashboard':
        targetUrl = `${PIZZINT_BASE}/dashboard-data`;
        cacheTime = 60;
        break;

      case 'gdelt': {
        const pairs = url.searchParams.get('pairs') || 'usa_russia,russia_ukraine,usa_china,china_taiwan,usa_iran,usa_venezuela';
        const dateStart = url.searchParams.get('dateStart');
        const dateEnd = url.searchParams.get('dateEnd');
        targetUrl = `${PIZZINT_BASE}/gdelt/batch?pairs=${encodeURIComponent(pairs)}&method=gpr`;
        if (dateStart) targetUrl += `&dateStart=${dateStart}`;
        if (dateEnd) targetUrl += `&dateEnd=${dateEnd}`;
        cacheTime = 300;
        break;
      }

      case 'doomsday':
        targetUrl = `${PIZZINT_BASE}/neh-index/doomsday`;
        cacheTime = 120;
        break;

      default:
        return new Response(JSON.stringify({ error: 'Unknown endpoint' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
    }

    const response = await fetch(targetUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'WorldMonitor/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Upstream returned ${response.status}`);
    }

    const data = await response.text();
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': `public, max-age=${cacheTime}`,
      },
    });
  } catch (error) {
    console.error('PizzINT proxy error:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch PizzINT data', details: error.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
