/**
 * GlobeNative — a pure deck.gl GlobeView renderer for the 3D intelligence globe.
 *
 * Decomplected from the 2D path: where DeckGLMap renders data as a deck.gl overlay
 * on top of a mapbox-gl basemap (two WebGL contexts, mapbox owns the globe), this
 * module owns ONE Deck instance driving a single `_GlobeView` in ONE canvas / ONE
 * WebGL context. No mapbox. The basemap (near-black land, thin borders, black space,
 * a faint atmosphere rim) is drawn as deck layers from the bundled Natural-Earth
 * `/data/countries.geojson` — the same file the SVG fallback + country hit-testing use.
 *
 * Data layers are NOT re-implemented here. They are pulled verbatim from the exact
 * same builders the 2D map uses via a small `GlobeLayerSource` bridge
 * (`DeckGLMap.asGlobeSource()`), so all ~30 layers, tooltips and click behaviour stay
 * defined in one place. Heatmap→scatter substitution is handled inside those builders
 * (they key on the map's `mode === '3d'`), so it comes for free.
 *
 * Perf contract (structural — headless GPU can't be measured):
 *   - single WebGL context (assert: one <canvas> under the wrapper),
 *   - layer *instances* are rebuilt only on data change (coalesced), never per frame;
 *     the idle-spin RAF mutates ONLY the camera view state,
 *   - device-pixel-ratio capped at 2,
 *   - no per-frame allocations in accessors (basemap accessors are constants),
 *   - the idle-spin RAF is gated by reduced-motion / tab-hidden / user-interaction /
 *     pause — the same gate the mapbox globe uses (see DeckGLMap.autoRotateGateOpen).
 */
import {
  Deck,
  _GlobeView as GlobeView,
  COORDINATE_SYSTEM,
  LinearInterpolator,
  type PickingInfo,
  type LayersList,
} from '@deck.gl/core';
import { GeoJsonLayer, BitmapLayer, ScatterplotLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { SphereGeometry } from '@luma.gl/engine';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { getCountriesGeoJson, getCountryAtCoordinates } from '@/services/country-geometry';
import { getLandDots, type LandDot } from '@/services/land-dots';
import { DEFAULT_BASEMAP_STYLE } from '@/config/variant';

/**
 * The read-only bridge GlobeNative consumes. DeckGLMap implements this (via
 * `asGlobeSource()`) so the globe reuses its data layers, tooltips and click
 * handling without duplicating a single builder. Kept structural (no import of
 * DeckGLMap here) to avoid a dependency cycle.
 */
export interface GlobeLayerSource {
  buildLayers(): LayersList;
  getTooltip(info: PickingInfo): { html: string } | null;
  handleClick(info: PickingInfo): void;
  /** Feed the globe's live camera (lng/lat) so the source can cull far-side billboards
   *  against the rotation the user sees, not the parked mapbox center. */
  setOcclusionCenter?(lng: number, lat: number): void;
}

export interface GlobeCountryClick {
  lat: number;
  lon: number;
  code?: string;
  name?: string;
}

export interface GlobeViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
}

export interface GlobeNativeOptions {
  /** Layer/tooltip/click source — usually `deckGLMap.asGlobeSource()`. */
  source?: GlobeLayerSource | null;
  /** Initial camera. */
  center?: GlobeViewState;
  /** Fired on an empty-globe click, resolved to a country from the basemap geometry. */
  onCountryClick?: (payload: GlobeCountryClick) => void;
  /** Auto-rotate when idle (default true; always suppressed under reduced-motion). */
  autoRotate?: boolean;
  /** How often (ms) to re-pull data layers from the source while active (default 500). */
  syncIntervalMs?: number;
  /** Initial basemap style; defaults to the persisted 2D switcher selection. */
  basemapStyle?: BasemapStyle;
}

