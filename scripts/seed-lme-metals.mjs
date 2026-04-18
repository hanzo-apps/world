#!/usr/bin/env node

// LME base metal prices — the LME itself doesn't publish a free API, but the
// St. Louis Fed (FRED) mirrors the Global Price of Metals monthly series
// and the daily cash settlement for aluminium, copper, nickel, zinc, tin,
// and lead. Each series needs FRED_API_KEY (free, 60 req/s).
//
// Cache TTL: 4 h (4× the 1 h cron interval). LME publishes ~11:50 London
// each trading day.

import { loadEnvFile, CHROME_UA, fredFetchJson, resolveProxy, runSeed } from './_seed-utils.mjs';
import { emitWorldEvents } from './_world-events.mjs';

loadEnvFile(import.meta.url);

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const CANONICAL_KEY = 'market:lme-metals:v1';
const CACHE_TTL = 14400;

const METALS = [
  { id: 'PALUMUSDM',   symbol: 'AL', name: 'Aluminium',  unit: 'USD/mt' },
  { id: 'PCOPPUSDM',   symbol: 'CU', name: 'Copper',     unit: 'USD/mt' },
  { id: 'PNICKUSDM',   symbol: 'NI', name: 'Nickel',     unit: 'USD/mt' },
  { id: 'PZINCUSDM',   symbol: 'ZN', name: 'Zinc',       unit: 'USD/mt' },
  { id: 'PTINUSDM',    symbol: 'SN', name: 'Tin',        unit: 'USD/mt' },
  { id: 'PLEADUSDM',   symbol: 'PB', name: 'Lead',       unit: 'USD/mt' },
];

/** Pure — compute pct change between the last two observation values. */
export function computePctChange(history) {
  if (!Array.isArray(history) || history.length < 2) return 0;
  const last = Number(history[history.length - 1]?.value);
  const prev = Number(history[history.length - 2]?.value);
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return 0;
  return +(((last - prev) / prev) * 100).toFixed(2);
}

/** Normalize a FRED observation list to {date, value} pairs. */
export function normalizeFredObservations(obs) {
  if (!Array.isArray(obs)) return [];
  return obs
    .filter((o) => o && o.value !== '.' && o.date)
    .map((o) => ({ date: String(o.date), value: Number(o.value) || 0 }))
    .filter((o) => Number.isFinite(o.value) && o.value > 0);
}

async function fetchMetals() {
  const apiKey = process.env.FRED_API_KEY || '';
  if (!apiKey) throw new Error('FRED_API_KEY not set');

  const proxyAuth = resolveProxy();
  const out = [];
  for (const metal of METALS) {
    try {
      const url = `${FRED_BASE}?series_id=${metal.id}&api_key=${apiKey}&file_type=json` +
        `&limit=60&sort_order=desc`;
      const j = await fredFetchJson(url, proxyAuth);
      const obs = normalizeFredObservations(j?.observations || []).reverse();
      if (obs.length === 0) continue;
      const latest = obs[obs.length - 1];
      const changePct = computePctChange(obs);
      out.push({
        symbol: metal.symbol,
        name: metal.name,
        unit: metal.unit,
        fredId: metal.id,
        latest,
        changePct,
        history: obs.slice(-24), // 24 months
      });
    } catch (err) {
      console.warn(`  LME ${metal.symbol}: ${err.message || err} — skipping`);
    }
  }

  // Emit events for metals moving >= 3 % month-over-month (Pro).
  const moves = out.filter((m) => Math.abs(m.changePct) >= 3);
  if (moves.length > 0) {
    await emitWorldEvents(moves.map((m) => ({
      type: `market.lme.move.${m.changePct > 0 ? 'up' : 'down'}`,
      source: 'fred-lme',
      tier: 'pro',
      data: { symbol: m.symbol, pct: m.changePct, value: m.latest.value, date: m.latest.date },
    })));
  }

  return { metals: out, fetchedAt: Date.now() };
}

function validate(data) {
  return Array.isArray(data?.metals) && data.metals.length >= 1;
}

export function declareRecords(data) {
  return Array.isArray(data?.metals) ? data.metals.length : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed('market', 'lme-metals', CANONICAL_KEY, fetchMetals, {
    validateFn: validate,
    ttlSeconds: CACHE_TTL,
    sourceVersion: 'fred-lme-monthly-v1',
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: 300,
  }).catch((err) => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
