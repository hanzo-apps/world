import { useMemo } from 'react';
import { YStack } from '@hanzo/gui';
import { variantConfig } from '@/config/panels';
import { PanelGrid, type PanelGridItem } from './PanelGrid';
import { MarketsPanel } from './MarketsPanel';
import { AiComputePanel } from './AiComputePanel';
import { CloudOverviewPanel } from './CloudOverviewPanel';
import { CommoditiesPanel } from './CommoditiesPanel';
import { EnsoTrainingPanel } from './EnsoTrainingPanel';
import { FxPanel } from './FxPanel';
import { InsightsPanel } from './InsightsPanel';
import { LiveActivityPanel } from './LiveActivityPanel';
import { LlmUsagePanel } from './LlmUsagePanel';
import { MacroSignalsPanel } from './MacroSignalsPanel';
import { ModelImprovementPanel } from './ModelImprovementPanel';
import { OrgAnalyticsPanel } from './OrgAnalyticsPanel';
import { SentimentPanel } from './SentimentPanel';
import { TraderDeskPanel } from './TraderDeskPanel';
import { YieldsPanel } from './YieldsPanel';
import { DisplacementPanel } from './DisplacementPanel';
import { UcdpEventsPanel } from './UcdpEventsPanel';
import { TechEventsPanel } from './TechEventsPanel';
import { AnalyticsPanel } from './AnalyticsPanel';
import { BlockchainPanel } from './BlockchainPanel';
import { CloudServicesPanel } from './CloudServicesPanel';
import { ClusterPanel } from './ClusterPanel';
import { EnsoBenchmarkPanel } from './EnsoBenchmarkPanel';
import { EnsoFlywheelPanel } from './EnsoFlywheelPanel';
import { EnsoRouterPanel } from './EnsoRouterPanel';
import { ETFFlowsPanel } from './ETFFlowsPanel';
import { FleetPanel } from './FleetPanel';
import { HanzoStatusPanel } from './HanzoStatusPanel';
import { LuxBookPanel } from './LuxBookPanel';
import { ModelUsagePanel } from './ModelUsagePanel';
import { MyUsagePanel } from './MyUsagePanel';
import { QueuePanel } from './QueuePanel';
import { RotationScannerPanel } from './RotationScannerPanel';
import { StablecoinPanel } from './StablecoinPanel';
import { ServiceStatusPanel } from './ServiceStatusPanel';
import { TechReadinessPanel } from './TechReadinessPanel';
import { TrafficGlobePanel } from './TrafficGlobePanel';
import { TradingBubblePanel } from './TradingBubblePanel';
import { StrategicPosturePanel } from './StrategicPosturePanel';
import { CIIPanel } from './CIIPanel';
import { GdeltIntelPanel } from './GdeltIntelPanel';
import { CountryIntelPanel } from './CountryIntelPanel';
import { AiAnalystPanel } from './AiAnalystPanel';
import { BriefPanel } from './BriefPanel';
import { CascadePanel } from './CascadePanel';
import { ClimateAnomalyPanel } from './ClimateAnomalyPanel';
import { EconomicPanel } from './EconomicPanel';
import { InvestmentsPanel } from './InvestmentsPanel';
import { LiveNewsPanel } from './LiveNewsPanel';
import { MonitorPanel } from './MonitorPanel';
import { NewsPanel } from './NewsPanel';
import { PopulationExposurePanel } from './PopulationExposurePanel';
import { PredictionPanel } from './PredictionPanel';
import { SatelliteFiresPanel } from './SatelliteFiresPanel';
import { StationsWallPanel } from './StationsWallPanel';
import { StatusPanel } from './StatusPanel';
import { StrategicRiskPanel } from './StrategicRiskPanel';
import { WatchQueuePanel } from './WatchQueuePanel';

// ── variant → visible panels ────────────────────────────────────────────────
// The rail shows only the panels the selected variant defines — the SAME per-variant
// panel set the vanilla surface renders. The canonical source is
// `variantConfig(variant).DEFAULT_PANELS` (src/config/panels.ts): each variant's own
// record of `id → { enabled, priority }`. A handful of React panel ids skew from the
// vanilla config keys; the maps below are the ONE place they line up.

// React panel id → vanilla config key. Identity for every id not listed; only
// `tech-events` skews (the vanilla panel key is `events`, enabled in tech + ai).
const PANEL_KEY_ALIAS: Record<string, string> = {
  'tech-events': 'events',
};

// Panels the vanilla App mounts for a variant OUTSIDE its DEFAULT_PANELS config:
// the admin-only Cloud console tiles (App.ts `mountAdminCloudPanels`, cloud only).
// They carry no config key, so their variant gating lives here.
const VARIANT_EXTRA_PANELS: Record<string, readonly string[]> = {
  cloud: ['cloud-services', 'cloud-clusters', 'cloud-queue', 'llm-usage', 'cloud-analytics', 'enso-benchmarks'],
};

