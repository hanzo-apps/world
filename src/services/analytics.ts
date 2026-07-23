// Per-org analytics + insights read plane — the caller's OWN event-platform data.
//
// Org-scoped, REAL, bearer-authenticated: these call api.hanzo.ai's native
// analytics subsystem (cloud/clients/analytics) DIRECTLY with the caller's IAM
// bearer via org-scope.scopedHeaders(). The org is pinned SERVER-SIDE from the
// validated token's owner claim (principal.Org) — never a client header — exactly
// like getMyBilling, so a token can only ever read its own org's data. Every
// function returns null when signed out or on any upstream failure, so the panels
// degrade cleanly (honest-empty), never fabricated numbers.
//
// Two live surfaces over ONE warehouse (the `hanzo` datastore), verified live:
//
//  1. ANALYTICS (/v1/analytics/*) — the aggregated read lens:
//       GET /v1/analytics/overview     per-org KPIs (llm real; web/commerce honest-empty)
//       GET /v1/analytics/timeseries   requests/tokens/spend over time (hour|day buckets)
//       GET /v1/analytics/top          top models (real) + top products (honest-empty)
//
//  2. INSIGHTS (/v1/insights/*) — the product-analytics event stream:
//       GET /v1/insights/events        recent per-org events (newest first, limit<=200)
//
// Shapes mirror cloud/clients/analytics/query.go (Overview/Timeseries/Top) and
// insights.go (the events read). The window grammar is range=24h|7d|30d|custom.

import { getToken } from './iam';
import { apiBase, scopedHeaders } from './org-scope';

/** GET an org-scoped api.hanzo.ai path with the caller's bearer + org/project
 * headers. null when signed out or on any failure — the panel then degrades. */
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

// ── /v1/analytics/overview ────────────────────────────────────────────────────

export interface AnalyticsScope {
  org: string;
}

/** LLM lens — REAL per-org KPIs from the live usage ledger (hanzo.cloud_usage). */
export interface AnalyticsLLM {
  available: boolean;
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  spendCents: number;
  models: number;
  providers: number;
  errors: number;
  errorRate: number; // 0..1
  source: string;
}

/** Web lens over hanzo.events — honest-empty (available:false) until the collector emits. */
export interface AnalyticsWeb {
  available: boolean;
  reason?: string;
  pageviews: number;
  visitors: number;
  sessions: number;
  source: string;
}

/** Commerce lens over hanzo.events — honest-empty until commerce emits order events. */
export interface AnalyticsCommerce {
  available: boolean;
  reason?: string;
  orders: number;
  revenue: number;
  aov: number;
  source: string;
}

export interface AnalyticsOverview {
  range: string;
  start: string;
  end: string;
  interval: string;
  scope: AnalyticsScope;
  llm: AnalyticsLLM;
  web: AnalyticsWeb;
  commerce: AnalyticsCommerce;
}

/** The caller's per-org analytics KPIs over `range` (default 24h). null if signed out. */
export function getAnalyticsOverview(range = '24h'): Promise<AnalyticsOverview | null> {
  return authedGet<AnalyticsOverview>(`/v1/analytics/overview?range=${encodeURIComponent(range)}`);
}

// ── /v1/analytics/timeseries ──────────────────────────────────────────────────

export interface AnalyticsSeriesPoint {
  t: string; // RFC3339 bucket start (UTC)
  requests: number;
  tokens: number;
  spendCents: number;
}

export interface AnalyticsTimeseries {
  range: string;
  start: string;
  end: string;
  interval: string;
  scope: AnalyticsScope;
  series: AnalyticsSeriesPoint[];
  source: string;
}

/** Gap-filled requests/tokens/spend series over `range`. null if signed out. */
export function getAnalyticsTimeseries(range = '24h'): Promise<AnalyticsTimeseries | null> {
  return authedGet<AnalyticsTimeseries>(`/v1/analytics/timeseries?range=${encodeURIComponent(range)}`);
}

// ── /v1/analytics/top ─────────────────────────────────────────────────────────

export interface AnalyticsModelRow {
  model: string;
  provider: string;
  requests: number;
  tokens: number;
  spendCents: number;
  pct: number; // share of total spend, 0..100
}

export interface AnalyticsTopModels {
  available: boolean;
  items: AnalyticsModelRow[];
  source: string;
}

export interface AnalyticsProductRow {
  productId: string;
  orders: number;
  revenue: number;
  units: number;
}

export interface AnalyticsTopProducts {
  available: boolean;
  reason?: string;
  items: AnalyticsProductRow[];
  source: string;
}

export interface AnalyticsTop {
  range: string;
  start: string;
  end: string;
  scope: AnalyticsScope;
  models: AnalyticsTopModels;
  products: AnalyticsTopProducts;
}

/** Top models (real) + top products (honest-empty) over `range`. null if signed out. */
export function getAnalyticsTop(range = '24h', limit = 8): Promise<AnalyticsTop | null> {
  return authedGet<AnalyticsTop>(
    `/v1/analytics/top?range=${encodeURIComponent(range)}&limit=${encodeURIComponent(String(limit))}`,
  );
}

// ── /v1/insights/events ───────────────────────────────────────────────────────

export interface InsightsEvent {
  id: string;
  timestamp: string; // RFC3339 (UTC)
  event: string;
  type: string;
  distinctId: string;
  sessionId?: string;
  product?: string;
  url?: string;
  path?: string;
  properties?: unknown;
}

/** The caller's most-recent product-analytics events (newest first, limit<=200).
 * null if signed out or on failure; [] is the honest "captured nothing yet" state. */
export async function getInsightsEvents(limit = 200): Promise<InsightsEvent[] | null> {
  const r = await authedGet<{ data?: InsightsEvent[] }>(
    `/v1/insights/events?limit=${encodeURIComponent(String(limit))}`,
  );
  if (!r) return null;
  return r.data ?? [];
}
