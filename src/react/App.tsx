import { useMemo, useState, useCallback } from 'react';
import { YStack, XStack } from '@hanzo/gui';
import { HanzoAppHeader } from '@hanzogui/shell';
import { getSiteVariant, setSiteVariantRuntime } from '@/config/variant';
import { GlobeIsland } from './components/GlobeIsland';
import { VariantTabs } from './components/VariantTabs';
import { PanelGrid, type PanelGridItem } from './components/PanelGrid';
import { MarketsPanel } from './components/MarketsPanel';
import { AiComputePanel } from './components/AiComputePanel';
import { CloudOverviewPanel } from './components/CloudOverviewPanel';
import { CommoditiesPanel } from './components/CommoditiesPanel';
import { EnsoTrainingPanel } from './components/EnsoTrainingPanel';
import { FxPanel } from './components/FxPanel';
import { InsightsPanel } from './components/InsightsPanel';
import { LiveActivityPanel } from './components/LiveActivityPanel';
import { LlmUsagePanel } from './components/LlmUsagePanel';
import { MacroSignalsPanel } from './components/MacroSignalsPanel';
import { ModelImprovementPanel } from './components/ModelImprovementPanel';
import { OrgAnalyticsPanel } from './components/OrgAnalyticsPanel';
import { SentimentPanel } from './components/SentimentPanel';
import { TraderDeskPanel } from './components/TraderDeskPanel';
import { YieldsPanel } from './components/YieldsPanel';
import { DisplacementPanel } from './components/DisplacementPanel';
import { UcdpEventsPanel } from './components/UcdpEventsPanel';
import { TechEventsPanel } from './components/TechEventsPanel';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { BlockchainPanel } from './components/BlockchainPanel';
import { CloudServicesPanel } from './components/CloudServicesPanel';
import { ClusterPanel } from './components/ClusterPanel';
import { EnsoBenchmarkPanel } from './components/EnsoBenchmarkPanel';
import { EnsoFlywheelPanel } from './components/EnsoFlywheelPanel';
import { EnsoRouterPanel } from './components/EnsoRouterPanel';
import { ETFFlowsPanel } from './components/ETFFlowsPanel';
import { FleetPanel } from './components/FleetPanel';
import { HanzoStatusPanel } from './components/HanzoStatusPanel';
import { LuxBookPanel } from './components/LuxBookPanel';
import { ModelUsagePanel } from './components/ModelUsagePanel';
import { MyUsagePanel } from './components/MyUsagePanel';
import { QueuePanel } from './components/QueuePanel';
import { RotationScannerPanel } from './components/RotationScannerPanel';
import { StablecoinPanel } from './components/StablecoinPanel';
import { ServiceStatusPanel } from './components/ServiceStatusPanel';
import { TechReadinessPanel } from './components/TechReadinessPanel';
import { TrafficGlobePanel } from './components/TrafficGlobePanel';
import { TradingBubblePanel } from './components/TradingBubblePanel';
import { StrategicPosturePanel } from './components/StrategicPosturePanel';
import { CIIPanel } from './components/CIIPanel';
import { GdeltIntelPanel } from './components/GdeltIntelPanel';
import { AccountControl } from './components/AccountControl';
import { FinanceTerminal } from './components/FinanceTerminal';
import { AnalystDock } from './components/AnalystDock';
import { CountryIntelPanel } from './components/CountryIntelPanel';
import { useCountryIntel } from './hooks/useCountryIntel';
import { SearchProvider, useSearch } from './hooks/useSearch';
import { getGlobeInstance } from './hooks/globe-instance';

/**
 * The React + @hanzo/gui foundation for world.hanzo.ai.
 *
 * Architecture proven end-to-end here:
 *   1. Unified signed-in shell — HanzoAppHeader(productId="world") from
 *      @hanzogui/shell, themed by @hanzo/brand tokens (monochrome, accent #fff).
 *   2. The deck.gl globe as a React island (GlobeIsland) wrapping the EXISTING
 *      MapContainer — not a rewrite.
 *   3. Variant tabs + the panel framework: PanelGrid (rail layout + drag-reorder +
 *      shared `panel-order` persistence) hosting panels built on the ONE Panel
 *      chassis. MarketsPanel is the wired proof; Stage-2 ports drop into `items`.
 *
 * Style props are LONGHAND-only (see gui.config.ts) — one explicit vocabulary.
 */
export function App(): React.JSX.Element {
  // SearchProvider is the ⌘K search boundary (mounts the vanilla SearchController
  // once, owns its modal host). Placed at the top so the header's search onClick
  // can consume the hook. `getMap` is wired through the globe-instance registry
  // GlobeIsland publishes into — so search result fly-to routes to the live globe
  // (all STATIC sources work immediately; DYNAMIC sources activate when a React
  // news/markets store lands).
  return (
    <SearchProvider deps={{ getMap: getGlobeInstance }}>
      <AppShell />
    </SearchProvider>
  );
}

