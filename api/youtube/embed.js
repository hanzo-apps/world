export const config = { runtime: 'edge' };

function parseFlag(value, fallback = '1') {
  if (value === '0' || value === '1') return value;
  return fallback;
}

function sanitizeVideoId(value) {
  if (typeof value !== 'string') return null;
  return /^[A-Za-z0-9_-]{11}$/.test(value) ? value : null;
}

export default async function handler(request) {
  const url = new URL(request.url);
  const videoId = sanitizeVideoId(url.searchParams.get('videoId'));

  if (!videoId) {
    return new Response('Missing or invalid videoId', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const autoplay = parseFlag(url.searchParams.get('autoplay'), '1');
  const mute = parseFlag(url.searchParams.get('mute'), '1');

  const embedSrc = new URL(`https://www.youtube.com/embed/${videoId}`);
  embedSrc.searchParams.set('autoplay', autoplay);
  embedSrc.searchParams.set('mute', mute);
  embedSrc.searchParams.set('playsinline', '1');
  embedSrc.searchParams.set('rel', '0');
  embedSrc.searchParams.set('controls', '1');
  embedSrc.searchParams.set('enablejsapi', '1');
  embedSrc.searchParams.set('origin', 'https://worldmonitor.app');
  embedSrc.searchParams.set('widget_referrer', 'https://worldmonitor.app');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="referrer" content="strict-origin-when-cross-origin" />
  <style>
    html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}
    iframe{display:block;border:0;width:100%;height:100%}
  </style>
</head>
<body>
  <iframe
    src="${embedSrc.toString()}"
    title="YouTube live"
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
    referrerpolicy="strict-origin-when-cross-origin"
    allowfullscreen
  ></iframe>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
