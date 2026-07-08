import { createCircuitBreaker } from '@/utils';
import { registerWorldFeed, type WorldFeed, type WorldFeedItem, type WorldFeedSeverity } from './world-feed';

// NOAA Space Weather Prediction Center — free, no key, CORS-enabled.
// Geomagnetic conditions affect satellites, GPS, power grids, aviation and HF
// comms: a genuinely global world-model signal.
const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const ALERTS_URL = 'https://services.swpc.noaa.gov/products/alerts.json';

export interface SpaceWeatherAlert {
  id: string;
  message: string;
  issued: Date;
}

export interface SpaceWeatherState {
  kp: number | null;
  kpTime: Date | null;
  stormLevel: string;   // 'Quiet', 'G1 (Minor)', ... 'G5 (Extreme)'
  alerts: SpaceWeatherAlert[];
  insight: string;
  updatedAt: Date;
}

const breaker = createCircuitBreaker<SpaceWeatherState>({ name: 'NOAA Space Weather', cacheTtlMs: 5 * 60 * 1000 });

function stormLevel(kp: number | null): string {
  if (kp === null) return 'Unknown';
  if (kp >= 9) return 'G5 (Extreme)';
  if (kp >= 8) return 'G4 (Severe)';
  if (kp >= 7) return 'G3 (Strong)';
  if (kp >= 6) return 'G2 (Moderate)';
  if (kp >= 5) return 'G1 (Minor)';
  if (kp >= 4) return 'Unsettled';
  return 'Quiet';
}

function kpSeverity(kp: number | null): WorldFeedSeverity {
  if (kp === null) return 'info';
  if (kp >= 8) return 'critical';
  if (kp >= 7) return 'high';
  if (kp >= 5) return 'elevated';
  if (kp >= 4) return 'low';
  return 'info';
}

function toUtcDate(raw: unknown): Date | null {
  if (!raw) return null;
  const s = String(raw).replace(' ', 'T');
  return new Date(s.endsWith('Z') ? s : s + 'Z');
}

function parseKp(raw: unknown): { kp: number | null; time: Date | null } {
  if (!Array.isArray(raw) || raw.length === 0) return { kp: null, time: null };
  const last = raw[raw.length - 1];
  let kpRaw: unknown;
  let timeRaw: unknown;
  if (Array.isArray(last)) {
    // Legacy [time_tag, Kp, a_running, station_count] rows (with header row).
    timeRaw = last[0];
    kpRaw = last[1];
  } else if (last && typeof last === 'object') {
    const rec = last as { Kp?: unknown; kp?: unknown; kp_index?: unknown; time_tag?: unknown };
    kpRaw = rec.Kp ?? rec.kp ?? rec.kp_index;
    timeRaw = rec.time_tag;
  } else {
    return { kp: null, time: null };
  }
  const kp = Number(kpRaw);
  return { kp: Number.isFinite(kp) ? kp : null, time: toUtcDate(timeRaw) };
}

const DESCRIPTIVE = /^(ALERT|WARNING|WATCH|SUMMARY|EXTENDED WARNING|CANCEL WARNING|CONTINUED ALERT):/i;

function parseAlerts(raw: unknown): SpaceWeatherAlert[] {
  if (!Array.isArray(raw)) return [];
  const wanted = /ALERT|WARNING|WATCH/i;
  const out: SpaceWeatherAlert[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as { product_id?: string; issue_datetime?: string; message?: string };
    const message = String(rec.message ?? '').trim();
    if (!message || !wanted.test(message)) continue;
    // Prefer the descriptive line (e.g. "ALERT: Geomagnetic K-index of 5");
    // the leading "Space Weather Message Code: ..." line is not human-friendly.
    const lines = message.split('\n').map((l) => l.trim()).filter(Boolean);
    const headline = lines.find((l) => DESCRIPTIVE.test(l)) ?? lines[0] ?? message;
    out.push({
      id: `swpc:${rec.product_id ?? headline}:${rec.issue_datetime ?? ''}`,
      message: headline.slice(0, 160),
      issued: toUtcDate(rec.issue_datetime) ?? new Date(),
    });
  }
  const sorted = out.sort((a, b) => b.issued.getTime() - a.issued.getTime());
  const seen = new Set<string>();
  const deduped: SpaceWeatherAlert[] = [];
  for (const a of sorted) {
    if (seen.has(a.message)) continue;
    seen.add(a.message);
    deduped.push(a);
    if (deduped.length >= 12) break;
  }
  return deduped;
}

export async function fetchSpaceWeather(): Promise<SpaceWeatherState> {
  return breaker.execute(async () => {
    const [kpRes, alertsRes] = await Promise.allSettled([
      fetch(KP_URL, { headers: { Accept: 'application/json' } }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      fetch(ALERTS_URL, { headers: { Accept: 'application/json' } }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    ]);

    if (kpRes.status !== 'fulfilled' && alertsRes.status !== 'fulfilled') {
      throw new Error('space weather sources unavailable');
    }

    const { kp, time } = kpRes.status === 'fulfilled' ? parseKp(kpRes.value) : { kp: null, time: null };
    const alerts = alertsRes.status === 'fulfilled' ? parseAlerts(alertsRes.value) : [];
    const level = stormLevel(kp);

    return {
      kp,
      kpTime: time,
      stormLevel: level,
      alerts,
      insight: `Kp ${kp ?? '—'} · ${level} · ${alerts.length} active advisories`,
      updatedAt: new Date(),
    };
  }, { kp: null, kpTime: null, stormLevel: 'Unknown', alerts: [], insight: 'unavailable', updatedAt: new Date() });
}

async function buildFeed(): Promise<WorldFeed> {
  const state = await fetchSpaceWeather();
  const items: WorldFeedItem[] = [
    {
      id: 'space-weather:kp',
      title: `Planetary Kp ${state.kp ?? '—'} — ${state.stormLevel}`,
      summary: 'Global geomagnetic activity index (NOAA SWPC).',
      category: 'geomagnetic',
      severity: kpSeverity(state.kp),
      timestamp: (state.kpTime ?? state.updatedAt).toISOString(),
    },
    ...state.alerts.map((a) => ({
      id: `space-weather:${a.id}`,
      title: a.message,
      category: 'advisory',
      severity: 'elevated' as WorldFeedSeverity,
      timestamp: a.issued.toISOString(),
    })),
  ];
  return {
    domain: 'space-weather',
    label: 'Space Weather',
    updatedAt: state.updatedAt.toISOString(),
    source: 'NOAA SWPC (planetary K-index + alerts)',
    live: state.kp !== null || state.alerts.length > 0,
    insight: state.insight,
    items,
  };
}

export function getSpaceWeatherFeed(): Promise<WorldFeed> {
  return buildFeed();
}

export function getSpaceWeatherStatus(): string {
  return breaker.getStatus();
}

registerWorldFeed('space-weather', getSpaceWeatherFeed);
