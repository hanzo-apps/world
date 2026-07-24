import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { t } from '@/services/i18n';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * ETFFlowsPanel — the vanilla `ETFFlowsPanel` (src/components/ETFFlowsPanel.ts, panel
 * key `etf-flows`, "BTC ETF tracker") ported onto the React Panel chassis.
 *
 * It REUSES the vanilla panel's data layer verbatim — the same direct GET on
 * `/v1/world/etf-flows`, the same `ETFFlowsResult` payload shape, and the same local
 * `formatVolume` magnitude formatter. No fetch/format logic is re-authored; the port
 * is purely the view, re-expressed in @hanzo/gui longhand primitives against the
 * chassis. The vanilla panel's HTML string builders (the summary bar + `<table>`) are
 * the view layer being replaced by primitives here — every number they carried is
 * carried through unchanged.
 *
 * The vanilla `escapeHtml` guard is intentionally dropped: React escapes text nodes by
 * default, so ticker/issuer/direction strings are rendered as safe children with no
 * `dangerouslySetInnerHTML`. The chassis owns the frame + loading / empty / error
 * states; this file owns only the rows and which state to show.
 */

interface ETFData {
  ticker: string;
  issuer: string;
  price: number;
  priceChange: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;
  direction: 'inflow' | 'outflow' | 'neutral';
  estFlow: number;
}

interface ETFFlowsResult {
  timestamp: string;
  summary: {
    etfCount: number;
    totalVolume: number;
    totalEstFlow: number;
    netDirection: string;
    inflowCount: number;
    outflowCount: number;
  };
  etfs: ETFData[];
  unavailable?: boolean;
}

// Verbatim from the vanilla panel — compact magnitude formatter (B / M / K).
function formatVolume(v: number): string {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toLocaleString();
}

const INFLOW = '#22c55e';
const OUTFLOW = '#ef4444';

// Primitive-native analogues of the vanilla .flow-inflow / .flow-outflow / .flow-neutral
// CSS classes (direction) and .change-positive / .change-negative / .change-neutral
// (price change), same thresholds.
function flowColor(direction: string): string {
  if (direction === 'inflow') return INFLOW;
  if (direction === 'outflow') return OUTFLOW;
  return '$color10';
}

function changeColor(val: number): string {
  if (val > 0.1) return INFLOW;
  if (val < -0.1) return OUTFLOW;
  return '$color10';
}

function netDirectionColor(net: string): string {
  if (net.includes('INFLOW')) return INFLOW;
  if (net.includes('OUTFLOW')) return OUTFLOW;
  return '$color10';
}

export function ETFFlowsPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<ETFFlowsResult | null>(null);
  const [state, setState] = useState<PanelState>('loading');
  const [errorText, setErrorText] = useState<string | undefined>();
  const [emptyText, setEmptyText] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    // The vanilla fetchData(), verbatim — same endpoint, same error surface.
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/v1/world/etf-flows');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result: ETFFlowsResult = await res.json();
        if (cancelled) return;

        if (result.unavailable === true) {
          setData(null);
          setErrorText(t('common.upstreamUnavailable'));
          setState('error');
          return;
        }
        if (!result.etfs.length) {
          setData(null);
          setEmptyText('ETF data temporarily unavailable');
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
      title={t('panels.etfFlows')}
      state={state}
      loadingText={t('common.loadingEtfData')}
      errorText={errorText}
      emptyText={emptyText}
      actions={<PanelLiveDot />}
    >
      {data && s ? (
        <YStack gap="$3">
          {/* Summary bar — the vanilla .etf-summary block. */}
          <XStack flexWrap="wrap" gap="$3">
            <SummaryItem label="Net Flow" value={s.netDirection} color={netDirectionColor(s.netDirection)} />
            <SummaryItem label="Est. Flow" value={`$${formatVolume(Math.abs(s.totalEstFlow))}`} />
            <SummaryItem label="Total Vol" value={formatVolume(s.totalVolume)} />
            <SummaryItem label="ETFs" value={`${s.inflowCount}↑ ${s.outflowCount}↓`} />
          </XStack>

          {/* Table — the vanilla .etf-table (header + rows). */}
          <YStack gap="$1">
            <XStack paddingVertical="$1" borderBottomWidth={1} borderColor="rgba(255,255,255,0.10)">
              <HeaderCell text="Ticker" flex={2} />
              <HeaderCell text="Issuer" flex={3} />
              <HeaderCell text="Est. Flow" flex={2} align="right" />
              <HeaderCell text="Volume" flex={2} align="right" />
              <HeaderCell text="Change" flex={2} align="right" />
            </XStack>
            {data.etfs.map((etf) => (
              <ETFRow key={etf.ticker} etf={etf} />
            ))}
          </YStack>
        </YStack>
      ) : null}
    </Panel>
  );
}

function SummaryItem({
  label,
  value,
  color = '$color12',
}: {
  label: string;
  value: string;
  color?: string;
}): React.JSX.Element {
  return (
    <YStack gap="$0.5">
      <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </SizableText>
      <SizableText size="$3" color={color}>
        {value}
      </SizableText>
    </YStack>
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

function ETFRow({ etf }: { etf: ETFData }): React.JSX.Element {
  const flowSign = etf.direction === 'inflow' ? '+' : etf.direction === 'outflow' ? '-' : '';
  const flowText = `${flowSign}$${formatVolume(Math.abs(etf.estFlow))}`;
  const changeText = `${etf.priceChange > 0 ? '+' : ''}${etf.priceChange.toFixed(2)}%`;

  return (
    <XStack alignItems="center" paddingVertical="$1">
      <SizableText size="$3" color="$color12" flex={2}>
        {etf.ticker}
      </SizableText>
      <SizableText size="$2" color="$color9" flex={3} numberOfLines={1}>
        {etf.issuer}
      </SizableText>
      <SizableText size="$2" color={flowColor(etf.direction)} flex={2} style={{ textAlign: 'right' }}>
        {flowText}
      </SizableText>
      <SizableText size="$2" color="$color11" flex={2} style={{ textAlign: 'right' }}>
        {formatVolume(etf.volume)}
      </SizableText>
      <SizableText size="$2" color={changeColor(etf.priceChange)} flex={2} style={{ textAlign: 'right' }}>
        {changeText}
      </SizableText>
    </XStack>
  );
}
