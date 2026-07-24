import { useEffect, useRef, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { fetchMarketUniverse, type MarketDatum } from '@/services/market-universe';
import { ASSET_CLASSES, ASSET_CLASS_LABELS } from '@/config/market-universe';
import { formatChange } from '@/utils';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * TradingBubblePanel — the vanilla `TradingBubblePanel` (a D3 circle-pack of the
 * whole market universe) ported onto the React Panel chassis as a VIEW-ONLY port.
 *
 * It REUSES the existing data layer verbatim — the ONE `fetchMarketUniverse`
 * service (Yahoo + CoinGecko joined to the universe metadata, coalesced/cached),
 * the `ASSET_CLASSES` / `ASSET_CLASS_LABELS` universe config, and the shared
 * `formatChange` formatter. No fetch/normalise logic is re-authored here.
 *
 * The vanilla surface's *visualisation* is an imperative D3 pack (radius ∝ weight ×
 * |move|, diverging green→red fill, hover tooltips, live radius/colour tweens) — that
 * SVG engine is inherently place/DOM-bound and does not map to a declarative
 * primitive tree. This port therefore keeps the SAME data and the SAME per-instrument
 * information (name, price, signed %, inverse-aware direction, grouped by asset
 * class) and re-expresses it as chassis rows. The diverging *meaning* is preserved by
 * colouring each row by its inverse-adjusted direction, exactly as the bubble fill /
 * tooltip did. Honest empty/error states; never fabricated data.
 */
export function TradingBubblePanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [rows, setRows] = useState<MarketDatum[]>([]);
  const [state, setState] = useState<PanelState>('loading');
  const haveData = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const data = await fetchMarketUniverse();
        if (cancelled) return;
        setRows(data);
        haveData.current = data.length > 0;
        setState(data.length ? 'ready' : 'empty');
      } catch {
        // Vanilla: showError('Markets unavailable.') when the fetch throws and no
        // prior data. Keep the last-known rows if we already have them.
        if (!cancelled && !haveData.current) setState('error');
      }
    };

    void load();
    // ~30s live cadence, matching the vanilla panel's jittered poll spirit.
    const id = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Group the flat universe by asset class, in canonical display order; only classes
  // with live rows appear (the same rule the vanilla pack's buildRoot uses).
  const groups = ASSET_CLASSES.map((cls) => ({
    cls,
    label: ASSET_CLASS_LABELS[cls],
    items: rows.filter((d) => d.cls === cls),
  })).filter((g) => g.items.length > 0);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Markets Bubble"
      state={state}
      errorText="Markets unavailable."
      actions={
        <XStack alignItems="center" gap="$2">
          <SizableText size="$1" color="$color9">
            {rows.length}
          </SizableText>
          <PanelLiveDot />
        </XStack>
      }
    >
      <YStack gap="$3">
        {groups.map((g) => (
          <YStack key={g.cls} gap="$1">
            <SizableText
              size="$1"
              color="$color9"
              style={{ textTransform: 'uppercase', letterSpacing: 1 }}
            >
              {g.label}
            </SizableText>
            <YStack gap="$0.5">
              {g.items.map((d) => (
                <MarketDatumRow key={d.id} datum={d} />
              ))}
            </YStack>
          </YStack>
        ))}
      </YStack>
    </Panel>
  );
}

// Diverging direction, inverse-aware — the same rule the bubble fill and tooltip use:
// a vol gauge (VIX/MOVE) rising is risk-off, so its move is negated before colouring.
function directionColor(datum: MarketDatum): string {
  const dir = (datum.inverse ? -1 : 1) * (datum.changePct ?? 0);
  if (dir > 0) return '#3ddc84';
  if (dir < 0) return '#ff4d4d';
  return '$color9';
}

// Price with the datum's own decimal precision (the universe metadata), no currency
// symbol — the universe spans indices, FX pairs and yields, so a bare localised number
// is the honest terminal-style render, matching the vanilla tooltip's fmtPrice.
function formatDatumPrice(datum: MarketDatum): string {
  if (datum.price == null) return '—';
  return datum.price.toLocaleString('en-US', {
    minimumFractionDigits: datum.digits,
    maximumFractionDigits: datum.digits,
  });
}

function MarketDatumRow({ datum }: { datum: MarketDatum }): React.JSX.Element {
  const color = directionColor(datum);
  return (
    <XStack justifyContent="space-between" alignItems="center" paddingVertical="$1">
      <SizableText size="$2" color="$color12" numberOfLines={1} style={{ flex: 1 }}>
        {datum.name}
      </SizableText>
      <XStack gap="$3" alignItems="center">
        <SizableText size="$2" color="$color12">
          {formatDatumPrice(datum)}
        </SizableText>
        <SizableText size="$2" color={color} style={{ minWidth: 64, textAlign: 'right' }}>
          {datum.changePct != null ? formatChange(datum.changePct) : '—'}
        </SizableText>
      </XStack>
    </XStack>
  );
}
