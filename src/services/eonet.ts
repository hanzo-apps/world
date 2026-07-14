import type { NaturalEvent, NaturalEventCategory } from '@/types';
import { fetchGDACSEvents, type GDACSEvent } from './gdacs';
import {
  buildWesternPacificCyclones,
  isWesternPacificCyclone,
  parseHkoWarningSummary,
  toWesternPacificObservation,
  type HkoWarning,
} from './cyclones';
import { fetchWithProxy } from '@/utils';

interface EonetGeometry {
  magnitudeValue?: number;
  magnitudeUnit?: string;
  date: string;
  type: string;
  coordinates: [number, number];
}

interface EonetSource {
  id: string;
  url: string;
}

interface EonetCategory {
  id: string;
  title: string;
}

interface EonetEvent {
  id: string;
  title: string;
  description: string | null;
  closed: string | null;
  categories: EonetCategory[];
  sources: EonetSource[];
  geometry: EonetGeometry[];
}

interface EonetResponse {
  title: string;
  events: EonetEvent[];
}

const EONET_API_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events';

const CATEGORY_ICONS: Record<NaturalEventCategory, string> = {
  severeStorms: '🌀',
  wildfires: '🔥',
  volcanoes: '🌋',
  earthquakes: '🔴',
  floods: '🌊',
  landslides: '⛰️',
  drought: '☀️',
  dustHaze: '🌫️',
  snow: '❄️',
  tempExtremes: '🌡️',
  seaLakeIce: '🧊',
  waterColor: '🦠',
  manmade: '⚠️',
};

export function getNaturalEventIcon(category: NaturalEventCategory): string {
  return CATEGORY_ICONS[category] || '⚠️';
}

// Wildfires older than 48 hours are filtered out (stale data)
const WILDFIRE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const GDACS_TO_CATEGORY: Record<string, NaturalEventCategory> = {
  EQ: 'earthquakes',
  FL: 'floods',
  TC: 'severeStorms',
  VO: 'volcanoes',
  WF: 'wildfires',
  DR: 'drought',
};

function convertGDACSToNaturalEvent(gdacs: GDACSEvent): NaturalEvent {
  const category = GDACS_TO_CATEGORY[gdacs.eventType] || 'manmade';
  return {
    id: gdacs.id,
    title: `${gdacs.alertLevel === 'Red' ? '🔴 ' : gdacs.alertLevel === 'Orange' ? '🟠 ' : ''}${gdacs.name}`,
    description: `${gdacs.description}${gdacs.severity ? ` - ${gdacs.severity}` : ''}`,
    category,
    categoryTitle: gdacs.description,
    lat: gdacs.coordinates[1],
    lon: gdacs.coordinates[0],
    date: gdacs.fromDate,
    sourceUrl: gdacs.url,
    sourceName: 'GDACS',
    closed: false,
  };
}

// The Go proxy (/v1/world/hko-warnings) fronts data.weather.gov.hk, which has no
// CORS; the browser can only reach it through here.
const HKO_WARNINGS_URL = '/v1/world/hko-warnings';

async function fetchHkoWarnings(): Promise<HkoWarning[]> {
  try {
    const response = await fetchWithProxy(HKO_WARNINGS_URL);
    if (!response.ok) throw new Error(`HKO warnings error: ${response.status}`);
    return parseHkoWarningSummary(await response.json());
  } catch (error) {
    console.error('[HKO] Failed to fetch tropical-cyclone warnings:', error);
    return [];
  }
}

export async function fetchNaturalEvents(days = 30): Promise<NaturalEvent[]> {
  const [eonetEvents, gdacsEvents, hkoWarnings] = await Promise.all([
    fetchEonetEvents(days),
    fetchGDACSEvents(),
    fetchHkoWarnings(),
  ]);

  // Western-Pacific GDACS cyclones + HKO warnings fold into canonical, multi-agency
  // cyclones. The raw GDACS rows they consume are excluded from the plain mapping
  // so a storm is never counted twice.
  const wpCandidates = gdacsEvents.filter(isWesternPacificCyclone);
  const wpConsumedIds = new Set(wpCandidates.map((e) => e.id));
  const westernPacificEvents = buildWesternPacificCyclones({
    storms: wpCandidates.map(toWesternPacificObservation),
    hkoWarnings,
  });

  console.log(`[NaturalEvents] EONET: ${eonetEvents.length}, GDACS: ${gdacsEvents.length}, WP-cyclones: ${westernPacificEvents.length}`);
  const gdacsConverted = gdacsEvents
    .filter((e) => !wpConsumedIds.has(e.id))
    .map(convertGDACSToNaturalEvent);

  const seenLocations = new Set<string>();
  const merged: NaturalEvent[] = [];

  // Canonical WP cyclones first (highest-quality), then plain GDACS, then EONET —
  // the first writer per location key wins the dedup.
  for (const event of [...westernPacificEvents, ...gdacsConverted, ...eonetEvents]) {
    const key = `${event.lat.toFixed(1)}-${event.lon.toFixed(1)}-${event.category}`;
    if (!seenLocations.has(key)) {
      seenLocations.add(key);
      merged.push(event);
    }
  }

  return merged;
}

async function fetchEonetEvents(days: number): Promise<NaturalEvent[]> {
  try {
    const url = `${EONET_API_URL}?status=open&days=${days}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`EONET API error: ${response.status}`);
    }

    const data: EonetResponse = await response.json();
    const events: NaturalEvent[] = [];
    const now = Date.now();

    for (const event of data.events) {
      const category = event.categories[0];
      if (!category) continue;

      // Skip earthquakes - USGS provides better data for seismic events
      if (category.id === 'earthquakes') continue;

      // Get most recent geometry point
      const latestGeo = event.geometry[event.geometry.length - 1];
      if (!latestGeo || latestGeo.type !== 'Point') continue;

      const eventDate = new Date(latestGeo.date);
      const [lon, lat] = latestGeo.coordinates;
      const source = event.sources[0];

      // Filter out wildfires older than 48 hours
      if (category.id === 'wildfires' && now - eventDate.getTime() > WILDFIRE_MAX_AGE_MS) {
        continue;
      }

      events.push({
        id: event.id,
        title: event.title,
        description: event.description || undefined,
        category: category.id as NaturalEventCategory,
        categoryTitle: category.title,
        lat,
        lon,
        date: eventDate,
        magnitude: latestGeo.magnitudeValue,
        magnitudeUnit: latestGeo.magnitudeUnit,
        sourceUrl: source?.url,
        sourceName: source?.id,
        closed: event.closed !== null,
      });
    }

    return events;
  } catch (error) {
    console.error('[EONET] Failed to fetch natural events:', error);
    return [];
  }
}
