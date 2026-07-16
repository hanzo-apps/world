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
  engine: number;
  heuristic: number;
  enginePct: number;
  rewarded: number;
  avgReward: number;
  avgConfidence: number;
  confidence: EnsoBucket[];
  tasks: EnsoCount[];
  models: EnsoCount[];
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
