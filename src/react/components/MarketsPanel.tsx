import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { fetchMultipleStocks } from '@/services/markets';
import { MARKET_SYMBOLS } from '@/config';
import { formatPrice, formatChange } from '@/utils';
import type { MarketData } from '@/types';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelSlot } from './PanelGrid';

/**
 * MarketsPanel — the vanilla `MarketPanel` ported onto the React Panel chassis, the
 * proof that the panel pattern moves cleanly onto @hanzo/gui and through PanelGrid.
 *
 * It REUSES the existing data + formatting layer verbatim — `fetchMultipleStocks`
 * (the same Finnhub/Yahoo service the vanilla panel is fed by, streaming partial
 * batches via `onBatch`), `formatPrice` / `formatChange`, and the vanilla
 * `sparkline()` util (via <Sparkline>). No data logic is re-authored; the port is
 * purely the view, expressed in @hanzo/gui longhand primitives against the chassis.
 * The chassis owns the frame + the loading / empty / error states; this file owns
 * only the rows and which state to show.
 */
export function MarketsPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [rows, setRows] = useState<MarketData[]>([]);
  const [state, setState] = useState<PanelState>('loading');
  const [emptyText, setEmptyText] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const result = await fetchMultipleStocks(MARKET_SYMBOLS, {
          onBatch: (partial) => {
            if (cancelled) return;
            setRows([...partial]);
            if (partial.length) setState('ready');
          },
        });
        if (cancelled) return;
        setRows(result.data);
        if (result.data.length === 0) {
          setEmptyText(
            result.skipped ? 'FINNHUB_API_KEY not configured — add in Settings' : undefined,
          );
          setState('empty');
        } else {
          setState('ready');
        }
      } catch {
        if (!cancelled) setState('error');
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
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Markets"
      state={state}
      emptyText={emptyText}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$1.5">
        {rows.map((stock) => (
          <MarketRow key={stock.symbol} stock={stock} />
        ))}
      </YStack>
    </Panel>
  );
}

function MarketRow({ stock }: { stock: MarketData }): React.JSX.Element {
  const change = stock.change ?? 0;
  const changeColor = change >= 0 ? '#22c55e' : '#ef4444';
  return (
    <XStack justifyContent="space-between" alignItems="center" paddingVertical="$1">
      <YStack>
        <SizableText size="$3" color="$color12">
          {stock.name}
        </SizableText>
        <SizableText size="$1" color="$color9">
          {stock.display}
        </SizableText>
      </YStack>
      <XStack gap="$3" alignItems="center">
        <Sparkline data={stock.sparkline} color={changeColor} />
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
