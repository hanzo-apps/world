#!/usr/bin/env node

// NOAA SWPC solar activity — public, no auth, no rate limit.
//   - Planetary K-index (3h cadence)            → services.swpc.noaa.gov/products/noaa-planetary-k-index.json
//   - Current solar flux / sunspot number        → services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json
//   - Last 24h XRS flare events                  → services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json
//
// Cache TTL: 30 min (3× the 10 min cron interval). Critical for aurora
// visibility, shortwave comms, and satellite drag models.

import { loadEnvFile, CHROME_UA, runSeed } from './_seed-utils.mjs';
import { emitWorldEvents } from './_world-events.mjs';

loadEnvFile(import.meta.url);

const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const SOLAR_CYCLE_URL = 'https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json';
const XRS_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json';
const CANONICAL_KEY = 'space:solar-activity:v1';
const CACHE_TTL = 1800;

const FLARE_CLASS_THRESHOLD = 'M'; // emit events for M- and X-class only
const FLARE_CLASSES = { A: 0, B: 1, C: 2, M: 3, X: 4 };

/** Parse the SWPC planetary Kp table (header row + N data rows). */
export function parseKpTable(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const headers = rows[0];
  const timeIdx = headers.indexOf('time_tag');
  const kpIdx = headers.indexOf('Kp');
  if (timeIdx < 0 || kpIdx < 0) return [];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 2) continue;
    const t = Date.parse(r[timeIdx]);
    const kp = Number(r[kpIdx]);
    if (!Number.isFinite(t) || !Number.isFinite(kp)) continue;
    out.push({ timestamp: t, kp });
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

/** Extract the last 24 h of XRS flares above the threshold. */
export function extractRecentFlares(xrsSeries, thresholdClass = FLARE_CLASS_THRESHOLD) {
  if (!Array.isArray(xrsSeries)) return [];
  const cutoff = Date.now() - 24 * 3_600_000;
  const thresholdRank = FLARE_CLASSES[thresholdClass] ?? FLARE_CLASSES.M;
  const flares = [];
  for (const row of xrsSeries) {
    const timeTag = row.time_tag || row.timeTag || '';
    const t = Date.parse(timeTag);
    if (!Number.isFinite(t) || t < cutoff) continue;
    const flux = Number(row.flux);
    if (!Number.isFinite(flux) || flux <= 0) continue;
    const klass = classifyFlare(flux);
    if (FLARE_CLASSES[klass.letter] >= thresholdRank) {
      flares.push({ timestamp: t, flux, class: klass.label, letter: klass.letter, magnitude: klass.magnitude });
    }
  }
  return flares;
}

/** Convert a GOES XRS flux (W/m^2) to the NOAA letter class. */
export function classifyFlare(flux) {
  const f = Number(flux);
  if (!Number.isFinite(f) || f <= 0) return { letter: 'A', magnitude: 0, label: 'A0.0' };
  const exp = Math.floor(Math.log10(f));
  let letter = 'A';
  if (exp >= -4) letter = 'X';
  else if (exp >= -5) letter = 'M';
  else if (exp >= -6) letter = 'C';
  else if (exp >= -7) letter = 'B';
  const scale = f / Math.pow(10, exp);
  return { letter, magnitude: +scale.toFixed(1), label: `${letter}${scale.toFixed(1)}` };
}

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(12_000),
  });
  if (!resp.ok) throw new Error(`SWPC ${url}: HTTP ${resp.status}`);
  return resp.json();
}

async function fetchSolarActivity() {
  const [kpRaw, cycleRaw, xrsRaw] = await Promise.all([
    fetchJson(KP_URL),
    fetchJson(SOLAR_CYCLE_URL).catch(() => []),
    fetchJson(XRS_URL).catch(() => []),
  ]);

  const kpSeries = parseKpTable(kpRaw);
  const latestKp = kpSeries.length ? kpSeries[kpSeries.length - 1] : null;

  const latestCycle = Array.isArray(cycleRaw) && cycleRaw.length
    ? cycleRaw[cycleRaw.length - 1]
    : null;

  const flares = extractRecentFlares(xrsRaw);

  // Emit one event per M/X flare (Pro tier — serious operators track these).
  if (flares.length > 0) {
    await emitWorldEvents(flares.map((f) => ({
      type: `space.flare.${f.letter.toLowerCase()}`,
      source: 'swpc',
      tier: 'pro',
      data: { ts: f.timestamp, class: f.class, flux: f.flux },
    })));
  }

  // Emit a Kp storm event if the latest index crosses the geomagnetic threshold (Pro).
  if (latestKp && latestKp.kp >= 5) {
    await emitWorldEvents([{
      type: `space.kp.storm`,
      source: 'swpc',
      tier: 'pro',
      data: { ts: latestKp.timestamp, kp: latestKp.kp },
    }]);
  }

  return {
    kp: {
      latest: latestKp,
      series: kpSeries.slice(-32), // last ~4 days at 3h cadence
    },
    solarCycle: latestCycle ? {
      timeTag: latestCycle['time-tag'] || latestCycle.time_tag || '',
      ssn: Number(latestCycle.ssn) || 0,
      smoothedSsn: Number(latestCycle.smoothed_ssn) || 0,
      f107: Number(latestCycle.f10_7) || 0,
      smoothedF107: Number(latestCycle.smoothed_f10_7) || 0,
    } : null,
    flares,
    fetchedAt: Date.now(),
  };
}

function validate(data) {
  return Boolean(data?.kp?.latest) || Array.isArray(data?.flares);
}

export function declareRecords(data) {
  const kpCount = Array.isArray(data?.kp?.series) ? data.kp.series.length : 0;
  const flareCount = Array.isArray(data?.flares) ? data.flares.length : 0;
  return kpCount + flareCount;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed('space', 'solar-activity', CANONICAL_KEY, fetchSolarActivity, {
    validateFn: validate,
    ttlSeconds: CACHE_TTL,
    sourceVersion: 'swpc-kp-xrs-v1',
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: 45,
    zeroIsValid: true,
  }).catch((err) => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
