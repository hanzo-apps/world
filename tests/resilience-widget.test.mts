import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatBaselineStress,
  formatResilienceChange30d,
  formatResilienceConfidence,
  formatResilienceDataVersion,
  getResilienceDomainLabel,
  getResilienceTrendArrow,
  getResilienceVisualLevel,
} from '../src/components/resilience-widget-utils';
import type { ResilienceScoreResponse } from '../src/services/resilience';

const baseResponse: ResilienceScoreResponse = {
  countryCode: 'US',
  overallScore: 73,
  baselineScore: 82,
  stressScore: 58,
  stressFactor: 0.21,
  level: 'high',
  domains: [
    { id: 'economic', score: 80, weight: 0.22, dimensions: [
      { id: 'macroFiscal', score: 80, coverage: 0.9, observedWeight: 1, imputedWeight: 0 },
    ] },
  ],
  trend: 'rising',
  change30d: 2.4,
  lowConfidence: false,
  imputationShare: 0,
  dataVersion: '2026-04-03',
};

test('getResilienceVisualLevel maps the score thresholds from the widget spec', () => {
  assert.equal(getResilienceVisualLevel(80), 'very_high');
  assert.equal(getResilienceVisualLevel(79), 'high');
  assert.equal(getResilienceVisualLevel(60), 'high');
  assert.equal(getResilienceVisualLevel(59), 'moderate');
  assert.equal(getResilienceVisualLevel(20), 'low');
  assert.equal(getResilienceVisualLevel(19), 'very_low');
  assert.equal(getResilienceVisualLevel(Number.NaN), 'unknown');
});

test('getResilienceTrendArrow renders the expected glyphs', () => {
  assert.equal(getResilienceTrendArrow('rising'), '↑');
  assert.equal(getResilienceTrendArrow('falling'), '↓');
  assert.equal(getResilienceTrendArrow('stable'), '→');
  assert.equal(getResilienceTrendArrow('unknown'), '→');
});

test('getResilienceDomainLabel keeps the deep-dive shorthand labels stable', () => {
  assert.equal(getResilienceDomainLabel('economic'), 'Economic');
  assert.equal(getResilienceDomainLabel('infrastructure'), 'Infra & Supply');
  assert.equal(getResilienceDomainLabel('social-governance'), 'Social & Gov');
  assert.equal(getResilienceDomainLabel('health-food'), 'Health & Food');
  assert.equal(getResilienceDomainLabel('custom-domain'), 'custom-domain');
});

test('formatResilienceConfidence shows sparse-data copy when low confidence is set', () => {
  assert.equal(formatResilienceConfidence(baseResponse), 'Coverage 90% ✓');
  assert.equal(
    formatResilienceConfidence({ ...baseResponse, lowConfidence: true }),
    'Low confidence — sparse data',
  );
});

test('formatResilienceChange30d preserves explicit sign formatting', () => {
  assert.equal(formatResilienceChange30d(2.41), '30d +2.4');
  assert.equal(formatResilienceChange30d(-1.26), '30d -1.3');
  assert.equal(formatResilienceChange30d(0), '30d 0.0');
});

test('formatBaselineStress renders the expected breakdown string (no Impact)', () => {
  assert.equal(formatBaselineStress(72.1, 58.3), 'Baseline: 72 | Stress: 58');
  assert.equal(formatBaselineStress(80, 100), 'Baseline: 80 | Stress: 100');
  assert.equal(formatBaselineStress(50, 0), 'Baseline: 50 | Stress: 0');
  assert.equal(formatBaselineStress(NaN, 50), 'Baseline: 0 | Stress: 50');
});

// T1.4 Phase 1 of the country-resilience reference-grade upgrade plan.
// dataVersion is sourced from the Railway static-seed job's seed-meta key
// (fetchedAt → ISO date in _shared.ts buildResilienceScore). The widget
// renders a footer label so analysts can see how fresh the underlying
// source data is; a missing or malformed dataVersion returns an empty
// string so the caller skips rendering rather than showing a dangling label.
test('formatResilienceDataVersion renders a label for a valid ISO date', () => {
  assert.equal(formatResilienceDataVersion('2026-04-11'), 'Data 2026-04-11');
  assert.equal(formatResilienceDataVersion('2024-01-01'), 'Data 2024-01-01');
});

test('formatResilienceDataVersion returns empty for missing or malformed dataVersion', () => {
  assert.equal(formatResilienceDataVersion(''), '');
  assert.equal(formatResilienceDataVersion(null), '');
  assert.equal(formatResilienceDataVersion(undefined), '');
  // Guard against partially-formatted or non-ISO strings that the fallback
  // path in _shared.ts should never emit but downstream code should still
  // reject defensively:
  assert.equal(formatResilienceDataVersion('2026-04'), '');
  assert.equal(formatResilienceDataVersion('04/11/2026'), '');
  assert.equal(formatResilienceDataVersion('not-a-date'), '');
});

test('formatResilienceDataVersion rejects regex-valid but calendar-invalid dates (PR #2943 review)', () => {
  // Regex `/^\d{4}-\d{2}-\d{2}$/` accepts these strings but they are not
  // real calendar dates. A stale or corrupted Redis key could emit one,
  // and without the round-trip check the widget would render it unchecked.
  assert.equal(formatResilienceDataVersion('9999-99-99'), '');
  assert.equal(formatResilienceDataVersion('2024-13-45'), '');
  assert.equal(formatResilienceDataVersion('2024-00-15'), '');
  // February 30th parses as a real Date in JS but not the same string
  // when round-tripped through toISOString; the round-trip check catches
  // this slip, so `2024-02-30` silently rolling to `2024-03-01` is rejected.
  assert.equal(formatResilienceDataVersion('2024-02-30'), '');
  assert.equal(formatResilienceDataVersion('2024-02-31'), '');
  // Legitimate calendar dates still pass.
  assert.equal(formatResilienceDataVersion('2024-02-29'), 'Data 2024-02-29'); // leap year
  assert.equal(formatResilienceDataVersion('2023-02-28'), 'Data 2023-02-28');
});

test('baseResponse includes dataVersion (regression for T1.4 wiring)', () => {
  // Guards against a future change that accidentally drops the dataVersion
  // field from the service response shape. The scorer writes it from the
  // seed-meta key; the widget footer renders it via formatResilienceDataVersion.
  assert.equal(typeof baseResponse.dataVersion, 'string');
  assert.ok(baseResponse.dataVersion.length > 0, 'baseResponse should carry a non-empty dataVersion for regression coverage');
  assert.equal(formatResilienceDataVersion(baseResponse.dataVersion), `Data ${baseResponse.dataVersion}`);
});
