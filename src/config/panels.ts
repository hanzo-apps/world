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
  // Hanzo platform telemetry — visible on the DEFAULT world, not just ?variant=ai:
  // live AI compute/usage (SSE) + the enso router training flywheel.
  'ai-compute': { name: 'AI Compute', enabled: true, priority: 1 },
  'enso-flywheel': { name: 'Enso Flywheel', enabled: true, priority: 1 },
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
  'trading-bubble': { name: 'Markets Bubble', enabled: false, priority: 2 },
  finance: { name: 'Financial', enabled: true, priority: 1 },
  'live-webcams': { name: 'Live Webcams', enabled: false, priority: 2 },
  // Every live news channel at once; hover a tile for audio focus. Opt-in (N video
  // decodes) — toggle from the Panels menu, like Live Webcams.
  'stations-wall': { name: 'News Wall', enabled: false, priority: 2 },
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
  rotation: { name: 'Rotation Scanner', enabled: true, priority: 1 },
  'etf-flows': { name: 'BTC ETF Tracker', enabled: true, priority: 2 },
  stablecoins: { name: 'Stablecoins', enabled: true, priority: 2 },
  'ucdp-events': { name: 'UCDP Conflict Events', enabled: true, priority: 2 },
  displacement: { name: 'UNHCR Displacement', enabled: true, priority: 2 },
  climate: { name: 'Climate Anomalies', enabled: true, priority: 2 },
  'population-exposure': { name: 'Population Exposure', enabled: true, priority: 2 },
};

