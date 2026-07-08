// SaaS / Cloud variant — world.hanzo.ai/?variant=saas
//
// Instead of world intelligence, this variant renders HANZO CLOUD ITSELF: live
// platform metrics (requests, models served, nodes/GPUs, regions) for an
// investor-facing global view, and — when signed in — the caller's own org/
// project usage and bill drill-down. Data comes from our own cloud APIs
// (api.hanzo.ai) with the CALLER's IAM token (no shared keys); the signed-out
// investor view uses a public anonymized aggregate (/v1/world/cloud-pulse),
// clearly flagged as demo data when live platform metrics are not exposable.
//
// The canonical panel/layer records consumed by App.ts live in ../panels.ts
// (variant-aware). This file mirrors its siblings (full/tech/finance) for
// structural parity and exposes VARIANT_CONFIG for tooling.
import type { PanelConfig, MapLayers } from '@/types';
import type { VariantConfig } from './base';

// Re-export base config
export * from './base';

// Panel configuration for the SaaS / cloud view. Dense stat tiles, not feeds.
export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Cloud Infrastructure', enabled: true, priority: 1 },
  'cloud-overview': { name: 'Cloud Overview', enabled: true, priority: 1 },
  'model-usage': { name: 'Model Usage', enabled: true, priority: 1 },
  fleet: { name: 'Fleet & GPUs', enabled: true, priority: 1 },
  'live-activity': { name: 'Live Activity', enabled: true, priority: 1 },
  'my-usage': { name: 'My Usage & Bill', enabled: true, priority: 1 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

// Map layers: OUR cloud regions/nodes as the primary layer. Reuses the existing
// datacenters (GPU/AI DC) + cloudRegions layers as the global infrastructure
// backdrop; everything geopolitical is off (this is a cloud console, not intel).
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
  economic: false,
  waterways: false,
  outages: true,
  cyberThreats: false,
  datacenters: true,
  protests: false,
  flights: false,
  military: false,
  natural: false,
  spaceports: false,
  minerals: false,
  fires: false,
  robotics: false,
  quantum: false,
  ucdpEvents: false,
  displacement: false,
  climate: false,
  startupHubs: false,
  cloudRegions: true,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
};

export const MOBILE_DEFAULT_MAP_LAYERS: MapLayers = {
  ...DEFAULT_MAP_LAYERS,
  cables: false,
  outages: true,
  datacenters: true,
  cloudRegions: false,
};

export const VARIANT_CONFIG: VariantConfig = {
  name: 'saas',
  description: 'Hanzo Cloud — live SaaS platform metrics & usage',
  panels: DEFAULT_PANELS,
  mapLayers: DEFAULT_MAP_LAYERS,
  mobileMapLayers: MOBILE_DEFAULT_MAP_LAYERS,
};
