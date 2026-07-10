/**
 * MapContainer - Conditional map renderer
 * Renders DeckGLMap (WebGL) on desktop, fallback to D3/SVG MapComponent on mobile
 */
import { isMobileDevice } from '@/utils';
import { registerMapContextPort } from '@/services/panel-menu';
import { MapComponent } from './Map';
import { DeckGLMap, type DeckMapView, type CountryClickPayload, type MapProjectionMode } from './DeckGLMap';
import { GlobeNative, isNativeGlobeEnabled } from './GlobeNative';
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
  AirportDelayAlert,
  MilitaryFlight,
  MilitaryVessel,
  MilitaryFlightCluster,
  MilitaryVesselCluster,
  NaturalEvent,
  UcdpGeoEvent,
  DisplacementFlow,
  ClimateAnomaly,
  CyberThreat,
} from '@/types';
import type { WeatherAlert } from '@/services/weather';

export type TimeRange = '1h' | '6h' | '24h' | '48h' | '7d' | 'all';
export type MapView = 'global' | 'america' | 'mena' | 'eu' | 'asia' | 'latam' | 'africa' | 'oceania';

export type { MapProjectionMode } from './DeckGLMap';

export interface MapContainerState {
  zoom: number;
  pan: { x: number; y: number };
  view: MapView;
  layers: MapLayers;
  timeRange: TimeRange;
  mode?: MapProjectionMode;
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

/**
 * Unified map interface that delegates to either DeckGLMap or MapComponent
 * based on device capabilities
 */
export class MapContainer {
  private container: HTMLElement;
  private isMobile: boolean;
  private deckGLMap: DeckGLMap | null = null;
  private svgMap: MapComponent | null = null;
  private initialState: MapContainerState;
  private useDeckGL: boolean;

  // Native deck.gl GlobeView renderer — a flag-gated alternate for the 3D globe
  // (URL ?globe=native or localStorage hanzo-world-globe-native=1). Default off;
  // the mapbox globe stays the shipping 3D path. When active, DeckGLMap is parked
  // as the data authority (its buildLayers()/tooltips/clicks feed the globe) while
  // GlobeNative owns the on-screen 3D render.
  private nativeGlobeFlag: boolean;
  private globeNative: GlobeNative | null = null;
  private countryClickCb: ((country: CountryClickPayload) => void) | null = null;
  private appStateCb: ((state: MapContainerState) => void) | null = null;

  constructor(container: HTMLElement, initialState: MapContainerState) {
    this.container = container;
    this.initialState = initialState;
    this.isMobile = isMobileDevice();

    // Use deck.gl on desktop with WebGL support, SVG on mobile
    this.useDeckGL = !this.isMobile && this.hasWebGLSupport();
    this.nativeGlobeFlag = this.useDeckGL && isNativeGlobeEnabled();

    this.init();

    // Expose the map's capabilities to the right-click context menu (Copy
    // coordinates / Fly here / Toggle 2D-3D) through a narrow port — the menu
    // never reaches into map internals.
    registerMapContextPort({
      getProjectionMode: () => this.getProjectionMode(),
      setProjectionMode: (mode) => this.setProjectionMode(mode),
      getCenter: () => this.getCenter(),
      screenToLngLat: (x, y) => this.screenToLngLat(x, y),
      flyTo: (lat, lon) => this.setCenter(lat, lon),
    });
  }

  /** Viewport point → geographic coords (deck.gl only; null on the SVG fallback,
   *  where the menu falls back to the current map centre). */
  public screenToLngLat(clientX: number, clientY: number): { lat: number; lon: number } | null {
    if (this.useDeckGL) {
      return this.deckGLMap?.screenToLngLat(clientX, clientY) ?? null;
    }
    return null;
  }

  private hasWebGLSupport(): boolean {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return !!gl;
    } catch {
      return false;
    }
  }

  private init(): void {
    if (this.useDeckGL) {
      console.log('[MapContainer] Initializing deck.gl map (desktop mode)');
      this.container.classList.add('deckgl-mode');
      this.deckGLMap = new DeckGLMap(this.container, {
        ...this.initialState,
        view: this.initialState.view as DeckMapView,
      });

      if (this.nativeGlobeFlag) {
        console.log('[MapContainer] Native deck.gl GlobeView enabled (flag)');
        // One handler owns native activation: both the in-map 2D/3D toggle and any
        // external setProjectionMode() funnel through DeckGLMap's state change.
        this.deckGLMap.setOnStateChange((state) => this.handleDeckState(state));
        if (this.initialState.mode === '3d') this.activateNativeGlobe();
      }
    } else {
      console.log('[MapContainer] Initializing SVG map (mobile/fallback mode)');
      this.container.classList.add('svg-mode');
      this.svgMap = new MapComponent(this.container, this.initialState);
    }
  }

