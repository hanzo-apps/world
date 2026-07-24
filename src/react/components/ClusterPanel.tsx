import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import {
  getCloudClusters,
  type CloudClusters,
  type ClusterGroup,
  type ClusterNode,
} from '@/services/cloud-admin';
import { fmtInt } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * ClusterPanel — the vanilla `ClusterPanel` (src/components/ClusterPanel.ts) ported
 * onto the React Panel chassis. The SuperAdmin fleet view of every DOKS + BYO
 * Kubernetes cluster the platform runs (hanzo-k8s, adnexus-k8s, …), each grouped
 * with its node pools and per-node status, from visor's unified k8s noun
 * (/v1/world/cloud/clusters, server-side owner==admin fail-closed 403).
 *
 * It REUSES the vanilla data + formatting layer verbatim — the same
 * `getCloudClusters` fetcher and the `fmtInt` formatter. No fetch/format logic is
 * re-authored; the port is purely the view, expressed in @hanzo/gui longhand
 * primitives. The vanilla HTML helpers are re-expressed primitive-native: `statTile()`
 * → the <StatTile> tile below (same value/label shape), `adminOnlyState()` → the
 * chassis empty state carrying the same admin-gate copy, `escapeHtml()` is unneeded
 * because React escapes text nodes. The chassis owns the frame + the
 * loading / empty / error states; this file owns only the rows and which state to
 * show. Refreshes every 30s (the vanilla cadence). Honest "admin only" / "unavailable"
 * states — never fabricated nodes.
 */

// The vanilla ready-state predicate, verbatim.
const readyState = (s: string): boolean =>
  ['active', 'running', 'online', 'ready', 'healthy', ''].includes(s);

const DOT_COLOR: Record<'online' | 'degraded' | 'offline', string> = {
  online: '#22c55e',
  degraded: '#eab308',
  offline: '#ef4444',
};

export function ClusterPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<CloudClusters | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async (): Promise<void> => {
      const d = await getCloudClusters();
      if (cancelled) return;
      setData(d);
      setLoaded(true);
    };

    void fetchData();
    const id = window.setInterval(() => void fetchData(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // State machine, mirroring the vanilla render() gate exactly:
  //   !loaded            → loading
  //   loaded, data null  → admin-only gate (empty, with the gate copy)
  //   loaded, !available → unavailable (empty, with the payload note)
  //   else               → ready
  const state: PanelState = !loaded ? 'loading' : !data || !data.available ? 'empty' : 'ready';

  const emptyText = !data
    ? 'The Kubernetes cluster fleet is available to the platform admin org. Sign in with an admin account to view it.'
    : !data.available
      ? data.note || 'Cluster inventory is unavailable right now.'
      : undefined;

  const allReady = !!data && data.available && data.totals.nodes > 0 && data.totals.nodesReady === data.totals.nodes;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Clusters & Nodes"
      state={state}
      loadingText="Loading clusters…"
      emptyText={emptyText}
      actions={allReady ? <PanelLiveDot /> : <XStack />}
      width={460}
    >
      {data && data.available ? <ClustersBody d={data} /> : null}
    </Panel>
  );
}

/** The overview head + stat grid + per-cluster groups — the vanilla `.cloud-clusters` body. */
function ClustersBody({ d }: { d: CloudClusters }): React.JSX.Element {
  const pools = d.clusters.reduce((s, c) => s + c.pools.length, 0);
  const tiles: { value: string; label: string }[] = [
    { value: fmtInt(d.totals.clusters), label: 'clusters' },
    { value: `${fmtInt(d.totals.nodesReady)}/${fmtInt(d.totals.nodes)}`, label: 'nodes ready' },
    { value: fmtInt(d.totals.gpus), label: 'GPUs' },
    { value: fmtInt(pools), label: 'node pools' },
  ];

  return (
    <YStack gap="$2.5">
      <XStack alignItems="center" justifyContent="space-between" gap="$3" flexWrap="wrap">
        <SizableText size="$2" color="$color11">
          {`${fmtInt(d.totals.clusters)} clusters · ${fmtInt(d.totals.nodes)} nodes · ${fmtInt(d.totals.gpus)} GPU`}
        </SizableText>
        <SizableText size="$1" color="$color9">
          live · visor
        </SizableText>
      </XStack>

      <XStack flexWrap="wrap" gap="$2">
        {tiles.map((tile) => (
          <StatTile key={tile.label} value={tile.value} label={tile.label} />
        ))}
      </XStack>

      {d.clusters.map((c) => (
        <ClusterCard key={c.id} c={c} />
      ))}
    </YStack>
  );
}