// Not variant-scoped — mounted on every globe rail:
//   • country-intel — the country drill-down companion (its controller wires to the
//     globe on mount; the panel is its surface on every view).
//   • status — the global System Status widget (Data Feeds · API Status · Storage);
//     the vanilla StatusPanel is a universal widget carried across every grid view.
const ALWAYS_VISIBLE_PANELS: readonly string[] = ['country-intel', 'status'];

function isPanelVisible(id: string, variant: string, enabledKeys: Set<string>): boolean {
  if (ALWAYS_VISIBLE_PANELS.includes(id)) return true;
  if (VARIANT_EXTRA_PANELS[variant]?.includes(id)) return true;
  return enabledKeys.has(PANEL_KEY_ALIAS[id] ?? id);
}

/**
 * PanelRail — the floating panel rail for the globe stage, extracted from App so the
 * whole panel surface (the full panel catalog + the drag/reorder grid) forms ONE
 * async chunk that is dynamic-imported (see `lazy.tsx` → `PanelRailLazy`).
 *
 * Why this is its own module, not inline in App:
 *   • Entry weight — statically importing every panel into App pulled them all into
 *     the single entry chunk (the ~402 kB-gz regression). Hoisting them behind one
 *     dynamic import keeps them out of the entry parse.
 *   • By variant, for free — App renders the finance variant as the full-viewport
 *     FinanceTerminal and never mounts this rail there, so the finance surface never
 *     even fetches the panel chunk. The globe variants load it once, after first
 *     paint, behind a Suspense boundary.
 *
 * The panel catalog is the ONE source of rail contents: each item renders its panel
 * through the shared Panel chassis + PanelGrid slot. `visiblePanels` then filters the
 * catalog to the selected variant's enabled set (the variant filter that keeps the
 * rail from rendering all panels on every view). `onVariantChange` is threaded to the
 * AI analyst panel so the agent's `set_variant` routes through App's one-switch path.
 * Style props stay LONGHAND-only per the @hanzo/gui typecheck contract.
 */
