import { fetchLatestRelease } from './_github-release.js';

// Non-sebuf: returns XML/HTML, stays as standalone Vercel function
export const config = { runtime: 'edge' };

export default async function handler() {
  try {
    const release = await fetchLatestRelease('WorldMonitor-Version-Check');
    if (!release) {
      return new Response(JSON.stringify({ error: 'upstream' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const tag = release.tag_name ?? '';
    const version = tag.replace(/^v/, '');

    return new Response(JSON.stringify({
      version,
      tag,
      url: release.html_url,
      prerelease: release.prerelease ?? false,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60, stale-if-error=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'fetch_failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
