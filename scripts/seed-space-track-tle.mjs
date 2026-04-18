#!/usr/bin/env node

// Space-Track.org TLE catalogue — requires a free account
// (SPACE_TRACK_USER / SPACE_TRACK_PASS). Rate-limit: 300 queries/hour per user,
// and the account Terms of Service forbid redistributing TLEs to third parties
// except as publicly-visible orbital aggregate data. We therefore:
//   - fetch ONLY active LEO objects at NORAD cat id < 60000 with mean motion > 11
//   - store aggregate counts by object type + altitude bucket (no TLE text)
//   - keep a cached top-200 list with name, NORAD id, apogee, perigee, inclination
//
// Cache TTL: 12 h (cron runs every 6 h). The catalogue changes slowly; TLEs
// themselves are refreshed within the 6 h window but the compile step below
// is what we serve.

import { loadEnvFile, CHROME_UA, runSeed } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const SPACE_TRACK_BASE = 'https://www.space-track.org';
const AUTH_URL = `${SPACE_TRACK_BASE}/ajaxauth/login`;
const GP_QUERY = `${SPACE_TRACK_BASE}/basicspacedata/query/class/gp/decay_date/null-val/orderby/norad_cat_id/format/json/limit/5000`;
const CANONICAL_KEY = 'space:tle-aggregate:v1';
const CACHE_TTL = 43200;

const ALT_BUCKETS = [
  { label: 'LEO-low', min: 160, max: 400 },
  { label: 'LEO-med', min: 400, max: 800 },
  { label: 'LEO-high', min: 800, max: 2000 },
  { label: 'MEO', min: 2000, max: 35786 },
  { label: 'GEO', min: 35786, max: 40000 },
  { label: 'HEO', min: 40000, max: Infinity },
];

/** Categorize NORAD object type string. Pure. */
export function classifyObject(type) {
  const s = String(type || '').toUpperCase();
  if (s === 'PAYLOAD') return 'payload';
  if (s === 'ROCKET BODY' || s === 'R/B') return 'rocket-body';
  if (s === 'DEBRIS' || s === 'TBA') return 'debris';
  return 'other';
}

/** Bucket a perigee altitude (km) into the ALT_BUCKETS label. Pure. */
export function bucketAltitude(altKm) {
  const a = Number(altKm);
  if (!Number.isFinite(a) || a <= 0) return 'unknown';
  for (const b of ALT_BUCKETS) {
    if (a >= b.min && a < b.max) return b.label;
  }
  return 'unknown';
}

/** Transform a Space-Track GP row into our compact shape. Pure. */
export function normalizeGp(row) {
  return {
    noradId: Number(row.NORAD_CAT_ID) || 0,
    name: String(row.OBJECT_NAME || ''),
    country: String(row.COUNTRY_CODE || ''),
    epoch: String(row.EPOCH || ''),
    apogeeKm: Number(row.APOGEE) || 0,
    perigeeKm: Number(row.PERIGEE) || 0,
    inclinationDeg: Number(row.INCLINATION) || 0,
    meanMotionRevDay: Number(row.MEAN_MOTION) || 0,
    type: classifyObject(row.OBJECT_TYPE),
    bucket: bucketAltitude(Number(row.PERIGEE)),
  };
}

/** Compute aggregate counts by type × altitude bucket. Pure. */
export function computeAggregates(objects) {
  const aggregate = {};
  for (const o of objects) {
    const key = `${o.type}:${o.bucket}`;
    aggregate[key] = (aggregate[key] || 0) + 1;
  }
  return aggregate;
}

async function login() {
  const user = process.env.SPACE_TRACK_USER;
  const pass = process.env.SPACE_TRACK_PASS;
  if (!user || !pass) throw new Error('SPACE_TRACK_USER / SPACE_TRACK_PASS not set');

  const body = new URLSearchParams({ identity: user, password: pass });
  const resp = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': CHROME_UA },
    body: body.toString(),
    signal: AbortSignal.timeout(20_000),
    redirect: 'manual',
  });
  if (resp.status !== 200 && resp.status !== 302) {
    throw new Error(`Space-Track login HTTP ${resp.status}`);
  }
  const cookie = resp.headers.get('set-cookie') || '';
  const spaceTrackCookie = cookie.split(/,(?![^()]*\))/).map((c) => c.trim()).join('; ');
  if (!spaceTrackCookie) throw new Error('Space-Track login: no session cookie');
  return spaceTrackCookie;
}

async function fetchGpData(cookie) {
  const resp = await fetch(GP_QUERY, {
    headers: { Cookie: cookie, Accept: 'application/json', 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) throw new Error(`Space-Track GP query HTTP ${resp.status}`);
  return resp.json();
}

async function fetchTle() {
  const cookie = await login();
  const raw = await fetchGpData(cookie);
  const objects = Array.isArray(raw) ? raw.map(normalizeGp) : [];

  // Top 200 by active-payload selection + sorted by perigee ascending (lowest orbit first)
  const payloads = objects.filter((o) => o.type === 'payload' && o.perigeeKm > 0).slice(0, 200);
  payloads.sort((a, b) => a.perigeeKm - b.perigeeKm);

  const aggregates = computeAggregates(objects);

  return {
    totalCataloged: objects.length,
    aggregates,
    topPayloads: payloads,
    fetchedAt: Date.now(),
  };
}

function validate(data) {
  return Number.isFinite(data?.totalCataloged) && data.totalCataloged > 0;
}

export function declareRecords(data) {
  return Number(data?.totalCataloged) || 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed('space', 'tle-aggregate', CANONICAL_KEY, fetchTle, {
    validateFn: validate,
    ttlSeconds: CACHE_TTL,
    sourceVersion: 'space-track-gp-v1',
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: 720,
  }).catch((err) => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
