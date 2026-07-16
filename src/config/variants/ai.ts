// AI variant — world.hanzo.ai/?variant=ai
//
// AI/ML industry, research and infrastructure view. A composition of existing
// panels: AI/ML news + AI Insights lead, the tech feed set (ai/tech/policy/
// hardware/cloud/dev/security/github/layoffs) fills the body, prediction markets
// and a datacenter/cloud-region map anchor the infrastructure story. Feeds
// resolve to TECH_FEEDS (see ../feeds.ts); the `ai` news panel already carries
// ArXiv AI/ML + MIT Research, so research surfaces without a bespoke panel.
//
// The canonical panel/layer records consumed by App.ts live in ../panels.ts
// (variant-aware). This file mirrors its siblings (tech/finance/saas) for
// structural parity and exposes VARIANT_CONFIG for tooling.
import type { PanelConfig, MapLayers } from '@/types';
import type { VariantConfig } from './base';

// Re-export base config
export * from './base';

export const DEFAULT_PANELS: Record<string, PanelConfig> = {
  watch: { name: 'Watch Queue', enabled: true, priority: 2 },
  map: { name: 'Global AI Map', enabled: true, priority: 1 },
  'ai-compute': { name: 'AI Compute', enabled: true, priority: 1 },
  'live-news': { name: 'AI & Tech Headlines', enabled: true, priority: 1 },
  insights: { name: 'AI Insights', enabled: true, priority: 1 },
  ai: { name: 'AI/ML News', enabled: true, priority: 1 },
  tech: { name: 'Technology', enabled: true, priority: 1 },
  hardware: { name: 'Chips & Inference', enabled: true, priority: 1 },
  policy: { name: 'AI Policy & Regulation', enabled: true, priority: 1 },
  github: { name: 'GitHub Trending', enabled: true, priority: 1 },
  layoffs: { name: 'Layoffs Tracker', enabled: true, priority: 1 },
  polymarket: { name: 'AI Predictions', enabled: true, priority: 1 },
  'ai-analyst': { name: 'AI analyst', enabled: true, priority: 2 },
  cloud: { name: 'Cloud & Infrastructure', enabled: true, priority: 2 },
  dev: { name: 'Developer Community', enabled: true, priority: 2 },
  security: { name: 'Cybersecurity', enabled: true, priority: 2 },
  startups: { name: 'AI Startups & VC', enabled: true, priority: 2 },
  funding: { name: 'Funding & VC', enabled: true, priority: 2 },
  markets: { name: 'Tech Stocks', enabled: true, priority: 2 },
  'tech-readiness': { name: 'Tech Readiness Index', enabled: true, priority: 2 },
  events: { name: 'Tech Events', enabled: true, priority: 2 },
  sentiment: { name: 'News Sentiment', enabled: true, priority: 2 },
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
  weather: true,
  economic: true,
  waterways: false,
  outages: true,
  cyberThreats: false,
  datacenters: true,
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
  // AI infrastructure story: datacenters + cloud regions on
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
  weather: false,
  economic: false,
  cloudRegions: false,
};

export const VARIANT_CONFIG: VariantConfig = {
  name: 'ai',
  description: 'AI, ML & compute infrastructure intelligence dashboard',
  panels: DEFAULT_PANELS,
  mapLayers: DEFAULT_MAP_LAYERS,
  mobileMapLayers: MOBILE_DEFAULT_MAP_LAYERS,
};
