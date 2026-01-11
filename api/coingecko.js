export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const ids = url.searchParams.get('ids') || 'bitcoin,ethereum,solana';
  const vsCurrencies = url.searchParams.get('vs_currencies') || 'usd';
  const include24hrChange = url.searchParams.get('include_24hr_change') || 'true';

  try {
    const geckoUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vsCurrencies}&include_24hr_change=${include24hrChange}`;
    const response = await fetch(geckoUrl, {
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
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
