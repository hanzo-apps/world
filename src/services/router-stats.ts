// Enso Live Training — the learned-router training/telemetry aggregate.
//
// PUBLIC platform aggregate, served same-origin through world's Go proxy
// (/v1/world/cloud/router-stats → ai gateway /v1/router/stats?scope=platform),
// exactly like the other /v1/world/cloud/* excitement-layer feeds. Platform
// scope is aggregates only (NO absolute spend) and every routing arm is already
// opaque "arm-N" upstream, so NO vendor name (claude/gpt/deepseek) is ever
// present on this surface. The upstream API base is configured server-side
// (HANZO_API_BASE, default https://api.hanzo.ai); the client only ever talks to
// the same-origin proxy.

export interface RouterWindow {
  since: string;
  until: string;
  events: number;
}

export interface RouterCost {
  saved_pct: number;
  cumulative_saved_index: number;
  baseline_model: string;
  priced_events: number;
}

export interface RouterQuality {
  reward_rate: number;
  rewarded_events: number;
  engine_share: number;
  avg_confidence: number;
  shadow_agreement: number | null;
}

export interface RouterTask {
  events: number;
  models: Record<string, number>;
}

export interface RouterThroughput {
  per_hour: number[];
  total_window: number;
}

export interface RouterRetrain {
  version: string;
  trained_time: string;
  events: number;
  gate_passed: boolean;
  published: boolean;
  gate_kind: string;
  gate_metric: string;
  gate_value: number;
  gate_base: number;
  note: string;
}

export interface RouterStats {
  scope: string;
  /** Set by the proxy when the upstream is unreachable — a well-formed but empty
   * payload. The panel treats it as "connecting…" and never renders its zeros. */
  unavailable?: boolean;
  window: RouterWindow;
  cost: RouterCost;
  quality: RouterQuality;
  by_task: Record<string, RouterTask>;
  by_model: Record<string, number>;
  throughput: RouterThroughput;
  retrain: RouterRetrain | null;
}

/**
 * Public platform router-stats (same-origin proxy). Throws on any non-2xx or
 * network/parse failure so the panel can render its honest "connecting…" state
 * rather than fabricated numbers.
 */
export async function getRouterStats(hours = 24): Promise<RouterStats> {
  const res = await fetch(`/v1/world/cloud/router-stats?hours=${encodeURIComponent(hours)}`);
  if (!res.ok) throw new Error(`router-stats HTTP ${res.status}`);
  return (await res.json()) as RouterStats;
}
