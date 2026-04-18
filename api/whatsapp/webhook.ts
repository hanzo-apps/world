/**
 * WhatsApp Cloud API webhook handler.
 *
 * GET  /api/whatsapp/webhook — Meta verification challenge
 * POST /api/whatsapp/webhook — Incoming messages
 *
 * Uses Claude to classify user intent:
 *   subscribe/start    → save phone to Convex notification channel
 *   schedule config    → set digest settings via Convex relay
 *   stop/unsubscribe   → remove channel
 *   world events query → answer from Upstash cached intelligence data
 *
 * Auth: Meta webhook verification via WHATSAPP_VERIFY_TOKEN.
 * Convex relay via RELAY_SHARED_SECRET (same pattern as notification-channels.ts).
 */

export const config = { runtime: 'edge' };

import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const RELAY_SHARED_SECRET = process.env.RELAY_SHARED_SECRET ?? '';
const CONVEX_SITE_URL =
  process.env.CONVEX_SITE_URL ??
  (process.env.CONVEX_URL ?? '').replace('.convex.cloud', '.convex.site');
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL ?? '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function convexRelay(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${CONVEX_SITE_URL}/relay/notification-channels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RELAY_SHARED_SECRET}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const resp = await fetch(
    `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'User-Agent': 'worldmonitor-edge/1.0',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    console.error(`[whatsapp-webhook] sendMessage failed: ${resp.status} ${err}`);
  }
}

async function readUpstashKey(key: string): Promise<unknown> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const resp = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { result?: string };
    if (!data.result) return null;
    return JSON.parse(data.result);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Intent classification via Claude
// ---------------------------------------------------------------------------

interface ClassifiedIntent {
  intent: 'subscribe' | 'configure_schedule' | 'unsubscribe' | 'question';
  digestHour?: number;      // 0-23, only for configure_schedule
  digestMode?: string;      // daily | twice_daily | weekly
  query?: string;           // rephrased question for world events
}

const CLASSIFY_SYSTEM = `You classify WhatsApp messages from Hanzo World users.
Return ONLY valid JSON — no markdown fences, no explanation.

Schema: {"intent":"subscribe"|"configure_schedule"|"unsubscribe"|"question","digestHour":number|null,"digestMode":"daily"|"twice_daily"|"weekly"|null,"query":string|null}

Rules:
- "subscribe", "start", "join", "sign up", "hello", "hi" → subscribe
- "stop", "unsubscribe", "quit", "cancel", "leave" → unsubscribe
- Messages about scheduling ("daily at 8am", "morning brief", "send at 6pm", "twice daily", "weekly") → configure_schedule. Parse the hour in 24h format. Default digestMode to "daily" if not specified.
- Everything else → question. Set query to a clean rephrasing of their question.`;

async function classifyIntent(text: string): Promise<ClassifiedIntent> {
  if (!ANTHROPIC_API_KEY) {
    return { intent: 'question', query: text };
  }
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    system: CLASSIFY_SYSTEM,
    messages: [{ role: 'user', content: text }],
  });
  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  try {
    return JSON.parse(raw) as ClassifiedIntent;
  } catch {
    return { intent: 'question', query: text };
  }
}

// ---------------------------------------------------------------------------
// World events brief via Claude + cached data
// ---------------------------------------------------------------------------

async function answerWorldQuestion(query: string): Promise<string> {
  const [riskScores, headlines, forecasts] = await Promise.all([
    readUpstashKey('risk:scores:sebuf:stale:v1'),
    readUpstashKey('news:insights:v1'),
    readUpstashKey('forecast:predictions:v2'),
  ]);

  const contextParts: string[] = [];
  if (riskScores) contextParts.push(`Risk scores: ${JSON.stringify(riskScores).slice(0, 2000)}`);
  if (headlines) contextParts.push(`Headlines: ${JSON.stringify(headlines).slice(0, 2000)}`);
  if (forecasts) contextParts.push(`Forecasts: ${JSON.stringify(forecasts).slice(0, 1000)}`);

  const systemPrompt = `You are Hanzo World, a concise intelligence analyst on WhatsApp.
Answer in 1-3 short paragraphs. Use plain text, no markdown. Be factual and cite data when available.
Current UTC time: ${new Date().toISOString()}

