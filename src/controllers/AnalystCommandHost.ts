import type { AnalystHost } from '@/services/analyst-actions';
import type { Monitor, MapLayers, PanelConfig } from '@/types';
import type { TimeRange } from '@/components';
import type { MapContainer } from '@/components/MapContainer';
import type { ImmersiveController } from '@/services/immersive';
import { getSiteVariant } from '@/config';
import { getCurrentLanguage } from '@/services/i18n';
import { getCurrentTheme } from '@/utils';
import { isAuthenticated, listOrgs } from '@/services/iam';
import { watchQueue } from '@/services/watch-queue';

/**
 * The capability port App exposes to the agentic control surface. Every member
 * maps 1:1 to an App method or field accessor — the AnalystCommandHost owns the
 * *shape* of the agent's control interface (state projections + command names),
 * App owns the *implementations*. Accessors (not values) so live reassignments
 * (monitors / mapLayers / analystOrgs) read fresh.
 */
export interface AnalystHostBridge {
  // introspection reads
  getTimeRange(): TimeRange;
  getMap(): MapContainer | null;
  getImmersive(): ImmersiveController | null;
  getLayoutMode(): 'grid' | 'free';
  getMonitors(): Monitor[];
  getPanelSettings(): Record<string, PanelConfig>;
  getLocalizedPanelName(key: string, fallback: string): string;
  isDesktopApp(): boolean;
  getMapLayers(): MapLayers;
  getAnalystOrgs(): Array<{ id: string; name: string }>;
  setAnalystOrgs(orgs: Array<{ id: string; name: string }>): void;
  // capabilities (each forwards to the identically-named App method)
  setPanelEnabled(key: string, enabled: boolean): boolean;
  movePanelInGrid(key: string, opts: { before?: string; after?: string; position?: 'top' | 'bottom' }): boolean;
  resizePanelInGrid(key: string, span: number): boolean;
  setMapLayerEnabled(key: string, on: boolean): boolean;
  setMapProjection(mode: '2d' | '3d'): boolean;
  flyMapTo(lat: number, lon: number, zoom?: number): boolean;
  setMapRegion(region: string): boolean;
  setGlobalTimeRange(range: string): boolean;
  setSiteVariant(variant: string): boolean;
  setAppTheme(theme: 'dark' | 'light'): boolean;
  runSearch(query: string): boolean;
  resetPanelLayout(): void;
  queueVideoToWatch(query: string): Promise<{ ok: boolean; note?: string; title?: string }>;
  setLayoutModeFromCommand(mode: 'grid' | 'free' | 'immersive'): boolean;
  setImmersiveBackgroundFromCommand(bg: 'map' | 'video'): boolean;
  setLanguageFromCommand(code: string): boolean;
  addMonitorFromCommand(keywords: string): { ok: boolean; id?: string };
  removeMonitorFromCommand(id: string): boolean;
  addCustomFeedPanel(name: string, url: string): Promise<{ ok: boolean; note?: string }>;
  removeCustomFeedPanel(name: string): boolean;
  switchActiveOrg(org: string): Promise<{ ok: boolean; note?: string }>;
}

/**
 * Builds the AnalystHost object the AI analyst dock / panel / country brief drive.
 * Extracted verbatim from App.buildAnalystHost() — same projections, same org
 * priming, same command routing. Behavior byte-for-byte identical.
 */
export class AnalystCommandHost {
  constructor(private readonly bridge: AnalystHostBridge) {}

  build(): AnalystHost {
    // Prime the org snapshot once (async) so listOrgs()/switch_org have real ids.
    if (isAuthenticated() && !this.bridge.getAnalystOrgs().length) {
      void listOrgs().then((orgs) => {
        this.bridge.setAnalystOrgs(orgs.map((o) => ({ id: o.name, name: o.displayName || o.name })));
      });
    }
    return {
      getState: () => ({
        variant: getSiteVariant(),
        timeRange: this.bridge.getTimeRange(),
        mapMode: this.bridge.getMap()?.getProjectionMode(),
        region: this.bridge.getMap()?.getState().view,
        theme: getCurrentTheme(),
        authed: isAuthenticated(),
        layoutMode: this.bridge.getImmersive()?.getState().enabled ? 'immersive' : this.bridge.getLayoutMode(),
        immersiveBg: this.bridge.getImmersive()?.getState().background,
        language: getCurrentLanguage(),
        monitors: this.bridge.getMonitors().map((m) => ({ id: m.id, keywords: m.keywords })),
        queue: {
          total: watchQueue.length,
          unwatched: watchQueue.unwatchedCount(),
          current: watchQueue.current()?.title,
        },
      }),
      listPanels: () =>
        Object.entries(this.bridge.getPanelSettings())
          .filter(([k]) => k !== 'runtime-config' || this.bridge.isDesktopApp())
          .map(([key, cfg]) => ({ key, name: this.bridge.getLocalizedPanelName(key, cfg.name), enabled: !!cfg.enabled })),
      listLayers: () => Object.entries(this.bridge.getMapLayers()).map(([key, on]) => ({ key, on: !!on })),
      listOrgs: () => this.bridge.getAnalystOrgs(),
      isAuthed: () => isAuthenticated(),
      showPanel: (key) => this.bridge.setPanelEnabled(key, true),
      hidePanel: (key) => this.bridge.setPanelEnabled(key, false),
      movePanel: (key, opts) => this.bridge.movePanelInGrid(key, opts),
      resizePanel: (key, span) => this.bridge.resizePanelInGrid(key, span),
      toggleLayer: (key, on) => this.bridge.setMapLayerEnabled(key, on),
      setMapMode: (mode) => this.bridge.setMapProjection(mode),
      flyTo: (lat, lon, zoom) => this.bridge.flyMapTo(lat, lon, zoom),
      setRegion: (region) => this.bridge.setMapRegion(region),
      setTimeRange: (range) => this.bridge.setGlobalTimeRange(range),
      setVariant: (variant) => this.bridge.setSiteVariant(variant),
      setTheme: (theme) => this.bridge.setAppTheme(theme),
      search: (query) => this.bridge.runSearch(query),
      resetLayout: () => this.bridge.resetPanelLayout(),
      queueVideo: (query) => this.bridge.queueVideoToWatch(query),
      setLayoutMode: (mode) => this.bridge.setLayoutModeFromCommand(mode),
      setImmersiveBackground: (bg) => this.bridge.setImmersiveBackgroundFromCommand(bg),
      setLanguage: (code) => this.bridge.setLanguageFromCommand(code),
      addMonitor: (keywords) => this.bridge.addMonitorFromCommand(keywords),
      removeMonitor: (id) => this.bridge.removeMonitorFromCommand(id),
      queueNext: () => {
        if (!watchQueue.length) return { ok: false };
        return { ok: true, title: watchQueue.next()?.title };
      },
      queuePrev: () => {
        if (!watchQueue.length) return { ok: false };
        return { ok: true, title: watchQueue.prev()?.title };
      },
      addFeedPanel: (name, url) => this.bridge.addCustomFeedPanel(name, url),
      removeCustomPanel: (name) => this.bridge.removeCustomFeedPanel(name),
      switchOrg: (org) => this.bridge.switchActiveOrg(org),
    };
  }
}
