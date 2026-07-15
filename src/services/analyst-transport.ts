/**
 * Analyst transport — the ONE seam between the analyst UI and its backend.
 *
 * Everything above this file (AnalystChat, analyst.ts) is transport-agnostic: it
 * builds an AnalystRequest and calls `analystTransport().ask(req)`. Only THIS file
 * knows the wire.
 *
 * TODAY: the sole real transport is HTTP (same-origin POST /v1/world/analyst,
 * forwarding the caller's IAM bearer). It is request/response, no streaming.
 *
 * NATIVE ZAP — honest state (investigated 2026-07):
 *   A browser-usable ZAP client DOES exist: the npm packages `@zap-proto/web`
 *   (`connect(url)` → WebSocket binary ZAP frames) over `@zap-proto/zap`. It is
 *   the sanctioned tRPC replacement and is production-wired in ~/work/hanzo/platform
 *   (`serve()` server + `connect()` client, ~50 capability routers incl. `/zap/ai`).
 *   It is NOT the browser-extension's `shared/zap.ts` (a deprecated tool bridge),
 *   nor the Go/Rust TCP:9999 ZAP (`~/work/hanzo/zap`, not reachable from a page).
 *
 *   Why it is not the default here yet — three concrete, non-hand-wavy gaps:
 *     1. `world` has no `@zap-proto/web`/`@zap-proto/zap` dependency, and world's
 *        backend is Go — there is no ZAP-over-WebSocket *server* harness in world
 *        (platform's `serve()` is TS/Node). Wiring real ZAP needs a `/zap/analyst`
 *        server cap in Go (or routing world's analyst through platform's plane).
 *     2. `@zap-proto/web`'s `Conn.call()` is strict request/response — there is NO
 *        token-streaming primitive today (the existing `ai.analyzeLogs` returns a
 *        single completed message). Streamed analyst tokens can't ride ZAP yet.
 *     3. Auth today is a same-origin session cookie validated at the WS upgrade
 *        (`mintCap(req)→null ⇒ 401`); world forwards an IAM bearer, so the analyst
 *        cap's `mintCap` must accept that bearer (ties into the api.hanzo.ai auth
 *        work). See the transport report for the exact `.zap` + `-cap.ts` steps.
 *
 *   This file is the ONLY place that changes when ZAP lands: publish a browser ZAP
 *   client, then `registerTransport(new ZapTransport(...))` from bootstrap. No fake
 *   frames are shipped here — the seam is real, the ZAP impl is registered when the
 *   dependency and server cap exist.
 */

import { scopedHeaders } from './org-scope';
import type { AnalystMessage } from './analyst';
import type { AnalystAction } from './analyst-actions';
import type { CommandManifestEntry } from './app-commands';

export interface AnalystRequest {
  messages: AnalystMessage[];
  context: string;
  /** The command registry manifest — the backend derives its tool contract from it. */
  commands: CommandManifestEntry[];
  /** Chosen model id (zen5, zen5-flash, …); backend falls back to its default when empty. */
  model?: string;
}

/** One data-tool call the backend ran in its agentic loop, surfaced as a
 *  collapsed trace in the chat so answers visibly cite live data. */
export interface AnalystTrace {
  /** Pre-rendered call, e.g. `world_brief({"n":5})`. */
  label: string;
  ok: boolean;
  /** The (capped) tool result body — shown in the collapsed detail. */
  result: string;
}

export interface AnalystResponse {
  reply: string;
  actions: AnalystAction[];
  fallback: boolean;
  reason?: string;
  /** The model the backend actually served (echoed for the UI). */
  model?: string;
  /** Upstream error detail when the backend degraded — surfaced honestly in the chat. */
  error?: string;
  /** Out-of-credits signal: the backend saw the ONE 402 insufficient_balance
   * contract from the AI gateway and asks the UI to render a wallet top-up CTA. */
  topup?: boolean;
  billingUrl?: string;
  usageUrl?: string;
  /** World MCP data tools the backend called to ground the answer (may be empty). */
  traces: AnalystTrace[];
}

/** Live callbacks for a streaming ask — all cosmetic: the resolved
 *  AnalystResponse (the server's `done` event) stays the source of truth. */
export interface AnalystLiveHandlers {
  /** A new model turn began — any partial text streamed so far belonged to an
   *  intermediate (tool) round and should be cleared. */
  onRound?(): void;
  /** The growing reply text (already unescaped server-side). */
  onDelta?(text: string): void;
  /** Pre-envelope reasoning text (a thinking model working out loud). */
  onThink?(text: string): void;
  /** A data tool just ran server-side. */
  onTool?(trace: AnalystTrace): void;
}

