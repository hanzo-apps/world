// Hanzo variant (flagship) — world.hanzo.ai/?variant=hanzo
//
// The world.hanzo.ai DEFAULT view. Renders HANZO ITSELF, not world intel: the live-
// traffic globe (WHERE requests hit api.hanzo.ai from — native LB telemetry via
// /v1/world/cloud/traffic-globe) as the centerpiece, plus platform metrics (router/
// Enso training, throughput, model mix, fleet, uptime) and — when signed in — the
// caller's own org usage + bill. Folds the former `saas` variant (kept as an alias;
// see ./saas.ts). Data comes from our own cloud APIs (api.hanzo.ai) with the CALLER's
// IAM token; the signed-out view uses public anonymized aggregates, clearly flagged.
//
// The canonical panel/layer records consumed by App.ts live in ../panels.ts
// (variant-aware, HANZO_PANELS / HANZO_MAP_LAYERS). This file mirrors its siblings
// (full/tech/finance) for structural parity and exposes VARIANT_CONFIG for tooling.
import type { PanelConfig, MapLayers } from '@/types';
import type { VariantConfig } from './base';

// Re-export base config
export * from './base';

// Panel configuration for the Hanzo flagship view. Dense stat tiles + the globe.
export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Cloud Infrastructure', enabled: true, priority: 1 },
  'traffic-globe': { name: 'Live Traffic', enabled: true, priority: 1 },
  'cloud-overview': { name: 'Cloud Overview', enabled: true, priority: 1 },
  'enso-training': { name: 'Enso Live Training', enabled: true, priority: 1 },
  'enso-flywheel': { name: 'Enso Flywheel', enabled: true, priority: 1 },
  'ai-compute': { name: 'AI Compute', enabled: true, priority: 1 },
  'model-usage': { name: 'Model Usage', enabled: true, priority: 1 },
  fleet: { name: 'Fleet & GPUs', enabled: true, priority: 1 },
  'live-activity': { name: 'Live Activity', enabled: true, priority: 1 },
  'my-usage': { name: 'My Usage & Bill', enabled: true, priority: 1 },
  'hanzo-status': { name: 'Hanzo Status', enabled: true, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

// Map layers: OUR cloud regions/nodes + the native request-geo globe as the primary
// layers; everything geopolitical is off (this is a cloud console, not intel).
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
  chainNodes: true,
  byoGpu: true,
  trafficArcs: true,
  traffic: true,
};

export const MOBILE_DEFAULT_MAP_LAYERS: MapLayers = {
  ...DEFAULT_MAP_LAYERS,
  cables: false,
  cloudRegions: false,
  trafficArcs: false,
  traffic: true,
};

export const VARIANT_CONFIG: VariantConfig = {
  name: 'hanzo',
  description: 'Hanzo — flagship: live-traffic globe + cloud/SaaS platform metrics',
  panels: DEFAULT_PANELS,
  mapLayers: DEFAULT_MAP_LAYERS,
  mobileMapLayers: MOBILE_DEFAULT_MAP_LAYERS,
};
