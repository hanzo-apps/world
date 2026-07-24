import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { getCloudPulse, type CloudPulse } from '@/services/cloud-pulse';
import { getCloudModels } from '@/services/cloud-admin';
import { getChainNodes, type ChainNodesData } from '@/services/cloud-map';
import { fmtCompact, fmtInt, fmtPct } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelSlot } from './PanelGrid';

/**
 * CloudOverviewPanel — the vanilla `CloudOverviewPanel`
 * (src/components/CloudOverviewPanel.ts) ported onto the React Panel chassis. The
 * platform-wide hero tile: the public aggregate (/v1/world/cloud-pulse), with the
 * REAL public served-model count (getCloudModels) and the always-real chain-scale
 * tiles summed from live chain-nodes telemetry (getChainNodes) folded in.
 *
 * It REUSES the vanilla data + formatting layer verbatim — the same three
 * `@/services/*` fetchers, the same `fmtCompact` / `fmtInt` / `fmtPct` formatters,
 * and the vanilla `sparkline()` util (via <Sparkline>). No fetch/format logic is
 * re-authored; the port is purely the view, expressed in @hanzo/gui longhand
 * primitives. The vanilla `statTile()` HTML helper is re-expressed as the <StatTile>
 * primitive below (same value/label/sub shape). The chassis owns the frame + the
 * loading / empty / error states; this file owns only the tiles and which state to
 * show. The two-phase fetch (pulse+models first paint, then the slow chain tiles
 * folded in) is preserved exactly so the overview never stalls on a cold chain cache.
 */

interface Tile {
  value: string;
  label: string;
  sub?: string;
}

export function CloudOverviewPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [pulse, setPulse] = useState<CloudPulse | null>(null);
  const [realModels, setRealModels] = useState<number | null>(null);
  const [chains, setChains] = useState<ChainNodesData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Primary render depends ONLY on pulse + models (both fast). getChainNodes can be
    // slow on a cold cache while unreachable L1 RPCs time out, so it is fetched
    // independently and folded in when ready — it must never gate first paint (the
    // vanilla "stuck on Loading" bug).
    const fetchChains = async (): Promise<void> => {
      const c = await getChainNodes();
      if (!cancelled && c) setChains(c);
    };

    const fetchData = async (): Promise<void> => {
      try {
        const [p, models] = await Promise.all([getCloudPulse(), getCloudModels()]);
        if (cancelled) return;
        setPulse(p);
        setRealModels(models && models.totalModels > 0 ? models.totalModels : null);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'failed');
      }
      void fetchChains();
    };

    void fetchData();
    const id = window.setInterval(() => void fetchData(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // State machine, mirroring the vanilla render() gate exactly.
  const state: PanelState = !pulse && error ? 'error' : !pulse ? 'loading' : 'ready';

  // Live badge only when the volume is the exact MEASURED ledger — real-but-partial
  // (public rate/throughput, no token volume) and empty both drop it.
  const live = !!pulse && !pulse.demo && !pulse.volumeModeled;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Cloud Overview"
      state={state}
      errorText={error ?? undefined}
      loadingText="Loading cloud metrics…"
      actions={live ? <PanelLiveDot /> : <XStack />}
      width={460}
      sparkline={pulse ? <SparkRows pulse={pulse} /> : undefined}
    >
      {pulse ? <OverviewBody pulse={pulse} realModels={realModels} chains={chains} /> : null}
    </Panel>
  );
}

/** The requests + new-users spark rows — the vanilla `.cloud-spark-row`s, rendered
 * through the chassis sparkline slot. Each appears only when a real series exists
 * (>= 2 points / any signups) — never a flat line over empties. */
function SparkRows({ pulse }: { pulse: CloudPulse }): React.JSX.Element | null {
  const p = pulse;
  const hasRequests = p.requestSeries.length >= 2;
  const hasSignups = !!p.users && p.users.signupSeries.some((v) => v > 0);
  if (!hasRequests && !hasSignups) return null;
  return (
    <YStack gap="$1.5">
      {hasRequests ? (
        <SparkRow label={`requests · last ${p.requestSeries.length}h`} data={p.requestSeries} />
      ) : null}
      {hasSignups && p.users ? (
        <SparkRow
          label={`new users · last ${p.users.signupSeries.length}d`}
          data={p.users.signupSeries}
        />
      ) : null}
    </YStack>
  );
}

