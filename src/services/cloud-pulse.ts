// Hanzo Cloud data plane for SaaS mode (?variant=saas).
//
// TWO honest sources, cleanly separated:
//
//  1. PUBLIC AGGREGATE — getCloudPulse() hits our own same-origin
//     /v1/world/cloud-pulse. It is anonymized platform-wide counts for the
//     signed-out investor view and is DEMO-flagged (`demo:true`) unless a
//     service token is wired server-side. The flag travels in the payload; the
//     UI renders a "demo data" note whenever it is set. We never fake platform
//     numbers silently.
//
//  2. ORG-SCOPED — getMyFleet/getMyModels/getMyBilling call api.hanzo.ai
//     DIRECTLY with the caller's IAM bearer (via org-scope.scopedHeaders). Org
//     is pinned server-side from the token's owner claim (no shared key). These
//     are the user's REAL fleet, models and bill. Every one returns null when
//     signed out or on any upstream failure, so panels degrade cleanly.
//
// Endpoints below were verified against ~/work/hanzo/openapi: /v1/machines +
// /v1/gpus (visor), /v1/models (ai), /v1/billing/balance + /v1/billing/usage
// (billing). No per-model usage time-series or platform request-rate endpoint
// exists publicly — those tiles come from the demo pulse and are flagged.

import { getToken } from './iam';
import { apiBase, scopedHeaders } from './org-scope';

export interface CloudOverview {
  requestsPerSec: number;
  requests24h: number;
  tokens24h: number;
  modelsServed: number;
  nodesOnline: number;
  nodesTotal: number;
  gpusOnline: number;
  regions: number;
  uptimePct: number;
}

export interface CloudModel {
  id: string;
  name: string;
  requests24h: number;
  tokens24h: number;
  share: number;
}

export interface CloudRegion {
  id: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  nodes: number;
  gpus: number;
  status: 'online' | 'degraded' | 'offline' | string;
  requestsPerSec: number;
}

export interface CloudPulse {
  demo: boolean;
  volumeModeled: boolean;
  source: string;
  note: string;
  updatedAt: string;
  window: string;
  overview: CloudOverview;
  requestSeries: number[];
  tokenSeries: number[];
  models: CloudModel[];
  regions: CloudRegion[];
}

/**
 * Platform aggregate (same-origin). When signed in we send the caller's IAM bearer:
 * an admin (z@hanzo.ai / the operator org) then gets the FULL real aggregate fetched
 * server-side with their OWN token (all-org ledger + fleet), served no-store; anyone
 * else gets the cached public teaser. Throws only on hard network/parse failure.
 */
export async function getCloudPulse(): Promise<CloudPulse> {
  const tok = await getToken();
  const res = await fetch('/v1/world/cloud-pulse', tok
    ? { headers: { Authorization: `Bearer ${tok}` }, cache: 'no-store' }
    : undefined);
  if (!res.ok) throw new Error(`cloud-pulse HTTP ${res.status}`);
  return (await res.json()) as CloudPulse;
}

// ── org-scoped (api.hanzo.ai, caller's bearer) ───────────────────────────────

/** GET an org-scoped api.hanzo.ai path with the caller's bearer. null if signed out or on any failure. */
async function authedGet<T>(path: string): Promise<T | null> {
  const tok = await getToken();
  if (!tok) return null;
  try {
    const res = await fetch(`${apiBase()}${path}`, { headers: await scopedHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface Machine {
  id: string;
  name: string;
  region: string;
  type: string;
  status: string;
  provider?: string;
  gpu?: string;
}

export interface Gpu {
  id: string;
  name: string;
  model: string;
  region: string;
  status: string;
}

export interface MyFleet {
  machines: Machine[];
  gpus: Gpu[];
}

/** The caller's real fleet (visor /v1/machines + /v1/gpus). null if signed out. */
export async function getMyFleet(): Promise<MyFleet | null> {
  const [m, g] = await Promise.all([
    authedGet<{ machines?: Machine[] }>('/v1/machines'),
    authedGet<{ gpus?: Gpu[] }>('/v1/gpus'),
  ]);
  if (!m && !g) return null;
  return { machines: m?.machines ?? [], gpus: g?.gpus ?? [] };
}

export interface ServedModel {
  id: string;
  object?: string;
  owned_by?: string;
}

/** Models the caller's org can call (ai /v1/models, OpenAI-compatible). null if signed out. */
export async function getMyModels(): Promise<ServedModel[] | null> {
  const r = await authedGet<{ data?: ServedModel[] }>('/v1/models');
  return r?.data ?? (r ? [] : null);
}

export interface Balance {
  balance: number;   // USD cents
  holds?: number;
  available?: number;
}

export interface UsageRecord {
  transactionId?: string;
  amount: number;    // USD cents
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface MyBilling {
  balance: Balance | null;
  usage: UsageRecord[];
  spend30dCents: number;
}

/** The caller's org balance + last-30d usage ledger (billing). null if signed out. */
export async function getMyBilling(): Promise<MyBilling | null> {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 3600 * 1000);
  const range = `?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;
  const [bal, use] = await Promise.all([
    authedGet<Balance>('/v1/billing/balance'),
    authedGet<{ usage?: UsageRecord[] }>(`/v1/billing/usage${range}`),
  ]);
  if (!bal && !use) return null;
  const usage = use?.usage ?? [];
  const spend30dCents = usage.reduce((sum, u) => sum + (typeof u.amount === 'number' ? u.amount : 0), 0);
  return { balance: bal, usage, spend30dCents };
}

// console.hanzo.ai billing — the full invoice / payment methods live there.
export const CONSOLE_BILLING_URL = 'https://console.hanzo.ai/billing';
