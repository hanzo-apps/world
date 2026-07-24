import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { fmtPct } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelSlot } from './PanelGrid';

/**
 * TraderDeskPanel — the vanilla `TraderDeskPanel` (src/components/TraderDeskPanel.ts)
 * ported onto the React Panel chassis. The classic trader risk suite: risk-on/off +
 * fear/greed gauges, VIX/VVIX/MOVE, the yield curve, index momentum, sector breadth,
 * BTC dominance + perp funding, DXY and metals — dense stat tiles, every field
 * degrading to "—" when its source is down.
 *
 * REUSES the vanilla data layer VERBATIM: it is fed by the same `/v1/world/indicators`
 * fetch (the vanilla panel's own inline data layer — there is no separate @/services
 * fetcher for it), consumes the same `IndicatorData` shape, and formats with the same
 * `fmtPct` (@/utils/cloud-format) plus the vanilla panel's own local `fmt`/`signed`/
 * `chgClass` helpers copied byte-for-byte, and the vanilla `sparkline()` util (via
 * <Sparkline>). No fetch/format logic is re-authored; this file owns only the rows and
 * which chassis state to show. The chassis owns the frame + loading/empty/error.
 * `escapeHtml` from the vanilla is dropped on purpose — React escapes text nodes.
 */

// ── vanilla payload shape, verbatim ────────────────────────────────────────────
interface Quote {
  symbol?: string;
  name?: string;
  price?: number | null;
  change?: number | null;
  r1d?: number | null;
  r5d?: number | null;
  r1m?: number | null;
  sparkline?: number[];
  available?: boolean;
  percentile1y?: number | null;
  source?: string;
}

interface IndicatorData {
  timestamp: string;
  volatility: { vix: Quote | null; vvix: Quote | null; move: Quote; note?: string };
  yieldCurve: {
    threeMonth: number | null; twoYear: number | null; fiveYear: number | null;
    tenYear: number | null; thirtyYear: number | null;
    spread2s10s: number | null; spread3m10y: number | null; spread5s30s: number | null;
    inverted: boolean; note?: string;
  };
  fearGreed: {
    crypto: { value: number | null; label: string; source: string };
    equity: { value: number | null; label: string; components?: Record<string, unknown>; formula?: string };
  };
  momentum: { indices: Quote[] };
  breadth: { advancers: number; decliners: number; advanceDeclineRatio: number | null; sectors: Quote[]; note?: string };
  crypto: {
    btc: Quote | null; btcDominance: number | null; mcapChange24h: number | null;
    fundingRate: number | null; fundingAnnualized: number | null; fundingSource: string; note?: string;
  };
  fx: { dxy: Quote };
  commodities: { gold: Quote; oil: Quote; copper: Quote };
  riskOnOff: { score: number | null; label: string; formula?: string };
  unavailable?: boolean;
}

// ── vanilla local formatters, copied verbatim ──────────────────────────────────
function fmt(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dp });
}
function signed(v: number | null | undefined, dp = 2, suffix = '%'): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return `${v > 0 ? '+' : ''}${v.toFixed(dp)}${suffix}`;
}
type Dir = 'up' | 'down' | 'flat';
function chgClass(v: number | null | undefined): Dir {
  if (v === null || v === undefined || Number.isNaN(v)) return 'flat';
  return v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
}

// Monochrome-with-signal tint: green up / red down / muted flat (the vanilla panel's
// green/red .up/.down convention, matching MarketsPanel).
const DIR_COLOR: Record<Dir, string> = {
  up: '#22c55e',
  down: '#ef4444',
  flat: '$color10',
};

// ── primitive-native analogues of the vanilla tile / gauge markup ──────────────
function Tile({
  name,
  value,
  r1d,
  spark,
  sub,
}: {
  name: string;
  value: string;
  r1d?: number | null;
  spark?: number[];
  sub?: string;
}): React.JSX.Element {
  const dir = chgClass(r1d);
  const tint = DIR_COLOR[dir];
  const chg = signed(r1d);
  return (
    <YStack
      gap="$1"
      padding="$2"
      borderRadius="$3"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.10)"
      minWidth={120}
      flex={1}
    >
      <XStack justifyContent="space-between" alignItems="baseline" gap="$2">
        <SizableText size="$1" color="$color10" numberOfLines={1}>
          {name}
        </SizableText>
        {chg ? (
          <SizableText size="$1" color={tint}>
            {chg}
          </SizableText>
        ) : null}
      </XStack>
      <SizableText size="$4" color="$color12">
        {value}
      </SizableText>
      {spark && spark.length > 1 ? (
        <SizableText color={tint} style={{ lineHeight: 0 }}>
          <Sparkline data={spark} width={110} height={22} />
        </SizableText>
      ) : null}
      {sub ? (
        <SizableText size="$1" color="$color9">
          {sub}
        </SizableText>
      ) : null}
    </YStack>
  );
}

