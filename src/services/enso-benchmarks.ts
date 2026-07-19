// Enso benchmark suite — the ADMIN-ONLY head-to-head, served same-origin by the
// world backend at /v1/world/enso-benchmarks. Enso is a PRIVATE Hanzo product and
// this data names only Enso's own measured results, so the endpoint is server-gated
// (requireAdmin, fail-closed 403). This client attaches the caller's IAM bearer;
// a non-admin / signed-out caller gets null (401/403) and the panel renders the
// clean "admin only" state — the client mirror of the server gate. The JSON never
// reaches a non-admin: the gate is on the server, not this file.

import { getToken } from './iam';

/** One measured system's row within a bench (accuracy ± stderr + cost). */
export interface BenchSystemRow {
  system: string;
  family: 'enso' | 'arm';
  accuracyPct: number;
  stderrPct: number;
  n: number;
  usdEst: number;
  preflight?: boolean; // n<=1 / preflight run ⇒ not a scored result
}

/** Per-bench measured head-to-head, with the best single arm + Enso-reported. */
export interface BenchTable {
  key: string;
  name: string;
  systems: BenchSystemRow[]; // sorted by accuracy desc
  bestArm: string; // best NON-enso measured arm
  bestArmPct: number;
  ensoPct: number;
  ensoUsd: number;
  ensoReported?: number;
  ensoUltraReported?: number;
  note?: string;
}

export interface AblationArm {
  label: string;
  logic: string;
  accuracyPct: number;
  n: number;
  usdEst: number;
}

/** enso-ultra v1 blind-synthesis → v2 verify-then-select (the shipped-logic win). */
export interface AblationTable {
  key: string;
  name: string;
  v1: AblationArm;
  v2: AblationArm;
  deltaPts: number; // v2 − v1 accuracy
  costDropPct: number; // (v1$ − v2$)/v1$ · 100
}

export interface AgenticSystemRow {
  label: string;
  resolvedRate: number; // 0..1
  resolved: number;
  n: number;
  usdEst: number;
  calls: number;
}

/** SWE-Bench Pro agentic pilot: Enso step-routed vs single-Opus. */
export interface AgenticTable {
  bench: string;
  metric: string;
  stepRouted: AgenticSystemRow;
  singleOpus: AgenticSystemRow;
  note: string;
}

/** Enso's own reported (Table 1) figures — reference only, never conflated. */
export interface EnsoTable {
  bench: string;
  scores: Record<string, number>;
}

export interface EnsoBenchmarks {
  updatedAt: string;
  source: 'embedded' | 'live';
  benches: BenchTable[];
  ablation: AblationTable[];
  agentic?: AgenticTable;
  enso: EnsoTable[];
  pending: string[];
  totalUsdEst: number;
  caveats: string[];
}

/**
 * The admin-only benchmark suite (same-origin, bearer-attached). Returns null on
 * 401/403/any failure so the panel renders the "admin only" state instead of
 * throwing — the server is the real gate; this is its client mirror.
 */
export async function getEnsoBenchmarks(): Promise<EnsoBenchmarks | null> {
  const tok = await getToken();
  if (!tok) return null;
  try {
    const res = await fetch('/v1/world/enso-benchmarks', { headers: { Authorization: `Bearer ${tok}` } });
    if (!res.ok) return null;
    return (await res.json()) as EnsoBenchmarks;
  } catch {
    return null;
  }
}
