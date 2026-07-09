// Admin Cloud console data — the sensitive, operator-only aggregates served by
// the world backend at same-origin /v1/world/cloud/*. Every admin call attaches
// the caller's IAM bearer; the backend verifies owner==admin (fail-closed 403)
// and forwards the bearer to api.hanzo.ai, where cloud re-verifies. A non-admin
// or signed-out caller gets null and the panels render a clean "admin only"
// state — the client mirror of the server gate.
//
// The one PUBLIC datum here (getCloudModels) needs no auth: real served-model
// scale for the customer-facing view.

import { getToken } from './iam';

/** Same-origin GET with the caller's bearer. null on 401/403/any failure. */
async function adminGet<T>(path: string): Promise<T | null> {
  const tok = await getToken();
  if (!tok) return null;
  try {
    const res = await fetch(path, { headers: { Authorization: `Bearer ${tok}` } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── public: models catalog ───────────────────────────────────────────────────

export interface PublicModel {
  id: string;
  name: string;
  provider: string;
  tier: string;
  context: number;
  inPrice: number;
  outPrice: number;
}

export interface CloudModels {
  updatedAt: string;
  totalModels: number;
  zenModels: number;
  cloudRegions: number;
  cloudPlans: number;
  families: string[];
  models: PublicModel[];
}

export async function getCloudModels(): Promise<CloudModels | null> {
  try {
    const res = await fetch('/v1/world/cloud/models');
    if (!res.ok) return null;
    return (await res.json()) as CloudModels;
  } catch {
    return null;
  }
}

// ── admin: fleet (grouped by provider/region) ────────────────────────────────

export interface FleetMachineRow {
  id: string;
  name: string;
  type: string;
  status: string;
  gpuModel: string;
  gpus: number;
  vram: string;
  os: string;
}
export interface FleetRegionGroup {
  region: string;
  gpus: number;
  machines: FleetMachineRow[];
}
export interface FleetProviderGroup {
  provider: string;
  machines: number;
  online: number;
  gpus: number;
  regions: FleetRegionGroup[];
}
export interface FleetWorker {
  id: string;
  hostname: string;
  provider: string;
  location: string;
  status: string;
  gpu: string;
  vram: string;
  capabilities: string[];
  version: string;
}
export interface CloudFleet {
  available: boolean;
  updatedAt: string;
  note: string;
  utilNote: string;
  totals: { machines: number; online: number; gpus: number; providers: number; regions: number };
  providers: FleetProviderGroup[];
  workers: FleetWorker[];
}

export const getCloudFleet = (): Promise<CloudFleet | null> => adminGet<CloudFleet>('/v1/world/cloud/fleet');

// ── admin: per-service status + metrics ──────────────────────────────────────

export interface ServiceRow {
  product: string;
  up: boolean;
  latencyMs: number;
  deployments: number;
  deploymentsUp: number;
  requests: number;
  errors: number;
  errorRate: number;
  p95Ms: number;
  instrumented: boolean;
  source: string;
}
export interface CloudServices {
  available: boolean;
  updatedAt: string;
  note: string;
  window: string;
  total: number;
  up: number;
  services: ServiceRow[];
}

export const getCloudServices = (): Promise<CloudServices | null> => adminGet<CloudServices>('/v1/world/cloud/services');

// ── admin: web analytics (Umami / analytics.hanzo.ai) ────────────────────────

export interface AnalyticsMetric { x: string; y: number }
export interface AnalyticsSite { name: string; domain: string; pageviews: number; visitors: number; active: number }
export interface CloudAnalytics {
  available: boolean;
  updatedAt: string;
  note: string;
  window: string;
  pageviews: number;
  visitors: number;
  activeNow: number;
  sites: AnalyticsSite[];
  topPages: AnalyticsMetric[];
  topReferrers: AnalyticsMetric[];
  topCountries: AnalyticsMetric[];
}

export const getCloudAnalytics = (): Promise<CloudAnalytics | null> => adminGet<CloudAnalytics>('/v1/world/cloud/analytics');

// ── admin: LLM observability (per-model, per-org, RED) ───────────────────────

export interface LlmTopOrg { org: string; requests: number; tokens: number; costCents: number }
export interface LlmTopModel { model: string; requests: number; tokens: number; costCents: number }
export interface LlmTopService { service: string; requests: number; errorRate: number; latencyP95Ms: number }
export interface LlmTotals {
  requests: number; tokens: number; costCents: number; errors: number; orgs: number; models: number;
  traceCount: number; latencyP50Ms: number; latencyP95Ms: number; latencyP99Ms: number; traceErrorRate: number; services: number;
}
export interface LlmSeriesPoint { ts: string; requests: number; tokens: number; costCents: number; errors: number }
export interface CloudLLM {
  available: boolean;
  updatedAt: string;
  range: string;
  note?: string;
  data?: {
    totals: LlmTotals;
    series: LlmSeriesPoint[];
    topOrgs: LlmTopOrg[];
    topModels: LlmTopModel[];
    topServices: LlmTopService[];
  };
}

export const getCloudLLM = (range = '24h'): Promise<CloudLLM | null> =>
  adminGet<CloudLLM>(`/v1/world/cloud/llm?range=${encodeURIComponent(range)}`);