function SparkRow({ label, data }: { label: string; data: number[] }): React.JSX.Element {
  return (
    <XStack alignItems="center" justifyContent="space-between" gap="$3">
      <SizableText size="$1" color="$color9">
        {label}
      </SizableText>
      <Sparkline data={data} width={220} height={30} />
    </XStack>
  );
}

/** The scope line + stat grid — the vanilla `.cloud-overview` body. Tile selection
 * mirrors the vanilla render() exactly: an unmeasured metric is honestly omitted
 * (never shown as a 0), demo volume shows an em-dash, not a fake number. */
function OverviewBody({
  pulse,
  realModels,
  chains,
}: {
  pulse: CloudPulse;
  realModels: number | null;
  chains: ChainNodesData | null;
}): React.JSX.Element {
  const p = pulse;
  const o = p.overview;
  const dash = '—';
  const modelsServed = realModels ?? o.modelsServed;
  const fallback = !p.demo && p.volumeModeled; // real rate/throughput, tokens unmeasured

  const tiles: Tile[] = [
    { value: p.demo ? dash : fmtCompact(o.requestsPerSec), label: 'requests / sec', sub: fallback ? 'measured' : undefined },
    { value: p.demo ? dash : fmtCompact(o.requests24h), label: `requests / ${p.window}` },
    { value: p.volumeModeled ? dash : fmtCompact(o.tokens24h), label: `tokens / ${p.window}`, sub: fallback ? 'ledger only' : undefined },
  ];
  if (modelsServed > 0) {
    tiles.push({ value: fmtInt(modelsServed), label: 'models served', sub: realModels ? 'live' : undefined });
  }
  // Real chain-scale tiles from the live chain-nodes feed (empty when unavailable).
  const nets = chains?.networks ?? [];
  if (nets.length > 0) {
    const liveNets = nets.filter((n) => n.live);
    const totalHeight = liveNets.reduce((sum, n) => sum + (n.blockHeight || 0), 0);
    tiles.push({ value: fmtInt(liveNets.length), label: 'chains live', sub: `${nets.length} tracked` });
    if (totalHeight > 0) tiles.push({ value: fmtCompact(totalHeight), label: 'total block height', sub: 'live' });
  }
  if (o.nodesTotal > 0) tiles.push({ value: `${fmtInt(o.nodesOnline)}/${fmtInt(o.nodesTotal)}`, label: 'nodes online' });
  if (o.gpusOnline > 0) tiles.push({ value: fmtInt(o.gpusOnline), label: 'GPUs online' });
  if (o.uptimePct > 0) tiles.push({ value: fmtPct(o.uptimePct), label: 'uptime' });
  if (p.users) {
    tiles.push({ value: fmtCompact(p.users.total), label: 'users', sub: p.users.signups24h > 0 ? `+${fmtInt(p.users.signups24h)} / 24h` : undefined });
    if (p.users.activeNow > 0) tiles.push({ value: fmtInt(p.users.activeNow), label: 'active now' });
  }

  return (
    <YStack gap="$2.5">
      <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
        Global platform
      </SizableText>
      <XStack flexWrap="wrap" gap="$2">
        {tiles.map((tile, i) => (
          <StatTile key={`${tile.label}-${i}`} {...tile} />
        ))}
      </XStack>
    </YStack>
  );
}

/** Dense stat tile — the primitive-native analogue of the vanilla `statTile()` HTML
 * helper: big mono value + label, optional sub. */
function StatTile({ value, label, sub }: Tile): React.JSX.Element {
  return (
    <YStack
      gap="$0.5"
      paddingHorizontal="$2.5"
      paddingVertical="$2"
      borderRadius="$3"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.10)"
      backgroundColor="rgba(255,255,255,0.03)"
      minWidth={128}
      flex={1}
    >
      <SizableText size="$6" color="$color12">
        {value}
      </SizableText>
      <SizableText size="$1" color="$color10" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </SizableText>
      {sub ? (
        <SizableText size="$1" color="$color9">
          {sub}
        </SizableText>
      ) : null}
    </YStack>
  );
}
