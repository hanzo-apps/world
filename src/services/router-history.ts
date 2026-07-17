// Router flywheel history — the "getting smarter over time" investor/customer story.
// Reads the same-origin proxy /v1/world/cloud/router-history (→ ai's public
// /v1/router/history?scope=platform). Aggregates only: daily reward-rate + cumulative
// cost-saved + adoption + the retrain timeline. `unavailable:true` (or a null fetch)
// is the HONEST empty state — the charts render flat/empty and grow with real data;
// we never fabricate a curve.

export interface RouterDaily {
  date: string; // YYYY-MM-DD (UTC)
  events: number;
  reward_rate: number;
  rewarded_events: number;
  cost_saved_index: number;
  cumulative_cost_saved: number;
  engine_share: number;
  by_task: Record<string, number>;
}

export interface RouterRetrain {
  date: string;
  version: string;
  trained_time: string;
  holdout_accuracy?: number;
  gate_metric: string;
  gate_value: number;
  gate_base: number;
  gate_pass: boolean;
  published: boolean;
  events: number;
}

export interface RouterHistory {
  scope: string;
  unavailable?: boolean;
  window: { since: string; until: string; days: number };
  daily: RouterDaily[];
  retrains: RouterRetrain[];
  totals: { events: number; cumulative_cost_saved: number; reward_rate: number; days_active: number };
}

/** GET the flywheel history. Resolves to null on any HTTP/network/parse error. */
export async function getRouterHistory(days = 30): Promise<RouterHistory | null> {
  try {
    const res = await fetch(`/v1/world/cloud/router-history?days=${days}`);
    if (!res.ok) return null;
    return (await res.json()) as RouterHistory;
  } catch {
    return null;
  }
}
