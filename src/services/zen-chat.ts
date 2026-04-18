/**
 * Zen chat client — talks to /v1/world/chat, which proxies to
 * https://api.hanzo.ai/v1/chat/completions with the user's IAM bearer.
 *
 * The server injects world-map context (lat, lon, zoom, active layers)
 * as a system message so the model can answer location-grounded questions.
 */

import { getAccessToken } from './iam';

const WORLD_API_BASE = (typeof import.meta !== 'undefined'
  && import.meta.env?.VITE_WORLD_API_BASE) as string | undefined
  || '';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface MapContext {
  lat?: number;
  lon?: number;
  zoom?: number;
  layers?: string[];
  variant?: string;
}

export interface ZenChatRequest {
  messages: ChatMessage[];
  model?: string;
  mapContext?: MapContext;
  temperature?: number;
  maxTokens?: number;
}

export interface ZenChatStreamEvent {
  delta?: string;
  done?: boolean;
  error?: string;
  meta?: Record<string, unknown>;
}

/**
 * Send a chat message. Returns an async iterable of SSE events from the
 * /v1/world/chat endpoint. Caller consumes `delta` strings to render
 * the streamed response and halts on `done` or `error`.
 */
export async function* streamChat(req: ZenChatRequest): AsyncIterable<ZenChatStreamEvent> {
  const token = getAccessToken();
  if (!token) {
    yield { error: 'Not signed in' };
    return;
  }

  const res = await fetch(`${WORLD_API_BASE}/v1/world/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(req),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    yield { error: `Chat failed: ${res.status} ${text}` };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = chunk.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        yield JSON.parse(payload) as ZenChatStreamEvent;
      } catch {
        // skip malformed event
      }
    }
  }
}

/** Non-streaming helper: concatenate all deltas into a single string. */
export async function chatOnce(req: ZenChatRequest): Promise<string> {
  let out = '';
  for await (const ev of streamChat(req)) {
    if (ev.error) throw new Error(ev.error);
    if (ev.delta) out += ev.delta;
    if (ev.done) break;
  }
  return out;
}
