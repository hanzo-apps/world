import type { MapLayers } from '@/types';
import type { MapView, TimeRange } from '@/components/Map';
import type { MapProjectionMode } from '@/components/MapContainer';
import { SITE_VARIANT } from '@/config/variant';

const LAYER_KEYS: (keyof MapLayers)[] = [
  'conflicts',
  'bases',
  'cables',
  'pipelines',
  'hotspots',
  'ais',
  'nuclear',
  'irradiators',
  'sanctions',
  'weather',
  'economic',
  'waterways',
  'outages',
  'cyberThreats',
  'datacenters',
  'protests',
  'flights',
  'military',
  'natural',
  'spaceports',
  'minerals',
  'fires',
  'ucdpEvents',
  'displacement',
  'climate',
  'startupHubs',
  'cloudRegions',
  'accelerators',
  'techHQs',
  'techEvents',
];

const TIME_RANGES: TimeRange[] = ['1h', '6h', '24h', '48h', '7d', 'all'];
const VIEW_VALUES: MapView[] = ['global', 'america', 'mena', 'eu', 'asia', 'latam', 'africa', 'oceania'];

export interface ParsedMapUrlState {
  view?: MapView;
  zoom?: number;
  lat?: number;
  lon?: number;
  timeRange?: TimeRange;
  layers?: MapLayers;
  country?: string;
  mode?: MapProjectionMode;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function parseMapUrlState(
  search: string,
  fallbackLayers: MapLayers
): ParsedMapUrlState {
  const params = new URLSearchParams(search);

  const viewParam = params.get('view');
  const view = VIEW_VALUES.includes(viewParam as MapView) ? (viewParam as MapView) : undefined;

  const zoomParam = params.get('zoom');
  const zoomValue = zoomParam ? Number.parseFloat(zoomParam) : NaN;
  const zoom = Number.isFinite(zoomValue) ? clamp(zoomValue, 1, 10) : undefined;

  const latParam = params.get('lat');
  const lonParam = params.get('lon');
  const latValue = latParam ? Number.parseFloat(latParam) : NaN;
  const lonValue = lonParam ? Number.parseFloat(lonParam) : NaN;
  const lat = Number.isFinite(latValue) ? clamp(latValue, -90, 90) : undefined;
  const lon = Number.isFinite(lonValue) ? clamp(lonValue, -180, 180) : undefined;

  const timeRangeParam = params.get('timeRange');
  const timeRange = TIME_RANGES.includes(timeRangeParam as TimeRange)
    ? (timeRangeParam as TimeRange)
    : undefined;

  const countryParam = params.get('country');
  const country = countryParam && /^[A-Z]{2}$/i.test(countryParam.trim()) ? countryParam.trim().toUpperCase() : undefined;

  const modeParam = params.get('mode');
  const mode: MapProjectionMode | undefined =
    modeParam === '3d' ? '3d' : modeParam === '2d' ? '2d' : undefined;

  const layersParam = params.get('layers');
  let layers: MapLayers | undefined;
  if (layersParam !== null) {
    layers = { ...fallbackLayers };
    const normalizedLayers = layersParam.trim();
    if (normalizedLayers !== '' && normalizedLayers !== 'none') {
      const requested = new Set(
        normalizedLayers
          .split(',')
          .map((layer) => layer.trim())
          .filter(Boolean)
      );
      LAYER_KEYS.forEach((key) => {
        layers![key] = requested.has(key);
      });
    } else {
      LAYER_KEYS.forEach((key) => {
        layers![key] = false;
      });
    }
  }

  return {
    view,
    zoom,
    lat,
    lon,
    timeRange,
    layers,
    country,
    mode,
  };
}

export function buildMapUrl(
  baseUrl: string,
  state: {
    view: MapView;
    zoom: number;
    center?: { lat: number; lon: number } | null;
    timeRange: TimeRange;
    layers: MapLayers;
    country?: string;
    mode?: MapProjectionMode;
  }
): string {
  const url = new URL(baseUrl);
  const params = new URLSearchParams();

  // Keep the active variant in every synced/shared URL. buildMapUrl rebuilds the
  // query from scratch, so without this the map-state sync (and Copy Link, which
  // shares the same builder) would strip ?variant= and silently drop a crypto/
  // finance/tech/ai/saas viewer back to the default 'full' dashboard on reload.
  // 'full' is the canonical default and needs no param — keeps default URLs clean.
  if (SITE_VARIANT && SITE_VARIANT !== 'full') {
    params.set('variant', SITE_VARIANT);
  }

  if (state.center) {
    params.set('lat', state.center.lat.toFixed(4));
    params.set('lon', state.center.lon.toFixed(4));
  }

  params.set('zoom', state.zoom.toFixed(2));
  params.set('view', state.view);
  params.set('timeRange', state.timeRange);

  const activeLayers = LAYER_KEYS.filter((layer) => state.layers[layer]);
  params.set('layers', activeLayers.length > 0 ? activeLayers.join(',') : 'none');

  if (state.country) {
    params.set('country', state.country);
  }

  // Only emit mode when in globe (3D) — keeps default 2D share URLs clean.
  if (state.mode === '3d') {
    params.set('mode', '3d');
  }

  url.search = params.toString();
  return url.toString();
}
