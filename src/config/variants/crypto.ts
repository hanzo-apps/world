// Crypto variant — world.hanzo.ai/?variant=crypto
//
// Digital-assets & markets view. A composition of existing panels: CoinGecko
// prices + crypto news lead, the trader desk (BTC dominance / funding), ETF
// flows, stablecoins, market radar, sector heatmap, sentiment and predictions.
// Feeds resolve to FINANCE_FEEDS (see ../feeds.ts) — the `crypto`/`markets`/
// `economic` data panels each also spawn a `-news` feed panel via the FEEDS loop
// in App.ts.
//
// The canonical panel/layer records consumed by App.ts live in ../panels.ts
// (variant-aware). This file mirrors its siblings (tech/finance/saas) for
// structural parity and exposes VARIANT_CONFIG for tooling.
import type { PanelConfig, MapLayers } from '@/types';
import type { VariantConfig } from './base';

// Re-export base config
export * from './base';

export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  'defi-board': { name: 'DeFi', enabled: true, priority: 1 },
  map: { name: 'Bridge Flows Map', enabled: true, priority: 1 },
  chains: { name: 'Chains', enabled: true, priority: 1 },
  'live-news': { name: 'Crypto & DeFi Headlines', enabled: true, priority: 1 },
  'crypto-news': { name: 'Crypto News', enabled: true, priority: 2 },
  insights: { name: 'AI Market Insights', enabled: true, priority: 2 },
  'ai-analyst': { name: 'AI analyst', enabled: true, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

export const DEFAULT_MAP_LAYERS: MapLayers = {
  conflicts: false,
  bases: false,
  cables: true,
  pipelines: false,
  hotspots: false,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: false,
  weather: false,
  economic: true,
  waterways: false,
  outages: true,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: false,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  robotics: false,
  quantum: false,
  ucdpEvents: false,
  displacement: false,
  climate: false,
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Economic + financial centers as the market backdrop
  stockExchanges: false,
  financialCenters: true,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
  // Hanzo World cloud map layers — the DeFi view's arcs are BRIDGE FLOWS.
  chainNodes: true,
  byoGpu: false,
  trafficArcs: false,
  bridgeFlows: true,
};

export const MOBILE_DEFAULT_MAP_LAYERS: MapLayers = {
  ...DEFAULT_MAP_LAYERS,
  cables: false,
  financialCenters: false,
};

export const VARIANT_CONFIG: VariantConfig = {
  name: 'crypto',
  description: 'Lux DeFi dashboard — bridge-supported chain universe + live on-chain metrics',
  panels: DEFAULT_PANELS,
  mapLayers: DEFAULT_MAP_LAYERS,
  mobileMapLayers: MOBILE_DEFAULT_MAP_LAYERS,
};
