import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { getChainNodes, type ChainNodesData, type ChainNetwork } from '@/services/cloud-map';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * BlockchainPanel — the vanilla `BlockchainPanel` (src/components/BlockchainPanel.ts)
 * ported onto the React Panel chassis. The text-driven "Chains" widget for the cloud
 * globe: one row per network from the same-origin /v1/world/cloud/chain-nodes feed —
 * name, block height (mono), peers where we have peer visibility, and a live/down
 * status dot.
 *
 * It REUSES the vanilla data layer verbatim — the same `getChainNodes` fetcher from
 * `@/services/cloud-map`, on the same 15s poll cadence. No fetch/shape logic is
 * re-authored; the port is purely the view, expressed in @hanzo/gui longhand
 * primitives against the chassis. The chassis owns the frame + the loading / empty /
 * error states; this file owns only the rows and which state to show.
 *
 * The vanilla `escapeHtml()` call is intentionally dropped: it exists solely to
 * neutralise HTML-string injection in the vanilla `setContent()` path. React escapes
 * text nodes natively, so the names/ids render as trusted text with no double-encoding.
 *
 * View-only parity with the vanilla render() gate:
 *   • no data yet (still loading)        → state="loading"
 *   • loaded, zero networks              → state="empty"  ("chain data unavailable")
 *   • networks present                   → state="ready"  (rows + live dot)
 * Sub line and peers cells follow the vanilla honesty rules exactly: chain id only
 * for real EVM ids (>0), "positions modeled" only where the chain places modeled
 * globe nodes (peers>0), and the peers cell omitted (never a misleading "0 peers")
 * where we have no peer visibility.
 */
export function BlockchainPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<ChainNodesData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async (): Promise<void> => {
      const d = await getChainNodes();
      if (cancelled) return;
      if (d) setData(d);
      setLoaded(true);
    };

    void fetchData();
    // Same 15s live cadence as the vanilla poller.
    const id = window.setInterval(() => void fetchData(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const nets = data?.networks ?? [];
  const hasNets = !!data && nets.length > 0;
  const state: PanelState = hasNets ? 'ready' : loaded ? 'empty' : 'loading';
  const modeled = !!data?.positionsModeled;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Chains"
      state={state}
      emptyText="chain data unavailable"
      loadingText="Loading chains…"
      actions={hasNets ? <PanelLiveDot /> : <XStack />}
    >
      <YStack>
        {nets.map((n) => (
          <ChainRow key={n.id} net={n} modeled={modeled} />
        ))}
      </YStack>
    </Panel>
  );
}

/** One network row — the vanilla `.chains-row`: status dot, name, mono block height,
 * optional peers cell, and an optional sub line (chain id · positions modeled). */
function ChainRow({ net, modeled }: { net: ChainNetwork; modeled: boolean }): React.JSX.Element {
  const dot = net.live ? '#ededed' : '#3a3a3a';

  const subParts: string[] = [];
  if (net.chainId > 0) subParts.push(`chain ${net.chainId}`);
  if (modeled && net.peers > 0) subParts.push('positions modeled');
  const sub = subParts.join(' · ');

  return (
    <YStack paddingVertical="$1.5" borderBottomWidth={1} borderColor="#1f1f1f">
      <XStack alignItems="center" gap="$2">
        <SizableText size="$1" color={dot} style={{ lineHeight: 1 }}>
          ●
        </SizableText>
        <SizableText size="$3" color="$color12" flex={1} style={{ fontWeight: '500' }}>
          {net.name}
        </SizableText>
        <SizableText size="$3" color="$color12" fontFamily="$mono">
          {net.blockHeight.toLocaleString()}
        </SizableText>
        {net.peers > 0 ? (
          <XStack alignItems="center" gap="$1">
            <SizableText size="$2" color="$color8">
              ·
            </SizableText>
            <SizableText
              size="$2"
              color="$color9"
              fontFamily="$mono"
              style={{ minWidth: 36, textAlign: 'right' }}
            >
              {net.peers}
            </SizableText>
            <SizableText size="$2" color="$color9">
              peers
            </SizableText>
          </XStack>
        ) : null}
      </XStack>
      {sub ? (
        <SizableText size="$1" color="$color9" paddingLeft="$5">
          {sub}
        </SizableText>
      ) : null}
    </YStack>
  );
}
