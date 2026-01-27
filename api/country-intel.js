/**
 * Country Intelligence Brief Endpoint
 * Generates AI-powered country situation briefs using Groq
 * Redis cached (2h TTL) for cross-user deduplication
 */

import { Redis } from '@upstash/redis';

export const config = {
  runtime: 'edge',
};

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant';
const CACHE_TTL_SECONDS = 7200; // 2 hours
const CACHE_VERSION = 'ci-v1';

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
      console.warn('[CountryIntel] Redis init failed:', err.message);
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

export default async function handler(request) {
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
    const { country, code, context } = await request.json();

    if (!country || !code) {
      return new Response(JSON.stringify({ error: 'country and code required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Cache key includes country code + context hash (context changes as data updates)
    const contextHash = context ? hashString(JSON.stringify(context)).slice(0, 8) : 'no-ctx';
    const cacheKey = `${CACHE_VERSION}:${code}:${contextHash}`;

    const redisClient = getRedis();
    if (redisClient) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached && typeof cached === 'object' && cached.brief) {
          console.log('[CountryIntel] Cache hit:', code);
          return new Response(JSON.stringify({ ...cached, cached: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (e) {
        console.warn('[CountryIntel] Cache read error:', e.message);
      }
    }

    // Build data context section
    const dataLines = [];
    if (context?.score != null) {
      dataLines.push(`Instability Score: ${context.score}/100 (${context.level || 'unknown'}) — trend: ${context.trend || 'unknown'}`);
    }
    if (context?.components) {
      const c = context.components;
      dataLines.push(`Score Components: Unrest ${c.unrest ?? '?'}, Security ${c.security ?? '?'}, Information ${c.information ?? '?'}`);
    }
    if (context?.protests != null) dataLines.push(`Active protests (7d): ${context.protests}`);
    if (context?.militaryFlights != null) dataLines.push(`Military aircraft in/near country: ${context.militaryFlights}`);
    if (context?.militaryVessels != null) dataLines.push(`Military vessels in/near country: ${context.militaryVessels}`);
    if (context?.outages != null) dataLines.push(`Internet outages: ${context.outages}`);
    if (context?.earthquakes != null) dataLines.push(`Recent earthquakes: ${context.earthquakes}`);
    if (context?.headlines?.length > 0) {
      dataLines.push(`\nRecent headlines mentioning ${country}:`);
      context.headlines.slice(0, 10).forEach((h, i) => dataLines.push(`${i + 1}. ${h}`));
    }

    const dataSection = dataLines.length > 0
      ? `\nCURRENT DATA:\n${dataLines.join('\n')}`
      : '\nNo real-time data available for this country.';

    const dateStr = new Date().toISOString().split('T')[0];

    const systemPrompt = `You are a senior intelligence analyst providing country situation briefs. Current date: ${dateStr}. Donald Trump is the current US President (second term, inaugurated Jan 2025).

Write a concise, data-driven intelligence brief for the requested country. Structure:

1. **Current Situation** — What is happening right now based on the data
2. **Key Risk Factors** — What drives instability or stability
3. **Outlook** — What to watch in the near term

Rules:
- Be specific. Reference the data provided (scores, counts, headlines).
- If data shows low activity, say so — don't manufacture threats.
- 3-4 paragraphs total, ~200 words.
- No speculation beyond what the data supports.
- Use plain language, not jargon.`;

    const userPrompt = `Country: ${country} (${code})${dataSection}`;

    const groqRes = await fetch(GROQ_API_URL, {
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
        temperature: 0.4,
        max_tokens: 500,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error('[CountryIntel] Groq error:', groqRes.status, errText);
      return new Response(JSON.stringify({ error: 'AI service error', fallback: true }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const groqData = await groqRes.json();
    const brief = groqData.choices?.[0]?.message?.content || '';

    const result = {
      brief,
      country,
      code,
      model: MODEL,
      generatedAt: new Date().toISOString(),
    };

    // Cache result
    if (redisClient && brief) {
      try {
        await redisClient.set(cacheKey, result, { ex: CACHE_TTL_SECONDS });
        console.log('[CountryIntel] Cached:', code);
      } catch (e) {
        console.warn('[CountryIntel] Cache write error:', e.message);
      }
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[CountryIntel] Error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
