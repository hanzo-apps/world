import '../styles/main.css';
import { ScatterplotLayer } from '@deck.gl/layers';
import type { PickingInfo, LayersList } from '@deck.gl/core';
import { GlobeNative, isNativeGlobeEnabled, type GlobeLayerSource } from '../components/GlobeNative';
import { INTEL_HOTSPOTS } from '../config';
import type { Hotspot } from '../types';

/**
 * Standalone harness for the native deck.gl GlobeView (GlobeNative).
 *
 * It runs GlobeNative WITHOUT any mapbox map or DeckGLMap, so the whole page holds
 * exactly ONE WebGL context — the structural single-context proof the perf spec
 * asserts. The data source is a lightweight ScatterplotLayer of the same
 * INTEL_HOTSPOTS config the map uses, giving a real pickable feature on the sphere
 * without pulling in the mapbox renderer.
 */

type PickResult = { found: boolean; layerId: string | null };

type GlobeHarness = {
  ready: boolean;
  nativeEnabled: boolean;
  getCanvasCount: () => number;
  getViewportType: () => string | null;
  getFirstHotspotLngLat: () => { lon: number; lat: number } | null;
  setCamera: (lon: number, lat: number, zoom: number) => void;
  stopSpin: () => void;
  pickAtLonLat: (lon: number, lat: number, radius?: number) => PickResult;
  setBasemapStyle: (style: 'dark' | 'satellite' | 'terrain') => void;
  getBasemapStyle: () => string;
  destroy: () => void;
};

declare global {
  interface Window {
    __globeHarness?: GlobeHarness;
  }
}

const app = document.getElementById('app');
if (!app) throw new Error('Missing #app container for globe-native harness');

app.style.width = '1280px';
app.style.height = '720px';
app.style.position = 'relative';
app.style.margin = '0 auto';

const hotspotColor = (level?: string): [number, number, number, number] => {
  if (level === 'high') return [255, 68, 68, 220];
  if (level === 'elevated') return [255, 165, 0, 220];
  return [255, 255, 0, 200];
};

// A minimal source: one pickable hotspots layer (id matches the map's own layer id).
const source: GlobeLayerSource = {
  buildLayers(): LayersList {
    return [
      new ScatterplotLayer<Hotspot>({
        id: 'hotspots-layer',
        data: INTEL_HOTSPOTS,
        getPosition: (d) => [d.lon, d.lat],
        getFillColor: (d) => hotspotColor(d.level),
        getRadius: 60000,
        radiusUnits: 'meters',
        radiusMinPixels: 6,
        radiusMaxPixels: 40,
        pickable: true,
        stroked: false,
      }),
    ];
  },
  getTooltip(info: PickingInfo): { html: string } | null {
    const hs = info.object as Hotspot | undefined;
    if (!hs) return null;
    return { html: `<div class="deckgl-tooltip">${hs.name}</div>` };
  },
  handleClick(): void {
    /* no-op for the harness */
  },
};

const globe = new GlobeNative(app, {
  source,
  center: { longitude: 0, latitude: 20, zoom: 0 },
  autoRotate: true,
});

let ready = false;
const pollReady = (): void => {
  const hasCanvas = globe.getCanvasCount() >= 1;
  const hasViewport = globe.getViewportType() != null;
  if (hasCanvas && hasViewport) {
    ready = true;
    return;
  }
  requestAnimationFrame(pollReady);
};
pollReady();

window.__globeHarness = {
  get ready() {
    return ready;
  },
  nativeEnabled: isNativeGlobeEnabled(),
  getCanvasCount: () => globe.getCanvasCount(),
  getViewportType: () => globe.getViewportType(),
  getFirstHotspotLngLat: () => {
    const h = INTEL_HOTSPOTS[0];
    return h ? { lon: h.lon, lat: h.lat } : null;
  },
  // Instant camera move (reduced-motion in the spec makes flyTo jump-cut).
  setCamera: (lon, lat, zoom) => globe.flyTo(lat, lon, zoom),
  stopSpin: () => globe.setAutoRotate(false),
  pickAtLonLat: (lon, lat, radius = 10): PickResult => {
    const deck = globe.getDeck();
    const vp = deck.getViewports()[0] as { project?: (c: [number, number]) => number[] } | undefined;
    if (!vp?.project) return { found: false, layerId: null };
    const projected = vp.project([lon, lat]);
    const x = projected[0];
    const y = projected[1];
    if (x == null || y == null) return { found: false, layerId: null };
    const info = deck.pickObject({ x, y, radius });
    return { found: !!info, layerId: info?.layer?.id ?? null };
  },
  setBasemapStyle: (style) => globe.setBasemapStyle(style),
  getBasemapStyle: () => globe.getBasemapStyle(),
  destroy: () => globe.destroy(),
};
