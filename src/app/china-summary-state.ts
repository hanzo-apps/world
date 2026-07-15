// Pure state derivation for the China summary groups. Kept free of service/DOM
// imports so the four-state contract (available/partial/stale/unavailable) stays
// unit-testable. Ported verbatim from worldmonitor src/app/china-summary-state.ts;
// the signal/group types are defined locally because this fork surfaces China in
// the Economic Indicators panel rather than the upstream CountryBriefPanel.

export type ChinaCountrySummaryState = 'loading' | 'available' | 'partial' | 'stale' | 'unavailable';

export interface ChinaCountrySummarySignal {
  label?: string;
  value?: string;
  source?: string;
  observedAt?: string;
  stale: boolean;
}

export function chinaSummaryState(signals: ChinaCountrySummarySignal[], expectedSignals: number): ChinaCountrySummaryState {
  if (signals.length === 0) return 'unavailable';
  if (signals.every((signal) => signal.stale)) return 'stale';
  return signals.length < expectedSignals || signals.some((signal) => signal.stale) ? 'partial' : 'available';
}

// Source-provided timestamps are dates or months ('2026-06', '2025-Q4');
// retrieval timestamps are full ISO strings. Trim the latter to the date part
// so the attribution row never shows a millisecond-precision machine string.
export function toObservedDate(timestamp: string): string {
  const tIndex = timestamp.indexOf('T');
  return tIndex > 0 ? timestamp.slice(0, tIndex) : timestamp;
}
