/**
 * AI Analyst — API client + client-side grounding.
 *
 * askAnalyst() forwards the multi-turn conversation to the same-origin backend
 * route, attaching the signed-in user's IAM token so the inference meters to THEIR
 * org/project/billing (no shared key — same pattern as the summarize/classify calls).
 *
 * collectContext() composes a compact grounding snapshot entirely on the client:
 * the current dashboard state (from the AnalystHost) plus a best-effort read of the
 * existing live feeds (top headlines, crypto, macro). There is no server-side data
 * fusion — the panel just hands the model what the user is already looking at.
 */

import { scopedHeaders } from './org-scope';
import type { AnalystAction, AnalystHost } from './analyst-actions';

export interface AnalystMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnalystResponse {
  reply: string;
  actions: AnalystAction[];
  fallback: boolean;
  reason?: string;
}

export async function askAnalyst(messages: AnalystMessage[], context: string): Promise<AnalystResponse> {
  // Bearer + active-org/project selectors: the same-origin backend forwards them
  // to api.hanzo.ai so inference meters to the org the user is acting in.
  const headers = await scopedHeaders({ 'Content-Type': 'application/json' });

  const res = await fetch('/v1/world/analyst', {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages, context }),
  });
  if (!res.ok) throw new Error(`analyst ${res.status}`);

  const data = await res.json();
  return {
    reply: typeof data.reply === 'string' ? data.reply : '',
    actions: Array.isArray(data.actions) ? data.actions : [],
    fallback: !!data.fallback,
    reason: typeof data.reason === 'string' ? data.reason : undefined,
  };
}

export async function collectContext(host: AnalystHost): Promise<string> {
  const parts: string[] = [];

  const st = host.getState();
  parts.push(`Variant: ${st.variant}. Map time range: ${st.timeRange}.`);

  const panels = host.listPanels();
  if (panels.length) {
    parts.push(
      'PANELS (key = name, state):\n' +
        panels.map((p) => `- ${p.key} = ${p.name} (${p.enabled ? 'shown' : 'hidden'})`).join('\n'),
    );
  }

  const layers = host.listLayers();
  if (layers.length) {
    parts.push('MAP LAYERS: ' + layers.map((l) => `${l.key}=${l.on ? 'on' : 'off'}`).join(', '));
  }

  const [headlines, crypto, macro] = await Promise.all([topHeadlines(), cryptoSnapshot(), macroSnapshot()]);
  if (headlines) parts.push('TOP HEADLINES:\n' + headlines);
  if (crypto) parts.push('CRYPTO: ' + crypto);
  if (macro) parts.push('MACRO SIGNALS: ' + macro);

  return parts.join('\n\n');
}

async function topHeadlines(): Promise<string> {
  try {
    const r = await fetch('/v1/world/gdelt-doc?query=world&maxrecords=8');
    if (!r.ok) return '';
    const d = await r.json();
    const arts = Array.isArray(d.articles) ? d.articles : [];
    return arts
      .slice(0, 8)
      .map((a: { title?: string; source?: string }, i: number) => `${i + 1}. ${a.title || ''}${a.source ? ` (${a.source})` : ''}`)
      .filter((s: string) => s.trim().length > 3)
      .join('\n');
  } catch {
    return '';
  }
}

async function cryptoSnapshot(): Promise<string> {
  try {
    const r = await fetch('/v1/world/coingecko?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true');
    if (!r.ok) return '';
    const d = await r.json();
    const one = (id: string, label: string): string => {
      const o = d?.[id];
      if (!o || typeof o.usd !== 'number') return '';
      const chg = typeof o.usd_24h_change === 'number' ? ` (${o.usd_24h_change >= 0 ? '+' : ''}${o.usd_24h_change.toFixed(1)}% 24h)` : '';
      return `${label} $${o.usd.toLocaleString()}${chg}`;
    };
    return [one('bitcoin', 'BTC'), one('ethereum', 'ETH'), one('solana', 'SOL')].filter(Boolean).join(', ');
  } catch {
    return '';
  }
}

async function macroSnapshot(): Promise<string> {
  try {
    const r = await fetch('/v1/world/macro-signals');
    if (!r.ok) return '';
    const d = await r.json();
    if (!d || d.unavailable || !d.verdict) return '';
    const bits = [`verdict ${d.verdict}`];
    if (typeof d.bullishCount === 'number' && typeof d.totalCount === 'number') {
      bits.push(`${d.bullishCount}/${d.totalCount} signals bullish`);
    }
    const fg = d.signals?.fearGreed?.value;
    if (fg != null) bits.push(`fear/greed ${fg}`);
    return bits.join(', ');
  } catch {
    return '';
  }
}
