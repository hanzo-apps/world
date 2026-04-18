#!/usr/bin/env node

// EIA v2 API — https://www.eia.gov/opendata — requires EIA_API_KEY
// (free, 5,000 requests/hour/key). We hit four well-known weekly series:
//   PET.WCRSTUS1.W   — Weekly U.S. crude oil ending stocks (k bbl)
//   PET.WGTSTUS1.W   — Weekly U.S. total motor gasoline stocks (k bbl)
//   PET.WRPUPUS2.W   — Weekly U.S. refinery utilization (%)
//   NG.NW2_EPG0_SWO_R48_BCF.W — Weekly lower-48 natural gas storage (Bcf)
//
// One API call per series per run = 4 calls / 6 h cron = trivial.
//
// Cache TTL: 12 h (2× the 6 h cron interval). EIA publishes Wed 10:30 ET for
// petroleum and Thu 10:30 ET for gas — 6 h polling catches the update.

import { loadEnvFile, CHROME_UA, runSeed } from './_seed-utils.mjs';
import { emitWorldEvents } from './_world-events.mjs';

loadEnvFile(import.meta.url);

const EIA_BASE = 'https://api.eia.gov/v2';
const CANONICAL_KEY = 'market:eia-petroleum:v1';
const CACHE_TTL = 43200;

const SERIES = [
  { id: 'PET.WCRSTUS1.W',                  label: 'Crude oil stocks (k bbl)',             unit: 'kbbl',   type: 'stocks-crude' },
  { id: 'PET.WGTSTUS1.W',                  label: 'Motor gasoline stocks (k bbl)',        unit: 'kbbl',   type: 'stocks-gasoline' },
  { id: 'PET.WRPUPUS2.W',                  label: 'Refinery utilization (%)',             unit: 'pct',    type: 'utilization' },
  { id: 'NG.NW2_EPG0_SWO_R48_BCF.W',       label: 'Natural gas storage L-48 (Bcf)',       unit: 'bcf',    type: 'stocks-natgas' },
];

/** Compute week-over-week delta and percentage. Pure. */
export function computeWoW(history) {
  if (!Array.isArray(history) || history.length < 2) return { delta: 0, pct: 0 };
  const last = Number(history[history.length - 1]?.value);
  const prev = Number(history[history.length - 2]?.value);
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return { delta: 0, pct: 0 };
  const delta = last - prev;
  return { delta: +delta.toFixed(2), pct: +((delta / prev) * 100).toFixed(2) };
}

async function fetchSeries(seriesId, apiKey) {
  const [domain, series] = splitSeriesId(seriesId);
  const url = `${EIA_BASE}/${domain}/data/?api_key=${encodeURIComponent(apiKey)}` +
    `&frequency=weekly&data[0]=value` +
    `&facets[series][]=${encodeURIComponent(series)}` +
    `&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=52`;

  const resp = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`EIA ${seriesId}: HTTP ${resp.status}`);
  const j = await resp.json();
  const rows = j?.response?.data || [];
  return rows.map((r) => ({ period: String(r.period || ''), value: Number(r.value) || 0 })).reverse();
}

/** Split "PET.WCRSTUS1.W" into ["petroleum/stoc/wstk", "WCRSTUS1"]. */
export function splitSeriesId(id) {
  // EIA v2 taxonomy — map legacy series IDs onto route/series pairs.
  // We only need the four series above, so a static map is cleaner than a
  // generic traversal of EIA's category tree.
  const map = {
    'PET.WCRSTUS1.W':            ['petroleum/stoc/wstk',           'WCRSTUS1'],
    'PET.WGTSTUS1.W':            ['petroleum/stoc/wstk',           'WGTSTUS1'],
    'PET.WRPUPUS2.W':            ['petroleum/pnp/wiup',            'WRPUPUS2'],
    'NG.NW2_EPG0_SWO_R48_BCF.W': ['natural-gas/stor/wkly',         'NW2_EPG0_SWO_R48_BCF'],
  };
  const entry = map[id];
  if (!entry) throw new Error(`unknown EIA series: ${id}`);
  return entry;
}

async function fetchPetroleum() {
  const apiKey = process.env.EIA_API_KEY || '';
  if (!apiKey) {
    throw new Error('EIA_API_KEY not set — register at https://www.eia.gov/opendata');
  }

  const series = [];
  for (const s of SERIES) {
    try {
      const history = await fetchSeries(s.id, apiKey);
      const wow = computeWoW(history);
      const latest = history.length ? history[history.length - 1] : null;
      series.push({
        id: s.id,
        label: s.label,
        unit: s.unit,
        type: s.type,
        latest,
        wow,
        history: history.slice(-26), // 6 months
      });
      // Polite: 250 ms between calls keeps us far from 5 k/h.
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.warn(`  EIA ${s.id}: ${err.message || err} — skipping`);
    }
  }

  // Emit events when WoW swing is large (>= 5 % or 5 M bbl / 50 Bcf).
  const moves = series.filter((s) => Math.abs(s.wow.pct) >= 5 || Math.abs(s.wow.delta) >= (s.unit === 'bcf' ? 50 : 5_000));
  if (moves.length > 0) {
    await emitWorldEvents(moves.map((s) => ({
      type: `market.eia.${s.type}`,
      source: 'eia',
      tier: 'pro',
      data: { id: s.id, wow: s.wow, latest: s.latest },
    })));
  }

  return { series, fetchedAt: Date.now() };
}

function validate(data) {
  return Array.isArray(data?.series) && data.series.length >= 1;
}

export function declareRecords(data) {
  return Array.isArray(data?.series) ? data.series.length : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed('market', 'eia-petroleum', CANONICAL_KEY, fetchPetroleum, {
    validateFn: validate,
    ttlSeconds: CACHE_TTL,
    sourceVersion: 'eia-v2-weekly-v1',
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: 720, // 12 h — weekly data
  }).catch((err) => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
