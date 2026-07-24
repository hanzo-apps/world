import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { fetchYahooQuotes } from '@/services/markets';
import { REFRESH_INTERVALS } from '@/config';
import type { MarketData } from '@/types';
import { changeDir, absFromPct, type Dir } from '@/utils/market-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelSlot } from './PanelGrid';

/**
 * YieldsPanel — the vanilla `YieldsPanel` (src/components/YieldsPanel.ts, panel key
 * `yields`, "Rates & credit") ported onto the React Panel chassis.
 *
 * It REUSES the existing data + formatting layer verbatim — `fetchYahooQuotes` (the
 * same Yahoo passthrough the vanilla panel is fed by), the `changeDir` / `absFromPct`
 * formatters and the local `normalizeYield` magnitude rule, and the vanilla
 * `sparkline()` util (via <Sparkline>). None of the yield/spread math is re-authored;
 * the port is purely the view, re-expressed in @hanzo/gui longhand primitives against
 * the chassis. The vanilla panel's own HTML builders (`quoteRow` / `groupBlock`) are
 * the view layer being replaced by primitives here — every number they carried is
 * carried through unchanged. The chassis owns the frame + loading/empty/error states.
 */

interface Tenor { symbol: string; name: string; sub: string }
interface Credit { symbol: string; name: string; sub: string; digits: number }

const TENORS: Tenor[] = [
  { symbol: '^IRX', name: '13-week', sub: 'T-bill' },
  { symbol: '2YY=F', name: '2-year', sub: 'futures*' },
  { symbol: '^FVX', name: '5-year', sub: 'note' },
  { symbol: '^TNX', name: '10-year', sub: 'note' },
  { symbol: '^TYX', name: '30-year', sub: 'bond' },
];

const CREDIT: Credit[] = [
  { symbol: 'TLT', name: 'TLT', sub: '20y+ treasuries', digits: 2 },
  { symbol: 'LQD', name: 'LQD', sub: 'IG credit', digits: 2 },
  { symbol: 'HYG', name: 'HYG', sub: 'high yield', digits: 2 },
  { symbol: '^MOVE', name: 'MOVE', sub: 'rate vol', digits: 1 },
];

// CBOE yield indices were once quoted at 10× the yield; real yields (0–20%) never
// reach that magnitude, so a magnitude test normalises either convention. (Verbatim
// from the vanilla panel.)
function normalizeYield(raw: number): number {
  return raw > 20 ? raw / 10 : raw;
}

/** One rendered row's display model — the primitive-native analogue of `quoteRow`'s input. */
interface RowModel {
  name: string;
  sub: string;
  valueText?: string;
  changeText?: string;
  dir: Dir;
  sparkline?: number[];
}

interface ViewModel {
  tenors: RowModel[];
  credit: RowModel[];
  spread?: { label: string; text: string; inverted: boolean };
  invertedNote: boolean;
  footnote: boolean;
}

/** Build the view model — the exact computation the vanilla `fetchData()` performs. */
function buildViewModel(data: MarketData[]): ViewModel {
  const bySymbol = new Map(data.map((d) => [d.symbol, d]));

  const yieldOf = (symbol: string): number | null => {
    const q = bySymbol.get(symbol);
    return q && q.price != null ? normalizeYield(q.price) : null;
  };

  const tenors: RowModel[] = TENORS.map((t) => {
    const q = bySymbol.get(t.symbol);
    if (!q || q.price == null) return { name: t.name, sub: t.sub, dir: 'flat' };
    const y = normalizeYield(q.price);
    const pct = q.change ?? 0;
    const yPrev = normalizeYield(q.price / (1 + pct / 100));
    const dBps = (y - yPrev) * 100;
    return {
      name: t.name,
      sub: t.sub,
      valueText: `${y.toFixed(2)}%`,
      changeText: `${dBps >= 0 ? '+' : ''}${dBps.toFixed(0)}bps`,
      dir: changeDir(q.change),
      sparkline: q.sparkline,
    };
  });

  const credit: RowModel[] = CREDIT.map((c) => {
    const q = bySymbol.get(c.symbol);
    if (!q || q.price == null) return { name: c.name, sub: c.sub, dir: 'flat' };
    const pct = q.change ?? 0;
    const abs = absFromPct(q.price, pct);
    const fmt = (n: number) =>
      n.toLocaleString('en-US', { minimumFractionDigits: c.digits, maximumFractionDigits: c.digits });
    return {
      name: c.name,
      sub: c.sub,
      valueText: fmt(q.price),
      changeText: `${abs >= 0 ? '+' : ''}${fmt(abs)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`,
      dir: changeDir(q.change),
      sparkline: q.sparkline,
    };
  });

  // 2s10s (10y − 2y); fall back to 5s10s (10y − 5y) when the 2y future is absent.
  const y2 = yieldOf('2YY=F');
  const y5 = yieldOf('^FVX');
  const y10 = yieldOf('^TNX');
  const short = y2 ?? y5;
  const shortLabel = y2 != null ? '2s10s' : '5s10s';

  let spread: ViewModel['spread'];
  let invertedNote = false;
  if (short != null && y10 != null) {
    const bps = (y10 - short) * 100;
    const inverted = bps < 0;
    spread = {
      label: `${shortLabel} spread`,
      text: `${bps >= 0 ? '+' : ''}${bps.toFixed(0)}bps`,
      inverted,
    };
    invertedNote = inverted;
  }

  return { tenors, credit, spread, invertedNote, footnote: y2 != null };
}

