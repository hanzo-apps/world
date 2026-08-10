// Enso flywheel — the router self-improvement loop, read from our same-origin
// /v1/world/enso-training. It folds the routing-decision ledger tail + reward
// tail (super-admin, server-side) with the latest enso-bench eval scores
// (embedded snapshot or a live ENSO_BENCH_URL). The eval scores are always
// present; `state` says which live sources resolved:
//   - "live"    — ledger + rewards folded
//   - "partial" — service token set but the ledger was unreachable
//   - "demo"    — no service token; eval scores only
// The service bearer never reaches the browser — this endpoint is same-origin.

export interface EnsoBucket {
  label: string;
  count: number;
}

export interface EnsoCount {
  name: string;
  count: number;
}

export interface EnsoLedger {
  available: boolean;
  total: number;
  /** Decision-provenance histogram, descending — the whole mix, not one bucket. */
  bySource: EnsoCount[];
  rewarded: number;
  avgReward: number;
  avgConfidence: number;
  confidence: EnsoBucket[];
  tasks: EnsoCount[];
  models: EnsoCount[];
}

/**
 * The decision mix as one headline tile: the leading source, the share of
 * decisions it took, and the runner-up. Reporting the mix rather than one
 * named bucket keeps the tile honest whichever strategy happens to lead.
 */
export function sourceMix(l: EnsoLedger): { value: string; label: string; sub?: string } {
  const [top, next] = l.bySource ?? [];
  if (!top || !l.total) return { value: '—', label: 'decision source' };
  return {
    value: `${Math.round((top.count / l.total) * 100)}%`,
    label: top.name,
    sub: next ? `then ${next.name} ${next.count}` : undefined,
  };
}

export interface EnsoEvalRow {
  system: string;
  accuracyPct: number;
  stderrPct: number;
  n: number;
  usdEst: number;
}

export interface EnsoEvals {
  bench: string;
  source: string; // "embedded" | "live"
  systems: EnsoEvalRow[];
}

export interface EnsoEvent {
  type: string; // "eval" | "ledger" | "reward" (retrain/deploy slot in later)
  at: string;
  label: string;
  value?: number;
}

export interface EnsoTraining {
  state: 'live' | 'partial' | 'demo';
  updatedAt: string;
  window: string;
  since: string;
  ledger: EnsoLedger;
  evals: EnsoEvals;
  events: EnsoEvent[];
}

/** The flywheel fold (same-origin). Throws only on hard network/parse failure. */
export async function getEnsoTraining(): Promise<EnsoTraining> {
  const res = await fetch('/v1/world/enso-training');
  if (!res.ok) throw new Error(`enso-training HTTP ${res.status}`);
  return (await res.json()) as EnsoTraining;
}
