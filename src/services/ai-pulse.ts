// AI Compute pulse — the live inference-plane feed for the AI variant
// (world.hanzo.ai/?variant=ai). Same honest platform aggregate as cloud-pulse.ts,
// reshaped compute-first and delivered over SSE.
//
// TWO transports, ONE seam (mirrors cloud-pulse.ts):
//   - streamAiPulse() opens an EventSource on our same-origin /v1/world/ai-pulse
//     and receives typed frames — `usage` (tokens/s, req/s, spend, top models),
//     `fleet` (gpu/machine/region counts) and `status` (honest live/unavailable
//     state). It returns an unsubscribe. The service bearer stays server-side; the
//     browser only ever talks to our own origin.
//   - getAiPulse() GETs the same route as a plain request and receives ONE JSON
//     snapshot of the same shape — the poll fallback when SSE is unavailable.
//
// Honesty: state is "unavailable" (with a reason) when no service token is wired
// or the upstream is unreachable — the panel says so rather than paint a zero.

import { getToken } from './iam';

function num(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

export interface AiModel {
  id: string;
  name: string;
  requests24h: number;
  tokens24h: number;
  share: number;
}

export interface AiUsage {
  window: string;
  requestsPerSec: number;
  tokensPerSec: number;
  requests24h: number;
  tokens24h: number;
  spendCents: number;
  models: AiModel[];
}

export interface AiFleet {
  machines: number;
  machinesOnline: number;
  gpus: number;
  regions: number;
  modelsServed: number;
}

export interface AiPulse {
  state: 'live' | 'unavailable' | 'connecting';
  reason?: string;
  updatedAt?: string;
  usage: AiUsage | null;
  fleet: AiFleet | null;
}

export interface AiPulseHandlers {
  onUsage(u: AiUsage): void;
  onFleet(f: AiFleet): void;
  onStatus(state: string, reason?: string): void;
  /** SSE dropped or is unsupported — the caller should fall back to polling. */
  onError(): void;
}

function normalizeUsage(o: Record<string, unknown>): AiUsage {
  const models = Array.isArray(o.models) ? (o.models as Record<string, unknown>[]) : [];
  return {
    window: typeof o.window === 'string' ? o.window : '24h',
    requestsPerSec: num(o.requestsPerSec),
    tokensPerSec: num(o.tokensPerSec),
    requests24h: num(o.requests24h),
    tokens24h: num(o.tokens24h),
    spendCents: num(o.spendCents),
    models: models.map((m) => ({
      id: typeof m.id === 'string' ? m.id : '',
      name: typeof m.name === 'string' ? m.name : typeof m.id === 'string' ? m.id : '',
      requests24h: num(m.requests24h),
      tokens24h: num(m.tokens24h),
      share: num(m.share),
    })),
  };
}

function normalizeFleet(o: Record<string, unknown>): AiFleet {
  return {
    machines: num(o.machines),
    machinesOnline: num(o.machinesOnline),
    gpus: num(o.gpus),
    regions: num(o.regions),
    modelsServed: num(o.modelsServed),
  };
}

/** Stream the compute pulse over SSE. Returns an unsubscribe. */
export function streamAiPulse(h: AiPulseHandlers): () => void {
  if (typeof EventSource === 'undefined') {
    h.onError();
    return () => undefined;
  }
  const es = new EventSource('/v1/world/ai-pulse');
  es.onmessage = (e: MessageEvent) => {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(e.data) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (ev.type) {
      case 'usage':
        h.onUsage(normalizeUsage(ev));
        break;
      case 'fleet':
        h.onFleet(normalizeFleet(ev));
        break;
      case 'status':
        h.onStatus(typeof ev.state === 'string' ? ev.state : '', typeof ev.reason === 'string' ? ev.reason : undefined);
        break;
    }
  };
  es.onerror = () => h.onError();
  return () => es.close();
}

/** Poll snapshot (same shape). When signed in we send the caller's bearer, so an
 * admin (z@hanzo.ai) gets the FULL measured compute pulse built server-side with
 * their own token — EventSource can't carry auth, so this is the authed transport.
 * Throws only on network/parse. */
export async function getAiPulse(): Promise<AiPulse> {
  const tok = await getToken();
  const res = await fetch('/v1/world/ai-pulse', tok
    ? { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' }
    : undefined);
  if (!res.ok) throw new Error(`ai-pulse HTTP ${res.status}`);
  const d = (await res.json()) as Record<string, unknown>;
  const state = d.state;
  return {
    state: state === 'live' || state === 'unavailable' ? state : 'unavailable',
    reason: typeof d.reason === 'string' ? d.reason : undefined,
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : undefined,
    usage: d.usage ? normalizeUsage(d.usage as Record<string, unknown>) : null,
    fleet: d.fleet ? normalizeFleet(d.fleet as Record<string, unknown>) : null,
  };
}
