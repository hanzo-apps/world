export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const closed = url.searchParams.get('closed') || 'false';
  const order = url.searchParams.get('order') || 'volume';
  const ascending = url.searchParams.get('ascending') || 'false';
  const limit = url.searchParams.get('limit') || '100';

  try {
    const polyUrl = `https://gamma-api.polymarket.com/markets?closed=${closed}&order=${order}&ascending=${ascending}&limit=${limit}`;
    const response = await fetch(polyUrl, {
      headers: {
        'Accept': 'application/json',
      },
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
