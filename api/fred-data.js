export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const cosd = url.searchParams.get('cosd');
  const coed = url.searchParams.get('coed');

  if (!id) {
    return new Response('Missing id parameter', { status: 400 });
  }

  try {
    const fredUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}${cosd ? `&cosd=${cosd}` : ''}${coed ? `&coed=${coed}` : ''}`;
    const response = await fetch(fredUrl);
    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: { 'Content-Type': 'text/csv', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
}
