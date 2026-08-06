/**
 * The ONE way this app talks to a model: the Hanzo gateway.
 *
 * Every AI call in world used to go straight to a third party — four files to
 * api.groq.com and one to openrouter.ai, each with its own URL constant, its own
 * upstream key and its own copy of the fetch. That is a competing AI stack
 * running inside a Hanzo surface: the spend is off our books, the traffic is
 * unmetered by our gateway, the prompts leave our infrastructure, and it needs
 * per-provider keys nobody rotates. It also leaked into the product — the widget
 * logged `[Summarization] Groq success` into the console of any page embedding
 * it, which is how it was found.
 *
 * The wire format is identical (OpenAI-compatible chat/completions), so this is
 * a swap of endpoint, credential and model — not a rewrite of any caller's
 * logic. Everything else in world already reaches api.hanzo.ai (analytics,
 * insights, telemetry); the model calls were the one exception.
 */

export const HANZO_API_URL = 'https://api.hanzo.ai/v1/chat/completions';

/**
 * Fast, non-reasoning, in-catalog. The same model Hanzo Chat picked for titles
 * and summaries by direct probe, and the right analogue of the
 * `llama-3.1-8b-instant` these callers used: this is high-throughput
 * classification and summarisation, not reasoning.
 */
export const FAST_MODEL = 'zen5-flash';

/** Missing credential is NOT an error here — every caller already degrades to a
 *  non-AI fallback, and that path is better than a 500. */
export function hanzoKey() {
  return process.env.HANZO_API_KEY || '';
}

/**
 * POST a chat completion to the Hanzo gateway.
 *
 * Returns the raw `Response` so callers keep their own status handling; they
 * differ (some pass the upstream status through, some swallow it into a
 * fallback), and flattening that here would change behaviour rather than
 * relocate it.
 */
export async function hanzoChat({ apiKey, model = FAST_MODEL, messages, temperature = 0, max_tokens, response_format }) {
  return fetch(HANZO_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      ...(max_tokens ? { max_tokens } : {}),
      ...(response_format ? { response_format } : {}),
    }),
  });
}
