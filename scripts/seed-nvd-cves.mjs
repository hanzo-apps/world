#!/usr/bin/env node

// NVD CVE 2.0 API — https://nvd.nist.gov/developers/vulnerabilities
// Without an API key: 5 req / 30 s (rolling).  With NVD_API_KEY: 50 req / 30 s.
// We make ONE request per run and fetch only CVEs published in the last 48 h
// with CVSS >= 7.0 (base score), so we stay well under the free rate limit.
//
// Cache TTL: 4 h (4× the 1 h cron interval). NVD is quiet on weekends but
// that's expected — zeroIsValid=true.

import { loadEnvFile, CHROME_UA, runSeed } from './_seed-utils.mjs';
import { emitWorldEvents } from './_world-events.mjs';

loadEnvFile(import.meta.url);

const NVD_API_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const CANONICAL_KEY = 'cyber:cves:v1';
const CACHE_TTL = 14400;
const CVSS_THRESHOLD = 7.0;
const LOOKBACK_HOURS = 48;
const RESULTS_PER_PAGE = 200;
const MAX_PAGES = 3; // 600 CVEs is more than enough for a 48h window

function isoHoursAgo(hours) {
  const d = new Date(Date.now() - hours * 3_600_000);
  return d.toISOString().replace(/\.\d{3}Z$/, '.000');
}

/**
 * Extract the highest CVSS v3.1/v3.0/v2 base score from a CVE record.
 * Pure — exported for tests.
 */
export function extractCvssScore(cve) {
  const metrics = cve?.metrics || {};
  const v31 = metrics.cvssMetricV31?.[0]?.cvssData?.baseScore;
  const v30 = metrics.cvssMetricV30?.[0]?.cvssData?.baseScore;
  const v2 = metrics.cvssMetricV2?.[0]?.cvssData?.baseScore;
  const scores = [v31, v30, v2].filter((s) => Number.isFinite(s));
  if (scores.length === 0) return null;
  return Math.max(...scores);
}

/** Severity bucket used for event types. */
export function severityBucket(score) {
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  return 'low';
}

/** Map a raw NVD record into the trimmed shape we serve to clients. */
export function normalizeCve(entry) {
  const cve = entry?.cve || entry;
  if (!cve?.id) return null;
  const score = extractCvssScore(cve);
  if (score === null) return null;
  const descriptions = cve.descriptions || [];
  const english = descriptions.find((d) => d.lang === 'en') || descriptions[0];
  return {
    id: String(cve.id),
    published: String(cve.published || ''),
    lastModified: String(cve.lastModified || ''),
    score: +score.toFixed(1),
    severity: severityBucket(score),
    description: String(english?.value || '').slice(0, 600),
    sourceUrl: `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve.id)}`,
  };
}

async function fetchCves() {
  const apiKey = process.env.NVD_API_KEY || '';
  const headers = { Accept: 'application/json', 'User-Agent': CHROME_UA };
  if (apiKey) headers.apiKey = apiKey;

  const since = isoHoursAgo(LOOKBACK_HOURS);
  const until = new Date().toISOString().replace(/\.\d{3}Z$/, '.000');

  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${NVD_API_BASE}?pubStartDate=${encodeURIComponent(since)}` +
      `&pubEndDate=${encodeURIComponent(until)}` +
      `&cvssV3Severity=HIGH,CRITICAL` +
      `&resultsPerPage=${RESULTS_PER_PAGE}` +
      `&startIndex=${page * RESULTS_PER_PAGE}`;

    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) {
      // NVD returns 403 when rate-limited. Leave with what we have.
      if (resp.status === 403 || resp.status === 429) break;
      throw new Error(`NVD API error: ${resp.status}`);
    }
    const j = await resp.json();
    const vulns = j?.vulnerabilities || [];
    for (const v of vulns) {
      const normalized = normalizeCve(v);
      if (normalized && normalized.score >= CVSS_THRESHOLD) out.push(normalized);
    }
    if (vulns.length < RESULTS_PER_PAGE) break;
    // Polite: 600 ms between pages keeps us inside 5 req / 30 s unauthenticated.
    await new Promise((r) => setTimeout(r, 600));
  }

  out.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));

  // Emit ONE event per critical CVE (Free — security teams want these).
  const critical = out.filter((c) => c.severity === 'critical');
  if (critical.length > 0) {
    await emitWorldEvents(critical.map((c) => ({
      type: 'cyber.cve.critical',
      source: 'nvd',
      tier: 'free',
      data: { id: c.id, score: c.score, published: c.published },
    })));
  }

  return { cves: out, fetchedAt: Date.now() };
}

function validate(data) {
  return Array.isArray(data?.cves);
}

export function declareRecords(data) {
  return Array.isArray(data?.cves) ? data.cves.length : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed('cyber', 'cves', CANONICAL_KEY, fetchCves, {
    validateFn: validate,
    ttlSeconds: CACHE_TTL,
    sourceVersion: 'nvd-2.0-high-critical-v1',
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: 180,
    zeroIsValid: true,
  }).catch((err) => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
