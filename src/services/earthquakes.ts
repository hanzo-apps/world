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

const CORS_PROXY = 'https://corsproxy.io/?';
const DIRECT_USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson';

const breaker = createCircuitBreaker<Earthquake[]>({ name: 'USGS Earthquakes' });

async function fetchWithTimeout(url: string, timeoutMs: number = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

export async function fetchEarthquakes(): Promise<Earthquake[]> {
  return breaker.execute(async () => {
    const url = import.meta.env.DEV ? API_URLS.earthquakes : (CORS_PROXY + encodeURIComponent(DIRECT_USGS_URL));
    const response = await fetchWithTimeout(url, 8000);
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
