export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const query = url.searchParams.get('query') || 'protest';
  const format = url.searchParams.get('format') || 'geojson';
  const maxrecords = url.searchParams.get('maxrecords') || '250';
  const timespan = url.searchParams.get('timespan') || '7d';

  try {
    const response = await fetch(
      `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent(query)}&format=${format}&maxrecords=${maxrecords}&timespan=${timespan}`
    );
    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
