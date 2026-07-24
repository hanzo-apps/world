import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { t } from '@/services/i18n';
import { fmtPct, signedPct } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * StablecoinPanel — the vanilla `StablecoinPanel` (src/components/StablecoinPanel.ts,
 * panel key `stablecoins`) ported onto the React Panel chassis.
 *
 * It REUSES the vanilla panel's data layer verbatim — the same direct GET on
 * `/v1/world/stablecoin-markets`, the same `StablecoinResult` payload shape, the same
 * `fmtPct` / `signedPct` cloud formatters, and the same local `formatLargeNum` /
 * `pegClass` / `healthClass` helpers. No fetch/format logic is re-authored; the port
 * is purely the view, re-expressed in @hanzo/gui longhand primitives against the
 * chassis. The vanilla panel's HTML string builders (the health bar + the peg-health
 * list + the supply/volume table) are the view layer being replaced by primitives
 * here — every number they carried is carried through unchanged.
 *
 * The vanilla `escapeHtml` guard is intentionally dropped: React escapes text nodes by
 * default, so symbol/name/status strings are rendered as safe children with no
 * `dangerouslySetInnerHTML`. The chassis owns the frame + loading / empty / error
 * states; this file owns only the rows and which state to show.
 */

interface StablecoinData {
  id: string;
  symbol: string;
  name: string;
  price: number;
  deviation: number;
  pegStatus: 'ON PEG' | 'SLIGHT DEPEG' | 'DEPEGGED';
  marketCap: number;
  volume24h: number;
  change24h: number;
  change7d: number;
  image: string;
}

interface StablecoinResult {
  timestamp: string;
  summary: {
    totalMarketCap: number;
    totalVolume24h: number;
    coinCount: number;
    depeggedCount: number;
    healthStatus: string;
  };
  stablecoins: StablecoinData[];
  unavailable?: boolean;
}

// Verbatim from the vanilla panel — compact USD magnitude formatter (T / B / M).
function formatLargeNum(v: number): string {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

const OK = '#22c55e';
const WARN = '#f59e0b';
const BAD = '#ef4444';

// Primitive-native analogues of the vanilla .peg-on / .peg-slight / .peg-off CSS
// classes — same status → tint mapping (pegClass in the vanilla panel).
function pegColor(status: string): string {
  if (status === 'ON PEG') return OK;
  if (status === 'SLIGHT DEPEG') return WARN;
  return BAD;
}

// Analogue of the vanilla .health-good / .health-caution / .health-warning classes
// (healthClass in the vanilla panel).
function healthColor(status: string): string {
  if (status === 'HEALTHY') return OK;
  if (status === 'CAUTION') return WARN;
  return BAD;
}

export function StablecoinPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<StablecoinResult | null>(null);
  const [state, setState] = useState<PanelState>('loading');
  const [errorText, setErrorText] = useState<string | undefined>();
  const [emptyText, setEmptyText] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    // The vanilla fetchData(), verbatim — same endpoint, same error surface.
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/v1/world/stablecoin-markets');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result: StablecoinResult = await res.json();
        if (cancelled) return;

        if (result.unavailable === true) {
          setData(null);
          setErrorText(t('common.upstreamUnavailable'));
          setState('error');
          return;
        }
        if (!result.stablecoins.length) {
          setData(null);
          setEmptyText(t('components.stablecoins.unavailable'));
          setState('empty');
          return;
        }
        setData(result);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setErrorText(err instanceof Error ? err.message : t('common.noDataShort'));
        setState('error');
      }
    };

    void load();
    // Same cadence as the vanilla poller (3 minutes).
    const id = window.setInterval(() => void load(), 3 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const s = data?.summary;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.stablecoins')}
      state={state}
      loadingText={t('common.loadingStablecoins')}
      errorText={errorText}
      emptyText={emptyText}
      actions={<PanelLiveDot />}
    >
      {data && s ? (
        <YStack gap="$3">
          {/* Health bar — the vanilla .stable-health block. */}
          <YStack
            gap="$0.5"
            paddingHorizontal="$2.5"
            paddingVertical="$2"
            borderRadius="$3"
            borderLeftWidth={2}
            borderColor={healthColor(s.healthStatus)}
            backgroundColor="rgba(255,255,255,0.04)"
          >
            <SizableText size="$3" color={healthColor(s.healthStatus)}>
              {s.healthStatus}
            </SizableText>
            <SizableText size="$1" color="$color9">
              {`MCap: ${formatLargeNum(s.totalMarketCap)} | Vol: ${formatLargeNum(s.totalVolume24h)}`}
            </SizableText>
          </YStack>

          {/* Peg Health section — the vanilla .stable-peg-list. */}
          <YStack gap="$1.5">
            <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
              {t('components.stablecoins.pegHealth')}
            </SizableText>
            {data.stablecoins.map((c) => (
              <PegRow key={c.id} coin={c} />
            ))}
          </YStack>

          {/* Supply & Volume section — the vanilla .stable-supply-list (header + rows). */}
          <YStack gap="$1">
            <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
              {t('components.stablecoins.supplyVolume')}
            </SizableText>
            <XStack paddingVertical="$1" borderBottomWidth={1} borderColor="rgba(255,255,255,0.10)">
              <HeaderCell text={t('components.stablecoins.token')} flex={2} />
              <HeaderCell text={t('components.stablecoins.mcap')} flex={3} align="right" />
              <HeaderCell text={t('components.stablecoins.vol24h')} flex={3} align="right" />
              <HeaderCell text={t('components.stablecoins.chg24h')} flex={2} align="right" />
            </XStack>
            {data.stablecoins.map((c) => (
              <SupplyRow key={c.id} coin={c} />
            ))}
          </YStack>
        </YStack>
      ) : null}
    </Panel>
  );
}