${contextParts.length > 0 ? 'Live intelligence data:\n' + contextParts.join('\n\n') : 'No live data available — answer from general knowledge and note the limitation.'}`;

  if (!ANTHROPIC_API_KEY) {
    return 'Hanzo World is temporarily unable to process queries. Please try again later.';
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: 'user', content: query }],
  });

  return msg.content[0]?.type === 'text'
    ? msg.content[0].text
    : 'Unable to generate a response.';
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

// WhatsApp phone numbers are used as pseudo user IDs for channel storage.
// The userId format is "wa:<phone>" to namespace them from Clerk user IDs.
function waUserId(phone: string): string {
  return `wa:${phone}`;
}

async function handleSubscribe(phone: string): Promise<string> {
  if (!CONVEX_SITE_URL || !RELAY_SHARED_SECRET) {
    return 'Service temporarily unavailable. Please try again later.';
  }
  const userId = waUserId(phone);
  const resp = await convexRelay({
    action: 'set-channel',
    userId,
    channelType: 'whatsapp',
    phoneNumber: phone,
  });
  if (!resp.ok) {
    console.error(`[whatsapp-webhook] subscribe relay error: ${resp.status}`);
    return 'Failed to subscribe. Please try again.';
  }
  return 'Welcome to Hanzo World! You will receive intelligence briefs here.\n\nCommands:\n- "daily at 8am" to set your brief schedule\n- "stop" to unsubscribe\n- Ask any question about world events';
}

async function handleConfigureSchedule(
  phone: string,
  digestMode: string,
  digestHour: number | undefined,
): Promise<string> {
  if (!CONVEX_SITE_URL || !RELAY_SHARED_SECRET) {
    return 'Service temporarily unavailable. Please try again later.';
  }
  const VALID_MODES = new Set(['daily', 'twice_daily', 'weekly']);
  const mode = VALID_MODES.has(digestMode) ? digestMode : 'daily';
  const hour = typeof digestHour === 'number' && digestHour >= 0 && digestHour <= 23
    ? digestHour
    : 8;

  const userId = waUserId(phone);

  // Ensure channel exists first
  await convexRelay({
    action: 'set-channel',
    userId,
    channelType: 'whatsapp',
    phoneNumber: phone,
  });

  const resp = await convexRelay({
    action: 'set-digest-settings',
    userId,
    variant: 'default',
    digestMode: mode,
    digestHour: hour,
    digestTimezone: 'UTC',
  });

  if (!resp.ok) {
    console.error(`[whatsapp-webhook] schedule relay error: ${resp.status}`);
    return 'Failed to update schedule. Please try again.';
  }

  const hourStr = hour.toString().padStart(2, '0');
  const modeLabel = mode === 'twice_daily' ? 'twice daily' : mode;
  return `Brief schedule updated: ${modeLabel} at ${hourStr}:00 UTC.`;
}

async function handleUnsubscribe(phone: string): Promise<string> {
  if (!CONVEX_SITE_URL || !RELAY_SHARED_SECRET) {
    return 'Service temporarily unavailable. Please try again later.';
  }
  const userId = waUserId(phone);
  const resp = await convexRelay({
    action: 'delete-channel',
    userId,
    channelType: 'whatsapp',
  });
  if (!resp.ok) {
    console.error(`[whatsapp-webhook] unsubscribe relay error: ${resp.status}`);
    return 'Failed to unsubscribe. Please try again.';
  }
  return 'You have been unsubscribed from Hanzo World briefs. Send "start" to re-subscribe.';
}

// ---------------------------------------------------------------------------
// Meta webhook payload types
// ---------------------------------------------------------------------------

interface WhatsAppWebhookEntry {
  changes?: Array<{
    value?: {
      messages?: Array<{
        from?: string;
        type?: string;
        text?: { body?: string };
        timestamp?: string;
      }>;
    };
  }>;
}

interface WhatsAppWebhookPayload {
  object?: string;
  entry?: WhatsAppWebhookEntry[];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: Request): Promise<Response> {
  // GET: Meta webhook verification
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('Forbidden', { status: 403 });
  }

  // POST: Incoming messages
  if (req.method === 'POST') {
    // Meta requires 200 within a few seconds; process async.
    // Parse first, return 200, then handle.
    let payload: WhatsAppWebhookPayload;
    try {
      payload = (await req.json()) as WhatsAppWebhookPayload;
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    if (payload.object !== 'whatsapp_business_account') {
      return json({ ok: true }, 200);
    }

    // Extract first text message (Meta batches but typically sends one)
    let from: string | undefined;
    let text: string | undefined;
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          if (msg.type === 'text' && msg.from && msg.text?.body) {
            from = msg.from;
            text = msg.text.body.trim();
            break;
          }
        }
        if (from) break;
      }
      if (from) break;
    }

    if (!from || !text) {
      return json({ ok: true }, 200);
    }

    // Validate phone number format (E.164 digits only)
    if (!/^\d{7,15}$/.test(from)) {
      return json({ ok: true }, 200);
    }

    // Guard: require env vars for processing
    if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
      console.error('[whatsapp-webhook] WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set');
      return json({ ok: true }, 200);
    }

    // Cap input length to prevent abuse
    const userText = text.slice(0, 500);

    try {
      const classified = await classifyIntent(userText);
      let reply: string;

      switch (classified.intent) {
        case 'subscribe':
          reply = await handleSubscribe(from);
          break;
        case 'configure_schedule':
          reply = await handleConfigureSchedule(
            from,
            classified.digestMode ?? 'daily',
            classified.digestHour,
          );
          break;
        case 'unsubscribe':
          reply = await handleUnsubscribe(from);
          break;
        case 'question':
          reply = await answerWorldQuestion(classified.query ?? userText);
          break;
        default:
          reply = 'Send "start" to subscribe, or ask a question about world events.';
      }

      await sendWhatsAppMessage(from, reply);
    } catch (err) {
      console.error('[whatsapp-webhook] processing error:', err);
      // Best-effort error reply
      await sendWhatsAppMessage(from, 'Something went wrong. Please try again.').catch(() => {});
    }

    return json({ ok: true }, 200);
  }

  return json({ error: 'Method not allowed' }, 405);
}
