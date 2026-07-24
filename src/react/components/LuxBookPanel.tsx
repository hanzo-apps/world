import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { REFRESH_INTERVALS } from '@/config';
import { fetchRotation, computeBook, type BookPosition, type Stance } from '@/services/rotation';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * LuxBookPanel — the vanilla `LuxBookPanel` (src/components/LuxBookPanel.ts) ported
 * onto the React Panel chassis. Shape: fetch.
 *
 * It REUSES the data layer verbatim — `fetchRotation` + the pure `computeBook`
 * (both from @/services/rotation), the same rotation snapshot the vanilla panel is
 * fed by. No fetch/allocation logic is re-authored; conviction, normalisation and
 * stance all live in `computeBook`. This file owns only the view: which of the four
 * chassis states to show, and the rows/narrative/footer expressed in @hanzo/gui
 * longhand primitives. Like the vanilla panel it also emits the ranked positions on
 * `document` as `lux-book` so the globe layer can plot the bets over their hubs —
 * one source of bets, preserved across the port.
 */

// View helpers (display-only — the data lives in computeBook). Kept local to the
// view, mirroring the vanilla panel's own STANCE maps + sign/dir formatting.
const STANCE_COLOR: Record<Stance, string> = {
  accumulate: '#4aa3ff',
  core: '#35d07f',
  trim: '#f5a623',
  avoid: '#ff5d5d',
};
const STANCE_LABEL: Record<Stance, string> = {
  accumulate: 'Accumulate',
  core: 'Core',
  trim: 'Trim',
  avoid: 'Avoid',
};
const FLAT = '#8a8a8a';
const UP = '#35d07f';
const DOWN = '#ff5d5d';

function sign(v: number, d = 1): string {
  if (v == null || !isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
}
function dirColor(v: number): string {
  return Math.abs(v) < 0.05 ? FLAT : v > 0 ? UP : DOWN;
}

const INFO_TOOLTIP =
  'The fund’s model allocation, derived live from the rotation engine and rebalanced every refresh. ' +
  'Conviction weights the quadrant (accumulate Improving, hold Leading, trim Weakening, avoid Lagging) ' +
  'plus a momentum tilt and an oversold-base bonus, normalised to a 100% book. ' +
  'Model output for research, not investment advice.';

export function LuxBookPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [book, setBook] = useState<BookPosition[]>([]);
  const [narrative, setNarrative] = useState<string>('');
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      try {
        const snap = await fetchRotation(controller.signal);
        if (cancelled || controller.signal.aborted) return;
        if (!snap || snap.unavailable) {
          setBook([]);
          setNarrative('');
          setState('empty');
          return;
        }
        const positions = computeBook(snap, 10);
        // Hand the positions to the globe layer (and anyone else) — one source of bets.
        document.dispatchEvent(
          new CustomEvent('lux-book', { detail: { positions, asOf: snap.asOf } }),
        );
        setBook(positions);
        setNarrative(snap.narrative);
        setState(positions.length ? 'ready' : 'empty');
      } catch {
        if (!cancelled) setState('error');
      }
    };

    void load();
    // Live surface: rebalance on the same cadence as the vanilla poller.
    const id = window.setInterval(() => void load(), REFRESH_INTERVALS.markets);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(id);
    };
  }, []);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Lux Book · Top 10"
      state={state}
      emptyText="Book unavailable."
      infoTooltip={INFO_TOOLTIP}
      actions={<PanelLiveDot />}
    >
      <YStack gap="$1">
        <XStack alignItems="center" paddingBottom="$1">
          <SizableText size="$1" color="$color9" width={18}>
            #
          </SizableText>
          <SizableText size="$1" color="$color9" flex={1}>
            Bucket
          </SizableText>
          <SizableText size="$1" color="$color9" width={96} textAlign="right">
            Weight
          </SizableText>
          <SizableText size="$1" color="$color9" width={64} textAlign="right">
            Stance
          </SizableText>
          <SizableText size="$1" color="$color9" width={48} textAlign="right">
            Δmom
          </SizableText>
          <SizableText size="$1" color="$color9" width={48} textAlign="right">
            3mo
          </SizableText>
        </XStack>

        {book.map((p, i) => (
          <BookRow key={p.key} p={p} rank={i + 1} />
        ))}

        {narrative ? (
          <SizableText size="$1" color="$color10" paddingTop="$2">
            {narrative}
          </SizableText>
        ) : null}
        <SizableText size="$1" color="$color8" paddingTop="$1">
          Model allocation · rebalances with the rotation read · not investment advice
        </SizableText>
      </YStack>
    </Panel>
  );
}

function BookRow({ p, rank }: { p: BookPosition; rank: number }): React.JSX.Element {
  const sc = STANCE_COLOR[p.stance];
  const barWidth = Math.min(100, p.weight * 2.4);
  return (
    <XStack alignItems="center" paddingVertical="$1">
      <SizableText size="$2" color="$color9" width={18}>
        {rank}
      </SizableText>
      <YStack flex={1}>
        <SizableText size="$2" color="$color12">
          {p.label}
        </SizableText>
        <SizableText size="$1" color="$color9">
          {p.anchor.label}
        </SizableText>
      </YStack>
      <XStack width={96} alignItems="center" justifyContent="flex-end" gap="$1.5">
        <XStack
          width={40}
          height={4}
          borderRadius={999}
          backgroundColor="rgba(255,255,255,0.10)"
          overflow="hidden"
        >
          <XStack height={4} width={`${barWidth}%`} backgroundColor={sc} />
        </XStack>
        <SizableText size="$1" color="$color11" width={40} textAlign="right">
          {p.weight.toFixed(1)}%
        </SizableText>
      </XStack>
      <SizableText size="$2" color={sc} width={64} textAlign="right">
        {STANCE_LABEL[p.stance]}
      </SizableText>
      <SizableText size="$2" color={dirColor(p.momentumDelta)} width={48} textAlign="right">
        {sign(p.momentumDelta)}
      </SizableText>
      <SizableText size="$2" color={dirColor(p.ret63)} width={48} textAlign="right">
        {sign(p.ret63)}%
      </SizableText>
    </XStack>
  );
}
