/**
 * Data Freshness Tracker
 * Tracks when each data source was last updated to prevent
 * showing misleading "all clear" when we actually have no data.
 */

export type DataSourceId =
  | 'acled'      // Protests/conflicts
  | 'opensky'    // Military flights
  | 'wingbits'   // Aircraft enrichment
  | 'ais'        // Vessel tracking
  | 'usgs'       // Earthquakes
  | 'gdelt'      // News velocity
  | 'rss'        // RSS feeds
  | 'polymarket' // Prediction markets
  | 'outages'    // Internet outages
  | 'weather'    // Weather alerts
  | 'economic'   // Economic indicators (FRED)
  | 'oil'        // EIA oil analytics
  | 'spending';  // USASpending.gov

export type FreshnessStatus = 'fresh' | 'stale' | 'very_stale' | 'no_data' | 'disabled' | 'error';

export interface DataSourceState {
  id: DataSourceId;
  name: string;
  lastUpdate: Date | null;
  lastError: string | null;
  itemCount: number;
  enabled: boolean;
  status: FreshnessStatus;
  requiredForRisk: boolean; // Is this source important for risk assessment?
}

export interface DataFreshnessSummary {
  totalSources: number;
  activeSources: number;
  staleSources: number;
  disabledSources: number;
  errorSources: number;
  overallStatus: 'sufficient' | 'limited' | 'insufficient';
  coveragePercent: number;
  oldestUpdate: Date | null;
  newestUpdate: Date | null;
}

// Thresholds in milliseconds
const FRESH_THRESHOLD = 15 * 60 * 1000;      // 15 minutes
const STALE_THRESHOLD = 60 * 60 * 1000;      // 1 hour
const VERY_STALE_THRESHOLD = 6 * 60 * 60 * 1000; // 6 hours

// Core sources needed for meaningful risk assessment
// Note: ACLED is optional since GDELT provides protest data as fallback
const CORE_SOURCES: DataSourceId[] = ['gdelt', 'rss'];

const SOURCE_METADATA: Record<DataSourceId, { name: string; requiredForRisk: boolean; panelId?: string }> = {
  acled: { name: 'Protests & Conflicts', requiredForRisk: false, panelId: 'protests' },
  opensky: { name: 'Military Flights', requiredForRisk: false, panelId: 'military' },
  wingbits: { name: 'Aircraft Enrichment', requiredForRisk: false, panelId: 'military' },
  ais: { name: 'Vessel Tracking', requiredForRisk: false, panelId: 'shipping' },
  usgs: { name: 'Earthquakes', requiredForRisk: false, panelId: 'natural' },
  gdelt: { name: 'News Intelligence', requiredForRisk: true, panelId: 'intel' },
  rss: { name: 'Live News Feeds', requiredForRisk: true, panelId: 'live-news' },
  polymarket: { name: 'Prediction Markets', requiredForRisk: false, panelId: 'polymarket' },
  outages: { name: 'Internet Outages', requiredForRisk: false, panelId: 'outages' },
  weather: { name: 'Weather Alerts', requiredForRisk: false, panelId: 'weather' },
  economic: { name: 'Economic Data (FRED)', requiredForRisk: false, panelId: 'economic' },
  oil: { name: 'Oil Analytics (EIA)', requiredForRisk: false, panelId: 'economic' },
  spending: { name: 'Gov Spending', requiredForRisk: false, panelId: 'economic' },
};

class DataFreshnessTracker {
  private sources: Map<DataSourceId, DataSourceState> = new Map();
  private listeners: Set<() => void> = new Set();

  constructor() {
    // Initialize all sources
    for (const [id, meta] of Object.entries(SOURCE_METADATA)) {
      this.sources.set(id as DataSourceId, {
        id: id as DataSourceId,
        name: meta.name,
        lastUpdate: null,
        lastError: null,
        itemCount: 0,
        enabled: true, // Assume enabled by default
        status: 'no_data',
        requiredForRisk: meta.requiredForRisk,
      });
    }
  }

