import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { fetchYahooQuotes } from '@/services/markets';
import { REFRESH_INTERVALS } from '@/config';
import { universeGroups } from '@/config/market-universe';
import { changeDir, absFromPct, type Dir } from '@/utils/market-format';
import { signedPct } from '@/utils/cloud-format';
import type { MarketData } from '@/types';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelSlot } from './PanelGrid';

/**
 * CommoditiesPanel — the vanilla `CommoditiesPanel` (src/components/CommoditiesPanel.ts)
 * ported onto the React Panel chassis. Grouped metals / energy / ags, Bloomberg-dense
 * and strictly monochrome (bright = up, dim = down; never red/green).
 *
 * REUSES the vanilla data + formatting layer verbatim: `fetchYahooQuotes` (the same
 * Yahoo passthrough), the ONE market universe (`universeGroups('commodities')` — a
 * commodity is added/reweighted in exactly one place), and the `changeDir` /
 * `absFromPct` / `signedPct` formatters plus the vanilla `sparkline()` util (via
 * <Sparkline>). No fetch/format logic is re-authored; this file owns only the rows
 * and which chassis state to show. The chassis owns the frame + loading/empty/error.
 */

// Same symbol list the vanilla panel derives, from the same source.
const GROUPS = universeGroups('commodities');

// Flat fetch payload, verbatim shape of the vanilla panel's `ALL`.
const ALL = GROUPS.flatMap((g) => g.items).map((i) => ({
  symbol: i.symbol,
  name: i.name,
  display: i.display ?? i.symbol,
}));

// Trivial terminal-style number format, mirrors the vanilla panel's local fmtNum.
function fmtNum(n: number, digits = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Monochrome tint per direction — the primitive-native analogue of the .up/.down
// CSS classes (bright up, dim down, mid flat). No red/green in this panel.
const DIR_COLOR: Record<Dir, string> = {
  up: '$color12',
  down: '$color9',
  flat: '$color10',
};

export function CommoditiesPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [rows, setRows] = useState<MarketData[]>([]);
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const data = await fetchYahooQuotes(ALL);
        if (cancelled) return;
        setRows(data);
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

  const bySymbol = new Map(rows.map((d) => [d.symbol, d]));
  const anyLive = rows.some((d) => d.price != null);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Commodities & futures"
      state={state}
      errorText="Commodities unavailable."
      actions={anyLive ? <PanelLiveDot /> : null}
    >
      <YStack gap="$3">
        {GROUPS.map((g) => (
          <YStack key={g.label} gap="$1.5">
            <SizableText
              size="$1"
              color="$color9"
              style={{ textTransform: 'uppercase', letterSpacing: 1 }}
            >
              {g.label}
            </SizableText>
            {g.items.map((it) => (
              <CommodityRow key={it.symbol} name={it.name} symbol={it.symbol} quote={bySymbol.get(it.symbol)} />
            ))}
          </YStack>
        ))}
      </YStack>
    </Panel>
  );
}

function CommodityRow({
  name,
  symbol,
  quote,
}: {
  name: string;
  symbol: string;
  quote: MarketData | undefined;
}): React.JSX.Element {
  const na = !quote || quote.price == null;

  // Unavailable → the quiet monochrome "unavailable" line, never fabricated data.
  if (na) {
    return (
      <XStack justifyContent="space-between" alignItems="center" paddingVertical="$1" opacity={0.6}>
        <XStack gap="$2" alignItems="baseline">
          <SizableText size="$3" color="$color11">
            {name}
          </SizableText>
          <SizableText size="$1" color="$color9">
            {symbol}
          </SizableText>
        </XStack>
        <SizableText size="$2" color="$color9">
          unavailable
        </SizableText>
      </XStack>
    );
  }

  const price = quote.price as number;
  const pct = quote.change ?? 0;
  const abs = absFromPct(price, pct);
  const dir = changeDir(quote.change);
  const tint = DIR_COLOR[dir];
  const changeText = `${abs >= 0 ? '+' : ''}${fmtNum(abs)} (${signedPct(pct)})`;

  return (
    <XStack justifyContent="space-between" alignItems="center" paddingVertical="$1">
      <XStack gap="$2" alignItems="baseline">
        <SizableText size="$3" color="$color12">
          {name}
        </SizableText>
        <SizableText size="$1" color="$color9">
          {symbol}
        </SizableText>
      </XStack>
      <XStack gap="$3" alignItems="center">
        <SizableText color={tint} style={{ lineHeight: 0 }}>
          <Sparkline data={quote.sparkline} />
        </SizableText>
        <SizableText size="$3" color="$color12">
          {fmtNum(price)}
        </SizableText>
        <SizableText size="$2" color={tint} style={{ minWidth: 96, textAlign: 'right' }}>
          {changeText}
        </SizableText>
      </XStack>
    </XStack>
  );
}
