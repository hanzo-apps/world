import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { isAuthenticated, login } from '@/services/iam';
import { getInsightsEvents, type InsightsEvent } from '@/services/analytics';
import { fmtInt, fmtAgo } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelSlot } from './PanelGrid';

/**
 * InsightsPanel — the vanilla `InsightsPanel` (src/components/InsightsPanel.ts)
 * ported onto the React Panel chassis. Per-org product analytics over the native
 * insights event stream (api.hanzo.ai /v1/insights/events, PostHog-wire
 * compatible); the org is pinned server-side from the validated bearer's owner
 * claim, so a token only ever reads its own org.
 *
 * View-only port: the data layer is REUSED verbatim — `getInsightsEvents` (the
 * same org-scoped fetcher), `isAuthenticated` / `login` (the same IAM surface),
 * the `fmtInt` / `fmtAgo` formatters, and the vanilla `sparkline()` util (via
 * <Sparkline>). The two client-side derivations (top-events-by-name and the
 * activity trend buckets) are carried over unchanged as pure functions; only the
 * HTML-string output (statTile / shareBar / setContent) is re-expressed in
 * @hanzo/gui longhand primitives against the chassis. Honest: signed-out gets a
 * sign-in CTA, an unavailable org gets an empty state, and an org that has
 * captured nothing yet gets a clean instrument hint — never fabricated numbers.
 */

const LIMIT = 200;
const POLL_MS = 45_000;

/** The discriminated view state — the React analogue of the vanilla panel's
 * signed-out / unavailable / empty / live branches. */
type View =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'unavailable' } // events === null → upstream not available for this account
  | { kind: 'empty' } // captured nothing yet
  | { kind: 'ready'; events: InsightsEvent[] };

/** Top events by name (count desc), the vanilla `topEvents` grouping — carried
 * over verbatim, returning derived rows instead of an HTML string. */
function topEvents(events: InsightsEvent[]): { name: string; count: number; fraction: number }[] {
  const byName = new Map<string, number>();
  for (const e of events) {
    const name = e.event || '(unnamed)';
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }
  const items = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (items.length === 0) return [];
  const max = Math.max(...items.map(([, c]) => c), 1);
  return items.map(([name, count]) => ({ name, count, fraction: count / max }));
}

/** Events-per-bucket counts over the span of the returned events (hour buckets,
 * degrading to day buckets when the span is wide). Empty when < 2 timestamps.
 * The vanilla `trend` bucketing, carried over verbatim. */
function trend(events: InsightsEvent[]): number[] {
  const times = events.map((e) => Date.parse(e.timestamp)).filter((t) => !Number.isNaN(t));
  if (times.length < 2) return [];
  const hour = 3_600_000;
  let step = hour;
  const min = Math.min(...times);
  const max = Math.max(...times);
  if ((max - min) / step > 72) step = 24 * hour; // wide span → day buckets
  const startB = Math.floor(min / step) * step;
  const endB = Math.floor(max / step) * step;
  const n = Math.floor((endB - startB) / step) + 1;
  const counts: number[] = new Array<number>(n).fill(0);
  for (const t of times) {
    const i = Math.floor((Math.floor(t / step) * step - startB) / step);
    counts[i] = (counts[i] ?? 0) + 1;
  }
  return counts;
}

export function InsightsPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      if (!isAuthenticated()) {
        if (!cancelled) setView({ kind: 'signedOut' });
        return;
      }
      const events = await getInsightsEvents(LIMIT);
      if (cancelled) return;
      if (events === null) setView({ kind: 'unavailable' });
      else if (events.length === 0) setView({ kind: 'empty' });
      else setView({ kind: 'ready', events });
    };

    void load();
    // Live surface: the same 45s poll cadence as the vanilla panel.
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Map the view to the chassis' four decomplected states + optional sparkline slot.
  const state: PanelState =
    view.kind === 'loading'
      ? 'loading'
      : view.kind === 'unavailable' || view.kind === 'empty'
        ? 'empty'
        : 'ready';

  const emptyText =
    view.kind === 'unavailable'
      ? 'Insights is not available for this account yet.'
      : view.kind === 'empty'
        ? 'No product events captured yet — instrument @hanzo/insights (PostHog-compatible) and your active users, top events and trend will appear here.'
        : undefined;

  // Derive the live body once (only in the ready branch) so the sparkline slot and
  // the body share one computation.
  const ready = view.kind === 'ready' ? view.events : null;
  const buckets = ready ? trend(ready) : [];
  const showSpark = buckets.length >= 2 && buckets.some((v) => v > 0);

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Insights"
      state={state}
      emptyText={emptyText}
      actions={<PanelLiveDot />}
      sparkline={ready && showSpark ? <InsightsSpark buckets={buckets} events={ready} /> : undefined}
    >
      {view.kind === 'signedOut' ? (
        <SignedIn />
      ) : ready ? (
        <InsightsBody events={ready} />
      ) : null}
    </Panel>
  );
}

