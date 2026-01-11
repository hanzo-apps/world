export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);

  // Build OpenSky API URL with bounding box params
  const params = new URLSearchParams();
  const lamin = url.searchParams.get('lamin');
  const lomin = url.searchParams.get('lomin');
  const lamax = url.searchParams.get('lamax');
  const lomax = url.searchParams.get('lomax');

  if (lamin) params.set('lamin', lamin);
  if (lomin) params.set('lomin', lomin);
  if (lamax) params.set('lamax', lamax);
  if (lomax) params.set('lomax', lomax);

  const openskyUrl = `https://opensky-network.org/api/states/all${params.toString() ? '?' + params.toString() : ''}`;

  try {
    const response = await fetch(openskyUrl, {
      headers: {
        'Accept': 'application/json',
        // Add auth if credentials are configured
        ...(process.env.OPENSKY_USERNAME && process.env.OPENSKY_PASSWORD && {
          'Authorization': 'Basic ' + btoa(`${process.env.OPENSKY_USERNAME}:${process.env.OPENSKY_PASSWORD}`)
        }),
      },
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: 'Rate limited', time: Date.now(), states: null }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=10',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data', time: Date.now(), states: null }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