function QuoteTile({
  q,
  fallback,
  sub,
}: {
  q: Quote | null | undefined;
  fallback: string;
  sub?: string;
}): React.JSX.Element {
  if (!q || q.available === false || q.price === null || q.price === undefined) {
    return <Tile name={q?.name || q?.symbol || fallback} value="—" r1d={null} sub={sub} />;
  }
  return <Tile name={q.name || q.symbol || fallback} value={fmt(q.price)} r1d={q.r1d} spark={q.sparkline} sub={sub} />;
}

function fgColor(v: number | null): string {
  if (v === null) return '$color9';
  if (v >= 75) return '#22c55e';
  if (v >= 55) return '#4ade80';
  if (v > 45) return '$color11';
  if (v >= 25) return '#f97316';
  return '#ef4444';
}

function FgGauge({ title, value, label }: { title: string; value: number | null; label: string }): React.JSX.Element {
  const w = value === null ? 0 : Math.max(0, Math.min(100, value));
  const tint = fgColor(value);
  return (
    <YStack gap="$1.5" flex={1} minWidth={130}>
      <SizableText size="$1" color="$color10">
        {title}
      </SizableText>
      <SizableText size="$6" color={tint}>
        {value === null ? '—' : value}
      </SizableText>
      <XStack height={4} borderRadius={999} backgroundColor="rgba(255,255,255,0.10)" overflow="hidden">
        <XStack width={`${w}%`} backgroundColor={tint} />
      </XStack>
      <SizableText size="$1" color="$color9">
        {label}
      </SizableText>
    </YStack>
  );
}

function SectionTitle({ children, sub }: { children: string; sub?: string }): React.JSX.Element {
  return (
    <XStack alignItems="baseline" gap="$2">
      <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
        {children}
      </SizableText>
      {sub ? (
        <SizableText size="$1" color="$color9">
          {sub}
        </SizableText>
      ) : null}
    </XStack>
  );
}

const YIELD_ROW: readonly [string, keyof IndicatorData['yieldCurve']][] = [
  ['3M', 'threeMonth'],
  ['2Y', 'twoYear'],
  ['5Y', 'fiveYear'],
  ['10Y', 'tenYear'],
  ['30Y', 'thirtyYear'],
];

export function TraderDeskPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<IndicatorData | null>(null);
  const [state, setState] = useState<PanelState>('loading');
  const [errorText, setErrorText] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    // The vanilla panel's own data layer, verbatim: fetch /v1/world/indicators.
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/v1/world/indicators');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: IndicatorData = await res.json();
        if (cancelled) return;
        if (json.unavailable) {
          setErrorText('Upstream data unavailable.');
          setState('error');
          return;
        }
        setData(json);
        setErrorText(undefined);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setErrorText(err instanceof Error ? err.message : 'Failed to fetch');
        setState('error');
      }
    };

    void load();
    // Same ~2 min cadence as the vanilla poller.
    const id = window.setInterval(() => void load(), 2 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Trader desk"
      state={state}
      errorText={errorText}
      infoTooltip="The classic trader risk suite from free sources: VIX/VVIX/MOVE, the yield curve (2s10s), crypto + equity fear/greed, index momentum, sector breadth, BTC dominance + perp funding, DXY and metals. Risk-on/off and equity fear/greed are computed upstream. Updates ~2 min."
      actions={<PanelLiveDot />}
    >
      {data ? <TraderDeskBody d={data} /> : null}
    </Panel>
  );
}