  /**
   * Record that a data source received new data
   */
  recordUpdate(sourceId: DataSourceId, itemCount: number = 1): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.lastUpdate = new Date();
      source.itemCount += itemCount;
      source.lastError = null;
      source.status = this.calculateStatus(source);
      this.notifyListeners();
    }
  }

  /**
   * Record an error for a data source
   */
  recordError(sourceId: DataSourceId, error: string): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.lastError = error;
      source.status = 'error';
      this.notifyListeners();
    }
  }

  /**
   * Set whether a source is enabled/disabled
   */
  setEnabled(sourceId: DataSourceId, enabled: boolean): void {
    const source = this.sources.get(sourceId);
    if (source) {
      source.enabled = enabled;
      source.status = enabled ? this.calculateStatus(source) : 'disabled';
      this.notifyListeners();
    }
  }

  /**
   * Get the state of a specific source
   */
  getSource(sourceId: DataSourceId): DataSourceState | undefined {
    const source = this.sources.get(sourceId);
    if (source) {
      // Recalculate status in case time has passed
      source.status = source.enabled ? this.calculateStatus(source) : 'disabled';
    }
    return source;
  }

  /**
   * Get all source states
   */
  getAllSources(): DataSourceState[] {
    return Array.from(this.sources.values()).map(source => ({
      ...source,
      status: source.enabled ? this.calculateStatus(source) : 'disabled',
    }));
  }

  /**
   * Get sources required for risk assessment
   */
  getRiskSources(): DataSourceState[] {
    return this.getAllSources().filter(s => s.requiredForRisk);
  }

  /**
   * Get overall data freshness summary
   */
  getSummary(): DataFreshnessSummary {
    const sources = this.getAllSources();
    const riskSources = sources.filter(s => s.requiredForRisk);

    const activeSources = sources.filter(s => s.status === 'fresh' || s.status === 'stale');
    const activeRiskSources = riskSources.filter(s => s.status === 'fresh' || s.status === 'stale');
    const staleSources = sources.filter(s => s.status === 'stale' || s.status === 'very_stale');
    const disabledSources = sources.filter(s => s.status === 'disabled');
    const errorSources = sources.filter(s => s.status === 'error');

    const updates = sources
      .filter(s => s.lastUpdate)
      .map(s => s.lastUpdate!.getTime());

    // Coverage is based on risk-required sources
    const coveragePercent = riskSources.length > 0
      ? Math.round((activeRiskSources.length / riskSources.length) * 100)
      : 0;

    // Overall status
    let overallStatus: 'sufficient' | 'limited' | 'insufficient';
    if (activeRiskSources.length >= CORE_SOURCES.length && coveragePercent >= 66) {
      overallStatus = 'sufficient';
    } else if (activeRiskSources.length >= 1) {
      overallStatus = 'limited';
    } else {
      overallStatus = 'insufficient';
    }

    return {
      totalSources: sources.length,
      activeSources: activeSources.length,
      staleSources: staleSources.length,
      disabledSources: disabledSources.length,
      errorSources: errorSources.length,
      overallStatus,
      coveragePercent,
      oldestUpdate: updates.length > 0 ? new Date(Math.min(...updates)) : null,
      newestUpdate: updates.length > 0 ? new Date(Math.max(...updates)) : null,
    };
  }

  /**
   * Check if we have enough data for risk assessment
   */
  hasSufficientData(): boolean {
    return this.getSummary().overallStatus === 'sufficient';
  }

  /**
   * Check if we have any data at all
   */
  hasAnyData(): boolean {
    return this.getSummary().activeSources > 0;
  }

  /**
   * Get panel ID for a source (to enable it)
   */
  getPanelIdForSource(sourceId: DataSourceId): string | undefined {
    return SOURCE_METADATA[sourceId]?.panelId;
  }

  /**
   * Subscribe to changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private calculateStatus(source: DataSourceState): FreshnessStatus {
    if (!source.enabled) return 'disabled';
    if (source.lastError) return 'error';
    if (!source.lastUpdate) return 'no_data';

    const age = Date.now() - source.lastUpdate.getTime();
    if (age < FRESH_THRESHOLD) return 'fresh';
    if (age < STALE_THRESHOLD) return 'stale';
    if (age < VERY_STALE_THRESHOLD) return 'very_stale';
    return 'no_data'; // Too old, treat as no data
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.error('[DataFreshness] Listener error:', e);
      }
    }
  }

  /**
   * Get human-readable time since last update
   */
  getTimeSince(sourceId: DataSourceId): string {
    const source = this.sources.get(sourceId);
    if (!source?.lastUpdate) return 'never';

    const ms = Date.now() - source.lastUpdate.getTime();
    if (ms < 60000) return 'just now';
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
    if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
    return `${Math.floor(ms / 86400000)}d ago`;
  }
}

// Singleton instance
export const dataFreshness = new DataFreshnessTracker();

// Helper to get status color
export function getStatusColor(status: FreshnessStatus): string {
  switch (status) {
    case 'fresh': return '#44aa44';
    case 'stale': return '#ffaa00';
    case 'very_stale': return '#ff8800';
    case 'error': return '#ff4444';
    case 'disabled': return '#666666';
    case 'no_data': return '#888888';
  }
}

// Helper to get status icon
export function getStatusIcon(status: FreshnessStatus): string {
  switch (status) {
    case 'fresh': return '●';
    case 'stale': return '◐';
    case 'very_stale': return '○';
    case 'error': return '✕';
    case 'disabled': return '○';
    case 'no_data': return '○';
  }
}
