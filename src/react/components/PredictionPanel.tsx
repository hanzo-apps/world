import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { fetchPredictions } from '@/services/polymarket';
import { REFRESH_INTERVALS } from '@/config';
import { sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import type { PredictionMarket } from '@/types';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * PredictionPanel — the vanilla `PredictionPanel` (src/components/PredictionPanel.ts)
 * ported onto the React Panel chassis. Shape: other (a yes/no probability bar list,
 * not a markets sparkline row).
 *
 * It REUSES the existing data + formatting layer verbatim — `fetchPredictions`
 * (the same Polymarket Gamma service, with its circuit breaker, per-tag event
 * dedup via the `seen` set, volume-threshold + signal filtering, and volume sort
 * all owned by the service), `sanitizeUrl` for link safety, and the `t` i18n keys
 * the vanilla panel already used (`panels.polymarket`, `components.prediction.*`,
 * `components.predictions.*`). No fetch/format/dedup logic is re-authored; only the
 * view moves onto @hanzo/gui longhand primitives. The chassis owns the frame + the
 * loading / empty / error states; this file owns only the rows and which state.
 *
 * `formatVolume` is carried over verbatim from the vanilla panel — it is that
 * panel's own display formatter (view logic, not data logic).
 */
export function PredictionPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [rows, setRows] = useState<PredictionMarket[]>([]);
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const predictions = await fetchPredictions();
        if (cancelled) return;
        setRows(predictions);
        setState(predictions.length === 0 ? 'empty' : 'ready');
      } catch {
        if (!cancelled) setState('error');
      }
    };

    void load();
    // Live surface: same 5-minute cadence as the vanilla predictions poller.
    const id = window.setInterval(() => void load(), REFRESH_INTERVALS.predictions);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title={t('panels.polymarket')}
      infoTooltip={t('components.prediction.infoTooltip')}
      state={state}
      errorText={t('common.failedPredictions')}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$1">
        {rows.map((p, i) => (
          <PredictionRow key={`${p.title}:${i}`} market={p} />
        ))}
      </YStack>
    </Panel>
  );
}

/** Vanilla `formatVolume`, verbatim. */
function formatVolume(volume?: number): string {
  if (!volume) return '';
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
  return `$${volume.toFixed(0)}`;
}

function PredictionRow({ market }: { market: PredictionMarket }): React.JSX.Element {
  const yesPercent = Math.round(market.yesPrice);
  const noPercent = 100 - yesPercent;
  const volumeStr = formatVolume(market.volume);
  const safeUrl = market.url ? sanitizeUrl(market.url) : '';

  const Title = (
    <SizableText size="$2" color="$color12" numberOfLines={2} style={{ lineHeight: 15 }}>
      {market.title}
    </SizableText>
  );

  return (
    <YStack gap="$1.5" paddingVertical="$1.5" borderBottomWidth={1} borderColor="rgba(255,255,255,0.06)">
      {safeUrl ? (
        <a href={safeUrl} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>
          {Title}
        </a>
      ) : (
        Title
      )}
      {volumeStr ? (
        <SizableText size="$1" color="$color9">
          {t('components.predictions.vol')}: {volumeStr}
        </SizableText>
      ) : null}
      <XStack height={24} borderRadius="$2" overflow="hidden" backgroundColor="rgba(255,255,255,0.10)">
        <XStack
          width={`${yesPercent}%`}
          minWidth={40}
          alignItems="center"
          justifyContent="center"
          backgroundColor="#22c55e"
        >
          <PredictionLabel text={`${t('components.predictions.yes')} ${yesPercent}%`} />
        </XStack>
        <XStack
          width={`${noPercent}%`}
          minWidth={40}
          alignItems="center"
          justifyContent="center"
          backgroundColor="#ef4444"
        >
          <PredictionLabel text={`${t('components.predictions.no')} ${noPercent}%`} />
        </XStack>
      </XStack>
    </YStack>
  );
}

function PredictionLabel({ text }: { text: string }): React.JSX.Element {
  return (
    <SizableText
      size="$1"
      color="#0c0c0e"
      numberOfLines={1}
      style={{ fontWeight: 600, paddingLeft: 4, paddingRight: 4 }}
    >
      {text}
    </SizableText>
  );
}
