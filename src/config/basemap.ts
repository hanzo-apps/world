import { Protocol } from 'pmtiles';
import maplibregl from 'maplibre-gl';
import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';

const R2_BASE = import.meta.env.VITE_PMTILES_URL ?? '';

const hasTilesUrl = !!R2_BASE;

let registered = false;

export function registerPMTilesProtocol(): void {
  if (registered) return;
  registered = true;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
}

export function buildPMTilesStyle(theme: 'dark' | 'light'): StyleSpecification | null {
  if (!hasTilesUrl) return null;
  const flavor = theme === 'light' ? 'light' : 'dark';
  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${flavor}`,
    sources: {
      basemap: {
        type: 'vector',
        url: `pmtiles://${R2_BASE}`,
        attribution: '<a href="https://protomaps.com">Protomaps</a> | <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: layers('basemap', namedFlavor(flavor), { lang: 'en' }) as StyleSpecification['layers'],
  };
}

export const FALLBACK_DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
export const FALLBACK_LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/positron';

export type MapProvider = 'auto' | 'pmtiles' | 'openfreemap' | 'carto';

const STORAGE_KEY = 'wm-map-provider';

export { hasTilesUrl as hasPMTilesUrl };

export const MAP_PROVIDER_OPTIONS: { value: MapProvider; label: string }[] = (() => {
  const opts: { value: MapProvider; label: string }[] = [];
  if (hasTilesUrl) {
    opts.push({ value: 'auto', label: 'Auto (PMTiles → OpenFreeMap fallback)' });
    opts.push({ value: 'pmtiles', label: 'PMTiles (self-hosted)' });
  }
  opts.push({ value: 'openfreemap', label: 'OpenFreeMap' });
  opts.push({ value: 'carto', label: 'CARTO' });
  return opts;
})();

export function getMapProvider(): MapProvider {
  const stored = localStorage.getItem(STORAGE_KEY) as MapProvider | null;
  if (stored) {
    if (stored === 'pmtiles' || stored === 'auto') {
      return hasTilesUrl ? stored : 'openfreemap';
    }
    return stored;
  }
  return hasTilesUrl ? 'auto' : 'openfreemap';
}

export function setMapProvider(provider: MapProvider): void {
  localStorage.setItem(STORAGE_KEY, provider);
}

const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const CARTO_LIGHT = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

export function getStyleForProvider(provider: MapProvider, theme: 'dark' | 'light'): StyleSpecification | string {
  switch (provider) {
    case 'pmtiles': {
      const style = buildPMTilesStyle(theme);
      if (style) return style;
      return theme === 'light' ? FALLBACK_LIGHT_STYLE : FALLBACK_DARK_STYLE;
    }
    case 'openfreemap':
      return theme === 'light' ? FALLBACK_LIGHT_STYLE : FALLBACK_DARK_STYLE;
    case 'carto':
      return theme === 'light' ? CARTO_LIGHT : CARTO_DARK;
    case 'auto':
    default: {
      const pmtiles = buildPMTilesStyle(theme);
      return pmtiles ?? (theme === 'light' ? FALLBACK_LIGHT_STYLE : FALLBACK_DARK_STYLE);
    }
  }
}
