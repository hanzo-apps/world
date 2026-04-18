#!/usr/bin/env node

// World event emission — seeders append normalized events to the
// `world:events:v1` Redis stream. The ZAP sidecar tails this stream and
// forwards events to subscribers (SSE clients, webhook targets).
//
// One-way only. If Redis is down, emission silently drops the event — the
// underlying seed data still publishes through the normal canonical key so
// the dashboard never goes dark.

import { getRedisCredentials } from './_seed-utils.mjs';

const STREAM_KEY = process.env.WORLD_EVENTS_STREAM_KEY || 'world:events:v1';
const STREAM_MAXLEN = Number(process.env.WORLD_EVENTS_STREAM_MAXLEN || 50_000);

/**
 * Append a single event to the world events stream.
 *
 * Event envelope (flat fields for Redis XADD):
 *   t    — event type, dot-separated (e.g. earthquake.6.2, cve.critical)
 *   src  — source id (e.g. usgs, nvd)
 *   tier — 'free' | 'pro'
 *   ts   — emission timestamp (ms)
 *   data — JSON-encoded payload (string)
 *
 * @param {object} event
 * @param {string} event.type    Dotted event type.
 * @param {string} event.source  Source id.
 * @param {'free'|'pro'} event.tier
 * @param {object} event.data    Arbitrary JSON payload.
 * @returns {Promise<string|null>} Stream entry id, or null on failure.
 */
export async function emitWorldEvent(event) {
  const { type, source, tier, data } = event;
  if (!type || !source || !tier) {
    console.warn('[world-events] invalid event — missing type/source/tier:', event);
    return null;
  }
  if (tier !== 'free' && tier !== 'pro') {
    console.warn('[world-events] invalid tier:', tier);
    return null;
  }
  let creds;
  try {
    creds = getRedisCredentials();
  } catch {
    return null;
  }
  const { url, token } = creds;
  const fields = [
    't', String(type),
    'src', String(source),
    'tier', tier,
    'ts', String(Date.now()),
    'data', JSON.stringify(data ?? {}),
  ];
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['XADD', STREAM_KEY, 'MAXLEN', '~', String(STREAM_MAXLEN), '*', ...fields]),
      signal: AbortSignal.timeout(3_000),
    });
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => null);
    return json?.result ?? null;
  } catch {
    return null;
  }
}

/**
 * Append multiple events in a single pipeline. Returns count of successful writes.
 * Use for batch emission (e.g. N earthquakes in one seed run).
 *
 * @param {Array<{type:string, source:string, tier:'free'|'pro', data:object}>} events
 * @returns {Promise<number>}
 */
export async function emitWorldEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return 0;
  let creds;
  try {
    creds = getRedisCredentials();
  } catch {
    return 0;
  }
  const { url, token } = creds;
  const pipeline = [];
  for (const ev of events) {
    const { type, source, tier, data } = ev;
    if (!type || !source || (tier !== 'free' && tier !== 'pro')) continue;
    pipeline.push([
      'XADD', STREAM_KEY, 'MAXLEN', '~', String(STREAM_MAXLEN), '*',
      't', String(type),
      'src', String(source),
      'tier', tier,
      'ts', String(Date.now()),
      'data', JSON.stringify(data ?? {}),
    ]);
  }
  if (pipeline.length === 0) return 0;
  try {
    const resp = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipeline),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return 0;
    const results = await resp.json().catch(() => null);
    return Array.isArray(results) ? results.filter((r) => r?.result).length : 0;
  } catch {
    return 0;
  }
}

// Pure helpers — extracted for unit testing without network I/O.

/**
 * Build the XADD command array for a single event. Exported for tests.
 * @param {object} event
 * @param {string} streamKey
 * @param {number} streamMaxlen
 * @param {number} nowMs
 */
export function buildXaddCommand(event, streamKey = STREAM_KEY, streamMaxlen = STREAM_MAXLEN, nowMs = Date.now()) {
  return [
    'XADD', streamKey, 'MAXLEN', '~', String(streamMaxlen), '*',
    't', String(event.type),
    'src', String(event.source),
    'tier', event.tier,
    'ts', String(nowMs),
    'data', JSON.stringify(event.data ?? {}),
  ];
}

export function isValidEvent(event) {
  if (!event || typeof event !== 'object') return false;
  if (!event.type || typeof event.type !== 'string') return false;
  if (!event.source || typeof event.source !== 'string') return false;
  if (event.tier !== 'free' && event.tier !== 'pro') return false;
  return true;
}

export { STREAM_KEY as WORLD_EVENTS_STREAM_KEY };