const FULL_MAP_LAYERS: MapLayers = {
  conflicts: true,
  bases: true,
  cables: false,
  pipelines: false,
  flows: false,  hotspots: true,
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
  flows: false,  hotspots: true,
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
  'stations-wall': { name: 'News Wall', enabled: false, priority: 2 },
  'trading-bubble': { name: 'Markets Bubble', enabled: false, priority: 2 },
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
  rotation: { name: 'Rotation Scanner', enabled: true, priority: 1 },
  'etf-flows': { name: 'BTC ETF Tracker', enabled: true, priority: 2 },
  stablecoins: { name: 'Stablecoins', enabled: true, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

const TECH_MAP_LAYERS: MapLayers = {
  conflicts: false,
  bases: false,
  cables: true,
  pipelines: false,
  flows: false,  hotspots: false,
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
  flows: false,  hotspots: false,
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
  'trading-bubble': { name: 'Markets Bubble', enabled: true, priority: 2 },
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
  rotation: { name: 'Rotation Scanner', enabled: true, priority: 1 },
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
  flows: false,  hotspots: false,
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
  flows: false,  hotspots: false,
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
// FUND VARIANT (lux.fund — Lux macro terminal)
// ============================================
// The Lux Fund white-label. Same World 3D-globe engine as finance, sharpened for
// the fund's macro read: the Lux Book (top-10 algo allocation) and the rotation
// scanner lead, the globe carries the fund's bets over the commodity/energy hubs
// they anchor to. Feeds reuse the finance set (markets/commodities/energy/
// centralbanks/economic/analysis/institutional).
const FUND_PANELS: Record<string, PanelConfig> = {
  'lux-book': { name: 'Lux Book · Top 10', enabled: true, priority: 1 },
  rotation: { name: 'Rotation Scanner', enabled: true, priority: 1 },
  'macro-signals': { name: 'Market Radar', enabled: true, priority: 1 },
  ...FINANCE_PANELS,
};

// Energy/commodity hubs join the finance globe — the fund's bets anchor to them.
const FUND_MAP_LAYERS: MapLayers = { ...FINANCE_MAP_LAYERS, commodityHubs: true };
const FUND_MOBILE_MAP_LAYERS: MapLayers = { ...FINANCE_MOBILE_MAP_LAYERS };

// ============================================
// CLOUD VARIANT (flagship — Hanzo Cloud + live-traffic globe)
// ============================================
// The world.hanzo.ai default. Renders HANZO ITSELF: the live-traffic globe (where
// requests hit api.hanzo.ai from) as the centerpiece, plus platform metrics —
// router/Enso training, throughput, model mix, fleet, uptime — and the caller's own
// org usage + bill when signed in. Folds the former `saas` variant (kept as an
// alias). Map reuses datacenters + cloudRegions as the global infra backdrop.
const CLOUD_PANELS: Record<string, PanelConfig> = {
  map: { name: 'Cloud Infrastructure', enabled: true, priority: 1 },
  'traffic-globe': { name: 'Live Traffic', enabled: true, priority: 1 },
  'model-improvement': { name: 'Model Improvement', enabled: true, priority: 1 },
  'cloud-overview': { name: 'Cloud Overview', enabled: true, priority: 1 },
  'enso-training': { name: 'Enso Live Training', enabled: true, priority: 1 },
  'enso-flywheel': { name: 'Enso Flywheel', enabled: true, priority: 1 },
  'enso-router': { name: 'Enso Router', enabled: true, priority: 1 },
  'ai-compute': { name: 'AI Compute', enabled: true, priority: 1 },
  chains: { name: 'Chains', enabled: true, priority: 1 },
  'model-usage': { name: 'Model Usage', enabled: true, priority: 1 },
  fleet: { name: 'Fleet & GPUs', enabled: true, priority: 1 },
  'live-activity': { name: 'Live Activity', enabled: true, priority: 1 },
  'org-analytics': { name: 'Analytics', enabled: true, priority: 1 },
  'org-insights': { name: 'Insights', enabled: true, priority: 1 },
  'my-usage': { name: 'My Usage & Bill', enabled: true, priority: 1 },
  'hanzo-status': { name: 'Hanzo Status', enabled: true, priority: 2 },
  'live-news': { name: 'Live News', enabled: true, priority: 2 },
  // News Wall (all stations at once, hover for audio) + Markets Bubble (whole market
  // universe as one D3 circle-pack) — available in every grid view, opt-in.
  'stations-wall': { name: 'News Wall', enabled: false, priority: 2 },
  'trading-bubble': { name: 'Markets Bubble', enabled: false, priority: 2 },
  monitors: { name: 'My Monitors', enabled: true, priority: 2 },
};

const CLOUD_MAP_LAYERS: MapLayers = {
  conflicts: false,
  bases: false,
  // Cables OFF: geopolitical backbone, not a Hanzo Cloud data class, and absent from
  // the Cloud legend — keep the globe to the plotted classes (traffic/nodes/GPU/
  // region/datacenter) so the legend matches exactly.
  cables: false,
  pipelines: false,
  flows: false,  hotspots: false,
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
  // Animated request-origin → serving-region arcs. REAL + honest: the /cloud/traffic
  // feed now derives arcs from the same native request-geo points as the dots (origin
  // country → nearest Hanzo region) and degrades to an EMPTY array — never demo — when
  // there's no traffic. Paired with the points layer it shows flow, not just presence.
  trafficArcs: true,
  // Native LB request-geo points — the Hanzo-mode globe centerpiece.
  traffic: true,
};

const CLOUD_MOBILE_MAP_LAYERS: MapLayers = {
  ...CLOUD_MAP_LAYERS,
  cables: false,
  cloudRegions: false,
  traffic: true,
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
  'ai-compute': { name: 'AI Compute', enabled: true, priority: 1 },
  'enso-flywheel': { name: 'Enso Flywheel', enabled: true, priority: 1 },
  'live-news': { name: 'AI & Tech Headlines', enabled: true, priority: 1 },
  'stations-wall': { name: 'News Wall', enabled: false, priority: 2 },
  'trading-bubble': { name: 'Markets Bubble', enabled: false, priority: 2 },
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
  flows: false,  hotspots: false,
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
  'stations-wall': { name: 'News Wall', enabled: false, priority: 2 },
  'trading-bubble': { name: 'Markets Bubble', enabled: false, priority: 2 },
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
  flows: false,  hotspots: false,
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
// variantConfig resolves a variant name to its full config triple (by-name, not
// load-time-fixed) so an in-place variant switch can apply the target's panels +
// map layers without a reload. The boot-time exports below are just this called
// with the load-time variant — one lookup, one source of truth.
export interface VariantPanelConfig {
  DEFAULT_PANELS: Record<string, PanelConfig>;
  DEFAULT_MAP_LAYERS: MapLayers;
  MOBILE_DEFAULT_MAP_LAYERS: MapLayers;
}

export function variantConfig(variant: string): VariantPanelConfig {
  switch (variant) {
    case 'tech':
      return { DEFAULT_PANELS: TECH_PANELS, DEFAULT_MAP_LAYERS: TECH_MAP_LAYERS, MOBILE_DEFAULT_MAP_LAYERS: TECH_MOBILE_MAP_LAYERS };
    case 'finance':
      return { DEFAULT_PANELS: FINANCE_PANELS, DEFAULT_MAP_LAYERS: FINANCE_MAP_LAYERS, MOBILE_DEFAULT_MAP_LAYERS: FINANCE_MOBILE_MAP_LAYERS };
    case 'fund':
      return { DEFAULT_PANELS: FUND_PANELS, DEFAULT_MAP_LAYERS: FUND_MAP_LAYERS, MOBILE_DEFAULT_MAP_LAYERS: FUND_MOBILE_MAP_LAYERS };
    case 'cloud':
      return { DEFAULT_PANELS: CLOUD_PANELS, DEFAULT_MAP_LAYERS: CLOUD_MAP_LAYERS, MOBILE_DEFAULT_MAP_LAYERS: CLOUD_MOBILE_MAP_LAYERS };
    case 'ai':
      return { DEFAULT_PANELS: AI_PANELS, DEFAULT_MAP_LAYERS: AI_MAP_LAYERS, MOBILE_DEFAULT_MAP_LAYERS: AI_MOBILE_MAP_LAYERS };
    case 'crypto':
      return { DEFAULT_PANELS: CRYPTO_PANELS, DEFAULT_MAP_LAYERS: CRYPTO_MAP_LAYERS, MOBILE_DEFAULT_MAP_LAYERS: CRYPTO_MOBILE_MAP_LAYERS };
    default:
      return { DEFAULT_PANELS: FULL_PANELS, DEFAULT_MAP_LAYERS: FULL_MAP_LAYERS, MOBILE_DEFAULT_MAP_LAYERS: FULL_MOBILE_MAP_LAYERS };
  }
}

export const DEFAULT_PANELS = variantConfig(SITE_VARIANT).DEFAULT_PANELS;
export const DEFAULT_MAP_LAYERS = variantConfig(SITE_VARIANT).DEFAULT_MAP_LAYERS;
export const MOBILE_DEFAULT_MAP_LAYERS = variantConfig(SITE_VARIANT).MOBILE_DEFAULT_MAP_LAYERS;

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
