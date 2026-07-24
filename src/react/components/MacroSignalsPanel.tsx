import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { t } from '@/services/i18n';
import { Panel, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelSlot } from './PanelGrid';

/**
 * MacroSignalsPanel — the vanilla `MacroSignalsPanel`
 * (src/components/MacroSignalsPanel.ts) ported onto the React Panel chassis. The
 * macro "Market Radar" tile: an overall BUY/CASH verdict plus a grid of seven
 * signal cards (liquidity, flow, regime, BTC trend, hash rate, mining, fear &
 * greed) computed server-side.
 *
 * It REUSES the vanilla data layer VERBATIM — the same `/v1/world/macro-signals`
 * fetch the vanilla panel is fed by (there is no separate `@/services/*` module for
 * this endpoint; the fetch IS the data layer) — and the vanilla `sparkline()` util
 * via <Sparkline>. No fetch/format logic is re-authored; the port is purely the
 * view, expressed in @hanzo/gui longhand primitives. The vanilla `renderSignalCard`
 * / `renderFearGreedCard` HTML helpers are re-expressed as the <SignalCard> /
 * <FearGreedCard> primitives below (same status/value/sparkline/detail shape). The
 * chassis owns the frame + the loading / empty / error states; this file owns only
 * the cards and which state to show. The `unavailable` upstream flag maps to the
 * chassis error state exactly as the vanilla render() gate does — never fabricated
 * data.
 */

interface MacroSignalData {
  timestamp: string;
  verdict: string;
  bullishCount: number;
  totalCount: number;
  signals: {
    liquidity: { status: string; value: number | null; sparkline: number[] };
    flowStructure: { status: string; btcReturn5: number | null; qqqReturn5: number | null };
    macroRegime: { status: string; qqqRoc20: number | null; xlpRoc20: number | null };
    technicalTrend: {
      status: string;
      btcPrice: number | null;
      sma50: number | null;
      sma200: number | null;
      vwap30d: number | null;
      mayerMultiple: number | null;
      sparkline: number[];
    };
    hashRate: { status: string; change30d: number | null };
    miningCost: { status: string };
    fearGreed: { status: string; value: number | null; history: Array<{ value: number; date: string }> };
  };
  meta: { qqqSparkline: number[] };
  unavailable?: boolean;
}

const BULLISH = new Set([
  'BULLISH', 'RISK-ON', 'GROWING', 'PROFITABLE', 'ALIGNED', 'NORMAL', 'EXTREME GREED', 'GREED',
]);
const BEARISH = new Set([
  'BEARISH', 'DEFENSIVE', 'DECLINING', 'SQUEEZE', 'PASSIVE GAP', 'EXTREME FEAR', 'FEAR',
]);

/** Vanilla `statusBadgeClass` → a token colour. bullish=green, bearish=red, else neutral. */
function statusColor(status: string): string {
  const s = status.toUpperCase();
  if (BULLISH.has(s)) return '#22c55e';
  if (BEARISH.has(s)) return '#ef4444';
  return '#9ca3af';
}

