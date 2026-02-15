import { getCorsHeaders } from './_cors.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = getCorsHeaders(req);
  try {
    const response = await fetch(
      'https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=A'
    );
    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: { 'Content-Type': 'application/json', ...cors, 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
