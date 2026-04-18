#!/usr/bin/env node

// DefiLlama TVL — https://api.llama.fi (no auth, public, generous rate limit).
// We pull:
//   - /v2/historicalChainTvl  — aggregate history for sparklines (90-day window)
//   - /v2/chains              — current TVL + 24h/7d deltas per chain
//   - /protocols              — top protocols by TVL (trimmed to top 100)
//
// Cache TTL: 1 h (4× the 15 min cron interval).

import { loadEnvFile, CHROME_UA, runSeed } from './_seed-utils.mjs';
import { emitWorldEvents } from './_world-events.mjs';

loadEnvFile(import.meta.url);

const CHAINS_URL = 'https://api.llama.fi/v2/chains';
const PROTOCOLS_URL = 'https://api.llama.fi/protocols';
const HIST_URL = 'https://api.llama.fi/v2/historicalChainTvl';
const CANONICAL_KEY = 'crypto:defi-tvl:v1';
const CACHE_TTL = 3600;
const TOP_PROTOCOLS = 100;
const HISTORY_DAYS = 90;

/**
 * Build a 90-day sparkline from DefiLlama's historical array (one entry/day).
 * Pure — exported for tests.
 */
export function buildSparkline(history, days = HISTORY_DAYS) {
  if (!Array.isArray(history) || history.length === 0) return [];
  const cutoff = Date.now() / 1000 - days * 86400;
  const filtered = history.filter((p) => Number.isFinite(p?.date) && p.date >= cutoff);
  return filtered.map((p) => ({ t: Number(p.date) * 1000, tvl: Number(p.tvl) || 0 }));
}

/** Normalize a DefiLlama chain row. */
export function normalizeChain(row) {
  return {
    name: String(row.name || row.gecko_id || ''),
    tokenSymbol: String(row.tokenSymbol || ''),
    tvl: Number(row.tvl) || 0,
    tvlPrevDay: Number(row.tvlPrevDay) || 0,
    tvlPrevWeek: Number(row.tvlPrevWeek) || 0,
    tvlPrevMonth: Number(row.tvlPrevMonth) || 0,
    change24h: Number(row.change_1d) || 0,
    change7d: Number(row.change_7d) || 0,
  };
}

/** Normalize a DefiLlama protocol row. */
export function normalizeProtocol(row) {
  return {
    name: String(row.name || ''),
    slug: String(row.slug || ''),
    category: String(row.category || ''),
    chain: String(row.chain || ''),
    tvl: Number(row.tvl) || 0,
    change24h: Number(row.change_1d) || 0,
    change7d: Number(row.change_7d) || 0,
  };
}

async function fetchJson(url) {
  const resp = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`DefiLlama ${url}: HTTP ${resp.status}`);
  return resp.json();
}

async function fetchDefiTvl() {
  const [chainsRaw, protocolsRaw, histRaw] = await Promise.all([
    fetchJson(CHAINS_URL),
    fetchJson(PROTOCOLS_URL),
    fetchJson(HIST_URL).catch(() => []),
  ]);

  const chains = Array.isArray(chainsRaw) ? chainsRaw.map(normalizeChain).filter((c) => c.tvl > 0) : [];
  chains.sort((a, b) => b.tvl - a.tvl);

  const protocols = Array.isArray(protocolsRaw)
    ? protocolsRaw.map(normalizeProtocol).filter((p) => p.tvl > 0).sort((a, b) => b.tvl - a.tvl).slice(0, TOP_PROTOCOLS)
    : [];

  const sparkline = buildSparkline(histRaw);
  const latestTvl = sparkline.length ? sparkline[sparkline.length - 1].tvl : chains.reduce((s, c) => s + c.tvl, 0);

  // Emit an event per top-10 chain with abs(24h change) >= 5 % (Pro).
  const moving = chains.slice(0, 10).filter((c) => Math.abs(c.change24h) >= 5);
  if (moving.length > 0) {
    await emitWorldEvents(moving.map((c) => ({
      type: `crypto.tvl.move.${c.change24h > 0 ? 'up' : 'down'}`,
      source: 'defillama',
      tier: 'pro',
      data: { chain: c.name, tvl: c.tvl, change24h: c.change24h },
    })));
  }

  return {
    totalTvl: latestTvl,
    chains,
    protocols,
    sparkline,
    fetchedAt: Date.now(),
  };
}

function validate(data) {
  return Array.isArray(data?.chains) && data.chains.length > 0;
}

export function declareRecords(data) {
  return (data?.chains?.length || 0) + (data?.protocols?.length || 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed('crypto', 'defi-tvl', CANONICAL_KEY, fetchDefiTvl, {
    validateFn: validate,
    ttlSeconds: CACHE_TTL,
    sourceVersion: 'defillama-v2-v1',
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: 180,
  }).catch((err) => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