/** Signed-out CTA — the vanilla `renderSignedOut` sign-in card, primitive-native. */
function SignedIn(): React.JSX.Element {
  return (
    <YStack gap="$2" paddingVertical="$1">
      <SizableText size="$4" color="$color12">
        Your product insights
      </SizableText>
      <SizableText size="$2" color="$color10">
        Sign in to see your org&apos;s active users, top events and activity trend — scoped to your
        account.
      </SizableText>
      <XStack
        role="button"
        tabIndex={0}
        cursor="pointer"
        alignSelf="flex-start"
        paddingHorizontal="$3"
        paddingVertical="$2"
        borderRadius="$3"
        borderWidth={1}
        borderColor="rgba(255,255,255,0.2)"
        backgroundColor="rgba(255,255,255,0.06)"
        hoverStyle={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
        pressStyle={{ backgroundColor: 'rgba(255,255,255,0.18)' }}
        onPress={() => void login()}
      >
        <SizableText size="$2" color="$color12">
          Sign in
        </SizableText>
      </XStack>
    </YStack>
  );
}

/** The sparkline slot content — label + the vanilla `sparkline()` util via <Sparkline>. */
function InsightsSpark({
  buckets,
  events,
}: {
  buckets: number[];
  events: InsightsEvent[];
}): React.JSX.Element {
  const span = oldestSpan(events);
  return (
    <XStack alignItems="center" justifyContent="space-between" gap="$2">
      <SizableText size="$1" color="$color9">
        events · past {span}
      </SizableText>
      <Sparkline data={buckets} width={220} height={30} />
    </XStack>
  );
}

/** The live body — stat tiles + top events, the vanilla `render()` live branch. */
function InsightsBody({ events }: { events: InsightsEvent[] }): React.JSX.Element {
  const users = new Set(events.map((e) => e.distinctId).filter(Boolean)).size;
  const sessions = new Set(events.map((e) => e.sessionId).filter((s): s is string => !!s)).size;
  const span = oldestSpan(events);
  const top = topEvents(events);

  return (
    <YStack gap="$3">
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <SizableText size="$1" color="$color9">
          your org · last {fmtInt(events.length)} events
        </SizableText>
        <SizableText size="$1" color="$color9">
          past {span}
        </SizableText>
      </XStack>

      <XStack gap="$2">
        <StatTile value={fmtInt(users)} label="active users" sub={`past ${span}`} />
        {sessions > 0 ? <StatTile value={fmtInt(sessions)} label="sessions" /> : null}
        <StatTile value={fmtInt(events.length)} label="events" />
      </XStack>

      {top.length > 0 ? (
        <YStack gap="$1.5">
          <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
            Top events
          </SizableText>
          <YStack gap="$1">
            {top.map((row) => (
              <TopEventRow key={row.name} name={row.name} count={row.count} fraction={row.fraction} />
            ))}
          </YStack>
        </YStack>
      ) : null}
    </YStack>
  );
}

/** A dense stat tile — the primitive-native analogue of the `statTile()` HTML helper. */
function StatTile({ value, label, sub }: { value: string; label: string; sub?: string }): React.JSX.Element {
  return (
    <YStack flex={1} gap="$0.5">
      <SizableText size="$6" color="$color12">
        {value}
      </SizableText>
      <SizableText size="$1" color="$color10">
        {label}
      </SizableText>
      {sub ? (
        <SizableText size="$1" color="$color9">
          {sub}
        </SizableText>
      ) : null}
    </YStack>
  );
}

/** One labelled share bar — the primitive-native analogue of `shareBar()`. */
function TopEventRow({
  name,
  count,
  fraction,
}: {
  name: string;
  count: number;
  fraction: number;
}): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, fraction * 100));
  return (
    <XStack alignItems="center" gap="$2">
      <SizableText size="$2" color="$color11" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
        {name}
      </SizableText>
      <XStack
        width={90}
        height={6}
        borderRadius={999}
        backgroundColor="rgba(255,255,255,0.08)"
        overflow="hidden"
      >
        <XStack width={`${pct}%`} height={6} backgroundColor="rgba(255,255,255,0.55)" />
      </XStack>
      <SizableText size="$2" color="$color12" style={{ minWidth: 44, textAlign: 'right' }}>
        {fmtInt(count)}
      </SizableText>
    </XStack>
  );
}

/** Elapsed-since the oldest event, the vanilla `span` computation via `fmtAgo`. */
function oldestSpan(events: InsightsEvent[]): string {
  const oldest = events.reduce((min, e) => {
    const t = Date.parse(e.timestamp);
    return !Number.isNaN(t) && t < min ? t : min;
  }, Date.now());
  return fmtAgo(new Date(oldest).toISOString());
}
