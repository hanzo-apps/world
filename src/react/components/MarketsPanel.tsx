import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { fetchMultipleStocks } from '@/services/markets';
import { MARKET_SYMBOLS } from '@/config';
import { formatPrice, formatChange } from '@/utils';
import type { MarketData } from '@/types';
import { PanelCard } from './PanelCard';

/**
 * MarketsPanel — the vanilla `MarketPanel` (markets) ported to React as proof the
 * panel pattern moves cleanly onto @hanzo/gui.
 *
 * It REUSES the existing data + formatting layer verbatim — `fetchMultipleStocks`
 * (the same Finnhub/Yahoo service the vanilla panel is fed by, streaming partial
 * batches via `onBatch`) and `formatPrice` / `formatChange` — and only re-expresses
 * the row markup with Tamagui primitives. No data logic is rewritten; the port is
 * purely the view.
 */
export function MarketsPanel(): React.JSX.Element {
  const [rows, setRows] = useState<MarketData[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const result = await fetchMultipleStocks(MARKET_SYMBOLS, {
          onBatch: (partial) => {
            if (!cancelled) setRows([...partial]);
          },
        });
        if (cancelled) return;
        setRows(result.data);
        if (result.data.length === 0) {
          setError(
            result.skipped
              ? 'FINNHUB_API_KEY not configured — add in Settings'
              : 'Market data unavailable',
          );
        } else {
          setError(null);
        }
      } catch {
        if (!cancelled) setError('Market data unavailable');
      }
    };

    void load();
    // Live surface: refresh on the same cadence spirit as the vanilla poller.
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <PanelCard title="Markets">
      {error && rows.length === 0 ? (
        <SizableText size="$2" color="$color9">
          {error}
        </SizableText>
      ) : rows.length === 0 ? (
        <SizableText size="$2" color="$color9">
          Loading…
        </SizableText>
      ) : (
        <YStack gap="$1.5">
          {rows.map((stock) => (
            <MarketRow key={stock.symbol} stock={stock} />
          ))}
        </YStack>
      )}
    </PanelCard>
  );
}

function MarketRow({ stock }: { stock: MarketData }): React.JSX.Element {
  const change = stock.change ?? 0;
  const changeColor = change >= 0 ? '#22c55e' : '#ef4444';
  return (
    <XStack jc="space-between" ai="center" py="$1">
      <YStack>
        <SizableText size="$3" color="$color12">
          {stock.name}
        </SizableText>
        <SizableText size="$1" color="$color9">
          {stock.display}
        </SizableText>
      </YStack>
      <XStack gap="$3" ai="center">
        <SizableText size="$3" color="$color12">
          {stock.price != null ? formatPrice(stock.price) : '—'}
        </SizableText>
        <SizableText size="$2" color={changeColor} style={{ minWidth: 64, textAlign: 'right' }}>
          {stock.change != null ? formatChange(stock.change) : '—'}
        </SizableText>
      </XStack>
    </XStack>
  );
}
