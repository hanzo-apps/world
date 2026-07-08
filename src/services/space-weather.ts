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

function parseKp(raw: unknown): { kp: number | null; time: Date | null } {
  if (!Array.isArray(raw) || raw.length < 2) return { kp: null, time: null };
  const last = raw[raw.length - 1];
  if (!Array.isArray(last)) return { kp: null, time: null };
  const kp = Number(last[1]);
  const time = last[0] ? new Date(String(last[0]).replace(' ', 'T') + 'Z') : null;
  return { kp: Number.isFinite(kp) ? kp : null, time };
}

function parseAlerts(raw: unknown): SpaceWeatherAlert[] {
  if (!Array.isArray(raw)) return [];
  const wanted = /ALERT|WARNING|WATCH/i;
  const out: SpaceWeatherAlert[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as { product_id?: string; issue_datetime?: string; message?: string };
    const message = String(rec.message ?? '').trim();
    if (!message || !wanted.test(message)) continue;
    // First line of the message is the headline.
    const headline = message.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? message;
    out.push({
      id: `swpc:${rec.product_id ?? headline}:${rec.issue_datetime ?? ''}`,
      message: headline.slice(0, 160),
      issued: rec.issue_datetime ? new Date(String(rec.issue_datetime).replace(' ', 'T') + 'Z') : new Date(),
    });
  }
  return out
    .sort((a, b) => b.issued.getTime() - a.issued.getTime())
    .slice(0, 12);
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