// Monochrome "vercel-black" basemap palette. Land is near-black, borders are the
// requested #1f grey, space is pure black, the atmosphere rim is the same faint
// cool-grey as the mapbox path's MONOCHROME_FOG horizon halo.
const OCEAN_COLOR: [number, number, number, number] = [4, 6, 10, 255];
// On bright imagery styles the sphere backing shows only where tiles don't reach
// (the Web-Mercator polar caps above ~85°) — a dark slate-blue there blends with the
// oceans instead of reading as a black hole.
const OCEAN_COLOR_BRIGHT: [number, number, number, number] = [16, 28, 42, 255];
const LAND_COLOR: [number, number, number, number] = [17, 21, 28, 255]; // ~#11151c
const BORDER_COLOR: [number, number, number, number] = [58, 62, 70, 170]; // ~#3a3e46 (#1f-grey borders)
// Thin border overlay kept on the bright imagery styles for intel orientation.
const BRIGHT_BORDER_COLOR: [number, number, number, number] = [235, 240, 250, 90];
const ATMOSPHERE_COLOR: [number, number, number, number] = [80, 92, 116, 120];
// Dot basemap land dots — a cool dim cyan-white, brighter than the dark style's
// near-black land so the lattice reads as a glowing cybermap surface, dim enough
// that live traffic dots/arcs stay the focal layer on top.
const LAND_DOT_COLOR: [number, number, number, number] = [120, 150, 185, 165];

// Basemap style — mirrors DeckGLMap's switcher. Read from the SAME localStorage key
// so the 2D switcher drives the globe; kept as literals here to avoid importing the
// giant DeckGLMap module for two constants (contract: keep in sync with it).
export type BasemapStyle = 'dark' | 'dot' | 'satellite' | 'terrain';
const BASEMAP_STYLES: BasemapStyle[] = ['dark', 'dot', 'satellite', 'terrain'];
const BASEMAP_STYLE_KEY = 'hanzo-world-basemap-style';
const isBrightBasemap = (s: BasemapStyle): boolean => s === 'satellite' || s === 'terrain';
const isDotBasemap = (s: BasemapStyle): boolean => s === 'dot';

// Keyless ESRI ArcGIS raster tiles (ACAO:* — CORS-safe for WebGL textures). Note the
// {z}/{y}/{x} order ArcGIS uses. World_Imagery = real satellite; World_Physical_Map =
// a natural physical/terrain relief that reads unmistakably as "terrain".
const ESRI_SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_TERRAIN_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}';
// Draw imagery slightly transparent over the near-black ocean sphere so it reads a
// touch darker — data dots stay legible without a per-marker halo (the single-canvas
// globe can't isolate a CSS drop-shadow to markers the way the 2D overlay can).
const IMAGERY_OPACITY = 0.86;

// deck's GlobeViewport maps CARTESIAN metres onto a 256-unit sphere; a mesh of
// EARTH_RADIUS sits exactly on the surface where lng/lat layers draw. We seat the
// ocean sphere just *below* that surface so land polygons float cleanly on top
// (no z-fighting), and the atmosphere shell just *above* it for the rim glow.
const EARTH_RADIUS = 6_370_972;
const OCEAN_RADIUS = EARTH_RADIUS * 0.995;
const ATMOSPHERE_RADIUS = EARTH_RADIUS * 1.018;

const DEFAULT_VIEW: GlobeViewState = { longitude: 0, latitude: 20, zoom: 0.5, minZoom: 0, maxZoom: 8 };

// Idle-spin tuning — identical feel to the mapbox globe (DeckGLMap). 2°/s is the
// calm, cinematic drift (halved from 4°/s, which read as "spinning a bit too fast").
const AUTO_ROTATE_DEG_PER_SEC = 2;
const AUTO_ROTATE_IDLE_MS = 5000;
const AUTO_ROTATE_MIN_FRAME_MS = 33; // ~30fps: half the repaints of a per-frame spin

