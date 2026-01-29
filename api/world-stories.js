/**
 * World Stories — Shareable Country Intelligence Snapshots
 * Renders 1080×1920 vertical infographic PNG via @vercel/og (Satori)
 * Cached in Redis (1h TTL)
 */

import { ImageResponse } from '@vercel/og';
import { Redis } from '@upstash/redis';

export const config = {
  runtime: 'edge',
};

let redis = null;
let redisInitFailed = false;
function getRedis() {
  if (redis) return redis;
  if (redisInitFailed) return null;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      redis = new Redis({ url, token });
    } catch (err) {
      console.warn('[Stories] Redis init failed:', err.message);
      redisInitFailed = true;
    }
  }
  return redis;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

const CACHE_TTL = 3600; // 1 hour

const LEVEL_COLORS = {
  critical: '#ef4444',
  high: '#f97316',
  elevated: '#eab308',
  normal: '#22c55e',
  low: '#3b82f6',
};

const THREAT_COLORS = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
  info: '#3b82f6',
};

const THREAT_DOTS = {
  critical: '⚡',
  high: '●',
  medium: '●',
  low: '●',
  info: '●',
};

// Helper to create virtual DOM elements for Satori
function h(type, style, ...children) {
  const props = { style };
  const flat = children.flat().filter(c => c != null && c !== false && c !== '');
  if (flat.length === 1 && typeof flat[0] === 'string') {
    props.children = flat[0];
  } else if (flat.length > 0) {
    props.children = flat;
  }
  return { type, props };
}

