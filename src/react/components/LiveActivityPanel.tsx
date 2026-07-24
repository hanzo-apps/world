import { useEffect, useRef, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { getCloudPulse, type CloudPulse } from '@/services/cloud-pulse';
import { fmtCompact, fmtInt } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelSlot } from './PanelGrid';

/**
 * LiveActivityPanel — the vanilla `LiveActivityPanel` (src/components/LiveActivityPanel.ts)
 * ported onto the React Panel chassis. shape=markets, so the rolling request-rate
 * series draws into the chassis `sparkline` slot.
 *
 * It REUSES the vanilla data + formatting layer verbatim — `getCloudPulse` (the same
 * same-origin /v1/world/cloud-pulse poller), `fmtInt` / `fmtCompact`, and the vanilla
 * sparkline util (via <Sparkline>). No fetch/format logic is re-authored; the port is
 * purely the view. The chassis owns the frame + loading/error states; this file owns
 * only the rows and which state to show.
 *
 * Honesty contract carried over unchanged: the client-side rolling buffer only ever
 * records a REAL rate (never a demo/warming pulse), the headline shows a measured rate
 * or an honest "—", and the live dot lights only when the number is the exact measured
 * ledger volume (`!demo && !volumeModeled`).
 *
 * Note on escapeHtml: the vanilla panel used it only to sanitize into an innerHTML
 * string. JSX escapes text nodes natively, so it is intentionally dropped here — using
 * it would double-escape region names / source strings.
 */
export function LiveActivityPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [pulse, setPulse] = useState<CloudPulse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Client-side rolling buffer of measured requests/sec, so the number + sparkline
  // visibly move each poll. Persisted across polls in a ref (the vanilla instance field).
  const bufferRef = useRef<number[]>([]);
  const [buffer, setBuffer] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    const BUF = 60;

    const load = async (): Promise<void> => {
      try {
        const p = await getCloudPulse();
        if (cancelled) return;
        setPulse(p);
        setError(null);
        // Only buffer a REAL rate — an empty/warming pulse must not seed the ticker
        // with fabricated-looking zeros.
        if (!p.demo) {
          const next = [...bufferRef.current, p.overview.requestsPerSec];
          if (next.length > BUF) next.shift();
          bufferRef.current = next;
          setBuffer(next);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'failed');
      }
    };

    void load();
    // Same 5s poll cadence as the vanilla panel.
    const id = window.setInterval(() => void load(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // State machine mirrors the vanilla render() head: no pulse + error → error;
  // no pulse yet → loading ("Connecting…"); otherwise ready.
  const state: PanelState = !pulse ? (error ? 'error' : 'loading') : 'ready';

  // Live only when the rate is the exact MEASURED ledger volume.
  const live = !!pulse && !pulse.demo && !pulse.volumeModeled;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Live Activity"
      state={state}
      loadingText="Connecting…"
      errorText={error ?? undefined}
      actions={live ? <PanelLiveDot /> : <XStack width={6} height={6} />}
      sparkline={buffer.length >= 2 ? <Sparkline data={buffer} width={240} height={34} /> : undefined}
    >
      {pulse ? <LiveActivityBody pulse={pulse} live={live} /> : null}
    </Panel>
  );
}

function LiveActivityBody({ pulse, live }: { pulse: CloudPulse; live: boolean }): React.JSX.Element {
  const p = pulse;
  // Headline shows a real rate or an honest "—" (never a fabricated 0).
  const big = p.demo ? '—' : fmtInt(p.overview.requestsPerSec);

  // Region breakdown = REAL fleet-by-region node counts. No measured per-region rate is
  // ever invented; an empty region set hides the section instead of showing zeros.
  const topRegions = p.regions
    .slice()
    .sort((a, b) => b.nodes - a.nodes)
    .slice(0, 5);
  const maxR = Math.max(...topRegions.map((r) => r.nodes), 1);

  const scope = p.demo
    ? 'warming up'
    : `${fmtCompact(p.overview.requests24h)} requests · ${p.window}`;
  const note = live ? `live · ${p.source}` : p.demo ? '' : `measured · ${p.source}`;

  return (
    <YStack gap="$2.5">
      <XStack alignItems="flex-end" gap="$2">
        <SizableText size="$9" color="$color12" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {big}
        </SizableText>
        <SizableText size="$2" color="$color9" paddingBottom="$1">
          requests / sec
        </SizableText>
      </XStack>

      {topRegions.length > 0 ? (
        <YStack gap="$1.5">
          {topRegions.map((r) => (
            <XStack key={r.id} alignItems="center" gap="$2">
              <SizableText size="$2" color="$color11" style={{ flexBasis: 96, flexShrink: 0 }} numberOfLines={1}>
                {r.name}
              </SizableText>
              <XStack flex={1} height={6} borderRadius={999} backgroundColor="rgba(255,255,255,0.08)" overflow="hidden">
                <XStack
                  width={`${((r.nodes / maxR) * 100).toFixed(0)}%`}
                  height={6}
                  backgroundColor="rgba(255,255,255,0.55)"
                />
              </XStack>
              <SizableText size="$1" color="$color9" style={{ flexBasis: 72, flexShrink: 0, textAlign: 'right' }}>
                {fmtInt(r.nodes)} nodes
              </SizableText>
            </XStack>
          ))}
        </YStack>
      ) : null}

      <XStack justifyContent="space-between" alignItems="center">
        <SizableText size="$1" color="$color9">
          {scope}
        </SizableText>
        {note ? (
          <SizableText size="$1" color="$color9">
            {note}
          </SizableText>
        ) : null}
      </XStack>
    </YStack>
  );
}
