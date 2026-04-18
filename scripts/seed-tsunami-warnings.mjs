#!/usr/bin/env node

// NOAA Pacific Tsunami Warning Center (PTWC) active bulletins.
// Public Atom feed, no auth, updated on event — we poll every 5 min.
//
// The feed provides a concise subset: id, title (which encodes severity),
// updated timestamp, summary text. We extract severity via keyword match.
//
// Cache TTL: 30 min (6× the 5 min cron interval). PTWC is quiet most of
// the time — zeroIsValid=true to avoid flapping on empty runs.

import { loadEnvFile, CHROME_UA, runSeed } from './_seed-utils.mjs';
import { emitWorldEvents } from './_world-events.mjs';

loadEnvFile(import.meta.url);

const PTWC_ATOM_URL = 'https://www.tsunami.gov/events/xml/PAAQAtom.xml';
const ITIC_JSON_URL = 'https://www.tsunami.gov/events/events.json';
const CANONICAL_KEY = 'space:tsunami:v1'; // grouping with geophysical events
const CACHE_TTL = 1800;

const SEVERITY_KEYWORDS = [
  { match: /tsunami warning/i, severity: 'warning' },
  { match: /tsunami advisory/i, severity: 'advisory' },
  { match: /tsunami watch/i, severity: 'watch' },
  { match: /tsunami information/i, severity: 'information' },
  { match: /tsunami threat/i, severity: 'warning' },
];

/** Classify a title into a tsunami severity band. */
export function classifySeverity(title) {
  if (!title || typeof title !== 'string') return 'information';
  for (const { match, severity } of SEVERITY_KEYWORDS) {
    if (match.test(title)) return severity;
  }
  return 'information';
}

/**
 * Very small Atom parser — extracts id, title, updated, summary for each <entry>.
 * Avoids pulling in a full XML lib to keep the seed container small.
 */
export function parseAtomEntries(xml) {
  if (typeof xml !== 'string' || xml.length === 0) return [];
  const entries = [];
  const entryRe = /<entry[\s\S]*?<\/entry>/g;
  const matches = xml.match(entryRe) || [];
  for (const block of matches) {
    const id = extractTag(block, 'id');
    const title = decodeXmlEntities(extractTag(block, 'title'));
    const updated = extractTag(block, 'updated');
    const summary = decodeXmlEntities(extractTag(block, 'summary'));
    if (!id || !title) continue;
    entries.push({
      id,
      title,
      updated,
      summary: summary.slice(0, 800),
      severity: classifySeverity(title),
      updatedMs: Date.parse(updated) || 0,
    });
  }
  return entries.sort((a, b) => b.updatedMs - a.updatedMs);
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

function decodeXmlEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchTsunami() {
  // Primary: Atom feed. Fallback: ITIC JSON bundle.
  let entries = [];
  try {
    const resp = await fetch(PTWC_ATOM_URL, {
      headers: { Accept: 'application/atom+xml, application/xml, text/xml', 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(12_000),
    });
    if (resp.ok) {
      const xml = await resp.text();
      entries = parseAtomEntries(xml);
    }
  } catch {
    // fall through to fallback
  }

  if (entries.length === 0) {
    try {
      const resp = await fetch(ITIC_JSON_URL, {
        headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
        signal: AbortSignal.timeout(12_000),
      });
      if (resp.ok) {
        const j = await resp.json();
        entries = (j.events || []).map((e) => ({
          id: String(e.id || e.eventId || ''),
          title: String(e.title || e.headline || ''),
          updated: String(e.updated || e.timestamp || ''),
          summary: String(e.summary || '').slice(0, 800),
          severity: classifySeverity(String(e.title || '')),
          updatedMs: Date.parse(String(e.updated || e.timestamp || '')) || 0,
        })).filter((e) => e.id && e.title);
      }
    } catch {
      // last resort: empty (zeroIsValid=true)
    }
  }

  // Emit warning/advisory events (Free — critical safety info).
  const alerts = entries.filter((e) => e.severity === 'warning' || e.severity === 'advisory');
  if (alerts.length > 0) {
    await emitWorldEvents(alerts.map((e) => ({
      type: `geophysical.tsunami.${e.severity}`,
      source: 'ptwc',
      tier: 'free',
      data: { id: e.id, title: e.title, updated: e.updated },
    })));
  }

  return { alerts: entries, fetchedAt: Date.now() };
}

function validate(data) {
  return Array.isArray(data?.alerts);
}

export function declareRecords(data) {
  return Array.isArray(data?.alerts) ? data.alerts.length : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeed('space', 'tsunami', CANONICAL_KEY, fetchTsunami, {
    validateFn: validate,
    ttlSeconds: CACHE_TTL,
    sourceVersion: 'ptwc-atom-v1',
    declareRecords,
    schemaVersion: 1,
    maxStaleMin: 60,
    zeroIsValid: true,
  }).catch((err) => {
    const cause = err.cause ? ` (cause: ${err.cause.message || err.cause.code || err.cause})` : '';
    console.error('FATAL:', (err.message || err) + cause);
    process.exit(1);
  });
}
