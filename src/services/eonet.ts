import type { NaturalEvent, NaturalEventCategory } from '@/types';

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

export async function fetchNaturalEvents(days = 30): Promise<NaturalEvent[]> {
  try {
    const url = `${EONET_API_URL}?status=open&days=${days}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`EONET API error: ${response.status}`);
    }

    const data: EonetResponse = await response.json();
    const events: NaturalEvent[] = [];

    for (const event of data.events) {
      const category = event.categories[0];
      if (!category) continue;

      // Skip earthquakes - USGS provides better data for seismic events
      if (category.id === 'earthquakes') continue;

      // Get most recent geometry point
      const latestGeo = event.geometry[event.geometry.length - 1];
      if (!latestGeo || latestGeo.type !== 'Point') continue;

      const [lon, lat] = latestGeo.coordinates;
      const source = event.sources[0];

      events.push({
        id: event.id,
        title: event.title,
        description: event.description || undefined,
        category: category.id as NaturalEventCategory,
        categoryTitle: category.title,
        lat,
        lon,
        date: new Date(latestGeo.date),
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
