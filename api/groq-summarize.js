/**
 * Groq API Summarization Endpoint with Redis Caching
 * Uses Llama 3.1 8B Instant for high-throughput summarization
 * Free tier: 14,400 requests/day (14x more than 70B model)
 * Server-side Redis cache for cross-user deduplication
 */

import { Redis } from '@upstash/redis';

export const config = {
  runtime: 'edge',
};

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant'; // 14.4K RPD vs 1K for 70b
const CACHE_TTL_SECONDS = 86400; // 24 hours

// Initialize Redis (lazy - only if env vars present)
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
      console.warn('[Groq] Redis init failed:', err.message);
      redisInitFailed = true;
      return null;
    }
  }
  return redis;
}

// Generate cache key from headlines
function getCacheKey(headlines, mode) {
  const sorted = headlines.slice(0, 8).sort().join('|');
  const hash = hashString(`${mode}:${sorted}`);
  return `summary:${hash}`;
}

// Simple hash function for cache keys
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// Deduplicate similar headlines (same story from different sources)
function deduplicateHeadlines(headlines) {
  const seen = new Set();
  const unique = [];

  for (const headline of headlines) {
    // Normalize: lowercase, remove punctuation, collapse whitespace
    const normalized = headline.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract key words (4+ chars) for similarity check
    const words = new Set(normalized.split(' ').filter(w => w.length >= 4));

    // Check if this headline is too similar to any we've seen
    let isDuplicate = false;
    for (const seenWords of seen) {
      const intersection = [...words].filter(w => seenWords.has(w));
      const similarity = intersection.length / Math.min(words.size, seenWords.size);
      if (similarity > 0.6) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.add(words);
      unique.push(headline);
    }
  }

  return unique;
}

export default async function handler(request) {
  // Only allow POST
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Groq API key not configured', fallback: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { headlines, mode = 'brief' } = await request.json();

    if (!headlines || !Array.isArray(headlines) || headlines.length === 0) {
      return new Response(JSON.stringify({ error: 'Headlines array required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check Redis cache first
    const redisClient = getRedis();
    const cacheKey = getCacheKey(headlines, mode);

    if (redisClient) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached && typeof cached === 'object' && cached.summary) {
          console.log('[Groq] Cache hit:', cacheKey);
          return new Response(JSON.stringify({
            summary: cached.summary,
            model: cached.model || MODEL,
            provider: 'cache',
            cached: true,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (cacheError) {
        console.warn('[Groq] Cache read error:', cacheError.message);
      }
    }

    // Deduplicate similar headlines (same story from multiple sources)
    const uniqueHeadlines = deduplicateHeadlines(headlines.slice(0, 8));
    const headlineText = uniqueHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n');

    let systemPrompt, userPrompt;

    if (mode === 'brief') {
      systemPrompt = `You are a news anchor delivering a world brief. Write like you're opening the evening news.
Rules:
- Lead with the most significant development - start with WHAT happened, WHERE
- If stories connect, show the connection
- Vary your opening: use location, action, or impact - NEVER start with "The dominant narrative"
- Write naturally: "Tensions escalated in...", "Markets reacted to...", "A major shift in..."
- 2-3 punchy sentences, no bullet points`;
      userPrompt = `What's the top story right now? Open strong:\n${headlineText}`;
    } else if (mode === 'analysis') {
      systemPrompt = `Senior analyst giving a 30-second brief. Be direct and specific.
Rules:
- Lead with the insight, not meta-commentary
- Start with the actual finding: "China's...", "The market...", "A pattern of..."
- NEVER start with "The dominant/key narrative is" or similar framing
- Connect dots, be specific about implications
- 2-3 sentences, confident tone`;
      userPrompt = `What's the key pattern or risk here?\n${headlineText}`;
    } else {
      systemPrompt = `Intel analyst synthesizing a feed. Lead with substance, not framing. 2 sentences max. Never start with "The dominant narrative" - just state the insight directly.`;
      userPrompt = `Key takeaway:\n${headlineText}`;
    }

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 150,
        top_p: 0.9,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Groq] API error:', response.status, errorText);

      // Return fallback signal for rate limiting
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limited', fallback: true }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Groq API error', fallback: true }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();

    if (!summary) {
      return new Response(JSON.stringify({ error: 'Empty response', fallback: true }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Store in Redis cache
    if (redisClient) {
      try {
        await redisClient.set(cacheKey, {
          summary,
          model: MODEL,
          timestamp: Date.now(),
        }, { ex: CACHE_TTL_SECONDS });
        console.log('[Groq] Cached:', cacheKey);
      } catch (cacheError) {
        console.warn('[Groq] Cache write error:', cacheError.message);
      }
    }

    return new Response(JSON.stringify({
      summary,
      model: MODEL,
      provider: 'groq',
      cached: false,
      tokens: data.usage?.total_tokens || 0,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=1800',
      },
    });

  } catch (error) {
    console.error('[Groq] Error:', error.name, error.message, error.stack?.split('\n')[1]);
    return new Response(JSON.stringify({
      error: error.message,
      errorType: error.name,
      fallback: true
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
