import { fetchWithProxy } from '@/utils';

// Typed client for GET /v1/world/china-macro — the merged China macro snapshot
// + official release calendar served by internal/world/handlers_china.go. The
// shapes mirror the Go payload exactly; value/priorValue are nullable so an
// unavailable observation stays honestly empty rather than a fabricated 0.

export interface ChinaMacroIndicator {
  id: string;
  label: string;
  category: string;
  value: number | null;
  priorValue: number | null;
  unit: string;
  observationDate: string;
  source: string;
  sourceUrl: string;
  stale: boolean;
  unavailableReason: string;
  contextOnly: boolean;
}

export interface ChinaReleaseEvent {
  id: string;
  event: string;
  countryCode: string;
  releaseDate: string;
  releaseTime: string;
  timezone: string;
  kind: string;
  status: string;
  source: string;
  sourceUrl: string;
}

export interface ChinaSourceDecision {
  source: string;
  host: string;
  status: string;
  reason: string;
  checkedAt: string;
  optional: boolean;
  requestCount: number;
}

export interface ChinaMacroSnapshot {
  countryCode: string;
  generatedAt: string;
  status: string;
  launchReady: boolean;
  contentObservationDate: string;
  latestObservationDate: string;
  indicators: ChinaMacroIndicator[];
  sourceDecisions: ChinaSourceDecision[];
  releaseEvents: ChinaReleaseEvent[];
  unavailable: boolean;
}

const CHINA_MACRO_URL = '/v1/world/china-macro';

// A blocked upstream (OECD/NBS/ChinaMoney) can make the backend burn its full
// server-side deadline; cap the browser wait so a slow snapshot aborts and
// degrades to an honest empty state instead of hanging the panel.
const CHINA_MACRO_TIMEOUT_MS = 10_000;

function emptySnapshot(): ChinaMacroSnapshot {
  return {
    countryCode: 'CN', generatedAt: '', status: 'unavailable', launchReady: false,
    contentObservationDate: '', latestObservationDate: '', indicators: [],
    sourceDecisions: [], releaseEvents: [], unavailable: true,
  };
}

// isChinaLaunchReady mirrors the backend gate: a snapshot is launch-ready only
// when the server passed all four required categories. Kept as a helper so the
// UI never re-derives the contract from indicator internals.
export function isChinaLaunchReady(snapshot: ChinaMacroSnapshot | null): boolean {
  return snapshot?.launchReady === true;
}

export async function fetchChinaMacro(): Promise<ChinaMacroSnapshot> {
  try {
    const response = await fetchWithProxy(CHINA_MACRO_URL, undefined, CHINA_MACRO_TIMEOUT_MS);
    if (!response.ok) return emptySnapshot();
    const data = (await response.json()) as Partial<ChinaMacroSnapshot>;
    if (!data || typeof data !== 'object') return emptySnapshot();
    return {
      ...emptySnapshot(),
      ...data,
      indicators: Array.isArray(data.indicators) ? data.indicators : [],
      releaseEvents: Array.isArray(data.releaseEvents) ? data.releaseEvents : [],
      sourceDecisions: Array.isArray(data.sourceDecisions) ? data.sourceDecisions : [],
    };
  } catch {
    return emptySnapshot();
  }
}
