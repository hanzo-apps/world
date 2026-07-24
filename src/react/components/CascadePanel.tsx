import { useEffect, useMemo, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { getCSSColor } from '@/utils';
import { t } from '@/services/i18n';
import {
  buildDependencyGraph,
  calculateCascade,
  getGraphStats,
} from '@/services/infrastructure-cascade';
import type { CascadeImpactLevel, CascadeResult, InfrastructureNode } from '@/types';
import { Panel, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';
import type { PanelTab } from '@/components/Panel';

/**
 * CascadePanel — the vanilla `CascadePanel` (src/components/CascadePanel.ts) ported
 * onto the React Panel chassis. It models infrastructure interdependency: pick a
 * cable / pipeline / port / chokepoint and simulate its failure to see which
 * countries lose capacity and which redundant routes remain.
 *
 * It REUSES the vanilla data + palette layer VERBATIM — `buildDependencyGraph()`,
 * `getGraphStats()` and `calculateCascade()` (the exact BFS impact engine in
 * src/services/infrastructure-cascade.ts) plus `getCSSColor` for the `--semantic-*`
 * impact palette. No graph-building, cascade or capacity logic is re-authored here;
 * the port is purely the view, in @hanzo/gui longhand primitives against the chassis.
 * JSX auto-escaping obviates the vanilla `escapeHtml`, so it is not imported.
 *
 * The chassis owns the frame + loading/empty/error states; the four infrastructure
 * classes become the chassis tab bar (the vanilla `.cascade-filters` segmented row);
 * this file owns only which state to show, the node picker, and the result view.
 * Two-step interaction is preserved exactly as the vanilla panel: selecting a node
 * arms the analysis (clearing any prior result), and "Analyze Impact" runs the
 * cascade — the same `calculateCascade(selectedNode)` call the vanilla button fires.
 */

type NodeFilter = 'cable' | 'pipeline' | 'port' | 'chokepoint';

const FILTERS: readonly NodeFilter[] = ['cable', 'pipeline', 'port', 'chokepoint'];

function getImpactColor(level: CascadeImpactLevel): string {
  switch (level) {
    case 'critical': return getCSSColor('--semantic-critical');
    case 'high': return getCSSColor('--semantic-high');
    case 'medium': return getCSSColor('--semantic-elevated');
    case 'low': return getCSSColor('--semantic-normal');
  }
}

function getImpactEmoji(level: CascadeImpactLevel): string {
  switch (level) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'medium': return '🟡';
    case 'low': return '🟢';
  }
}

function getNodeTypeEmoji(type: string): string {
  switch (type) {
    case 'cable': return '🔌';
    case 'pipeline': return '🛢️';
    case 'port': return '⚓';
    case 'chokepoint': return '🚢';
    case 'country': return '🏳️';
    default: return '📍';
  }
}

function getFilterLabel(filter: NodeFilter): string {
  const labels: Record<NodeFilter, string> = {
    cable: t('components.cascade.filters.cables'),
    pipeline: t('components.cascade.filters.pipelines'),
    port: t('components.cascade.filters.ports'),
    chokepoint: t('components.cascade.filters.chokepoints'),
  };
  return labels[filter];
}

export function CascadePanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [state, setState] = useState<PanelState>('loading');
  const [filter, setFilter] = useState<NodeFilter>('cable');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [result, setResult] = useState<CascadeResult | null>(null);

  // Build the graph once (the service caches it globally). Ready when the node/edge
  // set is in hand; error if the graph can't be built — an honest state, not empty.
  useEffect(() => {
    try {
      buildDependencyGraph();
      setState('ready');
    } catch (error) {
      console.error('[CascadePanel] Init error:', error);
      setState('error');
    }
  }, []);

  const stats = useMemo(() => (state === 'ready' ? getGraphStats() : null), [state]);

  // The vanilla getFilteredNodes VERBATIM: infrastructure nodes of the active class
  // (never country nodes), sorted by name.
  const nodes = useMemo<InfrastructureNode[]>(() => {
    if (state !== 'ready') return [];
    const graph = buildDependencyGraph();
    const out: InfrastructureNode[] = [];
    for (const node of graph.nodes.values()) {
      // The InfrastructureNode.type union has no 'country' member, so matching the
      // active filter class already excludes country nodes — the vanilla defensive
      // `!== 'country'` guard is statically unreachable here and is dropped.
      if (node.type === filter) out.push(node);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [state, filter]);

  const tabs = useMemo<PanelTab[]>(
    () =>
      FILTERS.map((f) => ({
        key: f,
        label: `${getNodeTypeEmoji(f)} ${getFilterLabel(f)}`,
      })),
    [],
  );

  const onFilterChange = (key: string): void => {
    setFilter(key as NodeFilter);
    setSelectedNode(null);
    setResult(null);
  };

  const onSelect = (nodeId: string): void => {
    setSelectedNode(nodeId);
    setResult(null);
  };

  const runAnalysis = (): void => {
    if (!selectedNode) return;
    setResult(calculateCascade(selectedNode));
  };

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.cascade')}
      state={state}
      errorText={t('common.failedDependencyGraph')}
      infoTooltip={t('components.cascade.infoTooltip')}
      tabs={tabs}
      activeTab={filter}
      onTabChange={onFilterChange}
    >
      <YStack gap="$3">
        {stats ? (
          <XStack gap="$3" flexWrap="wrap">
            <SizableText size="$1" color="$color10">🔌 {stats.cables}</SizableText>
            <SizableText size="$1" color="$color10">🛢️ {stats.pipelines}</SizableText>
            <SizableText size="$1" color="$color10">⚓ {stats.ports}</SizableText>
            <SizableText size="$1" color="$color10">🌊 {stats.chokepoints}</SizableText>
            <SizableText size="$1" color="$color10">🏳️ {stats.countries}</SizableText>
            <SizableText size="$1" color="$color10">📊 {stats.edges} {t('components.cascade.links')}</SizableText>
          </XStack>
        ) : null}

        {/* Node picker — the `.cascade-select` analogue as a bounded, scrollable list. */}
        <YStack
          gap="$0.5"
          maxHeight={200}
          overflow="scroll"
          borderRadius="$3"
          borderWidth={1}
          borderColor="rgba(255,255,255,0.10)"
        >
          {nodes.length === 0 ? (
            <SizableText size="$2" color="$color9" paddingHorizontal="$2" paddingVertical="$2">
              {t('components.cascade.selectPrompt', { type: t(`components.cascade.filterType.${filter}`) })}
            </SizableText>
          ) : (
            nodes.map((n) => (
              <NodeRow
                key={n.id}
                node={n}
                active={selectedNode === n.id}
                onSelect={() => onSelect(n.id)}
              />
            ))
          )}
        </YStack>

        {/* Analyze — mirrors the vanilla button: disabled until a node is armed. */}
        <XStack
          role="button"
          tabIndex={selectedNode ? 0 : -1}
          aria-disabled={!selectedNode}
          cursor={selectedNode ? 'pointer' : 'default'}
          opacity={selectedNode ? 1 : 0.4}
          alignItems="center"
          justifyContent="center"
          paddingVertical="$2"
          borderRadius="$3"
          backgroundColor="rgba(255,255,255,0.10)"
          hoverStyle={selectedNode ? { backgroundColor: 'rgba(255,255,255,0.16)' } : {}}
          pressStyle={selectedNode ? { backgroundColor: 'rgba(255,255,255,0.20)' } : {}}
          onPress={runAnalysis}
        >
          <SizableText size="$3" color="$color12">
            {t('components.cascade.analyzeImpact')}
          </SizableText>
        </XStack>

        {result ? (
          <CascadeResultView result={result} />
        ) : (
          <SizableText size="$2" color="$color9">
            {t('components.cascade.selectInfrastructureHint')}
          </SizableText>
        )}
      </YStack>
    </Panel>
  );
}

function NodeRow({
  node,
  active,
  onSelect,
}: {
  node: InfrastructureNode;
  active: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <XStack
      role="button"
      tabIndex={0}
      cursor="pointer"
      alignItems="center"
      gap="$2"
      paddingHorizontal="$2"
      paddingVertical="$1.5"
      backgroundColor={active ? 'rgba(255,255,255,0.14)' : 'transparent'}
      hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
      pressStyle={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
      onPress={onSelect}
    >
      <SizableText size="$2">{getNodeTypeEmoji(node.type)}</SizableText>
      <SizableText size="$3" color={active ? '$color12' : '$color11'} numberOfLines={1} style={{ flex: 1 }}>
        {node.name}
      </SizableText>
    </XStack>
  );
}

function CascadeResultView({ result }: { result: CascadeResult }): React.JSX.Element {
  const { source, countriesAffected, redundancies } = result;

  return (
    <YStack gap="$3">
      {/* Source header — `.cascade-source`. */}
      <XStack alignItems="center" gap="$2">
        <SizableText size="$3">{getNodeTypeEmoji(source.type)}</SizableText>
        <SizableText size="$4" color="$color12" numberOfLines={1} style={{ flex: 1 }}>
          {source.name}
        </SizableText>
        <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
          {t(`components.cascade.filterType.${source.type}`)}
        </SizableText>
      </XStack>

      {/* Countries affected — `.cascade-countries`. */}
      <YStack gap="$1">
        <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
          {t('components.cascade.countriesAffected', { count: String(countriesAffected.length) })}
        </SizableText>
        {countriesAffected.length > 0 ? (
          countriesAffected.map((c) => (
            <XStack
              key={c.country}
              alignItems="center"
              gap="$2"
              paddingVertical="$1"
              paddingLeft="$2"
              borderLeftWidth={3}
              borderColor={getImpactColor(c.impactLevel)}
            >
              <SizableText size="$2">{getImpactEmoji(c.impactLevel)}</SizableText>
              <SizableText size="$3" color="$color12" numberOfLines={1} style={{ flex: 1 }}>
                {c.countryName}
              </SizableText>
              <SizableText size="$1" color="$color10">
                {t(`components.cascade.impactLevels.${c.impactLevel}`)}
              </SizableText>
              {c.affectedCapacity > 0 ? (
                <SizableText size="$1" color="$color9">
                  {t('components.cascade.capacityPercent', {
                    percent: String(Math.round(c.affectedCapacity * 100)),
                  })}
                </SizableText>
              ) : null}
            </XStack>
          ))
        ) : (
          <SizableText size="$2" color="$color9" paddingVertical="$1">
            {t('components.cascade.noCountryImpacts')}
          </SizableText>
        )}
      </YStack>

      {/* Alternative routes — `.cascade-redundancy` (cables only). */}
      {redundancies && redundancies.length > 0 ? (
        <YStack gap="$1">
          <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
            {t('components.cascade.alternativeRoutes')}
          </SizableText>
          {redundancies.map((r) => (
            <XStack key={r.id} alignItems="center" justifyContent="space-between" gap="$2" paddingVertical="$0.5">
              <SizableText size="$2" color="$color11" numberOfLines={1} style={{ flex: 1 }}>
                {r.name}
              </SizableText>
              <SizableText size="$2" color="$color10">
                {Math.round(r.capacityShare * 100)}%
              </SizableText>
            </XStack>
          ))}
        </YStack>
      ) : null}
    </YStack>
  );
}