function HeaderCell({
  text,
  flex,
  align = 'left',
}: {
  text: string;
  flex: number;
  align?: 'left' | 'right';
}): React.JSX.Element {
  return (
    <SizableText
      size="$1"
      color="$color9"
      flex={flex}
      style={{ textTransform: 'uppercase', letterSpacing: 1, textAlign: align }}
    >
      {text}
    </SizableText>
  );
}

function PegRow({ coin }: { coin: StablecoinData }): React.JSX.Element {
  return (
    <XStack alignItems="center" justifyContent="space-between" paddingVertical="$1" gap="$2">
      <YStack flex={1}>
        <SizableText size="$3" color="$color12">
          {coin.symbol}
        </SizableText>
        <SizableText size="$1" color="$color9" numberOfLines={1}>
          {coin.name}
        </SizableText>
      </YStack>
      <SizableText size="$3" color="$color11" style={{ textAlign: 'right', minWidth: 72 }}>
        {`$${coin.price.toFixed(4)}`}
      </SizableText>
      <YStack alignItems="flex-end" minWidth={90}>
        <SizableText size="$2" color={pegColor(coin.pegStatus)}>
          {coin.pegStatus}
        </SizableText>
        <SizableText size="$1" color="$color9">
          {fmtPct(coin.deviation)}
        </SizableText>
      </YStack>
    </XStack>
  );
}

function SupplyRow({ coin }: { coin: StablecoinData }): React.JSX.Element {
  const changeColor = coin.change24h >= 0 ? OK : BAD;
  return (
    <XStack alignItems="center" paddingVertical="$1">
      <SizableText size="$3" color="$color12" flex={2}>
        {coin.symbol}
      </SizableText>
      <SizableText size="$2" color="$color11" flex={3} style={{ textAlign: 'right' }}>
        {formatLargeNum(coin.marketCap)}
      </SizableText>
      <SizableText size="$2" color="$color11" flex={3} style={{ textAlign: 'right' }}>
        {formatLargeNum(coin.volume24h)}
      </SizableText>
      <SizableText size="$2" color={changeColor} flex={2} style={{ textAlign: 'right' }}>
        {signedPct(coin.change24h)}
      </SizableText>
    </XStack>
  );
}
