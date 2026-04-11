import type { ResilienceScoreResponse } from '@/services/resilience';

export type ResilienceVisualLevel = 'very_high' | 'high' | 'moderate' | 'low' | 'very_low' | 'unknown';

export const RESILIENCE_VISUAL_LEVEL_COLORS: Record<ResilienceVisualLevel, string> = {
  very_high: '#22c55e',
  high: '#84cc16',
  moderate: '#eab308',
  low: '#f97316',
  very_low: '#ef4444',
  unknown: 'var(--text-faint)',
};

const DOMAIN_LABELS: Record<string, string> = {
  economic: 'Economic',
  infrastructure: 'Infra & Supply',
  energy: 'Energy',
  'social-governance': 'Social & Gov',
  'health-food': 'Health & Food',
};

export function getResilienceVisualLevel(score: number): ResilienceVisualLevel {
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= 80) return 'very_high';
  if (score >= 60) return 'high';
  if (score >= 40) return 'moderate';
  if (score >= 20) return 'low';
  return 'very_low';
}

export function getResilienceTrendArrow(trend: string): string {
  if (trend === 'rising') return '↑';
  if (trend === 'falling') return '↓';
  return '→';
}

export function getResilienceDomainLabel(domainId: string): string {
  return DOMAIN_LABELS[domainId] ?? domainId;
}

export function formatResilienceConfidence(data: ResilienceScoreResponse): string {
  if (data.lowConfidence) return 'Low confidence — sparse data';
  const coverages = data.domains.flatMap((d) => d.dimensions.map((dim) => dim.coverage));
  const avgCoverage = coverages.length > 0
    ? Math.round((coverages.reduce((s, c) => s + c, 0) / coverages.length) * 100)
    : 0;
  return `Coverage ${avgCoverage}% ✓`;
}

export function formatResilienceChange30d(change30d: number): string {
  const rounded = Number.isFinite(change30d) ? change30d.toFixed(1) : '0.0';
  const sign = change30d > 0 ? '+' : '';
  return `30d ${sign}${rounded}`;
}

export function formatBaselineStress(baseline: number, stress: number): string {
  const b = Number.isFinite(baseline) ? Math.round(baseline) : 0;
  const s = Number.isFinite(stress) ? Math.round(stress) : 0;
  return `Baseline: ${b} | Stress: ${s}`;
}

// Formats the dataVersion field (ISO date YYYY-MM-DD, sourced from the
// seed-meta key) for display in the widget footer. Returns an empty string
// when dataVersion is missing, malformed, or not a real calendar date so
// the caller can skip rendering. Format is stable and regex + calendar
// tested by resilience-widget.test.mts.
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export function formatResilienceDataVersion(dataVersion: string | null | undefined): string {
  if (typeof dataVersion !== 'string' || !ISO_DATE_PATTERN.test(dataVersion)) return '';
  // Regex-shape is not enough: `/^\d{4}-\d{2}-\d{2}$/` accepts values like
  // `9999-99-99` or `2024-13-45`. A stale or corrupted Redis key could emit
  // one, and the widget would render it without complaint. Defensively
  // verify the string parses to a real calendar date AND round-trips back
  // to the same YYYY-MM-DD slice (so e.g. `2024-02-30` does not silently
  // become `2024-03-01`). Raised in review of PR #2943.
  const parsed = new Date(dataVersion);
  if (Number.isNaN(parsed.getTime())) return '';
  if (parsed.toISOString().slice(0, 10) !== dataVersion) return '';
  return `Data ${dataVersion}`;
}
