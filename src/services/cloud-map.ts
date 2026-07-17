// Hanzo World cloud map — same-origin /v1/world/cloud/* feeds that back the
// blockchain map layers (chain validator nodes, BYO-GPU fleet, inter-region
// traffic) and the Chains panel. Each fetch is best-effort: on any 404 / network
// / parse failure it resolves to null so the caller keeps an empty layer instead
// of throwing. The Go backend is built to these frozen contracts and may 404 in
// dev until merged.

export interface ChainNode {
  lat: number;
  lon: number;
  city: string;
  kind: string;
}

export interface ChainNetwork {
  id: string;
  name: string;
  chainId: number;
  blockHeight: number;
  peers: number;
  live: boolean;
  nodes: ChainNode[];
}

export interface ChainNodesData {
  updatedAt: string;
  positionsModeled: boolean;
  networks: ChainNetwork[];
}

export interface ByoGpu {
  lat: number;
  lon: number;
  city: string;
  region: string;
  model: string;
  count: number;
  status: string;
}

export interface ByoGpuData {
  updatedAt: string;
  demo: boolean;
  gpus: ByoGpu[];
}

export interface TrafficArc {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  weight: number;
  label: string;
}

export interface TrafficData {
  updatedAt: string;
  demo: boolean;
  arcs: TrafficArc[];
}

/** GET a same-origin JSON path. Resolves to null on any HTTP/network/parse error. */
async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function getChainNodes(): Promise<ChainNodesData | null> {
  return getJson<ChainNodesData>('/v1/world/cloud/chain-nodes');
}

export function getByoGpu(): Promise<ByoGpuData | null> {
  return getJson<ByoGpuData>('/v1/world/cloud/byo-gpu');
}

export function getTraffic(): Promise<TrafficData | null> {
  return getJson<TrafficData>('/v1/world/cloud/traffic');
}

// Native request-geo globe (points + throughput) — the ai backend's own aggregate
// (/v1/traffic/globe), proxied same-origin. Aggregates only: country/region points
// with per-service counts + headline rates, never an IP. `live:false` with an empty
// points array is the HONEST empty state (no traffic yet / release not landed).
export interface TrafficGlobePoint {
  country: string;
  region?: string;
  lat: number;
  lon: number;
  count: number;
  byService: Record<string, number>;
  // Router task classification (code/reasoning/chat/vision/…) for this origin — what
  // customers here are DOING. Present once the ai release with per-geo task recording
  // lands; omitempty until then (the tooltip falls back to byService).
  byTask?: Record<string, number>;
}

export interface TrafficGlobeCountry {
  country: string;
  count: number;
}

export interface TrafficGlobeTotals {
  rps_1m: number;
  rpm_60m: number;
  top_countries: TrafficGlobeCountry[];
}

export interface TrafficGlobeData {
  updatedAt: string;
  live: boolean;
  window: { minutes: number; since: string; until: string };
  points: TrafficGlobePoint[];
  totals: TrafficGlobeTotals;
}

export function getTrafficGlobe(): Promise<TrafficGlobeData | null> {
  return getJson<TrafficGlobeData>('/v1/world/cloud/traffic-globe');
}
