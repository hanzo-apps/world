// Use Node.js runtime for better network reliability to OpenSky
export const config = { runtime: 'nodejs', maxDuration: 15 };

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Build OpenSky API URL with bounding box params
  const params = new URLSearchParams();
  const { lamin, lomin, lamax, lomax } = req.query;

  if (lamin) params.set('lamin', lamin);
  if (lomin) params.set('lomin', lomin);
  if (lamax) params.set('lamax', lamax);
  if (lomax) params.set('lomax', lomax);

  const openskyUrl = `https://opensky-network.org/api/states/all${params.toString() ? '?' + params.toString() : ''}`;

  try {
    // Build headers with optional Basic Auth
    const headers = { 'Accept': 'application/json' };
    const username = process.env.OPENSKY_USERNAME;
    const password = process.env.OPENSKY_PASSWORD;
    if (username && password) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    }

    // Fetch with timeout using AbortController
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(openskyUrl, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.status === 429) {
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(429).json({ error: 'Rate limited', time: Date.now(), states: null });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 'public, max-age=10');
    return res.status(response.status).json(data);

  } catch (error) {
    const isTimeout = error.name === 'AbortError';
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? 'Request timeout' : 'Failed to fetch data',
      time: Date.now(),
      states: null
    });
  }
}
