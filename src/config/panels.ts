import type { PanelConfig, MapLayers } from '@/types';
import { SITE_VARIANT } from './variant';

// ============================================
// FULL VARIANT (Geopolitical)
// ============================================
// Panel order matters! First panels appear at top of grid.
// Hanzo default (matches the at-a-glance dashboard): map, live-news, then the
// macro/materials/world-news left column + AI insights/posture/predictions/
// instability right column. live-webcams OFF by default (dead "not available"
// clutter); enable it from the Panels menu if wanted.
const FULL_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Global Map', enabled: true, priority: 1 },
  'live-news': { name: 'Live News', enabled: true, priority: 1 },
  'ai-analyst': { name: 'AI analyst', enabled: true, priority: 2 },
  economic: { name: 'Macro Stress', enabled: true, priority: 1 },
  commodities: { name: 'Commodities & futures', enabled: true, priority: 1 },
  fx: { name: 'FX & currencies', enabled: true, priority: 2 },
  yields: { name: 'Rates & credit', enabled: true, priority: 2 },
  politics: { name: 'World News', enabled: true, priority: 1 },
  insights: { name: 'AI Insights', enabled: true, priority: 1 },
  'strategic-posture': { name: 'AI Strategic Posture', enabled: true, priority: 1 },
  polymarket: { name: 'Predictions', enabled: true, priority: 1 },
  cii: { name: 'Country Instability', enabled: true, priority: 1 },
  'strategic-risk': { name: 'Strategic Risk Overview', enabled: true, priority: 1 },
  intel: { name: 'Intel Feed', enabled: true, priority: 1 },
  'gdelt-intel': { name: 'Live Intelligence', enabled: true, priority: 1 },
  cascade: { name: 'Infrastructure Cascade', enabled: true, priority: 1 },
  middleeast: { name: 'Middle East', enabled: true, priority: 1 },
  africa: { name: 'Africa', enabled: true, priority: 1 },
  latam: { name: 'Latin America', enabled: true, priority: 1 },
  asia: { name: 'Asia-Pacific', enabled: true, priority: 1 },
  energy: { name: 'Energy & Resources', enabled: true, priority: 1 },
  gov: { name: 'Government', enabled: true, priority: 1 },
  thinktanks: { name: 'Think Tanks', enabled: true, priority: 1 },
  markets: { name: 'Markets', enabled: true, priority: 1 },
  finance: { name: 'Financial', enabled: true, priority: 1 },
  'live-webcams': { name: 'Live Webcams', enabled: false, priority: 2 },
  tech: { name: 'Technology', enabled: true, priority: 2 },
  crypto: { name: 'Crypto', enabled: true, priority: 2 },
  heatmap: { name: 'Sector Heatmap', enabled: true, priority: 2 },
  ai: { name: 'AI/ML', enabled: true, priority: 2 },
  layoffs: { name: 'Layoffs Tracker', enabled: true, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
  'satellite-fires': { name: 'Fires', enabled: true, priority: 2 },
  sentiment: { name: 'News Sentiment', enabled: true, priority: 2 },
  'trader-desk': { name: 'Trader Desk', enabled: true, priority: 2 },
  'macro-signals': { name: 'Market Radar', enabled: true, priority: 2 },
  'etf-flows': { name: 'BTC ETF Tracker', enabled: true, priority: 2 },
  stablecoins: { name: 'Stablecoins', enabled: true, priority: 2 },
  'ucdp-events': { name: 'UCDP Conflict Events', enabled: true, priority: 2 },
  displacement: { name: 'UNHCR Displacement', enabled: true, priority: 2 },
  climate: { name: 'Climate Anomalies', enabled: true, priority: 2 },
  'population-exposure': { name: 'Population Exposure', enabled: true, priority: 2 },
  // Hanzo World Model domain lenses — realtime feeds for app-builders on hanzo.ai.
  robotics: { name: 'Robotics', enabled: true, priority: 2 },
  quantum: { name: 'Quantum Computing', enabled: true, priority: 2 },
  'post-quantum': { name: 'Post-Quantum Readiness', enabled: true, priority: 2 },
  weather: { name: 'Severe Weather', enabled: true, priority: 2 },
  sports: { name: 'Sports & Events', enabled: true, priority: 2 },
  'space-weather': { name: 'Space Weather', enabled: true, priority: 2 },
};

