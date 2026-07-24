import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { getCloudPulse, getMyModels, type CloudPulse, type ServedModel } from '@/services/cloud-pulse';
import { fmtCompact } from '@/utils/cloud-format';
import { Panel, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * ModelUsagePanel — the vanilla `ModelUsagePanel` (src/components/ModelUsagePanel.ts)
 * ported onto the React Panel chassis. Shape: fetch.
 *
 * It REUSES the vanilla data + format layer verbatim — `getCloudPulse()` (the public
 * same-origin /v1/world/cloud-pulse aggregate, demo-flagged) + `getMyModels()` (the
 * caller's real org-scoped /v1/models list), and the `fmtCompact` formatter. No fetch
 * or format logic is re-authored; this file owns only the view + which state to show.
 *
 * The two honest facts the vanilla panel surfaces are preserved unchanged: ranked
 * per-model request bars from the platform aggregate, and the real "N available to
 * you" count with a "yours" tag on rows the org can actually call. Neither is faked —
 * on the volumeModeled fallback we show share alone, never a 0-token line, exactly as
 * the vanilla panel does. The share bar (vanilla `shareBar()` HTML) is re-expressed as
 * a @hanzo/gui track+fill so the port stays primitive-native and longhand-styled.
 */
export function ModelUsagePanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [pulse, setPulse] = useState<CloudPulse | null>(null);
  const [mine, setMine] = useState<ServedModel[] | null>(null);
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const [p, m] = await Promise.all([getCloudPulse(), getMyModels()]);
        if (cancelled) return;
        setPulse(p);
        setMine(m);
        setState('ready');
      } catch {
        // Only surface an error when we have nothing to show (parity with the
        // vanilla panel, which keeps the last-good pulse on a transient failure).
        if (!cancelled) setState((prev) => (prev === 'ready' ? 'ready' : 'error'));
      }
    };

    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!pulse) {
    return (
      <Panel
        ref={slot.ref}
        dragHandle={slot.dragHandle}
        title="Model Usage"
        state={state === 'error' ? 'error' : 'loading'}
        loadingText="Loading model usage…"
      />
    );
  }

  const mineIds = new Set((mine ?? []).map((m) => m.id));
  const max = Math.max(...pulse.models.map((m) => m.requests24h), 1);

  const scope = pulse.overview.modelsServed > 0
    ? `${pulse.overview.modelsServed} models served${pulse.window ? ` · ${pulse.window}` : ''}`
    : 'Model usage';
  const available = mine !== null ? `${mine.length} available to you` : null;
  // Honest source note: warming up (demo) vs measured request mix (volumeModeled)
  // vs fully-measured usage (no note).
  const note = pulse.demo ? 'warming up' : (pulse.volumeModeled ? 'request mix · measured' : null);

  return (
    <Panel ref={slot.ref} dragHandle={slot.dragHandle} title="Model Usage" state="ready">
      <YStack gap="$2">
        <XStack alignItems="center" justifyContent="space-between" gap="$2" flexWrap="wrap">
          <SizableText size="$1" color="$color10" numberOfLines={1}>
            {scope}
          </SizableText>
          <XStack alignItems="center" gap="$2">
            {available ? (
              <SizableText size="$1" color="$color9">
                {available}
              </SizableText>
            ) : null}
            {note ? (
              <SizableText size="$1" color="$color9">
                {note}
              </SizableText>
            ) : null}
          </XStack>
        </XStack>

        {pulse.models.length ? (
          <YStack gap="$2">
            {pulse.models.map((m) => (
              <ModelRow
                key={m.id}
                name={m.name}
                yours={mineIds.has(m.id)}
                requests24h={m.requests24h}
                sub={pulse.volumeModeled
                  ? `${(m.share * 100).toFixed(0)}% of requests`
                  : `${fmtCompact(m.tokens24h)} tokens · ${(m.share * 100).toFixed(0)}% share`}
                fraction={m.requests24h / max}
              />
            ))}
          </YStack>
        ) : (
          <SizableText size="$2" color="$color9" paddingVertical="$1">
            Model mix is warming up — measured usage appears as requests are routed.
          </SizableText>
        )}
      </YStack>
    </Panel>
  );
}

function ModelRow({
  name,
  yours,
  requests24h,
  sub,
  fraction,
}: {
  name: string;
  yours: boolean;
  requests24h: number;
  sub: string;
  fraction: number;
}): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, fraction * 100));
  return (
    <YStack gap="$1">
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <XStack alignItems="center" gap="$1.5" flex={1}>
          <SizableText size="$3" color="$color12" numberOfLines={1}>
            {name}
          </SizableText>
          {yours ? (
            <XStack
              paddingHorizontal="$1.5"
              paddingVertical="$0.5"
              borderRadius="$2"
              backgroundColor="rgba(255,255,255,0.14)"
            >
              <SizableText size="$1" color="$color11">
                yours
              </SizableText>
            </XStack>
          ) : null}
        </XStack>
        <XStack alignItems="baseline" gap="$1">
          <SizableText size="$3" color="$color12">
            {fmtCompact(requests24h)}
          </SizableText>
          <SizableText size="$1" color="$color9">
            req
          </SizableText>
        </XStack>
      </XStack>
      {/* Share bar — the vanilla shareBar() re-expressed as a track + fill. */}
      <XStack height={3} borderRadius={999} backgroundColor="rgba(255,255,255,0.10)" overflow="hidden">
        <XStack width={`${pct.toFixed(1)}%`} backgroundColor="rgba(255,255,255,0.55)" borderRadius={999} />
      </XStack>
      <SizableText size="$1" color="$color9">
        {sub}
      </SizableText>
    </YStack>
  );
}