/** One cluster group — head (status dot + name + kind + meta), pools line, node rows. */
function ClusterCard({ c }: { c: ClusterGroup }): React.JSX.Element {
  const dot: 'online' | 'degraded' | 'offline' =
    c.nodes > 0 && c.nodesReady === c.nodes ? 'online' : c.nodesReady > 0 ? 'degraded' : 'offline';
  const poolLine = c.pools
    .map(
      (p) =>
        `${p.name || p.size || 'pool'} · ${fmtInt(p.count)}×${p.size || '—'}` +
        (p.autoScale ? ` · auto ${fmtInt(p.minNodes)}–${fmtInt(p.maxNodes)}` : ''),
    )
    .join('  ·  ');

  return (
    <YStack
      gap="$1.5"
      paddingHorizontal="$2.5"
      paddingVertical="$2"
      borderRadius="$3"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.10)"
      backgroundColor="rgba(255,255,255,0.03)"
    >
      <XStack alignItems="center" gap="$2" flexWrap="wrap">
        <StatusDot kind={dot} />
        <SizableText size="$3" color="$color12">
          {c.name}
        </SizableText>
        <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {c.kind}
        </SizableText>
        <SizableText size="$1" color="$color10" flex={1} style={{ textAlign: 'right' }}>
          {`${c.region || '—'} · ${fmtInt(c.nodesReady)}/${fmtInt(c.nodes)} ready · ${fmtInt(c.gpus)} GPU`}
        </SizableText>
      </XStack>

      {c.pools.length ? (
        <SizableText size="$1" color="$color9">
          {poolLine}
        </SizableText>
      ) : null}

      {c.nodeList.map((n) => (
        <NodeRow key={n.id} n={n} />
      ))}
    </YStack>
  );
}

/** One node row — dot + name + status subtext + spec (type · gpu). */
function NodeRow({ n }: { n: ClusterNode }): React.JSX.Element {
  const spec = [n.type, n.gpu ? `${n.gpu} GPU` : ''].filter(Boolean).join(' · ');
  return (
    <XStack alignItems="center" gap="$2" paddingLeft="$2">
      <StatusDot kind={readyState(n.status) ? 'online' : 'degraded'} />
      <SizableText size="$2" color="$color11" flex={1} numberOfLines={1}>
        {n.name}
      </SizableText>
      {n.status ? (
        <SizableText size="$1" color="$color9">
          {n.status}
        </SizableText>
      ) : null}
      <SizableText size="$1" color="$color10">
        {spec || '—'}
      </SizableText>
    </XStack>
  );
}

function StatusDot({ kind }: { kind: 'online' | 'degraded' | 'offline' }): React.JSX.Element {
  return <XStack width={7} height={7} borderRadius={999} backgroundColor={DOT_COLOR[kind]} />;
}

/** Dense stat tile — the primitive-native analogue of the vanilla `statTile()` HTML
 * helper: big mono value + label. */
function StatTile({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <YStack
      gap="$0.5"
      paddingHorizontal="$2.5"
      paddingVertical="$2"
      borderRadius="$3"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.10)"
      backgroundColor="rgba(255,255,255,0.03)"
      minWidth={100}
      flex={1}
    >
      <SizableText size="$6" color="$color12">
        {value}
      </SizableText>
      <SizableText size="$1" color="$color10" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </SizableText>
    </YStack>
  );
}