function renderStoryCard(data) {
  const { countryCode, countryName, cii, news, theater, markets, threats } = data;
  const now = new Date();
  const timeStr = now.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const dateStr = now.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

  const levelColor = LEVEL_COLORS[cii?.level || 'normal'] || '#888';
  const score = cii?.score ?? 0;
  const trend = cii?.trend === 'rising' ? ' ↑ RISING' : cii?.trend === 'falling' ? ' ↓ FALLING' : ' → STABLE';

  // Sections
  const sections = [];

  // -- Header --
  sections.push(
    h('div', {
      display: 'flex',
      flexDirection: 'column',
      padding: '50px 60px 30px',
      borderBottom: '2px solid #1a1a2e',
    },
      h('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
        h('span', { fontSize: 28, fontWeight: 700, color: '#888', letterSpacing: '4px' }, 'WORLDMONITOR'),
        h('span', { fontSize: 22, color: '#555' }, dateStr),
      ),
    )
  );

  // -- Country + CII --
  sections.push(
    h('div', {
      display: 'flex',
      flexDirection: 'column',
      padding: '40px 60px 30px',
      gap: '16px',
    },
      h('div', { display: 'flex', alignItems: 'baseline', gap: '16px' },
        h('span', { fontSize: 72, fontWeight: 700, color: '#fff' }, countryName.toUpperCase()),
      ),
      h('div', { display: 'flex', alignItems: 'center', gap: '16px' },
        h('span', { fontSize: 36, fontWeight: 600, color: levelColor }, `${score}/100`),
        h('span', { fontSize: 28, color: levelColor }, trend),
        h('span', {
          fontSize: 22,
          fontWeight: 700,
          color: '#fff',
          backgroundColor: levelColor,
          padding: '4px 14px',
          borderRadius: '6px',
        }, (cii?.level || 'normal').toUpperCase()),
      ),
      // Score bar
      h('div', { display: 'flex', width: '100%', height: '12px', backgroundColor: '#1a1a2e', borderRadius: '6px', overflow: 'hidden' },
        h('div', { width: `${score}%`, height: '100%', backgroundColor: levelColor, borderRadius: '6px' }),
      ),
      // Component scores
      cii?.components ? h('div', { display: 'flex', gap: '24px', fontSize: 20, color: '#888' },
        h('span', {}, `U:${cii.components.unrest}`),
        h('span', {}, `S:${cii.components.security}`),
        h('span', {}, `I:${cii.components.information}`),
      ) : null,
    )
  );

  // -- Headlines --
  if (news && news.length > 0) {
    const newsItems = news.slice(0, 5).map(item => {
      const threatColor = THREAT_COLORS[item.threatLevel || 'info'];
      const dot = THREAT_DOTS[item.threatLevel || 'info'];
      const label = (item.threatLevel || 'info').toUpperCase();
      const title = item.title.length > 70 ? item.title.slice(0, 67) + '...' : item.title;

      return h('div', { display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '8px' },
        h('span', {
          fontSize: 18,
          fontWeight: 700,
          color: threatColor,
          minWidth: '60px',
        }, `${dot} ${label}`),
        h('span', { fontSize: 22, color: '#ccc', lineHeight: '1.3' }, title),
      );
    });

    const alertCount = news.filter(n => n.threatLevel === 'critical' || n.threatLevel === 'high').length;
    const sourceCount = news.reduce((sum, n) => sum + (n.sourceCount || 1), 0);

    sections.push(
      h('div', {
        display: 'flex',
        flexDirection: 'column',
        padding: '30px 60px',
        borderTop: '1px solid #1a1a2e',
        gap: '16px',
      },
        h('span', { fontSize: 22, fontWeight: 700, color: '#555', letterSpacing: '3px' }, 'TOP HEADLINES'),
        ...newsItems,
        h('div', { display: 'flex', gap: '16px', fontSize: 18, color: '#555', marginTop: '4px' },
          h('span', {}, `${sourceCount} sources`),
          alertCount > 0 ? h('span', { color: '#ef4444' }, `${alertCount} alerts`) : null,
        ),
      )
    );
  }

  // -- Military Posture --
  if (theater) {
    const postureColor = theater.postureLevel === 'critical' ? '#ef4444'
      : theater.postureLevel === 'elevated' ? '#f97316' : '#22c55e';

    sections.push(
      h('div', {
        display: 'flex',
        flexDirection: 'column',
        padding: '30px 60px',
        borderTop: '1px solid #1a1a2e',
        gap: '16px',
      },
        h('span', { fontSize: 22, fontWeight: 700, color: '#555', letterSpacing: '3px' }, 'MILITARY POSTURE'),
        h('div', { display: 'flex', alignItems: 'center', gap: '16px' },
          h('span', { fontSize: 28, fontWeight: 600, color: postureColor }, `${theater.theaterName}: ${(theater.postureLevel || 'normal').toUpperCase()}`),
        ),
        h('div', { display: 'flex', gap: '24px', fontSize: 22, color: '#aaa' },
          h('span', {}, `✈ ${theater.totalAircraft || 0} aircraft`),
          h('span', {}, `⚓ ${theater.totalVessels || 0} vessels`),
        ),
        (theater.fighters || theater.tankers || theater.awacs) ?
          h('div', { display: 'flex', gap: '20px', fontSize: 20, color: '#777' },
            theater.fighters ? h('span', {}, `Fighters: ${theater.fighters}`) : null,
            theater.tankers ? h('span', {}, `Tankers: ${theater.tankers}`) : null,
            theater.awacs ? h('span', {}, `AWACS: ${theater.awacs}`) : null,
          ) : null,
        theater.strikeCapable ?
          h('span', { fontSize: 20, fontWeight: 700, color: '#ef4444' }, 'STRIKE CAPABLE') : null,
      )
    );
  }

  // -- Predictions --
  if (markets && markets.length > 0) {
    const marketItems = markets.slice(0, 4).map(m => {
      const pct = typeof m.yesPrice === 'number' ? `${Math.round(m.yesPrice * 100)}%` : m.yesPrice || '—';
      const title = m.title.length > 50 ? m.title.slice(0, 47) + '...' : m.title;
      return h('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
        h('span', { fontSize: 22, color: '#ccc' }, title),
        h('span', { fontSize: 22, fontWeight: 700, color: '#eab308' }, pct),
      );
    });

    sections.push(
      h('div', {
        display: 'flex',
        flexDirection: 'column',
        padding: '30px 60px',
        borderTop: '1px solid #1a1a2e',
        gap: '14px',
      },
        h('span', { fontSize: 22, fontWeight: 700, color: '#555', letterSpacing: '3px' }, 'PREDICTION MARKETS'),
        ...marketItems,
      )
    );
  }

  // -- Threat Breakdown --
  if (threats) {
    const counts = threats;
    const hasThreats = (counts.critical || 0) + (counts.high || 0) + (counts.medium || 0) > 0;

    if (hasThreats) {
      const categories = (threats.categories || []).slice(0, 4).map(c =>
        c.charAt(0).toUpperCase() + c.slice(1)
      );

      sections.push(
        h('div', {
          display: 'flex',
          flexDirection: 'column',
          padding: '30px 60px',
          borderTop: '1px solid #1a1a2e',
          gap: '14px',
        },
          h('span', { fontSize: 22, fontWeight: 700, color: '#555', letterSpacing: '3px' }, 'THREAT BREAKDOWN'),
          h('div', { display: 'flex', gap: '24px', fontSize: 22 },
            counts.critical ? h('span', { color: '#ef4444', fontWeight: 700 }, `${counts.critical} Critical`) : null,
            counts.high ? h('span', { color: '#f97316', fontWeight: 700 }, `${counts.high} High`) : null,
            counts.medium ? h('span', { color: '#eab308' }, `${counts.medium} Medium`) : null,
          ),
          categories.length > 0 ?
            h('span', { fontSize: 20, color: '#777' }, categories.join(' · ')) : null,
        )
      );
    }
  }

  // -- Footer --
  sections.push(
    h('div', {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '20px 60px 50px',
      marginTop: 'auto',
      borderTop: '1px solid #1a1a2e',
    },
      h('span', { fontSize: 20, color: '#444' }, 'worldmonitor.app'),
      h('span', { fontSize: 20, color: '#444' }, timeStr),
    )
  );

  // Root container
  return h('div', {
    display: 'flex',
    flexDirection: 'column',
    width: 1080,
    height: 1920,
    backgroundColor: '#0a0a0a',
    color: '#ffffff',
    fontFamily: 'Inter, sans-serif',
  }, ...sections);
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.json();
    const { countryCode, countryName, cii, news, theater, markets, threats } = body;

    if (!countryCode || !countryName) {
      return new Response(JSON.stringify({ error: 'countryCode and countryName required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Cache key based on data hash
    const dataHash = hashString(JSON.stringify({ countryCode, cii, news: (news || []).map(n => n.title), theater: theater?.postureLevel, threats }));
    const cacheKey = `story:v1:${countryCode}:${dataHash}`;

    // Check Redis cache
    const redisClient = getRedis();
    if (redisClient) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached && typeof cached === 'string') {
          return new Response(JSON.stringify({ image: cached, cached: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (e) {
        console.warn('[Stories] Cache read error:', e.message);
      }
    }

    // Render image
    const element = renderStoryCard({ countryCode, countryName, cii, news, theater, markets, threats });
    const imageResponse = new ImageResponse(element, {
      width: 1080,
      height: 1920,
    });

    // Convert to base64 (chunked to avoid call stack overflow)
    const buffer = await imageResponse.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    const dataUrl = `data:image/png;base64,${base64}`;

    // Cache in Redis
    if (redisClient) {
      try {
        await redisClient.set(cacheKey, dataUrl, { ex: CACHE_TTL });
        console.log('[Stories] Cached:', cacheKey);
      } catch (e) {
        console.warn('[Stories] Cache write error:', e.message);
      }
    }

    return new Response(JSON.stringify({ image: dataUrl, cached: false }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=1800',
      },
    });

  } catch (error) {
    console.error('[Stories] Error:', error.name, error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