/** Vanilla `formatNum` verbatim. */
function formatNum(v: number | null, suffix = '%'): string {
  if (v === null) return 'N/A';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}${suffix}`;
}

export function MacroSignalsPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<MacroSignalData | null>(null);
  const [state, setState] = useState<PanelState>('loading');
  const [errorText, setErrorText] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/v1/world/macro-signals');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: MacroSignalData = await res.json();
        if (cancelled) return;
        if (json.unavailable) {
          setData(null);
          setErrorText(t('common.upstreamUnavailable'));
          setState('error');
          return;
        }
        setData(json);
        setErrorText(undefined);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setData(null);
        setErrorText(err instanceof Error ? err.message : t('common.noDataShort'));
        setState('error');
      }
    };

    void load();
    // Same 3-minute cadence as the vanilla poller.
    const id = window.setInterval(() => void load(), 3 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.macroSignals')}
      state={state}
      errorText={errorText}
      loadingText={t('common.computingSignals')}
      width={460}
    >
      {data ? <MacroBody data={data} /> : null}
    </Panel>
  );
}

function MacroBody({ data }: { data: MacroSignalData }): React.JSX.Element {
  const d = data;
  const s = d.signals;
  const verdictColor = d.verdict === 'BUY' ? '#22c55e' : d.verdict === 'CASH' ? '#ef4444' : '#9ca3af';

  return (
    <YStack gap="$2.5">
      {/* Overall verdict — the vanilla `.macro-verdict` row. */}
      <XStack
        alignItems="center"
        gap="$2"
        paddingHorizontal="$2.5"
        paddingVertical="$2"
        borderRadius="$3"
        borderWidth={1}
        borderColor="rgba(255,255,255,0.10)"
        backgroundColor="rgba(255,255,255,0.03)"
      >
        <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Overall
        </SizableText>
        <SizableText size="$6" color={verdictColor} fontFamily="$mono">
          {d.verdict}
        </SizableText>
        <SizableText size="$2" color="$color9">
          {d.bullishCount}/{d.totalCount} bullish
        </SizableText>
      </XStack>

      {/* Signals grid — the vanilla `.signals-grid`. */}
      <XStack flexWrap="wrap" gap="$2">
        <SignalCard
          name="Liquidity"
          status={s.liquidity.status}
          value={formatNum(s.liquidity.value)}
          sparkline={s.liquidity.sparkline}
          sparklineColor="#4fc3f7"
          detail="JPY 30d ROC"
          link="https://www.tradingview.com/symbols/JPYUSD/"
        />
        <SignalCard
          name="Flow"
          status={s.flowStructure.status}
          value={`BTC ${formatNum(s.flowStructure.btcReturn5)} / QQQ ${formatNum(s.flowStructure.qqqReturn5)}`}
          detail="5d returns"
        />
        <SignalCard
          name="Regime"
          status={s.macroRegime.status}
          value={`QQQ ${formatNum(s.macroRegime.qqqRoc20)} / XLP ${formatNum(s.macroRegime.xlpRoc20)}`}
          sparkline={d.meta.qqqSparkline}
          sparklineColor="#ab47bc"
          detail="20d ROC"
          link="https://www.tradingview.com/symbols/QQQ/"
        />
        <SignalCard
          name="BTC Trend"
          status={s.technicalTrend.status}
          value={`$${s.technicalTrend.btcPrice?.toLocaleString() ?? 'N/A'}`}
          sparkline={s.technicalTrend.sparkline}
          sparklineColor="#ff9800"
          detail={`SMA50: $${s.technicalTrend.sma50?.toLocaleString() ?? '-'} | VWAP: $${s.technicalTrend.vwap30d?.toLocaleString() ?? '-'} | Mayer: ${s.technicalTrend.mayerMultiple ?? '-'}`}
          link="https://www.tradingview.com/symbols/BTCUSD/"
        />
        <SignalCard
          name="Hash Rate"
          status={s.hashRate.status}
          value={formatNum(s.hashRate.change30d)}
          detail="30d change"
          link="https://mempool.space/mining"
        />
        <SignalCard name="Mining" status={s.miningCost.status} detail="Hashprice model" />
        <FearGreedCard fg={s.fearGreed} />
      </XStack>
    </YStack>
  );
}

/** The one signal card — the vanilla `renderSignalCard()` re-expressed. */
function SignalCard({
  name,
  status,
  value,
  sparkline,
  sparklineColor,
  detail,
  link,
}: {
  name: string;
  status: string;
  value?: string;
  sparkline?: number[];
  sparklineColor?: string;
  detail?: string;
  link?: string;
}): React.JSX.Element {
  return (
    <YStack
      gap="$1.5"
      paddingHorizontal="$2.5"
      paddingVertical="$2"
      borderRadius="$3"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.10)"
      backgroundColor="rgba(255,255,255,0.03)"
      minWidth={140}
      flexGrow={1}
    >
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        {link ? (
          <a href={link} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>
            <SizableText size="$2" color="$color12">
              {name}
            </SizableText>
          </a>
        ) : (
          <SizableText size="$2" color="$color12">
            {name}
          </SizableText>
        )}
        <SizableText size="$1" color={statusColor(status)} style={{ textTransform: 'uppercase' }}>
          {status}
        </SizableText>
      </XStack>
      {sparkline && sparkline.length > 0 ? (
        <Sparkline data={sparkline} width={60} height={20} color={sparklineColor} />
      ) : null}
      {value ? (
        <SizableText size="$3" color="$color12" fontFamily="$mono">
          {value}
        </SizableText>
      ) : null}
      {detail ? (
        <SizableText size="$1" color="$color9">
          {detail}
        </SizableText>
      ) : null}
    </YStack>
  );
}

/** The fear & greed card — the vanilla `renderFearGreedCard()` re-expressed, with the
 * `donutGaugeSvg` gauge rendered as inline JSX SVG (same thresholds/colours). */
function FearGreedCard({ fg }: { fg: MacroSignalData['signals']['fearGreed'] }): React.JSX.Element {
  return (
    <YStack
      gap="$1.5"
      paddingHorizontal="$2.5"
      paddingVertical="$2"
      borderRadius="$3"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.10)"
      backgroundColor="rgba(255,255,255,0.03)"
      minWidth={140}
      flexGrow={1}
      alignItems="center"
    >
      <XStack alignItems="center" justifyContent="space-between" gap="$2" width="100%">
        <SizableText size="$2" color="$color12">
          Fear &amp; Greed
        </SizableText>
        <SizableText size="$1" color={statusColor(fg.status)} style={{ textTransform: 'uppercase' }}>
          {fg.status}
        </SizableText>
      </XStack>
      <DonutGauge value={fg.value} />
      <a
        href="https://alternative.me/crypto/fear-and-greed-index/"
        target="_blank"
        rel="noopener"
        style={{ textDecoration: 'none' }}
      >
        <SizableText size="$1" color="$color9">
          alternative.me
        </SizableText>
      </a>
    </YStack>
  );
}

/** Inline JSX analogue of the vanilla `donutGaugeSvg()` — same size/thresholds/colours. */
function DonutGauge({ value, size = 48 }: { value: number | null; size?: number }): React.JSX.Element {
  if (value === null) {
    return (
      <SizableText size="$2" color="$color9">
        N/A
      </SizableText>
    );
  }
  const v = Math.max(0, Math.min(100, value));
  const r = (size - 6) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (v / 100) * circumference;
  let color = '#f44336';
  if (v >= 75) color = '#4caf50';
  else if (v >= 50) color = '#ff9800';
  else if (v >= 25) color = '#ff5722';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={5} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2 + 4} textAnchor="middle" fill={color} fontSize={12} fontWeight="bold">
        {v}
      </text>
    </svg>
  );
}
