/**
 * DeckGLMap - WebGL-accelerated map visualization for desktop
 * Uses deck.gl for high-performance rendering of large datasets
 * Mobile devices gracefully degrade to the D3/SVG-based Map component
 */
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer, LayersList, PickingInfo } from '@deck.gl/core';
import { GeoJsonLayer, ScatterplotLayer, PathLayer, IconLayer, TextLayer, BitmapLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import mapboxgl from 'mapbox-gl';
import type { Map as MapboxMap, IControl, FilterSpecification } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import Supercluster from 'supercluster';
import type {
  MapLayers,
  Hotspot,
  NewsItem,
  Earthquake,
  InternetOutage,
  RelatedAsset,
  AssetType,
  AisDisruptionEvent,
  AisDensityZone,
  CableAdvisory,
  RepairShip,
  SocialUnrestEvent,
  AIDataCenter,
  AirportDelayAlert,
  MilitaryFlight,
  MilitaryVessel,
  MilitaryFlightCluster,
  MilitaryVesselCluster,
  NaturalEvent,
  UcdpGeoEvent,
  DisplacementFlow,
  ClimateAnomaly,
  MapProtestCluster,
  MapTechHQCluster,
  MapTechEventCluster,
  MapDatacenterCluster,
  CyberThreat,
} from '@/types';
import { ArcLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import {
  getChainNodes,
  getByoGpu,
  getTraffic,
  getTrafficGlobe,
  type ChainNetwork,
  type ByoGpu,
  type TrafficArc,
  type TrafficGlobePoint,
} from '@/services/cloud-map';
import type { WeatherAlert } from '@/services/weather';
import { escapeHtml } from '@/utils/sanitize';
import { icon } from '@/utils/icons';
import { t } from '@/services/i18n';
import { debounce, rafSchedule, getCurrentTheme } from '@/utils/index';
import {
  INTEL_HOTSPOTS,
  CONFLICT_ZONES,
  MILITARY_BASES,
  UNDERSEA_CABLES,
  NUCLEAR_FACILITIES,
  GAMMA_IRRADIATORS,
  PIPELINES,
  PIPELINE_COLORS,
  STRATEGIC_WATERWAYS,
  ECONOMIC_CENTERS,
  AI_DATA_CENTERS,
  SITE_VARIANT,
  STARTUP_HUBS,
  ACCELERATORS,
  TECH_HQS,
  CLOUD_REGIONS,
  PORTS,
  SPACEPORTS,
  APT_GROUPS,
  CRITICAL_MINERALS,
  STOCK_EXCHANGES,
  FINANCIAL_CENTERS,
  CENTRAL_BANKS,
  COMMODITY_HUBS,
  GULF_INVESTMENTS,
} from '@/config';
import { ROBOTICS_ORGS, roboticsCategoryColor } from '@/config/robotics';
import { QUANTUM_PLAYERS, quantumModalityColor } from '@/config/quantum';
import { DEFAULT_BASEMAP_STYLE } from '@/config/variant';
import type { GulfInvestment } from '@/types';
import { MapPopup, type PopupType } from './MapPopup';
import { AnimatedArcLayer } from './AnimatedArcLayer';
import {
  updateHotspotEscalation,
  getHotspotEscalation,
  setMilitaryData,
  setCIIGetter,
  setGeoAlertGetter,
} from '@/services/hotspot-escalation';
import { getCountryScore } from '@/services/country-instability';
import { getAlertsNearLocation } from '@/services/geo-convergence';
import { getCountriesGeoJson, getCountryAtCoordinates } from '@/services/country-geometry';
import { getLandDots, type LandDot, LAND_DOT_NEAR } from '@/services/land-dots';
import { isNativeGlobeEnabled, isNonLeftClick, type GlobeLayerSource, type MapClickEvent } from './GlobeNative';

export type TimeRange = '1h' | '6h' | '24h' | '48h' | '7d' | 'all';
export type DeckMapView = 'global' | 'america' | 'mena' | 'eu' | 'asia' | 'latam' | 'africa' | 'oceania';
// Projection mode: '2d' = flat Mercator map, '3d' = spinnable globe.
// deck.gl's MapboxOverlay derives its view (MapView vs _GlobeView) from
// mapbox's projection each render cycle, so all lat/lon layers are shared.
export type MapProjectionMode = '2d' | '3d';
type MapInteractionMode = 'flat' | '3d';

export interface CountryClickPayload {
  lat: number;
  lon: number;
  code?: string;
  name?: string;
}

interface DeckMapState {
  zoom: number;
  pan: { x: number; y: number };
  view: DeckMapView;
  layers: MapLayers;
  timeRange: TimeRange;
  mode: MapProjectionMode;
}

// Callers may omit `mode` (defaults to '2d'); everything internal treats it as required.
type DeckMapInitialState = Omit<DeckMapState, 'mode'> & {
  mode?: MapProjectionMode;
  // Optional host for the chromeless map controls (2D/3D toggle, basemap style
  // switcher, time-range pills). When supplied — e.g. the bottom toolbar dock —
  // those three controls mount there instead of overlaying the map. The layer
  // panel, zoom controls and legend always stay map overlays. Defaults to the
  // map container, so standalone/harness usage is unchanged.
  controlsHost?: HTMLElement;
};

interface HotspotWithBreaking extends Hotspot {
  hasBreaking?: boolean;
}

interface TechEventMarker {
  id: string;
  title: string;
  location: string;
  lat: number;
  lng: number;
  country: string;
  startDate: string;
  endDate: string;
  url: string | null;
  daysUntil: number;
}

// One chain-node scatter point: a validator node position carrying its network
// context so the tooltip can read "Lux Network · block 12,345 · 42 peers".
interface ChainDot {
  lat: number;
  lon: number;
  city: string;
  kind: string;
  networkName: string;
  chainId: number;
  blockHeight: number;
  peers: number;
  live: boolean;
}

// View presets with longitude, latitude, zoom
const VIEW_PRESETS: Record<DeckMapView, { longitude: number; latitude: number; zoom: number }> = {
  global: { longitude: 0, latitude: 20, zoom: 1.5 },
  america: { longitude: -95, latitude: 38, zoom: 3 },
  mena: { longitude: 45, latitude: 28, zoom: 3.5 },
  eu: { longitude: 15, latitude: 50, zoom: 3.5 },
  asia: { longitude: 105, latitude: 35, zoom: 3 },
  latam: { longitude: -60, latitude: -15, zoom: 3 },
  africa: { longitude: 20, latitude: 5, zoom: 3 },
  oceania: { longitude: 135, latitude: -25, zoom: 3.5 },
};

const MAP_INTERACTION_MODE: MapInteractionMode =
  import.meta.env.VITE_MAP_INTERACTION_MODE === 'flat' ? 'flat' : '3d';

// Mapbox GL v3 renderer — native globe projection + monochrome atmosphere for a
// smooth, modern 2D↔3D experience. The token is a publishable (`pk`) key by
// design; the env override lets deployments swap it. Recommend URL-restricting
// this token to world.hanzo.ai in the Mapbox dashboard.
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
  || '';
mapboxgl.accessToken = MAPBOX_TOKEN;

// Theme-aware basemap vector style URLs — CartoDB's dark-matter/voyager GL styles
// render natively in mapbox-gl v3. Dark-matter is a pure monochrome vercel-black
// basemap (near-black land, faint grey borders, minimal labels), so the renderer
// swap keeps the exact locked aesthetic while gaining mapbox's fast globe + fog.
const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const LIGHT_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

// Keyless RASTER basemap tiles (CartoDB, CORS-enabled) rendered by DECK — the
// fallback when no Mapbox token is configured. mapbox-gl v3 refuses to paint ANY
// basemap without a token (the whole canvas goes black even though third-party
// tiles fetch fine), so we drape a deck raster basemap under the data layers,
// token-free, exactly like the data dots and the native ESRI globe. Subdomains
// a–d round-robin to spread the tile fan-out.
const CARTO_DARK_RASTER = [
  'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
  'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
  'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
  'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
];
const CARTO_LIGHT_RASTER = [
  'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
  'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
  'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
  'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
];

// CartoDB's CJK glyph fonts 403 on CORS and spam the console with failed glyph
// fetches whenever a Chinese/Korean/Japanese label is in view. We repoint those
// glyph requests at a CORS-open Latin font already in the style (transformRequest
// below), so CJK labels fall back cleanly (Latin/tofu) with zero failed requests.
const CJK_GLYPH_RE = /HanWang|NanumBarun|Noto\s?Sans\s?(?:CJK|JP|KR|SC|TC)|MHei|Hiragino|Yu\s?Gothic|Microsoft\s?YaHei|PingFang|Source\s?Han/i;
const GLYPH_FALLBACK_STACK = 'Montserrat%20Medium';

// Optional "nicer" Mapbox basemaps, orthogonal to the dark/light theme. `dark`
// keeps the locked monochrome CartoDB aesthetic (theme-aware); `satellite` and
// `terrain` are true Mapbox styles and therefore need a configured VITE_MAPBOX_TOKEN.
// Terrain additionally drapes the outdoors style over the Mapbox DEM for real relief.
const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';
const TERRAIN_STYLE = 'mapbox://styles/mapbox/outdoors-v12';
const TERRAIN_DEM_SOURCE_ID = 'mapbox-dem';
const TERRAIN_DEM_URL = 'mapbox://mapbox.mapbox-terrain-dem-v1';
const TERRAIN_EXAGGERATION = 1.4;
const BASEMAP_STYLE_KEY = 'hanzo-world-basemap-style';
export type BasemapStyle = 'dark' | 'dot' | 'satellite' | 'terrain';
const BASEMAP_STYLES: BasemapStyle[] = ['dark', 'dot', 'satellite', 'terrain'];
// `satellite`/`terrain` are bright rasters: data dots need a thin dark halo to stay
// legible. Persisted position/order for the draggable layer panel live here too so
// there is one place per concern.
const isBrightBasemap = (s: BasemapStyle): boolean => s === 'satellite' || s === 'terrain';
const isDotBasemap = (s: BasemapStyle): boolean => s === 'dot';
const LAYER_PANEL_POS_KEY = 'hanzo-world-layers-pos';
const LAYER_PANEL_ORDER_KEY = 'hanzo-world-layers-order';

// Monochrome atmosphere for the 3D globe — pure-black space, near-black upper sky,
// a faint cool-grey horizon glow, no stars. Cheap to apply; harmless in mercator.
const MONOCHROME_FOG = {
  range: [0.5, 10] as [number, number],
  color: 'rgb(72, 80, 96)',        // horizon halo — faint cool-white glow
  'high-color': 'rgb(8, 10, 16)',  // upper atmosphere — near-black
  'space-color': 'rgb(0, 0, 0)',   // outer space — pure black
  'horizon-blend': 0.03,           // thin, crisp horizon band
  'star-intensity': 0.0,           // no stars — keeps it clean/monochrome
};

// Zoom thresholds for layer visibility and labels (matches old Map.ts)
// Zoom-dependent layer visibility and labels
const LAYER_ZOOM_THRESHOLDS: Partial<Record<keyof MapLayers, { minZoom: number; showLabels?: number }>> = {
  bases: { minZoom: 3, showLabels: 5 },
  nuclear: { minZoom: 3 },
  conflicts: { minZoom: 1, showLabels: 3 },
  economic: { minZoom: 3 },
  natural: { minZoom: 1, showLabels: 2 },
  datacenters: { minZoom: 5 },
  irradiators: { minZoom: 4 },
  spaceports: { minZoom: 3 },
  robotics: { minZoom: 3 },
  quantum: { minZoom: 3 },
  gulfInvestments: { minZoom: 2, showLabels: 5 },
};
// Export for external use
export { LAYER_ZOOM_THRESHOLDS };

// Theme-aware overlay color function — refreshed each buildLayers() call
function getOverlayColors() {
  const isLight = getCurrentTheme() === 'light';
  return {
    // Threat dots: IDENTICAL in both modes (user locked decision)
    hotspotHigh: [255, 68, 68, 200] as [number, number, number, number],
    hotspotElevated: [255, 165, 0, 200] as [number, number, number, number],
    hotspotLow: [255, 255, 0, 180] as [number, number, number, number],

    // Conflict zone fills: more transparent in light mode
    conflict: isLight
      ? [255, 0, 0, 60] as [number, number, number, number]
      : [255, 0, 0, 100] as [number, number, number, number],

    // Infrastructure/category markers: darker variants in light mode for map readability
    base: [0, 150, 255, 200] as [number, number, number, number],
    nuclear: isLight
      ? [180, 120, 0, 220] as [number, number, number, number]
      : [255, 215, 0, 200] as [number, number, number, number],
    datacenter: isLight
      ? [13, 148, 136, 200] as [number, number, number, number]
      : [0, 255, 200, 180] as [number, number, number, number],
    cable: [0, 200, 255, 150] as [number, number, number, number],
    cableHighlight: [255, 100, 100, 200] as [number, number, number, number],
    earthquake: [255, 100, 50, 200] as [number, number, number, number],
    vesselMilitary: [255, 100, 100, 220] as [number, number, number, number],
    flightMilitary: [255, 50, 50, 220] as [number, number, number, number],
    protest: [255, 150, 0, 200] as [number, number, number, number],
    outage: [255, 50, 50, 180] as [number, number, number, number],
    weather: [100, 150, 255, 180] as [number, number, number, number],
    startupHub: isLight
      ? [22, 163, 74, 220] as [number, number, number, number]
      : [0, 255, 150, 200] as [number, number, number, number],
    techHQ: [100, 200, 255, 200] as [number, number, number, number],
    accelerator: isLight
      ? [180, 120, 0, 220] as [number, number, number, number]
      : [255, 200, 0, 200] as [number, number, number, number],
    cloudRegion: [150, 100, 255, 180] as [number, number, number, number],
    stockExchange: isLight
      ? [20, 120, 200, 220] as [number, number, number, number]
      : [80, 200, 255, 210] as [number, number, number, number],
    financialCenter: isLight
      ? [0, 150, 110, 215] as [number, number, number, number]
      : [0, 220, 150, 200] as [number, number, number, number],
    centralBank: isLight
      ? [180, 120, 0, 220] as [number, number, number, number]
      : [255, 210, 80, 210] as [number, number, number, number],
    commodityHub: isLight
      ? [190, 95, 40, 220] as [number, number, number, number]
      : [255, 150, 80, 200] as [number, number, number, number],
    gulfInvestmentSA: [0, 168, 107, 220] as [number, number, number, number],
    gulfInvestmentUAE: [255, 0, 100, 220] as [number, number, number, number],
    ucdpStateBased: [255, 50, 50, 200] as [number, number, number, number],
    ucdpNonState: [255, 165, 0, 200] as [number, number, number, number],
    ucdpOneSided: [255, 255, 0, 200] as [number, number, number, number],
  };
}
// Initialize and refresh on every buildLayers() call
let COLORS = getOverlayColors();

// SVG icons as data URLs for different marker shapes
const MARKER_ICONS = {
  // Square - for datacenters
  square: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="2" y="2" width="28" height="28" rx="3" fill="white"/></svg>`),
  // Diamond - for hotspots
  diamond: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><polygon points="16,2 30,16 16,30 2,16" fill="white"/></svg>`),
  // Triangle up - for military bases
  triangleUp: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><polygon points="16,2 30,28 2,28" fill="white"/></svg>`),
  // Hexagon - for nuclear
  hexagon: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="white"/></svg>`),
  // Circle - fallback
  circle: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="white"/></svg>`),
  // Star - for special markers
  star: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><polygon points="16,2 20,12 30,12 22,19 25,30 16,23 7,30 10,19 2,12 12,12" fill="white"/></svg>`),
};

