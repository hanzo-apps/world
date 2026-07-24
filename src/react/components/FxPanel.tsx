import { useEffect, useMemo, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { fetchYahooQuotes } from '@/services/markets';
import { REFRESH_INTERVALS } from '@/config';
import type { MarketData } from '@/types';
import { changeDir, absFromPct, type Dir } from '@/utils/market-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelSlot } from './PanelGrid';

/**
 * FxPanel — the vanilla `FxPanel` (src/components/FxPanel.ts) ported onto the React
 * Panel chassis. Shape: markets. Like MarketsPanel it REUSES the existing data +
 * formatting layer verbatim — the same `fetchYahooQuotes` Yahoo passthrough, the
 * same `changeDir` / `absFromPct` formatters, and the vanilla `sparkline()` util
 * (via <Sparkline>). No fetch/format logic is re-authored; only the view moves onto
 * @hanzo/gui longhand primitives, with the chassis owning the frame + loading /
 * empty / error states.
 *
 * Strictly monochrome per the FX design canon (bright text for an up move, dim for
 * a down move — never red/green). The regional boards (Asia / EMEA / LATAM) keep
 * their collapse-to-a-count disclosure; the open/closed state is owned by the
 * user's clicks (seeded from each group's default) so the 2-minute refresh never
 * snaps an opened board shut — the same contract the vanilla panel guarantees.
 */

interface FxItem {
  symbol: string;
  name: string;
  sub?: string;
  digits: number;
}
interface FxGroup {
  label: string;
  defaultOpen: boolean;
  items: FxItem[];
}

const GROUPS: FxGroup[] = [
  {
    label: 'Majors',
    defaultOpen: true,
    items: [
      { symbol: 'DX-Y.NYB', name: 'DXY', digits: 2 },
      { symbol: 'EURUSD=X', name: 'EUR/USD', digits: 4 },
      { symbol: 'USDJPY=X', name: 'USD/JPY', digits: 3 },
      { symbol: 'GBPUSD=X', name: 'GBP/USD', digits: 4 },
      { symbol: 'AUDUSD=X', name: 'AUD/USD', digits: 4 },
      { symbol: 'NZDUSD=X', name: 'NZD/USD', digits: 4 },
      { symbol: 'USDCHF=X', name: 'USD/CHF', digits: 4 },
      { symbol: 'USDCAD=X', name: 'USD/CAD', digits: 4 },
    ],
  },
  {
    label: 'Crosses',
    defaultOpen: true,
    items: [
      { symbol: 'EURGBP=X', name: 'EUR/GBP', digits: 4 },
      { symbol: 'EURJPY=X', name: 'EUR/JPY', digits: 3 },
      { symbol: 'EURCHF=X', name: 'EUR/CHF', digits: 4 },
      { symbol: 'GBPJPY=X', name: 'GBP/JPY', digits: 3 },
      { symbol: 'AUDJPY=X', name: 'AUD/JPY', digits: 3 },
    ],
  },
  {
    label: 'Asia',
    defaultOpen: false,
    items: [
      { symbol: 'USDCNH=X', name: 'USD/CNH', sub: 'offshore', digits: 4 },
      { symbol: 'CNY=X', name: 'USD/CNY', digits: 4 },
      { symbol: 'USDINR=X', name: 'USD/INR', digits: 3 },
      { symbol: 'USDKRW=X', name: 'USD/KRW', digits: 2 },
      { symbol: 'USDSGD=X', name: 'USD/SGD', digits: 4 },
      { symbol: 'USDTWD=X', name: 'USD/TWD', digits: 3 },
      { symbol: 'USDTHB=X', name: 'USD/THB', digits: 3 },
      { symbol: 'USDIDR=X', name: 'USD/IDR', digits: 0 },
      { symbol: 'USDPHP=X', name: 'USD/PHP', digits: 3 },
      { symbol: 'USDVND=X', name: 'USD/VND', digits: 0 },
    ],
  },
  {
    label: 'EMEA',
    defaultOpen: false,
    items: [
      { symbol: 'USDTRY=X', name: 'USD/TRY', digits: 3 },
      { symbol: 'USDZAR=X', name: 'USD/ZAR', digits: 4 },
      { symbol: 'USDPLN=X', name: 'USD/PLN', digits: 4 },
      { symbol: 'USDHUF=X', name: 'USD/HUF', digits: 2 },
      { symbol: 'USDCZK=X', name: 'USD/CZK', digits: 3 },
      { symbol: 'USDSEK=X', name: 'USD/SEK', digits: 4 },
      { symbol: 'USDNOK=X', name: 'USD/NOK', digits: 4 },
      { symbol: 'USDDKK=X', name: 'USD/DKK', digits: 4 },
      { symbol: 'USDILS=X', name: 'USD/ILS', digits: 4 },
      { symbol: 'USDAED=X', name: 'USD/AED', sub: 'peg', digits: 4 },
      { symbol: 'USDSAR=X', name: 'USD/SAR', sub: 'peg', digits: 4 },
    ],
  },
  {
    label: 'LATAM',
    defaultOpen: false,
    items: [
      { symbol: 'USDMXN=X', name: 'USD/MXN', digits: 4 },
      { symbol: 'USDBRL=X', name: 'USD/BRL', digits: 4 },
      { symbol: 'USDCLP=X', name: 'USD/CLP', digits: 2 },
      { symbol: 'USDCOP=X', name: 'USD/COP', digits: 2 },
      { symbol: 'USDARS=X', name: 'USD/ARS', digits: 2 },
    ],
  },
];

const ALL: FxItem[] = GROUPS.flatMap((g) => g.items);

// Per-pair decimal precision so every value cell reads like a terminal tape —
// the vanilla panel's `fmt`, verbatim.
function fmt(n: number, digits: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Monochrome dir tint (bright up / dim down / neutral flat) — the FX canon.
const DIR_COLOR: Record<Dir, string> = {
  up: '$color12',
  down: '$color9',
  flat: '$color11',
};

export function FxPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [rows, setRows] = useState<MarketData[]>([]);
  const [state, setState] = useState<PanelState>('loading');
  const [live, setLive] = useState(false);
  // Which groups are expanded — seeded from each group's default, then owned by the
  // user's disclosure clicks so a refresh never snaps an opened board shut.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(GROUPS.filter((g) => g.defaultOpen).map((g) => g.label)),
  );

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const data = await fetchYahooQuotes(
          ALL.map((i) => ({ symbol: i.symbol, name: i.name, display: i.symbol })),
        );
        if (cancelled) return;
        setRows(data);
        setLive(data.some((d) => d.price != null));
        setState(data.length === 0 ? 'empty' : 'ready');
      } catch {
        if (!cancelled) setState('error');
      }
    };

    void load();
    const id = window.setInterval(() => void load(), REFRESH_INTERVALS.markets);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const bySymbol = useMemo(() => new Map(rows.map((d) => [d.symbol, d])), [rows]);

  const toggle = (label: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="FX & currencies"
      state={state}
      errorText="FX unavailable."
      actions={live ? <PanelLiveDot /> : undefined}
    >
      <YStack gap="$2">
        {GROUPS.map((g) => {
          const open = expanded.has(g.label);
          return (
            <YStack key={g.label} gap="$1">
              <XStack
                role="button"
                tabIndex={0}
                cursor="pointer"
                alignItems="center"
                gap="$1.5"
                paddingVertical="$1"
                onPress={() => toggle(g.label)}
                hoverStyle={{ opacity: 0.85 }}
              >
                <SizableText size="$1" color="$color9" style={{ width: 10 }}>
                  {open ? '▾' : '▸'}
                </SizableText>
                <SizableText
                  size="$1"
                  color="$color10"
                  style={{ textTransform: 'uppercase', letterSpacing: 1 }}
                >
                  {g.label}
                </SizableText>
                <SizableText size="$1" color="$color8">
                  {g.items.length}
                </SizableText>
              </XStack>
              {open ? (
                <YStack gap="$1">
                  {g.items.map((it) => (
                    <FxRow key={it.symbol} item={it} q={bySymbol.get(it.symbol)} />
                  ))}
                </YStack>
              ) : null}
            </YStack>
          );
        })}
      </YStack>
    </Panel>
  );
}