const FULL_MAP_LAYERS: MapLayers = {
  conflicts: true,
  bases: true,
  cables: false,
  pipelines: false,
  hotspots: true,
  ais: false,
  nuclear: true,
  irradiators: false,
  sanctions: true,
  weather: true,
  economic: true,
  waterways: true,
  outages: true,
  cyberThreats: false,
  datacenters: false,
  protests: false,
  flights: false,
  military: true,
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  // Hanzo World Model domain layers
  robotics: false,
  quantum: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (disabled in full variant)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (disabled in full variant)
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
};

const FULL_MOBILE_MAP_LAYERS: MapLayers = {
  conflicts: true,
  bases: false,
  cables: false,
  pipelines: false,
  hotspots: true,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: true,
  weather: true,
  economic: false,
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
  // Hanzo World Model domain layers
  robotics: false,
  quantum: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (disabled in full variant)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (disabled in full variant)
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
};

// ============================================
// TECH VARIANT (Tech/AI/Startups)
// ============================================
const TECH_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Global Tech Map', enabled: true, priority: 1 },
  'live-news': { name: 'Tech Headlines', enabled: true, priority: 1 },
  'ai-analyst': { name: 'AI analyst', enabled: true, priority: 2 },
  'live-webcams': { name: 'Live Webcams', enabled: true, priority: 2 },
  insights: { name: 'AI Insights', enabled: true, priority: 1 },
  ai: { name: 'AI/ML News', enabled: true, priority: 1 },
  tech: { name: 'Technology', enabled: true, priority: 1 },
  startups: { name: 'Startups & VC', enabled: true, priority: 1 },
  vcblogs: { name: 'VC Insights & Essays', enabled: true, priority: 1 },
  regionalStartups: { name: 'Global Startup News', enabled: true, priority: 1 },
  unicorns: { name: 'Unicorn Tracker', enabled: true, priority: 1 },
  accelerators: { name: 'Accelerators & Demo Days', enabled: true, priority: 1 },
  security: { name: 'Cybersecurity', enabled: true, priority: 1 },
  policy: { name: 'AI Policy & Regulation', enabled: true, priority: 1 },
  regulation: { name: 'AI Regulation Dashboard', enabled: true, priority: 1 },
  layoffs: { name: 'Layoffs Tracker', enabled: true, priority: 1 },
  markets: { name: 'Tech Stocks', enabled: true, priority: 2 },
  finance: { name: 'Financial News', enabled: true, priority: 2 },
  crypto: { name: 'Crypto', enabled: true, priority: 2 },
  hardware: { name: 'Semiconductors & Hardware', enabled: true, priority: 2 },
  cloud: { name: 'Cloud & Infrastructure', enabled: true, priority: 2 },
  dev: { name: 'Developer Community', enabled: true, priority: 2 },
  github: { name: 'GitHub Trending', enabled: true, priority: 1 },
  ipo: { name: 'IPO & SPAC', enabled: true, priority: 2 },
  polymarket: { name: 'Tech Predictions', enabled: true, priority: 2 },
  funding: { name: 'Funding & VC', enabled: true, priority: 1 },
  producthunt: { name: 'Product Hunt', enabled: true, priority: 1 },
  events: { name: 'Tech Events', enabled: true, priority: 1 },
  'service-status': { name: 'Service Status', enabled: true, priority: 2 },
  economic: { name: 'Economic Indicators', enabled: true, priority: 2 },
  'tech-readiness': { name: 'Tech Readiness Index', enabled: true, priority: 1 },
  sentiment: { name: 'News Sentiment', enabled: true, priority: 2 },
  'trader-desk': { name: 'Trader Desk', enabled: true, priority: 2 },
  'macro-signals': { name: 'Market Radar', enabled: true, priority: 2 },
  'etf-flows': { name: 'BTC ETF Tracker', enabled: true, priority: 2 },
  stablecoins: { name: 'Stablecoins', enabled: true, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

const TECH_MAP_LAYERS: MapLayers = {
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
  // Hanzo World Model domain layers
  robotics: false,
  quantum: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (enabled in tech variant)
  startupHubs: true,
  cloudRegions: true,
  accelerators: false,
  techHQs: true,
  techEvents: true,
  // Finance layers (disabled in tech variant)
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
};

const TECH_MOBILE_MAP_LAYERS: MapLayers = {
  conflicts: false,
  bases: false,
  cables: false,
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
  natural: true,
  spaceports: false,
  minerals: false,
  fires: false,
  // Hanzo World Model domain layers
  robotics: false,
  quantum: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (limited on mobile)
  startupHubs: true,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: true,
  // Finance layers (disabled in tech variant)
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
};

// ============================================
// FINANCE VARIANT (Markets/Trading)
// ============================================
const FINANCE_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Global Markets Map', enabled: true, priority: 1 },
  'live-news': { name: 'Market Headlines', enabled: true, priority: 1 },
  'ai-analyst': { name: 'AI analyst', enabled: true, priority: 2 },
  'live-webcams': { name: 'Live Webcams', enabled: true, priority: 2 },
  insights: { name: 'AI Market Insights', enabled: true, priority: 1 },
  markets: { name: 'Live Markets', enabled: true, priority: 1 },
  'markets-news': { name: 'Markets News', enabled: true, priority: 2 },
  forex: { name: 'Forex & Currencies', enabled: true, priority: 1 },
  bonds: { name: 'Fixed Income', enabled: true, priority: 1 },
  commodities: { name: 'Commodities & Futures', enabled: true, priority: 1 },
  fx: { name: 'FX & currencies', enabled: true, priority: 1 },
  yields: { name: 'Rates & credit', enabled: true, priority: 1 },
  'commodities-news': { name: 'Commodities News', enabled: true, priority: 2 },
  crypto: { name: 'Crypto & Digital Assets', enabled: true, priority: 1 },
  'crypto-news': { name: 'Crypto News', enabled: true, priority: 2 },
  centralbanks: { name: 'Central Bank Watch', enabled: true, priority: 1 },
  economic: { name: 'Economic Data', enabled: true, priority: 1 },
  'economic-news': { name: 'Economic News', enabled: true, priority: 2 },
  ipo: { name: 'IPOs, Earnings & M&A', enabled: true, priority: 1 },
  heatmap: { name: 'Sector Heatmap', enabled: true, priority: 1 },
  'trader-desk': { name: 'Trader Desk', enabled: true, priority: 1 },
  sentiment: { name: 'News Sentiment', enabled: true, priority: 1 },
  'macro-signals': { name: 'Market Radar', enabled: true, priority: 1 },
  derivatives: { name: 'Derivatives & Options', enabled: true, priority: 2 },
  fintech: { name: 'Fintech & Trading Tech', enabled: true, priority: 2 },
  regulation: { name: 'Financial Regulation', enabled: true, priority: 2 },
  institutional: { name: 'Hedge Funds & PE', enabled: true, priority: 2 },
  analysis: { name: 'Market Analysis', enabled: true, priority: 2 },
  'etf-flows': { name: 'BTC ETF Tracker', enabled: true, priority: 2 },
  stablecoins: { name: 'Stablecoins', enabled: true, priority: 2 },
  'gcc-investments': { name: 'GCC Investments', enabled: true, priority: 2 },
  gccNews: { name: 'GCC Business News', enabled: true, priority: 2 },
  polymarket: { name: 'Predictions', enabled: true, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

const FINANCE_MAP_LAYERS: MapLayers = {
  conflicts: false,
  bases: false,
  cables: true,
  pipelines: true,
  hotspots: false,
  ais: false,
  nuclear: false,
  irradiators: false,
  sanctions: true,
  weather: true,
  economic: true,
  waterways: true,
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
  // Hanzo World Model domain layers
  robotics: false,
  quantum: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (disabled in finance variant)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (enabled in finance variant)
  stockExchanges: true,
  financialCenters: true,
  centralBanks: true,
  commodityHubs: false,
  gulfInvestments: false,
};

const FINANCE_MOBILE_MAP_LAYERS: MapLayers = {
  conflicts: false,
  bases: false,
  cables: false,
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
  // Hanzo World Model domain layers
  robotics: false,
  quantum: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers (disabled)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (limited on mobile)
  stockExchanges: true,
  financialCenters: false,
  centralBanks: true,
  commodityHubs: false,
  gulfInvestments: false,
};

// ============================================
// SAAS VARIANT (Hanzo Cloud metrics/usage)
// ============================================
// Renders HANZO CLOUD ITSELF, not world intel: dense stat tiles for platform
// requests/models/nodes/regions (signed-out investor view via the demo-flagged
// public aggregate) plus the caller's own org usage + bill drill-down (signed
// in). Map reuses the existing datacenters + cloudRegions layers as the global
// infrastructure backdrop.
const SAAS_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Cloud Infrastructure', enabled: true, priority: 1 },
  'live-news': { name: 'Live News', enabled: true, priority: 1 },
  'cloud-overview': { name: 'Cloud Overview', enabled: true, priority: 1 },
  chains: { name: 'Chains', enabled: true, priority: 1 },
  'model-usage': { name: 'Model Usage', enabled: true, priority: 1 },
  fleet: { name: 'Fleet & GPUs', enabled: true, priority: 1 },
  'live-activity': { name: 'Live Activity', enabled: true, priority: 1 },
  'my-usage': { name: 'My Usage & Bill', enabled: true, priority: 1 },
  'hanzo-status': { name: 'Hanzo Status', enabled: true, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

const SAAS_MAP_LAYERS: MapLayers = {
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
  // Hanzo World Model domain layers
  robotics: false,
  quantum: false,
  // Data source layers
  ucdpEvents: false,
  displacement: false,
  climate: false,
  // Tech layers — cloudRegions on (global infra backdrop)
  startupHubs: false,
  cloudRegions: true,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (disabled)
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
  // Hanzo World cloud map layers
  chainNodes: true,
  byoGpu: true,
  trafficArcs: true,
};

const SAAS_MOBILE_MAP_LAYERS: MapLayers = {
  ...SAAS_MAP_LAYERS,
  cables: false,
  cloudRegions: false,
};

// ============================================
// AI VARIANT (AI/ML industry, research & infrastructure)
// ============================================
// Composition of existing panels: AI/ML news + AI Insights up top, the tech feed
// set (ai/tech/policy/hardware/cloud/dev/security/github/layoffs) reused for the
// body, prediction markets, and a datacenter/cloud-region map. Feeds resolve to
// TECH_FEEDS (see feeds.ts). The `ai` news panel already carries ArXiv AI/ML +
// MIT Research, so research surfaces without a bespoke panel.
const AI_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Global AI Map', enabled: true, priority: 1 },
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

const AI_MAP_LAYERS: MapLayers = {
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
  // Tech layers — AI infrastructure story: datacenters + cloud regions on
  startupHubs: false,
  cloudRegions: true,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers (disabled in AI variant)
  stockExchanges: false,
  financialCenters: false,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
};

const AI_MOBILE_MAP_LAYERS: MapLayers = {
  ...AI_MAP_LAYERS,
  cables: false,
  weather: false,
  economic: false,
  cloudRegions: false,
};

// ============================================
// CRYPTO VARIANT (Digital assets & markets)
// ============================================
// Composition of existing panels: CoinGecko prices + crypto news up top, the
// trader desk (BTC dominance / funding), ETF flows, stablecoins, market radar,
// sector heatmap, sentiment and predictions. Feeds resolve to FINANCE_FEEDS (see
// feeds.ts) — the `crypto`/`markets`/`economic` data panels each also spawn a
// `-news` feed panel via the FEEDS loop in App.ts.
const CRYPTO_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Global Crypto Map', enabled: true, priority: 1 },
  'live-news': { name: 'Crypto & Markets Headlines', enabled: true, priority: 1 },
  insights: { name: 'AI Market Insights', enabled: true, priority: 1 },
  crypto: { name: 'Crypto & Digital Assets', enabled: true, priority: 1 },
  chains: { name: 'Chains', enabled: true, priority: 1 },
  'crypto-news': { name: 'Crypto News', enabled: true, priority: 1 },
  'trader-desk': { name: 'Trader Desk', enabled: true, priority: 1 },
  'etf-flows': { name: 'BTC ETF Tracker', enabled: true, priority: 1 },
  stablecoins: { name: 'Stablecoins', enabled: true, priority: 1 },
  'macro-signals': { name: 'Market Radar', enabled: true, priority: 1 },
  heatmap: { name: 'Sector Heatmap', enabled: true, priority: 1 },
  polymarket: { name: 'Predictions', enabled: true, priority: 1 },
  sentiment: { name: 'News Sentiment', enabled: true, priority: 1 },
  markets: { name: 'Live Markets', enabled: true, priority: 2 },
  fx: { name: 'FX & dollar', enabled: true, priority: 2 },
  yields: { name: 'Rates & credit', enabled: true, priority: 2 },
  'economic-news': { name: 'Economic News', enabled: true, priority: 2 },
  regulation: { name: 'Crypto & Financial Regulation', enabled: true, priority: 2 },
  centralbanks: { name: 'Central Bank Watch', enabled: true, priority: 2 },
  'ai-analyst': { name: 'AI analyst', enabled: true, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

const CRYPTO_MAP_LAYERS: MapLayers = {
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
  // Tech layers (disabled in crypto variant)
  startupHubs: false,
  cloudRegions: false,
  accelerators: false,
  techHQs: false,
  techEvents: false,
  // Finance layers — economic + financial centers as the market backdrop
  stockExchanges: false,
  financialCenters: true,
  centralBanks: false,
  commodityHubs: false,
  gulfInvestments: false,
  // Hanzo World cloud map layers
  chainNodes: true,
  byoGpu: true,
  trafficArcs: true,
};

const CRYPTO_MOBILE_MAP_LAYERS: MapLayers = {
  ...CRYPTO_MAP_LAYERS,
  cables: false,
  financialCenters: false,
};

// ============================================
// VARIANT-AWARE EXPORTS
// ============================================
export const DEFAULT_PANELS = SITE_VARIANT === 'tech' ? TECH_PANELS : SITE_VARIANT === 'finance' ? FINANCE_PANELS : SITE_VARIANT === 'saas' ? SAAS_PANELS : SITE_VARIANT === 'ai' ? AI_PANELS : SITE_VARIANT === 'crypto' ? CRYPTO_PANELS : FULL_PANELS;
export const DEFAULT_MAP_LAYERS = SITE_VARIANT === 'tech' ? TECH_MAP_LAYERS : SITE_VARIANT === 'finance' ? FINANCE_MAP_LAYERS : SITE_VARIANT === 'saas' ? SAAS_MAP_LAYERS : SITE_VARIANT === 'ai' ? AI_MAP_LAYERS : SITE_VARIANT === 'crypto' ? CRYPTO_MAP_LAYERS : FULL_MAP_LAYERS;
export const MOBILE_DEFAULT_MAP_LAYERS = SITE_VARIANT === 'tech' ? TECH_MOBILE_MAP_LAYERS : SITE_VARIANT === 'finance' ? FINANCE_MOBILE_MAP_LAYERS : SITE_VARIANT === 'saas' ? SAAS_MOBILE_MAP_LAYERS : SITE_VARIANT === 'ai' ? AI_MOBILE_MAP_LAYERS : SITE_VARIANT === 'crypto' ? CRYPTO_MOBILE_MAP_LAYERS : FULL_MOBILE_MAP_LAYERS;

// Monitor palette — fixed category colors persisted to localStorage (not theme-dependent)
export const MONITOR_COLORS = [
  '#44ff88',
  '#ff8844',
  '#4488ff',
  '#ff44ff',
  '#ffff44',
  '#ff4444',
  '#44ffff',
  '#88ff44',
  '#ff88ff',
  '#88ffff',
];

export const STORAGE_KEYS = {
  panels: 'worldmonitor-panels',
  monitors: 'worldmonitor-monitors',
  mapLayers: 'worldmonitor-layers',
  disabledFeeds: 'worldmonitor-disabled-feeds',
} as const;