const STORAGE_FLAG = 'hanzo-world-globe-native';

/**
 * Renderer selection for the 3D globe. Native deck.gl GlobeView is now the DEFAULT
 * 3D renderer (single camera → perfect registration, single WebGL context, far-side
 * occlusion). The mapbox globe stays available as the escape hatch:
 *   - `?globe=mapbox` / `?globe=off` / `?globe=0` — force the mapbox globe,
 *   - `?globe=native` / `?globe=1` — force native (also the default),
 *   - localStorage `hanzo-world-globe-native = 0` — persistent opt-out to mapbox.
 * (2D is always the mapbox mercator path, untouched.)
 */
export function isNativeGlobeEnabled(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('globe');
    if (q === 'native' || q === '1') return true;
    if (q === 'mapbox' || q === 'off' || q === '0') return false;
    if (localStorage.getItem(STORAGE_FLAG) === '0') return false;
    return true; // default: native globe
  } catch {
    return true;
  }
}

/** Current basemap style from the SAME key the 2D switcher writes (defaults to
 *  the variant default — dotted-land for cloud/ai, near-black dark elsewhere). */
export function readBasemapStyle(): BasemapStyle {
  try {
    const raw = localStorage.getItem(BASEMAP_STYLE_KEY);
    return (BASEMAP_STYLES as string[]).includes(raw ?? '') ? (raw as BasemapStyle) : DEFAULT_BASEMAP_STYLE;
  } catch {
    return DEFAULT_BASEMAP_STYLE;
  }
}

export class GlobeNative {
  private container: HTMLElement;
  private wrapper: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private deck: Deck<GlobeView>;

  private source: GlobeLayerSource | null;
  private onCountryClick?: (payload: GlobeCountryClick) => void;

  private viewState: GlobeViewState;
  private basemapStyle: BasemapStyle;
  private basemapLayers: LayersList = [];
  private dataLayers: LayersList = [];
  private countriesGeoJson: FeatureCollection<Geometry> | null = null;
  private landDots: LandDot[] = [];

  private readonly reducedMotion: boolean;
  private autoRotateEnabled: boolean;
  private autoRotateRafId: number | null = null;
  private autoRotateLastTs = 0;
  private autoRotateIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private userInteracting = false;

  private renderPaused = false;
  private destroyed = false;

  private syncIntervalMs: number;
  private syncTimerId: ReturnType<typeof setInterval> | null = null;
  private refreshScheduled = false;
  // Camera the far-side cull last faced; a drag past ~2° re-pulls layers so occlusion
  // tracks rotation without a per-frame rebuild.
  private cullLng = 0;
  private cullLat = 0;

