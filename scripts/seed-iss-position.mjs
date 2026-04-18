#!/usr/bin/env node

// ISS live position — wheretheiss.at (no auth, rate-limit 1 call/sec).
// We poll every 60 s and write the last observed position + a ring buffer
// of the trailing 60 points so the globe can animate a polyline.
//
// Cache TTL: 5 min (5× the 1 min cron interval per gold standard).

import { loadEnvFile, CHROME_UA, runSeed } from './_seed-utils.mjs';
import { emitWorldEvent } from './_world-events.mjs';

loadEnvFile(import.meta.url);

const WHERE_THE_ISS_URL = 'https://api.wheretheiss.at/v1/satellites/25544';
const TRAIL_KEY = 'space:iss:trail:v1';
const CANONICAL_KEY = 'space:iss:v1';
const CACHE_TTL = 300;
const TRAIL_MAX_POINTS = 60;

/**
 * Fetch a single ISS position sample from wheretheiss.at.
 * Exported for tests — callers inject a custom fetch.
 */
export async function fetchIssSample(fetchFn = globalThis.fetch) {
  const resp = await fetchFn(WHERE_THE_ISS_URL, {
    headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(8_000),
  });
  if (!resp.ok) throw new Error(`wheretheiss API error: ${resp.status}`);
  const j = await resp.json();
  return {
    latitude: Number(j.latitude) || 0,
    longitude: Number(j.longitude) || 0,
    altitudeKm: Number(j.altitude) || 0,
    velocityKmh: Number(j.velocity) || 0,
    visibility: String(j.visibility || 'unknown'),
    footprintKm: Number(j.footprint) || 0,
    timestamp: Number(j.timestamp) * 1000 || Date.now(),
  };
}

/**
 * Push a new sample onto an existing trail, trimming to TRAIL_MAX_POINTS.
 * Pure function — exported for tests.
 */
export function pushTrail(existingTrail, sample, max = TRAIL_MAX_POINTS) {
  const trail = Array.isArray(existingTrail) ? existingTrail.slice() : [];
  trail.push(sample);
  if (trail.length > max) trail.splice(0, trail.length - max);
  return trail;
}

async function fetchIss() {
  const sample = await fetchIssSample();

  // Read previous trail (best-effort — fresh on first run)
  let previousTrail = [];
  try {
    const { readCanonicalValue } = await import('./_seed-utils.mjs');
    const prev = await readCanonicalValue(CANONICAL_KEY);
    if (prev?.trail && Array.isArray(prev.trail)) previousTrail = prev.trail;
  } catch {
    // ignore — first run
  }
  const trail = pushTrail(previousTrail, sample);

  // Emit a single position event (free tier).
  await emitWorldEvent({
    type: 'space.iss.position',
    source: 'wheretheiss',
    tier: 'free',
    data: {
      lat: sample.latitude,
      lon: sample.longitude,
      altKm: sample.altitudeKm,
      velKmh: sample.velocityKmh,
    },
  });

  return {
    current: sample,
    trail,
    fetchedAt: Date.now(),
  };
}

function validate(data) {
  return Boolean(data?.current) && Number.isFinite(data.current.latitude) && Number.isFinite(data.current.longitude);
}

export function declareRecords(data) {
  return data?.current ? 1 : 0;
}

// Run the seed only when this file is the entrypoint (node scripts/seed-iss-position.mjs).
// When imported from tests, exports are used but no seed runs.
if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed('space', 'iss', CANONICAL_KEY, fetchIss, {
    validateFn: validate,
    ttlSeconds: CACHE_TTL,
    sourceVersion: 'wheretheiss-v1',
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: 10,
    extraKeys: [{ key: TRAIL_KEY, ttl: CACHE_TTL, transform: (d) => ({ trail: d.trail }) }],
  }).catch((err) => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
