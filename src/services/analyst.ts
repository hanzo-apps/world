/**
 * AI Analyst — request composer + client-side grounding.
 *
 * askAnalyst() builds an AnalystRequest — the conversation, a compact grounding
 * snapshot, the CHOSEN model, and the command-registry manifest (so the backend
 * derives its tool contract from the client's single source of truth) — and hands
 * it to the active transport (analyst-transport.ts). It is transport-agnostic: it
 * does not know or care whether the wire is HTTP or ZAP.
 *
 * collectContext() composes the snapshot entirely on the client: the current
 * dashboard state (from the AppHost) plus a best-effort read of the live feeds
 * (top headlines, crypto, macro). No server-side data fusion — the model gets what
 * the user is already looking at.
 */

import { analystTransport, type AnalystResponse } from './analyst-transport';
import { commandManifest, type AppHost } from './app-commands';

export interface AnalystMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type { AnalystResponse };

/** Ask the analyst. `model` is the user's dropdown choice; the backend falls back
 *  to its default when empty. The command manifest travels with every request. */
export async function askAnalyst(messages: AnalystMessage[], context: string, model?: string): Promise<AnalystResponse> {
  return analystTransport().ask({ messages, context, commands: commandManifest(), model });
}

export async function collectContext(host: AppHost): Promise<string> {
  const parts: string[] = [];

  const st = host.getState();
  const bits = [`Variant: ${st.variant}`, `Map time range: ${st.timeRange}`];
  if (st.mapMode) bits.push(`Map mode: ${st.mapMode}`);
  if (st.region) bits.push(`Region: ${st.region}`);
  if (st.theme) bits.push(`Theme: ${st.theme}`);
  parts.push(bits.join('. ') + '.');

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

  const orgs = host.isAuthed() ? host.listOrgs() : [];
  if (orgs.length > 1) {
    parts.push('ORGS (id = name): ' + orgs.map((o) => `${o.id}=${o.name}`).join(', '));
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