  constructor(container: HTMLElement, options: GlobeNativeOptions = {}) {
    this.container = container;
    this.source = options.source ?? null;
    this.onCountryClick = options.onCountryClick;
    this.autoRotateEnabled = options.autoRotate ?? true;
    this.syncIntervalMs = options.syncIntervalMs ?? 500;
    this.viewState = { ...DEFAULT_VIEW, ...(options.center ?? {}) };
    this.basemapStyle = options.basemapStyle ?? readBasemapStyle();
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'globe-native-wrapper';
    // z-index 1: above a parked mapbox basemap wrapper (z auto), below the map
    // controls / projection toggle (z-index 500) so they stay clickable.
    this.wrapper.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;background:#000;overflow:hidden;z-index:1;';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'globe-native-canvas';
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    this.wrapper.appendChild(this.canvas);
    this.container.appendChild(this.wrapper);

    // DPR capped at 2 — retina globes are GPU-bound and the monochrome basemap shows
    // no benefit above 2x. A number here sets the exact ratio, so min() = a hard cap.
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    // A SINGLE GlobeView (not an array) gives deck a flat GlobeViewState — no
    // per-view keying. Black space comes from the wrapper background showing through
    // deck's transparent clear.
    this.deck = new Deck<GlobeView>({
      canvas: this.canvas,
      views: new GlobeView({
        controller: this.reducedMotion ? { inertia: false } : { inertia: 300 },
        // Subdivide flat basemap polygons finely enough to hug the sphere.
        resolution: 8,
      }),
      viewState: this.viewState,
      controller: true,
      useDevicePixels: dpr,
      // No lighting effects — the basemap spheres stay flat vercel-black (no specular
      // sheen) and every intel layer is unlit (scatter/arc/path/icon/text).
      effects: [],
      layers: [],
      getTooltip: (info: PickingInfo) => this.source?.getTooltip(info) ?? null,
      onClick: (info: PickingInfo) => this.handleClick(info),
      onViewStateChange: ({ viewState }) => {
        this.viewState = viewState;
        this.deck.setProps({ viewState });
        // Re-pull layers (coalesced) once the camera has rotated far enough that the
        // visible hemisphere changed, so the far-side billboard cull keeps up with a
        // drag. deck.gl diffs by id, so unchanged layers cost nothing.
        if (Math.abs(viewState.longitude - this.cullLng) > 2 || Math.abs(viewState.latitude - this.cullLat) > 2) {
          this.refresh();
        }
      },
      onError: (error: Error) =>
        console.warn('[GlobeNative] Render error (non-fatal):', error.message),
    });

    // Pause the idle spin on any direct manipulation; it resumes after a quiet period.
    this.canvas.addEventListener('pointerdown', this.onUserInteract, { passive: true });
    this.canvas.addEventListener('wheel', this.onUserInteract, { passive: true });
    this.canvas.addEventListener('touchstart', this.onUserInteract, { passive: true });

    // React live to the 2D switcher (dark | satellite | terrain) — DeckGLMap fires
    // this whenever its basemap style changes.
    window.addEventListener('basemap-style-changed', this.onBasemapStyleChanged);

    if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
      (window as unknown as { __globeNative?: GlobeNative }).__globeNative = this;
    }

