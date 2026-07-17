import './styles/try-hanzo.css';
import type { NewsItem, Monitor, PanelConfig, MapLayers, RelatedAsset, InternetOutage, SocialUnrestEvent, MilitaryFlight, MilitaryVessel, MilitaryFlightCluster, MilitaryVesselCluster, CyberThreat } from '@/types';
import {
  FEEDS,
  INTEL_SOURCES,
  SECTORS,
  MARKET_SYMBOLS,
  REFRESH_INTERVALS,
  DEFAULT_PANELS,
  DEFAULT_MAP_LAYERS,
  MOBILE_DEFAULT_MAP_LAYERS,
  STORAGE_KEYS,
  SITE_VARIANT,
  isHanzoBrandHost,
  MONITOR_COLORS,
} from '@/config';
import { BETA_MODE } from '@/config/beta';
import { fetchCategoryFeeds, getFeedFailures, fetchMultipleStocks, fetchCrypto, fetchPredictions, fetchEarthquakes, fetchWeatherAlerts, fetchFredData, fetchInternetOutages, isOutagesConfigured, fetchAisSignals, initAisStream, getAisStatus, disconnectAisStream, isAisConfigured, fetchCableActivity, fetchProtestEvents, getProtestStatus, fetchFlightDelays, fetchMilitaryFlights, fetchMilitaryVessels, initMilitaryVesselStream, isMilitaryVesselTrackingConfigured, initDB, updateBaseline, calculateDeviation, addToSignalHistory, saveSnapshot, cleanOldSnapshots, analysisWorker, fetchPizzIntStatus, fetchGdeltTensions, fetchNaturalEvents, fetchRecentAwards, fetchOilAnalytics, fetchChinaMacro, fetchCyberThreats, drainTrendingSignals } from '@/services';
import { fetchCountryMarkets } from '@/services/polymarket';
import { mlWorker } from '@/services/ml-worker';
import { attachPanelDrag, attachPanelResize, attachPanelColResize } from '@/services/panel-drag';
import { installPanelContextMenu, registerSummarizePort } from '@/services/panel-menu';
import { loadMonitors as loadUserMonitors, saveMonitors as saveUserMonitors, fetchMonitorMatches } from '@/services/monitors';
import { ImmersiveController, type ImmersiveBackground, type ImmersiveState } from '@/services/immersive';
import { loadPanelSpans, savePanelSpan, currentSpan, setSpanClass } from '@/components/Panel';
import { clusterNewsHybrid } from '@/services/clustering';
import { ingestProtests, ingestFlights, ingestVessels, ingestEarthquakes, detectGeoConvergence, geoConvergenceToSignal } from '@/services/geo-convergence';
import { signalAggregator } from '@/services/signal-aggregator';
import { updateAndCheck } from '@/services/temporal-baseline';
import { fetchAllFires, flattenFires, computeRegionStats } from '@/services/firms-satellite';
import { SatelliteFiresPanel } from '@/components/SatelliteFiresPanel';
import { WatchQueuePanel } from '@/components/WatchQueuePanel';
import { watchQueue } from '@/services/watch-queue';
import { searchYouTube } from '@/services/youtube-search';
import { analyzeFlightsForSurge, surgeAlertToSignal, detectForeignMilitaryPresence, foreignPresenceToSignal, type TheaterPostureSummary } from '@/services/military-surge';
import { fetchCachedTheaterPosture } from '@/services/cached-theater-posture';
import { ingestProtestsForCII, ingestMilitaryForCII, ingestNewsForCII, ingestOutagesForCII, ingestConflictsForCII, ingestUcdpForCII, ingestHapiForCII, ingestDisplacementForCII, ingestClimateForCII, startLearning, isInLearningMode, calculateCII, getCountryData, TIER1_COUNTRIES } from '@/services/country-instability';
import { dataFreshness, type DataSourceId } from '@/services/data-freshness';
import { focusInvestmentOnMap } from '@/services/investments-focus';
import { fetchConflictEvents } from '@/services/conflicts';
import { fetchUcdpClassifications } from '@/services/ucdp';
import { fetchHapiSummary } from '@/services/hapi';
import { fetchUcdpEvents, deduplicateAgainstAcled } from '@/services/ucdp-events';
import { fetchUnhcrPopulation } from '@/services/unhcr';
import { fetchClimateAnomalies } from '@/services/climate';
import { enrichEventsWithExposure } from '@/services/population-exposure';
import { buildMapUrl, debounce, loadFromStorage, parseMapUrlState, saveToStorage, ExportPanel, getCircuitBreakerCooldownInfo, isMobileDevice, setTheme, getCurrentTheme, generateId, getCSSColor } from '@/utils';
import { reverseGeocode } from '@/utils/reverse-geocode';
import { CountryBriefPage } from '@/components/CountryBriefPage';
import { CountryTimeline, type TimelineEvent } from '@/components/CountryTimeline';
import { escapeHtml } from '@/utils/sanitize';
import type { ParsedMapUrlState } from '@/utils';
import {
  MapContainer,
  type MapView,
  type MapProjectionMode,
  type TimeRange,
  NewsPanel,
  MarketPanel,
  HeatmapPanel,
  CommoditiesPanel,
  FxPanel,
  YieldsPanel,
  CryptoPanel,
  PredictionPanel,
  MonitorPanel,
  Panel,
  SignalModal,
  PlaybackControl,
  StatusPanel,
  EconomicPanel,
  SearchModal,
  PizzIntIndicator,
  GdeltIntelPanel,
  LiveNewsPanel,
  LiveWebcamsPanel,
  CIIPanel,
  CascadePanel,
  StrategicRiskPanel,
  StrategicPosturePanel,
  IntelligenceGapBadge,
  TechEventsPanel,
  ServiceStatusPanel,
  RuntimeConfigPanel,
  InsightsPanel,
  TechReadinessPanel,
  MacroSignalsPanel,
  ETFFlowsPanel,
  StablecoinPanel,
  SentimentPanel,
  TraderDeskPanel,
  UcdpEventsPanel,
  DisplacementPanel,
  ClimateAnomalyPanel,
  PopulationExposurePanel,
  InvestmentsPanel,
  LanguageSelector,
  AiAnalystPanel,
  AiAnalystDock,
  CustomFeedPanel,
  CloudOverviewPanel,
  TrafficGlobePanel,
  ModelImprovementPanel,
  EnsoTrainingPanel,
  ModelUsagePanel,
  FleetPanel,
  MyUsagePanel,
  LiveActivityPanel,
  CloudServicesPanel,
  CloudFleetPanel,
  HanzoStatusPanel,
  CloudAnalyticsPanel,
  LlmUsagePanel,
  BlockchainPanel,
  AiComputePanel,
  EnsoFlywheelPanel,
} from '@/components';
import { isAdmin, isAuthenticated, listOrgs, setActiveOrg } from '@/services/iam';
import type { SearchResult } from '@/components/SearchModal';
import { AccountMenu } from '@/components/AccountMenu';
import type { AnalystHost } from '@/services/analyst-actions';
import { collectStoryData } from '@/services/story-data';
import { renderStoryToCanvas } from '@/services/story-renderer';
import { openStoryModal } from '@/components/StoryModal';
import { INTEL_HOTSPOTS, CONFLICT_ZONES, MILITARY_BASES, UNDERSEA_CABLES, NUCLEAR_FACILITIES } from '@/config/geo';
import { PIPELINES } from '@/config/pipelines';
import { AI_DATA_CENTERS } from '@/config/ai-datacenters';
import { GAMMA_IRRADIATORS } from '@/config/irradiators';
import { TECH_COMPANIES } from '@/config/tech-companies';
import { AI_RESEARCH_LABS } from '@/config/ai-research-labs';
import { STARTUP_ECOSYSTEMS } from '@/config/startup-ecosystems';
import { TECH_HQS, ACCELERATORS } from '@/config/tech-geo';
import { STOCK_EXCHANGES, FINANCIAL_CENTERS, CENTRAL_BANKS, COMMODITY_HUBS } from '@/config/finance-geo';
import { isDesktopRuntime, canConfigureKeys } from '@/services/runtime';
import { isFeatureAvailable } from '@/services/runtime-config';
import { getCountryAtCoordinates, hasCountryGeometry, isCoordinateInCountry, preloadCountryGeometry } from '@/services/country-geometry';
import { initI18n, t, changeLanguage, getCurrentLanguage, LANGUAGES } from '@/services/i18n';

import type { PredictionMarket, MarketData, ClusteredEvent } from '@/types';

type IntlDisplayNamesCtor = new (
  locales: string | string[],
  options: { type: 'region' }
) => { of: (code: string) => string | undefined };

const CYBER_LAYER_ENABLED = import.meta.env.VITE_ENABLE_CYBER_LAYER === 'true';

export interface CountryBriefSignals {
  protests: number;
  militaryFlights: number;
  militaryVessels: number;
  outages: number;
  earthquakes: number;
  displacementOutflow: number;
  climateStress: number;
  conflictEvents: number;
  isTier1: boolean;
}

