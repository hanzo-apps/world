// Western-Pacific tropical-cyclone attribution — pure canonicalization.
//
// Multiple agencies (JMA, JTWC, HKO, GDACS, NHC) report the same storm under
// different identifiers, positions and wind-averaging conventions. This module
// folds those raw observations into one canonical cyclone per storm while
// preserving each agency's own wind reading verbatim. No IO here: the live
// inputs (GDACS rows, HKO warning summary) are fetched by eonet.ts and handed
// in. Ported from worldmonitor scripts/natural/western-pacific-cyclones.mjs.
import type { GDACSEvent } from './gdacs';
import type { CycloneAgencyObservation, NaturalEvent } from '@/types';

export const HKO_COORDINATES = { lat: 22.3193, lon: 114.1694 } as const;
export const HKO_WARNING_SOURCE_URL = 'https://www.weather.gov.hk/en/wxinfo/currwx/warn.htm';

// Lower rank wins as the canonical primary. JMA is the RSMC of record for the
// basin, so it anchors identity; GDACS/NHC are fallbacks.
const AGENCY_PRIORITY: Record<string, number> = { JMA: 0, JTWC: 1, HKO: 2, GDACS: 3, NHC: 4 };
const ALIAS_MATCH_MAX_DISTANCE_KM = 750;
const ALIAS_MATCH_MAX_AGE_MS = 18 * 60 * 60 * 1000;
const PROXIMITY_MATCH_MAX_DISTANCE_KM = 90;
const PROXIMITY_MATCH_MAX_AGE_MS = 3 * 60 * 60 * 1000;

// Raw observation as accepted by the canonicalizer. Fields are deliberately loose
// (string|number|null) because they arrive straight from third-party feeds; every
// value is validated in normalizedObservation before use.
export interface WesternPacificObservation {
  agency?: string;
  agencyId?: string;
  basin?: string;
  season?: number;
  aliases?: string[];
  stormName?: string;
  name?: string;
  lat?: number | string | null;
  lon?: number | string | null;
  observedAt?: number | string;
  windKt?: number | string | null;
  windAveragingPeriodMinutes?: number | null;
  pressureMb?: number | string | null;
  classification?: string;
  sourceName?: string;
  sourceUrl?: string;
  status?: string;
  sourceEventId?: string;
}

interface NormalizedObservation {
  agency: string;
  agencyId: string;
  basin: 'WP';
  season: number;
  aliases: string[];
  stormName: string;
  lat: number;
  lon: number;
  observedAt: number;
  windKt: number | null;
  windAveragingPeriodMinutes?: number;
  pressureMb: number | null;
  classification: string;
  sourceName: string;
  sourceUrl: string;
  status: 'active' | 'cancelled';
  sourceEventId: string;
}

export interface CanonicalCyclone {
  id: string;
  canonicalId: string;
  matchingConfidence: string;
  basin: 'WP';
  season: number;
  stormName: string;
  canonicalAliases: string[];
  lat: number;
  lon: number;
  observedAt: number;
  windKt: number | null;
  windAveragingPeriodMinutes?: number;
  pressureMb: number | null;
  classification: string;
  sourceName: string;
  sourceUrl: string;
  closed: boolean;
  agencyObservations: CycloneAgencyObservation[];
}

export interface HkoWarning {
  agency: 'HKO';
  agencyId: string;
  status: 'active' | 'cancelled';
  observedAt: number;
  sourceName: string;
  sourceUrl: string;
  title: string;
  description: string;
  lat: number;
  lon: number;
}

function asFiniteNumber(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && value.trim() === '')) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampTimestamp(value: unknown, fallback: number): number {
  const ts = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(ts) && ts > 0 ? ts : fallback;
}