// UNDERSEA_CABLES filtered to valid PathLayer input: ≥2 vertices, each a finite
// [lon,lat]. Precomputed once (the source is static) so createCablesLayer never feeds
// deck.gl a malformed path — a single bad cable makes PathLayer assert at init and
// drop the WHOLE layer ("[GlobeNative] cables-layer assertion": enabled yet blank).
const cablesWithValidPaths = UNDERSEA_CABLES.filter(
  (c) =>
    Array.isArray(c.points) &&
    c.points.length >= 2 &&
    c.points.every(
      (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
    ),
);

// Great-circle densifier. deck.gl's PathLayer draws STRAIGHT segments between a
// path's vertices — fine on the flat map, but on the 3D globe a straight segment
// between two far-apart vertices is a chord that slices across/through the sphere
// instead of following the surface (the "cables slicing across the globe" glitch
// the arcs already dodge via `greatCircle`). PathLayer has no great-circle option,
// so we pre-resample each path along its great circle into short hops (≤ one
// GC_MAX_SEG_DEG arc each); the many tiny chords then visually hug the sphere. The
// source paths are static, so the densified (globe) form is precomputed once.
const GC_MAX_SEG_DEG = 4;
type LonLat = [number, number];

function gcInterpolate(a: LonLat, b: LonLat, f: number): LonLat {
  const d2r = Math.PI / 180, r2d = 180 / Math.PI;
  const lon1 = a[0] * d2r, lat1 = a[1] * d2r, lon2 = b[0] * d2r, lat2 = b[1] * d2r;
  const x1 = Math.cos(lat1) * Math.cos(lon1), y1 = Math.cos(lat1) * Math.sin(lon1), z1 = Math.sin(lat1);
  const x2 = Math.cos(lat2) * Math.cos(lon2), y2 = Math.cos(lat2) * Math.sin(lon2), z2 = Math.sin(lat2);
  const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  const omega = Math.acos(dot);
  if (omega < 1e-9) return [a[0], a[1]];
  const s = Math.sin(omega);
  const k1 = Math.sin((1 - f) * omega) / s, k2 = Math.sin(f * omega) / s;
  const x = k1 * x1 + k2 * x2, y = k1 * y1 + k2 * y2, z = k1 * z1 + k2 * z2;
  return [Math.atan2(y, x) * r2d, Math.atan2(z, Math.hypot(x, y)) * r2d];
}

function densifyGreatCircle(points: LonLat[]): LonLat[] {
  if (points.length < 2) return points;
  const d2r = Math.PI / 180;
  const out: LonLat[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!;
    out.push(a);
    const lat1 = a[1] * d2r, lat2 = b[1] * d2r, dLon = (b[0] - a[0]) * d2r;
    const cosd = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const deg = Math.acos(Math.max(-1, Math.min(1, cosd))) * 180 / Math.PI;
    const n = Math.max(1, Math.ceil(deg / GC_MAX_SEG_DEG));
    for (let k = 1; k < n; k++) out.push(gcInterpolate(a, b, k / n));
  }
  out.push(points[points.length - 1]!);
  return out;
}

// Globe forms of the static line layers: each path resampled to short great-circle
// hops so it hugs the sphere. The flat map keeps the raw (sparse) vertices.
const cablesGreatCircle = cablesWithValidPaths.map((c) => ({ ...c, points: densifyGreatCircle(c.points as LonLat[]) }));
const pipelinesGreatCircle = PIPELINES.map((p) => ({ ...p, points: densifyGreatCircle(p.points as LonLat[]) }));

export class DeckGLMap {
  private static readonly MAX_CLUSTER_LEAVES = 200;

  private container: HTMLElement;
  // Where the 2D/3D toggle, basemap switcher and time-range pills mount. Defaults
  // to `container`; the app points it at the bottom toolbar dock.
  private controlsHost: HTMLElement;
  // The draggable layer panel (a map overlay). Hidden by default; the dock's
  // "Layers" button toggles it open.
  private layerPanelEl: HTMLElement | null = null;
  private deckOverlay: MapboxOverlay | null = null;
  private mapboxMap: MapboxMap | null = null;
  private state: DeckMapState;
  private popup: MapPopup;
  // Chosen basemap (dark | satellite | terrain), orthogonal to the light/dark theme.
  private basemapStyle: BasemapStyle = DeckGLMap.loadBasemapStyle();

  // Data stores
  private hotspots: HotspotWithBreaking[];
  private earthquakes: Earthquake[] = [];
  private weatherAlerts: WeatherAlert[] = [];
  private outages: InternetOutage[] = [];
  private cyberThreats: CyberThreat[] = [];
  // Dotted-land basemap lattice (2D + shared with the native globe). Cached per
  // session by land-dots.ts; empty until the country geojson loads.
  private landDots: LandDot[] = [];
  private aisDisruptions: AisDisruptionEvent[] = [];
  private aisDensity: AisDensityZone[] = [];
  private cableAdvisories: CableAdvisory[] = [];
  private repairShips: RepairShip[] = [];
  private protests: SocialUnrestEvent[] = [];
  private militaryFlights: MilitaryFlight[] = [];
  private militaryFlightClusters: MilitaryFlightCluster[] = [];
  private militaryVessels: MilitaryVessel[] = [];
  private militaryVesselClusters: MilitaryVesselCluster[] = [];
  private naturalEvents: NaturalEvent[] = [];
  private firmsFireData: Array<{ lat: number; lon: number; brightness: number; frp: number; confidence: number; region: string; acq_date: string; daynight: string }> = [];
  private techEvents: TechEventMarker[] = [];
  private flightDelays: AirportDelayAlert[] = [];
  private news: NewsItem[] = [];
  private newsLocations: Array<{ lat: number; lon: number; title: string; threatLevel: string; timestamp?: Date }> = [];
  private newsLocationFirstSeen = new Map<string, number>();
  private ucdpEvents: UcdpGeoEvent[] = [];
  private displacementFlows: DisplacementFlow[] = [];
  private climateAnomalies: ClimateAnomaly[] = [];

  // Hanzo World cloud map layers (chainNodes / byoGpu / trafficArcs)
  private chainNetworks: ChainNetwork[] = [];
  private byoGpus: ByoGpu[] = [];
  private trafficArcsData: TrafficArc[] = [];
  private trafficPoints: TrafficGlobePoint[] = [];
  private cloudMapTimers: ReturnType<typeof setInterval>[] = [];

  // Camera the far-side billboard cull (occludeFarSide) faces, in lng/lat. The native
  // GlobeView feeds its own live camera here (mapbox is parked/frozen behind it); null
  // falls back to the live mapbox center for the ?globe=mapbox escape path and 2D.
  private occlusionCenter: { lng: number; lat: number } | null = null;

  // Country highlight state
  private countryGeoJsonLoaded = false;
  private countryHoverSetup = false;
  private highlightedCountryCode: string | null = null;

  // Callbacks
  private onHotspotClick?: (hotspot: Hotspot) => void;
  private onTimeRangeChange?: (range: TimeRange) => void;
  private onCountryClick?: (country: CountryClickPayload) => void;
  private onLayerChange?: (layer: keyof MapLayers, enabled: boolean) => void;
  private onStateChange?: (state: DeckMapState) => void;

  // Highlighted assets
  private highlightedAssets: Record<AssetType, Set<string>> = {
    pipeline: new Set(),
    cable: new Set(),
    datacenter: new Set(),
    base: new Set(),
    nuclear: new Set(),
  };

  private renderScheduled = false;
  private renderPaused = false;
  private renderPending = false;
  private webglLost = false;
  private resizeObserver: ResizeObserver | null = null;

  private layerCache: Map<string, Layer> = new Map();
  private lastZoomThreshold = 0;
  private protestSC: Supercluster | null = null;
  private techHQSC: Supercluster | null = null;
  private techEventSC: Supercluster | null = null;
  private datacenterSC: Supercluster | null = null;
  private protestClusters: MapProtestCluster[] = [];
  private techHQClusters: MapTechHQCluster[] = [];
  private techEventClusters: MapTechEventCluster[] = [];
  private datacenterClusters: MapDatacenterCluster[] = [];
  private lastSCZoom = -1;
  private lastSCBoundsKey = '';
  private lastSCMask = '';
  private protestSuperclusterSource: SocialUnrestEvent[] = [];
  private newsPulseIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly startupTime = Date.now();
  private lastCableHighlightSignature = '';
  private lastPipelineHighlightSignature = '';
  private debouncedRebuildLayers: () => void;
  private rafUpdateLayers: () => void;
  private moveTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Globe auto-rotate (3D idle spin). 2°/s is a calm, cinematic drift — half the
  // former 4°/s, which read as "spinning a bit too fast" as a background globe.
  private static readonly AUTO_ROTATE_DEG_PER_SEC = 2;
  private static readonly AUTO_ROTATE_IDLE_MS = 5000;
  private static readonly AUTO_ROTATE_MIN_FRAME_MS = 33; // ~30fps cap
  private autoRotateRafId: number | null = null;
  private autoRotateIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private autoRotateLastTs = 0;
  private userInteracting = false;

  // Cloud-map pulse: one RAF-driven 0→1 clock shared by the traffic arcs (a
  // travelling white comet) and the chain-node dots (a slow radius breathe).
  // Gated so it only spends a frame when a cloud layer is actually visible.
  private static readonly CLOUD_PULSE_PERIOD_MS = 3000;
  private static readonly CLOUD_PULSE_MIN_FRAME_MS = 33; // ~30fps cap
  private cloudPulseRafId: number | null = null;
  private cloudPulseCoef = 0;
  private cloudPulseLastTs = 0;

  // Perf: the layer instances from the last full buildLayers(). Animation ticks
  // (news pulse, cloud pulse) reuse these verbatim and swap in only the 1-3
  // layers that actually animate — deck.gl's same-instance fast path
  // (Layer._transferState: `this === oldLayer` → return) then skips the other
  // ~28 with no allocation and no GPU attribute recompute.
  private lastFullLayers: Layer[] = [];
  private pulseDirty = { news: false, cloud: false };
  private rafUpdatePulse: () => void;
  private static readonly NEWS_PULSE_LAYER_IDS = ['news-pulse-layer', 'hotspots-pulse', 'protest-clusters-pulse'];
  private static readonly CLOUD_PULSE_LAYER_IDS = ['chainNodes', 'trafficArcs', 'traffic'];

  // Chain-node dots derive from chainNetworks; cache them by source reference so
  // the cloud-pulse breathe (a radiusScale-only change) reuses the same data
  // array and deck.gl skips the per-frame attribute upload.
  private chainDotsSource: ChainNetwork[] | null = null;
  private chainDots: ChainDot[] = [];
  private chainMaxPeers = 1;

  constructor(container: HTMLElement, initialState: DeckMapInitialState) {
    this.container = container;
    this.controlsHost = initialState.controlsHost ?? container;
    // controlsHost is a mount hint, not persisted map state — keep it out of state.
    const { controlsHost: _controlsHost, ...stateInit } = initialState;
    this.state = { ...stateInit, mode: stateInit.mode ?? '2d' };
    this.hotspots = [...INTEL_HOTSPOTS];

    this.rebuildTechHQSupercluster();
    this.rebuildDatacenterSupercluster();

    this.debouncedRebuildLayers = debounce(() => {
      if (this.renderPaused || this.webglLost) return;
      this.mapboxMap?.resize();
      this.deckOverlay?.setProps({ layers: this.buildLayers() });
    }, 150);
    this.rafUpdateLayers = rafSchedule(() => {
      if (this.renderPaused || this.webglLost) return;
      this.deckOverlay?.setProps({ layers: this.buildLayers() });
    });
    // Animation-only update: rebuild just the pulsing layers, reuse everything
    // else. Coalesced per frame; the pulseDirty flags record which clocks ticked.
    this.rafUpdatePulse = rafSchedule(() => {
      const news = this.pulseDirty.news;
      const cloud = this.pulseDirty.cloud;
      this.pulseDirty.news = false;
      this.pulseDirty.cloud = false;
      if (this.renderPaused || this.webglLost || !this.deckOverlay) return;
      const ids = new Set<string>();
      if (news) for (const id of DeckGLMap.NEWS_PULSE_LAYER_IDS) ids.add(id);
      if (cloud) for (const id of DeckGLMap.CLOUD_PULSE_LAYER_IDS) ids.add(id);
      this.deckOverlay.setProps({ layers: this.buildAnimationLayers(ids) });
    });

    this.setupDOM();
    this.popup = new MapPopup(container);

    window.addEventListener('theme-changed', (e: Event) => {
      const theme = (e as CustomEvent).detail?.theme as 'dark' | 'light';
      if (theme) {
        this.switchBasemap(theme);
        this.render(); // Rebuilds Deck.GL layers with new theme-aware colors
      }
    });

    this.initBasemap();

    this.mapboxMap?.on('load', () => {
      this.initDeck();
      this.loadCountryBoundaries();
      this.applyAtmosphere();
      this.applyProjection();
      this.applyTerrain();
      this.applyBrightBasemapClass();
      this.render();
      this.maybeStartAutoRotate();
    });

    this.setupResizeObserver();

    this.createControls();
    this.createProjectionToggle();
    this.createStyleSwitcher();
    this.createTimeSlider();
    this.createLayerToggles();
    this.createLayersButton();
    this.createLegend();
    this.startCloudMapPolling();
  }

  // Cloud map data — same-origin /v1/world/cloud/* polled on independent cadences
  // (chain 30s, traffic 15s, gpu 60s). Best-effort: a 404 / failure yields null so
  // the layer stays empty, never a throw. Skips ticks while paused/offscreen; all
  // timers are cleared in destroy().
  private startCloudMapPolling(): void {
    const pull = <T>(fn: () => Promise<T | null>, apply: (data: T) => void, everyMs: number): void => {
      const tick = async (): Promise<void> => {
        // Gate on tab visibility, NOT renderPaused: when the native GlobeView takes
        // over (the default 3D view) this map is render-paused but its data still
        // feeds the live globe, so the request-geo dots MUST keep polling. Only a
        // hidden tab (or a lost context) should stop the fetch.
        if (this.webglLost || document.hidden) return;
        const data = await fn();
        if (data) {
          apply(data);
          this.render();
        }
      };
      void tick();
      this.cloudMapTimers.push(setInterval(() => void tick(), everyMs));
    };
    pull(getChainNodes, (d) => { this.chainNetworks = d.networks ?? []; }, 30_000);
    pull(getTraffic, (d) => { this.trafficArcsData = d.arcs ?? []; }, 15_000);
    pull(getTrafficGlobe, (d) => { this.trafficPoints = d.points ?? []; }, 12_000);
    pull(getByoGpu, (d) => { this.byoGpus = d.gpus ?? []; }, 60_000);
  }

  private setupDOM(): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'deckgl-map-wrapper';
    wrapper.id = 'deckglMapWrapper';
    wrapper.style.cssText = 'position: relative; width: 100%; height: 100%; overflow: hidden;';

    // Basemap container - deck.gl renders directly into mapbox-gl via MapboxOverlay
    const mapContainer = document.createElement('div');
    mapContainer.id = 'deckgl-basemap';
    mapContainer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%;';
    wrapper.appendChild(mapContainer);

    this.container.appendChild(wrapper);

    // Top control dock. When no external host was supplied (App passes none for the
    // flagship map), the chromeless controls — 2D/3D toggle, basemap switcher and the
    // time-range pills — sit in ONE tidy row across the map's TOP, side by side,
    // instead of scattering across the overlay or hiding in the footer. Layers (top-
    // left), zoom (top-right) and the legend (bottom) stay corner overlays.
    //
    // It mounts on `container`, a SIBLING of the deck wrapper — NOT inside it —
    // because 3D mode parks the wrapper with `visibility:hidden` and renders via
    // GlobeNative; a dock inside the wrapper would vanish on the globe. The legend
    // and the layers button sit on `container` for the same reason.
    if (this.controlsHost === this.container) {
      const dock = document.createElement('div');
      dock.className = 'deckgl-top-dock';
      this.container.appendChild(dock);
      this.controlsHost = dock;
    }
  }

  // A small "Layers" button pinned top-left that shows/hides the layer panel (which
  // itself anchors top-left). Gives the map its own layers control instead of relying
  // on the page footer. Only mounted for the flagship map (dock-owned controls host).
  private createLayersButton(): void {
    if (this.controlsHost === this.container) return; // harness map: no dock, no button
    const btn = document.createElement('button');
    btn.className = 'deckgl-layers-btn';
    btn.type = 'button';
    btn.innerHTML = `${icon('layers', 13)}<span>Layers</span>`;
    btn.addEventListener('click', () => {
      const open = this.toggleLayerPanel();
      btn.classList.toggle('active', open);
    });
    this.container.appendChild(btn);
  }

  private initBasemap(): void {
    const preset = VIEW_PRESETS[this.state.view];

    this.mapboxMap = new mapboxgl.Map({
      container: 'deckgl-basemap',
      style: this.resolveStyleUrl(),
      center: [preset.longitude, preset.latitude],
      zoom: preset.zoom,
      // Start already in the correct projection so ?mode=3d loads as a globe
      // with no post-load reprojection flash. BUT: mapbox-gl v3.26 throws
      // "Missing theme" when a plain (non-Standard) style loads in GLOBE projection,
      // which blanks the entire map. When the native deck.gl globe is on (the
      // default), this mapbox map is only a parked, invisible basemap behind
      // GlobeNative — it never needs globe projection — so keep it mercator (safe)
      // and let GlobeNative render the 3D sphere. mapbox renders the globe itself
      // only when the native globe is explicitly disabled (?globe=off).
      projection: this.mapboxProjection(),
      renderWorldCopies: false,
      // Repoint CartoDB's CORS-broken CJK glyph fonts at the CORS-open Latin font
      // so CJK labels fall back cleanly instead of spamming 403s in the console.
      transformRequest: (url, resourceType) =>
        resourceType === 'Glyphs' && CJK_GLYPH_RE.test(url)
          ? { url: url.replace(/\/fonts\/[^/]+\//, `/fonts/${GLYPH_FALLBACK_STACK}/`) }
          : { url },
      // We add a COMPACT AttributionControl explicitly below (not the default
      // expanded one) so basemap ToS attribution stays reachable even when the
      // corner wordmark is hidden via ?maplogo=0.
      attributionControl: false,
      interactive: true,
      // deck.gl draws its own antialiased geometry in the interleaved pass, so we
      // drop the basemap's MSAA buffer — a real fill-rate win on the globe with no
      // visible cost on the monochrome vector basemap.
      antialias: false,
      // Cap DPR the same way the deck overlay does; retina globes are GPU-bound.
      ...(MAP_INTERACTION_MODE === 'flat'
        ? {
          maxPitch: 0,
          pitchWithRotate: false,
          dragRotate: false,
          touchPitch: false,
        }
        : {}),
    });

    const canvas = this.mapboxMap.getCanvas();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.webglLost = true;
      console.warn('[DeckGLMap] WebGL context lost — will restore when browser recovers');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.webglLost = false;
      console.info('[DeckGLMap] WebGL context restored');
      this.mapboxMap?.triggerRepaint();
    });

    // Any direct manipulation pauses the idle globe spin; it resumes after a quiet period.
    canvas.addEventListener('mousedown', this.onUserInteract, { passive: true });
    canvas.addEventListener('wheel', this.onUserInteract, { passive: true });
    canvas.addEventListener('touchstart', this.onUserInteract, { passive: true });
  }

  private initDeck(): void {
    if (!this.mapboxMap) return;

    // OVERLAID, not interleaved. deck.gl 9.2's interleaved MapboxOverlay inserts its
    // layers as mapbox custom layers drawn in mapbox's projection pass — that pass
    // does NOT reproject deck geometry onto mapbox-gl v3's *globe*, so on the 3D
    // globe every overlay silently vanished (verified: bare sphere, 2D fine).
    // Overlaid mode gives deck its own canvas + its own _GlobeView (derived from
    // map.getProjection() each frame), so lat/lon layers reproject correctly on both
    // the flat map AND the globe, and survive setStyle for free (they live outside
    // the mapbox style). The only trade is a second GL context; for a data-on-top
    // globe that is the correct, deck-recommended mode.
    this.deckOverlay = new MapboxOverlay({
      interleaved: false,
      layers: this.buildLayers(),
      getTooltip: (info: PickingInfo) => this.getTooltip(info),
      onClick: (info: PickingInfo, event) => this.handleClick(info, event as MapClickEvent),
      pickingRadius: 10,
      // Overlaid deck owns its DPR. Cap at 2 so a HiDPI (DPR 3+) display on a
      // large window doesn't quadruple the per-frame fill of the second canvas —
      // the freeze the CTO hit on real hardware. 2× keeps dots/text crisp.
      useDevicePixels: Math.min(window.devicePixelRatio || 1, 2),
      onError: (error: Error) => console.warn('[DeckGLMap] Render error (non-fatal):', error.message),
    });

    this.mapboxMap.addControl(this.deckOverlay as unknown as IControl);

    // Compact "ⓘ" attribution (bottom-right) — always present so basemap ToS
    // attribution is reachable independent of the corner wordmark (?maplogo=0).
    this.mapboxMap.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    // Dev/e2e observability: expose the renderer internals so tests can assert
    // interleaved state, context count, and rendered deck layer ids/feature
    // counts without shipping any hook to production.
    if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
      (window as unknown as { __deckMap?: unknown }).__deckMap = this;
      (window as unknown as { __mapboxMap?: unknown }).__mapboxMap = this.mapboxMap;
      (window as unknown as { __deckOverlay?: unknown }).__deckOverlay = this.deckOverlay;
    }

    this.mapboxMap.on('movestart', () => {
      if (this.moveTimeoutId) {
        clearTimeout(this.moveTimeoutId);
        this.moveTimeoutId = null;
      }
    });

    this.mapboxMap.on('moveend', () => {
      // Keep state.zoom in step with direct wheel/pinch/drag zoom (which bypasses
      // setZoom) so getState()/getShareUrl capture the LIVE camera — otherwise a
      // shared or variant-switch URL restores a stale zoom.
      this.state.zoom = this.mapboxMap?.getZoom() ?? this.state.zoom;
      this.lastSCZoom = -1;
      this.rafUpdateLayers();
    });

    this.mapboxMap.on('move', () => {
      if (this.moveTimeoutId) clearTimeout(this.moveTimeoutId);
      this.moveTimeoutId = setTimeout(() => {
        this.lastSCZoom = -1;
        this.rafUpdateLayers();
      }, 100);
    });

    this.mapboxMap.on('zoom', () => {
      if (this.moveTimeoutId) clearTimeout(this.moveTimeoutId);
      this.moveTimeoutId = setTimeout(() => {
        this.lastSCZoom = -1;
        this.rafUpdateLayers();
      }, 100);
    });

    this.mapboxMap.on('zoomend', () => {
      const currentZoom = Math.floor(this.mapboxMap?.getZoom() || 2);
      const thresholdCrossed = Math.abs(currentZoom - this.lastZoomThreshold) >= 1;
      if (thresholdCrossed) {
        this.lastZoomThreshold = currentZoom;
        this.debouncedRebuildLayers();
      }
    });
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.mapboxMap) {
        this.mapboxMap.resize();
      }
    });
    this.resizeObserver.observe(this.container);
  }


  private getSetSignature(set: Set<string>): string {
    return [...set].sort().join('|');
  }

  private hasRecentNews(now = Date.now()): boolean {
    for (const ts of this.newsLocationFirstSeen.values()) {
      if (now - ts < 30_000) return true;
    }
    return false;
  }

  private getTimeRangeMs(range: TimeRange = this.state.timeRange): number {
    const ranges: Record<TimeRange, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '48h': 48 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      'all': Infinity,
    };
    return ranges[range];
  }

  private parseTime(value: Date | string | number | undefined | null): number | null {
    if (value == null) return null;
    const ts = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  private filterByTime<T>(
    items: T[],
    getTime: (item: T) => Date | string | number | undefined | null
  ): T[] {
    if (this.state.timeRange === 'all') return items;
    const cutoff = Date.now() - this.getTimeRangeMs();
    return items.filter((item) => {
      const ts = this.parseTime(getTime(item));
      return ts == null ? true : ts >= cutoff;
    });
  }

  private getFilteredProtests(): SocialUnrestEvent[] {
    return this.filterByTime(this.protests, (event) => event.time);
  }

  private filterMilitaryFlightClustersByTime(clusters: MilitaryFlightCluster[]): MilitaryFlightCluster[] {
    return clusters
      .map((cluster) => {
        const flights = this.filterByTime(cluster.flights ?? [], (flight) => flight.lastSeen);
        if (flights.length === 0) return null;
        return {
          ...cluster,
          flights,
          flightCount: flights.length,
        };
      })
      .filter((cluster): cluster is MilitaryFlightCluster => cluster !== null);
  }

  private filterMilitaryVesselClustersByTime(clusters: MilitaryVesselCluster[]): MilitaryVesselCluster[] {
    return clusters
      .map((cluster) => {
        const vessels = this.filterByTime(cluster.vessels ?? [], (vessel) => vessel.lastAisUpdate);
        if (vessels.length === 0) return null;
        return {
          ...cluster,
          vessels,
          vesselCount: vessels.length,
        };
      })
      .filter((cluster): cluster is MilitaryVesselCluster => cluster !== null);
  }

  private rebuildProtestSupercluster(source: SocialUnrestEvent[] = this.getFilteredProtests()): void {
    this.protestSuperclusterSource = source;
    const points = source.map((p, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] as [number, number] },
      properties: {
        index: i,
        country: p.country,
        severity: p.severity,
        eventType: p.eventType,
        validated: Boolean(p.validated),
        fatalities: Number.isFinite(p.fatalities) ? Number(p.fatalities) : 0,
      },
    }));
    this.protestSC = new Supercluster({
      radius: 60,
      maxZoom: 14,
      map: (props: Record<string, unknown>) => ({
        index: Number(props.index ?? 0),
        country: String(props.country ?? ''),
        maxSeverityRank: props.severity === 'high' ? 2 : props.severity === 'medium' ? 1 : 0,
        riotCount: props.eventType === 'riot' ? 1 : 0,
        highSeverityCount: props.severity === 'high' ? 1 : 0,
        verifiedCount: props.validated ? 1 : 0,
        totalFatalities: Number(props.fatalities ?? 0) || 0,
      }),
      reduce: (acc: Record<string, unknown>, props: Record<string, unknown>) => {
        acc.maxSeverityRank = Math.max(Number(acc.maxSeverityRank ?? 0), Number(props.maxSeverityRank ?? 0));
        acc.riotCount = Number(acc.riotCount ?? 0) + Number(props.riotCount ?? 0);
        acc.highSeverityCount = Number(acc.highSeverityCount ?? 0) + Number(props.highSeverityCount ?? 0);
        acc.verifiedCount = Number(acc.verifiedCount ?? 0) + Number(props.verifiedCount ?? 0);
        acc.totalFatalities = Number(acc.totalFatalities ?? 0) + Number(props.totalFatalities ?? 0);
        if (!acc.country && props.country) acc.country = props.country;
      },
    });
    this.protestSC.load(points);
    this.lastSCZoom = -1;
  }

  private rebuildTechHQSupercluster(): void {
    const points = TECH_HQS.map((h, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [h.lon, h.lat] as [number, number] },
      properties: {
        index: i,
        city: h.city,
        country: h.country,
        type: h.type,
      },
    }));
    this.techHQSC = new Supercluster({
      radius: 50,
      maxZoom: 14,
      map: (props: Record<string, unknown>) => ({
        index: Number(props.index ?? 0),
        city: String(props.city ?? ''),
        country: String(props.country ?? ''),
        faangCount: props.type === 'faang' ? 1 : 0,
        unicornCount: props.type === 'unicorn' ? 1 : 0,
        publicCount: props.type === 'public' ? 1 : 0,
      }),
      reduce: (acc: Record<string, unknown>, props: Record<string, unknown>) => {
        acc.faangCount = Number(acc.faangCount ?? 0) + Number(props.faangCount ?? 0);
        acc.unicornCount = Number(acc.unicornCount ?? 0) + Number(props.unicornCount ?? 0);
        acc.publicCount = Number(acc.publicCount ?? 0) + Number(props.publicCount ?? 0);
        if (!acc.city && props.city) acc.city = props.city;
        if (!acc.country && props.country) acc.country = props.country;
      },
    });
    this.techHQSC.load(points);
    this.lastSCZoom = -1;
  }

  private rebuildTechEventSupercluster(): void {
    const points = this.techEvents.map((e, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [e.lng, e.lat] as [number, number] },
      properties: {
        index: i,
        location: e.location,
        country: e.country,
        daysUntil: e.daysUntil,
      },
    }));
    this.techEventSC = new Supercluster({
      radius: 50,
      maxZoom: 14,
      map: (props: Record<string, unknown>) => {
        const daysUntil = Number(props.daysUntil ?? Number.MAX_SAFE_INTEGER);
        return {
          index: Number(props.index ?? 0),
          location: String(props.location ?? ''),
          country: String(props.country ?? ''),
          soonestDaysUntil: Number.isFinite(daysUntil) ? daysUntil : Number.MAX_SAFE_INTEGER,
          soonCount: Number.isFinite(daysUntil) && daysUntil <= 14 ? 1 : 0,
        };
      },
      reduce: (acc: Record<string, unknown>, props: Record<string, unknown>) => {
        acc.soonestDaysUntil = Math.min(
          Number(acc.soonestDaysUntil ?? Number.MAX_SAFE_INTEGER),
          Number(props.soonestDaysUntil ?? Number.MAX_SAFE_INTEGER),
        );
        acc.soonCount = Number(acc.soonCount ?? 0) + Number(props.soonCount ?? 0);
        if (!acc.location && props.location) acc.location = props.location;
        if (!acc.country && props.country) acc.country = props.country;
      },
    });
    this.techEventSC.load(points);
    this.lastSCZoom = -1;
  }

  private rebuildDatacenterSupercluster(): void {
    const activeDCs = AI_DATA_CENTERS.filter(dc => dc.status !== 'decommissioned');
    const points = activeDCs.map((dc, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [dc.lon, dc.lat] as [number, number] },
      properties: {
        index: i,
        country: dc.country,
        chipCount: dc.chipCount,
        powerMW: dc.powerMW ?? 0,
        status: dc.status,
      },
    }));
    this.datacenterSC = new Supercluster({
      radius: 70,
      maxZoom: 14,
      map: (props: Record<string, unknown>) => ({
        index: Number(props.index ?? 0),
        country: String(props.country ?? ''),
        totalChips: Number(props.chipCount ?? 0) || 0,
        totalPowerMW: Number(props.powerMW ?? 0) || 0,
        existingCount: props.status === 'existing' ? 1 : 0,
        plannedCount: props.status === 'planned' ? 1 : 0,
      }),
      reduce: (acc: Record<string, unknown>, props: Record<string, unknown>) => {
        acc.totalChips = Number(acc.totalChips ?? 0) + Number(props.totalChips ?? 0);
        acc.totalPowerMW = Number(acc.totalPowerMW ?? 0) + Number(props.totalPowerMW ?? 0);
        acc.existingCount = Number(acc.existingCount ?? 0) + Number(props.existingCount ?? 0);
        acc.plannedCount = Number(acc.plannedCount ?? 0) + Number(props.plannedCount ?? 0);
        if (!acc.country && props.country) acc.country = props.country;
      },
    });
    this.datacenterSC.load(points);
    this.lastSCZoom = -1;
  }

  private updateClusterData(): void {
    const zoom = Math.floor(this.mapboxMap?.getZoom() ?? 2);
    const bounds = this.mapboxMap?.getBounds();
    if (!bounds) return;
    const bbox: [number, number, number, number] = [
      bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
    ];
    const boundsKey = `${bbox[0].toFixed(4)}:${bbox[1].toFixed(4)}:${bbox[2].toFixed(4)}:${bbox[3].toFixed(4)}`;
    const layers = this.state.layers;
    const useProtests = layers.protests && this.protestSuperclusterSource.length > 0;
    const useTechHQ = SITE_VARIANT === 'tech' && layers.techHQs;
    const useTechEvents = SITE_VARIANT === 'tech' && layers.techEvents && this.techEvents.length > 0;
    const useDatacenterClusters = layers.datacenters && zoom < 5;
    const layerMask = `${Number(useProtests)}${Number(useTechHQ)}${Number(useTechEvents)}${Number(useDatacenterClusters)}`;
    if (zoom === this.lastSCZoom && boundsKey === this.lastSCBoundsKey && layerMask === this.lastSCMask) return;
    this.lastSCZoom = zoom;
    this.lastSCBoundsKey = boundsKey;
    this.lastSCMask = layerMask;

    if (useProtests && this.protestSC) {
      this.protestClusters = this.protestSC.getClusters(bbox, zoom).map(f => {
        const coords = f.geometry.coordinates as [number, number];
        if (f.properties.cluster) {
          const props = f.properties as Record<string, unknown>;
          const leaves = this.protestSC!.getLeaves(f.properties.cluster_id!, DeckGLMap.MAX_CLUSTER_LEAVES);
          const items = leaves.map(l => this.protestSuperclusterSource[l.properties.index]).filter((x): x is SocialUnrestEvent => !!x);
          const maxSeverityRank = Number(props.maxSeverityRank ?? 0);
          const maxSev = maxSeverityRank >= 2 ? 'high' : maxSeverityRank === 1 ? 'medium' : 'low';
          const riotCount = Number(props.riotCount ?? 0);
          const highSeverityCount = Number(props.highSeverityCount ?? 0);
          const verifiedCount = Number(props.verifiedCount ?? 0);
          const totalFatalities = Number(props.totalFatalities ?? 0);
          const clusterCount = Number(f.properties.point_count ?? items.length);
          const latestRiotEventTimeMs = items.reduce((max, it) => {
            if (it.eventType !== 'riot' || it.sourceType === 'gdelt') return max;
            const ts = it.time.getTime();
            return Number.isFinite(ts) ? Math.max(max, ts) : max;
          }, 0);
          return {
            id: `pc-${f.properties.cluster_id}`,
            lat: coords[1], lon: coords[0],
            count: clusterCount,
            items,
            country: String(props.country ?? items[0]?.country ?? ''),
            maxSeverity: maxSev as 'low' | 'medium' | 'high',
            hasRiot: riotCount > 0,
            latestRiotEventTimeMs: latestRiotEventTimeMs || undefined,
            totalFatalities,
            riotCount,
            highSeverityCount,
            verifiedCount,
            sampled: items.length < clusterCount,
          };
        }
        const item = this.protestSuperclusterSource[f.properties.index]!;
        return {
          id: `pp-${f.properties.index}`, lat: item.lat, lon: item.lon,
          count: 1, items: [item], country: item.country,
          maxSeverity: item.severity, hasRiot: item.eventType === 'riot',
          latestRiotEventTimeMs:
            item.eventType === 'riot' && item.sourceType !== 'gdelt' && Number.isFinite(item.time.getTime())
              ? item.time.getTime()
              : undefined,
          totalFatalities: item.fatalities ?? 0,
          riotCount: item.eventType === 'riot' ? 1 : 0,
          highSeverityCount: item.severity === 'high' ? 1 : 0,
          verifiedCount: item.validated ? 1 : 0,
          sampled: false,
        };
      });
    } else {
      this.protestClusters = [];
    }

    if (useTechHQ && this.techHQSC) {
      this.techHQClusters = this.techHQSC.getClusters(bbox, zoom).map(f => {
        const coords = f.geometry.coordinates as [number, number];
        if (f.properties.cluster) {
          const props = f.properties as Record<string, unknown>;
          const leaves = this.techHQSC!.getLeaves(f.properties.cluster_id!, DeckGLMap.MAX_CLUSTER_LEAVES);
          const items = leaves.map(l => TECH_HQS[l.properties.index]).filter(Boolean) as typeof TECH_HQS;
          const faangCount = Number(props.faangCount ?? 0);
          const unicornCount = Number(props.unicornCount ?? 0);
          const publicCount = Number(props.publicCount ?? 0);
          const clusterCount = Number(f.properties.point_count ?? items.length);
          const primaryType = faangCount >= unicornCount && faangCount >= publicCount
            ? 'faang'
            : unicornCount >= publicCount
              ? 'unicorn'
              : 'public';
          return {
            id: `hc-${f.properties.cluster_id}`,
            lat: coords[1], lon: coords[0],
            count: clusterCount,
            items,
            city: String(props.city ?? items[0]?.city ?? ''),
            country: String(props.country ?? items[0]?.country ?? ''),
            primaryType,
            faangCount,
            unicornCount,
            publicCount,
            sampled: items.length < clusterCount,
          };
        }
        const item = TECH_HQS[f.properties.index]!;
        return {
          id: `hp-${f.properties.index}`, lat: item.lat, lon: item.lon,
          count: 1, items: [item], city: item.city, country: item.country,
          primaryType: item.type,
          faangCount: item.type === 'faang' ? 1 : 0,
          unicornCount: item.type === 'unicorn' ? 1 : 0,
          publicCount: item.type === 'public' ? 1 : 0,
          sampled: false,
        };
      });
    } else {
      this.techHQClusters = [];
    }

    if (useTechEvents && this.techEventSC) {
      this.techEventClusters = this.techEventSC.getClusters(bbox, zoom).map(f => {
        const coords = f.geometry.coordinates as [number, number];
        if (f.properties.cluster) {
          const props = f.properties as Record<string, unknown>;
          const leaves = this.techEventSC!.getLeaves(f.properties.cluster_id!, DeckGLMap.MAX_CLUSTER_LEAVES);
          const items = leaves.map(l => this.techEvents[l.properties.index]).filter((x): x is TechEventMarker => !!x);
          const clusterCount = Number(f.properties.point_count ?? items.length);
          const soonestDaysUntil = Number(props.soonestDaysUntil ?? Number.MAX_SAFE_INTEGER);
          const soonCount = Number(props.soonCount ?? 0);
          return {
            id: `ec-${f.properties.cluster_id}`,
            lat: coords[1], lon: coords[0],
            count: clusterCount,
            items,
            location: String(props.location ?? items[0]?.location ?? ''),
            country: String(props.country ?? items[0]?.country ?? ''),
            soonestDaysUntil: Number.isFinite(soonestDaysUntil) ? soonestDaysUntil : Number.MAX_SAFE_INTEGER,
            soonCount,
            sampled: items.length < clusterCount,
          };
        }
        const item = this.techEvents[f.properties.index]!;
        return {
          id: `ep-${f.properties.index}`, lat: item.lat, lon: item.lng,
          count: 1, items: [item], location: item.location, country: item.country,
          soonestDaysUntil: item.daysUntil,
          soonCount: item.daysUntil <= 14 ? 1 : 0,
          sampled: false,
        };
      });
    } else {
      this.techEventClusters = [];
    }

    if (useDatacenterClusters && this.datacenterSC) {
      const activeDCs = AI_DATA_CENTERS.filter(dc => dc.status !== 'decommissioned');
      this.datacenterClusters = this.datacenterSC.getClusters(bbox, zoom).map(f => {
        const coords = f.geometry.coordinates as [number, number];
        if (f.properties.cluster) {
          const props = f.properties as Record<string, unknown>;
          const leaves = this.datacenterSC!.getLeaves(f.properties.cluster_id!, DeckGLMap.MAX_CLUSTER_LEAVES);
          const items = leaves.map(l => activeDCs[l.properties.index]).filter((x): x is AIDataCenter => !!x);
          const clusterCount = Number(f.properties.point_count ?? items.length);
          const existingCount = Number(props.existingCount ?? 0);
          const plannedCount = Number(props.plannedCount ?? 0);
          const totalChips = Number(props.totalChips ?? 0);
          const totalPowerMW = Number(props.totalPowerMW ?? 0);
          return {
            id: `dc-${f.properties.cluster_id}`,
            lat: coords[1], lon: coords[0],
            count: clusterCount,
            items,
            region: String(props.country ?? items[0]?.country ?? ''),
            country: String(props.country ?? items[0]?.country ?? ''),
            totalChips,
            totalPowerMW,
            majorityExisting: existingCount >= Math.max(1, clusterCount / 2),
            existingCount,
            plannedCount,
            sampled: items.length < clusterCount,
          };
        }
        const item = activeDCs[f.properties.index]!;
        return {
          id: `dp-${f.properties.index}`, lat: item.lat, lon: item.lon,
          count: 1, items: [item], region: item.country, country: item.country,
          totalChips: item.chipCount, totalPowerMW: item.powerMW ?? 0,
          majorityExisting: item.status === 'existing',
          existingCount: item.status === 'existing' ? 1 : 0,
          plannedCount: item.status === 'planned' ? 1 : 0,
          sampled: false,
        };
      });
    } else {
      this.datacenterClusters = [];
    }
  }




  private isLayerVisible(layerKey: keyof MapLayers): boolean {
    const threshold = LAYER_ZOOM_THRESHOLDS[layerKey];
    if (!threshold) return true;
    const zoom = this.mapboxMap?.getZoom() || 2;
    return zoom >= threshold.minZoom;
  }

  private buildLayers(): LayersList {
    const startTime = performance.now();
    // Refresh theme-aware overlay colors on each rebuild
    COLORS = getOverlayColors();
    const layers: (Layer | null | false)[] = [];
    const { layers: mapLayers } = this.state;

    // Bottom of the stack: a keyless deck raster basemap when no Mapbox token is
    // configured, so the map is NEVER a black void (mapbox-gl won't paint without
    // a token). No-op when a token is present — the mapbox vector basemap stands.
    if (!MAPBOX_TOKEN) {
      const basemap = this.buildBasemapLayer();
      if (basemap) layers.push(basemap);
    }
    // Dot basemap (2D): a lattice of land dots over the near-black map. Drawn as
    // the first data layer so every real layer sits on top. The dot cloud is the
    // same one the native globe uses (land-dots.ts), so 2D ↔ 3D stay in sync.
    if (isDotBasemap(this.basemapStyle) && this.landDots.length > 0) {
      layers.push(...this.createLandDotsLayers());
    }
    const filteredEarthquakes = this.filterByTime(this.earthquakes, (eq) => eq.time);
    const filteredNaturalEvents = this.filterByTime(this.naturalEvents, (event) => event.date);
    const filteredWeatherAlerts = this.filterByTime(this.weatherAlerts, (alert) => alert.onset);
    const filteredOutages = this.filterByTime(this.outages, (outage) => outage.pubDate);
    const filteredCableAdvisories = this.filterByTime(this.cableAdvisories, (advisory) => advisory.reported);
    const filteredFlightDelays = this.filterByTime(this.flightDelays, (delay) => delay.updatedAt);
    const filteredMilitaryFlights = this.filterByTime(this.militaryFlights, (flight) => flight.lastSeen);
    const filteredMilitaryVessels = this.filterByTime(this.militaryVessels, (vessel) => vessel.lastAisUpdate);
    const filteredMilitaryFlightClusters = this.filterMilitaryFlightClustersByTime(this.militaryFlightClusters);
    const filteredMilitaryVesselClusters = this.filterMilitaryVesselClustersByTime(this.militaryVesselClusters);
    const filteredUcdpEvents = this.filterByTime(this.ucdpEvents, (event) => event.date_start);

    // Undersea cables layer
    if (mapLayers.cables) {
      layers.push(this.createCablesLayer());
    }

    // Pipelines layer
    if (mapLayers.pipelines) {
      layers.push(this.createPipelinesLayer());
    }

    // Conflict zones layer
    if (mapLayers.conflicts) {
      layers.push(this.createConflictZonesLayer());
    }

    // Military bases layer — hidden at low zoom (E: progressive disclosure) + ghost
    if (mapLayers.bases && this.isLayerVisible('bases')) {
      layers.push(this.createBasesLayer());
      layers.push(this.createGhostLayer('bases-layer', MILITARY_BASES, d => [d.lon, d.lat], { radiusMinPixels: 12 }));
    }

    // Nuclear facilities layer — hidden at low zoom + ghost
    if (mapLayers.nuclear && this.isLayerVisible('nuclear')) {
      layers.push(this.createNuclearLayer());
      layers.push(this.createGhostLayer('nuclear-layer', NUCLEAR_FACILITIES.filter(f => f.status !== 'decommissioned'), d => [d.lon, d.lat], { radiusMinPixels: 12 }));
    }

    // Gamma irradiators layer — hidden at low zoom
    if (mapLayers.irradiators && this.isLayerVisible('irradiators')) {
      layers.push(this.createIrradiatorsLayer());
    }

    // Spaceports layer — hidden at low zoom
    if (mapLayers.spaceports && this.isLayerVisible('spaceports')) {
      layers.push(this.createSpaceportsLayer());
    }

    // Robotics labs layer — hidden at low zoom
    if (mapLayers.robotics && this.isLayerVisible('robotics')) {
      layers.push(this.createRoboticsLayer());
    }

    // Quantum computing players layer — hidden at low zoom
    if (mapLayers.quantum && this.isLayerVisible('quantum')) {
      layers.push(this.createQuantumLayer());
    }

    // Hotspots layer (all hotspots including high/breaking, with pulse + ghost)
    if (mapLayers.hotspots) {
      layers.push(...this.createHotspotsLayers());
    }

    // Datacenters layer - SQUARE icons at zoom >= 5, cluster dots at zoom < 5
    const currentZoom = this.mapboxMap?.getZoom() || 2;
    if (mapLayers.datacenters) {
      if (currentZoom >= 5) {
        layers.push(this.createDatacentersLayer());
      } else {
        layers.push(...this.createDatacenterClusterLayers());
      }
    }

    // Earthquakes layer + ghost for easier picking
    if (mapLayers.natural && filteredEarthquakes.length > 0) {
      layers.push(this.createEarthquakesLayer(filteredEarthquakes));
      layers.push(this.createGhostLayer('earthquakes-layer', filteredEarthquakes, d => [d.lon, d.lat], { radiusMinPixels: 12 }));
    }

    // Natural events layer
    if (mapLayers.natural && filteredNaturalEvents.length > 0) {
      layers.push(this.createNaturalEventsLayer(filteredNaturalEvents));
    }

    // Satellite fires layer (NASA FIRMS)
    if (mapLayers.fires && this.firmsFireData.length > 0) {
      layers.push(this.createFiresLayer());
    }

    // Weather alerts layer
    if (mapLayers.weather && filteredWeatherAlerts.length > 0) {
      layers.push(this.createWeatherLayer(filteredWeatherAlerts));
    }

    // Internet outages layer + ghost for easier picking
    if (mapLayers.outages && filteredOutages.length > 0) {
      layers.push(this.createOutagesLayer(filteredOutages));
      layers.push(this.createGhostLayer('outages-layer', filteredOutages, d => [d.lon, d.lat], { radiusMinPixels: 12 }));
    }

    // Cyber threat IOC layer
    if (mapLayers.cyberThreats && this.cyberThreats.length > 0) {
      layers.push(this.createCyberThreatsLayer());
      layers.push(this.createGhostLayer('cyber-threats-layer', this.cyberThreats, d => [d.lon, d.lat], { radiusMinPixels: 12 }));
    }

    // AIS density layer
    if (mapLayers.ais && this.aisDensity.length > 0) {
      layers.push(this.createAisDensityLayer());
    }

    // AIS disruptions layer (spoofing/jamming)
    if (mapLayers.ais && this.aisDisruptions.length > 0) {
      layers.push(this.createAisDisruptionsLayer());
    }

    // Strategic ports layer (shown with AIS)
    if (mapLayers.ais) {
      layers.push(this.createPortsLayer());
    }

    // Cable advisories layer (shown with cables)
    if (mapLayers.cables && filteredCableAdvisories.length > 0) {
      layers.push(this.createCableAdvisoriesLayer(filteredCableAdvisories));
    }

    // Repair ships layer (shown with cables)
    if (mapLayers.cables && this.repairShips.length > 0) {
      layers.push(this.createRepairShipsLayer());
    }

    // Flight delays layer
    if (mapLayers.flights && filteredFlightDelays.length > 0) {
      layers.push(this.createFlightDelaysLayer(filteredFlightDelays));
    }

    // Protests layer (Supercluster-based deck.gl layers)
    if (mapLayers.protests && this.protests.length > 0) {
      layers.push(...this.createProtestClusterLayers());
    }

    // Military vessels layer
    if (mapLayers.military && filteredMilitaryVessels.length > 0) {
      layers.push(this.createMilitaryVesselsLayer(filteredMilitaryVessels));
    }

    // Military vessel clusters layer
    if (mapLayers.military && filteredMilitaryVesselClusters.length > 0) {
      layers.push(this.createMilitaryVesselClustersLayer(filteredMilitaryVesselClusters));
    }

    // Military flights layer
    if (mapLayers.military && filteredMilitaryFlights.length > 0) {
      layers.push(this.createMilitaryFlightsLayer(filteredMilitaryFlights));
    }

    // Military flight clusters layer
    if (mapLayers.military && filteredMilitaryFlightClusters.length > 0) {
      layers.push(this.createMilitaryFlightClustersLayer(filteredMilitaryFlightClusters));
    }

    // Strategic waterways layer
    if (mapLayers.waterways) {
      layers.push(this.createWaterwaysLayer());
    }

    // Economic centers layer — hidden at low zoom
    if (mapLayers.economic && this.isLayerVisible('economic')) {
      layers.push(this.createEconomicCentersLayer());
    }

    // Finance variant layers
    if (mapLayers.stockExchanges) {
      layers.push(this.createStockExchangesLayer());
    }
    if (mapLayers.financialCenters) {
      layers.push(this.createFinancialCentersLayer());
    }
    if (mapLayers.centralBanks) {
      layers.push(this.createCentralBanksLayer());
    }
    if (mapLayers.commodityHubs) {
      layers.push(this.createCommodityHubsLayer());
    }

    // Critical minerals layer
    if (mapLayers.minerals) {
      layers.push(this.createMineralsLayer());
    }

    // APT Groups layer (geopolitical variant only - always shown, no toggle)
    if (SITE_VARIANT !== 'tech') {
      layers.push(this.createAPTGroupsLayer());
    }

    // UCDP georeferenced events layer
    if (mapLayers.ucdpEvents && filteredUcdpEvents.length > 0) {
      layers.push(this.createUcdpEventsLayer(filteredUcdpEvents));
    }

    // Displacement flows arc layer
    if (mapLayers.displacement && this.displacementFlows.length > 0) {
      layers.push(this.createDisplacementArcsLayer());
    }

    // Climate anomalies — HeatmapLayer is screen-space and unsupported on the
    // globe, so 3D substitutes a graduated-radius scatter that reads the same.
    if (mapLayers.climate && this.climateAnomalies.length > 0) {
      layers.push(this.state.mode === '3d'
        ? this.createClimateAnomalyPointsLayer()
        : this.createClimateHeatmapLayer());
    }

    // Tech variant layers (Supercluster-based deck.gl layers for HQs and events)
    if (SITE_VARIANT === 'tech') {
      if (mapLayers.startupHubs) {
        layers.push(this.createStartupHubsLayer());
      }
      if (mapLayers.techHQs) {
        layers.push(...this.createTechHQClusterLayers());
      }
      if (mapLayers.accelerators) {
        layers.push(this.createAcceleratorsLayer());
      }
      if (mapLayers.cloudRegions) {
        layers.push(this.createCloudRegionsLayer());
      }
      if (mapLayers.techEvents && this.techEvents.length > 0) {
        layers.push(...this.createTechEventClusterLayers());
      }
    }

    // Gulf FDI investments layer
    if (mapLayers.gulfInvestments) {
      layers.push(this.createGulfInvestmentsLayer());
    }

    // Hanzo World cloud map — chain validator nodes, BYO GPU fleet, traffic arcs.
    // View-agnostic: Scatterplot (meters radius) + Arc render on both the flat
    // Mercator map and the 3D globe, so no globe substitution is needed.
    if (mapLayers.chainNodes && this.chainNetworks.length > 0) {
      layers.push(this.createChainNodesLayer());
    }
    if (mapLayers.byoGpu && this.byoGpus.length > 0) {
      layers.push(this.createByoGpuLayer());
    }
    if (mapLayers.trafficArcs && this.trafficArcsData.length > 0) {
      layers.push(this.createTrafficArcsLayer());
    }
    if (mapLayers.traffic && this.trafficPoints.length > 0) {
      layers.push(this.createTrafficLayer());
    }

    // News geo-locations (always shown if data exists)
    if (this.newsLocations.length > 0) {
      layers.push(...this.createNewsLocationsLayer());
    }

    const result = this.occludeFarSide(layers.filter((l): l is Layer => Boolean(l)));
    this.lastFullLayers = result;
    const elapsed = performance.now() - startTime;
    if (import.meta.env.DEV && elapsed > 16) {
      console.warn(`[DeckGLMap] buildLayers took ${elapsed.toFixed(2)}ms (>16ms budget), ${result.length} layers`);
    }
    return result;
  }

  // Animation-tick layer list: reuse the instances from the last full build and
  // rebuild only the layers in `animatedIds`. Every other entry is passed back by
  // reference so deck.gl's diff skips it entirely (no alloc, no attribute upload).
  // Falls back to a full build before the first one has run.
  private buildAnimationLayers(animatedIds: Set<string>): LayersList {
    if (this.lastFullLayers.length === 0 || animatedIds.size === 0) return this.buildLayers();
    const out: Layer[] = [];
    for (const layer of this.lastFullLayers) {
      if (animatedIds.has(layer.id)) {
        const rebuilt = this.rebuildAnimatedLayer(layer.id);
        // Occlude the freshly rebuilt animated layer too, so far-side pulses/arcs
        // don't shine through the globe. Reused layers were already occluded by
        // the last full build and pass through by reference in the else branch.
        if (rebuilt) {
          const [culled] = this.occludeFarSide([rebuilt]);
          out.push(culled ?? rebuilt); // dropped when the pulse has faded out
        }
      } else {
        out.push(layer);
      }
    }
    this.lastFullLayers = out;
    return out;
  }

  private rebuildAnimatedLayer(id: string): Layer | null {
    switch (id) {
      case 'news-pulse-layer': return this.createNewsPulseLayer();
      case 'hotspots-pulse': return this.createHotspotsPulseLayer();
      case 'protest-clusters-pulse': return this.createProtestClustersPulseLayer();
      case 'chainNodes': return this.createChainNodesLayer();
      case 'trafficArcs': return this.createTrafficArcsLayer();
      case 'traffic': return this.createTrafficLayer();
      default: return null;
    }
  }

  // Back-hemisphere marker occlusion for the 3D globe. Overlaid deck.gl renders
  // in its own canvas with no depth buffer shared with mapbox's globe, so point
  // markers on the FAR side project through the near side and look like they
  // "float" off the sphere. Cull them by alpha: a surface point at (lon,lat) is
  // visible only when its normal faces the camera — i.e. its dot product with
  // the sub-camera point (the map center) is positive. A small positive bias
  // hides the grazing limb, where perspective already sees less than a full
  // hemisphere. Only Scatterplot/Icon (point) layers need this — filled polygons
  // drape on the sphere and are occluded by the horizon for free. Re-evaluated
  // every buildLayers() (move is debounced to ~10 Hz) so it tracks both manual
  // rotation and the idle spin; a 2D map is a no-op.
  private occludeFarSide(layers: Layer[]): Layer[] {
    if (this.state.mode !== '3d' || !this.mapboxMap) return layers;
    // Billboard layers (Scatter/Icon/Text) don't reliably depth-occlude against the
    // globe on a single GlobeView pass — a back-hemisphere point projects onto the
    // near disc and a pixel-offset text badge pokes above the silhouette. So cull them
    // deterministically by facing: a surface point is drawn only when its normal faces
    // the camera. The camera longitude/latitude comes from `occlusionCenter` when the
    // native GlobeView drives the render (its own live camera — mapbox is parked and
    // frozen there), else from the live mapbox center (the ?globe=mapbox escape path).
    // Paths/arcs/polygons are occluded by the GPU depth buffer instead (GlobeNative
    // seats a depth-writing ocean sphere), so this only touches billboards.
    const RAD = Math.PI / 180;
    const c = this.occlusionCenter ?? this.mapboxMap.getCenter();
    const clat = c.lat * RAD;
    const clng = c.lng * RAD;
    const cx = Math.cos(clat) * Math.cos(clng);
    const cy = Math.cos(clat) * Math.sin(clng);
    const cz = Math.sin(clat);
    // updateTriggers key: forces the wrapped color accessors to re-run when the
    // camera moves far enough to change which hemisphere a marker is on.
    const key = `${c.lng.toFixed(1)}|${c.lat.toFixed(1)}`;
    const facesCamera = (lon: number, lat: number): boolean => {
      const rlat = lat * RAD;
      const rlng = lon * RAD;
      const x = Math.cos(rlat) * Math.cos(rlng);
      const y = Math.cos(rlat) * Math.sin(rlng);
      const z = Math.sin(rlat);
      return x * cx + y * cy + z * cz > 0.05;
    };
    type Rgba = [number, number, number, number];
    type ColorAcc = Rgba | ((d: unknown, info?: unknown) => Rgba);
    type GetPos = (d: unknown, info?: unknown) => number[];
    // Wrap a color accessor so back-hemisphere data become fully transparent.
    // Radius/size can't be used to hide markers (radiusMinPixels/sizeMinPixels
    // clamp a 0 back up); alpha is not clamped, so it is the correct lever.
    const cull = (orig: ColorAcc | undefined, getPos: GetPos) =>
      (d: unknown, info?: unknown): Rgba => {
        const base: Rgba = typeof orig === 'function' ? orig(d, info) : (orig ?? [0, 0, 0, 0]);
        const p = getPos(d, info);
        const lon = p?.[0];
        const lat = p?.[1];
        if (lon === undefined || lat === undefined || !facesCamera(lon, lat)) {
          return [base[0], base[1], base[2], 0];
        }
        return base;
      };
    type CloneProps = Record<string, unknown>;
    type Cloneable = { clone: (props: CloneProps) => Layer; props: Record<string, unknown> };
    return layers.map((layer) => {
      const props = (layer as unknown as Cloneable).props;
      const getPos = props.getPosition;
      if (typeof getPos !== 'function') return layer;
      const gp = getPos as GetPos;
      const triggers = (props.updateTriggers as Record<string, unknown>) ?? {};
      if (layer instanceof ScatterplotLayer) {
        return (layer as unknown as Cloneable).clone({
          getFillColor: cull(props.getFillColor as ColorAcc, gp),
          getLineColor: cull(props.getLineColor as ColorAcc, gp),
          updateTriggers: {
            ...triggers,
            getFillColor: [triggers.getFillColor, key],
            getLineColor: [triggers.getLineColor, key],
          },
        });
      }
      if (layer instanceof IconLayer) {
        return (layer as unknown as Cloneable).clone({
          getColor: cull(props.getColor as ColorAcc, gp),
          updateTriggers: { ...triggers, getColor: [triggers.getColor, key] },
        });
      }
      if (layer instanceof TextLayer) {
        // Cull both the glyph colour and the pill background so a back-side count
        // badge ("36") disappears entirely instead of floating over the globe.
        return (layer as unknown as Cloneable).clone({
          getColor: cull(props.getColor as ColorAcc, gp),
          getBackgroundColor: cull(props.getBackgroundColor as ColorAcc, gp),
          updateTriggers: {
            ...triggers,
            getColor: [triggers.getColor, key],
            getBackgroundColor: [triggers.getBackgroundColor, key],
          },
        });
      }
      return layer;
    });
  }

  // Layer creation methods
  private createCablesLayer(): PathLayer {
    const highlightedCables = this.highlightedAssets.cable;
    const cacheKey = 'cables-layer';
    const cached = this.layerCache.get(cacheKey) as PathLayer | undefined;
    const onGlobe = this.onGlobe;
    const highlightSignature = this.getSetSignature(highlightedCables) + (onGlobe ? '|g' : '|f');
    if (cached && highlightSignature === this.lastCableHighlightSignature) return cached;

    const layer = new PathLayer({
      id: cacheKey,
      // Guard the PathLayer contract: every path needs ≥2 finite [lon,lat] vertices.
      // A single malformed cable (short/NaN path) makes deck.gl assert at init and
      // silently drop the WHOLE layer (the "[GlobeNative] cables-layer assertion" —
      // enabled yet never drawing). Filtering keeps the good cables rendering. On the
      // globe use the great-circle-densified form so cables hug the sphere.
      data: onGlobe ? cablesGreatCircle : cablesWithValidPaths,
      getPath: (d) => d.points,
      getColor: (d) =>
        highlightedCables.has(d.id) ? COLORS.cableHighlight : COLORS.cable,
      getWidth: (d) => highlightedCables.has(d.id) ? 3 : 1,
      widthMinPixels: 1,
      widthMaxPixels: 5,
      pickable: true,
      updateTriggers: { highlighted: highlightSignature },
    });

    this.lastCableHighlightSignature = highlightSignature;
    this.layerCache.set(cacheKey, layer);
    return layer;
  }

  private createPipelinesLayer(): PathLayer {
    const highlightedPipelines = this.highlightedAssets.pipeline;
    const cacheKey = 'pipelines-layer';
    const cached = this.layerCache.get(cacheKey) as PathLayer | undefined;
    const onGlobe = this.onGlobe;
    const highlightSignature = this.getSetSignature(highlightedPipelines) + (onGlobe ? '|g' : '|f');
    if (cached && highlightSignature === this.lastPipelineHighlightSignature) return cached;

    const layer = new PathLayer({
      id: cacheKey,
      // Globe: great-circle-densified so pipelines hug the sphere (see cables).
      data: onGlobe ? pipelinesGreatCircle : PIPELINES,
      getPath: (d) => d.points,
      getColor: (d) => {
        if (highlightedPipelines.has(d.id)) {
          return [255, 100, 100, 200] as [number, number, number, number];
        }
        const colorKey = d.type as keyof typeof PIPELINE_COLORS;
        const hex = PIPELINE_COLORS[colorKey] || '#666666';
        return this.hexToRgba(hex, 150);
      },
      getWidth: (d) => highlightedPipelines.has(d.id) ? 3 : 1.5,
      widthMinPixels: 1,
      widthMaxPixels: 4,
      pickable: true,
      updateTriggers: { highlighted: highlightSignature },
    });

    this.lastPipelineHighlightSignature = highlightSignature;
    this.layerCache.set(cacheKey, layer);
    return layer;
  }

  private createConflictZonesLayer(): GeoJsonLayer {
    const cacheKey = 'conflict-zones-layer';

    const geojsonData = {
      type: 'FeatureCollection' as const,
      features: CONFLICT_ZONES.map(zone => ({
        type: 'Feature' as const,
        properties: { id: zone.id, name: zone.name, intensity: zone.intensity },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [zone.coords],
        },
      })),
    };

    const layer = new GeoJsonLayer({
      id: cacheKey,
      data: geojsonData,
      filled: true,
      stroked: true,
      getFillColor: () => COLORS.conflict,
      getLineColor: () => getCurrentTheme() === 'light'
        ? [255, 0, 0, 120] as [number, number, number, number]
        : [255, 0, 0, 180] as [number, number, number, number],
      getLineWidth: 2,
      lineWidthMinPixels: 1,
      pickable: true,
    });
    return layer;
  }

  private createBasesLayer(): IconLayer {
    const highlightedBases = this.highlightedAssets.base;

    // Base colors by operator type - semi-transparent for layering
    // F: Fade in bases as you zoom — subtle at zoom 3, full at zoom 5+
    const zoom = this.mapboxMap?.getZoom() || 3;
    const alphaScale = Math.min(1, (zoom - 2.5) / 2.5); // 0.2 at zoom 3, 1.0 at zoom 5
    const a = Math.round(160 * Math.max(0.3, alphaScale));

    const getBaseColor = (type: string): [number, number, number, number] => {
      switch (type) {
        case 'us-nato': return [68, 136, 255, a];
        case 'russia': return [255, 68, 68, a];
        case 'china': return [255, 136, 68, a];
        case 'uk': return [68, 170, 255, a];
        case 'france': return [0, 85, 164, a];
        case 'india': return [255, 153, 51, a];
        case 'japan': return [188, 0, 45, a];
        default: return [136, 136, 136, a];
      }
    };

    // Military bases: TRIANGLE icons - color by operator, semi-transparent
    return new IconLayer({
      id: 'bases-layer',
      data: MILITARY_BASES,
      getPosition: (d) => [d.lon, d.lat],
      getIcon: () => 'triangleUp',
      iconAtlas: MARKER_ICONS.triangleUp,
      iconMapping: { triangleUp: { x: 0, y: 0, width: 32, height: 32, mask: true } },
      getSize: (d) => highlightedBases.has(d.id) ? 16 : 11,
      getColor: (d) => {
        if (highlightedBases.has(d.id)) {
          return [255, 100, 100, 220] as [number, number, number, number];
        }
        return getBaseColor(d.type);
      },
      sizeScale: 1,
      sizeMinPixels: 6,
      sizeMaxPixels: 16,
      pickable: true,
    });
  }

  private createNuclearLayer(): IconLayer {
    const highlightedNuclear = this.highlightedAssets.nuclear;
    const data = NUCLEAR_FACILITIES.filter(f => f.status !== 'decommissioned');

    // Nuclear: HEXAGON icons - yellow/orange color, semi-transparent
    return new IconLayer({
      id: 'nuclear-layer',
      data,
      getPosition: (d) => [d.lon, d.lat],
      getIcon: () => 'hexagon',
      iconAtlas: MARKER_ICONS.hexagon,
      iconMapping: { hexagon: { x: 0, y: 0, width: 32, height: 32, mask: true } },
      getSize: (d) => highlightedNuclear.has(d.id) ? 15 : 11,
      getColor: (d) => {
        if (highlightedNuclear.has(d.id)) {
          return [255, 100, 100, 220] as [number, number, number, number];
        }
        if (d.status === 'contested') {
          return [255, 50, 50, 200] as [number, number, number, number];
        }
        return [255, 220, 0, 200] as [number, number, number, number]; // Semi-transparent yellow
      },
      sizeScale: 1,
      sizeMinPixels: 6,
      sizeMaxPixels: 15,
      pickable: true,
    });
  }

  private createIrradiatorsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'irradiators-layer',
      data: GAMMA_IRRADIATORS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 6000,
      getFillColor: [255, 100, 255, 180] as [number, number, number, number], // Magenta
      radiusMinPixels: 4,
      radiusMaxPixels: 10,
      pickable: true,
    });
  }

  private createSpaceportsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'spaceports-layer',
      data: SPACEPORTS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 10000,
      getFillColor: [200, 100, 255, 200] as [number, number, number, number], // Purple
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createRoboticsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'robotics-layer',
      data: ROBOTICS_ORGS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 9000,
      getFillColor: (d) => roboticsCategoryColor(d.category),
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createQuantumLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'quantum-layer',
      data: QUANTUM_PLAYERS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 9000,
      getFillColor: (d) => quantumModalityColor(d.modality),
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createPortsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'ports-layer',
      data: PORTS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 6000,
      getFillColor: (d) => {
        // Color by port type (matching old Map.ts icons)
        switch (d.type) {
          case 'naval': return [100, 150, 255, 200] as [number, number, number, number]; // Blue - ⚓
          case 'oil': return [255, 140, 0, 200] as [number, number, number, number]; // Orange - 🛢️
          case 'lng': return [255, 200, 50, 200] as [number, number, number, number]; // Yellow - 🛢️
          case 'container': return [0, 200, 255, 180] as [number, number, number, number]; // Cyan - 🏭
          case 'mixed': return [150, 200, 150, 180] as [number, number, number, number]; // Green
          case 'bulk': return [180, 150, 120, 180] as [number, number, number, number]; // Brown
          default: return [0, 200, 255, 160] as [number, number, number, number];
        }
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 10,
      pickable: true,
    });
  }

  private createFlightDelaysLayer(delays: AirportDelayAlert[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'flight-delays-layer',
      data: delays,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => {
        if (d.severity === 'GDP') return 15000; // Ground Delay Program
        if (d.severity === 'GS') return 12000; // Ground Stop
        return 8000;
      },
      getFillColor: (d) => {
        if (d.severity === 'GS') return [255, 50, 50, 200] as [number, number, number, number]; // Red for ground stops
        if (d.severity === 'GDP') return [255, 150, 0, 200] as [number, number, number, number]; // Orange for delays
        return [255, 200, 100, 180] as [number, number, number, number]; // Yellow
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 15,
      pickable: true,
    });
  }

  private createGhostLayer<T>(id: string, data: T[], getPosition: (d: T) => [number, number], opts: { radiusMinPixels?: number } = {}): ScatterplotLayer<T> {
    return new ScatterplotLayer<T>({
      id: `${id}-ghost`,
      data,
      getPosition,
      getRadius: 1,
      radiusMinPixels: opts.radiusMinPixels ?? 12,
      getFillColor: [0, 0, 0, 0],
      pickable: true,
    });
  }


  private createDatacentersLayer(): IconLayer {
    const highlightedDC = this.highlightedAssets.datacenter;
    const data = AI_DATA_CENTERS.filter(dc => dc.status !== 'decommissioned');

    // Datacenters: SQUARE icons - purple color, semi-transparent for layering
    return new IconLayer({
      id: 'datacenters-layer',
      data,
      getPosition: (d) => [d.lon, d.lat],
      getIcon: () => 'square',
      iconAtlas: MARKER_ICONS.square,
      iconMapping: { square: { x: 0, y: 0, width: 32, height: 32, mask: true } },
      getSize: (d) => highlightedDC.has(d.id) ? 14 : 10,
      getColor: (d) => {
        if (highlightedDC.has(d.id)) {
          return [255, 100, 100, 200] as [number, number, number, number];
        }
        if (d.status === 'planned') {
          return [136, 68, 255, 100] as [number, number, number, number]; // Transparent for planned
        }
        return [136, 68, 255, 140] as [number, number, number, number]; // ~55% opacity
      },
      sizeScale: 1,
      sizeMinPixels: 6,
      sizeMaxPixels: 14,
      pickable: true,
    });
  }

  private createEarthquakesLayer(earthquakes: Earthquake[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'earthquakes-layer',
      data: earthquakes,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => Math.pow(2, d.magnitude) * 1000,
      getFillColor: (d) => {
        const mag = d.magnitude;
        if (mag >= 6) return [255, 0, 0, 200] as [number, number, number, number];
        if (mag >= 5) return [255, 100, 0, 200] as [number, number, number, number];
        return COLORS.earthquake;
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 30,
      pickable: true,
    });
  }

  private createNaturalEventsLayer(events: NaturalEvent[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'natural-events-layer',
      data: events,
      getPosition: (d: NaturalEvent) => [d.lon, d.lat],
      getRadius: (d: NaturalEvent) => d.title.startsWith('🔴') ? 20000 : d.title.startsWith('🟠') ? 15000 : 8000,
      getFillColor: (d: NaturalEvent) => {
        if (d.title.startsWith('🔴')) return [255, 0, 0, 220] as [number, number, number, number];
        if (d.title.startsWith('🟠')) return [255, 140, 0, 200] as [number, number, number, number];
        return [255, 150, 50, 180] as [number, number, number, number];
      },
      radiusMinPixels: 5,
      radiusMaxPixels: 18,
      pickable: true,
    });
  }

  private createFiresLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'fires-layer',
      data: this.firmsFireData,
      getPosition: (d: (typeof this.firmsFireData)[0]) => [d.lon, d.lat],
      getRadius: (d: (typeof this.firmsFireData)[0]) => Math.min(d.frp * 200, 30000) || 5000,
      getFillColor: (d: (typeof this.firmsFireData)[0]) => {
        if (d.brightness > 400) return [255, 30, 0, 220] as [number, number, number, number];
        if (d.brightness > 350) return [255, 140, 0, 200] as [number, number, number, number];
        return [255, 220, 50, 180] as [number, number, number, number];
      },
      radiusMinPixels: 3,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createWeatherLayer(alerts: WeatherAlert[]): ScatterplotLayer {
    // Filter weather alerts that have centroid coordinates
    const alertsWithCoords = alerts.filter(a => a.centroid && a.centroid.length === 2);

    return new ScatterplotLayer({
      id: 'weather-layer',
      data: alertsWithCoords,
      getPosition: (d) => d.centroid as [number, number], // centroid is [lon, lat]
      getRadius: 25000,
      getFillColor: (d) => {
        if (d.severity === 'Extreme') return [255, 0, 0, 200] as [number, number, number, number];
        if (d.severity === 'Severe') return [255, 100, 0, 180] as [number, number, number, number];
        if (d.severity === 'Moderate') return [255, 170, 0, 160] as [number, number, number, number];
        return COLORS.weather;
      },
      radiusMinPixels: 8,
      radiusMaxPixels: 20,
      pickable: true,
    });
  }

  private createOutagesLayer(outages: InternetOutage[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'outages-layer',
      data: outages,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 20000,
      getFillColor: COLORS.outage,
      radiusMinPixels: 6,
      radiusMaxPixels: 18,
      pickable: true,
    });
  }

  private createCyberThreatsLayer(): ScatterplotLayer<CyberThreat> {
    return new ScatterplotLayer<CyberThreat>({
      id: 'cyber-threats-layer',
      data: this.cyberThreats,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => {
        switch (d.severity) {
          case 'critical': return 22000;
          case 'high': return 17000;
          case 'medium': return 13000;
          default: return 9000;
        }
      },
      getFillColor: (d) => {
        switch (d.severity) {
          case 'critical': return [255, 61, 0, 225] as [number, number, number, number];
          case 'high': return [255, 102, 0, 205] as [number, number, number, number];
          case 'medium': return [255, 176, 0, 185] as [number, number, number, number];
          default: return [255, 235, 59, 170] as [number, number, number, number];
        }
      },
      radiusMinPixels: 6,
      radiusMaxPixels: 18,
      pickable: true,
      stroked: true,
      getLineColor: [255, 255, 255, 160] as [number, number, number, number],
      lineWidthMinPixels: 1,
    });
  }

  // The dotted-land basemap (2D): a lattice of glowing land dots over the near-black
  // map. Same lattice + bright ice-blue palette the native globe uses, so 2D ↔ 3D
  // read as one surface. Two passes — a soft additive glow underlay + the crisp core
  // dot — so dense land blooms exactly like the 3D globe (mercator has no far side).
  private createLandDotsLayers(): ScatterplotLayer<LandDot>[] {
    const dot = (id: string, radiusMaxPixels: number, alpha: number, additive: boolean): ScatterplotLayer<LandDot> =>
      new ScatterplotLayer<LandDot>({
        id,
        data: this.landDots,
        getPosition: (d) => [d.lon, d.lat],
        getRadius: 15000, // ~1.5° in metres; a tight dot at world zoom
        radiusUnits: 'meters',
        radiusMinPixels: additive ? 1.4 : 0.7,
        radiusMaxPixels,
        getFillColor: [LAND_DOT_NEAR[0], LAND_DOT_NEAR[1], LAND_DOT_NEAR[2], alpha] as [number, number, number, number],
        pickable: false,
        parameters: additive
          ? ({
              blendColorOperation: 'add',
              blendColorSrcFactor: 'src-alpha',
              blendColorDstFactor: 'one',
            } as unknown as Record<string, unknown>)
          : undefined,
      });
    return [dot('land-dots-glow', 6, 60, true), dot('land-dots-core', 3, LAND_DOT_NEAR[3], false)];
  }

  private createAisDensityLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'ais-density-layer',
      data: this.aisDensity,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 4000 + d.intensity * 8000,
      getFillColor: (d) => {
        const intensity = Math.min(Math.max(d.intensity, 0.15), 1);
        const isCongested = (d.deltaPct || 0) >= 15;
        const alpha = Math.round(40 + intensity * 160);
        // Orange for congested areas, cyan for normal traffic
        if (isCongested) {
          return [255, 183, 3, alpha] as [number, number, number, number]; // #ffb703
        }
        return [0, 209, 255, alpha] as [number, number, number, number]; // #00d1ff
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createAisDisruptionsLayer(): ScatterplotLayer {
    // AIS spoofing/jamming events
    return new ScatterplotLayer({
      id: 'ais-disruptions-layer',
      data: this.aisDisruptions,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 12000,
      getFillColor: (d) => {
        // Color by severity/type
        if (d.severity === 'high' || d.type === 'spoofing') {
          return [255, 50, 50, 220] as [number, number, number, number]; // Red
        }
        if (d.severity === 'medium') {
          return [255, 150, 0, 200] as [number, number, number, number]; // Orange
        }
        return [255, 200, 100, 180] as [number, number, number, number]; // Yellow
      },
      radiusMinPixels: 6,
      radiusMaxPixels: 14,
      pickable: true,
      stroked: true,
      getLineColor: [255, 255, 255, 150] as [number, number, number, number],
      lineWidthMinPixels: 1,
    });
  }

  private createCableAdvisoriesLayer(advisories: CableAdvisory[]): ScatterplotLayer {
    // Cable fault/maintenance advisories
    return new ScatterplotLayer({
      id: 'cable-advisories-layer',
      data: advisories,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 10000,
      getFillColor: (d) => {
        if (d.severity === 'fault') {
          return [255, 50, 50, 220] as [number, number, number, number]; // Red for faults
        }
        return [255, 200, 0, 200] as [number, number, number, number]; // Yellow for maintenance
      },
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      pickable: true,
      stroked: true,
      getLineColor: [0, 200, 255, 200] as [number, number, number, number], // Cyan outline (cable color)
      lineWidthMinPixels: 2,
    });
  }

  private createRepairShipsLayer(): ScatterplotLayer {
    // Cable repair ships
    return new ScatterplotLayer({
      id: 'repair-ships-layer',
      data: this.repairShips,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 8000,
      getFillColor: [0, 255, 200, 200] as [number, number, number, number], // Teal
      radiusMinPixels: 4,
      radiusMaxPixels: 10,
      pickable: true,
    });
  }

  private createMilitaryVesselsLayer(vessels: MilitaryVessel[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'military-vessels-layer',
      data: vessels,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 6000,
      getFillColor: COLORS.vesselMilitary,
      radiusMinPixels: 4,
      radiusMaxPixels: 10,
      pickable: true,
    });
  }

  private createMilitaryVesselClustersLayer(clusters: MilitaryVesselCluster[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'military-vessel-clusters-layer',
      data: clusters,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 15000 + (d.vesselCount || 1) * 3000,
      getFillColor: (d) => {
        // Vessel types: 'exercise' | 'deployment' | 'transit' | 'unknown'
        const activity = d.activityType || 'unknown';
        if (activity === 'exercise' || activity === 'deployment') return [255, 100, 100, 200] as [number, number, number, number];
        if (activity === 'transit') return [255, 180, 100, 180] as [number, number, number, number];
        return [200, 150, 150, 160] as [number, number, number, number];
      },
      radiusMinPixels: 8,
      radiusMaxPixels: 25,
      pickable: true,
    });
  }

  private createMilitaryFlightsLayer(flights: MilitaryFlight[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'military-flights-layer',
      data: flights,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 8000,
      getFillColor: COLORS.flightMilitary,
      radiusMinPixels: 4,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createMilitaryFlightClustersLayer(clusters: MilitaryFlightCluster[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'military-flight-clusters-layer',
      data: clusters,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 15000 + (d.flightCount || 1) * 3000,
      getFillColor: (d) => {
        const activity = d.activityType || 'unknown';
        if (activity === 'exercise' || activity === 'patrol') return [100, 150, 255, 200] as [number, number, number, number];
        if (activity === 'transport') return [255, 200, 100, 180] as [number, number, number, number];
        return [150, 150, 200, 160] as [number, number, number, number];
      },
      radiusMinPixels: 8,
      radiusMaxPixels: 25,
      pickable: true,
    });
  }

  private createWaterwaysLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'waterways-layer',
      data: STRATEGIC_WATERWAYS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 10000,
      getFillColor: [100, 150, 255, 180] as [number, number, number, number],
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createEconomicCentersLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'economic-centers-layer',
      data: ECONOMIC_CENTERS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 8000,
      getFillColor: [255, 215, 0, 180] as [number, number, number, number],
      radiusMinPixels: 4,
      radiusMaxPixels: 10,
      pickable: true,
    });
  }

  private createStockExchangesLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'stock-exchanges-layer',
      data: STOCK_EXCHANGES,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => d.tier === 'mega' ? 18000 : d.tier === 'major' ? 14000 : 11000,
      getFillColor: (d) => {
        if (d.tier === 'mega') return [255, 215, 80, 220] as [number, number, number, number];
        if (d.tier === 'major') return COLORS.stockExchange;
        return [140, 210, 255, 190] as [number, number, number, number];
      },
      radiusMinPixels: 5,
      radiusMaxPixels: 14,
      pickable: true,
    });
  }

  private createFinancialCentersLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'financial-centers-layer',
      data: FINANCIAL_CENTERS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => d.type === 'global' ? 17000 : d.type === 'regional' ? 13000 : 10000,
      getFillColor: (d) => {
        if (d.type === 'global') return COLORS.financialCenter;
        if (d.type === 'regional') return [0, 190, 130, 185] as [number, number, number, number];
        return [0, 150, 110, 165] as [number, number, number, number];
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createCentralBanksLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'central-banks-layer',
      data: CENTRAL_BANKS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => d.type === 'major' ? 15000 : d.type === 'supranational' ? 17000 : 12000,
      getFillColor: (d) => {
        if (d.type === 'major') return COLORS.centralBank;
        if (d.type === 'supranational') return [255, 235, 140, 220] as [number, number, number, number];
        return [235, 180, 80, 185] as [number, number, number, number];
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createCommodityHubsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'commodity-hubs-layer',
      data: COMMODITY_HUBS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => d.type === 'exchange' ? 14000 : d.type === 'port' ? 12000 : 10000,
      getFillColor: (d) => {
        if (d.type === 'exchange') return COLORS.commodityHub;
        if (d.type === 'port') return [80, 170, 255, 190] as [number, number, number, number];
        return [255, 110, 80, 185] as [number, number, number, number];
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 11,
      pickable: true,
    });
  }

  private createAPTGroupsLayer(): ScatterplotLayer {
    // APT Groups - cyber threat actor markers (geopolitical variant only)
    // Made subtle to avoid visual clutter - small orange dots
    return new ScatterplotLayer({
      id: 'apt-groups-layer',
      data: APT_GROUPS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 6000,
      getFillColor: [255, 140, 0, 140] as [number, number, number, number], // Subtle orange
      radiusMinPixels: 4,
      radiusMaxPixels: 8,
      pickable: true,
      stroked: false, // No outline - cleaner look
    });
  }

  private createMineralsLayer(): ScatterplotLayer {
    // Critical minerals projects
    return new ScatterplotLayer({
      id: 'minerals-layer',
      data: CRITICAL_MINERALS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 8000,
      getFillColor: (d) => {
        // Color by mineral type
        switch (d.mineral) {
          case 'Lithium': return [0, 200, 255, 200] as [number, number, number, number]; // Cyan
          case 'Cobalt': return [100, 100, 255, 200] as [number, number, number, number]; // Blue
          case 'Rare Earths': return [255, 100, 200, 200] as [number, number, number, number]; // Pink
          case 'Nickel': return [100, 255, 100, 200] as [number, number, number, number]; // Green
          default: return [200, 200, 200, 200] as [number, number, number, number]; // Gray
        }
      },
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  // Tech variant layers
  private createStartupHubsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'startup-hubs-layer',
      data: STARTUP_HUBS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 10000,
      getFillColor: COLORS.startupHub,
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createAcceleratorsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'accelerators-layer',
      data: ACCELERATORS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 6000,
      getFillColor: COLORS.accelerator,
      radiusMinPixels: 3,
      radiusMaxPixels: 8,
      pickable: true,
    });
  }

  private createCloudRegionsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'cloud-regions-layer',
      data: CLOUD_REGIONS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 12000,
      getFillColor: COLORS.cloudRegion,
      radiusMinPixels: 4,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createProtestClusterLayers(): Layer[] {
    this.updateClusterData();
    const layers: Layer[] = [];

    layers.push(new ScatterplotLayer<MapProtestCluster>({
      id: 'protest-clusters-layer',
      data: this.protestClusters,
      getPosition: d => [d.lon, d.lat],
      getRadius: d => 15000 + d.count * 2000,
      radiusMinPixels: 6,
      radiusMaxPixels: 22,
      getFillColor: d => {
        if (d.hasRiot) return [220, 40, 40, 200] as [number, number, number, number];
        if (d.maxSeverity === 'high') return [255, 80, 60, 180] as [number, number, number, number];
        if (d.maxSeverity === 'medium') return [255, 160, 40, 160] as [number, number, number, number];
        return [255, 220, 80, 140] as [number, number, number, number];
      },
      pickable: true,
      updateTriggers: { getRadius: this.lastSCZoom, getFillColor: this.lastSCZoom },
    }));

    layers.push(this.createGhostLayer('protest-clusters-layer', this.protestClusters, d => [d.lon, d.lat], { radiusMinPixels: 14 }));

    const multiClusters = this.protestClusters.filter(c => c.count > 1);
    if (multiClusters.length > 0) {
      layers.push(new TextLayer<MapProtestCluster>({
        id: 'protest-clusters-badge',
        data: multiClusters,
        getText: d => String(d.count),
        getPosition: d => [d.lon, d.lat],
        background: true,
        getBackgroundColor: [0, 0, 0, 180],
        backgroundPadding: [4, 2, 4, 2],
        getColor: [255, 255, 255, 255],
        getSize: 12,
        getPixelOffset: [0, -14],
        pickable: false,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
      }));
    }

    const protestPulse = this.createProtestClustersPulseLayer();
    if (protestPulse) layers.push(protestPulse);

    return layers;
  }

  // The pulsing ring over high-severity/riot protest clusters. Rebuilt in
  // isolation each news-pulse tick (radiusScale only — data reference is the
  // already-clustered array, so deck.gl issues no attribute upload).
  private createProtestClustersPulseLayer(): ScatterplotLayer<MapProtestCluster> | null {
    const pulseClusters = this.protestClusters.filter(c => c.maxSeverity === 'high' || c.hasRiot);
    if (pulseClusters.length === 0) return null;
    // ~8s calm breathe — clear of the 2s pulse-tick sample interval (see news pulse).
    const pulse = 1.0 + 0.8 * (0.5 + 0.5 * Math.sin((this.pulseTime || Date.now()) / 1300));
    return new ScatterplotLayer<MapProtestCluster>({
      id: 'protest-clusters-pulse',
      data: pulseClusters,
      getPosition: d => [d.lon, d.lat],
      getRadius: d => 15000 + d.count * 2000,
      radiusScale: pulse,
      radiusMinPixels: 8,
      radiusMaxPixels: 30,
      stroked: true,
      filled: false,
      getLineColor: d => d.hasRiot ? [220, 40, 40, 120] as [number, number, number, number] : [255, 80, 60, 100] as [number, number, number, number],
      lineWidthMinPixels: 1.5,
      pickable: false,
      updateTriggers: { radiusScale: this.pulseTime },
    });
  }

  private createTechHQClusterLayers(): Layer[] {
    this.updateClusterData();
    const layers: Layer[] = [];
    const zoom = this.mapboxMap?.getZoom() || 2;

    layers.push(new ScatterplotLayer<MapTechHQCluster>({
      id: 'tech-hq-clusters-layer',
      data: this.techHQClusters,
      getPosition: d => [d.lon, d.lat],
      getRadius: d => 10000 + d.count * 1500,
      radiusMinPixels: 5,
      radiusMaxPixels: 18,
      getFillColor: d => {
        if (d.primaryType === 'faang') return [0, 220, 120, 200] as [number, number, number, number];
        if (d.primaryType === 'unicorn') return [255, 100, 200, 180] as [number, number, number, number];
        return [80, 160, 255, 180] as [number, number, number, number];
      },
      pickable: true,
      updateTriggers: { getRadius: this.lastSCZoom },
    }));

    layers.push(this.createGhostLayer('tech-hq-clusters-layer', this.techHQClusters, d => [d.lon, d.lat], { radiusMinPixels: 14 }));

    const multiClusters = this.techHQClusters.filter(c => c.count > 1);
    if (multiClusters.length > 0) {
      layers.push(new TextLayer<MapTechHQCluster>({
        id: 'tech-hq-clusters-badge',
        data: multiClusters,
        getText: d => String(d.count),
        getPosition: d => [d.lon, d.lat],
        background: true,
        getBackgroundColor: [0, 0, 0, 180],
        backgroundPadding: [4, 2, 4, 2],
        getColor: [255, 255, 255, 255],
        getSize: 12,
        getPixelOffset: [0, -14],
        pickable: false,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
      }));
    }

    if (zoom >= 3) {
      const singles = this.techHQClusters.filter(c => c.count === 1);
      if (singles.length > 0) {
        layers.push(new TextLayer<MapTechHQCluster>({
          id: 'tech-hq-clusters-label',
          data: singles,
          getText: d => d.items[0]?.company ?? '',
          getPosition: d => [d.lon, d.lat],
          getSize: 11,
          getColor: [220, 220, 220, 200],
          getPixelOffset: [0, 12],
          pickable: false,
          fontFamily: 'system-ui, sans-serif',
        }));
      }
    }

    return layers;
  }

  private createTechEventClusterLayers(): Layer[] {
    this.updateClusterData();
    const layers: Layer[] = [];

    layers.push(new ScatterplotLayer<MapTechEventCluster>({
      id: 'tech-event-clusters-layer',
      data: this.techEventClusters,
      getPosition: d => [d.lon, d.lat],
      getRadius: d => 10000 + d.count * 1500,
      radiusMinPixels: 5,
      radiusMaxPixels: 18,
      getFillColor: d => {
        if (d.soonestDaysUntil <= 14) return [255, 220, 50, 200] as [number, number, number, number];
        return [80, 140, 255, 180] as [number, number, number, number];
      },
      pickable: true,
      updateTriggers: { getRadius: this.lastSCZoom },
    }));

    layers.push(this.createGhostLayer('tech-event-clusters-layer', this.techEventClusters, d => [d.lon, d.lat], { radiusMinPixels: 14 }));

    const multiClusters = this.techEventClusters.filter(c => c.count > 1);
    if (multiClusters.length > 0) {
      layers.push(new TextLayer<MapTechEventCluster>({
        id: 'tech-event-clusters-badge',
        data: multiClusters,
        getText: d => String(d.count),
        getPosition: d => [d.lon, d.lat],
        background: true,
        getBackgroundColor: [0, 0, 0, 180],
        backgroundPadding: [4, 2, 4, 2],
        getColor: [255, 255, 255, 255],
        getSize: 12,
        getPixelOffset: [0, -14],
        pickable: false,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
      }));
    }

    return layers;
  }

  private createDatacenterClusterLayers(): Layer[] {
    this.updateClusterData();
    const layers: Layer[] = [];

    layers.push(new ScatterplotLayer<MapDatacenterCluster>({
      id: 'datacenter-clusters-layer',
      data: this.datacenterClusters,
      getPosition: d => [d.lon, d.lat],
      getRadius: d => 15000 + d.count * 2000,
      radiusMinPixels: 6,
      radiusMaxPixels: 20,
      getFillColor: d => {
        if (d.majorityExisting) return [160, 80, 255, 180] as [number, number, number, number];
        return [80, 160, 255, 180] as [number, number, number, number];
      },
      pickable: true,
      updateTriggers: { getRadius: this.lastSCZoom },
    }));

    layers.push(this.createGhostLayer('datacenter-clusters-layer', this.datacenterClusters, d => [d.lon, d.lat], { radiusMinPixels: 14 }));

    const multiClusters = this.datacenterClusters.filter(c => c.count > 1);
    if (multiClusters.length > 0) {
      layers.push(new TextLayer<MapDatacenterCluster>({
        id: 'datacenter-clusters-badge',
        data: multiClusters,
        getText: d => String(d.count),
        getPosition: d => [d.lon, d.lat],
        background: true,
        getBackgroundColor: [0, 0, 0, 180],
        backgroundPadding: [4, 2, 4, 2],
        getColor: [255, 255, 255, 255],
        getSize: 12,
        getPixelOffset: [0, -14],
        pickable: false,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
      }));
    }

    return layers;
  }

  private createHotspotsLayers(): Layer[] {
    const zoom = this.mapboxMap?.getZoom() || 2;
    const zoomScale = Math.min(1, (zoom - 1) / 3);
    const maxPx = 6 + Math.round(14 * zoomScale);
    const baseOpacity = zoom < 2.5 ? 0.5 : zoom < 4 ? 0.7 : 1.0;
    const layers: Layer[] = [];

    layers.push(new ScatterplotLayer({
      id: 'hotspots-layer',
      data: this.hotspots,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => {
        const score = d.escalationScore || 1;
        return 10000 + score * 5000;
      },
      getFillColor: (d) => {
        const score = d.escalationScore || 1;
        const a = Math.round((score >= 4 ? 200 : score >= 2 ? 200 : 180) * baseOpacity);
        if (score >= 4) return [255, 68, 68, a] as [number, number, number, number];
        if (score >= 2) return [255, 165, 0, a] as [number, number, number, number];
        return [255, 255, 0, a] as [number, number, number, number];
      },
      radiusMinPixels: 4,
      radiusMaxPixels: maxPx,
      pickable: true,
      stroked: true,
      getLineColor: (d) =>
        d.hasBreaking ? [255, 255, 255, 255] as [number, number, number, number] : [0, 0, 0, 0] as [number, number, number, number],
      lineWidthMinPixels: 2,
    }));

    layers.push(this.createGhostLayer('hotspots-layer', this.hotspots, d => [d.lon, d.lat], { radiusMinPixels: 14 }));

    const hotspotsPulse = this.createHotspotsPulseLayer();
    if (hotspotsPulse) layers.push(hotspotsPulse);

    return layers;
  }

  // The pulsing ring over high/breaking hotspots. Rebuilt in isolation each
  // news-pulse tick; zoom-derived baseOpacity is recomputed but unchanged while
  // idle, so only radiusScale moves.
  private createHotspotsPulseLayer(): ScatterplotLayer<HotspotWithBreaking> | null {
    const highHotspots = this.hotspots.filter(h => h.level === 'high' || h.hasBreaking);
    if (highHotspots.length === 0) return null;
    const zoom = this.mapboxMap?.getZoom() || 2;
    const baseOpacity = zoom < 2.5 ? 0.5 : zoom < 4 ? 0.7 : 1.0;
    // ~8s calm breathe — clear of the 2s pulse-tick sample interval (see news pulse).
    const pulse = 1.0 + 0.8 * (0.5 + 0.5 * Math.sin((this.pulseTime || Date.now()) / 1300));
    return new ScatterplotLayer<HotspotWithBreaking>({
      id: 'hotspots-pulse',
      data: highHotspots,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => {
        const score = d.escalationScore || 1;
        return 10000 + score * 5000;
      },
      radiusScale: pulse,
      radiusMinPixels: 6,
      radiusMaxPixels: 30,
      stroked: true,
      filled: false,
      getLineColor: (d) => {
        const a = Math.round(120 * baseOpacity);
        return d.hasBreaking ? [255, 50, 50, a] as [number, number, number, number] : [255, 165, 0, a] as [number, number, number, number];
      },
      lineWidthMinPixels: 1.5,
      pickable: false,
      updateTriggers: { radiusScale: this.pulseTime },
    });
  }

  private createGulfInvestmentsLayer(): ScatterplotLayer {
    return new ScatterplotLayer<GulfInvestment>({
      id: 'gulf-investments-layer',
      data: GULF_INVESTMENTS,
      getPosition: (d: GulfInvestment) => [d.lon, d.lat],
      getRadius: (d: GulfInvestment) => {
        if (!d.investmentUSD) return 20000;
        if (d.investmentUSD >= 50000) return 70000;
        if (d.investmentUSD >= 10000) return 55000;
        if (d.investmentUSD >= 1000) return 40000;
        return 25000;
      },
      getFillColor: (d: GulfInvestment) =>
        d.investingCountry === 'SA' ? COLORS.gulfInvestmentSA : COLORS.gulfInvestmentUAE,
      getLineColor: [255, 255, 255, 80] as [number, number, number, number],
      lineWidthMinPixels: 1,
      radiusMinPixels: 5,
      radiusMaxPixels: 28,
      pickable: true,
    });
  }

  private pulseTime = 0;

  private canPulse(now = Date.now()): boolean {
    return now - this.startupTime > 60_000;
  }

  private hasRecentRiot(now = Date.now(), windowMs = 2 * 60 * 60 * 1000): boolean {
    const hasRecentClusterRiot = this.protestClusters.some(c =>
      c.hasRiot && c.latestRiotEventTimeMs != null && (now - c.latestRiotEventTimeMs) < windowMs
    );
    if (hasRecentClusterRiot) return true;

    // Fallback to raw protests because syncPulseAnimation can run before cluster data refreshes.
    return this.protests.some((p) => {
      if (p.eventType !== 'riot' || p.sourceType === 'gdelt') return false;
      const ts = p.time.getTime();
      return Number.isFinite(ts) && (now - ts) < windowMs;
    });
  }

  private needsPulseAnimation(now = Date.now()): boolean {
    return this.hasRecentNews(now)
      || this.hasRecentRiot(now)
      || this.hotspots.some(h => h.hasBreaking);
  }

  private syncPulseAnimation(now = Date.now()): void {
    if (this.renderPaused) {
      if (this.newsPulseIntervalId !== null) this.stopPulseAnimation();
      return;
    }
    const shouldPulse = this.canPulse(now) && this.needsPulseAnimation(now);
    if (shouldPulse && this.newsPulseIntervalId === null) {
      this.startPulseAnimation();
    } else if (!shouldPulse && this.newsPulseIntervalId !== null) {
      this.stopPulseAnimation();
    }
  }

  // Schedule a targeted animation update: only the layers driven by `source`'s
  // clock are rebuilt this frame; every other layer is reused by reference.
  private schedulePulse(source: 'news' | 'cloud'): void {
    this.pulseDirty[source] = true;
    this.rafUpdatePulse();
  }

  private startPulseAnimation(): void {
    if (this.newsPulseIntervalId !== null) return;
    // 2s cadence (was 500ms): a calm ring, and — paired with the targeted rebuild
    // below — a quarter of the retina redraws. Skips work entirely when paused or
    // once nothing needs pulsing.
    const PULSE_UPDATE_INTERVAL_MS = 2000;

    this.newsPulseIntervalId = setInterval(() => {
      if (this.renderPaused || this.webglLost) return;
      const now = Date.now();
      if (!this.needsPulseAnimation(now)) {
        this.pulseTime = now;
        this.stopPulseAnimation();
        this.schedulePulse('news');
        return;
      }
      this.pulseTime = now;
      this.schedulePulse('news');
    }, PULSE_UPDATE_INTERVAL_MS);
  }

  private stopPulseAnimation(): void {
    if (this.newsPulseIntervalId !== null) {
      clearInterval(this.newsPulseIntervalId);
      this.newsPulseIntervalId = null;
    }
  }

  private static readonly NEWS_THREAT_RGB: Record<string, [number, number, number]> = {
    critical: [239, 68, 68],
    high: [249, 115, 22],
    medium: [234, 179, 8],
    low: [34, 197, 94],
    info: [59, 130, 246],
  };
  private static readonly NEWS_PULSE_DURATION_MS = 30_000;

  private createNewsLocationsLayer(): ScatterplotLayer[] {
    const zoom = this.mapboxMap?.getZoom() || 2;
    const alphaScale = zoom < 2.5 ? 0.4 : zoom < 4 ? 0.7 : 1.0;
    const filteredNewsLocations = this.filterByTime(this.newsLocations, (location) => location.timestamp);
    const THREAT_RGB = DeckGLMap.NEWS_THREAT_RGB;
    const THREAT_ALPHA: Record<string, number> = {
      critical: 220,
      high: 190,
      medium: 160,
      low: 120,
      info: 80,
    };

    const layers: ScatterplotLayer[] = [
      new ScatterplotLayer({
        id: 'news-locations-layer',
        data: filteredNewsLocations,
        getPosition: (d) => [d.lon, d.lat],
        getRadius: 18000,
        getFillColor: (d) => {
          const rgb = THREAT_RGB[d.threatLevel] || [59, 130, 246];
          const a = Math.round((THREAT_ALPHA[d.threatLevel] || 120) * alphaScale);
          return [...rgb, a] as [number, number, number, number];
        },
        radiusMinPixels: 3,
        radiusMaxPixels: 12,
        pickable: true,
      }),
    ];

    const pulseLayer = this.createNewsPulseLayer();
    if (pulseLayer) layers.push(pulseLayer);

    return layers;
  }

  // The travelling ring over just-arrived news markers. Rebuilt in isolation each
  // news-pulse tick (radiusScale + the pulseTime updateTrigger); the base marker
  // layer above it never rebuilds during a pulse.
  private createNewsPulseLayer(): ScatterplotLayer | null {
    const zoom = this.mapboxMap?.getZoom() || 2;
    const alphaScale = zoom < 2.5 ? 0.4 : zoom < 4 ? 0.7 : 1.0;
    const now = this.pulseTime || Date.now();
    const PULSE_DURATION = DeckGLMap.NEWS_PULSE_DURATION_MS;
    const THREAT_RGB = DeckGLMap.NEWS_THREAT_RGB;
    const filteredNewsLocations = this.filterByTime(this.newsLocations, (location) => location.timestamp);
    const recentNews = filteredNewsLocations.filter(d => {
      const firstSeen = this.newsLocationFirstSeen.get(d.title);
      return firstSeen && (now - firstSeen) < PULSE_DURATION;
    });
    if (recentNews.length === 0) return null;

    // ~8s breathe period. The pulse tick samples every 2s (see startPulseAnimation),
    // so the period must stay well clear of 2s or the ring aliases to a static
    // circle; ~8s gives ~4 samples/cycle — a calm, clearly-moving breathe.
    const pulse = 1.0 + 1.5 * (0.5 + 0.5 * Math.sin(now / 1300));
    return new ScatterplotLayer({
      id: 'news-pulse-layer',
      data: recentNews,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 18000,
      radiusScale: pulse,
      radiusMinPixels: 6,
      radiusMaxPixels: 30,
      pickable: false,
      stroked: true,
      filled: false,
      getLineColor: (d) => {
        const rgb = THREAT_RGB[d.threatLevel] || [59, 130, 246];
        const firstSeen = this.newsLocationFirstSeen.get(d.title) || now;
        const age = now - firstSeen;
        const fadeOut = Math.max(0, 1 - age / PULSE_DURATION);
        const a = Math.round(150 * fadeOut * alphaScale);
        return [...rgb, a] as [number, number, number, number];
      },
      lineWidthMinPixels: 1.5,
      updateTriggers: { pulseTime: now },
    });
  }

  private getTooltip(info: PickingInfo): { html: string } | null {
    if (!info.object) return null;

    const rawLayerId = info.layer?.id || '';
    const layerId = rawLayerId.endsWith('-ghost') ? rawLayerId.slice(0, -6) : rawLayerId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = info.object as any;
    const text = (value: unknown): string => escapeHtml(String(value ?? ''));

    switch (layerId) {
      case 'hotspots-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.subtext)}</div>` };
      case 'earthquakes-layer':
        return { html: `<div class="deckgl-tooltip"><strong>M${(obj.magnitude || 0).toFixed(1)} ${t('components.deckgl.tooltip.earthquake')}</strong><br/>${text(obj.place)}</div>` };
      case 'military-vessels-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.operatorCountry)}</div>` };
      case 'military-flights-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.callsign || obj.registration || t('components.deckgl.tooltip.militaryAircraft'))}</strong><br/>${text(obj.type)}</div>` };
      case 'military-vessel-clusters-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name || t('components.deckgl.tooltip.vesselCluster'))}</strong><br/>${obj.vesselCount || 0} ${t('components.deckgl.tooltip.vessels')}<br/>${text(obj.activityType)}</div>` };
      case 'military-flight-clusters-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name || t('components.deckgl.tooltip.flightCluster'))}</strong><br/>${obj.flightCount || 0} ${t('components.deckgl.tooltip.aircraft')}<br/>${text(obj.activityType)}</div>` };
      case 'protests-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.title)}</strong><br/>${text(obj.country)}</div>` };
      case 'protest-clusters-layer':
        if (obj.count === 1) {
          const item = obj.items?.[0];
          return { html: `<div class="deckgl-tooltip"><strong>${text(item?.title || t('components.deckgl.tooltip.protest'))}</strong><br/>${text(item?.city || item?.country || '')}</div>` };
        }
        return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.tooltip.protestsCount', { count: String(obj.count) })}</strong><br/>${text(obj.country)}</div>` };
      case 'tech-hq-clusters-layer':
        if (obj.count === 1) {
          const hq = obj.items?.[0];
          return { html: `<div class="deckgl-tooltip"><strong>${text(hq?.company || '')}</strong><br/>${text(hq?.city || '')}</div>` };
        }
        return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.tooltip.techHQsCount', { count: String(obj.count) })}</strong><br/>${text(obj.city)}</div>` };
      case 'tech-event-clusters-layer':
        if (obj.count === 1) {
          const ev = obj.items?.[0];
          return { html: `<div class="deckgl-tooltip"><strong>${text(ev?.title || '')}</strong><br/>${text(ev?.location || '')}</div>` };
        }
        return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.tooltip.techEventsCount', { count: String(obj.count) })}</strong><br/>${text(obj.location)}</div>` };
      case 'datacenter-clusters-layer':
        if (obj.count === 1) {
          const dc = obj.items?.[0];
          return { html: `<div class="deckgl-tooltip"><strong>${text(dc?.name || '')}</strong><br/>${text(dc?.owner || '')}</div>` };
        }
        return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.tooltip.dataCentersCount', { count: String(obj.count) })}</strong><br/>${text(obj.country)}</div>` };
      case 'bases-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.country)}</div>` };
      case 'nuclear-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.type)}</div>` };
      case 'datacenters-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.owner)}</div>` };
      case 'cables-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${t('components.deckgl.tooltip.underseaCable')}</div>` };
      case 'pipelines-layer': {
        const pipelineType = String(obj.type || '').toLowerCase();
        const pipelineTypeLabel = pipelineType === 'oil'
          ? t('popups.pipeline.types.oil')
          : pipelineType === 'gas'
          ? t('popups.pipeline.types.gas')
          : pipelineType === 'products'
          ? t('popups.pipeline.types.products')
          : `${text(obj.type)} ${t('components.deckgl.tooltip.pipeline')}`;
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${pipelineTypeLabel}</div>` };
      }
      case 'conflict-zones-layer': {
        const props = obj.properties || obj;
        return { html: `<div class="deckgl-tooltip"><strong>${text(props.name)}</strong><br/>${t('components.deckgl.tooltip.conflictZone')}</div>` };
      }
      case 'natural-events-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.title)}</strong><br/>${text(obj.category || t('components.deckgl.tooltip.naturalEvent'))}</div>` };
      case 'ais-density-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.layers.shipTraffic')}</strong><br/>${t('popups.intensity')}: ${text(obj.intensity)}</div>` };
      case 'waterways-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${t('components.deckgl.layers.strategicWaterways')}</div>` };
      case 'economic-centers-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.country)}</div>` };
      case 'stock-exchanges-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.shortName)}</strong><br/>${text(obj.city)}, ${text(obj.country)}</div>` };
      case 'financial-centers-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.type)} ${t('components.deckgl.tooltip.financialCenter')}</div>` };
      case 'central-banks-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.shortName)}</strong><br/>${text(obj.city)}, ${text(obj.country)}</div>` };
      case 'commodity-hubs-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.type)} · ${text(obj.city)}</div>` };
      case 'startup-hubs-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.city)}</strong><br/>${text(obj.country)}</div>` };
      case 'tech-hqs-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.company)}</strong><br/>${text(obj.city)}</div>` };
      case 'accelerators-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.city)}</div>` };
      case 'cloud-regions-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.provider)}</strong><br/>${text(obj.region)}</div>` };
      case 'tech-events-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.title)}</strong><br/>${text(obj.location)}</div>` };
      case 'irradiators-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.type || t('components.deckgl.layers.gammaIrradiators'))}</div>` };
      case 'spaceports-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.country || t('components.deckgl.layers.spaceports'))}</div>` };
      case 'robotics-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.focus)}<br/>${text(obj.city)}, ${text(obj.country)}</div>` };
      case 'quantum-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.metric)}<br/>${text(obj.modality)} · ${text(obj.city)}</div>` };
      case 'ports-layer': {
        const typeIcon = obj.type === 'naval' ? '⚓' : obj.type === 'oil' || obj.type === 'lng' ? '🛢️' : '🏭';
        return { html: `<div class="deckgl-tooltip"><strong>${typeIcon} ${text(obj.name)}</strong><br/>${text(obj.type || t('components.deckgl.tooltip.port'))} - ${text(obj.country)}</div>` };
      }
      case 'flight-delays-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.airport)}</strong><br/>${text(obj.severity)}: ${text(obj.reason)}</div>` };
      case 'apt-groups-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.aka)}<br/>${t('popups.sponsor')}: ${text(obj.sponsor)}</div>` };
      case 'minerals-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.mineral)} - ${text(obj.country)}<br/>${text(obj.operator)}</div>` };
      case 'ais-disruptions-layer':
        return { html: `<div class="deckgl-tooltip"><strong>AIS ${text(obj.type || t('components.deckgl.tooltip.disruption'))}</strong><br/>${text(obj.severity)} ${t('popups.severity')}<br/>${text(obj.description)}</div>` };
      case 'cable-advisories-layer': {
        const cableName = UNDERSEA_CABLES.find(c => c.id === obj.cableId)?.name || obj.cableId;
        return { html: `<div class="deckgl-tooltip"><strong>${text(cableName)}</strong><br/>${text(obj.severity || t('components.deckgl.tooltip.advisory'))}<br/>${text(obj.description)}</div>` };
      }
      case 'repair-ships-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name || t('components.deckgl.tooltip.repairShip'))}</strong><br/>${text(obj.status)}</div>` };
      case 'weather-layer': {
        const areaDesc = typeof obj.areaDesc === 'string' ? obj.areaDesc : '';
        const area = areaDesc ? `<br/><small>${text(areaDesc.slice(0, 50))}${areaDesc.length > 50 ? '...' : ''}</small>` : '';
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.event || t('components.deckgl.layers.weatherAlerts'))}</strong><br/>${text(obj.severity)}${area}</div>` };
      }
      case 'outages-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.asn || t('components.deckgl.tooltip.internetOutage'))}</strong><br/>${text(obj.country)}</div>` };
      case 'cyber-threats-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${t('popups.cyberThreat.title')}</strong><br/>${text(obj.severity || t('components.deckgl.tooltip.medium'))} · ${text(obj.country || t('popups.unknown'))}</div>` };
      case 'news-locations-layer':
        return { html: `<div class="deckgl-tooltip"><strong>📰 ${t('components.deckgl.tooltip.news')}</strong><br/>${text(obj.title?.slice(0, 80) || '')}</div>` };
      case 'chainNodes': {
        const block = Number(obj.blockHeight || 0).toLocaleString();
        const down = obj.live ? '' : ' · down';
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.networkName)}</strong><br/>block ${block} · ${text(obj.peers)} peers${down}</div>` };
      }
      case 'byoGpu': {
        const where = obj.region ? ` · ${text(obj.region)}` : '';
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.model)} ×${text(obj.count)}</strong><br/>${text(obj.city)}${where}</div>` };
      }
      case 'trafficArcs':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.label)}</strong><br/>weight ${text(obj.weight)}</div>` };
      case 'traffic': {
        // Regional activity: WHERE + WHAT. Prefer the router task mix (code/reasoning/
        // chat/vision — what customers here are DOING); fall back to the coarse service
        // class. Percentages of the resolved dimension's total.
        const rg = obj.region ? ` · ${text(obj.region)}` : '';
        const mixObj: Record<string, number> =
          obj.byTask && Object.keys(obj.byTask).length ? obj.byTask : (obj.byService || {});
        const total = Object.values(mixObj).reduce<number>((a, b) => a + Number(b), 0) || 1;
        const mix = Object.entries(mixObj)
          .sort((a, b) => Number(b[1]) - Number(a[1]))
          .slice(0, 3)
          .map(([k, v]) => `${text(k)} ${Math.round((Number(v) / total) * 100)}%`)
          .join(' · ');
        return { html: `<div class="deckgl-tooltip"><strong>🌐 ${text(obj.country)}${rg}</strong><br/>${text(obj.count)} req · last window${mix ? `<br/>${mix}` : ''}</div>` };
      }
      case 'gulf-investments-layer': {
        const inv = obj as GulfInvestment;
        const flag = inv.investingCountry === 'SA' ? '🇸🇦' : '🇦🇪';
        const usd = inv.investmentUSD != null
          ? (inv.investmentUSD >= 1000 ? `$${(inv.investmentUSD / 1000).toFixed(1)}B` : `$${inv.investmentUSD}M`)
          : t('components.deckgl.tooltip.undisclosed');
        const stake = inv.stakePercent != null ? `<br/>${text(String(inv.stakePercent))}% ${t('components.deckgl.tooltip.stake')}` : '';
        return {
          html: `<div class="deckgl-tooltip">
            <strong>${flag} ${text(inv.assetName)}</strong><br/>
            <em>${text(inv.investingEntity)}</em><br/>
            ${text(inv.targetCountry)} · ${text(inv.sector)}<br/>
            <strong>${usd}</strong>${stake}<br/>
            <span style="text-transform:capitalize">${text(inv.status)}</span>
          </div>`,
        };
      }
      default:
        return null;
    }
  }

  private handleClick(info: PickingInfo, event?: MapClickEvent): void {
    // Only a LEFT click selects. Right/middle click (deck.gl's tap recognizer fires
    // onClick for those too) must never pick-and-select — right-click stays free.
    if (isNonLeftClick(event)) return;
    if (!info.object) {
      // Empty map click → country detection. If the click is NOT on a country
      // (ocean / empty space), show nothing — no "identifying country" interstitial.
      if (info.coordinate && this.onCountryClick) {
        const [lon, lat] = info.coordinate as [number, number];
        const country = this.resolveCountryFromCoordinate(lon, lat);
        if (country) {
          this.onCountryClick({ lat, lon, code: country.code, name: country.name });
        }
      }
      return;
    }

    const rawClickLayerId = info.layer?.id || '';
    const layerId = rawClickLayerId.endsWith('-ghost') ? rawClickLayerId.slice(0, -6) : rawClickLayerId;

    // Hotspots show popup with related news
    if (layerId === 'hotspots-layer') {
      const hotspot = info.object as Hotspot;
      const relatedNews = this.getRelatedNews(hotspot);
      this.popup.show({
        type: 'hotspot',
        data: hotspot,
        relatedNews,
        x: info.x,
        y: info.y,
      });
      this.popup.loadHotspotGdeltContext(hotspot);
      this.onHotspotClick?.(hotspot);
      return;
    }

    // Handle cluster layers with single/multi logic
    if (layerId === 'protest-clusters-layer') {
      const cluster = info.object as MapProtestCluster;
      if (cluster.count === 1 && cluster.items[0]) {
        this.popup.show({ type: 'protest', data: cluster.items[0], x: info.x, y: info.y });
      } else {
        this.popup.show({
          type: 'protestCluster',
          data: {
            items: cluster.items,
            country: cluster.country,
            count: cluster.count,
            riotCount: cluster.riotCount,
            highSeverityCount: cluster.highSeverityCount,
            verifiedCount: cluster.verifiedCount,
            totalFatalities: cluster.totalFatalities,
            sampled: cluster.sampled,
          },
          x: info.x,
          y: info.y,
        });
      }
      return;
    }
    if (layerId === 'tech-hq-clusters-layer') {
      const cluster = info.object as MapTechHQCluster;
      if (cluster.count === 1 && cluster.items[0]) {
        this.popup.show({ type: 'techHQ', data: cluster.items[0], x: info.x, y: info.y });
      } else {
        this.popup.show({
          type: 'techHQCluster',
          data: {
            items: cluster.items,
            city: cluster.city,
            country: cluster.country,
            count: cluster.count,
            faangCount: cluster.faangCount,
            unicornCount: cluster.unicornCount,
            publicCount: cluster.publicCount,
            sampled: cluster.sampled,
          },
          x: info.x,
          y: info.y,
        });
      }
      return;
    }
    if (layerId === 'tech-event-clusters-layer') {
      const cluster = info.object as MapTechEventCluster;
      if (cluster.count === 1 && cluster.items[0]) {
        this.popup.show({ type: 'techEvent', data: cluster.items[0], x: info.x, y: info.y });
      } else {
        this.popup.show({
          type: 'techEventCluster',
          data: {
            items: cluster.items,
            location: cluster.location,
            country: cluster.country,
            count: cluster.count,
            soonCount: cluster.soonCount,
            sampled: cluster.sampled,
          },
          x: info.x,
          y: info.y,
        });
      }
      return;
    }
    if (layerId === 'datacenter-clusters-layer') {
      const cluster = info.object as MapDatacenterCluster;
      if (cluster.count === 1 && cluster.items[0]) {
        this.popup.show({ type: 'datacenter', data: cluster.items[0], x: info.x, y: info.y });
      } else {
        this.popup.show({
          type: 'datacenterCluster',
          data: {
            items: cluster.items,
            region: cluster.region || cluster.country,
            country: cluster.country,
            count: cluster.count,
            totalChips: cluster.totalChips,
            totalPowerMW: cluster.totalPowerMW,
            existingCount: cluster.existingCount,
            plannedCount: cluster.plannedCount,
            sampled: cluster.sampled,
          },
          x: info.x,
          y: info.y,
        });
      }
      return;
    }

    // Map layer IDs to popup types
    const layerToPopupType: Record<string, PopupType> = {
      'conflict-zones-layer': 'conflict',
      'bases-layer': 'base',
      'nuclear-layer': 'nuclear',
      'irradiators-layer': 'irradiator',
      'datacenters-layer': 'datacenter',
      'cables-layer': 'cable',
      'pipelines-layer': 'pipeline',
      'earthquakes-layer': 'earthquake',
      'weather-layer': 'weather',
      'outages-layer': 'outage',
      'cyber-threats-layer': 'cyberThreat',
      'protests-layer': 'protest',
      'military-flights-layer': 'militaryFlight',
      'military-vessels-layer': 'militaryVessel',
      'military-vessel-clusters-layer': 'militaryVesselCluster',
      'military-flight-clusters-layer': 'militaryFlightCluster',
      'natural-events-layer': 'natEvent',
      'waterways-layer': 'waterway',
      'economic-centers-layer': 'economic',
      'stock-exchanges-layer': 'stockExchange',
      'financial-centers-layer': 'financialCenter',
      'central-banks-layer': 'centralBank',
      'commodity-hubs-layer': 'commodityHub',
      'spaceports-layer': 'spaceport',
      'ports-layer': 'port',
      'flight-delays-layer': 'flight',
      'startup-hubs-layer': 'startupHub',
      'tech-hqs-layer': 'techHQ',
      'accelerators-layer': 'accelerator',
      'cloud-regions-layer': 'cloudRegion',
      'tech-events-layer': 'techEvent',
      'apt-groups-layer': 'apt',
      'minerals-layer': 'mineral',
      'ais-disruptions-layer': 'ais',
      'cable-advisories-layer': 'cable-advisory',
      'repair-ships-layer': 'repair-ship',
    };

    const popupType = layerToPopupType[layerId];
    if (!popupType) return;

    // For GeoJSON layers, the data is in properties
    let data = info.object;
    if (layerId === 'conflict-zones-layer' && info.object.properties) {
      // Find the full conflict zone data from config
      const conflictId = info.object.properties.id;
      const fullConflict = CONFLICT_ZONES.find(c => c.id === conflictId);
      if (fullConflict) data = fullConflict;
    }

    // Get click coordinates relative to container
    const x = info.x ?? 0;
    const y = info.y ?? 0;

    this.popup.show({
      type: popupType,
      data: data,
      x,
      y,
    });
  }

  // Utility methods
  private hexToRgba(hex: string, alpha: number): [number, number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result && result[1] && result[2] && result[3]) {
      return [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
        alpha,
      ];
    }
    return [100, 100, 100, alpha];
  }

  // UI Creation methods
  private createControls(): void {
    const controls = document.createElement('div');
    controls.className = 'map-controls deckgl-controls';
    controls.innerHTML = `
      <div class="zoom-controls">
        <button class="map-btn zoom-in" title="${t('components.deckgl.zoomIn')}">+</button>
        <button class="map-btn zoom-out" title="${t('components.deckgl.zoomOut')}">-</button>
        <button class="map-btn zoom-reset" title="${t('components.deckgl.resetView')}">&#8962;</button>
      </div>
      <div class="view-selector">
        <select class="view-select">
          <option value="global">${t('components.deckgl.views.global')}</option>
          <option value="america">${t('components.deckgl.views.americas')}</option>
          <option value="mena">${t('components.deckgl.views.mena')}</option>
          <option value="eu">${t('components.deckgl.views.europe')}</option>
          <option value="asia">${t('components.deckgl.views.asia')}</option>
          <option value="latam">${t('components.deckgl.views.latam')}</option>
          <option value="africa">${t('components.deckgl.views.africa')}</option>
          <option value="oceania">${t('components.deckgl.views.oceania')}</option>
        </select>
      </div>
    `;

    this.container.appendChild(controls);

    // Bind events - use event delegation for reliability
    controls.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('zoom-in')) this.zoomIn();
      else if (target.classList.contains('zoom-out')) this.zoomOut();
      else if (target.classList.contains('zoom-reset')) this.resetView();
    });

    const viewSelect = controls.querySelector('.view-select') as HTMLSelectElement;
    viewSelect.value = this.state.view;
    viewSelect.addEventListener('change', () => {
      this.setView(viewSelect.value as DeckMapView);
    });
  }

  private createTimeSlider(): void {
    const slider = document.createElement('div');
    slider.className = 'time-slider deckgl-time-slider';
    slider.innerHTML = `
      <div class="time-options">
        <button class="time-btn ${this.state.timeRange === '1h' ? 'active' : ''}" data-range="1h">1h</button>
        <button class="time-btn ${this.state.timeRange === '6h' ? 'active' : ''}" data-range="6h">6h</button>
        <button class="time-btn ${this.state.timeRange === '24h' ? 'active' : ''}" data-range="24h">24h</button>
        <button class="time-btn ${this.state.timeRange === '48h' ? 'active' : ''}" data-range="48h">48h</button>
        <button class="time-btn ${this.state.timeRange === '7d' ? 'active' : ''}" data-range="7d">7d</button>
        <button class="time-btn ${this.state.timeRange === 'all' ? 'active' : ''}" data-range="all">${t('components.deckgl.timeAll')}</button>
      </div>
    `;

    slider.querySelectorAll('.time-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const range = (btn as HTMLElement).dataset.range as TimeRange;
        this.setTimeRange(range);
      });
    });
    this.mountDropdown('time', slider, t('components.deckgl.timeRange', { defaultValue: 'Time range' }));
  }

  private updateTimeSliderButtons(): void {
    const slider = this.controlsHost.querySelector('.deckgl-time-slider');
    if (!slider) return;
    slider.querySelectorAll('.time-btn').forEach((btn) => {
      const range = (btn as HTMLElement).dataset.range as TimeRange | undefined;
      btn.classList.toggle('active', range === this.state.timeRange);
    });
    this.syncDropdownLabel(slider.closest('.deckgl-dd'));
  }

  private createLayerToggles(): void {
    const toggles = document.createElement('div');
    // Hidden by default (the `open` class reveals it). The dock's Layers button
    // toggles it so the panel never covers the map/panels unbidden.
    toggles.className = 'layer-toggles deckgl-layer-toggles';
    this.layerPanelEl = toggles;

    const layerConfig = SITE_VARIANT === 'tech'
      ? [
        { key: 'startupHubs', label: t('components.deckgl.layers.startupHubs'), icon: '&#128640;' },
        { key: 'techHQs', label: t('components.deckgl.layers.techHQs'), icon: '&#127970;' },
        { key: 'accelerators', label: t('components.deckgl.layers.accelerators'), icon: '&#9889;' },
        { key: 'cloudRegions', label: t('components.deckgl.layers.cloudRegions'), icon: '&#9729;' },
        { key: 'datacenters', label: t('components.deckgl.layers.aiDataCenters'), icon: '&#128421;' },
        { key: 'cables', label: t('components.deckgl.layers.underseaCables'), icon: '&#128268;' },
        { key: 'outages', label: t('components.deckgl.layers.internetOutages'), icon: '&#128225;' },
        { key: 'cyberThreats', label: t('components.deckgl.layers.cyberThreats'), icon: '&#128737;' },
        { key: 'techEvents', label: t('components.deckgl.layers.techEvents'), icon: '&#128197;' },
        { key: 'natural', label: t('components.deckgl.layers.naturalEvents'), icon: '&#127755;' },
        { key: 'fires', label: t('components.deckgl.layers.fires'), icon: '&#128293;' },
      ]
      : SITE_VARIANT === 'finance'
      ? [
          { key: 'stockExchanges', label: t('components.deckgl.layers.stockExchanges'), icon: '&#127963;' },
          { key: 'financialCenters', label: t('components.deckgl.layers.financialCenters'), icon: '&#128176;' },
          { key: 'centralBanks', label: t('components.deckgl.layers.centralBanks'), icon: '&#127974;' },
          { key: 'commodityHubs', label: t('components.deckgl.layers.commodityHubs'), icon: '&#128230;' },
          { key: 'gulfInvestments', label: t('components.deckgl.layers.gulfInvestments'), icon: '&#127760;' },
          { key: 'cables', label: t('components.deckgl.layers.underseaCables'), icon: '&#128268;' },
          { key: 'pipelines', label: t('components.deckgl.layers.pipelines'), icon: '&#128738;' },
          { key: 'outages', label: t('components.deckgl.layers.internetOutages'), icon: '&#128225;' },
          { key: 'weather', label: t('components.deckgl.layers.weatherAlerts'), icon: '&#9928;' },
          { key: 'economic', label: t('components.deckgl.layers.economicCenters'), icon: '&#128176;' },
          { key: 'waterways', label: t('components.deckgl.layers.strategicWaterways'), icon: '&#9875;' },
          { key: 'natural', label: t('components.deckgl.layers.naturalEvents'), icon: '&#127755;' },
          { key: 'cyberThreats', label: t('components.deckgl.layers.cyberThreats'), icon: '&#128737;' },
        ]
      : [
        { key: 'hotspots', label: t('components.deckgl.layers.intelHotspots'), icon: '&#127919;' },
        { key: 'conflicts', label: t('components.deckgl.layers.conflictZones'), icon: '&#9876;' },
        { key: 'bases', label: t('components.deckgl.layers.militaryBases'), icon: '&#127963;' },
        { key: 'nuclear', label: t('components.deckgl.layers.nuclearSites'), icon: '&#9762;' },
        { key: 'irradiators', label: t('components.deckgl.layers.gammaIrradiators'), icon: '&#9888;' },
        { key: 'spaceports', label: t('components.deckgl.layers.spaceports'), icon: '&#128640;' },
        { key: 'robotics', label: t('components.deckgl.layers.robotics'), icon: '&#129302;' },
        { key: 'quantum', label: t('components.deckgl.layers.quantum'), icon: '&#9883;' },
        { key: 'cables', label: t('components.deckgl.layers.underseaCables'), icon: '&#128268;' },
        { key: 'pipelines', label: t('components.deckgl.layers.pipelines'), icon: '&#128738;' },
        { key: 'datacenters', label: t('components.deckgl.layers.aiDataCenters'), icon: '&#128421;' },
        { key: 'military', label: t('components.deckgl.layers.militaryActivity'), icon: '&#9992;' },
        { key: 'ais', label: t('components.deckgl.layers.shipTraffic'), icon: '&#128674;' },
        { key: 'flights', label: t('components.deckgl.layers.flightDelays'), icon: '&#9992;' },
        { key: 'protests', label: t('components.deckgl.layers.protests'), icon: '&#128226;' },
        { key: 'ucdpEvents', label: t('components.deckgl.layers.ucdpEvents'), icon: '&#9876;' },
        { key: 'displacement', label: t('components.deckgl.layers.displacementFlows'), icon: '&#128101;' },
        { key: 'climate', label: t('components.deckgl.layers.climateAnomalies'), icon: '&#127787;' },
        { key: 'weather', label: t('components.deckgl.layers.weatherAlerts'), icon: '&#9928;' },
        { key: 'outages', label: t('components.deckgl.layers.internetOutages'), icon: '&#128225;' },
        { key: 'cyberThreats', label: t('components.deckgl.layers.cyberThreats'), icon: '&#128737;' },
        { key: 'natural', label: t('components.deckgl.layers.naturalEvents'), icon: '&#127755;' },
        { key: 'fires', label: t('components.deckgl.layers.fires'), icon: '&#128293;' },
        { key: 'waterways', label: t('components.deckgl.layers.strategicWaterways'), icon: '&#9875;' },
        { key: 'economic', label: t('components.deckgl.layers.economicCenters'), icon: '&#128176;' },
        { key: 'minerals', label: t('components.deckgl.layers.criticalMinerals'), icon: '&#128142;' },
        // Hanzo World cloud map layers (default OFF in world; ON for saas/crypto via config)
        { key: 'chainNodes', label: 'Chain nodes', icon: '&#9939;' },
        { key: 'byoGpu', label: 'BYO GPUs', icon: '&#128187;' },
        { key: 'trafficArcs', label: 'Traffic arcs', icon: '&#8644;' },
        { key: 'traffic', label: 'Live traffic', icon: '&#127760;' },
      ];

    // Apply the user's persisted cosmetic ordering of the toggle rows (drag to
    // reorder). Unknown/removed keys are dropped; new keys append in config order.
    const orderedConfig = this.applyPersistedLayerOrder(layerConfig);

    toggles.innerHTML = `
      <div class="toggle-header">
        <span class="toggle-drag-grip" title="${t('components.deckgl.dragPanel', { defaultValue: 'Drag to move' })}">⠿</span>
        <span>${t('components.deckgl.layersTitle')}</span>
        <button class="layer-help-btn" title="${t('components.deckgl.layerGuide')}">?</button>
        <button class="toggle-collapse">&#9660;</button>
      </div>
      <div class="toggle-list" style="max-height: 32vh; overflow-y: auto; scrollbar-width: thin;">
        ${orderedConfig.map(({ key, label, icon }) => `
          <label class="layer-toggle" data-layer="${key}">
            <span class="layer-reorder-grip" title="${t('components.deckgl.dragReorder', { defaultValue: 'Drag to reorder' })}" aria-hidden="true">⠿</span>
            <input type="checkbox" ${this.state.layers[key as keyof MapLayers] ? 'checked' : ''}>
            <span class="toggle-icon">${icon}</span>
            <span class="toggle-label">${label}</span>
          </label>
        `).join('')}
      </div>
    `;

    this.container.appendChild(toggles);

    // Bind toggle events
    toggles.querySelectorAll('.layer-toggle input').forEach(input => {
      input.addEventListener('change', () => {
        const layer = (input as HTMLInputElement).closest('.layer-toggle')?.getAttribute('data-layer') as keyof MapLayers;
        if (layer) {
          this.state.layers[layer] = (input as HTMLInputElement).checked;
          this.render();
          this.onLayerChange?.(layer, (input as HTMLInputElement).checked);
        }
      });
    });

    // Help button
    const helpBtn = toggles.querySelector('.layer-help-btn');
    helpBtn?.addEventListener('click', () => this.showLayerHelp());

    // Collapse toggle
    const collapseBtn = toggles.querySelector('.toggle-collapse');
    const toggleList = toggles.querySelector('.toggle-list');

    // Manual scroll: intercept wheel, prevent map zoom, scroll the list ourselves
    if (toggleList) {
      toggles.addEventListener('wheel', (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleList.scrollTop += e.deltaY;
      }, { passive: false });
      toggles.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false });
    }
    collapseBtn?.addEventListener('click', () => {
      toggleList?.classList.toggle('collapsed');
      if (collapseBtn) collapseBtn.innerHTML = toggleList?.classList.contains('collapsed') ? '&#9654;' : '&#9660;';
    });

    // Task 3 UX: the panel is draggable by its header (position persisted), and the
    // rows drag-reorder within the list (order persisted, purely cosmetic).
    const header = toggles.querySelector('.toggle-header') as HTMLElement | null;
    if (header) this.makeLayerPanelDraggable(toggles, header);
    if (toggleList) this.makeLayerListSortable(toggleList as HTMLElement);
    this.restoreLayerPanelPosition(toggles);
  }

  // ---- Layer panel: draggable + sortable (persisted) ------------------------

  private layerOrderStore(): string[] {
    try {
      const raw = localStorage.getItem(LAYER_PANEL_ORDER_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? arr.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      return [];
    }
  }

  private applyPersistedLayerOrder<T extends { key: string }>(config: T[]): T[] {
    const order = this.layerOrderStore();
    if (order.length === 0) return config;
    const byKey = new Map(config.map((c) => [c.key, c]));
    const out: T[] = [];
    for (const key of order) {
      const item = byKey.get(key);
      if (item) { out.push(item); byKey.delete(key); }
    }
    // Any keys not covered by the saved order keep their config position at the end.
    for (const c of config) if (byKey.has(c.key)) out.push(c);
    return out;
  }

  private saveLayerOrder(list: HTMLElement): void {
    const order = Array.from(list.querySelectorAll('.layer-toggle'))
      .map((el) => (el as HTMLElement).dataset.layer)
      .filter((k): k is string => Boolean(k));
    try { localStorage.setItem(LAYER_PANEL_ORDER_KEY, JSON.stringify(order)); } catch { /* ignore */ }
  }

  // Pointer-driven row reordering, initiated only from the row's grip so the
  // checkbox/label stay clickable. Reorders the DOM live; commits order on release.
  private makeLayerListSortable(list: HTMLElement): void {
    let dragging: HTMLElement | null = null;
    list.querySelectorAll('.layer-reorder-grip').forEach((gripNode) => {
      const grip = gripNode as HTMLElement;
      const row = grip.closest('.layer-toggle') as HTMLElement | null;
      if (!row) return;
      grip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = row;
        row.classList.add('reordering');
        grip.setPointerCapture(e.pointerId);
      });
      grip.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const rows = Array.from(list.querySelectorAll('.layer-toggle')) as HTMLElement[];
        const after = rows.find((r) => {
          if (r === dragging) return false;
          const box = r.getBoundingClientRect();
          return e.clientY < box.top + box.height / 2;
        });
        if (after && after !== dragging.nextElementSibling) list.insertBefore(dragging, after);
        else if (!after && dragging !== list.lastElementChild) list.appendChild(dragging);
      });
      const end = (e: PointerEvent): void => {
        if (!dragging) return;
        dragging.classList.remove('reordering');
        dragging = null;
        try { grip.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
        this.saveLayerOrder(list);
      };
      grip.addEventListener('pointerup', end);
      grip.addEventListener('pointercancel', end);
    });
  }

  private loadLayerPanelPos(): { x: number; y: number } | null {
    try {
      const raw = localStorage.getItem(LAYER_PANEL_POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
      return typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null;
    } catch {
      return null;
    }
  }

  // Clamp so the panel can never be dragged fully off-screen (leave a grabbable strip).
  private clampPanelPos(panel: HTMLElement, x: number, y: number): { x: number; y: number } {
    const parent = panel.parentElement?.getBoundingClientRect();
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const maxX = (parent?.width ?? window.innerWidth) - Math.min(w, 80);
    const maxY = (parent?.height ?? window.innerHeight) - Math.min(h, 40);
    return { x: Math.max(0, Math.min(x, maxX)), y: Math.max(0, Math.min(y, maxY)) };
  }

  private positionLayerPanel(panel: HTMLElement, x: number, y: number): void {
    const { x: cx, y: cy } = this.clampPanelPos(panel, x, y);
    // Switch from the default bottom-left anchor to explicit top-left placement.
    panel.style.left = `${cx}px`;
    panel.style.top = `${cy}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  private restoreLayerPanelPosition(panel: HTMLElement): void {
    const pos = this.loadLayerPanelPos();
    if (pos) requestAnimationFrame(() => this.positionLayerPanel(panel, pos.x, pos.y));
  }

  private makeLayerPanelDraggable(panel: HTMLElement, header: HTMLElement): void {
    const grip = header.querySelector('.toggle-drag-grip') as HTMLElement | null;
    if (!grip) return;
    let startX = 0, startY = 0, baseX = 0, baseY = 0, dragging = false;
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      const box = panel.getBoundingClientRect();
      const parent = panel.parentElement?.getBoundingClientRect();
      baseX = box.left - (parent?.left ?? 0);
      baseY = box.top - (parent?.top ?? 0);
      startX = e.clientX;
      startY = e.clientY;
      panel.classList.add('dragging');
      grip.setPointerCapture(e.pointerId);
    });
    grip.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.positionLayerPanel(panel, baseX + (e.clientX - startX), baseY + (e.clientY - startY));
    });
    const end = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('dragging');
      try { grip.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      const parent = panel.parentElement?.getBoundingClientRect();
      const box = panel.getBoundingClientRect();
      const pos = { x: box.left - (parent?.left ?? 0), y: box.top - (parent?.top ?? 0) };
      try { localStorage.setItem(LAYER_PANEL_POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  /** Show layer help popup explaining each layer */
  private showLayerHelp(): void {
    const existing = this.container.querySelector('.layer-help-popup');
    if (existing) {
      existing.remove();
      return;
    }

    const popup = document.createElement('div');
    popup.className = 'layer-help-popup';

    const label = (layerKey: string): string => t(`components.deckgl.layers.${layerKey}`).toUpperCase();
    const staticLabel = (labelKey: string): string => t(`components.deckgl.layerHelp.labels.${labelKey}`).toUpperCase();
    const helpItem = (layerLabel: string, descriptionKey: string): string =>
      `<div class="layer-help-item"><span>${layerLabel}</span> ${t(`components.deckgl.layerHelp.descriptions.${descriptionKey}`)}</div>`;
    const helpSection = (titleKey: string, items: string[], noteKey?: string): string => `
      <div class="layer-help-section">
        <div class="layer-help-title">${t(`components.deckgl.layerHelp.sections.${titleKey}`)}</div>
        ${items.join('')}
        ${noteKey ? `<div class="layer-help-note">${t(`components.deckgl.layerHelp.notes.${noteKey}`)}</div>` : ''}
      </div>
    `;
    const helpHeader = `
      <div class="layer-help-header">
        <span>${t('components.deckgl.layerHelp.title')}</span>
        <button class="layer-help-close">×</button>
      </div>
    `;

    const techHelpContent = `
      ${helpHeader}
      <div class="layer-help-content">
        ${helpSection('techEcosystem', [
          helpItem(label('startupHubs'), 'techStartupHubs'),
          helpItem(label('cloudRegions'), 'techCloudRegions'),
          helpItem(label('techHQs'), 'techHQs'),
          helpItem(label('accelerators'), 'techAccelerators'),
        ])}
        ${helpSection('infrastructure', [
          helpItem(label('underseaCables'), 'infraCables'),
          helpItem(label('aiDataCenters'), 'infraDatacenters'),
          helpItem(label('internetOutages'), 'infraOutages'),
        ])}
        ${helpSection('naturalEconomic', [
          helpItem(label('naturalEvents'), 'naturalEventsTech'),
          helpItem(label('weatherAlerts'), 'weatherAlerts'),
          helpItem(label('economicCenters'), 'economicCenters'),
          helpItem(staticLabel('countries'), 'countriesOverlay'),
        ])}
      </div>
    `;

    const financeHelpContent = `
      ${helpHeader}
      <div class="layer-help-content">
        ${helpSection('financeCore', [
          helpItem(label('stockExchanges'), 'financeExchanges'),
          helpItem(label('financialCenters'), 'financeCenters'),
          helpItem(label('centralBanks'), 'financeCentralBanks'),
          helpItem(label('commodityHubs'), 'financeCommodityHubs'),
        ])}
        ${helpSection('infrastructureRisk', [
          helpItem(label('underseaCables'), 'financeCables'),
          helpItem(label('pipelines'), 'financePipelines'),
          helpItem(label('internetOutages'), 'financeOutages'),
          helpItem(label('cyberThreats'), 'financeCyberThreats'),
        ])}
        ${helpSection('macroContext', [
          helpItem(label('economicCenters'), 'economicCenters'),
          helpItem(label('strategicWaterways'), 'macroWaterways'),
          helpItem(label('weatherAlerts'), 'weatherAlertsMarket'),
          helpItem(label('naturalEvents'), 'naturalEventsMacro'),
        ])}
      </div>
    `;

    const fullHelpContent = `
      ${helpHeader}
      <div class="layer-help-content">
        ${helpSection('timeFilter', [
          helpItem(staticLabel('timeRecent'), 'timeRecent'),
          helpItem(staticLabel('timeExtended'), 'timeExtended'),
        ], 'timeAffects')}
        ${helpSection('geopolitical', [
          helpItem(label('conflictZones'), 'geoConflicts'),
          helpItem(label('intelHotspots'), 'geoHotspots'),
          helpItem(staticLabel('sanctions'), 'geoSanctions'),
          helpItem(label('protests'), 'geoProtests'),
        ])}
        ${helpSection('militaryStrategic', [
          helpItem(label('militaryBases'), 'militaryBases'),
          helpItem(label('nuclearSites'), 'militaryNuclear'),
          helpItem(label('gammaIrradiators'), 'militaryIrradiators'),
          helpItem(label('militaryActivity'), 'militaryActivity'),
        ])}
        ${helpSection('infrastructure', [
          helpItem(label('underseaCables'), 'infraCablesFull'),
          helpItem(label('pipelines'), 'infraPipelinesFull'),
          helpItem(label('internetOutages'), 'infraOutages'),
          helpItem(label('aiDataCenters'), 'infraDatacentersFull'),
        ])}
        ${helpSection('transport', [
          helpItem(staticLabel('shipping'), 'transportShipping'),
          helpItem(label('flightDelays'), 'transportDelays'),
        ])}
        ${helpSection('naturalEconomic', [
          helpItem(label('naturalEvents'), 'naturalEventsFull'),
          helpItem(label('weatherAlerts'), 'weatherAlerts'),
          helpItem(label('economicCenters'), 'economicCenters'),
        ])}
        ${helpSection('labels', [
          helpItem(staticLabel('countries'), 'countriesOverlay'),
          helpItem(label('strategicWaterways'), 'waterwaysLabels'),
        ])}
      </div>
    `;

    popup.innerHTML = SITE_VARIANT === 'tech'
      ? techHelpContent
      : SITE_VARIANT === 'finance'
      ? financeHelpContent
      : fullHelpContent;

    popup.querySelector('.layer-help-close')?.addEventListener('click', () => popup.remove());

    // Prevent scroll events from propagating to map
    const content = popup.querySelector('.layer-help-content');
    if (content) {
      content.addEventListener('wheel', (e) => e.stopPropagation(), { passive: false });
      content.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false });
    }

    // Close on click outside
    setTimeout(() => {
      const closeHandler = (e: MouseEvent) => {
        if (!popup.contains(e.target as Node)) {
          popup.remove();
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    }, 100);

    this.container.appendChild(popup);
  }

  private createLegend(): void {
    const legend = document.createElement('div');
    legend.className = 'map-legend deckgl-legend';

    // SVG shapes for different marker types
    const shapes = {
      circle: (color: string) => `<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="${color}"/></svg>`,
      triangle: (color: string) => `<svg width="12" height="12" viewBox="0 0 12 12"><polygon points="6,1 11,10 1,10" fill="${color}"/></svg>`,
      square: (color: string) => `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="${color}"/></svg>`,
      hexagon: (color: string) => `<svg width="12" height="12" viewBox="0 0 12 12"><polygon points="6,1 10.5,3.5 10.5,8.5 6,11 1.5,8.5 1.5,3.5" fill="${color}"/></svg>`,
      // Warm heat ramp (amber→magenta) matching the traffic ScatterplotLayer: colour
      // AND size encode request volume, so one swatch reads as "origin by volume".
      heat: () => `<svg width="14" height="12" viewBox="0 0 14 12"><defs><linearGradient id="legendHeat" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="rgb(255,180,70)"/><stop offset="1" stop-color="rgb(255,60,140)"/></linearGradient></defs><circle cx="6" cy="6" r="5" fill="url(#legendHeat)"/></svg>`,
    };

    const isLight = getCurrentTheme() === 'light';
    // Cloud (flagship) legend MUST match what the globe plots — the Hanzo Cloud data
    // classes, not the geopolitical default (which would mislabel traffic dots as
    // "high alert" etc.). Order mirrors visual prominence on the globe.
    const legendItems = SITE_VARIANT === 'cloud'
      ? [
          { shape: shapes.heat(), label: 'Request origin · volume' },
          { shape: shapes.circle('rgb(0, 200, 255)'), label: 'Validator node' },
          { shape: shapes.circle('rgb(0, 230, 190)'), label: 'GPU fleet' },
          { shape: shapes.circle('rgb(150, 100, 255)'), label: 'Cloud region' },
          { shape: shapes.square('rgb(136, 68, 255)'), label: 'Datacenter · PoP' },
        ]
      : SITE_VARIANT === 'tech'
      ? [
          { shape: shapes.circle(isLight ? 'rgb(22, 163, 74)' : 'rgb(0, 255, 150)'), label: t('components.deckgl.legend.startupHub') },
          { shape: shapes.circle('rgb(100, 200, 255)'), label: t('components.deckgl.legend.techHQ') },
          { shape: shapes.circle(isLight ? 'rgb(180, 120, 0)' : 'rgb(255, 200, 0)'), label: t('components.deckgl.legend.accelerator') },
          { shape: shapes.circle('rgb(150, 100, 255)'), label: t('components.deckgl.legend.cloudRegion') },
          { shape: shapes.square('rgb(136, 68, 255)'), label: t('components.deckgl.legend.datacenter') },
        ]
      : SITE_VARIANT === 'finance'
      ? [
          { shape: shapes.circle('rgb(255, 215, 80)'), label: t('components.deckgl.legend.stockExchange') },
          { shape: shapes.circle('rgb(0, 220, 150)'), label: t('components.deckgl.legend.financialCenter') },
          { shape: shapes.hexagon('rgb(255, 210, 80)'), label: t('components.deckgl.legend.centralBank') },
          { shape: shapes.square('rgb(255, 150, 80)'), label: t('components.deckgl.legend.commodityHub') },
          { shape: shapes.triangle('rgb(80, 170, 255)'), label: t('components.deckgl.legend.waterway') },
        ]
      : [
          { shape: shapes.circle('rgb(255, 68, 68)'), label: t('components.deckgl.legend.highAlert') },
          { shape: shapes.circle('rgb(255, 165, 0)'), label: t('components.deckgl.legend.elevated') },
          { shape: shapes.circle(isLight ? 'rgb(180, 120, 0)' : 'rgb(255, 255, 0)'), label: t('components.deckgl.legend.monitoring') },
          { shape: shapes.triangle('rgb(68, 136, 255)'), label: t('components.deckgl.legend.base') },
          { shape: shapes.hexagon(isLight ? 'rgb(180, 120, 0)' : 'rgb(255, 220, 0)'), label: t('components.deckgl.legend.nuclear') },
          { shape: shapes.square('rgb(136, 68, 255)'), label: t('components.deckgl.legend.datacenter') },
        ];

    legend.innerHTML = `
      <span class="legend-label-title">${t('components.deckgl.legend.title')}</span>
      ${legendItems.map(({ shape, label }) => `<span class="legend-item">${shape}<span class="legend-label">${label}</span></span>`).join('')}
    `;

    this.container.appendChild(legend);
  }

  // Public API methods (matching MapComponent interface)
  public render(): void {
    if (this.renderPaused) {
      this.renderPending = true;
      return;
    }
    if (this.renderScheduled) return;
    this.renderScheduled = true;

    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.updateLayers();
    });
  }

  public setRenderPaused(paused: boolean): void {
    if (this.renderPaused === paused) return;
    this.renderPaused = paused;
    if (paused) {
      this.stopPulseAnimation();
      this.stopAutoRotate();
      this.stopCloudPulse();
      return;
    }

    this.syncPulseAnimation();
    this.maybeStartAutoRotate();
    this.syncCloudPulse();
    if (!paused && this.renderPending) {
      this.renderPending = false;
      this.render();
    }
  }

  private updateLayers(): void {
    if (this.renderPaused || this.webglLost) return;
    const startTime = performance.now();
    if (this.deckOverlay) {
      this.deckOverlay.setProps({ layers: this.buildLayers() });
    }
    // Single chokepoint for every layer/data change (toggles, polls, setLayers all
    // route through render→updateLayers), so the cloud pulse starts/stops here.
    this.syncCloudPulse();
    const elapsed = performance.now() - startTime;
    if (import.meta.env.DEV && elapsed > 16) {
      console.warn(`[DeckGLMap] updateLayers took ${elapsed.toFixed(2)}ms (>16ms budget)`);
    }
  }

  public setView(view: DeckMapView): void {
    this.state.view = view;
    const preset = VIEW_PRESETS[view];

    if (this.mapboxMap) {
      this.mapboxMap.flyTo({
        center: [preset.longitude, preset.latitude],
        zoom: preset.zoom,
        duration: 1000,
      });
    }

    const viewSelect = this.container.querySelector('.view-select') as HTMLSelectElement;
    if (viewSelect) viewSelect.value = view;

    this.onStateChange?.(this.state);
  }

  // ---- Projection mode (2D map <-> 3D globe) --------------------------------

  public getProjectionMode(): MapProjectionMode {
    return this.state.mode;
  }

  // On the 3D globe, arcs must follow the great circle and hug the sphere.
  // A plain ArcLayer arches by ~1x the straight-line chord, which on a globe
  // launches long arcs far off the silhouette (the "off-globe" glitch). Layers
  // key their greatCircle/getHeight on this.
  private get onGlobe(): boolean {
    return this.state.mode === '3d';
  }

  public setProjectionMode(mode: MapProjectionMode): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    this.applyProjection();
    this.updateProjectionToggle();
    this.render(); // rebuild layers (climate heatmap <-> globe-safe scatter)
    if (mode === '3d') {
      this.maybeStartAutoRotate();
    } else {
      this.stopAutoRotate();
    }
    this.onStateChange?.(this.state);
  }

  // Read-only bridge for the native deck.gl GlobeView renderer (GlobeNative). It
  // reuses this map's data layers, tooltips and click handling verbatim so the 3D
  // globe never duplicates a single builder. Additive — the private methods it wraps
  // are unchanged. Heatmap→scatter substitution comes for free because buildLayers()
  // keys the swap on this.state.mode === '3d'.
  public asGlobeSource(): GlobeLayerSource {
    return {
      buildLayers: () => this.buildLayers(),
      getTooltip: (info: PickingInfo) => this.getTooltip(info),
      handleClick: (info: PickingInfo, event?: MapClickEvent) => this.handleClick(info, event),
      setOcclusionCenter: (lng: number, lat: number) => this.setOcclusionCenter(lng, lat),
    };
  }

  // The native GlobeView calls this with its live camera before each layer rebuild so
  // the far-side billboard cull tracks the globe's own rotation (mapbox is parked).
  // Passing null restores the live-mapbox-center fallback (escape path / 2D).
  public setOcclusionCenter(lng: number | null, lat?: number): void {
    this.occlusionCenter = lng == null ? null : { lng, lat: lat ?? 0 };
  }

  // Sync mapbox's projection to the current mode. deck.gl's MapboxOverlay
  // re-derives MapView vs _GlobeView from map.getProjection() every frame, so
  // all overlay layers follow automatically — no separate Deck instance.
  // mapbox-gl v3 morphs globe↔mercator on its own at low zoom; we pair it with a
  // gentle easeTo so a switch made while zoomed-in still reads as a smooth glide
  // rather than a snap.
  // The mapbox basemap's projection. Globe ONLY when 3D AND the native deck.gl
  // globe is off (so mapbox is the visible globe). With the native globe on (the
  // default) mapbox is a parked, invisible basemap, so it stays mercator — this
  // dodges the mapbox-gl v3.26 "Missing theme" crash that a plain style in globe
  // projection triggers, which otherwise blanks the whole map (globe included).
  private mapboxProjection(): 'globe' | 'mercator' {
    return this.state.mode === '3d' && !isNativeGlobeEnabled() ? 'globe' : 'mercator';
  }

  private applyProjection(): void {
    if (!this.mapboxMap) return;
    const name = this.mapboxProjection();
    const current = this.mapboxMap.getProjection?.()?.name;
    if (current === name) return;
    this.mapboxMap.setProjection(name);
    // Entering the globe from a zoomed-in mercator view: pull the camera back so
    // the whole sphere frames up, flat and un-pitched — a ~1.1s choreographed glide
    // the overlaid deck layers reproject through frame-by-frame. Reduced-motion
    // snaps instantly. Leaving it: mapbox morphs the projection itself; we settle.
    if (name === 'globe') {
      const zoom = this.mapboxMap.getZoom();
      const targetZoom = zoom > 3.5 ? 2.6 : zoom;
      if (this.prefersReducedMotion()) {
        this.mapboxMap.jumpTo({ zoom: targetZoom, pitch: 0 });
      } else {
        this.mapboxMap.easeTo({
          zoom: targetZoom,
          pitch: 0,
          duration: 1100,
          essential: true,
        });
      }
    }
    this.mapboxMap.triggerRepaint();
  }

  // Monochrome globe atmosphere (see MONOCHROME_FOG). Re-applied after every style
  // load since setStyle() clears fog.
  private applyAtmosphere(): void {
    if (!this.mapboxMap) return;
    try {
      this.mapboxMap.setFog(MONOCHROME_FOG);
    } catch { /* fog unsupported until style is ready — retried on style.load */ }
    // Match the basemap's ocean/void fill to the app's themed map background so the
    // canvas blends into its container with no edge seam. CartoDB's styles ship a
    // near-black-grey `background` layer that reads a shade lighter than the shell;
    // repaint it to --map-bg (theme-aware; re-applied after every setStyle).
    try {
      const mapBg = getComputedStyle(document.documentElement)
        .getPropertyValue('--map-bg').trim();
      if (mapBg) this.mapboxMap.setPaintProperty('background', 'background-color', mapBg);
    } catch { /* background layer absent until style ready — retried on style.load */ }
  }

  private createProjectionToggle(): void {
    const toggle = document.createElement('div');
    toggle.className = 'deckgl-projection-toggle';
    toggle.innerHTML = `
      <button class="proj-btn ${this.state.mode === '2d' ? 'active' : ''}" data-mode="2d"
        title="${t('components.deckgl.projection.flat', { defaultValue: 'Flat map (2D)' })}">2D</button>
      <button class="proj-btn ${this.state.mode === '3d' ? 'active' : ''}" data-mode="3d"
        title="${t('components.deckgl.projection.globe', { defaultValue: '3D globe' })}">3D</button>
    `;
    toggle.querySelectorAll('.proj-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as MapProjectionMode;
        this.setProjectionMode(mode);
      });
    });
    this.mountDropdown('projection', toggle, t('components.deckgl.projection.globe', { defaultValue: '3D globe' }));
  }

  private updateProjectionToggle(): void {
    const toggle = this.controlsHost.querySelector('.deckgl-projection-toggle');
    if (!toggle) return;
    toggle.querySelectorAll('.proj-btn').forEach((btn) => {
      const mode = (btn as HTMLElement).dataset.mode;
      btn.classList.toggle('active', mode === this.state.mode);
    });
    this.syncDropdownLabel(toggle.closest('.deckgl-dd'));
  }

  // ---- Compact control dropdowns -------------------------------------------
  // Each map control (projection, basemap, time-range) collapses to ONE trigger
  // showing the active option + caret; its original option-buttons live in a popover
  // that opens on click. Keeping the exact inner buttons means their click handlers,
  // active-state updates and selectors are unchanged — only the chrome collapses, so
  // the top dock is one tidy row instead of two wrapping rows.
  private dropdownOutsideBound = false;

  private mountDropdown(key: string, menu: HTMLElement, title: string): void {
    const wrap = document.createElement('div');
    wrap.className = 'deckgl-dd';
    wrap.dataset.dd = key;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dd-trigger';
    trigger.title = title;
    trigger.setAttribute('aria-haspopup', 'true');
    menu.classList.add('dd-menu');
    wrap.append(trigger, menu);
    this.controlsHost.appendChild(wrap);
    this.syncDropdownLabel(wrap);

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !wrap.classList.contains('open');
      this.closeDropdowns();
      wrap.classList.toggle('open', open);
    });
    // Picking an option closes the menu; the label re-syncs from the new active button.
    menu.addEventListener('click', () => {
      wrap.classList.remove('open');
      this.syncDropdownLabel(wrap);
    });

    if (!this.dropdownOutsideBound) {
      this.dropdownOutsideBound = true;
      document.addEventListener('click', () => this.closeDropdowns());
    }
  }

  private syncDropdownLabel(wrap: Element | null): void {
    if (!wrap) return;
    const active = wrap.querySelector('.dd-menu .active') as HTMLElement | null;
    const trigger = wrap.querySelector('.dd-trigger');
    if (trigger) {
      trigger.innerHTML = `<span class="dd-label">${escapeHtml(active?.textContent?.trim() || '—')}</span><span class="dd-caret" aria-hidden="true">▾</span>`;
    }
  }

  private closeDropdowns(): void {
    this.controlsHost.querySelectorAll('.deckgl-dd.open').forEach((d) => d.classList.remove('open'));
  }

  // ---- Idle globe spin ------------------------------------------------------

  private prefersReducedMotion(): boolean {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private onUserInteract = (): void => {
    this.userInteracting = true;
    if (this.autoRotateIdleTimer) clearTimeout(this.autoRotateIdleTimer);
    this.autoRotateIdleTimer = setTimeout(() => {
      this.userInteracting = false;
      this.autoRotateLastTs = 0; // avoid a jump on resume
    }, DeckGLMap.AUTO_ROTATE_IDLE_MS);
  };

  private maybeStartAutoRotate(): void {
    if (this.state.mode !== '3d') return;
    if (this.autoRotateRafId != null) return;
    if (this.renderPaused || this.webglLost) return;
    if (this.prefersReducedMotion()) return;

    this.autoRotateLastTs = 0;
    const step = (ts: number): void => {
      this.autoRotateRafId = requestAnimationFrame(step);
      if (!this.autoRotateGateOpen()) {
        this.autoRotateLastTs = 0; // reset so we don't apply a large jump on resume
        return;
      }
      if (this.autoRotateLastTs === 0) {
        this.autoRotateLastTs = ts;
        return;
      }
      // Throttle to ~30fps: smooth for a slow background spin, but half the
      // repaints of a per-frame update — lighter on GPU/CPU and battery.
      const elapsedMs = ts - this.autoRotateLastTs;
      if (elapsedMs < DeckGLMap.AUTO_ROTATE_MIN_FRAME_MS) return;
      this.autoRotateLastTs = ts;
      this.rotateOneStep(elapsedMs / 1000);
    };
    this.autoRotateRafId = requestAnimationFrame(step);
  }

  // Whether the idle spin should advance on the current frame — pure decision,
  // no rendering. Closed when flat, interacting, paused, hidden, or GL is lost.
  private autoRotateGateOpen(): boolean {
    return this.state.mode === '3d'
      && !this.userInteracting
      && !this.renderPaused
      && !this.webglLost
      && !this.prefersReducedMotion()
      && !document.hidden;
  }

  // Advance the globe's center longitude eastward by dtSec worth of rotation.
  private rotateOneStep(dtSec: number): void {
    if (!this.mapboxMap) return;
    const center = this.mapboxMap.getCenter();
    const nextLng = ((center.lng + DeckGLMap.AUTO_ROTATE_DEG_PER_SEC * dtSec + 540) % 360) - 180;
    this.mapboxMap.setCenter([nextLng, center.lat]);
  }

  private stopAutoRotate(): void {
    if (this.autoRotateRafId != null) {
      cancelAnimationFrame(this.autoRotateRafId);
      this.autoRotateRafId = null;
    }
  }

  // ---- Cloud-map pulse (traffic arcs + chain-node breathe) ------------------

  // Runs only while a cloud layer is visible with data, render is live, and the
  // user allows motion. requestAnimationFrame is itself paused by the browser
  // when the tab is hidden, so that case needs no extra handling.
  private cloudPulseGateOpen(): boolean {
    if (this.renderPaused || this.webglLost || this.prefersReducedMotion()) return false;
    const { trafficArcs, chainNodes } = this.state.layers;
    const arcsLive = trafficArcs && this.trafficArcsData.length > 0;
    const nodesLive = chainNodes && this.chainNetworks.length > 0;
    return Boolean(arcsLive || nodesLive);
  }

  private maybeStartCloudPulse(): void {
    if (this.cloudPulseRafId != null) return;
    if (!this.cloudPulseGateOpen()) return;
    this.cloudPulseLastTs = 0;
    const step = (ts: number): void => {
      if (!this.cloudPulseGateOpen()) { this.cloudPulseRafId = null; return; }
      this.cloudPulseRafId = requestAnimationFrame(step);
      // ~30fps cap: smooth enough for a calm 3s pulse, half the repaints of 60fps.
      if (this.cloudPulseLastTs && ts - this.cloudPulseLastTs < DeckGLMap.CLOUD_PULSE_MIN_FRAME_MS) return;
      this.cloudPulseLastTs = ts;
      // Derive the phase straight from the timestamp — no accumulation, so it
      // resumes cleanly after a hidden-tab pause with no jump.
      this.cloudPulseCoef = (ts % DeckGLMap.CLOUD_PULSE_PERIOD_MS) / DeckGLMap.CLOUD_PULSE_PERIOD_MS;
      // Rebuild only the arc + chain-node layers this frame — never the other ~28.
      this.schedulePulse('cloud');
    };
    this.cloudPulseRafId = requestAnimationFrame(step);
  }

  private stopCloudPulse(): void {
    if (this.cloudPulseRafId != null) {
      cancelAnimationFrame(this.cloudPulseRafId);
      this.cloudPulseRafId = null;
    }
  }

  // Start or stop to match the current gate — call after any layer/data/pause change.
  private syncCloudPulse(): void {
    if (this.cloudPulseGateOpen()) this.maybeStartCloudPulse();
    else this.stopCloudPulse();
  }

  public setZoom(zoom: number): void {
    this.state.zoom = zoom;
    if (this.mapboxMap) {
      this.mapboxMap.setZoom(zoom);
    }
  }

  public setCenter(lat: number, lon: number, zoom?: number): void {
    if (this.mapboxMap) {
      this.mapboxMap.flyTo({
        center: [lon, lat],
        ...(zoom != null && { zoom }),
        duration: 500,
      });
    }
  }

  public getCenter(): { lat: number; lon: number } | null {
    if (this.mapboxMap) {
      const center = this.mapboxMap.getCenter();
      return { lat: center.lat, lon: center.lng };
    }
    return null;
  }

  // Convert a viewport (clientX, clientY) point to geographic lng/lat, or null if
  // the map isn't ready. Feeds the right-click context menu (Copy coordinates /
  // Fly here) — read-only, no state change.
  public screenToLngLat(clientX: number, clientY: number): { lat: number; lon: number } | null {
    if (!this.mapboxMap) return null;
    const rect = this.mapboxMap.getContainer().getBoundingClientRect();
    const ll = this.mapboxMap.unproject([clientX - rect.left, clientY - rect.top]);
    return { lat: ll.lat, lon: ll.lng };
  }

  public setTimeRange(range: TimeRange): void {
    this.state.timeRange = range;
    this.rebuildProtestSupercluster();
    this.onTimeRangeChange?.(range);
    this.updateTimeSliderButtons();
    this.render(); // Debounced
  }

  public getTimeRange(): TimeRange {
    return this.state.timeRange;
  }

  public setLayers(layers: MapLayers): void {
    this.state.layers = layers;
    this.render(); // Debounced

    // Update toggle checkboxes
    Object.entries(layers).forEach(([key, value]) => {
      const toggle = this.container.querySelector(`.layer-toggle[data-layer="${key}"] input`) as HTMLInputElement;
      if (toggle) toggle.checked = value;
    });
  }

  public getState(): DeckMapState {
    return { ...this.state };
  }

  // Zoom controls - public for external access
  public zoomIn(): void {
    if (this.mapboxMap) {
      this.mapboxMap.zoomIn();
    }
  }

  public zoomOut(): void {
    if (this.mapboxMap) {
      this.mapboxMap.zoomOut();
    }
  }

  private resetView(): void {
    this.setView('global');
  }

  private createUcdpEventsLayer(events: UcdpGeoEvent[]): ScatterplotLayer<UcdpGeoEvent> {
    return new ScatterplotLayer<UcdpGeoEvent>({
      id: 'ucdp-events-layer',
      data: events,
      getPosition: (d) => [d.longitude, d.latitude],
      getRadius: (d) => Math.max(4000, Math.sqrt(d.deaths_best || 1) * 3000),
      getFillColor: (d) => {
        switch (d.type_of_violence) {
          case 'state-based': return COLORS.ucdpStateBased;
          case 'non-state': return COLORS.ucdpNonState;
          case 'one-sided': return COLORS.ucdpOneSided;
          default: return COLORS.ucdpStateBased;
        }
      },
      radiusMinPixels: 3,
      radiusMaxPixels: 20,
      pickable: false,
    });
  }

  private createDisplacementArcsLayer(): ArcLayer<DisplacementFlow> {
    const withCoords = this.displacementFlows.filter(f => f.originLat != null && f.asylumLat != null);
    const top50 = withCoords.slice(0, 50);
    const maxCount = Math.max(1, ...top50.map(f => f.refugees));
    return new ArcLayer<DisplacementFlow>({
      id: 'displacement-arcs-layer',
      data: top50,
      // Globe: follow the great circle, flat on the surface (no off-globe balloon).
      greatCircle: this.onGlobe,
      getHeight: this.onGlobe ? 0 : 1,
      updateTriggers: { greatCircle: this.onGlobe, getHeight: this.onGlobe },
      getSourcePosition: (d) => [d.originLon!, d.originLat!],
      getTargetPosition: (d) => [d.asylumLon!, d.asylumLat!],
      getSourceColor: getCurrentTheme() === 'light' ? [50, 80, 180, 220] : [100, 150, 255, 180],
      getTargetColor: getCurrentTheme() === 'light' ? [20, 150, 100, 220] : [100, 255, 200, 180],
      getWidth: (d) => Math.max(1, (d.refugees / maxCount) * 8),
      widthMinPixels: 1,
      widthMaxPixels: 8,
      pickable: false,
    });
  }

  private static readonly CLIMATE_RAMP: [number, number, number][] = [
    [68, 136, 255],
    [100, 200, 255],
    [255, 255, 100],
    [255, 200, 50],
    [255, 100, 50],
    [255, 50, 50],
  ];

  private climateWeight(d: ClimateAnomaly): number {
    return Math.abs(d.tempDelta) + Math.abs(d.precipDelta) * 0.1;
  }

  private createClimateHeatmapLayer(): HeatmapLayer<ClimateAnomaly> {
    return new HeatmapLayer<ClimateAnomaly>({
      id: 'climate-heatmap-layer',
      data: this.climateAnomalies,
      getPosition: (d) => [d.lon, d.lat],
      getWeight: (d) => this.climateWeight(d),
      radiusPixels: 40,
      intensity: 0.6,
      threshold: 0.15,
      opacity: 0.45,
      colorRange: DeckGLMap.CLIMATE_RAMP,
      pickable: false,
    });
  }

  // Globe-safe substitute for the screen-space climate heatmap: soft graduated
  // discs colored by the same anomaly ramp (cool -> hot). Renders on _GlobeView.
  private createClimateAnomalyPointsLayer(): ScatterplotLayer<ClimateAnomaly> {
    const ramp = DeckGLMap.CLIMATE_RAMP;
    return new ScatterplotLayer<ClimateAnomaly>({
      id: 'climate-anomaly-points-layer',
      data: this.climateAnomalies,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 60000 + this.climateWeight(d) * 45000,
      getFillColor: (d) => {
        const idx = Math.min(ramp.length - 1, Math.max(0, Math.floor(this.climateWeight(d))));
        const [r, g, b] = ramp[idx]!;
        return [r, g, b, 150];
      },
      radiusUnits: 'meters',
      radiusMinPixels: 6,
      radiusMaxPixels: 44,
      stroked: false,
      filled: true,
      opacity: 0.5,
      pickable: false,
      updateTriggers: {
        getFillColor: this.climateAnomalies.length,
        getRadius: this.climateAnomalies.length,
      },
    });
  }

  // Hanzo World cloud map layers ────────────────────────────────────────────

  // Chain validator nodes: white filled dots with a subtle ring, one per node,
  // radius scaled by the network's peer share. Down networks render dimmed.
  // Flatten chainNetworks → per-node dots, memoized by the source array reference.
  // The cloud-pulse breathe re-issues this layer ~30×/s; keeping `data` stable
  // means deck.gl only diffs the radiusScale prop, never re-uploads attributes.
  private ensureChainDots(): void {
    if (this.chainDotsSource === this.chainNetworks) return;
    this.chainDotsSource = this.chainNetworks;
    this.chainMaxPeers = Math.max(1, ...this.chainNetworks.map((n) => n.peers || 0));
    const dots: ChainDot[] = [];
    for (const net of this.chainNetworks) {
      for (const node of net.nodes ?? []) {
        dots.push({
          lat: node.lat, lon: node.lon, city: node.city, kind: node.kind,
          networkName: net.name, chainId: net.chainId, blockHeight: net.blockHeight,
          peers: net.peers, live: net.live,
        });
      }
    }
    this.chainDots = dots;
  }

  private createChainNodesLayer(): ScatterplotLayer<ChainDot> {
    this.ensureChainDots();
    const dots = this.chainDots;
    const maxPeers = this.chainMaxPeers;
    return new ScatterplotLayer<ChainDot>({
      id: 'chainNodes',
      data: dots,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 45000 + (d.peers / maxPeers) * 75000,
      // On-brand cloud palette (cyan = live validator, dim slate = offline) —
      // never a bare white dot, which reads as an unstyled loading placeholder.
      getFillColor: (d) => d.live
        ? [0, 200, 255, 235] as [number, number, number, number]
        : [110, 120, 130, 170] as [number, number, number, number],
      radiusUnits: 'meters',
      radiusMinPixels: 4,
      radiusMaxPixels: 16,
      // Slow, subtle breathe (±6%) off the shared cloud-pulse clock. radiusScale
      // is a plain prop, so re-issuing it each pulse frame is enough — no attribute
      // recompute. Sits at a steady 1.0 when the pulse RAF isn't running.
      radiusScale: 1 + 0.06 * Math.sin(this.cloudPulseCoef * Math.PI * 2),
      stroked: true,
      filled: true,
      getLineColor: [0, 120, 160, 200] as [number, number, number, number],
      getLineWidth: 1,
      lineWidthMinPixels: 1,
      pickable: true,
      updateTriggers: {
        getRadius: dots.length,
        getFillColor: dots.length,
      },
    });
  }

  // Live request-geo: WHERE api.hanzo.ai traffic comes from (native LB aggregate).
  // Filled dots at country/region centroids, radius + heat scaled by request count,
  // breathing on the shared cloud-pulse clock. A warm amber→magenta ramp keeps it
  // distinct from the cyan chain-node dots. Empty (honest) until traffic is recorded.
  private createTrafficLayer(): ScatterplotLayer<TrafficGlobePoint> {
    const maxCount = Math.max(1, ...this.trafficPoints.map((p) => p.count || 0));
    const heat = (c: number): [number, number, number, number] => {
      const tt = Math.min(1, (c || 0) / maxCount); // 0..1 intensity
      return [255, Math.round(180 - tt * 120), Math.round(70 + tt * 90), 230];
    };
    return new ScatterplotLayer<TrafficGlobePoint>({
      id: 'traffic',
      data: this.trafficPoints,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 45000 + ((d.count || 0) / maxCount) * 95000,
      getFillColor: (d) => heat(d.count),
      radiusUnits: 'meters',
      radiusMinPixels: 4,
      radiusMaxPixels: 22,
      // Slightly deeper breathe (±8%) than the chain dots so the traffic layer reads
      // as the live centerpiece. radiusScale is a plain prop re-issued each pulse.
      radiusScale: 1 + 0.08 * Math.sin(this.cloudPulseCoef * Math.PI * 2),
      stroked: true,
      filled: true,
      getLineColor: [255, 210, 140, 200] as [number, number, number, number],
      getLineWidth: 1,
      lineWidthMinPixels: 1,
      pickable: true,
      updateTriggers: {
        getRadius: this.trafficPoints.length,
        getFillColor: this.trafficPoints.length,
      },
    });
  }

  // BYO GPU fleet: hollow stroked rings (deliberately distinct from the filled
  // chain-node dots), radius scaled by GPU count, dimmed when not online.
  private createByoGpuLayer(): ScatterplotLayer<ByoGpu> {
    const maxCount = Math.max(1, ...this.byoGpus.map((g) => g.count || 0));
    return new ScatterplotLayer<ByoGpu>({
      id: 'byoGpu',
      data: this.byoGpus,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 40000 + (d.count / maxCount) * 60000,
      radiusUnits: 'meters',
      radiusMinPixels: 5,
      radiusMaxPixels: 18,
      stroked: true,
      filled: false,
      getLineColor: (d) => d.status === 'online'
        ? [0, 255, 200, 220] as [number, number, number, number]
        : [110, 120, 130, 160] as [number, number, number, number],
      getLineWidth: 2,
      lineWidthMinPixels: 1.5,
      lineWidthMaxPixels: 3,
      pickable: true,
      updateTriggers: {
        getRadius: this.byoGpus.length,
        getLineColor: this.byoGpus.length,
      },
    });
  }

  // Inter-region traffic: thin monochrome white arcs, opacity scaled by weight
  // (no rainbow). A travelling white pulse (AnimatedArcLayer, coef advanced by
  // the cloud-pulse RAF) shows flow direction source→target. Works on the globe
  // as-is (uv.x is the along-arc ratio in both projections).
  private createTrafficArcsLayer(): AnimatedArcLayer<TrafficArc> {
    const maxWeight = Math.max(1, ...this.trafficArcsData.map((a) => a.weight || 0));
    const alpha = (w: number): number => Math.round(40 + Math.min(1, (w || 0) / maxWeight) * 170);
    return new AnimatedArcLayer<TrafficArc>({
      id: 'trafficArcs',
      data: this.trafficArcsData,
      coef: this.cloudPulseCoef,
      // Globe: great-circle, surface-hugging — these long cross-continent arcs
      // are the worst off-globe offenders as plain chord-arches.
      greatCircle: this.onGlobe,
      getHeight: this.onGlobe ? 0 : 1,
      getSourcePosition: (d) => [d.fromLon, d.fromLat],
      getTargetPosition: (d) => [d.toLon, d.toLat],
      getSourceColor: (d) => [255, 255, 255, alpha(d.weight)] as [number, number, number, number],
      getTargetColor: (d) => [255, 255, 255, Math.round(alpha(d.weight) * 0.55)] as [number, number, number, number],
      getWidth: (d) => 0.5 + Math.min(1, (d.weight || 0) / maxWeight) * 1.5,
      widthMinPixels: 0.5,
      widthMaxPixels: 2,
      pickable: true,
      updateTriggers: {
        getSourceColor: this.trafficArcsData.length,
        getTargetColor: this.trafficArcsData.length,
        getWidth: this.trafficArcsData.length,
      },
    });
  }

  // Data setters - all use render() for debouncing
  public setEarthquakes(earthquakes: Earthquake[]): void {
    this.earthquakes = earthquakes;
    this.render();
  }

  public setWeatherAlerts(alerts: WeatherAlert[]): void {
    this.weatherAlerts = alerts;
    const withCentroid = alerts.filter(a => a.centroid && a.centroid.length === 2).length;
    console.log(`[DeckGLMap] Weather alerts: ${alerts.length} total, ${withCentroid} with coordinates`);
    this.render();
  }

  public setOutages(outages: InternetOutage[]): void {
    this.outages = outages;
    this.render();
  }

  public setCyberThreats(threats: CyberThreat[]): void {
    this.cyberThreats = threats;
    this.render();
  }

  public setAisData(disruptions: AisDisruptionEvent[], density: AisDensityZone[]): void {
    this.aisDisruptions = disruptions;
    this.aisDensity = density;
    this.render();
  }

  public setCableActivity(advisories: CableAdvisory[], repairShips: RepairShip[]): void {
    this.cableAdvisories = advisories;
    this.repairShips = repairShips;
    this.render();
  }

  public setProtests(events: SocialUnrestEvent[]): void {
    this.protests = events;
    this.rebuildProtestSupercluster();
    this.render();
    this.syncPulseAnimation();
  }

  public setFlightDelays(delays: AirportDelayAlert[]): void {
    this.flightDelays = delays;
    this.render();
  }

  public setMilitaryFlights(flights: MilitaryFlight[], clusters: MilitaryFlightCluster[] = []): void {
    this.militaryFlights = flights;
    this.militaryFlightClusters = clusters;
    this.render();
  }

  public setMilitaryVessels(vessels: MilitaryVessel[], clusters: MilitaryVesselCluster[] = []): void {
    this.militaryVessels = vessels;
    this.militaryVesselClusters = clusters;
    this.render();
  }

  public setNaturalEvents(events: NaturalEvent[]): void {
    this.naturalEvents = events;
    this.render();
  }

  public setFires(fires: Array<{ lat: number; lon: number; brightness: number; frp: number; confidence: number; region: string; acq_date: string; daynight: string }>): void {
    this.firmsFireData = fires;
    this.render();
  }

  public setTechEvents(events: TechEventMarker[]): void {
    this.techEvents = events;
    this.rebuildTechEventSupercluster();
    this.render();
  }

  public setUcdpEvents(events: UcdpGeoEvent[]): void {
    this.ucdpEvents = events;
    this.render();
  }

  public setDisplacementFlows(flows: DisplacementFlow[]): void {
    this.displacementFlows = flows;
    this.render();
  }

  public setClimateAnomalies(anomalies: ClimateAnomaly[]): void {
    this.climateAnomalies = anomalies;
    this.render();
  }

  public setNewsLocations(data: Array<{ lat: number; lon: number; title: string; threatLevel: string; timestamp?: Date }>): void {
    const now = Date.now();
    for (const d of data) {
      if (!this.newsLocationFirstSeen.has(d.title)) {
        this.newsLocationFirstSeen.set(d.title, now);
      }
    }
    for (const [key, ts] of this.newsLocationFirstSeen) {
      if (now - ts > 60_000) this.newsLocationFirstSeen.delete(key);
    }
    this.newsLocations = data;
    this.render();

    this.syncPulseAnimation(now);
  }

  public updateHotspotActivity(news: NewsItem[]): void {
    this.news = news; // Store for related news lookup

    // Update hotspot "breaking" indicators based on recent news
    const breakingKeywords = new Set<string>();
    const recentNews = news.filter(n =>
      Date.now() - n.pubDate.getTime() < 2 * 60 * 60 * 1000 // Last 2 hours
    );

    // Count matches per hotspot for escalation tracking
    const matchCounts = new Map<string, number>();

    recentNews.forEach(item => {
      this.hotspots.forEach(hotspot => {
        if (hotspot.keywords.some(kw =>
          item.title.toLowerCase().includes(kw.toLowerCase())
        )) {
          breakingKeywords.add(hotspot.id);
          matchCounts.set(hotspot.id, (matchCounts.get(hotspot.id) || 0) + 1);
        }
      });
    });

    this.hotspots.forEach(h => {
      h.hasBreaking = breakingKeywords.has(h.id);
      const matchCount = matchCounts.get(h.id) || 0;
      // Calculate a simple velocity metric (matches per hour normalized)
      const velocity = matchCount > 0 ? matchCount / 2 : 0; // 2 hour window
      updateHotspotEscalation(h.id, matchCount, h.hasBreaking || false, velocity);
    });

    this.render();
    this.syncPulseAnimation();
  }

  /** Get news items related to a hotspot by keyword matching */
  private getRelatedNews(hotspot: Hotspot): NewsItem[] {
    // High-priority conflict keywords that indicate the news is really about another topic
    const conflictTopics = ['gaza', 'ukraine', 'russia', 'israel', 'iran', 'china', 'taiwan', 'korea', 'syria'];

    return this.news
      .map((item) => {
        const titleLower = item.title.toLowerCase();
        const matchedKeywords = hotspot.keywords.filter((kw) => titleLower.includes(kw.toLowerCase()));

        if (matchedKeywords.length === 0) return null;

        // Check if this news mentions other hotspot conflict topics
        const conflictMatches = conflictTopics.filter(t =>
          titleLower.includes(t) && !hotspot.keywords.some(k => k.toLowerCase().includes(t))
        );

        // If article mentions a major conflict topic that isn't this hotspot, deprioritize heavily
        if (conflictMatches.length > 0) {
          // Only include if it ALSO has a strong local keyword (city name, agency)
          const strongLocalMatch = matchedKeywords.some(kw =>
            kw.toLowerCase() === hotspot.name.toLowerCase() ||
            hotspot.agencies?.some(a => titleLower.includes(a.toLowerCase()))
          );
          if (!strongLocalMatch) return null;
        }

        // Score: more keyword matches = more relevant
        const score = matchedKeywords.length;
        return { item, score };
      })
      .filter((x): x is { item: NewsItem; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(x => x.item);
  }

  public updateMilitaryForEscalation(flights: MilitaryFlight[], vessels: MilitaryVessel[]): void {
    setMilitaryData(flights, vessels);
  }

  public getHotspotDynamicScore(hotspotId: string) {
    return getHotspotEscalation(hotspotId);
  }

  /** Get military flight clusters for rendering/analysis */
  public getMilitaryFlightClusters(): MilitaryFlightCluster[] {
    return this.militaryFlightClusters;
  }

  /** Get military vessel clusters for rendering/analysis */
  public getMilitaryVesselClusters(): MilitaryVesselCluster[] {
    return this.militaryVesselClusters;
  }

  public highlightAssets(assets: RelatedAsset[] | null): void {
    // Clear previous highlights
    Object.values(this.highlightedAssets).forEach(set => set.clear());

    if (assets) {
      assets.forEach(asset => {
        this.highlightedAssets[asset.type].add(asset.id);
      });
    }

    this.render(); // Debounced
  }

  public setOnHotspotClick(callback: (hotspot: Hotspot) => void): void {
    this.onHotspotClick = callback;
  }

  public setOnTimeRangeChange(callback: (range: TimeRange) => void): void {
    this.onTimeRangeChange = callback;
  }

  public setOnLayerChange(callback: (layer: keyof MapLayers, enabled: boolean) => void): void {
    this.onLayerChange = callback;
  }

  public setOnStateChange(callback: (state: DeckMapState) => void): void {
    this.onStateChange = callback;
  }

  public getHotspotLevels(): Record<string, string> {
    const levels: Record<string, string> = {};
    this.hotspots.forEach(h => {
      levels[h.name] = h.level || 'low';
    });
    return levels;
  }

  public setHotspotLevels(levels: Record<string, string>): void {
    this.hotspots.forEach(h => {
      if (levels[h.name]) {
        h.level = levels[h.name] as 'low' | 'elevated' | 'high';
      }
    });
    this.render(); // Debounced
  }

  public initEscalationGetters(): void {
    setCIIGetter(getCountryScore);
    setGeoAlertGetter(getAlertsNearLocation);
  }

  // UI visibility methods
  public hideLayerToggle(layer: keyof MapLayers): void {
    const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"]`);
    if (toggle) (toggle as HTMLElement).style.display = 'none';
  }

  public setLayerLoading(layer: keyof MapLayers, loading: boolean): void {
    const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"]`);
    if (toggle) toggle.classList.toggle('loading', loading);
  }

  public setLayerReady(layer: keyof MapLayers, hasData: boolean): void {
    const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"]`);
    if (!toggle) return;

    toggle.classList.remove('loading');
    // Match old Map.ts behavior: set 'active' only when layer enabled AND has data
    if (this.state.layers[layer] && hasData) {
      toggle.classList.add('active');
    } else {
      toggle.classList.remove('active');
    }
  }

  public flashAssets(assetType: AssetType, ids: string[]): void {
    // Temporarily highlight assets
    ids.forEach(id => this.highlightedAssets[assetType].add(id));
    this.render();

    setTimeout(() => {
      ids.forEach(id => this.highlightedAssets[assetType].delete(id));
      this.render();
    }, 3000);
  }

  // Enable layer programmatically
  public enableLayer(layer: keyof MapLayers): void {
    if (!this.state.layers[layer]) {
      this.state.layers[layer] = true;
      const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"] input`) as HTMLInputElement;
      if (toggle) toggle.checked = true;
      this.render();
      this.onLayerChange?.(layer, true);
    }
  }

  // Toggle layer on/off programmatically
  public toggleLayer(layer: keyof MapLayers): void {
    console.log(`[DeckGLMap.toggleLayer] ${layer}: ${this.state.layers[layer]} -> ${!this.state.layers[layer]}`);
    this.state.layers[layer] = !this.state.layers[layer];
    const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"] input`) as HTMLInputElement;
    if (toggle) toggle.checked = this.state.layers[layer];
    this.render();
    this.onLayerChange?.(layer, this.state.layers[layer]);
  }

  // Get center coordinates for programmatic popup positioning
  private getContainerCenter(): { x: number; y: number } {
    const rect = this.container.getBoundingClientRect();
    return { x: rect.width / 2, y: rect.height / 2 };
  }

  // Project lat/lon to screen coordinates without moving the map
  private projectToScreen(lat: number, lon: number): { x: number; y: number } | null {
    if (!this.mapboxMap) return null;
    const point = this.mapboxMap.project([lon, lat]);
    return { x: point.x, y: point.y };
  }

  // Trigger click methods - show popup at item location without moving the map
  public triggerHotspotClick(id: string): void {
    const hotspot = this.hotspots.find(h => h.id === id);
    if (!hotspot) return;

    // Get screen position for popup
    const screenPos = this.projectToScreen(hotspot.lat, hotspot.lon);
    const { x, y } = screenPos || this.getContainerCenter();

    // Get related news and show popup
    const relatedNews = this.getRelatedNews(hotspot);
    this.popup.show({
      type: 'hotspot',
      data: hotspot,
      relatedNews,
      x,
      y,
    });
    this.popup.loadHotspotGdeltContext(hotspot);
    this.onHotspotClick?.(hotspot);
  }

  public triggerConflictClick(id: string): void {
    const conflict = CONFLICT_ZONES.find(c => c.id === id);
    if (conflict) {
      // Don't pan - show popup at projected screen position or center
      const screenPos = this.projectToScreen(conflict.center[1], conflict.center[0]);
      const { x, y } = screenPos || this.getContainerCenter();
      this.popup.show({ type: 'conflict', data: conflict, x, y });
    }
  }

  public triggerBaseClick(id: string): void {
    const base = MILITARY_BASES.find(b => b.id === id);
    if (base) {
      // Don't pan - show popup at projected screen position or center
      const screenPos = this.projectToScreen(base.lat, base.lon);
      const { x, y } = screenPos || this.getContainerCenter();
      this.popup.show({ type: 'base', data: base, x, y });
    }
  }

  public triggerPipelineClick(id: string): void {
    const pipeline = PIPELINES.find(p => p.id === id);
    if (pipeline && pipeline.points.length > 0) {
      const midIdx = Math.floor(pipeline.points.length / 2);
      const midPoint = pipeline.points[midIdx];
      // Don't pan - show popup at projected screen position or center
      const screenPos = midPoint ? this.projectToScreen(midPoint[1], midPoint[0]) : null;
      const { x, y } = screenPos || this.getContainerCenter();
      this.popup.show({ type: 'pipeline', data: pipeline, x, y });
    }
  }

  public triggerCableClick(id: string): void {
    const cable = UNDERSEA_CABLES.find(c => c.id === id);
    if (cable && cable.points.length > 0) {
      const midIdx = Math.floor(cable.points.length / 2);
      const midPoint = cable.points[midIdx];
      // Don't pan - show popup at projected screen position or center
      const screenPos = midPoint ? this.projectToScreen(midPoint[1], midPoint[0]) : null;
      const { x, y } = screenPos || this.getContainerCenter();
      this.popup.show({ type: 'cable', data: cable, x, y });
    }
  }

  public triggerDatacenterClick(id: string): void {
    const dc = AI_DATA_CENTERS.find(d => d.id === id);
    if (dc) {
      // Don't pan - show popup at projected screen position or center
      const screenPos = this.projectToScreen(dc.lat, dc.lon);
      const { x, y } = screenPos || this.getContainerCenter();
      this.popup.show({ type: 'datacenter', data: dc, x, y });
    }
  }

  public triggerNuclearClick(id: string): void {
    const facility = NUCLEAR_FACILITIES.find(n => n.id === id);
    if (facility) {
      // Don't pan - show popup at projected screen position or center
      const screenPos = this.projectToScreen(facility.lat, facility.lon);
      const { x, y } = screenPos || this.getContainerCenter();
      this.popup.show({ type: 'nuclear', data: facility, x, y });
    }
  }

  public triggerIrradiatorClick(id: string): void {
    const irradiator = GAMMA_IRRADIATORS.find(i => i.id === id);
    if (irradiator) {
      // Don't pan - show popup at projected screen position or center
      const screenPos = this.projectToScreen(irradiator.lat, irradiator.lon);
      const { x, y } = screenPos || this.getContainerCenter();
      this.popup.show({ type: 'irradiator', data: irradiator, x, y });
    }
  }

  public flashLocation(lat: number, lon: number, durationMs = 2000): void {
    // Don't pan - project coordinates to screen position
    const screenPos = this.projectToScreen(lat, lon);
    if (!screenPos) return;

    // Flash effect by temporarily adding a highlight at the location
    const flashMarker = document.createElement('div');
    flashMarker.className = 'flash-location-marker';
    flashMarker.style.cssText = `
      position: absolute;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.5);
      border: 2px solid #fff;
      animation: flash-pulse 0.5s ease-out infinite;
      pointer-events: none;
      z-index: 1000;
      left: ${screenPos.x}px;
      top: ${screenPos.y}px;
      transform: translate(-50%, -50%);
    `;

    // Add animation keyframes if not present
    if (!document.getElementById('flash-animation-styles')) {
      const style = document.createElement('style');
      style.id = 'flash-animation-styles';
      style.textContent = `
        @keyframes flash-pulse {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    const wrapper = this.container.querySelector('.deckgl-map-wrapper');
    if (wrapper) {
      wrapper.appendChild(flashMarker);
      setTimeout(() => flashMarker.remove(), durationMs);
    }
  }

  // --- Country click + highlight ---

  public setOnCountryClick(cb: (country: CountryClickPayload) => void): void {
    this.onCountryClick = cb;
  }

  private resolveCountryFromCoordinate(lon: number, lat: number): { code: string; name: string } | null {
    const fromGeometry = getCountryAtCoordinates(lat, lon);
    if (fromGeometry) return fromGeometry;
    if (!this.mapboxMap || !this.countryGeoJsonLoaded) return null;
    try {
      const point = this.mapboxMap.project([lon, lat]);
      const features = this.mapboxMap.queryRenderedFeatures(point, { layers: ['country-interactive'] });
      const properties = (features?.[0]?.properties ?? {}) as Record<string, unknown>;
      const code = typeof properties['ISO3166-1-Alpha-2'] === 'string'
        ? properties['ISO3166-1-Alpha-2'].trim().toUpperCase()
        : '';
      const name = typeof properties.name === 'string'
        ? properties.name.trim()
        : '';
      if (!code || !name) return null;
      return { code, name };
    } catch {
      return null;
    }
  }

  private loadCountryBoundaries(): void {
    if (!this.mapboxMap || this.countryGeoJsonLoaded) return;
    this.countryGeoJsonLoaded = true;

    getCountriesGeoJson()
      .then((geojson) => {
        if (!this.mapboxMap || !geojson) return;
        // The dot basemap samples a land lattice off the SAME geojson; cached per
        // session by land-dots.ts. Loaded here so it's ready when the dot style is
        // selected; a re-render pushes the dots layer once they land.
        void getLandDots().then((dots) => {
          this.landDots = dots;
          this.render();
        });
        this.mapboxMap.addSource('country-boundaries', {
          type: 'geojson',
          data: geojson,
        });
        this.mapboxMap.addLayer({
          id: 'country-interactive',
          type: 'fill',
          source: 'country-boundaries',
          paint: {
            'fill-color': '#3b82f6',
            'fill-opacity': 0,
          },
        });
        this.mapboxMap.addLayer({
          id: 'country-hover-fill',
          type: 'fill',
          source: 'country-boundaries',
          paint: {
            'fill-color': '#3b82f6',
            'fill-opacity': 0.06,
          },
          filter: ['==', ['get', 'name'], ''],
        });
        this.mapboxMap.addLayer({
          id: 'country-highlight-fill',
          type: 'fill',
          source: 'country-boundaries',
          paint: {
            'fill-color': '#3b82f6',
            'fill-opacity': 0.12,
          },
          filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
        });
        this.mapboxMap.addLayer({
          id: 'country-highlight-border',
          type: 'line',
          source: 'country-boundaries',
          paint: {
            'line-color': '#3b82f6',
            'line-width': 1.5,
            'line-opacity': 0.5,
          },
          filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
        });

        if (!this.countryHoverSetup) this.setupCountryHover();
        this.updateCountryLayerPaint(getCurrentTheme());
        if (this.highlightedCountryCode) this.highlightCountry(this.highlightedCountryCode);
        console.log('[DeckGLMap] Country boundaries loaded');
      })
      .catch((err) => console.warn('[DeckGLMap] Failed to load country boundaries:', err));
  }

  private setupCountryHover(): void {
    if (!this.mapboxMap || this.countryHoverSetup) return;
    this.countryHoverSetup = true;
    const map = this.mapboxMap;
    let hoveredName: string | null = null;

    map.on('mousemove', (e) => {
      if (!this.onCountryClick) return;
      const features = map.queryRenderedFeatures(e.point, { layers: ['country-interactive'] });
      const name = features?.[0]?.properties?.name as string | undefined;

      if (name && name !== hoveredName) {
        hoveredName = name;
        map.setFilter('country-hover-fill', ['==', ['get', 'name'], name]);
        map.getCanvas().style.cursor = 'pointer';
      } else if (!name && hoveredName) {
        hoveredName = null;
        map.setFilter('country-hover-fill', ['==', ['get', 'name'], '']);
        map.getCanvas().style.cursor = '';
      }
    });

    map.on('mouseout', () => {
      if (hoveredName) {
        hoveredName = null;
        map.setFilter('country-hover-fill', ['==', ['get', 'name'], '']);
        map.getCanvas().style.cursor = '';
      }
    });
  }

  public highlightCountry(code: string): void {
    this.highlightedCountryCode = code;
    if (!this.mapboxMap || !this.countryGeoJsonLoaded) return;
    const filter: FilterSpecification = ['==', ['get', 'ISO3166-1-Alpha-2'], code];
    try {
      this.mapboxMap.setFilter('country-highlight-fill', filter);
      this.mapboxMap.setFilter('country-highlight-border', filter);
    } catch { /* layer not ready yet */ }
  }

  public clearCountryHighlight(): void {
    this.highlightedCountryCode = null;
    if (!this.mapboxMap) return;
    const noMatch: FilterSpecification = ['==', ['get', 'ISO3166-1-Alpha-2'], ''];
    try {
      this.mapboxMap.setFilter('country-highlight-fill', noMatch);
      this.mapboxMap.setFilter('country-highlight-border', noMatch);
    } catch { /* layer not ready */ }
  }

  // Theme (light/dark) only affects the monochrome `dark` basemap; a light-swap
  // while on satellite/terrain is a no-op for the raster but still refreshes deck
  // colours via the caller. Both theme and style changes funnel through one setStyle.
  private switchBasemap(_theme: 'dark' | 'light'): void {
    if (this.basemapStyle === 'dark') this.applyBasemapStyle();
  }

  private static loadBasemapStyle(): BasemapStyle {
    try {
      const raw = localStorage.getItem(BASEMAP_STYLE_KEY);
      const style = (BASEMAP_STYLES as string[]).includes(raw ?? '') ? (raw as BasemapStyle) : DEFAULT_BASEMAP_STYLE;
      // satellite/terrain are Mapbox styles that need a token in 2D — but the native
      // deck GlobeView renders them from keyless ESRI imagery, so when native is the
      // 3D renderer they're always available. Only fall back to dark when neither a
      // token nor the native globe can serve them.
      if (isBrightBasemap(style) && !MAPBOX_TOKEN && !isNativeGlobeEnabled()) return 'dark';
      return style;
    } catch {
      return DEFAULT_BASEMAP_STYLE;
    }
  }

  // The effective mapbox style URL: `dark`/`dot` stay theme-aware CartoDB (the
  // locked monochrome look — dot overlays a land-dot lattice on top), satellite/
  // terrain are their own Mapbox styles.
  private resolveStyleUrl(): string {
    if (this.basemapStyle === 'satellite') return SATELLITE_STYLE;
    if (this.basemapStyle === 'terrain') return TERRAIN_STYLE;
    return getCurrentTheme() === 'light' ? LIGHT_STYLE : DARK_STYLE;
  }

  // Keyless deck raster basemap (CartoDB), used only when no Mapbox token exists so
  // the map never blacks out. Theme-aware; renders in both the flat MapView and the
  // deck _GlobeView (deck drapes the LNGLAT-bounded bitmaps for us). Data layers,
  // which push after this in buildLayers(), always draw on top.
  private buildBasemapLayer(): TileLayer {
    const data = getCurrentTheme() === 'light' ? CARTO_LIGHT_RASTER : CARTO_DARK_RASTER;
    return new TileLayer({
      id: 'keyless-raster-basemap',
      data,
      tileSize: 256,
      minZoom: 0,
      maxZoom: 18,
      maxRequests: 8,
      pickable: false,
      renderSubLayers: (props) => {
        const bbox = (props.tile as unknown as { boundingBox: number[][] }).boundingBox;
        const west = bbox[0]?.[0] ?? -180;
        const south = bbox[0]?.[1] ?? -90;
        const east = bbox[1]?.[0] ?? 180;
        const north = bbox[1]?.[1] ?? 90;
        return new BitmapLayer({
          id: `${props.id}-bitmap`,
          image: props.data as string,
          bounds: [west, south, east, north],
        });
      },
    });
  }

  // One and only one setStyle path. setStyle() replaces every source/layer AND
  // clears fog + terrain + resets projection to mercator, so the once('style.load')
  // restores all of them. The overlaid deck lives outside the style, so it survives.
  private applyBasemapStyle(): void {
    if (!this.mapboxMap) return;
    this.mapboxMap.setStyle(this.resolveStyleUrl());
    this.countryGeoJsonLoaded = false;
    this.mapboxMap.once('style.load', () => {
      this.loadCountryBoundaries();
      this.applyAtmosphere();
      this.applyProjection();
      this.applyTerrain();
      this.applyBrightBasemapClass();
    });
  }

  // Public: switch basemap style (dark | satellite | terrain), persist, reflect UI.
  public setBasemapStyle(style: BasemapStyle): void {
    if (!BASEMAP_STYLES.includes(style) || style === this.basemapStyle) return;
    this.basemapStyle = style;
    try { localStorage.setItem(BASEMAP_STYLE_KEY, style); } catch { /* storage full/blocked */ }
    this.updateStyleSwitcher();
    // Tell the native deck GlobeView first so it re-drapes live — and even if the
    // parked 2D mapbox can't apply the style (satellite/terrain need a token; setStyle
    // throws synchronously without one), the globe still switches.
    window.dispatchEvent(new CustomEvent('basemap-style-changed', { detail: { style } }));
    try {
      this.applyBasemapStyle();
    } catch { /* mapbox satellite/terrain need a token; the native globe already handled it */ }
    this.render(); // deck dot colours re-evaluate against the new backdrop
  }

  public getBasemapStyle(): BasemapStyle {
    return this.basemapStyle;
  }

  // ---- Layer panel open/close (driven by the dock's Layers button) ----------
  public isLayerPanelOpen(): boolean {
    return this.layerPanelEl?.classList.contains('open') ?? false;
  }

  public setLayerPanelOpen(open: boolean): void {
    this.layerPanelEl?.classList.toggle('open', open);
  }

  public toggleLayerPanel(): boolean {
    const open = !this.isLayerPanelOpen();
    this.setLayerPanelOpen(open);
    return open;
  }

  // Drape the current style over the Mapbox DEM for real relief when on terrain;
  // otherwise clear terrain. Safe to call once the style has loaded.
  private applyTerrain(): void {
    if (!this.mapboxMap) return;
    try {
      if (this.basemapStyle === 'terrain') {
        if (!this.mapboxMap.getSource(TERRAIN_DEM_SOURCE_ID)) {
          this.mapboxMap.addSource(TERRAIN_DEM_SOURCE_ID, {
            type: 'raster-dem',
            url: TERRAIN_DEM_URL,
            tileSize: 512,
            maxzoom: 14,
          });
        }
        this.mapboxMap.setTerrain({ source: TERRAIN_DEM_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION });
      } else {
        this.mapboxMap.setTerrain(null);
      }
    } catch { /* DEM source needs a Mapbox token; harmless without one */ }
  }

  // Toggle the thin-dark-halo class on the map wrapper so data dots stay legible on
  // bright satellite/terrain rasters (CSS drop-shadow on the deck canvas only).
  private applyBrightBasemapClass(): void {
    this.container.classList.toggle('bright-basemap', isBrightBasemap(this.basemapStyle));
  }

  private createStyleSwitcher(): void {
    const el = document.createElement('div');
    el.className = 'deckgl-style-switcher';
    const opts: Array<{ style: BasemapStyle; label: string; title: string }> = [
      { style: 'dark', label: 'Dark', title: t('components.deckgl.basemap.dark', { defaultValue: 'Dark basemap' }) },
      { style: 'dot', label: 'Dot', title: t('components.deckgl.basemap.dot', { defaultValue: 'Dotted-land cybermap' }) },
      { style: 'satellite', label: 'Sat', title: t('components.deckgl.basemap.satellite', { defaultValue: 'Satellite imagery' }) },
      { style: 'terrain', label: 'Terrain', title: t('components.deckgl.basemap.terrain', { defaultValue: 'Terrain relief' }) },
    ];
    el.innerHTML = opts
      .map((o) => {
        // Bright Mapbox styles need a token for the 2D map; the native 3D globe
        // serves them from keyless ESRI imagery, so they stay enabled when native is
        // the 3D renderer. Only disable when neither path can render them.
        const needsToken = isBrightBasemap(o.style) && !MAPBOX_TOKEN && !isNativeGlobeEnabled();
        const title = needsToken
          ? t('components.deckgl.basemap.needsToken', { defaultValue: 'Requires a Mapbox token' })
          : o.title;
        return `<button class="style-btn ${o.style === this.basemapStyle ? 'active' : ''}" data-style="${o.style}"${needsToken ? ' disabled' : ''} title="${title}">${o.label}</button>`;
      })
      .join('');
    el.querySelectorAll('.style-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.setBasemapStyle((btn as HTMLElement).dataset.style as BasemapStyle));
    });
    this.mountDropdown('basemap', el, t('components.deckgl.basemap.dark', { defaultValue: 'Basemap' }));
  }

  private updateStyleSwitcher(): void {
    const el = this.controlsHost.querySelector('.deckgl-style-switcher');
    if (!el) return;
    el.querySelectorAll('.style-btn').forEach((btn) => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.style === this.basemapStyle);
    });
    this.syncDropdownLabel(el.closest('.deckgl-dd'));
  }

  private updateCountryLayerPaint(theme: 'dark' | 'light'): void {
    if (!this.mapboxMap || !this.countryGeoJsonLoaded) return;
    const hoverOpacity = theme === 'light' ? 0.10 : 0.06;
    const highlightOpacity = theme === 'light' ? 0.18 : 0.12;
    try {
      this.mapboxMap.setPaintProperty('country-hover-fill', 'fill-opacity', hoverOpacity);
      this.mapboxMap.setPaintProperty('country-highlight-fill', 'fill-opacity', highlightOpacity);
    } catch { /* layers may not be ready */ }
  }

  public destroy(): void {
    if (this.moveTimeoutId) {
      clearTimeout(this.moveTimeoutId);
      this.moveTimeoutId = null;
    }

    for (const id of this.cloudMapTimers) clearInterval(id);
    this.cloudMapTimers = [];

    this.stopCloudPulse();
    this.stopAutoRotate();
    if (this.autoRotateIdleTimer) {
      clearTimeout(this.autoRotateIdleTimer);
      this.autoRotateIdleTimer = null;
    }

    this.stopPulseAnimation();

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.layerCache.clear();
    this.lastFullLayers = [];
    this.chainDots = [];
    this.chainDotsSource = null;

    this.deckOverlay?.finalize();
    this.mapboxMap?.remove();

    this.container.innerHTML = '';
  }
}
