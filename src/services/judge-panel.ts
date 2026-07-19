// Enso Router — the Mean-Field Judge Panel.
//
// PUBLIC platform aggregate, same-origin through world's Go proxy
// (/v1/world/cloud/judge-panel → ai gateway /v1/router/judge-panel?scope=platform),
// exactly like router-stats. A diverse panel of judge models scores routing
// quality; each judge carries a reliability weight, a calibrated mean score and a
// count of scores seen (n). The `benchmark` block is the published rank-corr-with-
// ground-truth result that motivates the panel (mean-field consensus ≫ any single
// judge, which an adversary can wreck).
//
// Never throws: the proxy answers {available:false} on any upstream failure; if the
// route itself is unreachable we degrade to the same empty shape so the panel shows
// its honest "warming up" state rather than erroring.

export interface Judge {
  model: string;
  weight: number; // 0..1 reliability weight
  mean: number;   // calibrated mean score
  n: number;      // scores seen
}

export interface JudgeBenchmark {
  mfjp: number;            // mean-field judge panel
  naiveMean: number;       // unweighted mean of judges
  singleNoisy: number;     // one noisy judge
  singleAdversary: number; // one adversarial judge
}

export interface JudgePanel {
  available: boolean;
  enabled: boolean;
  sampleRate: number;   // fraction (0..1) or percent of traffic scored
  models: string[];
  judges: Judge[];
  benchmark: JudgeBenchmark | null;
}

const EMPTY: JudgePanel = {
  available: false, enabled: false, sampleRate: 0, models: [], judges: [], benchmark: null,
};

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function normalize(raw: unknown): JudgePanel {
  const r = (raw ?? {}) as Record<string, unknown>;
  const judges = Array.isArray(r.judges)
    ? (r.judges as Record<string, unknown>[]).map((j) => ({
        model: String(j.model ?? ''),
        weight: num(j.weight),
        mean: num(j.mean),
        n: Math.round(num(j.n)),
      })).filter((j) => j.model !== '')
    : [];
  const bm = r.benchmark && typeof r.benchmark === 'object'
    ? {
        mfjp: num((r.benchmark as Record<string, unknown>).mfjp),
        naiveMean: num((r.benchmark as Record<string, unknown>).naiveMean),
        singleNoisy: num((r.benchmark as Record<string, unknown>).singleNoisy),
        singleAdversary: num((r.benchmark as Record<string, unknown>).singleAdversary),
      }
    : null;
  return {
    available: r.available === true,
    enabled: r.enabled === true,
    sampleRate: num(r.sampleRate),
    models: Array.isArray(r.models) ? (r.models as unknown[]).map(String) : [],
    judges,
    benchmark: bm,
  };
}

/** The live mean-field judge panel (same-origin proxy). Never throws — returns the
 * empty/unavailable shape so the panel renders its honest "warming up" state. */
export async function getJudgePanel(): Promise<JudgePanel> {
  try {
    const res = await fetch('/v1/world/cloud/judge-panel');
    if (!res.ok) return EMPTY;
    return normalize(await res.json());
  } catch {
    return EMPTY;
  }
}