export class App {
  private container: HTMLElement;
  private readonly PANEL_ORDER_KEY = 'panel-order';
  private readonly MAP_MODE_STORAGE_KEY = 'hanzo-world-map-mode';
  private map: MapContainer | null = null;
  private mapResizeObserver: ResizeObserver | null = null;
  private immersive: ImmersiveController | null = null;
  private panels: Record<string, Panel> = {};
  private newsPanels: Record<string, NewsPanel> = {};
  private allNews: NewsItem[] = [];
  private newsByCategory: Record<string, NewsItem[]> = {};
  private currentTimeRange: TimeRange = '7d';
  private monitors: Monitor[];
  private panelSettings: Record<string, PanelConfig>;
  private mapLayers: MapLayers;
  private signalModal: SignalModal | null = null;
  private playbackControl: PlaybackControl | null = null;
  private statusPanel: StatusPanel | null = null;
  private exportPanel: ExportPanel | null = null;
  private languageSelector: LanguageSelector | null = null;
  private accountMenu: AccountMenu | null = null;
  private analystDock: AiAnalystDock | null = null;
  // Best-effort sync snapshot of the user's orgs, primed async when the analyst
  // host is built — grounds the analyst's org context + validates switch_org.
  private analystOrgs: Array<{ id: string; name: string }> = [];
  private adminCloudMounted = false;
  private searchModal: SearchModal | null = null;
  private pizzintIndicator: PizzIntIndicator | null = null;
  private latestPredictions: PredictionMarket[] = [];
  private latestMarkets: MarketData[] = [];
  private latestClusters: ClusteredEvent[] = [];
  private readonly applyTimeRangeFilterToNewsPanelsDebounced = debounce(() => {
    this.applyTimeRangeFilterToNewsPanels();
  }, 120);
  private isPlaybackMode = false;
  private initialUrlState: ParsedMapUrlState | null = null;
  private inFlight: Set<string> = new Set();
  private isMobile: boolean;
  private seenGeoAlerts: Set<string> = new Set();
  private snapshotIntervalId: ReturnType<typeof setInterval> | null = null;
  private refreshTimeoutIds: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private isDestroyed = false;
  private boundKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private boundFullscreenHandler: (() => void) | null = null;
  private boundResizeHandler: (() => void) | null = null;
  private boundVisibilityHandler: (() => void) | null = null;
  private idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private boundIdleResetHandler: (() => void) | null = null;
  private isIdle = false;
  private readonly IDLE_PAUSE_MS = 2 * 60 * 1000; // 2 minutes - pause animations when idle
  private disabledSources: Set<string> = new Set();
  private customFeeds: Array<{ key: string; name: string; url: string }> = [];
  private mapFlashCache: Map<string, number> = new Map();
  private readonly MAP_FLASH_COOLDOWN_MS = 10 * 60 * 1000;
  private initialLoadComplete = false;
  private criticalBannerEl: HTMLElement | null = null;
  private countryBriefPage: CountryBriefPage | null = null;
  private countryTimeline: CountryTimeline | null = null;
  private findingsBadge: IntelligenceGapBadge | null = null;
  private pendingDeepLinkCountry: string | null = null;
  private briefRequestToken = 0;
  private readonly isDesktopApp = isDesktopRuntime();

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`Container ${containerId} not found`);
    this.container = el;

    this.isMobile = isMobileDevice();
    this.monitors = loadFromStorage<Monitor[]>(STORAGE_KEYS.monitors, []);

    // Use mobile-specific defaults on first load (no saved layers)
    const defaultLayers = this.isMobile ? MOBILE_DEFAULT_MAP_LAYERS : DEFAULT_MAP_LAYERS;

    // Check if variant changed - reset all settings to variant defaults
    const storedVariant = localStorage.getItem('worldmonitor-variant');
    const currentVariant = SITE_VARIANT;
    console.log(`[App] Variant check: stored="${storedVariant}", current="${currentVariant}"`);
    if (storedVariant !== currentVariant) {
      // Variant changed - use defaults for new variant, clear old settings
      console.log('[App] Variant changed - resetting to defaults');
      localStorage.setItem('worldmonitor-variant', currentVariant);
      localStorage.removeItem(STORAGE_KEYS.mapLayers);
      localStorage.removeItem(STORAGE_KEYS.panels);
      localStorage.removeItem(this.PANEL_ORDER_KEY);
      this.mapLayers = { ...defaultLayers };
      this.panelSettings = { ...DEFAULT_PANELS };
    } else {
      this.mapLayers = loadFromStorage<MapLayers>(STORAGE_KEYS.mapLayers, defaultLayers);
      this.panelSettings = loadFromStorage<Record<string, PanelConfig>>(
        STORAGE_KEYS.panels,
        DEFAULT_PANELS
      );
      console.log('[App] Loaded panel settings from storage:', Object.entries(this.panelSettings).filter(([_, v]) => !v.enabled).map(([k]) => k));

      // One-time migration: reorder panels for existing users (v1.9 panel layout)
      // Puts live-news, insights, strategic-posture, cii, strategic-risk at the top
      const PANEL_ORDER_MIGRATION_KEY = 'worldmonitor-panel-order-v1.9';
      if (!localStorage.getItem(PANEL_ORDER_MIGRATION_KEY)) {
        const savedOrder = localStorage.getItem(this.PANEL_ORDER_KEY);
        if (savedOrder) {
          try {
            const order: string[] = JSON.parse(savedOrder);
            // Priority panels that should be at the top (after live-news which is handled separately)
            const priorityPanels = ['insights', 'strategic-posture', 'cii', 'strategic-risk'];
            // Remove priority panels from their current positions
            const filtered = order.filter(k => !priorityPanels.includes(k) && k !== 'live-news');
            // Find live-news position (should be first, but just in case)
            const liveNewsIdx = order.indexOf('live-news');
            // Build new order: live-news first, then priority panels, then rest
            const newOrder = liveNewsIdx !== -1 ? ['live-news'] : [];
            newOrder.push(...priorityPanels.filter(p => order.includes(p)));
            newOrder.push(...filtered);
            localStorage.setItem(this.PANEL_ORDER_KEY, JSON.stringify(newOrder));
            console.log('[App] Migrated panel order to v1.8 layout');
          } catch {
            // Invalid saved order, will use defaults
          }
        }
        localStorage.setItem(PANEL_ORDER_MIGRATION_KEY, 'done');
      }

      // Tech variant migration: move insights to top (after live-news)
      if (currentVariant === 'tech') {
        const TECH_INSIGHTS_MIGRATION_KEY = 'worldmonitor-tech-insights-top-v1';
        if (!localStorage.getItem(TECH_INSIGHTS_MIGRATION_KEY)) {
          const savedOrder = localStorage.getItem(this.PANEL_ORDER_KEY);
          if (savedOrder) {
            try {
              const order: string[] = JSON.parse(savedOrder);
              // Remove insights from current position
              const filtered = order.filter(k => k !== 'insights' && k !== 'live-news');
              // Build new order: live-news, insights, then rest
              const newOrder: string[] = [];
              if (order.includes('live-news')) newOrder.push('live-news');
              if (order.includes('insights')) newOrder.push('insights');
              newOrder.push(...filtered);
              localStorage.setItem(this.PANEL_ORDER_KEY, JSON.stringify(newOrder));
              console.log('[App] Tech variant: Migrated insights panel to top');
            } catch {
              // Invalid saved order, will use defaults
            }
          }
          localStorage.setItem(TECH_INSIGHTS_MIGRATION_KEY, 'done');
        }
      }
    }

    // AI analyst ships enabled for everyone — returning users won't have it in
    // their saved panel settings, so ensure it's present + toggleable.
    if (!this.panelSettings['ai-analyst']) {
      this.panelSettings['ai-analyst'] = { name: 'AI analyst', enabled: true, priority: 2 };
    }

    // Desktop key management panel must always remain accessible in Tauri.
    if (this.isDesktopApp) {
      const runtimePanel = this.panelSettings['runtime-config'] ?? {
        name: 'Desktop Configuration',
        enabled: true,
        priority: 2,
      };
      runtimePanel.enabled = true;
      this.panelSettings['runtime-config'] = runtimePanel;
      saveToStorage(STORAGE_KEYS.panels, this.panelSettings);
    }

    this.initialUrlState = parseMapUrlState(window.location.search, this.mapLayers);
    if (this.initialUrlState.layers) {
      // For tech/AI variants, filter out geopolitical layers from URL
      if (currentVariant === 'tech' || currentVariant === 'ai') {
        const geoLayers: (keyof MapLayers)[] = ['conflicts', 'bases', 'hotspots', 'nuclear', 'irradiators', 'sanctions', 'military', 'protests', 'pipelines', 'waterways', 'ais', 'flights', 'spaceports', 'minerals'];
        const urlLayers = this.initialUrlState.layers;
        geoLayers.forEach(layer => {
          urlLayers[layer] = false;
        });
      }
      this.mapLayers = this.initialUrlState.layers;
    }
    if (!CYBER_LAYER_ENABLED) {
      this.mapLayers.cyberThreats = false;
    }
    this.disabledSources = new Set(loadFromStorage<string[]>(STORAGE_KEYS.disabledFeeds, []));
  }

  public async init(): Promise<void> {
    await initDB();
    await initI18n();

    // Initialize ML worker (desktop only - automatically disabled on mobile)
    await mlWorker.init();

    // Check AIS configuration before init
    if (!isAisConfigured()) {
      this.mapLayers.ais = false;
    } else if (this.mapLayers.ais) {
      initAisStream();
    }

    this.renderLayout();
    this.startHeaderClock();
    this.signalModal = new SignalModal();
    this.signalModal.setLocationClickHandler((lat, lon) => {
      this.map?.setCenter(lat, lon, 4);
    });
    if (!this.isMobile) {
      this.findingsBadge = new IntelligenceGapBadge();
      this.findingsBadge.setOnSignalClick((signal) => {
        if (this.countryBriefPage?.isVisible()) return;
        this.signalModal?.showSignal(signal);
      });
      this.findingsBadge.setOnAlertClick((alert) => {
        if (this.countryBriefPage?.isVisible()) return;
        this.signalModal?.showAlert(alert);
      });
    }
    this.setupMobileWarning();
    this.setupPlaybackControl();
    this.setupStatusPanel();
    this.setupPizzIntIndicator();
    this.setupExportPanel();
    this.setupLanguageSelector();
    this.setupTryHanzoMenu();
    this.setupAccountMenu();
    this.setupSearchModal();
    this.setupMapLayerHandlers();
    this.setupCountryIntel();
    this.setupEventListeners();
    this.setupImmersive();
    // Capture ?country= BEFORE URL sync overwrites it
    const initState = parseMapUrlState(window.location.search, this.mapLayers);
    this.pendingDeepLinkCountry = initState.country ?? null;
    this.setupUrlStateSync();
    this.syncDataFreshnessWithLayers();
    await preloadCountryGeometry();
    await this.loadAllData();

    // Start CII learning mode after first data load
    startLearning();

    // Hide unconfigured layers after first data load
    if (!isAisConfigured()) {
      this.map?.hideLayerToggle('ais');
    }
    if (isOutagesConfigured() === false) {
      this.map?.hideLayerToggle('outages');
    }
    if (!CYBER_LAYER_ENABLED) {
      this.map?.hideLayerToggle('cyberThreats');
    }

    this.setupRefreshIntervals();
    this.setupSnapshotSaving();
    cleanOldSnapshots().catch((e) => console.warn('[Storage] Snapshot cleanup failed:', e));

    // Handle deep links for story sharing
    this.handleDeepLinks();

    if (this.isDesktopApp) {
      setTimeout(() => this.checkForUpdate(), 5000);
    }
  }

  // Immersive layout: map (or live video) as a fixed full-viewport background with
  // panels floating above. One controller owns the state; App only wires the header
  // chrome to it and reflects the resulting state back onto the buttons.
  private setupImmersive(): void {
    if (this.isMobile) return;
    this.immersive = new ImmersiveController({
      getBackgroundHost: () => document.getElementById('panelsGrid'),
      onChange: (state) => {
        this.reflectImmersiveUi(state);
        // The map's box changes when it becomes / leaves the fixed background, so
        // nudge a re-render on the next frame (after CSS has settled the new size).
        requestAnimationFrame(() => this.map?.render());
      },
    });

    document.getElementById('immersiveCollapse')?.addEventListener('click', () => this.immersive?.toggleCollapsed());
    document.querySelectorAll('#immersiveBgSelect .ibg-btn').forEach((btn) => {
      btn.addEventListener('click', () =>
        this.immersive?.setBackground((btn as HTMLElement).dataset.bg as ImmersiveBackground));
    });

    // Escape leaves immersive — but never steals Escape from an open modal or search.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.immersive?.getState().enabled) return;
      if (document.querySelector('.modal-overlay.active') || this.searchModal?.isOpen()) return;
      this.immersive.setEnabled(false);
    });

    this.immersive.apply();
  }

  private reflectImmersiveUi(state: ImmersiveState): void {
    const collapse = document.getElementById('immersiveCollapse');
    collapse?.classList.toggle('active', state.collapsed);
    collapse?.setAttribute('aria-pressed', String(state.collapsed));
    document.querySelectorAll('#immersiveBgSelect .ibg-btn').forEach((btn) => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.bg === state.background);
    });
    // Keep the single mode dropdown in sync — immersive wins as the shown value,
    // otherwise it reflects the snap mode (grid/free). Covers Escape-to-exit too.
    this.syncModeSelect();
  }

  // The dock's one mode control shows the layout MODE as a 3-way choice over two
  // orthogonal states: background (normal vs immersive) and snap (grid vs free).
  //   Grid       → normal background, snap to grid
  //   Free       → normal background, free-form pixels
  //   Immersive  → map fills the viewport, panels float freestyle over it
  private syncModeSelect(): void {
    const sel = document.getElementById('dockModeSelect') as HTMLSelectElement | null;
    if (!sel) return;
    const mode = this.immersive?.getState().enabled ? 'immersive' : this.gridApi().getLayoutMode();
    if (sel.value !== mode) sel.value = mode;
  }

  // Apply a 3-way mode pick, decomplecting background from snap. Entering immersive
  // defaults the floating panels to freestyle (free snap); leaving it drops back to
  // the normal background at whatever snap the user last had.
  private setDockMode(mode: 'grid' | 'free' | 'immersive'): void {
    const grid = this.gridApi();
    if (mode === 'immersive') {
      grid.setLayoutMode('free');
      this.immersive?.setEnabled(true);
    } else {
      this.immersive?.setEnabled(false);
      grid.setLayoutMode(mode);
    }
    this.syncModeSelect();
  }

  // Bottom toolbar dock wiring. Buttons moved here from the header (Panels,
  // Sources, Copy link, Fullscreen, Immersive, region) keep their ids so their
  // existing handlers still bind; this only wires the dock-native controls:
  // Layers toggle, layout-mode, widget-size, "+ Add widget", and collapse.
  private setupDock(): void {
    // Layers: toggle the map's floating layer panel (hidden by default).
    const layersBtn = document.getElementById('dockLayersBtn');
    layersBtn?.addEventListener('click', () => {
      const open = this.map?.toggleLayerPanel() ?? false;
      layersBtn.classList.toggle('active', open);
      layersBtn.setAttribute('aria-pressed', String(open));
    });

    // Collapse the dock to a slim edge (persisted for the session).
    const collapse = document.getElementById('dockCollapse');
    const dock = document.getElementById('worldDock');
    const collapsed = localStorage.getItem('hanzo-world-dock-collapsed') === '1';
    if (collapsed) dock?.classList.add('collapsed');
    if (collapse) {
      collapse.setAttribute('aria-expanded', String(!collapsed));
      collapse.addEventListener('click', () => {
        const isCollapsed = dock?.classList.toggle('collapsed') ?? false;
        collapse.setAttribute('aria-expanded', String(!isCollapsed));
        try { localStorage.setItem('hanzo-world-dock-collapsed', isCollapsed ? '1' : '0'); } catch { /* ignore */ }
        requestAnimationFrame(() => this.map?.render());
      });
    }

    // Layout mode (grid / free / immersive) + widget size. The one dropdown drives
    // the layout engine (window.worldGrid) for snap and the immersive controller for
    // the background — see setDockMode. It stays in sync via syncModeSelect (also on
    // Escape-to-exit immersive and programmatic grid-config changes).
    const grid = this.gridApi();
    const modeSelect = document.getElementById('dockModeSelect') as HTMLSelectElement | null;
    if (modeSelect) {
      modeSelect.addEventListener('change', () =>
        this.setDockMode(modeSelect.value as 'grid' | 'free' | 'immersive'));
      // grid-config broadcasts programmatic snap changes (analyst / reset); reflect them.
      document.addEventListener('layout-mode-change', () => this.syncModeSelect());
      this.syncModeSelect();
    }
    const sizeInput = document.getElementById('dockGridSize') as HTMLInputElement | null;
    if (sizeInput) {
      sizeInput.value = String(grid.getCellSize());
      sizeInput.addEventListener('input', () => grid.setCellSize(parseInt(sizeInput.value, 10)));
    }

    // "+ Add widget" — a searchable palette over the panel registry.
    document.getElementById('dockAddWidget')?.addEventListener('click', () => this.openAddWidget());
    document.getElementById('addWidgetClose')?.addEventListener('click', () => this.closeAddWidget());
    document.getElementById('addWidgetModal')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeAddWidget();
    });
    const search = document.getElementById('addWidgetSearch') as HTMLInputElement | null;
    search?.addEventListener('input', () => this.renderAddWidgetGrid(search.value));
  }

  // Layout-config adapter. Prefers the world-layoutengine API exposed at
  // window.worldGrid; falls back to a minimal self-contained effect (a body data
  // attribute for mode, a CSS var for the grid column floor) so the dock controls
  // work standalone. See src/services/grid-config.ts (world-layoutengine).
  private gridApi(): {
    setLayoutMode: (m: 'grid' | 'free') => void;
    getLayoutMode: () => 'grid' | 'free';
    setCellSize: (px: number) => void;
    getCellSize: () => number;
  } {
    const g = (window as unknown as { worldGrid?: Partial<ReturnType<App['gridApi']>> }).worldGrid;
    return {
      setLayoutMode: (m) => {
        if (g?.setLayoutMode) { g.setLayoutMode(m); return; }
        document.body.dataset.layoutMode = m;
      },
      getLayoutMode: () => {
        if (g?.getLayoutMode) return g.getLayoutMode();
        return document.body.dataset.layoutMode === 'free' ? 'free' : 'grid';
      },
      setCellSize: (px) => {
        const v = Math.max(140, Math.min(360, px));
        if (g?.setCellSize) { g.setCellSize(v); return; }
        document.documentElement.style.setProperty('--panel-col-min', `${v}px`);
        try { localStorage.setItem('hanzo-world-grid-size', String(v)); } catch { /* ignore */ }
      },
      getCellSize: () => {
        if (g?.getCellSize) return g.getCellSize();
        const saved = parseInt(localStorage.getItem('hanzo-world-grid-size') ?? '', 10);
        if (Number.isFinite(saved)) {
          document.documentElement.style.setProperty('--panel-col-min', `${saved}px`);
          return saved;
        }
        return 160;
      },
    };
  }

  // Searchable widget palette: lists the panel registry (same source the Panels
  // menu toggles); clicking one shows it via the one show/hide path. Works in both
  // grid and immersive layouts (immersive adds it to the floating column).
  private openAddWidget(): void {
    const modal = document.getElementById('addWidgetModal');
    if (!modal) return;
    modal.classList.add('active');
    const search = document.getElementById('addWidgetSearch') as HTMLInputElement | null;
    if (search) { search.value = ''; }
    this.renderAddWidgetGrid('');
    setTimeout(() => search?.focus(), 30);
  }

  private closeAddWidget(): void {
    document.getElementById('addWidgetModal')?.classList.remove('active');
  }

  private renderAddWidgetGrid(filter: string): void {
    const grid = document.getElementById('addWidgetGrid');
    if (!grid) return;
    const q = filter.trim().toLowerCase();
    const entries = Object.entries(this.panelSettings)
      .filter(([key]) => key !== 'map')
      .filter(([key, cfg]) => !q || cfg.name.toLowerCase().includes(q) || key.toLowerCase().includes(q))
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
    grid.innerHTML = entries.length === 0
      ? `<div class="add-widget-empty">No widgets match “${filter}”.</div>`
      : entries.map(([key, cfg]) => `
        <button class="add-widget-item ${cfg.enabled ? 'is-on' : ''}" data-key="${key}">
          <span class="add-widget-name">${cfg.name}</span>
          <span class="add-widget-state">${cfg.enabled ? 'Shown' : 'Add'}</span>
        </button>`).join('');
    grid.querySelectorAll<HTMLButtonElement>('.add-widget-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key!;
        this.setPanelEnabled(key, true);
        this.closeAddWidget();
        const el = this.panels[key]?.getElement();
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.classList.add('flash-new');
        setTimeout(() => el?.classList.remove('flash-new'), 1200);
      });
    });
  }

  private handleDeepLinks(): void {
    const url = new URL(window.location.href);

    // Check for story deep link: /story?c=UA&t=ciianalysis
    if (url.pathname === '/story' || url.searchParams.has('c')) {
      const countryCode = url.searchParams.get('c');
      if (countryCode) {
        const countryNames: Record<string, string> = {
          UA: 'Ukraine', RU: 'Russia', CN: 'China', US: 'United States',
          IR: 'Iran', IL: 'Israel', TW: 'Taiwan', KP: 'North Korea',
          SA: 'Saudi Arabia', TR: 'Turkey', PL: 'Poland', DE: 'Germany',
          FR: 'France', GB: 'United Kingdom', IN: 'India', PK: 'Pakistan',
          SY: 'Syria', YE: 'Yemen', MM: 'Myanmar', VE: 'Venezuela',
        };
        const countryName = countryNames[countryCode.toUpperCase()] || countryCode;

        // Wait for data to load, then open story
        const checkAndOpen = () => {
          if (dataFreshness.hasSufficientData() && this.latestClusters.length > 0) {
            this.openCountryStory(countryCode.toUpperCase(), countryName);
          } else {
            setTimeout(checkAndOpen, 500);
          }
        };
        setTimeout(checkAndOpen, 2000);

        // Update URL without reload
        history.replaceState(null, '', '/');
        return;
      }
    }

    // Check for country brief deep link: ?country=UA (captured before URL sync)
    const deepLinkCountry = this.pendingDeepLinkCountry;
    this.pendingDeepLinkCountry = null;
    if (deepLinkCountry) {
      const cName = App.resolveCountryName(deepLinkCountry);
      const checkAndOpenBrief = () => {
        if (dataFreshness.hasSufficientData()) {
          this.openCountryBriefByCode(deepLinkCountry, cName);
        } else {
          setTimeout(checkAndOpenBrief, 500);
        }
      };
      setTimeout(checkAndOpenBrief, 2000);
    }
  }

  private async checkForUpdate(): Promise<void> {
    // Hanzo: upstream worldmonitor.app update/download check removed.
    return;
  }

  // Hanzo: upstream worldmonitor.app update-badge + desktop-download machinery removed.

  private startHeaderClock(): void {
    const el = document.getElementById('headerClock');
    if (!el) return;
    const tick = () => {
      el.textContent = new Date().toUTCString().replace('GMT', 'UTC');
    };
    tick();
    setInterval(tick, 1000);
  }

  // The mobile-view onboarding modal is retired: the layout is now genuinely
  // responsive down to 390px (single-column stack, scrollable dock), so an
  // interstitial warning is noise. Intentionally a no-op — one way, no modal.
  private setupMobileWarning(): void {
    this.applyMapLogoFlag();
  }

  // Basemap wordmark visibility. Shown by default (ToS); ?maplogo=0 or the stored
  // preference hides it (a compact "ⓘ" attribution stays, so ToS still holds).
  private applyMapLogoFlag(): void {
    let hide = false;
    try {
      const url = new URLSearchParams(window.location.search).get('maplogo');
      if (url === '0' || url === 'off' || url === 'false') {
        hide = true;
        localStorage.setItem('hanzo-world-maplogo', '0');
      } else if (url === '1' || url === 'on' || url === 'true') {
        hide = false;
        localStorage.setItem('hanzo-world-maplogo', '1');
      } else {
        hide = localStorage.getItem('hanzo-world-maplogo') === '0';
      }
    } catch { /* private mode: default to shown */ }
    document.body.classList.toggle('hide-maplogo', hide);
  }

  private setupStatusPanel(): void {
    this.statusPanel = new StatusPanel();
    const headerLeft = this.container.querySelector('.header-left');
    if (headerLeft) {
      headerLeft.appendChild(this.statusPanel.getElement());
    }
  }

  // Hanzo: novelty indicators (pizza-index/DEFCON badge) are OFF by default —
  // this is a serious intelligence product for builders/enterprises. The data
  // route stays for API consumers; re-enable via localStorage hanzo-world-pizzint=1.
  private setupPizzIntIndicator(): void {
    if (localStorage.getItem('hanzo-world-pizzint') !== '1') return;
    if (SITE_VARIANT === 'tech' || SITE_VARIANT === 'finance' || SITE_VARIANT === 'ai' || SITE_VARIANT === 'crypto') return;

    this.pizzintIndicator = new PizzIntIndicator();
    const headerLeft = this.container.querySelector('.header-left');
    if (headerLeft) {
      headerLeft.appendChild(this.pizzintIndicator.getElement());
    }
  }

  private async loadPizzInt(): Promise<void> {
    // The PizzINT indicator is off by default and variant-gated in
    // setupPizzIntIndicator — the ONE activation decision. If it wasn't created,
    // don't fetch. This single guard covers BOTH activation sites (the initial
    // loadAllData task and the scheduled refresh interval), so a disabled/off-
    // variant PizzINT makes zero eager upstream requests.
    if (!this.pizzintIndicator) return;
    try {
      const [status, tensions] = await Promise.all([
        fetchPizzIntStatus(),
        fetchGdeltTensions()
      ]);

      // Hide indicator if no valid data (API returned default/empty)
      if (status.locationsMonitored === 0) {
        this.pizzintIndicator?.hide();
        this.statusPanel?.updateApi('PizzINT', { status: 'error' });
        return;
      }

      this.pizzintIndicator?.show();
      this.pizzintIndicator?.updateStatus(status);
      this.pizzintIndicator?.updateTensions(tensions);
      this.statusPanel?.updateApi('PizzINT', { status: 'ok' });
    } catch (error) {
      console.error('[App] PizzINT load failed:', error);
      this.pizzintIndicator?.hide();
      this.statusPanel?.updateApi('PizzINT', { status: 'error' });
    }
  }

  private setupExportPanel(): void {
    this.exportPanel = new ExportPanel(() => ({
      news: this.latestClusters.length > 0 ? this.latestClusters : this.allNews,
      markets: this.latestMarkets,
      predictions: this.latestPredictions,
      timestamp: Date.now(),
    }));

    const headerRight = this.container.querySelector('.header-right');
    if (headerRight) {
      headerRight.insertBefore(this.exportPanel.getElement(), headerRight.firstChild);
    }
  }

  private setupLanguageSelector(): void {
    this.languageSelector = new LanguageSelector();
    const headerRight = this.container.querySelector('.header-right');
    const searchBtn = this.container.querySelector('#searchBtn');

    if (headerRight && searchBtn) {
      // Insert before search button or at the beginning if search button not found
      headerRight.insertBefore(this.languageSelector.getElement(), searchBtn);
    } else if (headerRight) {
      headerRight.insertBefore(this.languageSelector.getElement(), headerRight.firstChild);
    }
  }

  // "Try Hanzo" product switcher — the hanzo.ai "Try" menu, rebuilt for the World
  // header. A white .hz-cta pill (the site's one primary-action style) that drops a
  // monochrome menu of Hanzo products; the current product (world.hanzo.ai) is
  // highlighted with a "Current" chip. Opens below the pill, closes on click-away
  // or Escape. The menu is portaled to <body> and position:fixed so it never widens
  // the header/page and is never clipped by the header's mobile overflow.
  private setupTryHanzoMenu(): void {
    const headerRight = this.container.querySelector('.header-right');
    if (!headerRight) return;

    const products: ReadonlyArray<{ name: string; desc: string; url: string; current?: boolean }> = [
      { name: 'Hanzo World', desc: 'Real-time world intelligence', url: 'https://world.hanzo.ai', current: true },
      { name: 'Hanzo Chat', desc: 'AI chat', url: 'https://hanzo.chat' },
      { name: 'Hanzo Dev', desc: 'AI coding', url: 'https://hanzo.ai/code' },
      { name: 'Hanzo App', desc: 'Build with AI', url: 'https://hanzo.app' },
      { name: 'Hanzo Cloud', desc: 'Console & infra', url: 'https://console.hanzo.ai' },
      { name: 'Hanzo Desktop', desc: 'Desktop app', url: 'https://hanzo.ai/desktop' },
    ];
    const esc = (v: string): string =>
      v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

    const wrap = document.createElement('div');
    wrap.className = 'try-hanzo';
    wrap.innerHTML = `
      <button class="hz-cta try-hanzo-trigger" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="tryHanzoMenu">
        <svg class="try-hanzo-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z"/></svg>
        <span class="try-hanzo-label">Try Hanzo</span>
        <span class="try-hanzo-caret" aria-hidden="true">▾</span>
      </button>
      <div class="try-hanzo-menu" id="tryHanzoMenu" role="menu">
        ${products
          .map(
            (p) => `<a class="try-hanzo-item${p.current ? ' is-current' : ''}" role="menuitem" href="${esc(p.url)}"${
              p.current ? ' aria-current="page"' : ' target="_blank" rel="noopener noreferrer"'
            }>
              <span class="try-hanzo-item-body">
                <span class="try-hanzo-name">${esc(p.name)}${p.current ? '<span class="try-hanzo-chip">Current</span>' : ''}</span>
                <span class="try-hanzo-desc">${esc(p.desc)}</span>
              </span>
            </a>`,
          )
          .join('')}
      </div>
    `;

    // "Try Hanzo" is an ACQUISITION CTA — it only makes sense to a visitor who
    // hasn't signed in. Once identity resolves as signed-in, it disappears (and
    // its portaled menu closes with it). Driven by the one 'hanzo:auth' signal.
    const syncCta = (authed: boolean): void => {
      wrap.hidden = authed;
      if (authed) menu.classList.remove('open');
    };

    const trigger = wrap.querySelector<HTMLButtonElement>('.try-hanzo-trigger')!;
    const menu = wrap.querySelector<HTMLElement>('.try-hanzo-menu')!;
    // Portal the menu to <body>: the mobile header sets overflow-y:hidden for its
    // horizontal tab scroller, which would clip a menu nested inside it. As a body
    // child the fixed menu is anchored to the viewport and never clipped.
    document.body.appendChild(menu);
    syncCta(isAuthenticated()); // instant paint; refined when identity resolves
    document.addEventListener('hanzo:auth', (e) => {
      const authed = !!(e as CustomEvent<{ authed: boolean }>).detail?.authed;
      syncCta(authed);
      // Identity resolved → pull this user's server-side monitors.
      if (authed) void this.syncMonitorsFromServer();
    });

    const isOpen = (): boolean => menu.classList.contains('open');
    const setOpen = (open: boolean): void => {
      if (open) {
        // Anchor the fixed menu under the trigger, right-aligned to it.
        const r = trigger.getBoundingClientRect();
        menu.style.top = `${Math.round(r.bottom + 8)}px`;
        menu.style.right = `${Math.round(Math.max(8, window.innerWidth - r.right))}px`;
      }
      menu.classList.toggle('open', open);
      wrap.classList.toggle('open', open); // caret rotation
      trigger.setAttribute('aria-expanded', String(open));
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!isOpen());
    });
    menu.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.try-hanzo-item');
      if (!item) return;
      if (item.classList.contains('is-current')) e.preventDefault(); // already here
      setOpen(false);
    });
    document.addEventListener('click', (e) => {
      const target = e.target as Node;
      if (isOpen() && !wrap.contains(target) && !menu.contains(target)) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) {
        setOpen(false);
        trigger.focus();
      }
    });

    // Trigger sits to the left of the account/identity control (appended right after).
    headerRight.appendChild(wrap);
  }

  // Hanzo IAM: show the logged-in user + org/project switcher (or "Sign in").
  // Rightmost in the header so identity is always visible. Desktop builds keep
  // it too — the same hanzo.id session backs the Tauri app.
  private setupAccountMenu(): void {
    this.accountMenu = new AccountMenu();
    const headerRight = this.container.querySelector('.header-right');
    if (headerRight) {
      headerRight.appendChild(this.accountMenu.getElement());
    }
  }

  private syncDataFreshnessWithLayers(): void {
    // Map layer toggles to data source IDs
    const layerToSource: Partial<Record<keyof MapLayers, DataSourceId[]>> = {
      military: ['opensky', 'wingbits'],
      ais: ['ais'],
      natural: ['usgs'],
      weather: ['weather'],
      outages: ['outages'],
      cyberThreats: ['cyber_threats'],
      protests: ['acled'],
      ucdpEvents: ['ucdp_events'],
      displacement: ['unhcr'],
      climate: ['climate'],
    };

    for (const [layer, sourceIds] of Object.entries(layerToSource)) {
      const enabled = this.mapLayers[layer as keyof MapLayers] ?? false;
      for (const sourceId of sourceIds) {
        dataFreshness.setEnabled(sourceId as DataSourceId, enabled);
      }
    }

    // Mark sources as disabled if not configured
    if (!isAisConfigured()) {
      dataFreshness.setEnabled('ais', false);
    }
    if (isOutagesConfigured() === false) {
      dataFreshness.setEnabled('outages', false);
    }
  }

  private setupMapLayerHandlers(): void {
    this.map?.setOnLayerChange((layer, enabled) => {
      console.log(`[App.onLayerChange] ${layer}: ${enabled}`);
      // Save layer settings
      this.mapLayers[layer] = enabled;
      saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);

      // Sync data freshness tracker
      const layerToSource: Partial<Record<keyof MapLayers, DataSourceId[]>> = {
        military: ['opensky', 'wingbits'],
        ais: ['ais'],
        natural: ['usgs'],
        weather: ['weather'],
        outages: ['outages'],
        cyberThreats: ['cyber_threats'],
        protests: ['acled'],
        ucdpEvents: ['ucdp_events'],
        displacement: ['unhcr'],
        climate: ['climate'],
      };
      const sourceIds = layerToSource[layer];
      if (sourceIds) {
        for (const sourceId of sourceIds) {
          dataFreshness.setEnabled(sourceId, enabled);
        }
      }

      // Handle AIS WebSocket connection
      if (layer === 'ais') {
        if (enabled) {
          this.map?.setLayerLoading('ais', true);
          initAisStream();
          this.waitForAisData();
        } else {
          disconnectAisStream();
        }
        return;
      }

      // Load data when layer is enabled (if not already loaded)
      if (enabled) {
        this.loadDataForLayer(layer);
      }
    });
  }

  private setupCountryIntel(): void {
    if (!this.map) return;
    this.countryBriefPage = new CountryBriefPage();
    // [country-view] Dock the analyst chat inside the fullscreen country view —
    // same capability port the dashboard analyst uses (reused by composition).
    this.countryBriefPage.setAnalystHost(this.buildAnalystHost());
    this.countryBriefPage.setShareStoryHandler((code, name) => {
      this.countryBriefPage?.hide();
      this.openCountryStory(code, name);
    });
    this.countryBriefPage.setExportImageHandler(async (code, name) => {
      try {
        const signals = this.getCountrySignals(code, name);
        const cluster = signalAggregator.getCountryClusters().find(c => c.country === code);
        const regional = signalAggregator.getRegionalConvergence().filter(r => r.countries.includes(code));
        const convergence = cluster ? {
          score: cluster.convergenceScore,
          signalTypes: [...cluster.signalTypes],
          regionalDescriptions: regional.map(r => r.description),
        } : null;
        const posturePanel = this.panels['strategic-posture'] as import('@/components/StrategicPosturePanel').StrategicPosturePanel | undefined;
        const postures = posturePanel?.getPostures() || [];
        const data = collectStoryData(code, name, this.latestClusters, postures, this.latestPredictions, signals, convergence);
        const canvas = await renderStoryToCanvas(data);
        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `country-brief-${code.toLowerCase()}-${Date.now()}.png`;
        a.click();
      } catch (err) {
        console.error('[CountryBrief] Image export failed:', err);
      }
    });

    this.map.onCountryClicked(async (countryClick) => {
      if (countryClick.code && countryClick.name) {
        this.openCountryBriefByCode(countryClick.code, countryClick.name);
      } else {
        this.openCountryBrief(countryClick.lat, countryClick.lon);
      }
    });

    this.countryBriefPage.onClose(() => {
      this.briefRequestToken++; // invalidate any in-flight reverse-geocode
      this.map?.clearCountryHighlight();
      this.map?.setRenderPaused(false);
      this.countryTimeline?.destroy();
      this.countryTimeline = null;
      // Force URL rewrite to drop ?country= immediately
      const shareUrl = this.getShareUrl();
      if (shareUrl) history.replaceState(null, '', shareUrl);
    });

    // [country-view] Browser Back closes the fullscreen view (it was opened with
    // pushState); Forward re-opens it. Closing via ✕/Escape drops ?country= via
    // onClose's replaceState, so a plain replace here would never fire — popstate
    // only runs on real history navigation.
    window.addEventListener('popstate', () => {
      const country = new URLSearchParams(window.location.search).get('country');
      const visible = this.countryBriefPage?.isVisible() ?? false;
      if (!country && visible) {
        this.countryBriefPage?.hide();
      } else if (country && !visible && dataFreshness.hasSufficientData()) {
        const code = country.toUpperCase();
        void this.openCountryBriefByCode(code, App.resolveCountryName(code));
      }
    });
  }

  public async openCountryBrief(lat: number, lon: number): Promise<void> {
    if (!this.countryBriefPage) return;
    const token = ++this.briefRequestToken;
    this.countryBriefPage.showLoading();
    this.map?.setRenderPaused(true);

    const localGeo = getCountryAtCoordinates(lat, lon);
    if (localGeo) {
      if (token !== this.briefRequestToken) return; // superseded by newer click
      this.openCountryBriefByCode(localGeo.code, localGeo.name);
      return;
    }

    const geo = await reverseGeocode(lat, lon);
    if (token !== this.briefRequestToken) return; // superseded by newer click
    if (!geo) {
      this.countryBriefPage.hide();
      this.map?.setRenderPaused(false);
      return;
    }

    this.openCountryBriefByCode(geo.code, geo.country);
  }

  public async openCountryBriefByCode(code: string, country: string): Promise<void> {
    if (!this.countryBriefPage) return;
    const wasVisible = this.countryBriefPage.isVisible(); // [country-view] push vs replace
    this.map?.setRenderPaused(true);

    // Normalize to canonical name (GeoJSON may use "United States of America" etc.)
    const canonicalName = TIER1_COUNTRIES[code] || App.resolveCountryName(code);
    if (canonicalName !== code) country = canonicalName;

    const scores = calculateCII();
    const score = scores.find((s) => s.code === code) ?? null;
    const signals = this.getCountrySignals(code, country);

    this.countryBriefPage.show(country, code, score, signals);
    this.map?.highlightCountry(code);

    // [country-view] Reflect the view in the URL. A fresh open from a gesture
    // PUSHES a history entry so browser Back closes the view; switching country
    // while open, or restoring a ?country= deep link, REPLACES (no phantom entry).
    const shareUrl = this.getShareUrl();
    if (shareUrl) {
      const already = new URLSearchParams(window.location.search).get('country');
      if (!wasVisible && already?.toUpperCase() !== code.toUpperCase()) {
        history.pushState(null, '', shareUrl);
      } else {
        history.replaceState(null, '', shareUrl);
      }
    }

    const stockPromise = fetch(`/v1/world/stock-index?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .catch(() => ({ available: false }));

    stockPromise.then((stock) => {
      if (this.countryBriefPage?.getCode() === code) this.countryBriefPage.updateStock(stock);
    });

    fetchCountryMarkets(country)
      .then((markets) => {
        if (this.countryBriefPage?.getCode() === code) this.countryBriefPage.updateMarkets(markets);
      })
      .catch(() => {
        if (this.countryBriefPage?.getCode() === code) this.countryBriefPage.updateMarkets([]);
      });

    // Pass evidence headlines
    const searchTerms = App.getCountrySearchTerms(country, code);
    const otherCountryTerms = App.getOtherCountryTerms(code);
    const matchingNews = this.allNews.filter((n) => {
      const t = n.title.toLowerCase();
      return searchTerms.some((term) => t.includes(term));
    });
    const filteredNews = matchingNews.filter((n) => {
      const t = n.title.toLowerCase();
      const ourPos = App.firstMentionPosition(t, searchTerms);
      const otherPos = App.firstMentionPosition(t, otherCountryTerms);
      return ourPos !== Infinity && (otherPos === Infinity || ourPos <= otherPos);
    });
    if (filteredNews.length > 0) {
      this.countryBriefPage.updateNews(filteredNews.slice(0, 8));
    }

    // Infrastructure exposure
    this.countryBriefPage.updateInfrastructure(code);

    // Timeline
    this.mountCountryTimeline(code, country);

    try {
      const context: Record<string, unknown> = {};
      if (score) {
        context.score = score.score;
        context.level = score.level;
        context.trend = score.trend;
        context.components = score.components;
        context.change24h = score.change24h;
      }
      Object.assign(context, signals);

      const countryCluster = signalAggregator.getCountryClusters().find((c) => c.country === code);
      if (countryCluster) {
        context.convergenceScore = countryCluster.convergenceScore;
        context.signalTypes = [...countryCluster.signalTypes];
      }

      const convergences = signalAggregator.getRegionalConvergence()
        .filter((r) => r.countries.includes(code));
      if (convergences.length) {
        context.regionalConvergence = convergences.map((r) => r.description);
      }

      const headlines = filteredNews.slice(0, 15).map((n) => n.title);
      if (headlines.length) context.headlines = headlines;

      const stockData = await stockPromise;
      if (stockData.available) {
        const pct = parseFloat(stockData.weekChangePercent);
        context.stockIndex = `${stockData.indexName}: ${stockData.price} (${pct >= 0 ? '+' : ''}${stockData.weekChangePercent}% week)`;
      }

      let data: Record<string, unknown> | null = null;
      try {
        const res = await fetch('/v1/world/country-intel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ country, code, context }),
        });
        data = await res.json();
      } catch { /* server unreachable */ }

      if (data && data.brief && !data.skipped) {
        this.countryBriefPage!.updateBrief({ ...data, code } as Parameters<CountryBriefPage['updateBrief']>[0]); // [country-view] typeof-this → class index (stable under new imports)
      } else {
        const briefHeadlines = (context.headlines as string[] | undefined) || [];
        let fallbackBrief = '';
        const sumModelId = BETA_MODE ? 'summarization-beta' : 'summarization';
        if (briefHeadlines.length >= 2 && mlWorker.isAvailable && mlWorker.isModelLoaded(sumModelId)) {
          try {
            const prompt = `Summarize the current situation in ${country} based on these headlines: ${briefHeadlines.slice(0, 8).join('. ')}`;
            const [summary] = await mlWorker.summarize([prompt], BETA_MODE ? 'summarization-beta' : undefined);
            if (summary && summary.length > 20) fallbackBrief = summary;
          } catch { /* T5 failed */ }
        }

        if (fallbackBrief) {
          this.countryBriefPage!.updateBrief({ brief: fallbackBrief, country, code, fallback: true });
        } else {
          const lines: string[] = [];
          if (score) lines.push(`**Instability Index: ${score.score}/100** (${score.level}, ${score.trend})`);
          if (signals.protests > 0) lines.push(`${signals.protests} active protests detected`);
          if (signals.militaryFlights > 0) lines.push(`${signals.militaryFlights} military aircraft tracked`);
          if (signals.militaryVessels > 0) lines.push(`${signals.militaryVessels} military vessels tracked`);
          if (signals.outages > 0) lines.push(`${signals.outages} internet outages`);
          if (signals.earthquakes > 0) lines.push(`${signals.earthquakes} recent earthquakes`);
          if (context.stockIndex) lines.push(`Stock index: ${context.stockIndex}`);
          if (briefHeadlines.length > 0) {
            lines.push('', '**Recent headlines:**');
            briefHeadlines.slice(0, 5).forEach(h => lines.push(`• ${h}`));
          }
          if (lines.length > 0) {
            this.countryBriefPage!.updateBrief({ brief: lines.join('\n'), country, code, fallback: true });
          } else {
            this.countryBriefPage!.updateBrief({ brief: '', country, code, error: 'No AI service available. Configure GROQ_API_KEY in Settings for full briefs.' });
          }
        }
      }
    } catch (err) {
      console.error('[CountryBrief] fetch error:', err);
      this.countryBriefPage!.updateBrief({ brief: '', country, code, error: 'Failed to generate brief' });
    }
  }

  private mountCountryTimeline(code: string, country: string): void {
    this.countryTimeline?.destroy();
    this.countryTimeline = null;

    const mount = this.countryBriefPage?.getTimelineMount();
    if (!mount) return;

    const events: TimelineEvent[] = [];
    const countryLower = country.toLowerCase();
    const hasGeoShape = hasCountryGeometry(code) || !!App.COUNTRY_BOUNDS[code];
    const inCountry = (lat: number, lon: number) => hasGeoShape && this.isInCountry(lat, lon, code);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    if (this.intelligenceCache.protests?.events) {
      for (const e of this.intelligenceCache.protests.events) {
        if (e.country?.toLowerCase() === countryLower || inCountry(e.lat, e.lon)) {
          events.push({
            timestamp: new Date(e.time).getTime(),
            lane: 'protest',
            label: e.title || `${e.eventType} in ${e.city || e.country}`,
            severity: e.severity === 'high' ? 'high' : e.severity === 'medium' ? 'medium' : 'low',
          });
        }
      }
    }

    if (this.intelligenceCache.earthquakes) {
      for (const eq of this.intelligenceCache.earthquakes) {
        if (inCountry(eq.lat, eq.lon) || eq.place?.toLowerCase().includes(countryLower)) {
          events.push({
            timestamp: new Date(eq.time).getTime(),
            lane: 'natural',
            label: `M${eq.magnitude.toFixed(1)} ${eq.place}`,
            severity: eq.magnitude >= 6 ? 'critical' : eq.magnitude >= 5 ? 'high' : eq.magnitude >= 4 ? 'medium' : 'low',
          });
        }
      }
    }

    if (this.intelligenceCache.military) {
      for (const f of this.intelligenceCache.military.flights) {
        if (hasGeoShape ? this.isInCountry(f.lat, f.lon, code) : f.operatorCountry?.toUpperCase() === code) {
          events.push({
            timestamp: new Date(f.lastSeen).getTime(),
            lane: 'military',
            label: `${f.callsign} (${f.aircraftModel || f.aircraftType})`,
            severity: f.isInteresting ? 'high' : 'low',
          });
        }
      }
      for (const v of this.intelligenceCache.military.vessels) {
        if (hasGeoShape ? this.isInCountry(v.lat, v.lon, code) : v.operatorCountry?.toUpperCase() === code) {
          events.push({
            timestamp: new Date(v.lastAisUpdate).getTime(),
            lane: 'military',
            label: `${v.name} (${v.vesselType})`,
            severity: v.isDark ? 'high' : 'low',
          });
        }
      }
    }

    const ciiData = getCountryData(code);
    if (ciiData?.conflicts) {
      for (const c of ciiData.conflicts) {
        events.push({
          timestamp: new Date(c.time).getTime(),
          lane: 'conflict',
          label: `${c.eventType}: ${c.location || c.country}`,
          severity: c.fatalities > 0 ? 'critical' : 'high',
        });
      }
    }

    this.countryTimeline = new CountryTimeline(mount);
    this.countryTimeline.render(events.filter(e => e.timestamp >= sevenDaysAgo));
  }

  private static COUNTRY_BOUNDS: Record<string, { n: number; s: number; e: number; w: number }> = {
    IR: { n: 40, s: 25, e: 63, w: 44 }, IL: { n: 33.3, s: 29.5, e: 35.9, w: 34.3 },
    SA: { n: 32, s: 16, e: 55, w: 35 }, AE: { n: 26.1, s: 22.6, e: 56.4, w: 51.6 },
    IQ: { n: 37.4, s: 29.1, e: 48.6, w: 38.8 }, SY: { n: 37.3, s: 32.3, e: 42.4, w: 35.7 },
    YE: { n: 19, s: 12, e: 54.5, w: 42 }, LB: { n: 34.7, s: 33.1, e: 36.6, w: 35.1 },
    CN: { n: 53.6, s: 18.2, e: 134.8, w: 73.5 }, TW: { n: 25.3, s: 21.9, e: 122, w: 120 },
    JP: { n: 45.5, s: 24.2, e: 153.9, w: 122.9 }, KR: { n: 38.6, s: 33.1, e: 131.9, w: 124.6 },
    KP: { n: 43.0, s: 37.7, e: 130.7, w: 124.2 }, IN: { n: 35.5, s: 6.7, e: 97.4, w: 68.2 },
    PK: { n: 37, s: 24, e: 77, w: 61 }, AF: { n: 38.5, s: 29.4, e: 74.9, w: 60.5 },
    UA: { n: 52.4, s: 44.4, e: 40.2, w: 22.1 }, RU: { n: 82, s: 41.2, e: 180, w: 19.6 },
    BY: { n: 56.2, s: 51.3, e: 32.8, w: 23.2 }, PL: { n: 54.8, s: 49, e: 24.1, w: 14.1 },
    EG: { n: 31.7, s: 22, e: 36.9, w: 25 }, LY: { n: 33, s: 19.5, e: 25, w: 9.4 },
    SD: { n: 22, s: 8.7, e: 38.6, w: 21.8 }, US: { n: 49, s: 24.5, e: -66.9, w: -125 },
    GB: { n: 58.7, s: 49.9, e: 1.8, w: -8.2 }, DE: { n: 55.1, s: 47.3, e: 15.0, w: 5.9 },
    FR: { n: 51.1, s: 41.3, e: 9.6, w: -5.1 }, TR: { n: 42.1, s: 36, e: 44.8, w: 26 },
    BR: { n: 5.3, s: -33.8, e: -34.8, w: -73.9 },
  };

  private static COUNTRY_ALIASES: Record<string, string[]> = {
    IL: ['israel', 'israeli', 'gaza', 'hamas', 'hezbollah', 'netanyahu', 'idf', 'west bank', 'tel aviv', 'jerusalem'],
    IR: ['iran', 'iranian', 'tehran', 'persian', 'irgc', 'khamenei'],
    RU: ['russia', 'russian', 'moscow', 'kremlin', 'putin', 'ukraine war'],
    UA: ['ukraine', 'ukrainian', 'kyiv', 'zelensky', 'zelenskyy'],
    CN: ['china', 'chinese', 'beijing', 'taiwan strait', 'south china sea', 'xi jinping'],
    TW: ['taiwan', 'taiwanese', 'taipei'],
    KP: ['north korea', 'pyongyang', 'kim jong'],
    KR: ['south korea', 'seoul'],
    SA: ['saudi', 'riyadh', 'mbs'],
    SY: ['syria', 'syrian', 'damascus', 'assad'],
    YE: ['yemen', 'houthi', 'sanaa'],
    IQ: ['iraq', 'iraqi', 'baghdad'],
    AF: ['afghanistan', 'afghan', 'kabul', 'taliban'],
    PK: ['pakistan', 'pakistani', 'islamabad'],
    IN: ['india', 'indian', 'new delhi', 'modi'],
    EG: ['egypt', 'egyptian', 'cairo', 'suez'],
    LB: ['lebanon', 'lebanese', 'beirut'],
    TR: ['turkey', 'turkish', 'ankara', 'erdogan', 'türkiye'],
    US: ['united states', 'american', 'washington', 'pentagon', 'white house'],
    GB: ['united kingdom', 'british', 'london', 'uk '],
    BR: ['brazil', 'brazilian', 'brasilia', 'lula', 'bolsonaro'],
    AE: ['united arab emirates', 'uae', 'emirati', 'dubai', 'abu dhabi'],
  };

  private static otherCountryTermsCache: Map<string, string[]> = new Map();

  private static firstMentionPosition(text: string, terms: string[]): number {
    let earliest = Infinity;
    for (const term of terms) {
      const idx = text.indexOf(term);
      if (idx !== -1 && idx < earliest) earliest = idx;
    }
    return earliest;
  }

  private static getOtherCountryTerms(code: string): string[] {
    const cached = App.otherCountryTermsCache.get(code);
    if (cached) return cached;

    const dedup = new Set<string>();
    Object.entries(App.COUNTRY_ALIASES).forEach(([countryCode, aliases]) => {
      if (countryCode === code) return;
      aliases.forEach((alias) => {
        const normalized = alias.toLowerCase();
        if (normalized.trim().length > 0) dedup.add(normalized);
      });
    });

    const terms = [...dedup];
    App.otherCountryTermsCache.set(code, terms);
    return terms;
  }

  private static resolveCountryName(code: string): string {
    if (TIER1_COUNTRIES[code]) return TIER1_COUNTRIES[code];

    try {
      const displayNamesCtor = (Intl as unknown as { DisplayNames?: IntlDisplayNamesCtor }).DisplayNames;
      if (!displayNamesCtor) return code;
      const displayNames = new displayNamesCtor(['en'], { type: 'region' });
      const resolved = displayNames.of(code);
      if (resolved && resolved.toUpperCase() !== code) return resolved;
    } catch {
      // Intl.DisplayNames unavailable in older runtimes.
    }

    return code;
  }

  private static getCountrySearchTerms(country: string, code: string): string[] {
    const aliases = App.COUNTRY_ALIASES[code];
    if (aliases) return aliases;
    if (/^[A-Z]{2}$/i.test(country.trim())) return [];
    return [country.toLowerCase()];
  }

  private isInCountry(lat: number, lon: number, code: string): boolean {
    const precise = isCoordinateInCountry(lat, lon, code);
    if (precise != null) return precise;
    const b = App.COUNTRY_BOUNDS[code];
    if (!b) return false;
    return lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;
  }

  private getCountrySignals(code: string, country: string): CountryBriefSignals {
    const countryLower = country.toLowerCase();
    const hasGeoShape = hasCountryGeometry(code) || !!App.COUNTRY_BOUNDS[code];

    let protests = 0;
    if (this.intelligenceCache.protests?.events) {
      protests = this.intelligenceCache.protests.events.filter((e) =>
        e.country?.toLowerCase() === countryLower || (hasGeoShape && this.isInCountry(e.lat, e.lon, code))
      ).length;
    }

    let militaryFlights = 0;
    let militaryVessels = 0;
    if (this.intelligenceCache.military) {
      militaryFlights = this.intelligenceCache.military.flights.filter((f) =>
        hasGeoShape ? this.isInCountry(f.lat, f.lon, code) : f.operatorCountry?.toUpperCase() === code
      ).length;
      militaryVessels = this.intelligenceCache.military.vessels.filter((v) =>
        hasGeoShape ? this.isInCountry(v.lat, v.lon, code) : v.operatorCountry?.toUpperCase() === code
      ).length;
    }

    let outages = 0;
    if (this.intelligenceCache.outages) {
      outages = this.intelligenceCache.outages.filter((o) =>
        o.country?.toLowerCase() === countryLower || (hasGeoShape && this.isInCountry(o.lat, o.lon, code))
      ).length;
    }

    let earthquakes = 0;
    if (this.intelligenceCache.earthquakes) {
      earthquakes = this.intelligenceCache.earthquakes.filter((eq) => {
        if (hasGeoShape) return this.isInCountry(eq.lat, eq.lon, code);
        return eq.place?.toLowerCase().includes(countryLower);
      }).length;
    }

    const ciiData = getCountryData(code);
    const isTier1 = !!TIER1_COUNTRIES[code];

    return {
      protests,
      militaryFlights,
      militaryVessels,
      outages,
      earthquakes,
      displacementOutflow: ciiData?.displacementOutflow ?? 0,
      climateStress: ciiData?.climateStress ?? 0,
      conflictEvents: ciiData?.conflicts?.length ?? 0,
      isTier1,
    };
  }

  private openCountryStory(code: string, name: string): void {
    if (!dataFreshness.hasSufficientData() || this.latestClusters.length === 0) {
      this.showToast('Data still loading — try again in a moment');
      return;
    }
    const posturePanel = this.panels['strategic-posture'] as StrategicPosturePanel | undefined;
    const postures = posturePanel?.getPostures() || [];
    const signals = this.getCountrySignals(code, name);
    const cluster = signalAggregator.getCountryClusters().find(c => c.country === code);
    const regional = signalAggregator.getRegionalConvergence().filter(r => r.countries.includes(code));
    const convergence = cluster ? {
      score: cluster.convergenceScore,
      signalTypes: [...cluster.signalTypes],
      regionalDescriptions: regional.map(r => r.description),
    } : null;
    const data = collectStoryData(code, name, this.latestClusters, postures, this.latestPredictions, signals, convergence);
    openStoryModal(data);
  }

  private showToast(msg: string): void {
    document.querySelector('.toast-notification')?.remove();
    const el = document.createElement('div');
    el.className = 'toast-notification';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, 3000);
  }

  private shouldShowIntelligenceNotifications(): boolean {
    return !this.isMobile && !!this.findingsBadge?.isEnabled();
  }

  private setupSearchModal(): void {
    const searchOptions = SITE_VARIANT === 'tech' || SITE_VARIANT === 'ai'
      ? {
        placeholder: t('modals.search.placeholderTech'),
        hint: t('modals.search.hintTech'),
      }
      : SITE_VARIANT === 'finance' || SITE_VARIANT === 'crypto'
        ? {
          placeholder: t('modals.search.placeholderFinance'),
          hint: t('modals.search.hintFinance'),
        }
        : {
          placeholder: t('modals.search.placeholder'),
          hint: t('modals.search.hint'),
        };
    this.searchModal = new SearchModal(this.container, searchOptions);

    if (SITE_VARIANT === 'tech' || SITE_VARIANT === 'ai') {
      // Tech/AI variants: tech-specific sources
      this.searchModal.registerSource('techcompany', TECH_COMPANIES.map(c => ({
        id: c.id,
        title: c.name,
        subtitle: `${c.sector} ${c.city} ${c.keyProducts?.join(' ') || ''}`.trim(),
        data: c,
      })));

      this.searchModal.registerSource('ailab', AI_RESEARCH_LABS.map(l => ({
        id: l.id,
        title: l.name,
        subtitle: `${l.type} ${l.city} ${l.focusAreas?.join(' ') || ''}`.trim(),
        data: l,
      })));

      this.searchModal.registerSource('startup', STARTUP_ECOSYSTEMS.map(s => ({
        id: s.id,
        title: s.name,
        subtitle: `${s.ecosystemTier} ${s.topSectors?.join(' ') || ''} ${s.notableStartups?.join(' ') || ''}`.trim(),
        data: s,
      })));

      this.searchModal.registerSource('datacenter', AI_DATA_CENTERS.map(d => ({
        id: d.id,
        title: d.name,
        subtitle: `${d.owner} ${d.chipType || ''}`.trim(),
        data: d,
      })));

      this.searchModal.registerSource('cable', UNDERSEA_CABLES.map(c => ({
        id: c.id,
        title: c.name,
        subtitle: c.major ? 'Major internet backbone' : 'Undersea cable',
        data: c,
      })));

      // Register Tech HQs (unicorns, FAANG, public companies from map)
      this.searchModal.registerSource('techhq', TECH_HQS.map(h => ({
        id: h.id,
        title: h.company,
        subtitle: `${h.type === 'faang' ? 'Big Tech' : h.type === 'unicorn' ? 'Unicorn' : 'Public'} • ${h.city}, ${h.country}`,
        data: h,
      })));

      // Register Accelerators
      this.searchModal.registerSource('accelerator', ACCELERATORS.map(a => ({
        id: a.id,
        title: a.name,
        subtitle: `${a.type} • ${a.city}, ${a.country}${a.notable ? ` • ${a.notable.slice(0, 2).join(', ')}` : ''}`,
        data: a,
      })));
    } else {
      // Full variant: geopolitical sources
      this.searchModal.registerSource('hotspot', INTEL_HOTSPOTS.map(h => ({
        id: h.id,
        title: h.name,
        subtitle: `${h.subtext || ''} ${h.keywords?.join(' ') || ''} ${h.description || ''}`.trim(),
        data: h,
      })));

      this.searchModal.registerSource('conflict', CONFLICT_ZONES.map(c => ({
        id: c.id,
        title: c.name,
        subtitle: `${c.parties?.join(' ') || ''} ${c.keywords?.join(' ') || ''} ${c.description || ''}`.trim(),
        data: c,
      })));

      this.searchModal.registerSource('base', MILITARY_BASES.map(b => ({
        id: b.id,
        title: b.name,
        subtitle: `${b.type} ${b.description || ''}`.trim(),
        data: b,
      })));

      this.searchModal.registerSource('pipeline', PIPELINES.map(p => ({
        id: p.id,
        title: p.name,
        subtitle: `${p.type} ${p.operator || ''} ${p.countries?.join(' ') || ''}`.trim(),
        data: p,
      })));

      this.searchModal.registerSource('cable', UNDERSEA_CABLES.map(c => ({
        id: c.id,
        title: c.name,
        subtitle: c.major ? 'Major cable' : '',
        data: c,
      })));

      this.searchModal.registerSource('datacenter', AI_DATA_CENTERS.map(d => ({
        id: d.id,
        title: d.name,
        subtitle: `${d.owner} ${d.chipType || ''}`.trim(),
        data: d,
      })));

      this.searchModal.registerSource('nuclear', NUCLEAR_FACILITIES.map(n => ({
        id: n.id,
        title: n.name,
        subtitle: `${n.type} ${n.operator || ''}`.trim(),
        data: n,
      })));

      this.searchModal.registerSource('irradiator', GAMMA_IRRADIATORS.map(g => ({
        id: g.id,
        title: `${g.city}, ${g.country}`,
        subtitle: g.organization || '',
        data: g,
      })));
    }

    if (SITE_VARIANT === 'finance' || SITE_VARIANT === 'crypto') {
      // Finance/Crypto variants: market-specific sources
      this.searchModal.registerSource('exchange', STOCK_EXCHANGES.map(e => ({
        id: e.id,
        title: `${e.shortName} - ${e.name}`,
        subtitle: `${e.tier} • ${e.city}, ${e.country}${e.marketCap ? ` • $${e.marketCap}T` : ''}`,
        data: e,
      })));

      this.searchModal.registerSource('financialcenter', FINANCIAL_CENTERS.map(f => ({
        id: f.id,
        title: f.name,
        subtitle: `${f.type} financial center${f.gfciRank ? ` • GFCI #${f.gfciRank}` : ''}${f.specialties ? ` • ${f.specialties.slice(0, 3).join(', ')}` : ''}`,
        data: f,
      })));

      this.searchModal.registerSource('centralbank', CENTRAL_BANKS.map(b => ({
        id: b.id,
        title: `${b.shortName} - ${b.name}`,
        subtitle: `${b.type}${b.currency ? ` • ${b.currency}` : ''} • ${b.city}, ${b.country}`,
        data: b,
      })));

      this.searchModal.registerSource('commodityhub', COMMODITY_HUBS.map(h => ({
        id: h.id,
        title: h.name,
        subtitle: `${h.type} • ${h.city}, ${h.country}${h.commodities ? ` • ${h.commodities.slice(0, 3).join(', ')}` : ''}`,
        data: h,
      })));
    }

    // Register countries for all variants
    this.searchModal.registerSource('country', this.buildCountrySearchItems());

    // Handle result selection
    this.searchModal.setOnSelect((result) => this.handleSearchResult(result));

    // Global keyboard shortcut
    this.boundKeydownHandler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (this.searchModal?.isOpen()) {
          this.searchModal.close();
        } else {
          // Update search index with latest data before opening
          this.updateSearchIndex();
          this.searchModal?.open();
        }
      }
    };
    document.addEventListener('keydown', this.boundKeydownHandler);
  }

  private handleSearchResult(result: SearchResult): void {
    switch (result.type) {
      case 'news': {
        // Find and scroll to the news panel containing this item
        const item = result.data as NewsItem;
        this.scrollToPanel('politics');
        this.highlightNewsItem(item.link);
        break;
      }
      case 'hotspot': {
        // Trigger map popup for hotspot
        const hotspot = result.data as typeof INTEL_HOTSPOTS[0];
        this.map?.setView('global');
        setTimeout(() => {
          this.map?.triggerHotspotClick(hotspot.id);
        }, 300);
        break;
      }
      case 'conflict': {
        const conflict = result.data as typeof CONFLICT_ZONES[0];
        this.map?.setView('global');
        setTimeout(() => {
          this.map?.triggerConflictClick(conflict.id);
        }, 300);
        break;
      }
      case 'market': {
        this.scrollToPanel('markets');
        break;
      }
      case 'prediction': {
        this.scrollToPanel('polymarket');
        break;
      }
      case 'base': {
        const base = result.data as typeof MILITARY_BASES[0];
        this.map?.setView('global');
        setTimeout(() => {
          this.map?.triggerBaseClick(base.id);
        }, 300);
        break;
      }
      case 'pipeline': {
        const pipeline = result.data as typeof PIPELINES[0];
        this.map?.setView('global');
        this.map?.enableLayer('pipelines');
        this.mapLayers.pipelines = true;
        setTimeout(() => {
          this.map?.triggerPipelineClick(pipeline.id);
        }, 300);
        break;
      }
      case 'cable': {
        const cable = result.data as typeof UNDERSEA_CABLES[0];
        this.map?.setView('global');
        this.map?.enableLayer('cables');
        this.mapLayers.cables = true;
        setTimeout(() => {
          this.map?.triggerCableClick(cable.id);
        }, 300);
        break;
      }
      case 'datacenter': {
        const dc = result.data as typeof AI_DATA_CENTERS[0];
        this.map?.setView('global');
        this.map?.enableLayer('datacenters');
        this.mapLayers.datacenters = true;
        setTimeout(() => {
          this.map?.triggerDatacenterClick(dc.id);
        }, 300);
        break;
      }
      case 'nuclear': {
        const nuc = result.data as typeof NUCLEAR_FACILITIES[0];
        this.map?.setView('global');
        this.map?.enableLayer('nuclear');
        this.mapLayers.nuclear = true;
        setTimeout(() => {
          this.map?.triggerNuclearClick(nuc.id);
        }, 300);
        break;
      }
      case 'irradiator': {
        const irr = result.data as typeof GAMMA_IRRADIATORS[0];
        this.map?.setView('global');
        this.map?.enableLayer('irradiators');
        this.mapLayers.irradiators = true;
        setTimeout(() => {
          this.map?.triggerIrradiatorClick(irr.id);
        }, 300);
        break;
      }
      case 'earthquake':
      case 'outage':
        // These are dynamic, just switch to map view
        this.map?.setView('global');
        break;
      case 'techcompany': {
        const company = result.data as typeof TECH_COMPANIES[0];
        this.map?.setView('global');
        this.map?.enableLayer('techHQs');
        this.mapLayers.techHQs = true;
        setTimeout(() => {
          this.map?.setCenter(company.lat, company.lon, 4);
        }, 300);
        break;
      }
      case 'ailab': {
        const lab = result.data as typeof AI_RESEARCH_LABS[0];
        this.map?.setView('global');
        setTimeout(() => {
          this.map?.setCenter(lab.lat, lab.lon, 4);
        }, 300);
        break;
      }
      case 'startup': {
        const ecosystem = result.data as typeof STARTUP_ECOSYSTEMS[0];
        this.map?.setView('global');
        this.map?.enableLayer('startupHubs');
        this.mapLayers.startupHubs = true;
        setTimeout(() => {
          this.map?.setCenter(ecosystem.lat, ecosystem.lon, 4);
        }, 300);
        break;
      }
      case 'techevent':
        this.map?.setView('global');
        this.map?.enableLayer('techEvents');
        this.mapLayers.techEvents = true;
        break;
      case 'techhq': {
        const hq = result.data as typeof TECH_HQS[0];
        this.map?.setView('global');
        this.map?.enableLayer('techHQs');
        this.mapLayers.techHQs = true;
        setTimeout(() => {
          this.map?.setCenter(hq.lat, hq.lon, 4);
        }, 300);
        break;
      }
      case 'accelerator': {
        const acc = result.data as typeof ACCELERATORS[0];
        this.map?.setView('global');
        this.map?.enableLayer('accelerators');
        this.mapLayers.accelerators = true;
        setTimeout(() => {
          this.map?.setCenter(acc.lat, acc.lon, 4);
        }, 300);
        break;
      }
      case 'exchange': {
        const exchange = result.data as typeof STOCK_EXCHANGES[0];
        this.map?.setView('global');
        this.map?.enableLayer('stockExchanges');
        this.mapLayers.stockExchanges = true;
        setTimeout(() => {
          this.map?.setCenter(exchange.lat, exchange.lon, 4);
        }, 300);
        break;
      }
      case 'financialcenter': {
        const fc = result.data as typeof FINANCIAL_CENTERS[0];
        this.map?.setView('global');
        this.map?.enableLayer('financialCenters');
        this.mapLayers.financialCenters = true;
        setTimeout(() => {
          this.map?.setCenter(fc.lat, fc.lon, 4);
        }, 300);
        break;
      }
      case 'centralbank': {
        const bank = result.data as typeof CENTRAL_BANKS[0];
        this.map?.setView('global');
        this.map?.enableLayer('centralBanks');
        this.mapLayers.centralBanks = true;
        setTimeout(() => {
          this.map?.setCenter(bank.lat, bank.lon, 4);
        }, 300);
        break;
      }
      case 'commodityhub': {
        const hub = result.data as typeof COMMODITY_HUBS[0];
        this.map?.setView('global');
        this.map?.enableLayer('commodityHubs');
        this.mapLayers.commodityHubs = true;
        setTimeout(() => {
          this.map?.setCenter(hub.lat, hub.lon, 4);
        }, 300);
        break;
      }
      case 'country': {
        const { code, name } = result.data as { code: string; name: string };
        this.openCountryBriefByCode(code, name);
        break;
      }
    }
  }

  private scrollToPanel(panelId: string): void {
    const panel = document.querySelector(`[data-panel="${panelId}"]`);
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      panel.classList.add('flash-highlight');
      setTimeout(() => panel.classList.remove('flash-highlight'), 1500);
    }
  }

  private highlightNewsItem(itemId: string): void {
    setTimeout(() => {
      const item = document.querySelector(`[data-news-id="${itemId}"]`);
      if (item) {
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        item.classList.add('flash-highlight');
        setTimeout(() => item.classList.remove('flash-highlight'), 1500);
      }
    }, 100);
  }

  private updateSearchIndex(): void {
    if (!this.searchModal) return;

    // Keep country CII labels fresh with latest ingested signals.
    this.searchModal.registerSource('country', this.buildCountrySearchItems());

    // Update news sources (use link as unique id) - index up to 500 items for better search coverage
    const newsItems = this.allNews.slice(0, 500).map(n => ({
      id: n.link,
      title: n.title,
      subtitle: n.source,
      data: n,
    }));
    console.log(`[Search] Indexing ${newsItems.length} news items (allNews total: ${this.allNews.length})`);
    this.searchModal.registerSource('news', newsItems);

    // Update predictions if available
    if (this.latestPredictions.length > 0) {
      this.searchModal.registerSource('prediction', this.latestPredictions.map(p => ({
        id: p.title,
        title: p.title,
        subtitle: `${(p.yesPrice * 100).toFixed(0)}% probability`,
        data: p,
      })));
    }

    // Update markets if available
    if (this.latestMarkets.length > 0) {
      this.searchModal.registerSource('market', this.latestMarkets.map(m => ({
        id: m.symbol,
        title: `${m.symbol} - ${m.name}`,
        subtitle: `$${m.price?.toFixed(2) || 'N/A'}`,
        data: m,
      })));
    }
  }

  private buildCountrySearchItems(): { id: string; title: string; subtitle: string; data: { code: string; name: string } }[] {
    const panelScores = (this.panels['cii'] as CIIPanel | undefined)?.getScores() ?? [];
    const scores = panelScores.length > 0 ? panelScores : calculateCII();
    const ciiByCode = new Map(scores.map((score) => [score.code, score]));
    return Object.entries(TIER1_COUNTRIES).map(([code, name]) => {
      const score = ciiByCode.get(code);
      return {
        id: code,
        title: `${App.toFlagEmoji(code)} ${name}`,
        subtitle: score ? `CII: ${score.score}/100 • ${score.level}` : 'Country Brief',
        data: { code, name },
      };
    });
  }

  private static toFlagEmoji(code: string): string {
    const upperCode = code.toUpperCase();
    if (!/^[A-Z]{2}$/.test(upperCode)) return '🏳️';
    return upperCode
      .split('')
      .map((char) => String.fromCodePoint(0x1f1e6 + char.charCodeAt(0) - 65))
      .join('');
  }

  private setupPlaybackControl(): void {
    this.playbackControl = new PlaybackControl();
    this.playbackControl.onSnapshot((snapshot) => {
      if (snapshot) {
        this.isPlaybackMode = true;
        this.restoreSnapshot(snapshot);
      } else {
        this.isPlaybackMode = false;
        this.loadAllData();
      }
    });

    const headerRight = this.container.querySelector('.header-right');
    if (headerRight) {
      headerRight.insertBefore(this.playbackControl.getElement(), headerRight.firstChild);
    }
  }

  private setupSnapshotSaving(): void {
    const saveCurrentSnapshot = async () => {
      if (this.isPlaybackMode || this.isDestroyed) return;

      const marketPrices: Record<string, number> = {};
      this.latestMarkets.forEach(m => {
        if (m.price !== null) marketPrices[m.symbol] = m.price;
      });

      await saveSnapshot({
        timestamp: Date.now(),
        events: this.latestClusters,
        marketPrices,
        predictions: this.latestPredictions.map(p => ({
          title: p.title,
          yesPrice: p.yesPrice
        })),
        hotspotLevels: this.map?.getHotspotLevels() ?? {}
      });
    };

    void saveCurrentSnapshot().catch((e) => console.warn('[Snapshot] save failed:', e));
    this.snapshotIntervalId = setInterval(() => void saveCurrentSnapshot().catch((e) => console.warn('[Snapshot] save failed:', e)), 15 * 60 * 1000);
  }

  private restoreSnapshot(snapshot: import('@/services/storage').DashboardSnapshot): void {
    for (const panel of Object.values(this.newsPanels)) {
      panel.showLoading();
    }

    const events = snapshot.events as ClusteredEvent[];
    this.latestClusters = events;

    const predictions = snapshot.predictions.map((p, i) => ({
      id: `snap-${i}`,
      title: p.title,
      yesPrice: p.yesPrice,
      noPrice: 1 - p.yesPrice,
      volume24h: 0,
      liquidity: 0,
    }));
    this.latestPredictions = predictions;
    (this.panels['polymarket'] as PredictionPanel).renderPredictions(predictions);

    this.map?.setHotspotLevels(snapshot.hotspotLevels);
  }

  private renderLayout(): void {
    // Hanzo mode: the compact H mark (canonical logo, viewBox 0 0 67 67) is the
    // brand/home TOGGLE that reveals the [Cloud | World | AI | Crypto | Finance |
    // Tech] switcher. The H + gated switcher appear ONLY on hanzo brand hosts
    // (white-label rule); off-brand (OSS) hosts keep a plain home-link logo + an
    // always-on switcher (without the Cloud entry). The H is the brand; the flagship
    // VIEW is "Cloud" — so the tab carries a ☁️, never a second H (no redundancy).
    const hanzoHost = isHanzoBrandHost();
    const logoSvg = `
      <svg viewBox="0 0 67 67" width="16" height="16" fill="currentColor" aria-hidden="true">
        <path d="M22.21 67V44.6369H0V67H22.21Z"/>
        <path d="M66.7038 22.3184H22.2534L0.0878906 44.6367H44.4634L66.7038 22.3184Z"/>
        <path d="M22.21 0H0V22.3184H22.21V0Z"/>
        <path d="M66.7198 0H44.5098V22.3184H66.7198V0Z"/>
        <path d="M66.7198 67V44.6369H44.5098V67H66.7198Z"/>
      </svg>`;
    const logo = hanzoHost
      ? `<button class="header-logo" type="button" data-hanzo-toggle aria-expanded="false" aria-controls="variantSwitcher" title="Hanzo — toggle views" aria-label="Hanzo — toggle view switcher">${logoSvg}</button>`
      : `<a class="header-logo" href="/" title="Hanzo World" aria-label="Hanzo World — home">${logoSvg}</a>`;
    const cloudTab = hanzoHost
      ? `<a href="?variant=cloud"
               class="variant-option ${SITE_VARIANT === 'cloud' ? 'active' : ''}"
               data-variant="cloud" role="tab" aria-selected="${SITE_VARIANT === 'cloud'}"
               title="Cloud${SITE_VARIANT === 'cloud' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon">☁️</span>
              <span class="variant-label">Cloud</span>
            </a>`
      : '';
    this.container.innerHTML = `
      <div class="header">
        <div class="header-left">
          ${logo}
          <div class="variant-switcher${hanzoHost ? ' hanzo-gated' : ''}" id="variantSwitcher" role="tablist" aria-label="View switcher">
            ${cloudTab}<a href="?variant=ai"
               class="variant-option ${SITE_VARIANT === 'ai' ? 'active' : ''}"
               data-variant="ai"
               title="${t('header.ai')}${SITE_VARIANT === 'ai' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon">🤖</span>
              <span class="variant-label">${t('header.ai')}</span>
            </a>
            <a href="?variant=crypto"
               class="variant-option ${SITE_VARIANT === 'crypto' ? 'active' : ''}"
               data-variant="crypto"
               title="${t('header.crypto')}${SITE_VARIANT === 'crypto' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon">₿</span>
              <span class="variant-label">${t('header.crypto')}</span>
            </a>
            <a href="?variant=finance"
               class="variant-option ${SITE_VARIANT === 'finance' ? 'active' : ''}"
               data-variant="finance"
               title="${t('header.finance')}${SITE_VARIANT === 'finance' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon">📈</span>
              <span class="variant-label">${t('header.finance')}</span>
            </a>
            <a href="?variant=tech"
               class="variant-option ${SITE_VARIANT === 'tech' ? 'active' : ''}"
               data-variant="tech"
               title="${t('header.tech')}${SITE_VARIANT === 'tech' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon">💻</span>
              <span class="variant-label">${t('header.tech')}</span>
            </a>
            <a href="?variant=full"
               class="variant-option ${SITE_VARIANT === 'full' ? 'active' : ''}"
               data-variant="full"
               title="${t('header.world')}${SITE_VARIANT === 'full' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon">🌍</span>
              <span class="variant-label">${t('header.world')}</span>
            </a>
          </div>
          <div class="status-indicator">
            <span class="status-dot"></span>
            <span>${t('header.live')}</span>
          </div>
        </div>
        <div class="header-right">
          <button class="search-btn" id="searchBtn"><kbd>⌘K</kbd> <span class="btn-label">${t('header.search')}</span></button>
          <button class="theme-toggle-btn" id="headerThemeToggle" title="${t('header.toggleTheme')}">
            ${getCurrentTheme() === 'dark'
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>'}
          </button>
          <div class="header-account" id="headerAccount"></div>
        </div>
      </div>
      <div class="main-content">
        <div class="panels-grid" id="panelsGrid">
          <div class="panel map-section map-panel" id="mapSection" data-panel="map">
            <!-- Chromeless map: no title/UTC bar. A slim grip (revealed on hover) is
                 the map's drag handle — same .panel-header the panel-drag machinery
                 grabs, just emptied and thinned. Timestamp moved to a corner overlay. -->
            <div class="panel-header map-drag-grip" aria-label="${t('panels.map')} — drag to move"></div>
            <div class="map-container" id="mapContainer"></div>
            <div class="map-timestamp" id="headerClock" aria-hidden="true"></div>
            <div class="map-resize-handle" id="mapResizeHandle"></div>
            <div class="panel-col-resize-handle" id="mapColResizeHandle" title="Drag to change map width"></div>
          </div>
        </div>
      </div>
      ${this.renderDock()}
      <div class="modal-overlay" id="settingsModal">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">${t('header.settings')}</span>
            <button class="modal-close" id="modalClose">×</button>
          </div>
          <div class="panel-toggle-grid" id="panelToggles"></div>
          <div class="panels-modal-footer">
            <span class="panels-modal-hint">Drag a panel to reorder · drag its bottom edge to resize</span>
            <button class="panels-reset-btn" id="resetLayoutBtn" type="button">Reset layout</button>
          </div>
        </div>
      </div>
      <div class="modal-overlay" id="sourcesModal">
        <div class="modal sources-modal">
          <div class="modal-header">
            <span class="modal-title">${t('header.sources')}</span>
            <span class="sources-counter" id="sourcesCounter"></span>
            <button class="modal-close" id="sourcesModalClose">×</button>
          </div>
          <div class="sources-search">
            <input type="text" id="sourcesSearch" placeholder="${t('header.filterSources')}" />
          </div>
          <div class="sources-toggle-grid" id="sourceToggles"></div>
          <div class="sources-footer">
            <button class="sources-select-all" id="sourcesSelectAll">${t('common.selectAll')}</button>
            <button class="sources-select-none" id="sourcesSelectNone">${t('common.selectNone')}</button>
          </div>
        </div>
      </div>
      <div class="modal-overlay" id="addWidgetModal">
        <div class="modal add-widget-modal">
          <div class="modal-header">
            <span class="modal-title">Add widget</span>
            <button class="modal-close" id="addWidgetClose">×</button>
          </div>
          <div class="add-widget-search">
            <input type="text" id="addWidgetSearch" placeholder="Search widgets…" autocomplete="off" />
          </div>
          <div class="add-widget-grid" id="addWidgetGrid"></div>
        </div>
      </div>
    `;

    this.createPanels();
    this.renderPanelToggles();
    this.setupDock();
  }

  // Bottom toolbar dock — the single home for operational controls, split out of
  // the (now identity-only) header. The map mounts its 2D/3D toggle, basemap style
  // switcher and time-range pills into #dockMapControls; the rest are dock chrome.
  // Monochrome, sentence-case, collapsible; horizontally scrollable when narrow so
  // the PAGE never overflows. Layout labels stay literal (dock design language,
  // matching the codebase's literal control strings).
  private renderDock(): string {
    const regionOptions = `
      <option value="global">${t('components.deckgl.views.global')}</option>
      <option value="america">${t('components.deckgl.views.americas')}</option>
      <option value="mena">${t('components.deckgl.views.mena')}</option>
      <option value="eu">${t('components.deckgl.views.europe')}</option>
      <option value="asia">${t('components.deckgl.views.asia')}</option>
      <option value="latam">${t('components.deckgl.views.latam')}</option>
      <option value="africa">${t('components.deckgl.views.africa')}</option>
      <option value="oceania">${t('components.deckgl.views.oceania')}</option>`;
    const immersive = this.isMobile ? '' : `
      <div class="dock-group immersive-controls" id="immersiveControls">
        <span class="dock-sublabel">Background</span>
        <div class="immersive-bg-select" id="immersiveBgSelect" role="group" aria-label="Immersive background">
          <button class="ibg-btn" data-bg="map" title="Map background">Map</button>
          <button class="ibg-btn" data-bg="video" title="Live video background">Video</button>
        </div>
        <button class="dock-btn immersive-collapse-btn" id="immersiveCollapse" title="Collapse panels to the edge" aria-pressed="false">⇤</button>
      </div>`;
    const share = this.isDesktopApp ? '' : `
      <div class="dock-group">
        <button class="dock-btn copy-link-btn" id="copyLinkBtn" title="Copy a shareable link"><span class="dock-ico">🔗</span> <span class="btn-label">Copy link</span></button>
        <button class="dock-btn fullscreen-btn" id="fullscreenBtn" title="Fullscreen"><span class="dock-ico">⛶</span></button>
      </div>`;
    return `
      <footer class="world-dock" id="worldDock" aria-label="Toolbar">
        <button class="dock-collapse" id="dockCollapse" title="Collapse toolbar" aria-expanded="true">▾</button>
        <div class="dock-scroll" id="dockScroll">
          <div class="dock-group dock-map-controls" id="dockMapControls"></div>
          <div class="dock-group">
            <select id="regionSelect" class="region-select" title="Map region" aria-label="Map region">${regionOptions}</select>
          </div>
          <div class="dock-group">
            <button class="dock-btn" id="dockLayersBtn" aria-pressed="false" title="Show or hide map layers"><span class="dock-ico">▤</span> <span class="btn-label">Layers</span></button>
          </div>
          <div class="dock-group dock-layout">
            <label class="dock-select-wrap" title="Layout mode — Grid snaps widgets to the grid, Free is pixel-perfect, Immersive floats them over a full-screen map">
              <select id="dockModeSelect" class="dock-select" aria-label="Layout mode">
                <option value="grid">Grid</option>
                <option value="free">Free</option>
                <option value="immersive">Immersive</option>
              </select>
            </label>
            <label class="dock-slider" title="Widget size">
              <span class="dock-ico">▦</span>
              <input type="range" id="dockGridSize" min="140" max="360" step="20" value="160" aria-label="Widget size" />
            </label>
          </div>
          ${immersive}
          <div class="dock-group">
            <button class="dock-btn dock-add" id="dockAddWidget" title="Add a widget"><span class="dock-ico">＋</span> <span class="btn-label">Add widget</span></button>
          </div>
          <div class="dock-group">
            <button class="dock-btn" id="settingsBtn" title="Show or hide panels"><span class="dock-ico">▦</span> <span class="btn-label">Panels</span></button>
            <button class="dock-btn" id="sourcesBtn" title="Data sources"><span class="dock-ico">📡</span> <span class="btn-label">Sources</span></button>
          </div>
          ${share}
        </div>
      </footer>`;
  }

  /**
   * Render critical military posture banner when buildup detected
   */
  private renderCriticalBanner(postures: TheaterPostureSummary[]): void {
    if (this.isMobile) {
      if (this.criticalBannerEl) {
        this.criticalBannerEl.remove();
        this.criticalBannerEl = null;
      }
      document.body.classList.remove('has-critical-banner');
      return;
    }

    // Check if banner was dismissed this session
    const dismissedAt = sessionStorage.getItem('banner-dismissed');
    if (dismissedAt && Date.now() - parseInt(dismissedAt, 10) < 30 * 60 * 1000) {
      return; // Stay dismissed for 30 minutes
    }

    const critical = postures.filter(
      (p) => p.postureLevel === 'critical' || (p.postureLevel === 'elevated' && p.strikeCapable)
    );

    if (critical.length === 0) {
      if (this.criticalBannerEl) {
        this.criticalBannerEl.remove();
        this.criticalBannerEl = null;
        document.body.classList.remove('has-critical-banner');
      }
      return;
    }

    const top = critical[0]!;
    const isCritical = top.postureLevel === 'critical';

    if (!this.criticalBannerEl) {
      this.criticalBannerEl = document.createElement('div');
      this.criticalBannerEl.className = 'critical-posture-banner';
      const header = document.querySelector('.header');
      if (header) header.insertAdjacentElement('afterend', this.criticalBannerEl);
    }

    // Always ensure body class is set when showing banner
    document.body.classList.add('has-critical-banner');
    this.criticalBannerEl.className = `critical-posture-banner ${isCritical ? 'severity-critical' : 'severity-elevated'}`;
    this.criticalBannerEl.innerHTML = `
      <div class="banner-content">
        <span class="banner-icon">${isCritical ? '🚨' : '⚠️'}</span>
        <span class="banner-headline">${top.headline}</span>
        <span class="banner-stats">${top.totalAircraft} aircraft • ${top.summary}</span>
        ${top.strikeCapable ? '<span class="banner-strike">STRIKE CAPABLE</span>' : ''}
      </div>
      <button class="banner-view" data-lat="${top.centerLat}" data-lon="${top.centerLon}">View Region</button>
      <button class="banner-dismiss">×</button>
    `;

    // Event handlers
    this.criticalBannerEl.querySelector('.banner-view')?.addEventListener('click', () => {
      console.log('[Banner] View Region clicked:', top.theaterId, 'lat:', top.centerLat, 'lon:', top.centerLon);
      // Use typeof check - truthy check would fail for coordinate 0
      if (typeof top.centerLat === 'number' && typeof top.centerLon === 'number') {
        this.map?.setCenter(top.centerLat, top.centerLon, 4);
      } else {
        console.error('[Banner] Missing coordinates for', top.theaterId);
      }
    });

    this.criticalBannerEl.querySelector('.banner-dismiss')?.addEventListener('click', () => {
      this.criticalBannerEl?.classList.add('dismissed');
      document.body.classList.remove('has-critical-banner');
      document.documentElement.style.removeProperty('--critical-banner-h');
      sessionStorage.setItem('banner-dismissed', Date.now().toString());
    });

    // Pad the grid by the banner's REAL height (it wraps at narrow widths), so the
    // fixed banner never hides the first row or leaves a gap.
    requestAnimationFrame(() => {
      const h = this.criticalBannerEl?.offsetHeight;
      if (h) document.documentElement.style.setProperty('--critical-banner-h', `${h}px`);
    });
  }

  /**
   * Clean up resources (for HMR/testing)
   */
  public destroy(): void {
    this.isDestroyed = true;

    // Clear snapshot saving interval
    if (this.snapshotIntervalId) {
      clearInterval(this.snapshotIntervalId);
      this.snapshotIntervalId = null;
    }

    // Clear all refresh timeouts
    for (const timeoutId of this.refreshTimeoutIds.values()) {
      clearTimeout(timeoutId);
    }
    this.refreshTimeoutIds.clear();

    // Remove global event listeners
    if (this.boundKeydownHandler) {
      document.removeEventListener('keydown', this.boundKeydownHandler);
      this.boundKeydownHandler = null;
    }
    if (this.boundFullscreenHandler) {
      document.removeEventListener('fullscreenchange', this.boundFullscreenHandler);
      this.boundFullscreenHandler = null;
    }
    if (this.boundResizeHandler) {
      window.removeEventListener('resize', this.boundResizeHandler);
      this.boundResizeHandler = null;
    }
    if (this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }

    // Clean up idle detection
    if (this.idleTimeoutId) {
      clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }
    if (this.boundIdleResetHandler) {
      ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(event => {
        document.removeEventListener(event, this.boundIdleResetHandler!);
      });
      this.boundIdleResetHandler = null;
    }

    // Clean up map and AIS
    this.mapResizeObserver?.disconnect();
    this.mapResizeObserver = null;
    this.map?.destroy();
    disconnectAisStream();
  }

  private createPanels(): void {
    const panelsGrid = document.getElementById('panelsGrid')!;

    // Initialize map in the map section
    // Default to MENA view on mobile for better focus
    // Uses deck.gl (WebGL) on desktop, falls back to D3/SVG on mobile
    const mapContainer = document.getElementById('mapContainer') as HTMLElement;
    this.map = new MapContainer(mapContainer, {
      zoom: this.isMobile ? 2.5 : 1.0,
      pan: { x: 0, y: 0 },  // Centered view to show full world
      view: this.isMobile ? 'mena' : 'global',
      layers: this.mapLayers,
      timeRange: '7d',
      mode: this.resolveInitialMapMode(),
      // Dock the 2D/3D toggle, basemap switcher and time-range pills IN the map
      // (the standard in-map control cluster) — alongside the zoom, layer toggles
      // and legend that already overlay it — rather than floating them in the
      // bottom toolbar. Undefined ⇒ DeckGLMap mounts controls in its own container.
      controlsHost: undefined,
    });

    // Initialize escalation service with data getters
    this.map.initEscalationGetters();
    this.currentTimeRange = this.map.getTimeRange();

    // Create all panels
    const politicsPanel = new NewsPanel('politics', t('panels.politics'));
    this.attachRelatedAssetHandlers(politicsPanel);
    this.newsPanels['politics'] = politicsPanel;
    this.panels['politics'] = politicsPanel;

    const techPanel = new NewsPanel('tech', t('panels.tech'));
    this.attachRelatedAssetHandlers(techPanel);
    this.newsPanels['tech'] = techPanel;
    this.panels['tech'] = techPanel;

    const financePanel = new NewsPanel('finance', t('panels.finance'));
    this.attachRelatedAssetHandlers(financePanel);
    this.newsPanels['finance'] = financePanel;
    this.panels['finance'] = financePanel;

    const heatmapPanel = new HeatmapPanel();
    this.panels['heatmap'] = heatmapPanel;

    const marketsPanel = new MarketPanel();
    this.panels['markets'] = marketsPanel;

    const monitorPanel = new MonitorPanel(this.monitors);
    this.panels['monitors'] = monitorPanel;
    monitorPanel.onChanged((monitors) => {
      this.monitors = monitors;
      void saveUserMonitors(monitors); // localStorage + the Go backend when signed in
      this.updateMonitorResults();
    });

    this.panels['watch'] = new WatchQueuePanel();

    const commoditiesPanel = new CommoditiesPanel();
    this.panels['commodities'] = commoditiesPanel;

    // Self-polling monochrome finance data panels (FX + treasury yields).
    const fxPanel = new FxPanel();
    this.panels['fx'] = fxPanel;

    const yieldsPanel = new YieldsPanel();
    this.panels['yields'] = yieldsPanel;

    const predictionPanel = new PredictionPanel();
    this.panels['polymarket'] = predictionPanel;

    const govPanel = new NewsPanel('gov', t('panels.gov'));
    this.attachRelatedAssetHandlers(govPanel);
    this.newsPanels['gov'] = govPanel;
    this.panels['gov'] = govPanel;

    const intelPanel = new NewsPanel('intel', t('panels.intel'));
    this.attachRelatedAssetHandlers(intelPanel);
    this.newsPanels['intel'] = intelPanel;
    this.panels['intel'] = intelPanel;

    const cryptoPanel = new CryptoPanel();
    this.panels['crypto'] = cryptoPanel;

    const middleeastPanel = new NewsPanel('middleeast', t('panels.middleeast'));
    this.attachRelatedAssetHandlers(middleeastPanel);
    this.newsPanels['middleeast'] = middleeastPanel;
    this.panels['middleeast'] = middleeastPanel;

    const layoffsPanel = new NewsPanel('layoffs', t('panels.layoffs'));
    this.attachRelatedAssetHandlers(layoffsPanel);
    this.newsPanels['layoffs'] = layoffsPanel;
    this.panels['layoffs'] = layoffsPanel;

    const aiPanel = new NewsPanel('ai', t('panels.ai'));
    this.attachRelatedAssetHandlers(aiPanel);
    this.newsPanels['ai'] = aiPanel;
    this.panels['ai'] = aiPanel;

    // Tech variant panels
    const startupsPanel = new NewsPanel('startups', t('panels.startups'));
    this.attachRelatedAssetHandlers(startupsPanel);
    this.newsPanels['startups'] = startupsPanel;
    this.panels['startups'] = startupsPanel;

    const vcblogsPanel = new NewsPanel('vcblogs', t('panels.vcblogs'));
    this.attachRelatedAssetHandlers(vcblogsPanel);
    this.newsPanels['vcblogs'] = vcblogsPanel;
    this.panels['vcblogs'] = vcblogsPanel;

    const regionalStartupsPanel = new NewsPanel('regionalStartups', t('panels.regionalStartups'));
    this.attachRelatedAssetHandlers(regionalStartupsPanel);
    this.newsPanels['regionalStartups'] = regionalStartupsPanel;
    this.panels['regionalStartups'] = regionalStartupsPanel;

    const unicornsPanel = new NewsPanel('unicorns', t('panels.unicorns'));
    this.attachRelatedAssetHandlers(unicornsPanel);
    this.newsPanels['unicorns'] = unicornsPanel;
    this.panels['unicorns'] = unicornsPanel;

    const acceleratorsPanel = new NewsPanel('accelerators', t('panels.accelerators'));
    this.attachRelatedAssetHandlers(acceleratorsPanel);
    this.newsPanels['accelerators'] = acceleratorsPanel;
    this.panels['accelerators'] = acceleratorsPanel;

    const fundingPanel = new NewsPanel('funding', t('panels.funding'));
    this.attachRelatedAssetHandlers(fundingPanel);
    this.newsPanels['funding'] = fundingPanel;
    this.panels['funding'] = fundingPanel;

    const producthuntPanel = new NewsPanel('producthunt', t('panels.producthunt'));
    this.attachRelatedAssetHandlers(producthuntPanel);
    this.newsPanels['producthunt'] = producthuntPanel;
    this.panels['producthunt'] = producthuntPanel;

    const securityPanel = new NewsPanel('security', t('panels.security'));
    this.attachRelatedAssetHandlers(securityPanel);
    this.newsPanels['security'] = securityPanel;
    this.panels['security'] = securityPanel;

    const policyPanel = new NewsPanel('policy', t('panels.policy'));
    this.attachRelatedAssetHandlers(policyPanel);
    this.newsPanels['policy'] = policyPanel;
    this.panels['policy'] = policyPanel;

    const hardwarePanel = new NewsPanel('hardware', t('panels.hardware'));
    this.attachRelatedAssetHandlers(hardwarePanel);
    this.newsPanels['hardware'] = hardwarePanel;
    this.panels['hardware'] = hardwarePanel;

    const cloudPanel = new NewsPanel('cloud', t('panels.cloud'));
    this.attachRelatedAssetHandlers(cloudPanel);
    this.newsPanels['cloud'] = cloudPanel;
    this.panels['cloud'] = cloudPanel;

    const devPanel = new NewsPanel('dev', t('panels.dev'));
    this.attachRelatedAssetHandlers(devPanel);
    this.newsPanels['dev'] = devPanel;
    this.panels['dev'] = devPanel;

    const githubPanel = new NewsPanel('github', t('panels.github'));
    this.attachRelatedAssetHandlers(githubPanel);
    this.newsPanels['github'] = githubPanel;
    this.panels['github'] = githubPanel;

    const ipoPanel = new NewsPanel('ipo', t('panels.ipo'));
    this.attachRelatedAssetHandlers(ipoPanel);
    this.newsPanels['ipo'] = ipoPanel;
    this.panels['ipo'] = ipoPanel;

    const thinktanksPanel = new NewsPanel('thinktanks', t('panels.thinktanks'));
    this.attachRelatedAssetHandlers(thinktanksPanel);
    this.newsPanels['thinktanks'] = thinktanksPanel;
    this.panels['thinktanks'] = thinktanksPanel;

    const economicPanel = new EconomicPanel();
    this.panels['economic'] = economicPanel;

    // New Regional Panels
    const africaPanel = new NewsPanel('africa', t('panels.africa'));
    this.attachRelatedAssetHandlers(africaPanel);
    this.newsPanels['africa'] = africaPanel;
    this.panels['africa'] = africaPanel;

    const latamPanel = new NewsPanel('latam', t('panels.latam'));
    this.attachRelatedAssetHandlers(latamPanel);
    this.newsPanels['latam'] = latamPanel;
    this.panels['latam'] = latamPanel;

    const asiaPanel = new NewsPanel('asia', t('panels.asia'));
    this.attachRelatedAssetHandlers(asiaPanel);
    this.newsPanels['asia'] = asiaPanel;
    this.panels['asia'] = asiaPanel;

    const energyPanel = new NewsPanel('energy', t('panels.energy'));
    this.attachRelatedAssetHandlers(energyPanel);
    this.newsPanels['energy'] = energyPanel;
    this.panels['energy'] = energyPanel;

    // Dynamically create NewsPanel instances for any FEEDS category.
    // If a category key collides with an existing data panel key (e.g. markets),
    // create a separate `${key}-news` panel to avoid clobbering the data panel.
    for (const key of Object.keys(FEEDS)) {
      if (this.newsPanels[key]) continue;
      if (!Array.isArray((FEEDS as Record<string, unknown>)[key])) continue;
      const panelKey = this.panels[key] && !this.newsPanels[key] ? `${key}-news` : key;
      if (this.panels[panelKey]) continue;
      const panelConfig = DEFAULT_PANELS[panelKey] ?? DEFAULT_PANELS[key];
      const label = panelConfig?.name ?? key.charAt(0).toUpperCase() + key.slice(1);
      const panel = new NewsPanel(panelKey, label);
      this.attachRelatedAssetHandlers(panel);
      this.newsPanels[key] = panel;
      this.panels[panelKey] = panel;
    }

    // Geopolitical-only panels (not needed for tech variant)
    if (SITE_VARIANT === 'full') {
      const gdeltIntelPanel = new GdeltIntelPanel();
      this.panels['gdelt-intel'] = gdeltIntelPanel;

      const ciiPanel = new CIIPanel();
      ciiPanel.setShareStoryHandler((code, name) => {
        this.openCountryStory(code, name);
      });
      this.panels['cii'] = ciiPanel;

      const cascadePanel = new CascadePanel();
      this.panels['cascade'] = cascadePanel;

      const satelliteFiresPanel = new SatelliteFiresPanel();
      this.panels['satellite-fires'] = satelliteFiresPanel;

      const strategicRiskPanel = new StrategicRiskPanel();
      strategicRiskPanel.setLocationClickHandler((lat, lon) => {
        this.map?.setCenter(lat, lon, 4);
      });
      this.panels['strategic-risk'] = strategicRiskPanel;

      const strategicPosturePanel = new StrategicPosturePanel();
      strategicPosturePanel.setLocationClickHandler((lat, lon) => {
        console.log('[App] StrategicPosture handler called:', { lat, lon, hasMap: !!this.map });
        this.map?.setCenter(lat, lon, 4);
      });
      this.panels['strategic-posture'] = strategicPosturePanel;

      const ucdpEventsPanel = new UcdpEventsPanel();
      ucdpEventsPanel.setEventClickHandler((lat, lon) => {
        this.map?.setCenter(lat, lon, 5);
      });
      this.panels['ucdp-events'] = ucdpEventsPanel;

      const displacementPanel = new DisplacementPanel();
      displacementPanel.setCountryClickHandler((lat, lon) => {
        this.map?.setCenter(lat, lon, 4);
      });
      this.panels['displacement'] = displacementPanel;

      const climatePanel = new ClimateAnomalyPanel();
      climatePanel.setZoneClickHandler((lat, lon) => {
        this.map?.setCenter(lat, lon, 4);
      });
      this.panels['climate'] = climatePanel;

      const populationExposurePanel = new PopulationExposurePanel();
      this.panels['population-exposure'] = populationExposurePanel;
    }

    // GCC Investments Panel (finance variant)
    if (SITE_VARIANT === 'finance') {
      const investmentsPanel = new InvestmentsPanel((inv) => {
        focusInvestmentOnMap(this.map, this.mapLayers, inv.lat, inv.lon);
      });
      this.panels['gcc-investments'] = investmentsPanel;
    }

    // Cloud flagship panels — the live-traffic globe's companion tiles: Cloud
    // metrics, router/Enso training + flywheel, AI compute, model mix, fleet,
    // uptime, and the caller's own org usage + bill.
    if (SITE_VARIANT === 'cloud') {
      this.panels['cloud-overview'] = new CloudOverviewPanel();
      this.panels['traffic-globe'] = new TrafficGlobePanel();
      this.panels['model-improvement'] = new ModelImprovementPanel();
      this.panels['enso-training'] = new EnsoTrainingPanel();
      this.panels['enso-flywheel'] = new EnsoFlywheelPanel();
      this.panels['ai-compute'] = new AiComputePanel();
      this.panels['model-usage'] = new ModelUsagePanel();
      const fleetPanel = new FleetPanel();
      fleetPanel.setLocationClickHandler((lat, lon) => {
        this.map?.setCenter(lat, lon, 4);
      });
      this.panels['fleet'] = fleetPanel;
      this.panels['live-activity'] = new LiveActivityPanel();
      this.panels['my-usage'] = new MyUsagePanel();
      // Full Hanzo Cloud status page, embedded from status.hanzo.ai (public —
      // NOT admin-gated).
      this.panels['hanzo-status'] = new HanzoStatusPanel();
    }

    // Live Hanzo inference telemetry: AI Compute (ai-pulse SSE) + Enso Flywheel
    // (routing ledger + evals). On the AI variant AND the default (full) world —
    // the platform's own compute/training pulse is front-page telemetry, not a
    // variant-only easter egg.
    if (SITE_VARIANT === 'ai' || SITE_VARIANT === 'full') {
      this.panels['ai-compute'] = new AiComputePanel();
      this.panels['enso-flywheel'] = new EnsoFlywheelPanel();
    }

    // Chains widget — live block heights + peers (hanzo + crypto variants).
    if (SITE_VARIANT === 'cloud' || SITE_VARIANT === 'crypto') {
      this.panels['chains'] = new BlockchainPanel();
    }

    const liveNewsPanel = new LiveNewsPanel();
    this.panels['live-news'] = liveNewsPanel;

    const liveWebcamsPanel = new LiveWebcamsPanel();
    this.panels['live-webcams'] = liveWebcamsPanel;

    // Tech Events Panel (tech variant only - but create for all to allow toggling)
    this.panels['events'] = new TechEventsPanel('events');

    // Service Status Panel (primarily for tech variant)
    const serviceStatusPanel = new ServiceStatusPanel();
    this.panels['service-status'] = serviceStatusPanel;

    if (this.isDesktopApp) {
      const runtimeConfigPanel = new RuntimeConfigPanel({ mode: 'alert' });
      this.panels['runtime-config'] = runtimeConfigPanel;
    }

    // Tech Readiness Panel (tech variant only - World Bank tech indicators)
    const techReadinessPanel = new TechReadinessPanel();
    this.panels['tech-readiness'] = techReadinessPanel;

    // Crypto & Market Intelligence Panels
    this.panels['macro-signals'] = new MacroSignalsPanel();
    this.panels['etf-flows'] = new ETFFlowsPanel();
    this.panels['stablecoins'] = new StablecoinPanel();
    this.panels['sentiment'] = new SentimentPanel();
    this.panels['trader-desk'] = new TraderDeskPanel();

    // AI Insights Panel (desktop only - hides itself on mobile)
    const insightsPanel = new InsightsPanel();
    this.panels['insights'] = insightsPanel;

    // AI Analyst — chat with live data + agentic control surface (all variants)
    this.panels['ai-analyst'] = new AiAnalystPanel(this.buildAnalystHost());

    // Add panels to grid in saved order
    // Use DEFAULT_PANELS keys for variant-aware panel order
    const defaultOrder = Object.keys(DEFAULT_PANELS).filter(k => k !== 'map');
    const savedOrder = this.getSavedPanelOrder();
    // Merge saved order with default to include new panels
    let panelOrder = defaultOrder;
    if (savedOrder.length > 0) {
      // Add any missing panels from default that aren't in saved order
      const missing = defaultOrder.filter(k => !savedOrder.includes(k));
      // Remove any saved panels that no longer exist
      const valid = savedOrder.filter(k => defaultOrder.includes(k));
      // Insert missing panels after 'politics' (except monitors which goes at end)
      const monitorsIdx = valid.indexOf('monitors');
      if (monitorsIdx !== -1) valid.splice(monitorsIdx, 1); // Remove monitors temporarily
      const insertIdx = valid.indexOf('politics') + 1 || 0;
      const newPanels = missing.filter(k => k !== 'monitors');
      valid.splice(insertIdx, 0, ...newPanels);
      valid.push('monitors'); // Always put monitors last
      panelOrder = valid;
    }

    // CRITICAL: live-news MUST be first for CSS Grid layout (spans 2 columns)
    // Move it to position 0 if it exists and isn't already first
    const liveNewsIdx = panelOrder.indexOf('live-news');
    if (liveNewsIdx > 0) {
      panelOrder.splice(liveNewsIdx, 1);
      panelOrder.unshift('live-news');
    }

    // Hanzo: live-webcams is off by default (dead "not available" clutter); no
    // longer force-inserted after live-news.

    // Desktop configuration should stay easy to reach in Tauri builds.
    if (this.isDesktopApp) {
      const runtimeIdx = panelOrder.indexOf('runtime-config');
      if (runtimeIdx > 1) {
        panelOrder.splice(runtimeIdx, 1);
        panelOrder.splice(1, 0, 'runtime-config');
      } else if (runtimeIdx === -1) {
        panelOrder.splice(1, 0, 'runtime-config');
      }
    }

    panelOrder.forEach((key: string) => {
      const panel = this.panels[key];
      if (panel) {
        const el = panel.getElement();
        this.makeDraggable(el, key);
        panelsGrid.appendChild(el);
      }
    });

    // Restore any analyst-created custom feed panels (appended after the grid loop).
    this.mountCustomFeedPanels();

    this.map.onTimeRangeChanged((range) => {
      this.currentTimeRange = range;
      this.applyTimeRangeFilterToNewsPanelsDebounced();
    });

    this.applyPanelSettings();
    this.applyInitialUrlState();
    // Heal any stale/saved state that left a panel ahead of the full-width map.
    this.healMapAnchor();

    // Floating AI analyst launcher — available on every variant, independent of
    // whether the in-grid analyst panel is shown. Same host, same code path.
    if (!this.analystDock) {
      this.analystDock = new AiAnalystDock(this.buildAnalystHost());
      this.analystDock.attach();
      // Right-click → "Summarize with AI" on any headline routes into the SAME
      // analyst dock (no second AI path, no bespoke summarizer).
      registerSummarizePort((headline, url) => {
        const q = url
          ? `Summarize this story and why it matters: "${headline}" (${url})`
          : `Summarize this story and why it matters: "${headline}"`;
        this.analystDock?.askInDock(q);
      });
    }

    // Cloud tab: the deep operator panels are admin-org only (server enforces
    // 403). Mount them once, only after the owner claim confirms admin.
    void this.mountAdminCloudPanels();
  }

  // ── admin-only Cloud console panels ─────────────────────────────────────────
  // Constructed and appended only for the admin org; non-admins never receive
  // them (and every backing endpoint fail-closes 403). Idempotent.
  private async mountAdminCloudPanels(): Promise<void> {
    if (SITE_VARIANT !== 'cloud' || this.adminCloudMounted) return;
    if (!(await isAdmin())) return;
    const grid = document.getElementById('panelsGrid');
    if (!grid) return;
    this.adminCloudMounted = true;
    const defs: Array<[string, Panel, string]> = [
      ['cloud-services', new CloudServicesPanel(), 'Service status'],
      ['cloud-fleet', new CloudFleetPanel(), 'Fleet & clusters'],
      ['llm-usage', new LlmUsagePanel(), 'LLM observability'],
      ['cloud-analytics', new CloudAnalyticsPanel(), 'Web analytics'],
    ];
    for (const [key, panel, name] of defs) {
      if (this.panels[key]) continue;
      this.panels[key] = panel;
      if (!this.panelSettings[key]) this.panelSettings[key] = { name, enabled: true, priority: 1 };
      const el = panel.getElement();
      this.makeDraggable(el, key);
      grid.appendChild(el);
    }
    saveToStorage(STORAGE_KEYS.panels, this.panelSettings);
    this.applyPanelSettings();
    this.renderPanelToggles();
  }

  // Initial 2D/3D map mode: URL (?mode=3d) wins, then persisted preference,
  // then default flat map.
  private resolveInitialMapMode(): MapProjectionMode {
    if (this.initialUrlState?.mode) return this.initialUrlState.mode;
    return localStorage.getItem(this.MAP_MODE_STORAGE_KEY) === '3d' ? '3d' : '2d';
  }

  private applyInitialUrlState(): void {
    if (!this.initialUrlState || !this.map) return;

    const { view, zoom, lat, lon, timeRange, layers } = this.initialUrlState;

    if (timeRange) {
      this.map.setTimeRange(timeRange);
    }

    if (layers) {
      this.mapLayers = layers;
      saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);
      this.map.setLayers(layers);
    }

    // A real REGION preset (america/mena/eu/…) owns the camera; 'global' is the
    // free-camera default (share links + variant-switch restore both emit it), so
    // it must NOT reset — honor the URL's exact zoom/center instead. Calling
    // setView('global') here would snap back to the preset and lose the position,
    // which is exactly why a shared/pinned camera never restored.
    const isRegionPreset = !!view && view !== 'global';
    if (isRegionPreset) {
      this.map.setView(view);
    } else if (lat !== undefined && lon !== undefined && zoom !== undefined && zoom > 2) {
      // At default zoom (~1-1.5) the centre barely matters and off-centre globes
      // clip oddly; restore the exact camera in one move once the user was zoomed in.
      this.map.setCenter(lat, lon, zoom);
    } else if (zoom !== undefined) {
      this.map.setZoom(zoom);
    }

    // Sync header region selector with initial view
    const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
    const currentView = this.map.getState().view;
    if (regionSelect && currentView) {
      regionSelect.value = currentView;
    }
  }

  private getSavedPanelOrder(): string[] {
    try {
      const saved = localStorage.getItem(this.PANEL_ORDER_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  }

  private savePanelOrder(): void {
    const grid = document.getElementById('panelsGrid');
    if (!grid) return;
    const order = Array.from(grid.children)
      .map((el) => (el as HTMLElement).dataset.panel)
      .filter((key): key is string => !!key);
    localStorage.setItem(this.PANEL_ORDER_KEY, JSON.stringify(order));
  }

  /** True when the map panel currently spans the full grid width (its default). */
  private mapIsFullWidth(): boolean {
    const mapSection = document.getElementById('mapSection');
    if (!mapSection) return false;
    const gc = mapSection.style.gridColumn;
    if (!gc || gc === '1 / -1') return true;
    return this.currentMapCols() >= this.gridColumnCount();
  }

  /**
   * Invariant: a FULL-WIDTH map must be the first grid child. CSS Grid otherwise
   * wraps whatever panel precedes it into row 1 (a thin sliver top-left) and
   * shoves the full-width map down a row, leaving a black void under the header —
   * the exact broken layout from the CTO screenshots. This is the single heal
   * chokepoint: cheap, idempotent, called after every layout mutation (load,
   * drag-commit, width resize). A half-width map may legitimately share row 1, so
   * the heal only fires while the map is full-width.
   */
  private healMapAnchor(): void {
    const grid = document.getElementById('panelsGrid');
    const mapSection = document.getElementById('mapSection');
    if (!grid || !mapSection || mapSection.parentElement !== grid) return;
    if (!this.mapIsFullWidth()) return;
    if (grid.firstElementChild === mapSection) return;
    grid.insertBefore(mapSection, grid.firstElementChild);
    this.savePanelOrder();
  }

  // ── AI Analyst host (agentic control surface) ───────────────────────────────
  // The narrow port the AI analyst drives. All dashboard mutation stays here in
  // App; the analyst services only see this interface.
  private buildAnalystHost(): AnalystHost {
    // Prime the org snapshot once (async) so listOrgs()/switch_org have real ids.
    if (isAuthenticated() && !this.analystOrgs.length) {
      void listOrgs().then((orgs) => {
        this.analystOrgs = orgs.map((o) => ({ id: o.name, name: o.displayName || o.name }));
      });
    }
    return {
      getState: () => ({
        variant: SITE_VARIANT,
        timeRange: this.currentTimeRange,
        mapMode: this.map?.getProjectionMode(),
        region: this.map?.getState().view,
        theme: getCurrentTheme(),
        authed: isAuthenticated(),
        layoutMode: this.immersive?.getState().enabled ? 'immersive' : this.gridApi().getLayoutMode(),
        immersiveBg: this.immersive?.getState().background,
        language: getCurrentLanguage(),
        monitors: this.monitors.map((m) => ({ id: m.id, keywords: m.keywords })),
        queue: {
          total: watchQueue.length,
          unwatched: watchQueue.unwatchedCount(),
          current: watchQueue.current()?.title,
        },
      }),
      listPanels: () =>
        Object.entries(this.panelSettings)
          .filter(([k]) => k !== 'runtime-config' || this.isDesktopApp)
          .map(([key, cfg]) => ({ key, name: this.getLocalizedPanelName(key, cfg.name), enabled: !!cfg.enabled })),
      listLayers: () => Object.entries(this.mapLayers).map(([key, on]) => ({ key, on: !!on })),
      listOrgs: () => this.analystOrgs,
      isAuthed: () => isAuthenticated(),
      showPanel: (key) => this.setPanelEnabled(key, true),
      hidePanel: (key) => this.setPanelEnabled(key, false),
      movePanel: (key, opts) => this.movePanelInGrid(key, opts),
      resizePanel: (key, span) => this.resizePanelInGrid(key, span),
      toggleLayer: (key, on) => this.setMapLayerEnabled(key, on),
      setMapMode: (mode) => this.setMapProjection(mode),
      flyTo: (lat, lon, zoom) => this.flyMapTo(lat, lon, zoom),
      setRegion: (region) => this.setMapRegion(region),
      setTimeRange: (range) => this.setGlobalTimeRange(range),
      setVariant: (variant) => this.setSiteVariant(variant),
      setTheme: (theme) => this.setAppTheme(theme),
      search: (query) => this.runSearch(query),
      resetLayout: () => this.resetPanelLayout(),
      queueVideo: (query) => this.queueVideoToWatch(query),
      setLayoutMode: (mode) => this.setLayoutModeFromCommand(mode),
      setImmersiveBackground: (bg) => this.setImmersiveBackgroundFromCommand(bg),
      setLanguage: (code) => this.setLanguageFromCommand(code),
      addMonitor: (keywords) => this.addMonitorFromCommand(keywords),
      removeMonitor: (id) => this.removeMonitorFromCommand(id),
      queueNext: () => {
        if (!watchQueue.length) return { ok: false };
        return { ok: true, title: watchQueue.next()?.title };
      },
      queuePrev: () => {
        if (!watchQueue.length) return { ok: false };
        return { ok: true, title: watchQueue.prev()?.title };
      },
      addFeedPanel: (name, url) => this.addCustomFeedPanel(name, url),
      removeCustomPanel: (name) => this.removeCustomFeedPanel(name),
      switchOrg: (org) => this.switchActiveOrg(org),
    };
  }

  // ── New analyst capabilities (drive existing public APIs; no new plumbing) ──

  // Resolve a free-text query to a video and put it in the persistent Watch
  // Queue (survives reload — the whole point), then show the panel and play it.
  private async queueVideoToWatch(query: string): Promise<{ ok: boolean; note?: string; title?: string }> {
    try {
      const [hit] = await searchYouTube(query);
      if (!hit) return { ok: false, note: 'no video found' };
      watchQueue.enqueue({
        id: `yt:${hit.id}`,
        kind: 'video',
        title: hit.title,
        source: hit.channel,
        ref: hit.id,
        thumbnail: hit.thumbnail,
        link: `https://www.youtube.com/watch?v=${hit.id}`,
      });
      watchQueue.select(`yt:${hit.id}`);
      this.setPanelEnabled('watch', true);
      return { ok: true, title: hit.title };
    } catch {
      return { ok: false, note: 'search is unavailable' };
    }
  }

  // Layout mode: the analyst drives the SAME setDockMode the dock select drives,
  // so the select and the AI can never disagree about the mode.
  private setLayoutModeFromCommand(mode: 'grid' | 'free' | 'immersive'): boolean {
    this.setDockMode(mode);
    this.syncModeSelect();
    const now = this.immersive?.getState().enabled ? 'immersive' : this.gridApi().getLayoutMode();
    return now === mode;
  }

  private setImmersiveBackgroundFromCommand(bg: 'map' | 'video'): boolean {
    if (!this.immersive?.getState().enabled) return false; // honest: immersive is off
    this.immersive.setBackground(bg);
    return this.immersive.getState().background === bg;
  }

  private setLanguageFromCommand(code: string): boolean {
    if (!LANGUAGES.some((l) => l.code === code)) return false;
    changeLanguage(code);
    return true;
  }

  // "Watch for X" — the same path the Monitors panel takes, so a monitor added by
  // the analyst is persisted (and matched server-side) exactly like a typed one.
  private addMonitorFromCommand(keywords: string): { ok: boolean; id?: string } {
    const list = keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
    if (!list.length) return { ok: false };
    const monitor: Monitor = {
      id: generateId(),
      keywords: list,
      color: MONITOR_COLORS[this.monitors.length % MONITOR_COLORS.length] ?? getCSSColor('--status-live'),
    };
    this.monitors = [...this.monitors, monitor];
    (this.panels['monitors'] as MonitorPanel | undefined)?.setMonitors(this.monitors);
    void saveUserMonitors(this.monitors);
    this.updateMonitorResults();
    return { ok: true, id: monitor.id };
  }

  private removeMonitorFromCommand(id: string): boolean {
    const next = this.monitors.filter((m) => m.id !== id);
    if (next.length === this.monitors.length) return false;
    this.monitors = next;
    (this.panels['monitors'] as MonitorPanel | undefined)?.setMonitors(next);
    void saveUserMonitors(next);
    this.updateMonitorResults();
    return true;
  }

  private resizePanelInGrid(key: string, span: number): boolean {
    const s = Math.max(1, Math.min(4, Math.round(span)));
    const el = key === 'map' ? document.getElementById('mapSection') : this.panels[key]?.getElement();
    if (!el) return false;
    setSpanClass(el, s);
    savePanelSpan(key, s);
    return true;
  }

  private setMapProjection(mode: '2d' | '3d'): boolean {
    if (!this.map) return false;
    this.map.setProjectionMode(mode);
    localStorage.setItem(this.MAP_MODE_STORAGE_KEY, mode);
    // On the SVG fallback the globe is unavailable, so a 3d request stays 2d —
    // report honestly rather than claiming success.
    return this.map.getProjectionMode() === mode;
  }

  private flyMapTo(lat: number, lon: number, zoom?: number): boolean {
    if (!this.map || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    const z = typeof zoom === 'number' && zoom > 0 ? zoom : undefined;
    this.map.setCenter(lat, lon, z);
    return true;
  }

  private setMapRegion(region: string): boolean {
    if (!this.map) return false;
    const valid: MapView[] = ['global', 'america', 'mena', 'eu', 'asia', 'latam', 'africa', 'oceania'];
    if (!valid.includes(region as MapView)) return false;
    this.map.setView(region as MapView);
    const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement | null;
    if (regionSelect) regionSelect.value = region;
    return true;
  }

  private setAppTheme(theme: 'dark' | 'light'): boolean {
    if (theme !== 'dark' && theme !== 'light') return false;
    setTheme(theme);
    return true;
  }

  private runSearch(query: string): boolean {
    if (!this.searchModal || !query.trim()) return false;
    this.searchModal.open(query);
    return true;
  }

  private async switchActiveOrg(org: string): Promise<{ ok: boolean; note?: string }> {
    if (!isAuthenticated()) return { ok: false, note: 'sign in first' };
    const orgs = await listOrgs();
    if (!orgs.some((o) => o.name === org)) return { ok: false, note: 'unknown org' };
    setActiveOrg(org);
    window.location.reload();
    return { ok: true };
  }

  private setPanelEnabled(key: string, enabled: boolean): boolean {
    const cfg = this.panelSettings[key];
    if (!cfg) return false;
    cfg.enabled = enabled;
    saveToStorage(STORAGE_KEYS.panels, this.panelSettings);
    this.applyPanelSettings();
    this.renderPanelToggles();
    return true;
  }

  private movePanelInGrid(
    key: string,
    opts: { before?: string; after?: string; position?: 'top' | 'bottom' },
  ): boolean {
    // live-news spans two columns and MUST stay first (CSS grid) — never move it.
    if (key === 'live-news') return false;
    const grid = document.getElementById('panelsGrid');
    const el = this.panels[key]?.getElement();
    if (!grid || !el || el.parentElement !== grid) return false;

    if (opts.position === 'top') {
      const liveNews = this.panels['live-news']?.getElement();
      if (liveNews && liveNews.parentElement === grid && liveNews !== el) {
        grid.insertBefore(el, liveNews.nextSibling);
      } else {
        grid.insertBefore(el, grid.firstElementChild);
      }
    } else if (opts.position === 'bottom') {
      grid.appendChild(el);
    } else {
      const anchorKey = opts.before || opts.after;
      const anchor = anchorKey ? this.panels[anchorKey]?.getElement() : null;
      if (!anchor || anchor.parentElement !== grid) return false;
      if (anchorKey === 'live-news' && opts.before) return false; // can't sit before live-news
      grid.insertBefore(el, opts.before ? anchor : anchor.nextSibling);
    }
    this.healMapAnchor();
    this.savePanelOrder();
    return true;
  }

  private setMapLayerEnabled(key: string, on: boolean): boolean {
    if (!(key in this.mapLayers)) return false;
    const layer = key as keyof MapLayers;
    this.mapLayers[layer] = on;
    saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);
    this.map?.setLayers(this.mapLayers);
    if (layer === 'ais') {
      if (on) {
        this.map?.setLayerLoading('ais', true);
        initAisStream();
      } else {
        disconnectAisStream();
      }
    } else if (on) {
      void this.loadDataForLayer(layer);
    }
    return true;
  }

  private setGlobalTimeRange(range: string): boolean {
    const valid: TimeRange[] = ['1h', '6h', '24h', '48h', '7d', 'all'];
    if (!valid.includes(range as TimeRange)) return false;
    this.currentTimeRange = range as TimeRange;
    this.map?.setTimeRange(range as TimeRange);
    this.applyTimeRangeFilterToNewsPanelsDebounced();
    return true;
  }

  // The single variant-switch path (header tabs + analyst set_variant both route
  // here). SITE_VARIANT is an import-time const woven through ~30 modules, so a
  // true zero-reload in-place swap is out of scope for this release (see report).
  // The pragmatic switch instead makes the reload feel like only the panels
  // changed: it FLUSHES the exact live map view (camera + 2D/3D mode + layers +
  // time range) into the URL synchronously — closing the 250ms URL-sync debounce
  // gap — and stamps ?variant, so the post-reload restore is pixel-for-pixel and
  // the URL is shareable. PWA-precached, content-hashed assets keep the reload
  // sub-second.
  private setSiteVariant(variant: string): boolean {
    if (!['full', 'tech', 'finance', 'cloud', 'hanzo', 'saas', 'ai', 'crypto'].includes(variant)) return false;
    if (variant === SITE_VARIANT) return true;
    localStorage.setItem('worldmonitor-variant', variant); // survives even a trimmed URL
    const u = new URL(this.getShareUrl() ?? window.location.href);
    u.searchParams.set('variant', variant);
    window.location.href = u.toString();
    return true;
  }

  private resetPanelLayout(): void {
    // One click back to the variant default. Clears every layout customization —
    // panel order, per-panel heights (spans), custom feed panels, and the
    // enable/disable set — then reloads so the grid rebuilds from the pristine
    // DEFAULT_PANELS. One reset, one way.
    localStorage.removeItem(this.PANEL_ORDER_KEY);
    localStorage.removeItem('worldmonitor-panel-spans');
    localStorage.removeItem(this.MAP_COLS_KEY);
    localStorage.removeItem('hanzo-world-custom-panels');
    saveToStorage(STORAGE_KEYS.panels, { ...DEFAULT_PANELS });
    window.location.reload();
  }

  private customFeedKey(name: string): string {
    return 'custom:' + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  private async addCustomFeedPanel(name: string, url: string): Promise<{ ok: boolean; note?: string }> {
    name = name.trim();
    if (!name) return { ok: false, note: 'a name is required' };
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, note: 'that URL is invalid' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, note: 'that URL is invalid' };

    // Validate against the server RSS allowlist — the single SSRF boundary.
    let xml: string;
    try {
      const res = await fetch(`/v1/world/rss-proxy?url=${encodeURIComponent(url)}`);
      if (res.status === 403) return { ok: false, note: 'domain not in the allowlist' };
      if (!res.ok) return { ok: false, note: 'could not load that feed' };
      xml = await res.text();
    } catch {
      return { ok: false, note: 'could not reach that feed' };
    }

    const key = this.customFeedKey(name);
    if (this.panels[key]) this.removeCustomFeedPanel(name); // replace on re-add

    const panel = new CustomFeedPanel(key, name, url, xml);
    this.panels[key] = panel;
    this.panelSettings[key] = { name, enabled: true, priority: 2 };
    saveToStorage(STORAGE_KEYS.panels, this.panelSettings);

    const grid = document.getElementById('panelsGrid');
    const el = panel.getElement();
    this.makeDraggable(el, key);
    grid?.appendChild(el);

    this.customFeeds = this.customFeeds.filter((f) => f.key !== key);
    this.customFeeds.push({ key, name, url });
    this.persistCustomFeeds();
    this.renderPanelToggles();
    return { ok: true };
  }

  private removeCustomFeedPanel(name: string): boolean {
    const key = this.customFeedKey(name);
    const panel = this.panels[key];
    if (!panel) return false;
    panel.getElement().remove();
    panel.destroy();
    delete this.panels[key];
    delete this.panelSettings[key];
    saveToStorage(STORAGE_KEYS.panels, this.panelSettings);
    this.customFeeds = this.customFeeds.filter((f) => f.key !== key);
    this.persistCustomFeeds();
    this.renderPanelToggles();
    return true;
  }

  private persistCustomFeeds(): void {
    try {
      localStorage.setItem('hanzo-world-custom-panels', JSON.stringify(this.customFeeds));
    } catch {
      /* private mode */
    }
  }

  private mountCustomFeedPanels(): void {
    let saved: Array<{ key?: string; name: string; url: string }> = [];
    try {
      saved = JSON.parse(localStorage.getItem('hanzo-world-custom-panels') || '[]');
    } catch {
      saved = [];
    }
    if (!Array.isArray(saved)) return;
    const grid = document.getElementById('panelsGrid');
    saved.forEach((f) => {
      if (!f || !f.name || !f.url) return;
      const key = f.key || this.customFeedKey(f.name);
      if (this.panels[key]) return;
      const panel = new CustomFeedPanel(key, f.name, f.url);
      this.panels[key] = panel;
      if (!this.panelSettings[key]) this.panelSettings[key] = { name: f.name, enabled: true, priority: 2 };
      this.customFeeds.push({ key, name: f.name, url: f.url });
      const el = panel.getElement();
      this.makeDraggable(el, key);
      grid?.appendChild(el);
    });
  }

  private attachRelatedAssetHandlers(panel: NewsPanel): void {
    panel.setRelatedAssetHandlers({
      onRelatedAssetClick: (asset) => this.handleRelatedAssetClick(asset),
      onRelatedAssetsFocus: (assets) => this.map?.highlightAssets(assets),
      onRelatedAssetsClear: () => this.map?.highlightAssets(null),
    });
  }

  private handleRelatedAssetClick(asset: RelatedAsset): void {
    if (!this.map) return;

    switch (asset.type) {
      case 'pipeline':
        this.map.enableLayer('pipelines');
        this.mapLayers.pipelines = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);
        this.map.triggerPipelineClick(asset.id);
        break;
      case 'cable':
        this.map.enableLayer('cables');
        this.mapLayers.cables = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);
        this.map.triggerCableClick(asset.id);
        break;
      case 'datacenter':
        this.map.enableLayer('datacenters');
        this.mapLayers.datacenters = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);
        this.map.triggerDatacenterClick(asset.id);
        break;
      case 'base':
        this.map.enableLayer('bases');
        this.mapLayers.bases = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);
        this.map.triggerBaseClick(asset.id);
        break;
      case 'nuclear':
        this.map.enableLayer('nuclear');
        this.mapLayers.nuclear = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.mapLayers);
        this.map.triggerNuclearClick(asset.id);
        break;
    }
  }

  // Pointer-driven reorder: custom ghost, gap-opening FLIP reflow, touch support.
  // The drag module owns all pointer math + visuals; App only persists the order
  // that the reorder leaves in the live DOM (savePanelOrder reads data-panel).
  private makeDraggable(el: HTMLElement, key: string): void {
    el.dataset.panel = key;
    attachPanelDrag(el, {
      getGrid: () => document.getElementById('panelsGrid'),
      onReorder: () => {
        this.healMapAnchor();
        this.savePanelOrder();
      },
      // The full-width map is the leading anchor: no panel may be dropped before it.
      blockInsertBefore: (panel) => panel.dataset.panel === 'map' && this.mapIsFullWidth(),
    });
  }

  private setupEventListeners(): void {
    // Search button
    document.getElementById('searchBtn')?.addEventListener('click', () => {
      this.updateSearchIndex();
      this.searchModal?.open();
    });

    // Copy link button
    document.getElementById('copyLinkBtn')?.addEventListener('click', async () => {
      const shareUrl = this.getShareUrl();
      if (!shareUrl) return;
      const button = document.getElementById('copyLinkBtn');
      try {
        await this.copyToClipboard(shareUrl);
        this.setCopyLinkFeedback(button, 'Copied!');
      } catch (error) {
        console.warn('Failed to copy share link:', error);
        this.setCopyLinkFeedback(button, 'Copy failed');
      }
    });

    // Settings modal
    document.getElementById('settingsBtn')?.addEventListener('click', () => {
      document.getElementById('settingsModal')?.classList.add('active');
    });

    document.getElementById('modalClose')?.addEventListener('click', () => {
      document.getElementById('settingsModal')?.classList.remove('active');
    });

    document.getElementById('settingsModal')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement)?.classList?.contains('modal-overlay')) {
        document.getElementById('settingsModal')?.classList.remove('active');
      }
    });

    // Reset layout → pristine variant default (order + spans + custom panels).
    document.getElementById('resetLayoutBtn')?.addEventListener('click', () => {
      this.resetPanelLayout();
    });

    // Panel hide / reset requests from the hover ✕ and the right-click menu.
    // Both route through the SAME state owner the AI analyst uses, so a panel
    // hidden this way restores from the Panels menu identically.
    document.addEventListener('panel-close-request', (e) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) this.setPanelEnabled(id, false);
    });
    document.addEventListener('panel-reset-layout-request', () => {
      this.resetPanelLayout();
    });
    // Right-click "Move to top" reorders through the SAME grid mover the analyst
    // uses, so order + persistence stay owned in one place.
    document.addEventListener('panel-move-request', (e) => {
      const d = (e as CustomEvent<{ id?: string; position?: 'top' | 'bottom' }>).detail;
      if (d?.id && d.position) this.movePanelInGrid(d.id, { position: d.position });
    });
    installPanelContextMenu();


    // Header theme toggle button
    document.getElementById('headerThemeToggle')?.addEventListener('click', () => {
      const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
      setTheme(next);
      this.updateHeaderThemeIcon();
    });

    // Sources modal
    this.setupSourcesModal();

    // Variant switcher: switch in-place (same origin, no subdomains) — persist
    // the choice and reload with the new config. Works on web and desktop alike.
    this.container.querySelectorAll<HTMLAnchorElement>('.variant-option').forEach(link => {
      link.addEventListener('click', (e) => {
        const variant = link.dataset.variant;
        if (variant && variant !== SITE_VARIANT) {
          e.preventDefault();
          this.setSiteVariant(variant); // one switch path: exact map-state restore + ?variant
        }
      });
    });

    // Hanzo mode: the H logo toggles the variant switcher's visibility. State is
    // persisted so it survives the reload a variant switch triggers (the switcher
    // stays open across switches; click the H again to collapse). Only present on
    // hanzo brand hosts (the toggle button is rendered there — see renderLayout).
    const hanzoToggle = this.container.querySelector<HTMLElement>('[data-hanzo-toggle]');
    const switcherEl = this.container.querySelector<HTMLElement>('#variantSwitcher');
    if (hanzoToggle && switcherEl) {
      const header = hanzoToggle.closest('.header');
      const setMode = (on: boolean): void => {
        header?.classList.toggle('hanzo-mode', on);
        hanzoToggle.setAttribute('aria-expanded', String(on));
        try { localStorage.setItem('worldmonitor-hanzo-mode', on ? '1' : '0'); } catch { /* non-fatal */ }
      };
      // Restore: reopen if previously opened; also open when the current view is NOT
      // the Hanzo default, so a deep-linked visitor can still reach the switcher.
      const stored = (() => { try { return localStorage.getItem('worldmonitor-hanzo-mode'); } catch { return null; } })();
      setMode(stored === '1' || (stored === null && SITE_VARIANT !== 'cloud'));
      hanzoToggle.addEventListener('click', (e) => {
        e.preventDefault();
        setMode(!header?.classList.contains('hanzo-mode'));
      });
      hanzoToggle.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && header?.classList.contains('hanzo-mode')) setMode(false);
      });
    }

    // Fullscreen toggle
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    if (!this.isDesktopApp && fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
      this.boundFullscreenHandler = () => {
        fullscreenBtn.textContent = document.fullscreenElement ? '⛶' : '⛶';
        fullscreenBtn.classList.toggle('active', !!document.fullscreenElement);
      };
      document.addEventListener('fullscreenchange', this.boundFullscreenHandler);
    }

    // Region selector
    const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
    regionSelect?.addEventListener('change', () => {
      this.map?.setView(regionSelect.value as MapView);
    });

    // Language selector
    const langSelect = document.getElementById('langSelect') as HTMLSelectElement;
    langSelect?.addEventListener('change', () => {
      void changeLanguage(langSelect.value);
    });

    // Window resize
    this.boundResizeHandler = () => {
      this.map?.render();
    };
    window.addEventListener('resize', this.boundResizeHandler);

    // Map is a first-class grid citizen: header-drag to reorder, bottom handle to
    // resize height (row span), right handle to resize width (column span).
    this.setupMapPanel();

    // Pause animations when tab is hidden, unload ML models to free memory
    this.boundVisibilityHandler = () => {
      document.body.classList.toggle('animations-paused', document.hidden);
      if (document.hidden) {
        mlWorker.unloadOptionalModels();
      } else {
        this.resetIdleTimer();
      }
      this.syncMapRenderActive();
    };
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);

    // Refresh CII when focal points are ready (ensures focal point urgency is factored in)
    window.addEventListener('focal-points-ready', () => {
      (this.panels['cii'] as CIIPanel)?.refresh(true); // forceLocal to use focal point data
    });

    // Re-render components with baked getCSSColor() values on theme change
    window.addEventListener('theme-changed', () => {
      this.map?.render();
      this.updateHeaderThemeIcon();
    });

    // Idle detection - pause animations after 2 minutes of inactivity
    this.setupIdleDetection();
  }

  // Single chokepoint for whether the map's render loop (2Hz news pulse, idle
  // globe spin, cloud-poll re-renders) should run. Off whenever the tab is hidden
  // or the user has gone idle — that is the residual main-thread/GPU cost the CPU
  // profile flagged on saas/crypto. setRenderPaused is idempotent + drains a
  // pending render on resume, so this is safe to call on every signal edge.
  private syncMapRenderActive(): void {
    this.map?.setRenderPaused(document.hidden || this.isIdle);
  }

  private setupIdleDetection(): void {
    this.boundIdleResetHandler = () => {
      // User is active - resume animations if we were idle
      if (this.isIdle) {
        this.isIdle = false;
        document.body.classList.remove('animations-paused');
        this.syncMapRenderActive();
      }
      this.resetIdleTimer();
    };

    // Track user activity
    ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(event => {
      document.addEventListener(event, this.boundIdleResetHandler!, { passive: true });
    });

    // Start the idle timer
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimeoutId) {
      clearTimeout(this.idleTimeoutId);
    }
    this.idleTimeoutId = setTimeout(() => {
      if (!document.hidden) {
        this.isIdle = true;
        document.body.classList.add('animations-paused');
        this.syncMapRenderActive();
      }
    }, this.IDLE_PAUSE_MS);
  }

  private setupUrlStateSync(): void {
    if (!this.map) return;
    const update = debounce(() => {
      const shareUrl = this.getShareUrl();
      if (!shareUrl) return;
      history.replaceState(null, '', shareUrl);
    }, 250);

    this.map.onStateChanged(() => {
      update();
      // Sync header region selector with map view
      const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
      if (regionSelect && this.map) {
        const state = this.map.getState();
        if (regionSelect.value !== state.view) {
          regionSelect.value = state.view;
        }
        // Persist 2D/3D choice across sessions.
        if (state.mode) {
          localStorage.setItem(this.MAP_MODE_STORAGE_KEY, state.mode);
        }
      }
    });
    update();
  }

  private getShareUrl(): string | null {
    if (!this.map) return null;
    const state = this.map.getState();
    const center = this.map.getCenter();
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    return buildMapUrl(baseUrl, {
      view: state.view,
      zoom: state.zoom,
      center,
      timeRange: state.timeRange,
      layers: state.layers,
      country: this.countryBriefPage?.isVisible() ? (this.countryBriefPage.getCode() ?? undefined) : undefined,
      mode: state.mode,
    });
  }

  private async copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  private setCopyLinkFeedback(button: HTMLElement | null, message: string): void {
    if (!button) return;
    const originalText = button.textContent ?? '';
    button.textContent = message;
    button.classList.add('copied');
    window.setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('copied');
    }, 1500);
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
      if (el.requestFullscreen) {
        void el.requestFullscreen().catch(() => {});
      } else if (el.webkitRequestFullscreen) {
        try { el.webkitRequestFullscreen(); } catch {}
      }
    }
  }

  private readonly MAP_COLS_KEY = 'worldmonitor-panel-cols';

  private setupMapPanel(): void {
    const mapSection = document.getElementById('mapSection');
    if (!mapSection) return;
    const rowHandle = document.getElementById('mapResizeHandle');
    const colHandle = document.getElementById('mapColResizeHandle');

    // Reorder by dragging the map header. Dragging on the canvas pans the map
    // instead (guarded in panel-drag), so map interaction is never hijacked.
    this.makeDraggable(mapSection, 'map');

    // Height = grid row span, persisted in the shared panel-spans store. Default
    // to 2 rows (the map-on-top hero height) when nothing is saved. On mobile the
    // grid collapses to a flex column and the map uses its own responsive height.
    if (!this.isMobile) {
      const spans = loadPanelSpans();
      setSpanClass(mapSection, spans['map'] && spans['map'] > 1 ? spans['map'] : 2);
    }
    if (rowHandle && !this.isMobile) {
      attachPanelResize(mapSection, rowHandle, {
        minSpan: 1,
        maxSpan: 4,
        rowPx: 200,
        getStartSpan: () => currentSpan(mapSection),
        onPreview: (span) => setSpanClass(mapSection, span),
        onCommit: (span) => savePanelSpan('map', span),
      });
    }

    // Width = grid column span. Full width by default; drag the right edge in and
    // sibling panels (live news …) flow in beside the map.
    const applyCols = (cols: number, total: number): void => {
      mapSection.style.gridColumn = cols <= 0 || cols >= total ? '1 / -1' : `span ${cols}`;
      // Going (back) to full width re-imposes the leading-anchor invariant.
      this.healMapAnchor();
      this.map?.render();
    };
    const savedCols = this.loadMapCols();
    requestAnimationFrame(() => {
      const total = this.gridColumnCount();
      applyCols(savedCols > 0 ? Math.min(savedCols, total) : total, total || 1);
    });
    if (colHandle) {
      attachPanelColResize(mapSection, colHandle, {
        getGrid: () => document.getElementById('panelsGrid'),
        getStartCols: () => this.currentMapCols(),
        onPreview: (cols, total) => applyCols(cols, total),
        onCommit: (cols, total) => this.saveMapCols(cols >= total ? 0 : cols),
      });
    }

    // Re-render the map whenever its container box changes (row/col resize, drag
    // reflow, window). Guarantees maplibre/deck pick up the new size without
    // reaching into DeckGLMap.
    const container = document.getElementById('mapContainer');
    if (container && 'ResizeObserver' in window) {
      this.mapResizeObserver?.disconnect();
      this.mapResizeObserver = new ResizeObserver(() => this.map?.render());
      this.mapResizeObserver.observe(container);
    }
  }

  private loadMapCols(): number {
    try {
      const raw = localStorage.getItem(this.MAP_COLS_KEY);
      const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      return typeof map.map === 'number' ? map.map : 0;
    } catch {
      return 0;
    }
  }

  private saveMapCols(cols: number): void {
    let map: Record<string, number> = {};
    try {
      const raw = localStorage.getItem(this.MAP_COLS_KEY);
      map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      map = {};
    }
    if (cols > 0) map.map = cols;
    else delete map.map;
    localStorage.setItem(this.MAP_COLS_KEY, JSON.stringify(map));
  }

  private gridColumnCount(): number {
    const grid = document.getElementById('panelsGrid');
    if (!grid) return 1;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, cols);
  }

  private currentMapCols(): number {
    const total = this.gridColumnCount();
    const mapSection = document.getElementById('mapSection');
    if (!mapSection) return total;
    const gc = mapSection.style.gridColumn;
    if (!gc || gc === '1 / -1') return total;
    const m = gc.match(/span\s+(\d+)/);
    return m && m[1] ? Math.min(total, parseInt(m[1], 10)) : total;
  }

  private renderPanelToggles(): void {
    const container = document.getElementById('panelToggles')!;
    const panelHtml = Object.entries(this.panelSettings)
      .filter(([key]) => key !== 'runtime-config' || this.isDesktopApp)
      .map(
        ([key, panel]) => `
        <div class="panel-toggle-item ${panel.enabled ? 'active' : ''}" data-panel="${key}">
          <div class="panel-toggle-checkbox">${panel.enabled ? '✓' : ''}</div>
          <span class="panel-toggle-label">${this.getLocalizedPanelName(key, panel.name)}</span>
        </div>
      `
      )
      .join('');

    const findingsHtml = this.isMobile
      ? ''
      : (() => {
        const findingsEnabled = this.findingsBadge?.isEnabled() ?? IntelligenceGapBadge.getStoredEnabledState();
        return `
      <div class="panel-toggle-item ${findingsEnabled ? 'active' : ''}" data-panel="intel-findings">
        <div class="panel-toggle-checkbox">${findingsEnabled ? '✓' : ''}</div>
        <span class="panel-toggle-label">Intelligence Findings</span>
      </div>
    `;
      })();

    container.innerHTML = panelHtml + findingsHtml;

    container.querySelectorAll('.panel-toggle-item').forEach((item) => {
      item.addEventListener('click', () => {
        const panelKey = (item as HTMLElement).dataset.panel!;

        if (panelKey === 'intel-findings') {
          if (!this.findingsBadge) return;
          this.findingsBadge.setEnabled(!this.findingsBadge.isEnabled());
          this.renderPanelToggles();
          return;
        }

        const config = this.panelSettings[panelKey];
        console.log('[Panel Toggle] Clicked:', panelKey, 'Current enabled:', config?.enabled);
        if (config) {
          config.enabled = !config.enabled;
          console.log('[Panel Toggle] New enabled:', config.enabled);
          saveToStorage(STORAGE_KEYS.panels, this.panelSettings);
          this.renderPanelToggles();
          this.applyPanelSettings();
          console.log('[Panel Toggle] After apply - config.enabled:', this.panelSettings[panelKey]?.enabled);
        }
      });
    });
  }

  private getLocalizedPanelName(panelKey: string, fallback: string): string {
    if (panelKey === 'runtime-config') {
      return t('modals.runtimeConfig.title');
    }
    const key = panelKey.replace(/-([a-z])/g, (_match, group: string) => group.toUpperCase());
    const lookup = `panels.${key}`;
    const localized = t(lookup);
    return localized === lookup ? fallback : localized;
  }

  private getAllSourceNames(): string[] {
    const sources = new Set<string>();
    Object.values(FEEDS).forEach(feeds => {
      if (feeds) feeds.forEach(f => sources.add(f.name));
    });
    INTEL_SOURCES.forEach(f => sources.add(f.name));
    return Array.from(sources).sort((a, b) => a.localeCompare(b));
  }

  private renderSourceToggles(filter = ''): void {
    const container = document.getElementById('sourceToggles')!;
    const allSources = this.getAllSourceNames();
    const filterLower = filter.toLowerCase();
    const filteredSources = filter
      ? allSources.filter(s => s.toLowerCase().includes(filterLower))
      : allSources;

    container.innerHTML = filteredSources.map(source => {
      const isEnabled = !this.disabledSources.has(source);
      const escaped = escapeHtml(source);
      return `
        <div class="source-toggle-item ${isEnabled ? 'active' : ''}" data-source="${escaped}">
          <div class="source-toggle-checkbox">${isEnabled ? '✓' : ''}</div>
          <span class="source-toggle-label">${escaped}</span>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.source-toggle-item').forEach(item => {
      item.addEventListener('click', () => {
        const sourceName = (item as HTMLElement).dataset.source!;
        if (this.disabledSources.has(sourceName)) {
          this.disabledSources.delete(sourceName);
        } else {
          this.disabledSources.add(sourceName);
        }
        saveToStorage(STORAGE_KEYS.disabledFeeds, Array.from(this.disabledSources));
        this.renderSourceToggles(filter);
      });
    });

    // Update counter
    const enabledCount = allSources.length - this.disabledSources.size;
    const counterEl = document.getElementById('sourcesCounter');
    if (counterEl) {
      counterEl.textContent = t('header.sourcesEnabled', { enabled: String(enabledCount), total: String(allSources.length) });
    }
  }

  private setupSourcesModal(): void {
    document.getElementById('sourcesBtn')?.addEventListener('click', () => {
      document.getElementById('sourcesModal')?.classList.add('active');
      // Clear search and show all sources on open
      const searchInput = document.getElementById('sourcesSearch') as HTMLInputElement | null;
      if (searchInput) searchInput.value = '';
      this.renderSourceToggles();
    });

    document.getElementById('sourcesModalClose')?.addEventListener('click', () => {
      document.getElementById('sourcesModal')?.classList.remove('active');
    });

    document.getElementById('sourcesModal')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement)?.classList?.contains('modal-overlay')) {
        document.getElementById('sourcesModal')?.classList.remove('active');
      }
    });

    document.getElementById('sourcesSearch')?.addEventListener('input', (e) => {
      const filter = (e.target as HTMLInputElement).value;
      this.renderSourceToggles(filter);
    });

    document.getElementById('sourcesSelectAll')?.addEventListener('click', () => {
      this.disabledSources.clear();
      saveToStorage(STORAGE_KEYS.disabledFeeds, []);
      const filter = (document.getElementById('sourcesSearch') as HTMLInputElement)?.value || '';
      this.renderSourceToggles(filter);
    });

    document.getElementById('sourcesSelectNone')?.addEventListener('click', () => {
      const allSources = this.getAllSourceNames();
      this.disabledSources = new Set(allSources);
      saveToStorage(STORAGE_KEYS.disabledFeeds, allSources);
      const filter = (document.getElementById('sourcesSearch') as HTMLInputElement)?.value || '';
      this.renderSourceToggles(filter);
    });
  }

  private applyPanelSettings(): void {
    Object.entries(this.panelSettings).forEach(([key, config]) => {
      if (key === 'map') {
        const mapSection = document.getElementById('mapSection');
        if (mapSection) {
          mapSection.classList.toggle('hidden', !config.enabled);
        }
        return;
      }
      const panel = this.panels[key];
      panel?.toggle(config.enabled);
    });
  }

  private updateHeaderThemeIcon(): void {
    const btn = document.getElementById('headerThemeToggle');
    if (!btn) return;
    const isDark = getCurrentTheme() === 'dark';
    btn.innerHTML = isDark
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
  }

  private async loadAllData(): Promise<void> {
    const runGuarded = async (name: string, fn: () => Promise<void>): Promise<void> => {
      if (this.inFlight.has(name)) return;
      this.inFlight.add(name);
      try {
        await fn();
      } catch (e) {
        console.error(`[App] ${name} failed:`, e);
      } finally {
        this.inFlight.delete(name);
      }
    };

    const tasks: Array<{ name: string; task: Promise<void> }> = [
      { name: 'news', task: runGuarded('news', () => this.loadNews()) },
      { name: 'markets', task: runGuarded('markets', () => this.loadMarkets()) },
      { name: 'predictions', task: runGuarded('predictions', () => this.loadPredictions()) },
      { name: 'pizzint', task: runGuarded('pizzint', () => this.loadPizzInt()) },
      { name: 'fred', task: runGuarded('fred', () => this.loadFredData()) },
      { name: 'oil', task: runGuarded('oil', () => this.loadOilAnalytics()) },
      { name: 'spending', task: runGuarded('spending', () => this.loadGovernmentSpending()) },
      { name: 'china', task: runGuarded('china', () => this.loadChinaMacro()) },
    ];

    // Load intelligence signals for CII calculation (protests, military, outages)
    // Only for geopolitical variant - tech variant doesn't need CII/focal points
    if (SITE_VARIANT === 'full') {
      tasks.push({ name: 'intelligence', task: runGuarded('intelligence', () => this.loadIntelligenceSignals()) });
    }

    // Conditionally load non-intelligence layers
    // NOTE: outages, protests, military are handled by loadIntelligenceSignals() above
    // They update the map when layers are enabled, so no duplicate tasks needed here
    if (SITE_VARIANT === 'full') tasks.push({ name: 'firms', task: runGuarded('firms', () => this.loadFirmsData()) });
    if (this.mapLayers.natural) tasks.push({ name: 'natural', task: runGuarded('natural', () => this.loadNatural()) });
    if (this.mapLayers.weather) tasks.push({ name: 'weather', task: runGuarded('weather', () => this.loadWeatherAlerts()) });
    if (this.mapLayers.ais) tasks.push({ name: 'ais', task: runGuarded('ais', () => this.loadAisSignals()) });
    if (this.mapLayers.cables) tasks.push({ name: 'cables', task: runGuarded('cables', () => this.loadCableActivity()) });
    if (this.mapLayers.flights) tasks.push({ name: 'flights', task: runGuarded('flights', () => this.loadFlightDelays()) });
    if (CYBER_LAYER_ENABLED && this.mapLayers.cyberThreats) tasks.push({ name: 'cyberThreats', task: runGuarded('cyberThreats', () => this.loadCyberThreats()) });
    if (this.mapLayers.techEvents || SITE_VARIANT === 'tech') tasks.push({ name: 'techEvents', task: runGuarded('techEvents', () => this.loadTechEvents()) });

    // Tech Readiness panel (tech + ai variants — every variant that registers it)
    if (SITE_VARIANT === 'tech' || SITE_VARIANT === 'ai') {
      tasks.push({ name: 'techReadiness', task: runGuarded('techReadiness', () => (this.panels['tech-readiness'] as TechReadinessPanel)?.refresh()) });
    }

    // Use allSettled to ensure all tasks complete and search index always updates
    const results = await Promise.allSettled(tasks.map(t => t.task));

    // Log any failures but don't block
    results.forEach((result, idx) => {
      if (result.status === 'rejected') {
        console.error(`[App] ${tasks[idx]?.name} load failed:`, result.reason);
      }
    });

    // Always update search index regardless of individual task failures
    this.updateSearchIndex();
  }

  private async loadDataForLayer(layer: keyof MapLayers): Promise<void> {
    if (this.inFlight.has(layer)) return;
    this.inFlight.add(layer);
    this.map?.setLayerLoading(layer, true);
    try {
      switch (layer) {
        case 'natural':
          await this.loadNatural();
          break;
        case 'fires':
          await this.loadFirmsData();
          break;
        case 'weather':
          await this.loadWeatherAlerts();
          break;
        case 'outages':
          await this.loadOutages();
          break;
        case 'cyberThreats':
          await this.loadCyberThreats();
          break;
        case 'ais':
          await this.loadAisSignals();
          break;
        case 'cables':
          await this.loadCableActivity();
          break;
        case 'protests':
          await this.loadProtests();
          break;
        case 'flights':
          await this.loadFlightDelays();
          break;
        case 'military':
          await this.loadMilitary();
          break;
        case 'techEvents':
          console.log('[loadDataForLayer] Loading techEvents...');
          await this.loadTechEvents();
          console.log('[loadDataForLayer] techEvents loaded');
          break;
        case 'ucdpEvents':
        case 'displacement':
        case 'climate':
          await this.loadIntelligenceSignals();
          break;
      }
    } finally {
      this.inFlight.delete(layer);
      this.map?.setLayerLoading(layer, false);
    }
  }

  private findFlashLocation(title: string): { lat: number; lon: number } | null {
    const titleLower = title.toLowerCase();
    let bestMatch: { lat: number; lon: number; matches: number } | null = null;

    const countKeywordMatches = (keywords: string[] | undefined): number => {
      if (!keywords) return 0;
      let matches = 0;
      for (const keyword of keywords) {
        const cleaned = keyword.trim().toLowerCase();
        if (cleaned.length >= 3 && titleLower.includes(cleaned)) {
          matches++;
        }
      }
      return matches;
    };

    for (const hotspot of INTEL_HOTSPOTS) {
      const matches = countKeywordMatches(hotspot.keywords);
      if (matches > 0 && (!bestMatch || matches > bestMatch.matches)) {
        bestMatch = { lat: hotspot.lat, lon: hotspot.lon, matches };
      }
    }

    for (const conflict of CONFLICT_ZONES) {
      const matches = countKeywordMatches(conflict.keywords);
      if (matches > 0 && (!bestMatch || matches > bestMatch.matches)) {
        bestMatch = { lat: conflict.center[1], lon: conflict.center[0], matches };
      }
    }

    return bestMatch;
  }

  private flashMapForNews(items: NewsItem[]): void {
    if (!this.map || !this.initialLoadComplete) return;
    const now = Date.now();

    for (const [key, timestamp] of this.mapFlashCache.entries()) {
      if (now - timestamp > this.MAP_FLASH_COOLDOWN_MS) {
        this.mapFlashCache.delete(key);
      }
    }

    for (const item of items) {
      const cacheKey = `${item.source}|${item.link || item.title}`;
      const lastSeen = this.mapFlashCache.get(cacheKey);
      if (lastSeen && now - lastSeen < this.MAP_FLASH_COOLDOWN_MS) {
        continue;
      }

      const location = this.findFlashLocation(item.title);
      if (!location) continue;

      this.map.flashLocation(location.lat, location.lon);
      this.mapFlashCache.set(cacheKey, now);
    }
  }

  private getTimeRangeWindowMs(range: TimeRange): number {
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

  private filterItemsByTimeRange(items: NewsItem[], range: TimeRange = this.currentTimeRange): NewsItem[] {
    if (range === 'all') return items;
    const cutoff = Date.now() - this.getTimeRangeWindowMs(range);
    return items.filter((item) => {
      const ts = item.pubDate instanceof Date ? item.pubDate.getTime() : new Date(item.pubDate).getTime();
      return Number.isFinite(ts) ? ts >= cutoff : true;
    });
  }

  private getTimeRangeLabel(range: TimeRange = this.currentTimeRange): string {
    const labels: Record<TimeRange, string> = {
      '1h': 'the last hour',
      '6h': 'the last 6 hours',
      '24h': 'the last 24 hours',
      '48h': 'the last 48 hours',
      '7d': 'the last 7 days',
      'all': 'all time',
    };
    return labels[range];
  }

  private renderNewsForCategory(category: string, items: NewsItem[]): void {
    this.newsByCategory[category] = items;
    const panel = this.newsPanels[category];
    if (!panel) return;
    const filteredItems = this.filterItemsByTimeRange(items);
    if (filteredItems.length === 0 && items.length > 0) {
      panel.renderFilteredEmpty(`No items in ${this.getTimeRangeLabel()}`);
      return;
    }
    panel.renderNews(filteredItems);
  }

  private applyTimeRangeFilterToNewsPanels(): void {
    Object.entries(this.newsByCategory).forEach(([category, items]) => {
      this.renderNewsForCategory(category, items);
    });
  }

  // Hybrid ML clustering under a wall-clock budget: on WASM-only machines
  // BERT embedding of the full corpus can take minutes, and everything
  // downstream (AI Insights, correlation, CII) would wait on it. Past the
  // budget we fall back to the fast Jaccard worker; the hybrid promise keeps
  // warming models in the background for the next cycle.
  private async clusterNewsBudgeted(news: NewsItem[]): Promise<ClusteredEvent[]> {
    if (!mlWorker.isAvailable) return analysisWorker.clusterNews(news);
    const budget = new Promise<null>(resolve => setTimeout(() => resolve(null), 25000));
    const hybrid = clusterNewsHybrid(news).catch(() => null);
    const result = await Promise.race([hybrid, budget]);
    if (result) return result;
    return analysisWorker.clusterNews(news);
  }

  private async loadNewsCategory(category: string, feeds: typeof FEEDS.politics): Promise<NewsItem[]> {
    try {
      const panel = this.newsPanels[category];
      const renderIntervalMs = 250;
      let lastRenderTime = 0;
      let renderTimeout: ReturnType<typeof setTimeout> | null = null;
      let pendingItems: NewsItem[] | null = null;

      // Filter out disabled sources
      const enabledFeeds = (feeds ?? []).filter(f => !this.disabledSources.has(f.name));
      if (enabledFeeds.length === 0) {
        delete this.newsByCategory[category];
        if (panel) panel.showError(t('common.allSourcesDisabled'));
        this.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
          status: 'ok',
          itemCount: 0,
        });
        return [];
      }

      const flushPendingRender = () => {
        if (!pendingItems) return;
        this.renderNewsForCategory(category, pendingItems);
        pendingItems = null;
        lastRenderTime = Date.now();
      };

      const scheduleRender = (partialItems: NewsItem[]) => {
        if (!panel) return;
        pendingItems = partialItems;
        const elapsed = Date.now() - lastRenderTime;
        if (elapsed >= renderIntervalMs) {
          if (renderTimeout) {
            clearTimeout(renderTimeout);
            renderTimeout = null;
          }
          flushPendingRender();
          return;
        }

        if (!renderTimeout) {
          renderTimeout = setTimeout(() => {
            renderTimeout = null;
            flushPendingRender();
          }, renderIntervalMs - elapsed);
        }
      };

      const items = await fetchCategoryFeeds(enabledFeeds, {
        onBatch: (partialItems) => {
          scheduleRender(partialItems);
          this.flashMapForNews(partialItems);
        },
      });

      this.renderNewsForCategory(category, items);
      if (panel) {
        if (renderTimeout) {
          clearTimeout(renderTimeout);
          renderTimeout = null;
          pendingItems = null;
        }

        if (items.length === 0) {
          const failures = getFeedFailures();
          const failedFeeds = enabledFeeds.filter(f => failures.has(f.name));
          if (failedFeeds.length > 0) {
            const names = failedFeeds.map(f => f.name).join(', ');
            panel.showError(`${t('common.noNewsAvailable')} (${names} failed)`);
          } else {
            // Never leave a panel on an eternal spinner: zero items with no
            // recorded failure still resolves to a quiet empty state.
            panel.showError(t('common.noNewsAvailable'));
          }
        }

        try {
          const baseline = await updateBaseline(`news:${category}`, items.length);
          const deviation = calculateDeviation(items.length, baseline);
          panel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
        } catch (e) { console.warn(`[Baseline] news:${category} write failed:`, e); }
      }

      this.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
        status: 'ok',
        itemCount: items.length,
      });
      this.statusPanel?.updateApi('RSS2JSON', { status: 'ok' });

      return items;
    } catch (error) {
      this.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
        status: 'error',
        errorMessage: String(error),
      });
      this.statusPanel?.updateApi('RSS2JSON', { status: 'error' });
      delete this.newsByCategory[category];
      return [];
    }
  }

  private async loadNews(): Promise<void> {
    // Build categories dynamically from whatever feeds the current variant exports
    const categories = Object.entries(FEEDS)
      .filter((entry): entry is [string, typeof FEEDS[keyof typeof FEEDS]] => Array.isArray(entry[1]) && entry[1].length > 0)
      .map(([key, feeds]) => ({ key, feeds }));

    // Stage category fetches to avoid startup bursts and API pressure in all variants.
    // With the server-side feeds-batch each category costs ~1 request, so a
    // wide pipeline no longer bursts upstream APIs (the old per-feed path
    // remains the fallback and still honors the per-feed batches below).
    const maxCategoryConcurrency = SITE_VARIANT === 'finance' ? 4 : 12;
    const categoryConcurrency = Math.max(1, Math.min(maxCategoryConcurrency, categories.length));
    const categoryResults: PromiseSettledResult<NewsItem[]>[] = [];
    for (let i = 0; i < categories.length; i += categoryConcurrency) {
      const chunk = categories.slice(i, i + categoryConcurrency);
      const chunkResults = await Promise.allSettled(
        chunk.map(({ key, feeds }) => this.loadNewsCategory(key, feeds))
      );
      categoryResults.push(...chunkResults);
    }

    // Collect successful results
    const collectedNews: NewsItem[] = [];
    categoryResults.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        collectedNews.push(...result.value);
      } else {
        console.error(`[App] News category ${categories[idx]?.key} failed:`, result.reason);
      }
    });

    // Intel (uses different source) - full variant only (defense/military news)
    if (SITE_VARIANT === 'full') {
      const enabledIntelSources = INTEL_SOURCES.filter(f => !this.disabledSources.has(f.name));
      const intelPanel = this.newsPanels['intel'];
      if (enabledIntelSources.length === 0) {
        delete this.newsByCategory['intel'];
        if (intelPanel) intelPanel.showError(t('common.allIntelSourcesDisabled'));
        this.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: 0 });
      } else {
        const intelResult = await Promise.allSettled([fetchCategoryFeeds(enabledIntelSources)]);
        if (intelResult[0]?.status === 'fulfilled') {
          const intel = intelResult[0].value;
          this.renderNewsForCategory('intel', intel);
          if (intelPanel) {
            try {
              const baseline = await updateBaseline('news:intel', intel.length);
              const deviation = calculateDeviation(intel.length, baseline);
              intelPanel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
            } catch (e) { console.warn('[Baseline] news:intel write failed:', e); }
          }
          this.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: intel.length });
          collectedNews.push(...intel);
          this.flashMapForNews(intel);
        } else {
          delete this.newsByCategory['intel'];
          console.error('[App] Intel feed failed:', intelResult[0]?.reason);
        }
      }
    }

    this.allNews = collectedNews;
    this.initialLoadComplete = true;
    // Hanzo: upstream desktop-download banner + community/discussion widget removed.
    // Temporal baseline: report news volume
    updateAndCheck([
      { type: 'news', region: 'global', count: collectedNews.length },
    ]).then(anomalies => {
      if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
    }).catch(() => { });

    // Update map hotspots
    this.map?.updateHotspotActivity(this.allNews);

    // Update monitors
    this.updateMonitorResults();

    // Update clusters for correlation analysis (hybrid: semantic + Jaccard when ML available)
    try {
      this.latestClusters = await this.clusterNewsBudgeted(this.allNews);

      // Update AI Insights panel with new clusters (if ML available)
      {
        // Clusters from either worker feed the panel; never leave it on the
        // boot spinner when clustering yields nothing.
        const insightsPanel = this.panels['insights'] as InsightsPanel | undefined;
        if (this.latestClusters.length > 0) {
          insightsPanel?.updateInsights(this.latestClusters);
        } else {
          insightsPanel?.showError(t('common.noDataAvailable'));
        }
      }

      // Push geo-located news clusters to map
      const geoLocated = this.latestClusters
        .filter((c): c is typeof c & { lat: number; lon: number } => c.lat != null && c.lon != null)
        .map(c => ({
          lat: c.lat,
          lon: c.lon,
          title: c.primaryTitle,
          threatLevel: c.threat?.level ?? 'info',
          timestamp: c.lastUpdated,
        }));
      if (geoLocated.length > 0) {
        this.map?.setNewsLocations(geoLocated);
      }
    } catch (error) {
      console.error('[App] Clustering failed, clusters unchanged:', error);
    }
  }

  private async loadMarkets(): Promise<void> {
    try {
      const stocksResult = await fetchMultipleStocks(MARKET_SYMBOLS, {
        onBatch: (partialStocks) => {
          this.latestMarkets = partialStocks;
          (this.panels['markets'] as MarketPanel).renderMarkets(partialStocks);
        },
      });

      const finnhubConfigMsg = 'FINNHUB_API_KEY not configured — add in Settings';
      this.latestMarkets = stocksResult.data;
      (this.panels['markets'] as MarketPanel).renderMarkets(stocksResult.data);

      if (stocksResult.skipped) {
        this.statusPanel?.updateApi('Finnhub', { status: 'error' });
        if (stocksResult.data.length === 0) {
          this.panels['markets']?.showConfigError(finnhubConfigMsg);
        }
        this.panels['heatmap']?.showConfigError(finnhubConfigMsg);
      } else {
        this.statusPanel?.updateApi('Finnhub', { status: 'ok' });

        const sectorsResult = await fetchMultipleStocks(
          SECTORS.map((s) => ({ ...s, display: s.name })),
          {
            onBatch: (partialSectors) => {
              (this.panels['heatmap'] as HeatmapPanel).renderHeatmap(
                partialSectors.map((s) => ({ name: s.name, change: s.change }))
              );
            },
          }
        );
        (this.panels['heatmap'] as HeatmapPanel).renderHeatmap(
          sectorsResult.data.map((s) => ({ name: s.name, change: s.change }))
        );
      }

      // Commodities now render in the self-polling CommoditiesPanel (Yahoo passthrough).
    } catch {
      this.statusPanel?.updateApi('Finnhub', { status: 'error' });
    }

    try {
      // Crypto
      const crypto = await fetchCrypto();
      (this.panels['crypto'] as CryptoPanel).renderCrypto(crypto);
      this.statusPanel?.updateApi('CoinGecko', { status: 'ok' });
    } catch {
      this.statusPanel?.updateApi('CoinGecko', { status: 'error' });
    }
  }

  private async loadPredictions(): Promise<void> {
    try {
      const predictions = await fetchPredictions();
      this.latestPredictions = predictions;
      (this.panels['polymarket'] as PredictionPanel).renderPredictions(predictions);

      this.statusPanel?.updateFeed('Polymarket', { status: 'ok', itemCount: predictions.length });
      this.statusPanel?.updateApi('Polymarket', { status: 'ok' });
      dataFreshness.recordUpdate('polymarket', predictions.length);

      // Run correlation analysis in background (fire-and-forget via Web Worker)
      void this.runCorrelationAnalysis();
    } catch (error) {
      this.statusPanel?.updateFeed('Polymarket', { status: 'error', errorMessage: String(error) });
      this.statusPanel?.updateApi('Polymarket', { status: 'error' });
      dataFreshness.recordError('polymarket', String(error));
    }
  }

  private async loadNatural(): Promise<void> {
    // Load both USGS earthquakes and NASA EONET natural events in parallel
    const [earthquakeResult, eonetResult] = await Promise.allSettled([
      fetchEarthquakes(),
      fetchNaturalEvents(30),
    ]);

    // Handle earthquakes (USGS)
    if (earthquakeResult.status === 'fulfilled') {
      this.intelligenceCache.earthquakes = earthquakeResult.value;
      this.map?.setEarthquakes(earthquakeResult.value);
      ingestEarthquakes(earthquakeResult.value);
      this.statusPanel?.updateApi('USGS', { status: 'ok' });
      dataFreshness.recordUpdate('usgs', earthquakeResult.value.length);
    } else {
      this.intelligenceCache.earthquakes = [];
      this.map?.setEarthquakes([]);
      this.statusPanel?.updateApi('USGS', { status: 'error' });
      dataFreshness.recordError('usgs', String(earthquakeResult.reason));
    }

    // Handle natural events (EONET - storms, fires, volcanoes, etc.)
    if (eonetResult.status === 'fulfilled') {
      this.map?.setNaturalEvents(eonetResult.value);
      this.statusPanel?.updateFeed('EONET', {
        status: 'ok',
        itemCount: eonetResult.value.length,
      });
      this.statusPanel?.updateApi('NASA EONET', { status: 'ok' });
    } else {
      this.map?.setNaturalEvents([]);
      this.statusPanel?.updateFeed('EONET', { status: 'error', errorMessage: String(eonetResult.reason) });
      this.statusPanel?.updateApi('NASA EONET', { status: 'error' });
    }

    // Set layer ready based on combined data
    const hasEarthquakes = earthquakeResult.status === 'fulfilled' && earthquakeResult.value.length > 0;
    const hasEonet = eonetResult.status === 'fulfilled' && eonetResult.value.length > 0;
    this.map?.setLayerReady('natural', hasEarthquakes || hasEonet);
  }

  private async loadTechEvents(): Promise<void> {
    console.log('[loadTechEvents] Called. SITE_VARIANT:', SITE_VARIANT, 'techEvents layer:', this.mapLayers.techEvents);
    // Only load for tech variant or if techEvents layer is enabled
    if (SITE_VARIANT !== 'tech' && !this.mapLayers.techEvents) {
      console.log('[loadTechEvents] Skipping - not tech variant and layer disabled');
      return;
    }

    try {
      const res = await fetch('/v1/world/tech-events?type=conference&mappable=true&days=90&limit=50');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unknown error');

      // Transform events for map markers
      const now = new Date();
      const mapEvents = data.events.map((e: {
        id: string;
        title: string;
        location: string;
        coords: { lat: number; lng: number; country: string };
        startDate: string;
        endDate: string;
        url: string | null;
      }) => ({
        id: e.id,
        title: e.title,
        location: e.location,
        lat: e.coords.lat,
        lng: e.coords.lng,
        country: e.coords.country,
        startDate: e.startDate,
        endDate: e.endDate,
        url: e.url,
        daysUntil: Math.ceil((new Date(e.startDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      }));

      this.map?.setTechEvents(mapEvents);
      this.map?.setLayerReady('techEvents', mapEvents.length > 0);
      this.statusPanel?.updateFeed('Tech Events', { status: 'ok', itemCount: mapEvents.length });

      // Register tech events as searchable source
      if (SITE_VARIANT === 'tech' && this.searchModal) {
        this.searchModal.registerSource('techevent', mapEvents.map((e: { id: string; title: string; location: string; startDate: string }) => ({
          id: e.id,
          title: e.title,
          subtitle: `${e.location} • ${new Date(e.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
          data: e,
        })));
      }
    } catch (error) {
      console.error('[App] Failed to load tech events:', error);
      this.map?.setTechEvents([]);
      this.map?.setLayerReady('techEvents', false);
      this.statusPanel?.updateFeed('Tech Events', { status: 'error', errorMessage: String(error) });
    }
  }

  private async loadWeatherAlerts(): Promise<void> {
    try {
      const alerts = await fetchWeatherAlerts();
      this.map?.setWeatherAlerts(alerts);
      this.map?.setLayerReady('weather', alerts.length > 0);
      this.statusPanel?.updateFeed('Weather', { status: 'ok', itemCount: alerts.length });
      dataFreshness.recordUpdate('weather', alerts.length);
    } catch (error) {
      this.map?.setLayerReady('weather', false);
      this.statusPanel?.updateFeed('Weather', { status: 'error' });
      dataFreshness.recordError('weather', String(error));
    }
  }

  // Cache for intelligence data - allows CII to work even when layers are disabled
  private intelligenceCache: {
    outages?: InternetOutage[];
    protests?: { events: SocialUnrestEvent[]; sources: { acled: number; gdelt: number } };
    military?: { flights: MilitaryFlight[]; flightClusters: MilitaryFlightCluster[]; vessels: MilitaryVessel[]; vesselClusters: MilitaryVesselCluster[] };
    earthquakes?: import('@/types').Earthquake[];
  } = {};
  private cyberThreatsCache: CyberThreat[] | null = null;

  /**
   * Load intelligence-critical signals for CII/focal point calculation
   * This runs ALWAYS, regardless of layer visibility
   * Map rendering is separate and still gated by layer visibility
   */
  private async loadIntelligenceSignals(): Promise<void> {
    const tasks: Promise<void>[] = [];

    // Always fetch outages for CII (internet blackouts = major instability signal)
    tasks.push((async () => {
      try {
        const outages = await fetchInternetOutages();
        this.intelligenceCache.outages = outages;
        ingestOutagesForCII(outages);
        signalAggregator.ingestOutages(outages);
        dataFreshness.recordUpdate('outages', outages.length);
        // Update map only if layer is visible
        if (this.mapLayers.outages) {
          this.map?.setOutages(outages);
          this.map?.setLayerReady('outages', outages.length > 0);
          this.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
        }
      } catch (error) {
        console.error('[Intelligence] Outages fetch failed:', error);
        dataFreshness.recordError('outages', String(error));
      }
    })());

    // Always fetch protests for CII (unrest = core instability metric)
    // This task is also used by UCDP deduplication, so keep it as a shared promise.
    const protestsTask = (async (): Promise<SocialUnrestEvent[]> => {
      try {
        const protestData = await fetchProtestEvents();
        this.intelligenceCache.protests = protestData;
        ingestProtests(protestData.events);
        ingestProtestsForCII(protestData.events);
        signalAggregator.ingestProtests(protestData.events);
        const protestCount = protestData.sources.acled + protestData.sources.gdelt;
        if (protestCount > 0) dataFreshness.recordUpdate('acled', protestCount);
        if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt', protestData.sources.gdelt);
        // Update map only if layer is visible
        if (this.mapLayers.protests) {
          this.map?.setProtests(protestData.events);
          this.map?.setLayerReady('protests', protestData.events.length > 0);
          const status = getProtestStatus();
          this.statusPanel?.updateFeed('Protests', {
            status: 'ok',
            itemCount: protestData.events.length,
            errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
          });
        }
        return protestData.events;
      } catch (error) {
        console.error('[Intelligence] Protests fetch failed:', error);
        dataFreshness.recordError('acled', String(error));
        return [];
      }
    })();
    tasks.push(protestsTask.then(() => undefined));

    // Fetch armed conflict events (battles, explosions, violence) for CII
    tasks.push((async () => {
      try {
        const conflictData = await fetchConflictEvents();
        ingestConflictsForCII(conflictData.events);
        if (conflictData.count > 0) dataFreshness.recordUpdate('acled_conflict', conflictData.count);
      } catch (error) {
        console.error('[Intelligence] Conflict events fetch failed:', error);
        dataFreshness.recordError('acled_conflict', String(error));
      }
    })());

    // Fetch UCDP conflict classifications (war vs minor vs none)
    tasks.push((async () => {
      try {
        const classifications = await fetchUcdpClassifications();
        ingestUcdpForCII(classifications);
        if (classifications.size > 0) dataFreshness.recordUpdate('ucdp', classifications.size);
      } catch (error) {
        console.error('[Intelligence] UCDP fetch failed:', error);
        dataFreshness.recordError('ucdp', String(error));
      }
    })());

    // Fetch HDX HAPI aggregated conflict data (fallback/validation)
    tasks.push((async () => {
      try {
        const summaries = await fetchHapiSummary();
        ingestHapiForCII(summaries);
        if (summaries.size > 0) dataFreshness.recordUpdate('hapi', summaries.size);
      } catch (error) {
        console.error('[Intelligence] HAPI fetch failed:', error);
        dataFreshness.recordError('hapi', String(error));
      }
    })());

    // Always fetch military for CII (security = core instability metric)
    tasks.push((async () => {
      try {
        if (isMilitaryVesselTrackingConfigured()) {
          initMilitaryVesselStream();
        }
        const [flightData, vesselData] = await Promise.all([
          fetchMilitaryFlights(),
          fetchMilitaryVessels(),
        ]);
        this.intelligenceCache.military = {
          flights: flightData.flights,
          flightClusters: flightData.clusters,
          vessels: vesselData.vessels,
          vesselClusters: vesselData.clusters,
        };
        ingestFlights(flightData.flights);
        ingestVessels(vesselData.vessels);
        ingestMilitaryForCII(flightData.flights, vesselData.vessels);
        signalAggregator.ingestFlights(flightData.flights);
        signalAggregator.ingestVessels(vesselData.vessels);
        dataFreshness.recordUpdate('opensky', flightData.flights.length);
        // Temporal baseline: report counts and check for anomalies
        updateAndCheck([
          { type: 'military_flights', region: 'global', count: flightData.flights.length },
          { type: 'vessels', region: 'global', count: vesselData.vessels.length },
        ]).then(anomalies => {
          if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
        }).catch(() => { });
        // Update map only if layer is visible
        if (this.mapLayers.military) {
          this.map?.setMilitaryFlights(flightData.flights, flightData.clusters);
          this.map?.setMilitaryVessels(vesselData.vessels, vesselData.clusters);
          this.map?.updateMilitaryForEscalation(flightData.flights, vesselData.vessels);
          const militaryCount = flightData.flights.length + vesselData.vessels.length;
          this.statusPanel?.updateFeed('Military', {
            status: militaryCount > 0 ? 'ok' : 'warning',
            itemCount: militaryCount,
          });
        }
        // Detect military airlift surges and foreign presence (suppress during learning mode)
        if (!isInLearningMode()) {
          const surgeAlerts = analyzeFlightsForSurge(flightData.flights);
          if (surgeAlerts.length > 0) {
            const surgeSignals = surgeAlerts.map(surgeAlertToSignal);
            addToSignalHistory(surgeSignals);
            if (this.shouldShowIntelligenceNotifications()) this.signalModal?.show(surgeSignals);
          }
          const foreignAlerts = detectForeignMilitaryPresence(flightData.flights);
          if (foreignAlerts.length > 0) {
            const foreignSignals = foreignAlerts.map(foreignPresenceToSignal);
            addToSignalHistory(foreignSignals);
            if (this.shouldShowIntelligenceNotifications()) this.signalModal?.show(foreignSignals);
          }
        }
      } catch (error) {
        console.error('[Intelligence] Military fetch failed:', error);
        dataFreshness.recordError('opensky', String(error));
      }
    })());

    // Fetch UCDP georeferenced events (battles, one-sided violence, non-state conflict)
    tasks.push((async () => {
      try {
        const [result, protestEvents] = await Promise.all([
          fetchUcdpEvents(),
          protestsTask,
        ]);
        if (!result.success) {
          dataFreshness.recordError('ucdp_events', 'UCDP events unavailable (retaining prior event state)');
          return;
        }
        const acledEvents = protestEvents.map(e => ({
          latitude: e.lat, longitude: e.lon, event_date: e.time.toISOString(), fatalities: e.fatalities ?? 0,
        }));
        const events = deduplicateAgainstAcled(result.data, acledEvents);
        (this.panels['ucdp-events'] as UcdpEventsPanel)?.setEvents(events);
        if (this.mapLayers.ucdpEvents) {
          this.map?.setUcdpEvents(events);
        }
        if (events.length > 0) dataFreshness.recordUpdate('ucdp_events', events.length);
      } catch (error) {
        console.error('[Intelligence] UCDP events fetch failed:', error);
        dataFreshness.recordError('ucdp_events', String(error));
      }
    })());

    // Fetch UNHCR displacement data (refugees, asylum seekers, IDPs)
    tasks.push((async () => {
      try {
        const unhcrResult = await fetchUnhcrPopulation();
        if (!unhcrResult.ok) {
          dataFreshness.recordError('unhcr', 'UNHCR displacement unavailable (retaining prior displacement state)');
          return;
        }
        const data = unhcrResult.data;
        (this.panels['displacement'] as DisplacementPanel)?.setData(data);
        ingestDisplacementForCII(data.countries);
        if (this.mapLayers.displacement && data.topFlows) {
          this.map?.setDisplacementFlows(data.topFlows);
        }
        if (data.countries.length > 0) dataFreshness.recordUpdate('unhcr', data.countries.length);
      } catch (error) {
        console.error('[Intelligence] UNHCR displacement fetch failed:', error);
        dataFreshness.recordError('unhcr', String(error));
      }
    })());

    // Fetch climate anomalies (temperature/precipitation deviations)
    tasks.push((async () => {
      try {
        const climateResult = await fetchClimateAnomalies();
        if (!climateResult.ok) {
          dataFreshness.recordError('climate', 'Climate anomalies unavailable (retaining prior climate state)');
          return;
        }
        const anomalies = climateResult.anomalies;
        (this.panels['climate'] as ClimateAnomalyPanel)?.setAnomalies(anomalies);
        ingestClimateForCII(anomalies);
        if (this.mapLayers.climate) {
          this.map?.setClimateAnomalies(anomalies);
        }
        if (anomalies.length > 0) dataFreshness.recordUpdate('climate', anomalies.length);
      } catch (error) {
        console.error('[Intelligence] Climate anomalies fetch failed:', error);
        dataFreshness.recordError('climate', String(error));
      }
    })());

    await Promise.allSettled(tasks);

    // Fetch population exposure estimates after upstream intelligence loads complete.
    // This avoids race conditions where UCDP/protest data is still in-flight.
    try {
      const ucdpEvts = (this.panels['ucdp-events'] as UcdpEventsPanel)?.getEvents?.() || [];
      const events = [
        ...(this.intelligenceCache.protests?.events || []).slice(0, 10).map(e => ({
          id: e.id, lat: e.lat, lon: e.lon, type: 'conflict' as const, name: e.title || 'Protest',
        })),
        ...ucdpEvts.slice(0, 10).map(e => ({
          id: e.id, lat: e.latitude, lon: e.longitude, type: e.type_of_violence as string, name: `${e.side_a} vs ${e.side_b}`,
        })),
      ];
      if (events.length > 0) {
        const exposures = await enrichEventsWithExposure(events);
        (this.panels['population-exposure'] as PopulationExposurePanel)?.setExposures(exposures);
        if (exposures.length > 0) dataFreshness.recordUpdate('worldpop', exposures.length);
      }
    } catch (error) {
      console.error('[Intelligence] Population exposure fetch failed:', error);
      dataFreshness.recordError('worldpop', String(error));
    }

    // Now trigger CII refresh with all intelligence data
    (this.panels['cii'] as CIIPanel)?.refresh();
    console.log('[Intelligence] All signals loaded for CII calculation');
  }

  private async loadOutages(): Promise<void> {
    // Use cached data if available
    if (this.intelligenceCache.outages) {
      const outages = this.intelligenceCache.outages;
      this.map?.setOutages(outages);
      this.map?.setLayerReady('outages', outages.length > 0);
      this.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
      return;
    }
    try {
      const outages = await fetchInternetOutages();
      this.intelligenceCache.outages = outages;
      this.map?.setOutages(outages);
      this.map?.setLayerReady('outages', outages.length > 0);
      ingestOutagesForCII(outages);
      signalAggregator.ingestOutages(outages);
      this.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
      dataFreshness.recordUpdate('outages', outages.length);
    } catch (error) {
      this.map?.setLayerReady('outages', false);
      this.statusPanel?.updateFeed('NetBlocks', { status: 'error' });
      dataFreshness.recordError('outages', String(error));
    }
  }

  private async loadCyberThreats(): Promise<void> {
    if (!CYBER_LAYER_ENABLED) {
      this.mapLayers.cyberThreats = false;
      this.map?.setLayerReady('cyberThreats', false);
      return;
    }

    if (this.cyberThreatsCache) {
      this.map?.setCyberThreats(this.cyberThreatsCache);
      this.map?.setLayerReady('cyberThreats', this.cyberThreatsCache.length > 0);
      this.statusPanel?.updateFeed('Cyber Threats', { status: 'ok', itemCount: this.cyberThreatsCache.length });
      return;
    }

    try {
      const threats = await fetchCyberThreats({ limit: 500, days: 14 });
      this.cyberThreatsCache = threats;
      this.map?.setCyberThreats(threats);
      this.map?.setLayerReady('cyberThreats', threats.length > 0);
      this.statusPanel?.updateFeed('Cyber Threats', { status: 'ok', itemCount: threats.length });
      this.statusPanel?.updateApi('Cyber Threats API', { status: 'ok' });
      dataFreshness.recordUpdate('cyber_threats', threats.length);
    } catch (error) {
      this.map?.setLayerReady('cyberThreats', false);
      this.statusPanel?.updateFeed('Cyber Threats', { status: 'error', errorMessage: String(error) });
      this.statusPanel?.updateApi('Cyber Threats API', { status: 'error' });
      dataFreshness.recordError('cyber_threats', String(error));
    }
  }

  private async loadAisSignals(): Promise<void> {
    try {
      const { disruptions, density } = await fetchAisSignals();
      const aisStatus = getAisStatus();
      console.log('[Ships] Events:', { disruptions: disruptions.length, density: density.length, vessels: aisStatus.vessels });
      this.map?.setAisData(disruptions, density);
      signalAggregator.ingestAisDisruptions(disruptions);
      // Temporal baseline: report AIS gap counts
      updateAndCheck([
        { type: 'ais_gaps', region: 'global', count: disruptions.length },
      ]).then(anomalies => {
        if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
      }).catch(() => { });

      const hasData = disruptions.length > 0 || density.length > 0;
      this.map?.setLayerReady('ais', hasData);

      const shippingCount = disruptions.length + density.length;
      const shippingStatus = shippingCount > 0 ? 'ok' : (aisStatus.connected ? 'warning' : 'error');
      this.statusPanel?.updateFeed('Shipping', {
        status: shippingStatus,
        itemCount: shippingCount,
        errorMessage: !aisStatus.connected && shippingCount === 0 ? 'AIS snapshot unavailable' : undefined,
      });
      this.statusPanel?.updateApi('AISStream', {
        status: aisStatus.connected ? 'ok' : 'warning',
      });
      if (hasData) {
        dataFreshness.recordUpdate('ais', shippingCount);
      }
    } catch (error) {
      this.map?.setLayerReady('ais', false);
      this.statusPanel?.updateFeed('Shipping', { status: 'error', errorMessage: String(error) });
      this.statusPanel?.updateApi('AISStream', { status: 'error' });
      dataFreshness.recordError('ais', String(error));
    }
  }

  private waitForAisData(): void {
    const maxAttempts = 30;
    let attempts = 0;

    const checkData = () => {
      attempts++;
      const status = getAisStatus();

      if (status.vessels > 0 || status.connected) {
        this.loadAisSignals();
        this.map?.setLayerLoading('ais', false);
        return;
      }

      if (attempts >= maxAttempts) {
        this.map?.setLayerLoading('ais', false);
        this.map?.setLayerReady('ais', false);
        this.statusPanel?.updateFeed('Shipping', {
          status: 'error',
          errorMessage: 'Connection timeout'
        });
        return;
      }

      setTimeout(checkData, 1000);
    };

    checkData();
  }

  private async loadCableActivity(): Promise<void> {
    try {
      const activity = await fetchCableActivity();
      this.map?.setCableActivity(activity.advisories, activity.repairShips);
      const itemCount = activity.advisories.length + activity.repairShips.length;
      this.statusPanel?.updateFeed('CableOps', { status: 'ok', itemCount });
    } catch {
      this.statusPanel?.updateFeed('CableOps', { status: 'error' });
    }
  }

  private async loadProtests(): Promise<void> {
    // Use cached data if available (from loadIntelligenceSignals)
    if (this.intelligenceCache.protests) {
      const protestData = this.intelligenceCache.protests;
      this.map?.setProtests(protestData.events);
      this.map?.setLayerReady('protests', protestData.events.length > 0);
      const status = getProtestStatus();
      this.statusPanel?.updateFeed('Protests', {
        status: 'ok',
        itemCount: protestData.events.length,
        errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
      });
      if (status.acledConfigured === true) {
        this.statusPanel?.updateApi('ACLED', { status: 'ok' });
      } else if (status.acledConfigured === null) {
        this.statusPanel?.updateApi('ACLED', { status: 'warning' });
      }
      this.statusPanel?.updateApi('GDELT Doc', { status: 'ok' });
      return;
    }
    try {
      const protestData = await fetchProtestEvents();
      this.intelligenceCache.protests = protestData;
      this.map?.setProtests(protestData.events);
      this.map?.setLayerReady('protests', protestData.events.length > 0);
      ingestProtests(protestData.events);
      ingestProtestsForCII(protestData.events);
      signalAggregator.ingestProtests(protestData.events);
      const protestCount = protestData.sources.acled + protestData.sources.gdelt;
      if (protestCount > 0) dataFreshness.recordUpdate('acled', protestCount);
      if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt', protestData.sources.gdelt);
      (this.panels['cii'] as CIIPanel)?.refresh();
      const status = getProtestStatus();
      this.statusPanel?.updateFeed('Protests', {
        status: 'ok',
        itemCount: protestData.events.length,
        errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
      });
      if (status.acledConfigured === true) {
        this.statusPanel?.updateApi('ACLED', { status: 'ok' });
      } else if (status.acledConfigured === null) {
        this.statusPanel?.updateApi('ACLED', { status: 'warning' });
      }
      this.statusPanel?.updateApi('GDELT Doc', { status: 'ok' });
    } catch (error) {
      this.map?.setLayerReady('protests', false);
      this.statusPanel?.updateFeed('Protests', { status: 'error', errorMessage: String(error) });
      this.statusPanel?.updateApi('ACLED', { status: 'error' });
      this.statusPanel?.updateApi('GDELT Doc', { status: 'error' });
    }
  }

  private async loadFlightDelays(): Promise<void> {
    try {
      const delays = await fetchFlightDelays();
      this.map?.setFlightDelays(delays);
      this.map?.setLayerReady('flights', delays.length > 0);
      this.statusPanel?.updateFeed('Flights', {
        status: 'ok',
        itemCount: delays.length,
      });
      this.statusPanel?.updateApi('FAA', { status: 'ok' });
    } catch (error) {
      this.map?.setLayerReady('flights', false);
      this.statusPanel?.updateFeed('Flights', { status: 'error', errorMessage: String(error) });
      this.statusPanel?.updateApi('FAA', { status: 'error' });
    }
  }

  private async loadMilitary(): Promise<void> {
    // Use cached data if available (from loadIntelligenceSignals)
    if (this.intelligenceCache.military) {
      const { flights, flightClusters, vessels, vesselClusters } = this.intelligenceCache.military;
      this.map?.setMilitaryFlights(flights, flightClusters);
      this.map?.setMilitaryVessels(vessels, vesselClusters);
      this.map?.updateMilitaryForEscalation(flights, vessels);
      // Fetch cached postures for banner (posture panel fetches its own data)
      this.loadCachedPosturesForBanner();
      const insightsPanel = this.panels['insights'] as InsightsPanel | undefined;
      insightsPanel?.setMilitaryFlights(flights);
      const hasData = flights.length > 0 || vessels.length > 0;
      this.map?.setLayerReady('military', hasData);
      const militaryCount = flights.length + vessels.length;
      this.statusPanel?.updateFeed('Military', {
        status: militaryCount > 0 ? 'ok' : 'warning',
        itemCount: militaryCount,
        errorMessage: militaryCount === 0 ? 'No military activity in view' : undefined,
      });
      this.statusPanel?.updateApi('OpenSky', { status: 'ok' });
      return;
    }
    try {
      if (isMilitaryVesselTrackingConfigured()) {
        initMilitaryVesselStream();
      }
      const [flightData, vesselData] = await Promise.all([
        fetchMilitaryFlights(),
        fetchMilitaryVessels(),
      ]);
      this.intelligenceCache.military = {
        flights: flightData.flights,
        flightClusters: flightData.clusters,
        vessels: vesselData.vessels,
        vesselClusters: vesselData.clusters,
      };
      this.map?.setMilitaryFlights(flightData.flights, flightData.clusters);
      this.map?.setMilitaryVessels(vesselData.vessels, vesselData.clusters);
      ingestFlights(flightData.flights);
      ingestVessels(vesselData.vessels);
      ingestMilitaryForCII(flightData.flights, vesselData.vessels);
      signalAggregator.ingestFlights(flightData.flights);
      signalAggregator.ingestVessels(vesselData.vessels);
      // Temporal baseline: report counts from standalone military load
      updateAndCheck([
        { type: 'military_flights', region: 'global', count: flightData.flights.length },
        { type: 'vessels', region: 'global', count: vesselData.vessels.length },
      ]).then(anomalies => {
        if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
      }).catch(() => { });
      this.map?.updateMilitaryForEscalation(flightData.flights, vesselData.vessels);
      (this.panels['cii'] as CIIPanel)?.refresh();
      if (!isInLearningMode()) {
        const surgeAlerts = analyzeFlightsForSurge(flightData.flights);
        if (surgeAlerts.length > 0) {
          const surgeSignals = surgeAlerts.map(surgeAlertToSignal);
          addToSignalHistory(surgeSignals);
          if (this.shouldShowIntelligenceNotifications()) this.signalModal?.show(surgeSignals);
        }
        const foreignAlerts = detectForeignMilitaryPresence(flightData.flights);
        if (foreignAlerts.length > 0) {
          const foreignSignals = foreignAlerts.map(foreignPresenceToSignal);
          addToSignalHistory(foreignSignals);
          if (this.shouldShowIntelligenceNotifications()) this.signalModal?.show(foreignSignals);
        }
      }

      // Fetch cached postures for banner (posture panel fetches its own data)
      this.loadCachedPosturesForBanner();
      const insightsPanel = this.panels['insights'] as InsightsPanel | undefined;
      insightsPanel?.setMilitaryFlights(flightData.flights);

      const hasData = flightData.flights.length > 0 || vesselData.vessels.length > 0;
      this.map?.setLayerReady('military', hasData);
      const militaryCount = flightData.flights.length + vesselData.vessels.length;
      this.statusPanel?.updateFeed('Military', {
        status: militaryCount > 0 ? 'ok' : 'warning',
        itemCount: militaryCount,
        errorMessage: militaryCount === 0 ? 'No military activity in view' : undefined,
      });
      this.statusPanel?.updateApi('OpenSky', { status: 'ok' });
      dataFreshness.recordUpdate('opensky', flightData.flights.length);
    } catch (error) {
      this.map?.setLayerReady('military', false);
      this.statusPanel?.updateFeed('Military', { status: 'error', errorMessage: String(error) });
      this.statusPanel?.updateApi('OpenSky', { status: 'error' });
      dataFreshness.recordError('opensky', String(error));
    }
  }

  /**
   * Load cached theater postures for banner display
   * Uses server-side cached data to avoid redundant calculation per user
   */
  private async loadCachedPosturesForBanner(): Promise<void> {
    try {
      const data = await fetchCachedTheaterPosture();
      if (data && data.postures.length > 0) {
        this.renderCriticalBanner(data.postures);
        // Also update posture panel with shared data (saves a duplicate fetch)
        const posturePanel = this.panels['strategic-posture'] as StrategicPosturePanel | undefined;
        posturePanel?.updatePostures(data);
      }
    } catch (error) {
      console.warn('[App] Failed to load cached postures for banner:', error);
    }
  }


  private async loadFredData(): Promise<void> {
    const economicPanel = this.panels['economic'] as EconomicPanel;
    const cbInfo = getCircuitBreakerCooldownInfo('FRED Economic');
    if (cbInfo.onCooldown) {
      economicPanel?.setErrorState(true, `Temporarily unavailable (retry in ${cbInfo.remainingSeconds}s)`);
      this.statusPanel?.updateApi('FRED', { status: 'error' });
      return;
    }

    try {
      economicPanel?.setLoading(true);
      const data = await fetchFredData();

      // Check if circuit breaker tripped after fetch
      const postInfo = getCircuitBreakerCooldownInfo('FRED Economic');
      if (postInfo.onCooldown) {
        economicPanel?.setErrorState(true, `Temporarily unavailable (retry in ${postInfo.remainingSeconds}s)`);
        this.statusPanel?.updateApi('FRED', { status: 'error' });
        return;
      }

      if (data.length === 0) {
        const reason = isFeatureAvailable('economicFred')
          ? 'FRED data temporarily unavailable — will retry'
          : (canConfigureKeys() ? 'FRED_API_KEY not configured — add in Settings' : t('common.noDataAvailable'));
        economicPanel?.showDegraded(reason);
        this.statusPanel?.updateApi('FRED', { status: 'error' });
        return;
      }

      economicPanel?.setErrorState(false);
      economicPanel?.update(data);
      this.statusPanel?.updateApi('FRED', { status: 'ok' });
      dataFreshness.recordUpdate('economic', data.length);
    } catch {
      this.statusPanel?.updateApi('FRED', { status: 'error' });
      economicPanel?.setErrorState(true, 'FRED data temporarily unavailable — will retry');
      economicPanel?.setLoading(false);
    }
  }

  private async loadOilAnalytics(): Promise<void> {
    const economicPanel = this.panels['economic'] as EconomicPanel;
    try {
      const data = await fetchOilAnalytics();
      economicPanel?.updateOil(data);
      const hasData = !!(data.wtiPrice || data.brentPrice || data.usProduction || data.usInventory);
      this.statusPanel?.updateApi('EIA', { status: hasData ? 'ok' : 'error' });
    } catch (e) {
      console.error('[App] Oil analytics failed:', e);
      this.statusPanel?.updateApi('EIA', { status: 'error' });
    }
  }

  private async loadGovernmentSpending(): Promise<void> {
    const economicPanel = this.panels['economic'] as EconomicPanel;
    try {
      const data = await fetchRecentAwards({ daysBack: 7, limit: 15 });
      economicPanel?.updateSpending(data);
      this.statusPanel?.updateApi('USASpending', { status: data.awards.length > 0 ? 'ok' : 'error' });
    } catch (e) {
      console.error('[App] Government spending failed:', e);
      this.statusPanel?.updateApi('USASpending', { status: 'error' });
    }
  }

  private async loadChinaMacro(): Promise<void> {
    const economicPanel = this.panels['economic'] as EconomicPanel;
    try {
      const data = await fetchChinaMacro();
      economicPanel?.updateChina(data);
      this.statusPanel?.updateApi('ChinaMacro', { status: data.unavailable ? 'error' : 'ok' });
    } catch (e) {
      console.error('[App] China macro failed:', e);
      this.statusPanel?.updateApi('ChinaMacro', { status: 'error' });
    }
  }

  private updateMonitorResults(): void {
    const monitorPanel = this.panels['monitors'] as MonitorPanel;
    if (!monitorPanel) return;
    // Signed in, the Go backend matches against the whole lake — every item it
    // ingested, not just the headlines this tab loaded. Signed out (or server
    // unreachable), match locally exactly as before.
    void fetchMonitorMatches().then((matches) => {
      if (matches) monitorPanel.renderServerMatches(matches);
      else monitorPanel.renderResults(this.allNews);
    });
  }

  // Adopt the signed-in user's server-side monitors once identity resolves, so a
  // second device shows the monitors you made on the first.
  private async syncMonitorsFromServer(): Promise<void> {
    const monitors = await loadUserMonitors();
    if (!monitors.length && !this.monitors.length) return;
    this.monitors = monitors;
    (this.panels['monitors'] as MonitorPanel | undefined)?.setMonitors(monitors);
    this.updateMonitorResults();
  }

  private async runCorrelationAnalysis(): Promise<void> {
    try {
      // Ensure we have clusters (hybrid: semantic + Jaccard when ML available)
      if (this.latestClusters.length === 0 && this.allNews.length > 0) {
        this.latestClusters = await this.clusterNewsBudgeted(this.allNews);
      }

      // Ingest news clusters for CII
      if (this.latestClusters.length > 0) {
        ingestNewsForCII(this.latestClusters);
        dataFreshness.recordUpdate('gdelt', this.latestClusters.length);
        (this.panels['cii'] as CIIPanel)?.refresh();
      }

      // Run correlation analysis off main thread via Web Worker
      const signals = await analysisWorker.analyzeCorrelations(
        this.latestClusters,
        this.latestPredictions,
        this.latestMarkets
      );

      // Detect geographic convergence (suppress during learning mode)
      let geoSignals: ReturnType<typeof geoConvergenceToSignal>[] = [];
      if (!isInLearningMode()) {
        const geoAlerts = detectGeoConvergence(this.seenGeoAlerts);
        geoSignals = geoAlerts.map(geoConvergenceToSignal);
      }

      const keywordSpikeSignals = drainTrendingSignals();
      const allSignals = [...signals, ...geoSignals, ...keywordSpikeSignals];
      if (allSignals.length > 0) {
        addToSignalHistory(allSignals);
        if (this.shouldShowIntelligenceNotifications()) this.signalModal?.show(allSignals);
      }
    } catch (error) {
      console.error('[App] Correlation analysis failed:', error);
    }
  }

  private async loadFirmsData(): Promise<void> {
    try {
      const fireResult = await fetchAllFires(1);
      if (fireResult.skipped) {
        this.panels['satellite-fires']?.showConfigError('NASA_FIRMS_API_KEY not configured — add in Settings');
        this.statusPanel?.updateApi('FIRMS', { status: 'error' });
        return;
      }
      const { regions, totalCount } = fireResult;
      if (totalCount > 0) {
        const flat = flattenFires(regions);
        const stats = computeRegionStats(regions);

        // Feed signal aggregator
        signalAggregator.ingestSatelliteFires(flat.map(f => ({
          lat: f.lat,
          lon: f.lon,
          brightness: f.brightness,
          frp: f.frp,
          region: f.region,
          acq_date: f.acq_date,
        })));

        // Feed map layer
        this.map?.setFires(flat);

        // Feed panel
        (this.panels['satellite-fires'] as SatelliteFiresPanel)?.update(stats, totalCount);

        dataFreshness.recordUpdate('firms', totalCount);

        // Report to temporal baseline (fire-and-forget)
        updateAndCheck([
          { type: 'satellite_fires', region: 'global', count: totalCount },
        ]).then(anomalies => {
          if (anomalies.length > 0) {
            signalAggregator.ingestTemporalAnomalies(anomalies);
          }
        }).catch(() => { });
      } else {
        // Still update panel so it exits loading spinner
        (this.panels['satellite-fires'] as SatelliteFiresPanel)?.update([], 0);
      }
      this.statusPanel?.updateApi('FIRMS', { status: 'ok' });
    } catch (e) {
      console.warn('[App] FIRMS load failed:', e);
      (this.panels['satellite-fires'] as SatelliteFiresPanel)?.update([], 0);
      this.statusPanel?.updateApi('FIRMS', { status: 'error' });
      dataFreshness.recordError('firms', String(e));
    }
  }

  private scheduleRefresh(
    name: string,
    fn: () => Promise<void>,
    intervalMs: number,
    condition?: () => boolean
  ): void {
    const HIDDEN_REFRESH_MULTIPLIER = 4;
    const JITTER_FRACTION = 0.1;
    const MIN_REFRESH_MS = 1000;
    const computeDelay = (baseMs: number, isHidden: boolean) => {
      const adjusted = baseMs * (isHidden ? HIDDEN_REFRESH_MULTIPLIER : 1);
      const jitterRange = adjusted * JITTER_FRACTION;
      const jittered = adjusted + (Math.random() * 2 - 1) * jitterRange;
      return Math.max(MIN_REFRESH_MS, Math.round(jittered));
    };
    const scheduleNext = (delay: number) => {
      if (this.isDestroyed) return;
      const timeoutId = setTimeout(run, delay);
      this.refreshTimeoutIds.set(name, timeoutId);
    };
    const run = async () => {
      if (this.isDestroyed) return;
      const isHidden = document.visibilityState === 'hidden';
      if (isHidden) {
        scheduleNext(computeDelay(intervalMs, true));
        return;
      }
      if (condition && !condition()) {
        scheduleNext(computeDelay(intervalMs, false));
        return;
      }
      if (this.inFlight.has(name)) {
        scheduleNext(computeDelay(intervalMs, false));
        return;
      }
      this.inFlight.add(name);
      try {
        await fn();
      } catch (e) {
        console.error(`[App] Refresh ${name} failed:`, e);
      } finally {
        this.inFlight.delete(name);
        scheduleNext(computeDelay(intervalMs, false));
      }
    };
    scheduleNext(computeDelay(intervalMs, document.visibilityState === 'hidden'));
  }

  private setupRefreshIntervals(): void {
    // Always refresh news, markets, predictions, pizzint
    this.scheduleRefresh('news', () => this.loadNews(), REFRESH_INTERVALS.feeds);
    this.scheduleRefresh('markets', () => this.loadMarkets(), REFRESH_INTERVALS.markets);
    this.scheduleRefresh('predictions', () => this.loadPredictions(), REFRESH_INTERVALS.predictions);
    this.scheduleRefresh('pizzint', () => this.loadPizzInt(), 10 * 60 * 1000);

    // Only refresh layer data if layer is enabled
    this.scheduleRefresh('natural', () => this.loadNatural(), 5 * 60 * 1000, () => this.mapLayers.natural);
    this.scheduleRefresh('weather', () => this.loadWeatherAlerts(), 10 * 60 * 1000, () => this.mapLayers.weather);
    this.scheduleRefresh('fred', () => this.loadFredData(), 30 * 60 * 1000);
    this.scheduleRefresh('oil', () => this.loadOilAnalytics(), 30 * 60 * 1000);
    this.scheduleRefresh('spending', () => this.loadGovernmentSpending(), 60 * 60 * 1000);
    this.scheduleRefresh('china', () => this.loadChinaMacro(), 30 * 60 * 1000);

    // Refresh intelligence signals for CII (geopolitical variant only)
    // This handles outages, protests, military - updates map when layers enabled
    if (SITE_VARIANT === 'full') {
      this.scheduleRefresh('intelligence', () => {
        this.intelligenceCache = {}; // Clear cache to force fresh fetch
        return this.loadIntelligenceSignals();
      }, 5 * 60 * 1000);
    }

    // Non-intelligence layer refreshes only
    // NOTE: outages, protests, military are refreshed by intelligence schedule above
    this.scheduleRefresh('firms', () => this.loadFirmsData(), 30 * 60 * 1000);
    this.scheduleRefresh('ais', () => this.loadAisSignals(), REFRESH_INTERVALS.ais, () => this.mapLayers.ais);
    this.scheduleRefresh('cables', () => this.loadCableActivity(), 30 * 60 * 1000, () => this.mapLayers.cables);
    this.scheduleRefresh('flights', () => this.loadFlightDelays(), 10 * 60 * 1000, () => this.mapLayers.flights);
    this.scheduleRefresh('cyberThreats', () => {
      this.cyberThreatsCache = null;
      return this.loadCyberThreats();
    }, 10 * 60 * 1000, () => CYBER_LAYER_ENABLED && this.mapLayers.cyberThreats);
  }
}