  // ---- Native deck.gl GlobeView (flag-gated) --------------------------------

  private handleDeckState(state: MapContainerState & { view: DeckMapView }): void {
    if (this.nativeGlobeFlag) {
      if (state.mode === '3d' && !this.globeNative) this.activateNativeGlobe();
      else if (state.mode === '2d' && this.globeNative) this.deactivateNativeGlobe();
    }
    this.appStateCb?.({ ...state, view: state.view as MapView });
  }

  private get deckWrapper(): HTMLElement | null {
    return this.container.querySelector('.deckgl-map-wrapper');
  }

  private activateNativeGlobe(): void {
    if (!this.deckGLMap || this.globeNative) return;
    // Park the mapbox map: it stays the data authority (buildLayers/tooltips/clicks
    // via asGlobeSource) but stops rendering, and is hidden behind the globe.
    this.deckGLMap.setRenderPaused(true);
    const wrapper = this.deckWrapper;
    if (wrapper) wrapper.style.visibility = 'hidden';

    const center = this.deckGLMap.getCenter();
    const zoom = this.deckGLMap.getState().zoom;
    this.globeNative = new GlobeNative(this.container, {
      source: this.deckGLMap.asGlobeSource(),
      center: center
        ? { longitude: center.lon, latitude: center.lat, zoom: Math.max(0, Math.min(zoom, 6)) }
        : undefined,
      onCountryClick: this.countryClickCb ?? undefined,
    });
  }

  private deactivateNativeGlobe(): void {
    if (this.globeNative) {
      this.globeNative.destroy();
      this.globeNative = null;
    }
    const wrapper = this.deckWrapper;
    if (wrapper) wrapper.style.visibility = '';
    this.deckGLMap?.setRenderPaused(false);
    this.deckGLMap?.render();
  }

  // Unified public API - delegates to active map implementation
  public render(): void {
    if (this.useDeckGL) {
      this.deckGLMap?.render();
    } else {
      this.svgMap?.render();
    }
  }

