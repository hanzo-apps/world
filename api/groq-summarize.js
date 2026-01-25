/**
 * Groq API Summarization Endpoint
 * Uses Llama 3.3 70B for fast, high-quality news summarization
 * Free tier: 1,000 requests/day, 6,000 tokens/minute
 */

export const config = {
  runtime: 'edge',
};

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

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

    // Build prompt based on mode
    const headlineText = headlines.slice(0, 8).map((h, i) => `${i + 1}. ${h}`).join('\n');

    let systemPrompt, userPrompt;

    if (mode === 'brief') {
      systemPrompt = 'You are a concise news analyst. Summarize the key themes from news headlines in 2-3 sentences. Focus on the most significant global developments. Be factual and neutral.';
      userPrompt = `Summarize the main themes from these breaking news headlines:\n\n${headlineText}\n\nProvide a 2-3 sentence world brief:`;
    } else if (mode === 'analysis') {
      systemPrompt = 'You are a geopolitical analyst. Analyze news headlines to identify patterns, risks, and implications. Be concise but insightful.';
      userPrompt = `Analyze these news headlines for key patterns and implications:\n\n${headlineText}\n\nProvide a brief analysis (3-4 sentences):`;
    } else {
      systemPrompt = 'You are a news summarizer. Be concise and factual.';
      userPrompt = `Summarize: ${headlineText}`;
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
        max_tokens: 200,
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

    return new Response(JSON.stringify({
      summary,
      model: MODEL,
      provider: 'groq',
      tokens: data.usage?.total_tokens || 0,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=1800', // Cache for 30 min
      },
    });

  } catch (error) {
    console.error('[Groq] Error:', error);
    return new Response(JSON.stringify({ error: error.message, fallback: true }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
