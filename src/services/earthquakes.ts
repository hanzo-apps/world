import type { Earthquake } from '@/types';
import { API_URLS } from '@/config';
import { createCircuitBreaker } from '@/utils';

interface USGSFeature {
  id: string;
  properties: {
    place: string;
    mag: number;
    time: number;
    url: string;
  };
  geometry: {
    coordinates: [number, number, number];
  };
}

interface USGSResponse {
  features: USGSFeature[];
}

const breaker = createCircuitBreaker<Earthquake[]>({ name: 'USGS Earthquakes' });

export async function fetchEarthquakes(): Promise<Earthquake[]> {
  return breaker.execute(async () => {
    const response = await fetch(API_URLS.earthquakes);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data: USGSResponse = await response.json();
    return data.features.map((feature) => ({
      id: feature.id,
      place: feature.properties.place || 'Unknown',
      magnitude: feature.properties.mag,
      lon: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1],
      depth: feature.geometry.coordinates[2],
      time: new Date(feature.properties.time),
      url: feature.properties.url,
    }));
  }, []);
}

export function getEarthquakesStatus(): string {
  return breaker.getStatus();
}