function AppShell(): React.JSX.Element {
  const { open, updateSearchIndex } = useSearch();
  const [variant, setVariant] = useState<string>(() => getSiteVariant());

  // App-scoped country drill-down: the vanilla CountryIntelController wires itself
  // to the globe the moment it mounts (via the globe-instance registry) and owns
  // the fullscreen brief overlay; stays live even when the companion panel hides.
  useCountryIntel();

  // One switch path: canonicalize + persist through the config layer, then reflect
  // it in React state and the shareable URL. Mirrors the vanilla in-place switch.
  const handleSelect = useCallback((id: string) => {
    const applied = setSiteVariantRuntime(id);
    if (!applied) return;
    setVariant(applied);
    const url = new URL(window.location.href);
    url.searchParams.set('variant', applied);
    window.history.replaceState(null, '', url.toString());
  }, []);

  // The rail's panels. One item today (the wired proof); the bulk Stage-2 ports
  // append here, each rendering through the same chassis + PanelGrid slot.
  const panels = useMemo<PanelGridItem[]>(
    () => [
      { id: 'markets', render: (slot) => <MarketsPanel slot={slot} /> },
      { id: 'ai-compute', render: (slot) => <AiComputePanel slot={slot} /> },
      { id: 'cloud-overview', render: (slot) => <CloudOverviewPanel slot={slot} /> },
      { id: 'commodities', render: (slot) => <CommoditiesPanel slot={slot} /> },
      { id: 'enso-training', render: (slot) => <EnsoTrainingPanel slot={slot} /> },
      { id: 'fx', render: (slot) => <FxPanel slot={slot} /> },
      { id: 'org-insights', render: (slot) => <InsightsPanel slot={slot} /> },
      { id: 'live-activity', render: (slot) => <LiveActivityPanel slot={slot} /> },
      { id: 'llm-usage', render: (slot) => <LlmUsagePanel slot={slot} /> },
      { id: 'macro-signals', render: (slot) => <MacroSignalsPanel slot={slot} /> },
      { id: 'model-improvement', render: (slot) => <ModelImprovementPanel slot={slot} /> },
      { id: 'org-analytics', render: (slot) => <OrgAnalyticsPanel slot={slot} /> },
      { id: 'sentiment', render: (slot) => <SentimentPanel slot={slot} /> },
      { id: 'trader-desk', render: (slot) => <TraderDeskPanel slot={slot} /> },
      { id: 'yields', render: (slot) => <YieldsPanel slot={slot} /> },
      { id: 'displacement', render: (slot) => <DisplacementPanel slot={slot} /> },
      { id: 'ucdp-events', render: (slot) => <UcdpEventsPanel slot={slot} /> },
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
      { id: 'hanzo-status', render: (slot) => <HanzoStatusPanel slot={slot} /> },
      { id: 'lux-book', render: (slot) => <LuxBookPanel slot={slot} /> },
      { id: 'model-usage', render: (slot) => <ModelUsagePanel slot={slot} /> },
      { id: 'my-usage', render: (slot) => <MyUsagePanel slot={slot} /> },
      { id: 'cloud-queue', render: (slot) => <QueuePanel slot={slot} /> },
      { id: 'rotation', render: (slot) => <RotationScannerPanel slot={slot} /> },
      { id: 'stablecoins', render: (slot) => <StablecoinPanel slot={slot} /> },
      { id: 'service-status', render: (slot) => <ServiceStatusPanel slot={slot} /> },
      { id: 'tech-readiness', render: (slot) => <TechReadinessPanel slot={slot} /> },
      { id: 'traffic-globe', render: (slot) => <TrafficGlobePanel slot={slot} /> },
      { id: 'trading-bubble', render: (slot) => <TradingBubblePanel slot={slot} /> },
      { id: 'strategic-posture', render: (slot) => <StrategicPosturePanel slot={slot} /> },
      { id: 'cii', render: (slot) => <CIIPanel slot={slot} /> },
      { id: 'gdelt-intel', render: (slot) => <GdeltIntelPanel slot={slot} /> },
      { id: 'country-intel', render: (slot) => <CountryIntelPanel slot={slot} /> },
    ],
    [],
  );

  return (
    <YStack flex={1} height="100%" backgroundColor="#000">
      <HanzoAppHeader
        productId="world"
        org={{ id: 'hanzo', label: 'Hanzo' }}
        search={{
          placeholder: 'Search or ask Hanzo…',
          onClick: () => {
            updateSearchIndex();
            open();
          },
        }}
        account={<AccountControl />}
      />

      <XStack
        paddingHorizontal="$3"
        paddingVertical="$2"
        alignItems="center"
        justifyContent="flex-start"
        gap="$3"
        zIndex={10}
      >
        <VariantTabs active={variant} onSelect={handleSelect} />
      </XStack>

      {/* Stage: the globe + floating panel rail, OR — in the finance variant —
          the full-viewport finance terminal (mirrors the vanilla mountMap
          early-return: the terminal is position:fixed z-index:40 and covers the
          globe, so the z-index:20 rail is intentionally not rendered there).
          The AnalystDock is the agentic copilot, available over every stage. */}
      <YStack flex={1} position="relative" overflow="hidden">
        {variant === 'finance' ? (
          <FinanceTerminal />
        ) : (
          <>
            <GlobeIsland variant={variant} />
            <YStack position="absolute" top="$3" right="$3" zIndex={20}>
              <PanelGrid items={panels} />
            </YStack>
          </>
        )}
        <AnalystDock onVariantChange={handleSelect} />
      </YStack>
    </YStack>
  );
}