const UP = '#22c55e';
const DOWN = '#ef4444';

function dirColor(dir: Dir): string {
  return dir === 'up' ? UP : dir === 'down' ? DOWN : '$color9';
}

export function YieldsPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [vm, setVm] = useState<ViewModel | null>(null);
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const items = [...TENORS, ...CREDIT];
      let data: MarketData[];
      try {
        data = await fetchYahooQuotes(items.map((i) => ({ symbol: i.symbol, name: i.name, display: i.symbol })));
      } catch {
        // Mirrors the vanilla catch → "Rates & credit unavailable."
        if (!cancelled) setState('error');
        return;
      }
      if (cancelled) return;
      if (data.length === 0) {
        setVm(null);
        setState('empty');
        return;
      }
      setVm(buildViewModel(data));
      setState('ready');
    };

    void load();
    // Same cadence as the vanilla poller (REFRESH_INTERVALS.markets).
    const id = window.setInterval(() => void load(), REFRESH_INTERVALS.markets);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Rates & credit"
      state={state}
      errorText="Rates & credit unavailable."
      actions={<PanelLiveDot />}
    >
      {vm ? (
        <YStack gap="$3">
          <GroupBlock label="Treasury curve" rows={vm.tenors} />
          {vm.spread ? (
            <XStack justifyContent="space-between" alignItems="center" paddingHorizontal="$1">
              <SizableText size="$2" color="$color10">
                {vm.spread.label}
              </SizableText>
              <SizableText size="$2" color={vm.spread.inverted ? DOWN : UP}>
                {vm.spread.text}
              </SizableText>
            </XStack>
          ) : null}
          {vm.invertedNote ? (
            <SizableText size="$1" color="$color9">
              Curve inverted — 10y below the short leg.
            </SizableText>
          ) : null}
          {vm.footnote ? (
            <SizableText size="$1" color="$color9">
              * 2-year is futures-implied (2YY).
            </SizableText>
          ) : null}
          <GroupBlock label="Credit & rate vol" rows={vm.credit} />
        </YStack>
      ) : null}
    </Panel>
  );
}

function GroupBlock({ label, rows }: { label: string; rows: RowModel[] }): React.JSX.Element {
  return (
    <YStack gap="$1.5">
      <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </SizableText>
      {rows.map((row) => (
        <QuoteRow key={row.name} row={row} />
      ))}
    </YStack>
  );
}

function QuoteRow({ row }: { row: RowModel }): React.JSX.Element {
  const color = dirColor(row.dir);
  return (
    <XStack justifyContent="space-between" alignItems="center" paddingVertical="$1">
      <YStack>
        <SizableText size="$3" color="$color12">
          {row.name}
        </SizableText>
        <SizableText size="$1" color="$color9">
          {row.sub}
        </SizableText>
      </YStack>
      {row.valueText ? (
        <XStack gap="$3" alignItems="center">
          <Sparkline data={row.sparkline} color={row.dir === 'flat' ? undefined : color} />
          <SizableText size="$3" color="$color12">
            {row.valueText}
          </SizableText>
          <SizableText size="$2" color={color} style={{ minWidth: 96, textAlign: 'right' }}>
            {row.changeText ?? ''}
          </SizableText>
        </XStack>
      ) : (
        <SizableText size="$2" color="$color9">
          unavailable
        </SizableText>
      )}
    </XStack>
  );
}