export interface AnalystTransport {
  readonly name: string;
  ask(req: AnalystRequest): Promise<AnalystResponse>;
  /** Streaming ask (SSE). Optional — callers fall back to ask(). */
  askStream?(req: AnalystRequest, live: AnalystLiveHandlers): Promise<AnalystResponse>;
}

// ── HTTP transport (real, default) ───────────────────────────────────────────

function requestBody(req: AnalystRequest): string {
  return JSON.stringify({
    messages: req.messages,
    context: req.context,
    commands: req.commands,
    model: req.model || undefined,
  });
}

const httpTransport: AnalystTransport = {
  name: 'http',
  async ask(req: AnalystRequest): Promise<AnalystResponse> {
    const headers = await scopedHeaders({ 'Content-Type': 'application/json' });
    const res = await fetch('/v1/world/analyst', { method: 'POST', headers, body: requestBody(req) });
    // Read the body even on non-2xx: the backend answers 200 with {fallback,error}
    // for auth/degrade, but a proxy/edge 4xx/5xx must still surface as a message,
    // never a blank chat.
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }
    if (!res.ok && !('reply' in data) && !('error' in data)) {
      return { reply: '', actions: [], fallback: true, error: `HTTP ${res.status}`, traces: [] };
    }
    return normalize(data);
  },

  async askStream(req: AnalystRequest, live: AnalystLiveHandlers): Promise<AnalystResponse> {
    const headers = await scopedHeaders({ 'Content-Type': 'application/json', Accept: 'text/event-stream' });
    const res = await fetch('/v1/world/analyst', { method: 'POST', headers, body: requestBody(req) });
    // Anything that isn't an event stream (older backend, the sign-in gate, the
    // agent path, proxy errors) is exactly the non-streaming contract — reuse it.
    if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream') || !res.body) {
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = {};
      }
      if (!res.ok && !('reply' in data) && !('error' in data)) {
        return { reply: '', actions: [], fallback: true, error: `HTTP ${res.status}`, traces: [] };
      }
      return normalize(data);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let done: AnalystResponse | null = null;
    for (;;) {
      const { value, done: eof } = await reader.read();
      if (eof) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line; each carries one `data:` line.
      let sep;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
        } catch {
          continue;
        }
        switch (ev.type) {
          case 'round':
            live.onRound?.();
            break;
          case 'delta':
            if (typeof ev.text === 'string' && ev.text) live.onDelta?.(ev.text);
            break;
          case 'think':
            if (typeof ev.text === 'string' && ev.text) live.onThink?.(ev.text);
            break;
          case 'tool': {
            const tr = normalizeTraces([ev])[0];
            if (tr) live.onTool?.(tr);
            break;
          }
          case 'done':
            done = normalize(ev);
            break;
        }
      }
      if (done) break;
    }
    void reader.cancel().catch(() => undefined);
    return done ?? { reply: '', actions: [], fallback: true, error: 'stream ended early', traces: [] };
  },
};

function normalize(data: Record<string, unknown>): AnalystResponse {
  return {
    reply: typeof data.reply === 'string' ? data.reply : '',
    actions: Array.isArray(data.actions) ? (data.actions as AnalystAction[]) : [],
    fallback: !!data.fallback,
    reason: typeof data.reason === 'string' ? data.reason : undefined,
    model: typeof data.model === 'string' ? data.model : undefined,
    error: typeof data.error === 'string' && data.error ? data.error : undefined,
    topup: !!data.topup,
    billingUrl: typeof data.billingUrl === 'string' ? data.billingUrl : undefined,
    usageUrl: typeof data.usageUrl === 'string' ? data.usageUrl : undefined,
    traces: normalizeTraces(data.traces),
  };
}

function normalizeTraces(raw: unknown): AnalystTrace[] {
  if (!Array.isArray(raw)) return [];
  const out: AnalystTrace[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    if (typeof r.label !== 'string' || !r.label) continue;
    out.push({ label: r.label, ok: !!r.ok, result: typeof r.result === 'string' ? r.result : '' });
  }
  return out;
}

// ── Transport selection (the one switch point) ───────────────────────────────

let override: AnalystTransport | null = null;

/** Install a non-HTTP transport (e.g. a real ZAP client) from bootstrap. Pass
 *  null to revert to HTTP. This is the ONLY wiring point transports touch. */
export function registerTransport(t: AnalystTransport | null): void {
  override = t;
}

/** The active transport — the registered override, else HTTP. */
export function analystTransport(): AnalystTransport {
  return override ?? httpTransport;
}

/** Human-readable transport verdict for diagnostics / the action log. */
export function describeTransport(): string {
  return `analyst transport: ${analystTransport().name}${override ? '' : ' (ZAP unavailable — see analyst-transport.ts)'}`;
}
