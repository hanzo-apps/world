import { fetchGDACSEvents, type GDACSEvent } from './gdacs';
import { fetchWeatherAlerts, type WeatherAlert } from './weather';
import { registerWorldFeed, type WorldFeed, type WorldFeedItem, type WorldFeedSeverity } from './world-feed';

// Global severe-weather lens. Composes existing feeds — GDACS (worldwide
// cyclones/floods/droughts/wildfires) + NWS (US alerts) — into one weather
// stream. No new external API.

export type SevereWeatherKind = 'cyclone' | 'flood' | 'drought' | 'wildfire' | 'storm' | 'other';

export interface SevereWeatherEvent {
  id: string;
  kind: SevereWeatherKind;
  title: string;
  region: string;
  severity: WorldFeedSeverity;
  lat?: number;
  lon?: number;
  time: Date;
  source: 'GDACS' | 'NWS';
  url?: string;
}

export interface GlobalWeatherData {
  events: SevereWeatherEvent[];
  insight: string;
  updatedAt: Date;
}

const GDACS_WEATHER_KIND: Record<string, SevereWeatherKind | undefined> = {
  TC: 'cyclone',
  FL: 'flood',
  DR: 'drought',
  WF: 'wildfire',
};

function gdacsSeverity(level: GDACSEvent['alertLevel']): WorldFeedSeverity {
  if (level === 'Red') return 'critical';
  if (level === 'Orange') return 'high';
  return 'elevated';
}

function nwsSeverity(severity: WeatherAlert['severity']): WorldFeedSeverity {
  switch (severity) {
    case 'Extreme': return 'critical';
    case 'Severe': return 'high';
    case 'Moderate': return 'elevated';
    case 'Minor': return 'low';
    default: return 'info';
  }
}

function fromGDACS(events: GDACSEvent[]): SevereWeatherEvent[] {
  const out: SevereWeatherEvent[] = [];
  for (const e of events) {
    const kind = GDACS_WEATHER_KIND[e.eventType];
    if (!kind) continue; // skip EQ/VO — geologic, not weather
    const [lon, lat] = e.coordinates;
    out.push({
      id: e.id,
      kind,
      title: e.name || e.description,
      region: e.country || '',
      severity: gdacsSeverity(e.alertLevel),
      lat,
      lon,
      time: e.fromDate,
      source: 'GDACS',
      url: e.url || undefined,
    });
  }
  return out;
}

function fromNWS(alerts: WeatherAlert[]): SevereWeatherEvent[] {
  return alerts.map((a) => ({
    id: `nws:${a.id}`,
    kind: 'storm' as SevereWeatherKind,
    title: a.event,
    region: a.areaDesc,
    severity: nwsSeverity(a.severity),
    lat: a.centroid?.[1],
    lon: a.centroid?.[0],
    time: a.onset,
    source: 'NWS' as const,
  }));
}

const SEV_RANK: Record<WorldFeedSeverity, number> = { critical: 5, high: 4, elevated: 3, low: 2, info: 1 };

export async function getGlobalWeatherData(): Promise<GlobalWeatherData> {
  const [gdacs, nws] = await Promise.allSettled([fetchGDACSEvents(), fetchWeatherAlerts()]);
  const events = [
    ...(gdacs.status === 'fulfilled' ? fromGDACS(gdacs.value) : []),
    ...(nws.status === 'fulfilled' ? fromNWS(nws.value) : []),
  ].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.time.getTime() - a.time.getTime());

  const count = (k: SevereWeatherKind) => events.filter((e) => e.kind === k).length;
  const insight = `${count('cyclone')} cyclones · ${count('flood')} floods · ${count('wildfire')} wildfires · ${count('storm')} US alerts`;
  return { events, insight, updatedAt: new Date() };
}

async function buildFeed(): Promise<WorldFeed> {
  const data = await getGlobalWeatherData();
  const items: WorldFeedItem[] = data.events.slice(0, 50).map((e) => ({
    id: `weather:${e.id}`,
    title: e.title,
    summary: `${e.kind} · ${e.region}`,
    category: e.kind,
    url: e.url,
    timestamp: e.time.toISOString(),
    lat: e.lat,
    lon: e.lon,
    severity: e.severity,
    tags: [e.source, e.kind],
  }));
  return {
    domain: 'weather',
    label: 'Severe Weather',
    updatedAt: data.updatedAt.toISOString(),
    source: 'GDACS (global) + NWS (US)',
    live: data.events.length > 0,
    insight: data.insight,
    items,
  };
}

export function getGlobalWeatherFeed(): Promise<WorldFeed> {
  return buildFeed();
}

registerWorldFeed('weather', getGlobalWeatherFeed);