function TraderDeskBody({ d }: { d: IndicatorData }): React.JSX.Element {
  const rs = d.riskOnOff;
  const riskTint = rs.score === null ? '$color10' : rs.score >= 20 ? '#22c55e' : rs.score <= -20 ? '#ef4444' : '$color11';
  const riskPct = rs.score === null ? 50 : Math.max(0, Math.min(100, (rs.score + 100) / 2));

  const yc = d.yieldCurve;
  const spreadTint = yc.spread2s10s === null ? '$color10' : yc.spread2s10s < 0 ? '#ef4444' : '#22c55e';

  const vix = d.volatility.vix;
  const vixSub = vix && vix.percentile1y != null ? `${fmt(vix.percentile1y, 0)}%ile 1y` : undefined;

  const b = d.breadth;
  const adRatio = b.advanceDeclineRatio;

  const c = d.crypto;
  const funding = c.fundingRate;

  return (
    <YStack gap="$3">
      {/* ── headline: risk-on/off + fear/greed ── */}
      <XStack gap="$3" flexWrap="wrap">
        <YStack gap="$1.5" flex={1} minWidth={150}>
          <SizableText size="$1" color="$color10">
            Risk-on / off
          </SizableText>
          <SizableText size="$6" color={riskTint}>
            {rs.score === null ? '—' : (rs.score > 0 ? '+' : '') + rs.score}
          </SizableText>
          <XStack height={4} borderRadius={999} backgroundColor="rgba(255,255,255,0.10)" position="relative">
            <XStack
              position="absolute"
              left={`${riskPct}%`}
              top={-2}
              width={8}
              height={8}
              borderRadius={999}
              backgroundColor={riskTint}
            />
          </XStack>
          <SizableText size="$1" color="$color9">
            {rs.label}
          </SizableText>
        </YStack>
        <FgGauge title="Equity fear / greed" value={d.fearGreed.equity.value} label={d.fearGreed.equity.label} />
        <FgGauge title="Crypto fear / greed" value={d.fearGreed.crypto.value} label={d.fearGreed.crypto.label} />
      </XStack>

      {/* ── volatility ── */}
      <YStack gap="$2">
        <SectionTitle>Volatility</SectionTitle>
        <XStack gap="$2" flexWrap="wrap">
          <QuoteTile q={vix} fallback="VIX" sub={vixSub} />
          <QuoteTile q={d.volatility.vvix} fallback="VVIX" />
          <Tile
            name="MOVE"
            value={d.volatility.move && d.volatility.move.price != null ? fmt(d.volatility.move.price) : '—'}
            r1d={d.volatility.move?.r1d ?? null}
            spark={d.volatility.move?.sparkline}
            sub={d.volatility.move?.source === '^MOVE' ? undefined : 'proxy'}
          />
        </XStack>
      </YStack>

      {/* ── yield curve ── */}
      <YStack gap="$2">
        <SectionTitle>Yield curve</SectionTitle>
        <XStack alignItems="center" gap="$2">
          <SizableText size="$1" color="$color10">
            2s10s
          </SizableText>
          <SizableText size="$3" color={spreadTint}>
            {yc.spread2s10s === null ? '—' : signed(yc.spread2s10s, 0, ' bps')}
          </SizableText>
          <SizableText size="$1" color={yc.inverted ? '#ef4444' : '$color9'}>
            {yc.inverted ? 'inverted' : 'normal'}
          </SizableText>
        </XStack>
        <XStack gap="$3" flexWrap="wrap">
          {YIELD_ROW.map(([lbl, key]) => {
            const v = yc[key] as number | null;
            return (
              <XStack key={lbl} gap="$1" alignItems="baseline">
                <SizableText size="$1" color="$color9">
                  {lbl}
                </SizableText>
                <SizableText size="$2" color="$color12">
                  {v === null || v === undefined ? '—' : fmt(v, 2) + '%'}
                </SizableText>
              </XStack>
            );
          })}
        </XStack>
      </YStack>

      {/* ── momentum ── */}
      <YStack gap="$2">
        <SectionTitle>Momentum</SectionTitle>
        <XStack gap="$2" flexWrap="wrap">
          {(d.momentum.indices || []).length ? (
            (d.momentum.indices || []).map((q, i) => (
              <QuoteTile key={q.symbol || i} q={q} fallback={q.symbol || '?'} />
            ))
          ) : (
            <SizableText size="$2" color="$color9">
              —
            </SizableText>
          )}
        </XStack>
      </YStack>

      {/* ── breadth ── */}
      <YStack gap="$2">
        <SectionTitle sub={`${b.advancers}▲ ${b.decliners}▼ · A/D ${adRatio === null ? '—' : fmtPct(adRatio * 100, 0)}`}>
          Breadth
        </SectionTitle>
        <XStack gap="$2" flexWrap="wrap">
          {(b.sectors || []).length ? (
            (b.sectors || []).map((s, i) => {
              const tint = DIR_COLOR[chgClass(s.r1d)];
              return (
                <XStack
                  key={s.symbol || i}
                  gap="$1"
                  alignItems="baseline"
                  paddingHorizontal="$2"
                  paddingVertical="$1"
                  borderRadius="$3"
                  borderWidth={1}
                  borderColor="rgba(255,255,255,0.10)"
                >
                  <SizableText size="$2" color="$color12">
                    {s.symbol || ''}
                  </SizableText>
                  <SizableText size="$1" color={tint}>
                    {signed(s.r1d, 1)}
                  </SizableText>
                </XStack>
              );
            })
          ) : (
            <SizableText size="$2" color="$color9">
              —
            </SizableText>
          )}
        </XStack>
      </YStack>

      {/* ── crypto ── */}
      <YStack gap="$2">
        <SectionTitle>Crypto</SectionTitle>
        <XStack gap="$2" flexWrap="wrap">
          <QuoteTile q={c.btc} fallback="BTC" />
          <Tile
            name="BTC dominance"
            value={c.btcDominance === null ? '—' : fmt(c.btcDominance, 1) + '%'}
            r1d={c.mcapChange24h}
          />
          <Tile
            name="Perp funding"
            value={funding === null ? '—' : fmtPct(funding * 100, 4)}
            r1d={null}
            sub={
              c.fundingAnnualized === null
                ? c.fundingSource
                : `${signed(c.fundingAnnualized, 1)} APR · ${c.fundingSource}`
            }
          />
        </XStack>
      </YStack>

      {/* ── fx + commodities ── */}
      <YStack gap="$2">
        <SectionTitle>FX &amp; commodities</SectionTitle>
        <XStack gap="$2" flexWrap="wrap">
          <QuoteTile q={d.fx.dxy} fallback="DXY" />
          <QuoteTile q={d.commodities.gold} fallback="Gold" />
          <QuoteTile q={d.commodities.oil} fallback="Oil" />
          <QuoteTile q={d.commodities.copper} fallback="Copper" />
        </XStack>
      </YStack>
    </YStack>
  );
}
