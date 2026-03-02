export const config = { runtime: 'edge' };

export default function handler(req) {
  const country = req.headers.get('x-vercel-ip-country') || 'XX';
  return new Response(JSON.stringify({ country }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