export function PanelRail({
  variant,
  onVariantChange,
}: {
  variant: string;
  onVariantChange: (id: string) => void;
}): React.JSX.Element {
  const panels = useMemo<PanelGridItem[]>(
    () => [
      { id: 'markets', render: (slot) => <MarketsPanel slot={slot} /> },
      { id: 'ai-analyst', render: (slot) => <AiAnalystPanel slot={slot} onVariantChange={onVariantChange} /> },
      { id: 'ai-compute', render: (slot) => <AiComputePanel slot={slot} /> },
      { id: 'cloud-overview', render: (slot) => <CloudOverviewPanel slot={slot} /> },
      { id: 'commodities', render: (slot) => <CommoditiesPanel slot={slot} /> },
      { id: 'economic', render: (slot) => <EconomicPanel slot={slot} /> },
      { id: 'enso-training', render: (slot) => <EnsoTrainingPanel slot={slot} /> },
      { id: 'fx', render: (slot) => <FxPanel slot={slot} /> },
      { id: 'insights', render: (slot) => <BriefPanel slot={slot} /> },
      { id: 'org-insights', render: (slot) => <InsightsPanel slot={slot} /> },
      { id: 'live-activity', render: (slot) => <LiveActivityPanel slot={slot} /> },
      { id: 'live-news', render: (slot) => <LiveNewsPanel slot={slot} /> },
      { id: 'llm-usage', render: (slot) => <LlmUsagePanel slot={slot} /> },
      { id: 'macro-signals', render: (slot) => <MacroSignalsPanel slot={slot} /> },
      { id: 'model-improvement', render: (slot) => <ModelImprovementPanel slot={slot} /> },
      { id: 'monitors', render: (slot) => <MonitorPanel slot={slot} /> },
      { id: 'org-analytics', render: (slot) => <OrgAnalyticsPanel slot={slot} /> },
      { id: 'politics', render: (slot) => <NewsPanel slot={slot} /> },
      { id: 'polymarket', render: (slot) => <PredictionPanel slot={slot} /> },
      { id: 'sentiment', render: (slot) => <SentimentPanel slot={slot} /> },
      { id: 'trader-desk', render: (slot) => <TraderDeskPanel slot={slot} /> },
      { id: 'yields', render: (slot) => <YieldsPanel slot={slot} /> },
      { id: 'displacement', render: (slot) => <DisplacementPanel slot={slot} /> },
      { id: 'ucdp-events', render: (slot) => <UcdpEventsPanel slot={slot} /> },
      { id: 'population-exposure', render: (slot) => <PopulationExposurePanel slot={slot} /> },
      { id: 'climate', render: (slot) => <ClimateAnomalyPanel slot={slot} /> },
      { id: 'satellite-fires', render: (slot) => <SatelliteFiresPanel slot={slot} /> },
      { id: 'cascade', render: (slot) => <CascadePanel slot={slot} /> },
      { id: 'strategic-risk', render: (slot) => <StrategicRiskPanel slot={slot} /> },
      { id: 'tech-events', render: (slot) => <TechEventsPanel slot={slot} /> },
      { id: 'cloud-analytics', render: (slot) => <AnalyticsPanel slot={slot} /> },
      { id: 'chains', render: (slot) => <BlockchainPanel slot={slot} /> },
      { id: 'cloud-services', render: (slot) => <CloudServicesPanel slot={slot} /> },
      { id: 'cloud-clusters', render: (slot) => <ClusterPanel slot={slot} /> },
      { id: 'enso-benchmarks', render: (slot) => <EnsoBenchmarkPanel slot={slot} /> },
      { id: 'enso-flywheel', render: (slot) => <EnsoFlywheelPanel slot={slot} /> },
      { id: 'enso-router', render: (slot) => <EnsoRouterPanel slot={slot} /> },
      { id: 'etf-flows', render: (slot) => <ETFFlowsPanel slot={slot} /> },
      { id: 'fleet', render: (slot) => <FleetPanel slot={slot} /> },
      { id: 'gcc-investments', render: (slot) => <InvestmentsPanel slot={slot} /> },
      { id: 'hanzo-status', render: (slot) => <HanzoStatusPanel slot={slot} /> },
      { id: 'lux-book', render: (slot) => <LuxBookPanel slot={slot} /> },
      { id: 'model-usage', render: (slot) => <ModelUsagePanel slot={slot} /> },
      { id: 'my-usage', render: (slot) => <MyUsagePanel slot={slot} /> },
      { id: 'cloud-queue', render: (slot) => <QueuePanel slot={slot} /> },
      { id: 'rotation', render: (slot) => <RotationScannerPanel slot={slot} /> },
      { id: 'stablecoins', render: (slot) => <StablecoinPanel slot={slot} /> },
      { id: 'service-status', render: (slot) => <ServiceStatusPanel slot={slot} /> },
      { id: 'status', render: (slot) => <StatusPanel slot={slot} /> },
      { id: 'stations-wall', render: (slot) => <StationsWallPanel slot={slot} /> },
      { id: 'tech-readiness', render: (slot) => <TechReadinessPanel slot={slot} /> },
      { id: 'traffic-globe', render: (slot) => <TrafficGlobePanel slot={slot} /> },
      { id: 'trading-bubble', render: (slot) => <TradingBubblePanel slot={slot} /> },
      { id: 'strategic-posture', render: (slot) => <StrategicPosturePanel slot={slot} /> },
      { id: 'watch', render: (slot) => <WatchQueuePanel slot={slot} /> },
      { id: 'cii', render: (slot) => <CIIPanel slot={slot} /> },
      { id: 'gdelt-intel', render: (slot) => <GdeltIntelPanel slot={slot} /> },
      { id: 'country-intel', render: (slot) => <CountryIntelPanel slot={slot} /> },
    ],
    [onVariantChange],
  );

  // Only the selected variant's panels reach the rail. Recomputed on every variant
  // switch (the dep list carries `variant`): the enabled keys of
  // `variantConfig(variant).DEFAULT_PANELS`, plus the two skew maps (aliases +
  // variant-scoped extras + always-visible companions).
  const visiblePanels = useMemo<PanelGridItem[]>(() => {
    const cfg = variantConfig(variant).DEFAULT_PANELS;
    const enabledKeys = new Set(
      Object.entries(cfg)
        .filter(([, c]) => c.enabled !== false)
        .map(([k]) => k),
    );
    return panels.filter((p) => isPanelVisible(p.id, variant, enabledKeys));
  }, [panels, variant]);

  // The rail is its own scroll region: the stage clips (overflow:hidden) so without
  // this the panel column overflows and most panels are unreachable. maxHeight is
  // stage-relative (100% of the padding box, less the 12px top + 12px bottom inset)
  // so it self-adjusts under the header + variant tabs without a magic pixel constant.
  return (
    <YStack
      position="absolute"
      top="$3"
      right="$3"
      zIndex={20}
      style={{ overflowY: 'auto', maxHeight: 'calc(100% - 24px)' }}
    >
      <PanelGrid items={visiblePanels} />
    </YStack>
  );
}

export default PanelRail;