function FxRow({ item, q }: { item: FxItem; q: MarketData | undefined }): React.JSX.Element {
  const name = (
    <XStack alignItems="baseline" gap="$1.5">
      <SizableText size="$3" color="$color12">
        {item.name}
      </SizableText>
      {item.sub ? (
        <SizableText size="$1" color="$color9">
          {item.sub}
        </SizableText>
      ) : null}
    </XStack>
  );

  if (!q || q.price == null) {
    return (
      <XStack justifyContent="space-between" alignItems="center" paddingVertical="$0.5">
        {name}
        <SizableText size="$1" color="$color8">
          unavailable
        </SizableText>
      </XStack>
    );
  }

  const pct = q.change ?? 0;
  const abs = absFromPct(q.price, pct);
  const dir = changeDir(q.change);
  const color = DIR_COLOR[dir];
  const changeText = `${abs >= 0 ? '+' : ''}${fmt(abs, item.digits)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;

  return (
    <XStack justifyContent="space-between" alignItems="center" paddingVertical="$0.5">
      {name}
      <XStack gap="$2.5" alignItems="center">
        <Sparkline data={q.sparkline} color={color} />
        <SizableText size="$3" color="$color12" style={{ minWidth: 68, textAlign: 'right' }}>
          {fmt(q.price, item.digits)}
        </SizableText>
        <SizableText size="$1" color={color} style={{ minWidth: 96, textAlign: 'right' }}>
          {changeText}
        </SizableText>
      </XStack>
    </XStack>
  );
}
