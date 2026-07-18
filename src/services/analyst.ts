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

import { analystTransport, type AnalystLiveHandlers, type AnalystResponse } from './analyst-transport';
import { commandManifest, type AppHost } from './app-commands';
import { fetchWithTimeout } from '@/utils';
import { getTrafficGlobe } from './cloud-map';
import { getCloudPulse, getMyBilling } from './cloud-pulse';
import { getRouterStats } from './router-stats';
import { getEnsoTraining } from './enso-training';

// The grounding snapshot is best-effort garnish. Cap each read so a cold server
// (gdelt-doc can take ~10s cold) never delays the user's chat send.
const SNAPSHOT_TIMEOUT_MS = 2500;

export interface AnalystMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type { AnalystResponse };

/** Ask the analyst. `model` is the user's dropdown choice; the backend falls back
 *  to its default when empty. The command manifest travels with every request.
 *  With `live` handlers the answer STREAMS (SSE) when the transport supports it;
 *  the resolved response is identical either way. */
export async function askAnalyst(
  messages: AnalystMessage[],
  context: string,
  model?: string,
  live?: AnalystLiveHandlers,
): Promise<AnalystResponse> {
  const t = analystTransport();
  const req = { messages, context, commands: commandManifest(), model };
  return live && t.askStream ? t.askStream(req, live) : t.ask(req);
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

  // On the cloud board, ground the model in the LIVE platform metrics too, so it can
  // answer "what's my spend / how many nodes / is Enso saving money" from real data —
  // not just describe which panels exist. Best-effort + parallel with the news feeds.
  const wantCloud = st.variant === 'cloud';
  const [headlines, crypto, macro, cloud] = await Promise.all([
    topHeadlines(),
    cryptoSnapshot(),
    macroSnapshot(),
    wantCloud ? cloudSnapshot() : Promise.resolve(''),
  ]);
  if (cloud) parts.push(cloud);
  if (headlines) parts.push('TOP HEADLINES:\n' + headlines);
  if (crypto) parts.push('CRYPTO: ' + crypto);
  if (macro) parts.push('MACRO SIGNALS: ' + macro);

  return parts.join('\n\n');
}

// Live Hanzo-cloud metrics for the analyst's grounding: traffic, platform 24h, the
// Enso router (cost saved / reward / engine share / models routed), the flywheel
// ledger, and the caller's billing. Each read is best-effort (null on failure) so a
// slow feed never blocks the answer. REAL data only — mirrors the panels verbatim.
async function cloudSnapshot(): Promise<string> {
  const n = (v: number, d = 0): string => (Number.isFinite(v) ? v.toFixed(d) : '0');
  const [traffic, pulse, stats, enso, bill] = await Promise.all([
    getTrafficGlobe().catch(() => null),
    getCloudPulse().catch(() => null),
    getRouterStats(24).catch(() => null),
    getEnsoTraining().catch(() => null),
    getMyBilling().catch(() => null),
  ]);
  const lines: string[] = [];
  if (traffic?.totals) {
    lines.push(`Live traffic: ${n(traffic.totals.rps_1m, 2)} req/s (1m), ${n(traffic.totals.rpm_60m, 1)} req/min (60m avg), ${traffic.points?.length ?? 0} active regions.`);
  }
  if (pulse?.overview) {
    const o = pulse.overview;
    lines.push(`Platform 24h: ${n(o.requests24h)} requests, ${n(o.tokens24h)} tokens, ${n(o.modelsServed)} models served, ${n(o.nodesOnline)} nodes online, ${n(o.gpusOnline)} GPUs, ${n(o.regions)} regions, ${n(o.uptimePct, 2)}% uptime.`);
  }
  if (stats && !stats.unavailable) {
    const models = Object.keys(stats.by_model || {});
    lines.push(`Enso router (24h): cost saved ${n(stats.cost.saved_pct, 1)}% vs premium (baseline ${stats.cost.baseline_model || '—'}), reward rate ${n(stats.quality.reward_rate * 100)}%, engine share ${n(stats.quality.engine_share * 100)}%, avg confidence ${n(stats.quality.avg_confidence * 100)}%${models.length ? `. Models routed: ${models.join(', ')}` : ''}.`);
  }
  if (enso?.ledger?.available) {
    const l = enso.ledger;
    lines.push(`Enso flywheel: ${n(l.total)} routing decisions, ${n(l.enginePct)}% engine-routed (${n(l.heuristic)} heuristic), ${n(l.rewarded)} rewarded, avg confidence ${n(l.avgConfidence, 2)}${l.models?.length ? `. Top models: ${l.models.slice(0, 4).map((m) => `${m.name} ${m.count}`).join(', ')}` : ''}.`);
  }
  if (bill) {
    const bal = bill.balance ? `, $${n(bill.balance.balance / 100, 2)} balance` : '';
    lines.push(`Your billing: $${n(bill.spend30dCents / 100, 2)} spend/30d${bal}, ${bill.usage?.length ?? 0} billable events.`);
  }
  return lines.length ? 'HANZO CLOUD (live):\n' + lines.join('\n') : '';
}

async function topHeadlines(): Promise<string> {
  try {
    const r = await fetchWithTimeout('/v1/world/gdelt-doc?query=world&maxrecords=8', {}, SNAPSHOT_TIMEOUT_MS);
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
    const r = await fetchWithTimeout('/v1/world/coingecko?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true', {}, SNAPSHOT_TIMEOUT_MS);
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
    const r = await fetchWithTimeout('/v1/world/macro-signals', {}, SNAPSHOT_TIMEOUT_MS);
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