  public setView(view: MapView): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setView(view as DeckMapView);
    } else {
      this.svgMap?.setView(view);
    }
  }

  // Projection mode (2D map <-> 3D globe). Globe is deck.gl-only; the SVG
  // fallback stays flat, so the toggle is hidden on that path.
  public setProjectionMode(mode: MapProjectionMode): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setProjectionMode(mode);
    }
  }

  public getProjectionMode(): MapProjectionMode {
    if (this.useDeckGL) {
      return this.deckGLMap?.getProjectionMode() ?? '2d';
    }
    return '2d';
  }

  public setZoom(zoom: number): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setZoom(zoom);
    } else {
      this.svgMap?.setZoom(zoom);
    }
  }

  public setCenter(lat: number, lon: number, zoom?: number): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setCenter(lat, lon, zoom);
      this.globeNative?.setCenter(lat, lon, zoom);
    } else {
      this.svgMap?.setCenter(lat, lon);
      if (zoom != null) this.svgMap?.setZoom(zoom);
    }
  }

  public getCenter(): { lat: number; lon: number } | null {
    if (this.useDeckGL) {
      if (this.globeNative) return this.globeNative.getCenter();
      return this.deckGLMap?.getCenter() ?? null;
    }
    return this.svgMap?.getCenter() ?? null;
  }

  public setTimeRange(range: TimeRange): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setTimeRange(range);
    } else {
      this.svgMap?.setTimeRange(range);
    }
  }

  public getTimeRange(): TimeRange {
    if (this.useDeckGL) {
      return this.deckGLMap?.getTimeRange() ?? '7d';
    }
    return this.svgMap?.getTimeRange() ?? '7d';
  }

  public setLayers(layers: MapLayers): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setLayers(layers);
    } else {
      this.svgMap?.setLayers(layers);
    }
  }

  public getState(): MapContainerState {
    if (this.useDeckGL) {
      const state = this.deckGLMap?.getState();
      return state ? { ...state, view: state.view as MapView } : this.initialState;
    }
    return this.svgMap?.getState() ?? this.initialState;
  }

  // Data setters
  public setEarthquakes(earthquakes: Earthquake[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setEarthquakes(earthquakes);
    } else {
      this.svgMap?.setEarthquakes(earthquakes);
    }
  }

  public setWeatherAlerts(alerts: WeatherAlert[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setWeatherAlerts(alerts);
    } else {
      this.svgMap?.setWeatherAlerts(alerts);
    }
  }

  public setOutages(outages: InternetOutage[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setOutages(outages);
    } else {
      this.svgMap?.setOutages(outages);
    }
  }

  public setAisData(disruptions: AisDisruptionEvent[], density: AisDensityZone[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setAisData(disruptions, density);
    } else {
      this.svgMap?.setAisData(disruptions, density);
    }
  }

  public setCableActivity(advisories: CableAdvisory[], repairShips: RepairShip[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setCableActivity(advisories, repairShips);
    } else {
      this.svgMap?.setCableActivity(advisories, repairShips);
    }
  }

  public setProtests(events: SocialUnrestEvent[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setProtests(events);
    } else {
      this.svgMap?.setProtests(events);
    }
  }

  public setFlightDelays(delays: AirportDelayAlert[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setFlightDelays(delays);
    } else {
      this.svgMap?.setFlightDelays(delays);
    }
  }

  public setMilitaryFlights(flights: MilitaryFlight[], clusters: MilitaryFlightCluster[] = []): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setMilitaryFlights(flights, clusters);
    } else {
      this.svgMap?.setMilitaryFlights(flights, clusters);
    }
  }

  public setMilitaryVessels(vessels: MilitaryVessel[], clusters: MilitaryVesselCluster[] = []): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setMilitaryVessels(vessels, clusters);
    } else {
      this.svgMap?.setMilitaryVessels(vessels, clusters);
    }
  }

  public setNaturalEvents(events: NaturalEvent[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setNaturalEvents(events);
    } else {
      this.svgMap?.setNaturalEvents(events);
    }
  }

  public setFires(fires: Array<{ lat: number; lon: number; brightness: number; frp: number; confidence: number; region: string; acq_date: string; daynight: string }>): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setFires(fires);
    } else {
      this.svgMap?.setFires(fires);
    }
  }

  public setTechEvents(events: TechEventMarker[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setTechEvents(events);
    } else {
      this.svgMap?.setTechEvents(events);
    }
  }

  public setUcdpEvents(events: UcdpGeoEvent[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setUcdpEvents(events);
    }
  }

  public setDisplacementFlows(flows: DisplacementFlow[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setDisplacementFlows(flows);
    }
  }

  public setClimateAnomalies(anomalies: ClimateAnomaly[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setClimateAnomalies(anomalies);
    }
  }

  public setCyberThreats(threats: CyberThreat[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setCyberThreats(threats);
    } else {
      this.svgMap?.setCyberThreats(threats);
    }
  }

  public setNewsLocations(data: Array<{ lat: number; lon: number; title: string; threatLevel: string; timestamp?: Date }>): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setNewsLocations(data);
    } else {
      this.svgMap?.setNewsLocations(data);
    }
  }

  public updateHotspotActivity(news: NewsItem[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.updateHotspotActivity(news);
    } else {
      this.svgMap?.updateHotspotActivity(news);
    }
  }

  public updateMilitaryForEscalation(flights: MilitaryFlight[], vessels: MilitaryVessel[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.updateMilitaryForEscalation(flights, vessels);
    } else {
      this.svgMap?.updateMilitaryForEscalation(flights, vessels);
    }
  }

  public getHotspotDynamicScore(hotspotId: string) {
    if (this.useDeckGL) {
      return this.deckGLMap?.getHotspotDynamicScore(hotspotId);
    }
    return this.svgMap?.getHotspotDynamicScore(hotspotId);
  }

  public highlightAssets(assets: RelatedAsset[] | null): void {
    if (this.useDeckGL) {
      this.deckGLMap?.highlightAssets(assets);
    } else {
      this.svgMap?.highlightAssets(assets);
    }
  }

  // Callback setters - MapComponent uses different names
  public onHotspotClicked(callback: (hotspot: Hotspot) => void): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setOnHotspotClick(callback);
    } else {
      this.svgMap?.onHotspotClicked(callback);
    }
  }

  public onTimeRangeChanged(callback: (range: TimeRange) => void): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setOnTimeRangeChange(callback);
    } else {
      this.svgMap?.onTimeRangeChanged(callback);
    }
  }

  public setOnLayerChange(callback: (layer: keyof MapLayers, enabled: boolean) => void): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setOnLayerChange(callback);
    } else {
      this.svgMap?.setOnLayerChange(callback);
    }
  }

  public onStateChanged(callback: (state: MapContainerState) => void): void {
    if (this.useDeckGL) {
      if (this.nativeGlobeFlag) {
        // The combined handler (registered in init) owns DeckGLMap's state change and
        // chains to this app callback, so native activation is never bypassed.
        this.appStateCb = callback;
      } else {
        this.deckGLMap?.setOnStateChange((state) => {
          callback({ ...state, view: state.view as MapView });
        });
      }
    } else {
      this.svgMap?.onStateChanged(callback);
    }
  }

  public getHotspotLevels(): Record<string, string> {
    if (this.useDeckGL) {
      return this.deckGLMap?.getHotspotLevels() ?? {};
    }
    return this.svgMap?.getHotspotLevels() ?? {};
  }

  public setHotspotLevels(levels: Record<string, string>): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setHotspotLevels(levels);
    } else {
      this.svgMap?.setHotspotLevels(levels);
    }
  }

  public initEscalationGetters(): void {
    if (this.useDeckGL) {
      this.deckGLMap?.initEscalationGetters();
    } else {
      this.svgMap?.initEscalationGetters();
    }
  }

  // UI visibility methods
  public hideLayerToggle(layer: keyof MapLayers): void {
    if (this.useDeckGL) {
      this.deckGLMap?.hideLayerToggle(layer);
    } else {
      this.svgMap?.hideLayerToggle(layer);
    }
  }

  public setLayerLoading(layer: keyof MapLayers, loading: boolean): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setLayerLoading(layer, loading);
    } else {
      this.svgMap?.setLayerLoading(layer, loading);
    }
  }

  public setLayerReady(layer: keyof MapLayers, hasData: boolean): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setLayerReady(layer, hasData);
    } else {
      this.svgMap?.setLayerReady(layer, hasData);
    }
  }

  public flashAssets(assetType: AssetType, ids: string[]): void {
    if (this.useDeckGL) {
      this.deckGLMap?.flashAssets(assetType, ids);
    }
    // SVG map doesn't have flashAssets - only supported in deck.gl mode
  }

  // Layer enable/disable and trigger methods
  public enableLayer(layer: keyof MapLayers): void {
    if (this.useDeckGL) {
      this.deckGLMap?.enableLayer(layer);
    } else {
      this.svgMap?.enableLayer(layer);
    }
  }

  public triggerHotspotClick(id: string): void {
    if (this.useDeckGL) {
      this.deckGLMap?.triggerHotspotClick(id);
    } else {
      this.svgMap?.triggerHotspotClick(id);
    }
  }

  public triggerConflictClick(id: string): void {
    if (this.useDeckGL) {
      this.deckGLMap?.triggerConflictClick(id);
    } else {
      this.svgMap?.triggerConflictClick(id);
    }
  }

  public triggerBaseClick(id: string): void {
    if (this.useDeckGL) {
      this.deckGLMap?.triggerBaseClick(id);
    } else {
      this.svgMap?.triggerBaseClick(id);
    }
  }

  public triggerPipelineClick(id: string): void {
    if (this.useDeckGL) {
      this.deckGLMap?.triggerPipelineClick(id);
    } else {
      this.svgMap?.triggerPipelineClick(id);
    }
  }

  public triggerCableClick(id: string): void {
    if (this.useDeckGL) {
      this.deckGLMap?.triggerCableClick(id);
    } else {
      this.svgMap?.triggerCableClick(id);
    }
  }

  public triggerDatacenterClick(id: string): void {
    if (this.useDeckGL) {
      this.deckGLMap?.triggerDatacenterClick(id);
    } else {
      this.svgMap?.triggerDatacenterClick(id);
    }
  }

  public triggerNuclearClick(id: string): void {
    if (this.useDeckGL) {
      this.deckGLMap?.triggerNuclearClick(id);
    } else {
      this.svgMap?.triggerNuclearClick(id);
    }
  }

  public triggerIrradiatorClick(id: string): void {
    if (this.useDeckGL) {
      this.deckGLMap?.triggerIrradiatorClick(id);
    } else {
      this.svgMap?.triggerIrradiatorClick(id);
    }
  }

  public flashLocation(lat: number, lon: number, durationMs?: number): void {
    if (this.useDeckGL) {
      this.deckGLMap?.flashLocation(lat, lon, durationMs);
    } else {
      this.svgMap?.flashLocation(lat, lon, durationMs);
    }
  }

  // Country click + highlight (deck.gl only)
  public onCountryClicked(callback: (country: CountryClickPayload) => void): void {
    if (this.useDeckGL) {
      this.countryClickCb = callback;
      this.deckGLMap?.setOnCountryClick(callback);
      this.globeNative?.setOnCountryClick(callback);
    }
  }

  public highlightCountry(code: string): void {
    if (this.useDeckGL) {
      this.deckGLMap?.highlightCountry(code);
    }
  }

  public clearCountryHighlight(): void {
    if (this.useDeckGL) {
      this.deckGLMap?.clearCountryHighlight();
    }
  }

  public setRenderPaused(paused: boolean): void {
    if (this.useDeckGL) {
      this.deckGLMap?.setRenderPaused(paused);
    }
  }

  // Utility methods
  public isDeckGLMode(): boolean {
    return this.useDeckGL;
  }

  public isMobileMode(): boolean {
    return this.isMobile;
  }

  public destroy(): void {
    if (this.useDeckGL) {
      this.globeNative?.destroy();
      this.globeNative = null;
      this.deckGLMap?.destroy();
    } else {
      this.svgMap?.destroy();
    }
  }
}