    void this.loadBasemap();
    this.refresh();
    this.startDataSync();
    if (this.autoRotateEnabled) this.maybeStartAutoRotate();
  }

  // ---- Basemap ---------------------------------------------------------------

  private async loadBasemap(): Promise<void> {
    // Ocean + atmosphere shells render immediately; land/borders follow the fetch.
    this.rebuildBasemap();
    try {
      this.countriesGeoJson = await getCountriesGeoJson();
    } catch (error) {
      console.warn('[GlobeNative] country geometry unavailable:', (error as Error).message);
      this.countriesGeoJson = null;
    }
    // The dot basemap samples a land lattice off the SAME geojson; cheap to fetch
    // (cached per session) and generates once. Empty until geometry lands — the
    // dot layer then renders nothing, matching the dark style's pre-load state.
    void getLandDots().then((dots) => {
      if (this.destroyed) return;
      this.landDots = dots;
      this.rebuildBasemap();
      this.pushLayers();
    });
    if (this.destroyed) return;
    this.rebuildBasemap();
    this.pushLayers();
  }

  private rebuildBasemap(): void {
    // Draw order matters. Atmosphere first (behind), then the depth-writing ocean
    // sphere, then imagery/land. The ocean sphere writing depth is what makes far-side
    // data features (points/arcs behind the planet) occlude correctly — deck's globe
    // layers depth-test against it, so nothing renders "through" the Earth.
    const bright = isBrightBasemap(this.basemapStyle);
    const layers: LayersList = [
      // Backside shell → a faint atmospheric rim at the silhouette. Depth-tests but
      // does not write, so it never blocks data near the limb; the near-disc portion
      // is painted over by the ocean sphere, leaving only the outer halo.
      new SimpleMeshLayer({
        id: 'globe-atmosphere',
        data: SINGLE_DATUM,
        mesh: new SphereGeometry({ radius: ATMOSPHERE_RADIUS, nlat: 24, nlong: 48 }),
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: ORIGIN,
        getColor: ATMOSPHERE_COLOR,
        pickable: false,
        // Flat faint color — no lighting, keeps the monochrome look.
        material: false,
        parameters: {
          cullMode: 'front',
          depthWriteEnabled: false,
          depthCompare: 'less-equal',
        } as unknown as Record<string, unknown>,
      }),
      // Solid globe body — near-black ocean, seated just under the lng/lat surface.
      // Writes depth so it occludes far-side geometry. Unlit for a flat vercel-black
      // sphere (no specular highlight); the 3D read comes from curved borders +
      // atmosphere rim + feature occlusion.
      new SimpleMeshLayer({
        id: 'globe-ocean',
        data: SINGLE_DATUM,
        mesh: new SphereGeometry({ radius: OCEAN_RADIUS, nlat: 48, nlong: 96 }),
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: ORIGIN,
        getColor: bright ? OCEAN_COLOR_BRIGHT : OCEAN_COLOR,
        pickable: false,
        material: false,
        parameters: {
          cullMode: 'back',
          depthWriteEnabled: true,
          depthCompare: 'less-equal',
        } as unknown as Record<string, unknown>,
      }),
    ];

    if (bright) {
      // Real earth imagery draped on the sphere (satellite or physical/terrain relief).
      layers.push(this.buildImageryLayer(this.basemapStyle));
    }

    if (isDotBasemap(this.basemapStyle)) {
      // Dot basemap: land is ONLY a lattice of glowing dots on the black ocean — no
      // country fills, no borders. The dot cloud is sampled from the SAME geojson as
      // the dark style (see land-dots.ts) and cached per session. Sits just above the
      // ocean shell; writes no depth (the ocean sphere owns depth), depth-tests so
      // far-side dots are occluded by the near hemisphere — real back-of-globe cull.
      if (this.landDots.length > 0) {
        layers.push(
          new ScatterplotLayer<LandDot>({
            id: 'globe-land-dots',
            data: this.landDots,
            getPosition: (d) => [d.lon, d.lat],
            getRadius: 16000, // ~1.6° in metres; reads as a tight dot at globe zoom
            radiusUnits: 'meters',
            radiusMinPixels: 0.7,
            radiusMaxPixels: 3,
            getFillColor: LAND_DOT_COLOR,
            pickable: false,
            parameters: {
              cullMode: 'none',
              depthWriteEnabled: false,
              depthCompare: 'less-equal',
            } as unknown as Record<string, unknown>,
          }),
        );
      }
    } else if (this.countriesGeoJson) {
      layers.push(
        // Dark styling: near-black land fill + thin #1f-grey borders in one pass.
        // Bright styling: borders only (imagery is the fill), a faint light stroke for
        // orientation. Sits just above the ocean shell; writes depth so far-side land
        // is occluded too.
        new GeoJsonLayer<Feature>({
          id: 'globe-land',
          data: this.countriesGeoJson as unknown as Feature[],
          filled: !bright,
          stroked: true,
          getFillColor: LAND_COLOR,
          getLineColor: bright ? BRIGHT_BORDER_COLOR : BORDER_COLOR,
          lineWidthUnits: 'pixels',
          getLineWidth: bright ? 0.5 : 0.6,
          lineWidthMinPixels: 0.4,
          pickable: false,
          parameters: {
            cullMode: 'none',
            depthWriteEnabled: !bright, // imagery already writes depth on bright styles
            depthCompare: 'less-equal',
          } as unknown as Record<string, unknown>,
        }),
      );
    }

    this.basemapLayers = layers;
  }

  // A deck TileLayer of keyless ESRI raster tiles draped onto the globe. Back-facing
  // tile geometry is culled so the far hemisphere never bleeds through; the near-black
  // ocean sphere beneath supplies depth + fills poles/gaps and darkens the imagery
  // slightly (via IMAGERY_OPACITY) so data dots stay legible.
  private buildImageryLayer(style: BasemapStyle): TileLayer {
    const url = style === 'terrain' ? ESRI_TERRAIN_URL : ESRI_SATELLITE_URL;
    return new TileLayer({
      id: `globe-imagery-${style}`,
      data: url,
      tileSize: 256,
      minZoom: 0,
      maxZoom: 7, // globe view never needs street-level tiles; caps tile fan-out
      maxRequests: 8,
      opacity: IMAGERY_OPACITY,
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
          // Project the flat tile onto the sphere and cull its far-hemisphere faces.
          _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          parameters: {
            cullMode: 'back',
            // Do NOT write depth. Adjacent imagery tiles are coplanar on the sphere;
            // if each writes depth they z-fight at the shared tile seams under any
            // depth-precision jitter → the horizontal "striping" glitch. The ocean
            // sphere beneath owns the depth buffer (it writes), so far-side features
            // still occlude correctly; the tiles only need to depth-TEST against it.
            depthWriteEnabled: false,
            depthCompare: 'less-equal',
          } as unknown as Record<string, unknown>,
        });
      },
    });
  }

  // ---- Basemap style (dark | satellite | terrain) ---------------------------

  private onBasemapStyleChanged = (e: Event): void => {
    const style = (e as CustomEvent<{ style?: BasemapStyle }>).detail?.style;
    if (style) this.setBasemapStyle(style);
  };

  /** Re-drape the globe for a new basemap style; safe to call before geometry loads. */
  public setBasemapStyle(style: BasemapStyle): void {
    if (this.destroyed || style === this.basemapStyle) return;
    this.basemapStyle = style;
    this.rebuildBasemap();
    this.pushLayers();
  }

  public getBasemapStyle(): BasemapStyle {
    return this.basemapStyle;
  }

  // ---- Data layers -----------------------------------------------------------

  /** Set/replace the data source and immediately re-pull its layers. */
  public setSource(source: GlobeLayerSource | null): void {
    this.source = source;
    this.refresh();
  }

  /**
   * Rebuild the data layers from the source, coalesced to one rebuild per frame.
   * Called on data change (via the sync tick or explicitly by the host). The idle
   * spin never calls this — it only moves the camera.
   */
  public refresh(): void {
    if (this.destroyed || this.refreshScheduled) return;
    this.refreshScheduled = true;
    requestAnimationFrame(() => {
      this.refreshScheduled = false;
      if (this.destroyed) return;
      // Face the far-side cull at the globe's OWN live camera before the source builds
      // its layers, so back-hemisphere markers/badges are hidden for the view we render.
      this.cullLng = this.viewState.longitude;
      this.cullLat = this.viewState.latitude;
      this.source?.setOcclusionCenter?.(this.viewState.longitude, this.viewState.latitude);
      this.dataLayers = this.source ? (this.source.buildLayers() ?? []) : [];
      this.pushLayers();
    });
  }

  private pushLayers(): void {
    if (this.destroyed) return;
    this.deck.setProps({ layers: [...this.basemapLayers, ...this.withSurfaceDepth(this.dataLayers)] });
  }

  // Occlusion, in ONE place. The data-layer builders (shared with the 2D map) set no
  // depth parameters, so on the single-context globe they'd draw over the sphere and
  // the far hemisphere would show through ("layers above the globe"). Here we make
  // every data layer depth-TEST against the depth-writing ocean sphere (radius 0.995R,
  // seated just under the lng/lat surface): a fragment on the FAR side sits behind the
  // near ocean surface in the depth buffer and is culled by the GPU — real back-of-globe
  // occlusion for points, icons, text badges, paths and arcs alike. We do NOT write
  // depth (depthWriteEnabled:false) so coincident surface markers don't z-fight each
  // other. A layer that already declared parameters keeps them (spread last).
  private withSurfaceDepth(layers: LayersList): LayersList {
    return (layers as unknown[]).map((l) => {
      const layer = l as { clone?: (p: Record<string, unknown>) => unknown; props?: { parameters?: Record<string, unknown> } } | null;
      if (!layer?.clone) return l as never;
      const existing = layer.props?.parameters ?? {};
      return layer.clone({
        parameters: { depthCompare: 'less-equal', depthWriteEnabled: false, ...existing },
      }) as never;
    }) as unknown as LayersList;
  }

  // Re-pull data on a slow cadence so feed updates land without coupling GlobeNative
  // to the host's ~40 individual setters. deck.gl diffs layers by id, so unchanged
  // layers cost nothing; this is a 2Hz rebuild, not a per-frame one.
  private startDataSync(): void {
    if (this.syncTimerId != null) return;
    this.syncTimerId = setInterval(() => {
      if (this.renderPaused || document.hidden || !this.source) return;
      this.refresh();
    }, this.syncIntervalMs);
  }

  private stopDataSync(): void {
    if (this.syncTimerId != null) {
      clearInterval(this.syncTimerId);
      this.syncTimerId = null;
    }
  }

  // ---- Interaction -----------------------------------------------------------

  private handleClick(info: PickingInfo): void {
    if (!info.object) {
      // Empty-globe click → resolve to a country from the basemap geometry.
      const coord = info.coordinate;
      const lon = coord?.[0];
      const lat = coord?.[1];
      if (lon != null && lat != null && this.onCountryClick) {
        const hit = getCountryAtCoordinates(lat, lon);
        this.onCountryClick({ lat, lon, code: hit?.code, name: hit?.name });
      }
      return;
    }
    this.source?.handleClick(info);
  }

  // ---- Camera: fly-to --------------------------------------------------------

  /** Glide the globe camera to a location (mapbox `setCenter`/`flyTo` equivalent). */
  public setCenter(lat: number, lon: number, zoom?: number): void {
    this.flyTo(lat, lon, zoom);
  }

  public flyTo(lat: number, lon: number, zoom?: number): void {
    if (this.destroyed) return;
    const target: GlobeViewState = {
      ...this.viewState,
      longitude: lon,
      latitude: lat,
      zoom: zoom ?? this.viewState.zoom,
    };
    this.viewState = target;
    // GlobeView is great-circle native; a linear interp of lng/lat/zoom reads as a
    // smooth glide. Reduced-motion jumps instantly. Transition props ride on the
    // viewState object (deck reads them off it).
    const transition: GlobeViewState & {
      transitionDuration?: number;
      transitionInterpolator?: LinearInterpolator;
    } = { ...target };
    if (!this.reducedMotion) {
      transition.transitionDuration = 1200;
      transition.transitionInterpolator = new LinearInterpolator(['longitude', 'latitude', 'zoom']);
    }
    this.deck.setProps({ viewState: transition });
  }

  public getCenter(): { lat: number; lon: number } {
    return { lat: this.viewState.latitude, lon: this.viewState.longitude };
  }

  public setOnCountryClick(cb: (payload: GlobeCountryClick) => void): void {
    this.onCountryClick = cb;
  }

  // ---- Idle spin (camera-only; gated exactly like the mapbox globe) -----------

  private onUserInteract = (): void => {
    this.userInteracting = true;
    if (this.autoRotateIdleTimer) clearTimeout(this.autoRotateIdleTimer);
    this.autoRotateIdleTimer = setTimeout(() => {
      this.userInteracting = false;
      this.autoRotateLastTs = 0; // avoid a jump on resume
    }, AUTO_ROTATE_IDLE_MS);
  };

  public setAutoRotate(on: boolean): void {
    this.autoRotateEnabled = on;
    if (on) this.maybeStartAutoRotate();
    else this.stopAutoRotate();
  }

  private maybeStartAutoRotate(): void {
    if (this.autoRotateRafId != null) return;
    if (!this.autoRotateEnabled || this.renderPaused || this.reducedMotion || this.destroyed) return;

    this.autoRotateLastTs = 0;
    const step = (ts: number): void => {
      this.autoRotateRafId = requestAnimationFrame(step);
      if (!this.autoRotateGateOpen()) {
        this.autoRotateLastTs = 0;
        return;
      }
      if (this.autoRotateLastTs === 0) {
        this.autoRotateLastTs = ts;
        return;
      }
      const elapsedMs = ts - this.autoRotateLastTs;
      if (elapsedMs < AUTO_ROTATE_MIN_FRAME_MS) return; // throttle to ~30fps
      this.autoRotateLastTs = ts;
      this.rotateOneStep(elapsedMs / 1000);
    };
    this.autoRotateRafId = requestAnimationFrame(step);
  }

  // Pure decision, no rendering. Closed when disabled, interacting, paused,
  // reduced-motion, or the tab is hidden.
  private autoRotateGateOpen(): boolean {
    return (
      this.autoRotateEnabled &&
      !this.userInteracting &&
      !this.renderPaused &&
      !this.reducedMotion &&
      !this.destroyed &&
      !document.hidden
    );
  }

  /** Advance the camera longitude eastward — mutates ONLY the view state. */
  public rotateOneStep(dtSec: number): void {
    const nextLng = ((this.viewState.longitude + AUTO_ROTATE_DEG_PER_SEC * dtSec + 540) % 360) - 180;
    this.viewState = { ...this.viewState, longitude: nextLng };
    this.deck.setProps({ viewState: this.viewState });
  }

  private stopAutoRotate(): void {
    if (this.autoRotateRafId != null) {
      cancelAnimationFrame(this.autoRotateRafId);
      this.autoRotateRafId = null;
    }
  }

  // ---- Lifecycle -------------------------------------------------------------

  public setRenderPaused(paused: boolean): void {
    this.renderPaused = paused;
    if (paused) {
      this.stopAutoRotate();
    } else if (this.autoRotateEnabled) {
      this.maybeStartAutoRotate();
    }
  }

  // e2e introspection — the active viewport is a GlobeViewport in 3D (proves deck
  // is reprojecting onto the sphere).
  public getViewportType(): string | null {
    try {
      // getViewports asserts before deck's first render (viewManager not yet built),
      // so guard it — returning null reads as "not ready yet".
      const vps = (this.deck as unknown as {
        getViewports?: () => Array<{ constructor: { name: string } }>;
      }).getViewports?.();
      return vps && vps.length > 0 ? vps[0]!.constructor.name : null;
    } catch {
      return null;
    }
  }

  public getCanvasCount(): number {
    return this.wrapper.querySelectorAll('canvas').length;
  }

  public getDeck(): Deck<GlobeView> {
    return this.deck;
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopAutoRotate();
    if (this.autoRotateIdleTimer) clearTimeout(this.autoRotateIdleTimer);
    this.stopDataSync();
    this.canvas.removeEventListener('pointerdown', this.onUserInteract);
    this.canvas.removeEventListener('wheel', this.onUserInteract);
    this.canvas.removeEventListener('touchstart', this.onUserInteract);
    window.removeEventListener('basemap-style-changed', this.onBasemapStyleChanged);
    try {
      this.deck.finalize();
    } catch (error) {
      console.warn('[GlobeNative] finalize error:', (error as Error).message);
    }
    this.wrapper.remove();
    if ((window as unknown as { __globeNative?: GlobeNative }).__globeNative === this) {
      delete (window as unknown as { __globeNative?: GlobeNative }).__globeNative;
    }
  }
}

// Shared frozen constants so basemap accessors allocate nothing per frame.
const SINGLE_DATUM: [number] = [0];
const ORIGIN: [number, number, number] = [0, 0, 0];
