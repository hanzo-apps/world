export const config = { runtime: 'edge' };

export default async function handler() {
  try {
    const response = await fetch('https://www.pizzint.watch/api/dashboard-data', {
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
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch PizzINT data', details: error.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
