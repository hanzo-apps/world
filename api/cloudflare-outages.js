export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const dateRange = url.searchParams.get('dateRange') || '7d';
  const limit = url.searchParams.get('limit') || '50';

  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ success: false, errors: [{ message: 'Missing API token' }] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=${dateRange}&limit=${limit}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, errors: [{ message: error.message }] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