function normalizeAlias(value: unknown): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^(?:typhoon|tropical\s+storm|tropical\s+depression|cyclone|storm)\s+/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function aliasesFor(o: { stormName?: string; aliases?: unknown }): Set<string> {
  return new Set([
    o.stormName,
    ...(Array.isArray(o.aliases) ? o.aliases : []),
  ].map(normalizeAlias).filter(Boolean));
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(a.lat - b.lat);
  const dLon = toRad(a.lon - b.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function validCoordinates(o: { lat: number; lon: number }): boolean {
  return Number.isFinite(o.lat) && Number.isFinite(o.lon)
    && o.lat >= -90 && o.lat <= 90
    && o.lon >= -180 && o.lon <= 180;
}

function agencyRank(agency: string): number {
  return AGENCY_PRIORITY[String(agency || '').toUpperCase()] ?? 99;
}

function observationOrder(a: NormalizedObservation, b: NormalizedObservation): number {
  return agencyRank(a.agency) - agencyRank(b.agency)
    || String(a.agency).localeCompare(String(b.agency))
    || String(a.agencyId).localeCompare(String(b.agencyId));
}

function normalizedObservation(input: WesternPacificObservation, now: number): NormalizedObservation | null {
  const lat = asFiniteNumber(input?.lat);
  const lon = asFiniteNumber(input?.lon);
  if (String(input?.basin || '').toUpperCase() !== 'WP' || lat == null || lon == null || !validCoordinates({ lat, lon })) return null;
  const observedAt = clampTimestamp(input.observedAt, now);
  const aliases = [...aliasesFor(input)];
  return {
    agency: String(input.agency || '').toUpperCase(),
    agencyId: String(input.agencyId || '').trim(),
    basin: 'WP',
    season: Number.isInteger(input.season) ? (input.season as number) : new Date(observedAt).getUTCFullYear(),
    aliases,
    stormName: String(input.stormName || input.name || '').trim(),
    lat,
    lon,
    observedAt,
    windKt: asFiniteNumber(input.windKt),
    windAveragingPeriodMinutes: Number.isInteger(input.windAveragingPeriodMinutes) && (input.windAveragingPeriodMinutes as number) > 0
      ? (input.windAveragingPeriodMinutes as number)
      : undefined,
    pressureMb: asFiniteNumber(input.pressureMb),
    classification: String(input.classification || '').trim(),
    sourceName: String(input.sourceName || input.agency || '').trim(),
    sourceUrl: String(input.sourceUrl || '').trim(),
    status: input.status === 'cancelled' ? 'cancelled' : 'active',
    sourceEventId: String(input.sourceEventId || '').trim(),
  };
}

function collapseAgencyObservations(observations: NormalizedObservation[]): NormalizedObservation[] {
  const latestByAgencyIdentifier = new Map<string, NormalizedObservation>();
  for (const o of observations) {
    const key = `${o.agency}:${o.agencyId}`;
    const existing = latestByAgencyIdentifier.get(key);
    if (!existing || o.observedAt >= existing.observedAt) latestByAgencyIdentifier.set(key, o);
  }
  return [...latestByAgencyIdentifier.values()].sort(observationOrder);
}

function matchObservations(left: NormalizedObservation, right: NormalizedObservation): string | null {
  const ageMs = Math.abs(left.observedAt - right.observedAt);
  const distanceKm = haversineKm(left, right);
  const leftAliases = aliasesFor(left);
  const rightAliases = aliasesFor(right);
  const sharesAlias = [...leftAliases].some((alias) => rightAliases.has(alias));

  if (sharesAlias && ageMs <= ALIAS_MATCH_MAX_AGE_MS && distanceKm <= ALIAS_MATCH_MAX_DISTANCE_KM) {
    return 'alias-bounded';
  }

  // Proximity is a deliberately narrow fallback for unnamed source records only.
  // Named systems with different aliases must remain distinct even when adjacent.
  if (leftAliases.size === 0 && rightAliases.size === 0
    && ageMs <= PROXIMITY_MATCH_MAX_AGE_MS && distanceKm <= PROXIMITY_MATCH_MAX_DISTANCE_KM) {
    return 'proximity-bounded';
  }
  return null;
}

type CycloneGroup = { observations: NormalizedObservation[]; confidence: string };

function canonicalIdFor(observations: NormalizedObservation[]): string {
  const authority = observations.find((o) => o.agency === 'JMA' && o.agencyId)
    || observations.find((o) => o.agencyId)
    || observations[0];
  if (!authority) return 'wp:0::';
  return `wp:${authority.season}:${authority.agency.toLowerCase()}:${authority.agencyId.toLowerCase()}`;
}

function toCanonicalCyclone(observations: NormalizedObservation[], confidence: string): CanonicalCyclone {
  const active = observations.filter((o) => o.status !== 'cancelled');
  const ranked = [...(active.length > 0 ? active : observations)].sort(observationOrder);
  const primary = ranked[0];
  if (!primary) throw new Error('toCanonicalCyclone requires at least one observation');
  // Wind falls back to the first ranked observation that actually reports a
  // number (with its own averaging period) when the primary agency omits wind.
  const windObservation = ranked.find((o) => o.windKt != null) || primary;
  const allAliases = [...new Set(observations.flatMap((o) => o.aliases))].sort();
  return {
    id: `cyclone:${canonicalIdFor(observations)}`,
    canonicalId: canonicalIdFor(observations),
    matchingConfidence: confidence || 'single-source',
    basin: 'WP',
    season: primary.season,
    stormName: primary.stormName || observations.find((o) => o.stormName)?.stormName || '',
    canonicalAliases: allAliases,
    lat: primary.lat,
    lon: primary.lon,
    observedAt: primary.observedAt,
    windKt: windObservation.windKt,
    windAveragingPeriodMinutes: windObservation.windAveragingPeriodMinutes,
    pressureMb: primary.pressureMb,
    classification: primary.classification,
    sourceName: primary.sourceName,
    sourceUrl: primary.sourceUrl,
    closed: active.length === 0,
    agencyObservations: observations.map((o) => ({
      agency: o.agency,
      agencyId: o.agencyId,
      observedAt: o.observedAt,
      lat: o.lat,
      lon: o.lon,
      windKt: o.windKt,
      windAveragingPeriodMinutes: o.windAveragingPeriodMinutes,
      pressureMb: o.pressureMb,
      classification: o.classification,
      status: o.status,
      sourceName: o.sourceName,
      sourceUrl: o.sourceUrl,
    })),
  };
}

export function canonicalizeWesternPacificCyclones(
  rawObservations: WesternPacificObservation[],
  { now = Date.now() }: { now?: number } = {},
): CanonicalCyclone[] {
  const observations = collapseAgencyObservations((Array.isArray(rawObservations) ? rawObservations : [])
    .map((input) => normalizedObservation(input, now))
    .filter((o): o is NormalizedObservation => o !== null));
  const groups: CycloneGroup[] = [];

  for (const observation of observations) {
    let matched: { group: CycloneGroup; confidence: string } | null = null;
    for (const group of groups) {
      const confidence = group.observations
        .map((member) => matchObservations(member, observation))
        .find(Boolean);
      if (confidence) {
        matched = { group, confidence };
        break;
      }
    }
    if (matched) {
      matched.group.observations.push(observation);
      if (matched.group.confidence !== 'alias-bounded') matched.group.confidence = matched.confidence;
    } else {
      groups.push({ observations: [observation], confidence: 'single-source' });
    }
  }

  return groups
    .map((group) => toCanonicalCyclone(group.observations.sort(observationOrder), group.confidence))
    .sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
}

function warningStatus(actionCode: unknown): 'active' | 'cancelled' {
  return /cancel/i.test(String(actionCode || '')) ? 'cancelled' : 'active';
}

// parseHkoWarningSummary maps the HKO warnsum payload's tropical-cyclone signal
// (WTCSGNL) into a single standalone warning pinned at Hong Kong. It is not a
// storm observation (no basin/position), so it never merges into a cyclone — it
// stays independently visible even when no named storm is active.
export function parseHkoWarningSummary(payload: unknown, { now = Date.now() }: { now?: number } = {}): HkoWarning[] {
  const warning = (payload as { WTCSGNL?: Record<string, unknown> })?.WTCSGNL;
  if (!warning || typeof warning !== 'object') return [];
  const observedAt = clampTimestamp(warning.updateTime || warning.issueTime, now);
  return [{
    agency: 'HKO',
    agencyId: String(warning.code || 'WTCSGNL'),
    status: warningStatus(warning.actionCode),
    observedAt,
    sourceName: 'HKO',
    sourceUrl: HKO_WARNING_SOURCE_URL,
    title: `Hong Kong ${String(warning.name || 'Tropical Cyclone Warning Signal').trim()}`,
    description: String(warning.details || warning.contents || '').trim(),
    lat: HKO_COORDINATES.lat,
    lon: HKO_COORDINATES.lon,
  }];
}

// ── GDACS row adapters ───────────────────────────────────────────────────────

function classifyWind(kt: number): string {
  if (kt >= 137) return 'Category 5';
  if (kt >= 113) return 'Category 4';
  if (kt >= 96) return 'Category 3';
  if (kt >= 83) return 'Category 2';
  if (kt >= 64) return 'Category 1';
  if (kt >= 34) return 'Tropical Storm';
  return 'Tropical Depression';
}

// GDACS states neither wind nor pressure as structured fields; both are mined
// from the free-text name/description/severity, converting mph/km·h⁻¹ to knots.
function parseGdacsTcFields(gdacs: GDACSEvent): { stormName?: string; windKt?: number; classification?: string; pressureMb?: number } {
  const fields: { stormName?: string; windKt?: number; classification?: string; pressureMb?: number } = {};

  const name = String(gdacs.name || '');
  const nameMatch = name.match(/(?:Hurricane|Typhoon|Cyclone|Storm|Depression)\s+(.+)/i);
  fields.stormName = nameMatch && nameMatch[1] ? nameMatch[1].trim() : (name.trim() || undefined);

  const desc = `${gdacs.description || ''} ${gdacs.severity || ''}`;
  const windPatterns = [
    /(\d+(?:\.\d+)?)\s*(?:kn(?:ots?)?|kt)/i,
    /(\d+(?:\.\d+)?)\s*mph/i,
    /(\d+(?:\.\d+)?)\s*km\/?h/i,
  ];
  for (let i = 0; i < windPatterns.length; i++) {
    const pattern = windPatterns[i];
    if (!pattern) continue;
    const m = desc.match(pattern);
    if (!m) continue;
    const raw = m[1];
    if (raw) {
      let val = parseFloat(raw);
      if (i === 1) val = Math.round(val * 0.868976);
      else if (i === 2) val = Math.round(val * 0.539957);
      if (val > 0 && val <= 200) {
        const kt = Math.round(val);
        fields.windKt = kt;
        fields.classification = classifyWind(kt);
      }
    }
    break;
  }

  const pressureMatch = desc.match(/(\d{3,4})\s*(?:mb|hPa|mbar)/i);
  if (pressureMatch && pressureMatch[1]) {
    const p = parseInt(pressureMatch[1], 10);
    if (p >= 850 && p <= 1050) fields.pressureMb = p;
  }

  return fields;
}

// Western-Pacific box: 0–50°N, 100–180°E. A GDACS tropical cyclone inside it is
// canonicalized (and folded with HKO) rather than shown as a bare GDACS row.
export function isWesternPacificCyclone(gdacs: GDACSEvent): boolean {
  if (gdacs.eventType !== 'TC') return false;
  const lon = gdacs.coordinates[0];
  const lat = gdacs.coordinates[1];
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= 0 && lat <= 50 && lon >= 100 && lon <= 180;
}

export function toWesternPacificObservation(gdacs: GDACSEvent): WesternPacificObservation {
  const tc = parseGdacsTcFields(gdacs);
  return {
    agency: 'GDACS',
    agencyId: gdacs.id,
    basin: 'WP',
    aliases: tc.stormName ? [tc.stormName] : [],
    stormName: tc.stormName || '',
    lat: gdacs.coordinates[1],
    lon: gdacs.coordinates[0],
    observedAt: gdacs.fromDate.getTime(),
    // GDACS does not state an averaging period; leave it unpaired rather than
    // pretend it is equivalent to an agency advisory.
    windKt: tc.windKt ?? null,
    pressureMb: tc.pressureMb ?? null,
    classification: tc.classification || '',
    sourceName: 'GDACS',
    sourceUrl: gdacs.url,
    sourceEventId: gdacs.id,
  };
}

// buildWesternPacificCyclones is the one composition point: canonical cyclones
// (from storm observations) plus standalone HKO warnings, both projected into
// NaturalEvent under the severeStorms category with the attribution fields set.
export function buildWesternPacificCyclones({
  storms = [],
  hkoWarnings = [],
  now = Date.now(),
}: { storms?: WesternPacificObservation[]; hkoWarnings?: HkoWarning[]; now?: number } = {}): NaturalEvent[] {
  const cyclones = canonicalizeWesternPacificCyclones(storms, { now });
  const cycloneEvents = cyclones.map((c): NaturalEvent => ({
    id: c.id,
    title: `${c.classification || 'Tropical Cyclone'} ${c.stormName}`.trim(),
    description: `${c.stormName || 'Unnamed tropical cyclone'} · ${c.agencyObservations.length} agency observation${c.agencyObservations.length === 1 ? '' : 's'}`,
    category: 'severeStorms',
    categoryTitle: 'Tropical Cyclone',
    lat: c.lat,
    lon: c.lon,
    date: new Date(c.observedAt),
    magnitude: c.windKt ?? undefined,
    magnitudeUnit: c.windKt == null ? undefined : 'kt',
    sourceUrl: c.sourceUrl,
    sourceName: c.sourceName,
    closed: c.closed,
    canonicalId: c.canonicalId,
    matchingConfidence: c.matchingConfidence,
    canonicalAliases: c.canonicalAliases,
    windAveragingPeriodMinutes: c.windAveragingPeriodMinutes,
    agencyObservations: c.agencyObservations,
  }));
  const warningEvents = hkoWarnings.map((wng): NaturalEvent => ({
    id: `hko-warning:${wng.agencyId}`,
    title: wng.title || 'Hong Kong Tropical Cyclone Warning Signal',
    description: wng.description || '',
    category: 'severeStorms',
    categoryTitle: 'Tropical Cyclone Warning',
    lat: wng.lat ?? HKO_COORDINATES.lat,
    lon: wng.lon ?? HKO_COORDINATES.lon,
    date: new Date(wng.observedAt ?? now),
    sourceUrl: wng.sourceUrl || HKO_WARNING_SOURCE_URL,
    sourceName: 'HKO',
    closed: wng.status === 'cancelled',
    agencyObservations: [{
      agency: 'HKO',
      agencyId: wng.agencyId,
      observedAt: wng.observedAt ?? now,
      lat: wng.lat ?? HKO_COORDINATES.lat,
      lon: wng.lon ?? HKO_COORDINATES.lon,
      status: wng.status || 'active',
      sourceName: 'HKO',
      sourceUrl: wng.sourceUrl || HKO_WARNING_SOURCE_URL,
    }],
  }));
  return [...cycloneEvents, ...warningEvents];
}
