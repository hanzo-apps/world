import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { isAuthenticated, login } from '@/services/iam';
import {
  getAnalyticsOverview,
  getAnalyticsTimeseries,
  getAnalyticsTop,
  type AnalyticsOverview,
  type AnalyticsTimeseries,
  type AnalyticsTop,
} from '@/services/analytics';
import { fmtCompact, fmtInt, fmtPct, fmtUsd } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelSlot } from './PanelGrid';

/**
 * OrgAnalyticsPanel — the vanilla `OrgAnalyticsPanel` (src/components/OrgAnalyticsPanel.ts)
 * ported onto the React Panel chassis. Per-org web/event analytics over the native
 * analytics warehouse (api.hanzo.ai /v1/analytics/*); the org is pinned server-side
 * from the validated bearer's owner claim, so a token only ever reads its own org.
 *
 * View-only port: the data layer is REUSED verbatim — `getAnalyticsOverview` /
 * `getAnalyticsTimeseries` / `getAnalyticsTop` (the same org-scoped fetchers),
 * `isAuthenticated` / `login` (the same IAM surface), the
 * `fmtCompact/fmtInt/fmtPct/fmtUsd` formatters, and the vanilla `sparkline()` util
 * (via <Sparkline>). No fetch or number logic is re-authored; only the HTML-string
 * output (statTile / shareBar / setContent) is re-expressed in @hanzo/gui longhand
 * primitives against the chassis. Honest states throughout: signed-out gets a
 * sign-in CTA, an unavailable account gets an empty state, and an org with no usage
 * in the window gets a clean honest-empty line — never fabricated numbers.
 *
 * The chassis owns the frame + loading/empty/error states + the sparkline slot;
 * this file owns only which state to show and the rows.
 */

const RANGE = '7d';
const POLL_MS = 60_000;

/** The discriminated view state — the React analogue of the vanilla panel's
 * signed-out / unavailable / honest-empty / live branches. */
type View =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'unavailable' } // overview === null → not available for this account
  | { kind: 'empty'; win: string } // warehouse answered but no usage/events in window
  | {
      kind: 'ready';
      overview: AnalyticsOverview;
      series: AnalyticsTimeseries | null;
      top: AnalyticsTop | null;
    };

export function OrgAnalyticsPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      if (!isAuthenticated()) {
        if (!cancelled) setView({ kind: 'signedOut' });
        return;
      }
      const [overview, series, top] = await Promise.all([
        getAnalyticsOverview(RANGE),
        getAnalyticsTimeseries(RANGE),
        getAnalyticsTop(RANGE),
      ]);
      if (cancelled) return;
      if (!overview) {
        setView({ kind: 'unavailable' });
        return;
      }
      const win = overview.range || RANGE;
      const hasLLM = overview.llm.requests > 0;
      const hasWeb =
        overview.web.available &&
        (overview.web.pageviews > 0 || overview.web.visitors > 0 || overview.web.sessions > 0);
      if (!hasLLM && !hasWeb) {
        setView({ kind: 'empty', win });
        return;
      }
      setView({ kind: 'ready', overview, series, top });
    };

    void load();
    // Live surface: the same 60s poll cadence as the vanilla panel.
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Map the view to the chassis' four decomplected states.
  const state: PanelState =
    view.kind === 'loading'
      ? 'loading'
      : view.kind === 'unavailable' || view.kind === 'empty'
        ? 'empty'
        : 'ready';

  const emptyText =
    view.kind === 'unavailable'
      ? 'Analytics is not available for this account yet.'
      : view.kind === 'empty'
        ? `No requests or site events in the last ${view.win} yet — your org's API usage and web analytics will appear here.`
        : undefined;

  // The requests trend from the gap-filled series — only a real, non-flat line.
  const reqSeries =
    view.kind === 'ready' ? (view.series?.series ?? []).map((p) => p.requests) : [];
  const showSpark = reqSeries.length >= 2 && reqSeries.some((v) => v > 0);
  const win = view.kind === 'ready' ? view.overview.range || RANGE : RANGE;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Analytics"
      state={state}
      emptyText={emptyText}
      actions={<PanelLiveDot />}
      sparkline={
        view.kind === 'ready' && showSpark ? (
          <XStack alignItems="center" justifyContent="space-between" gap="$2">
            <SizableText size="$1" color="$color9">
              requests · {win}
            </SizableText>
            <Sparkline data={reqSeries} width={220} height={30} />
          </XStack>
        ) : undefined
      }
      width={520}
    >
      {view.kind === 'signedOut' ? (
        <SignedOut />
      ) : view.kind === 'ready' ? (
        <AnalyticsBody overview={view.overview} top={view.top} win={win} />
      ) : null}
    </Panel>
  );
}

/** Signed-out CTA — the vanilla `renderSignedOut` sign-in card, primitive-native. */
function SignedOut(): React.JSX.Element {
  return (
    <YStack gap="$2" paddingVertical="$1">
      <SizableText size="$4" color="$color12">
        Your analytics
      </SizableText>
      <SizableText size="$2" color="$color10">
        Sign in to see your org&apos;s real requests, visitors and top models — scoped to your
        account, no shared keys.
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

/** The live body — scope line + stat tiles + top models, the vanilla `render()`
 * live branch, re-expressed in @hanzo/gui primitives. */
function AnalyticsBody({
  overview,
  top,
  win,
}: {
  overview: AnalyticsOverview;
  top: AnalyticsTop | null;
  win: string;
}): React.JSX.Element {
  const o = overview;
  const hasLLM = o.llm.requests > 0;
  const hasWeb = o.web.available && (o.web.pageviews > 0 || o.web.visitors > 0 || o.web.sessions > 0);

  // Tiles: only real, measured values (the vanilla tile-assembly, verbatim conditions).
  const tiles: { value: string; label: string; sub?: string }[] = [
    hasLLM ? { value: fmtCompact(o.llm.requests), label: `requests · ${win}` } : null,
    hasWeb ? { value: fmtCompact(o.web.visitors), label: `visitors · ${win}` } : null,
    hasWeb && o.web.pageviews > 0
      ? { value: fmtCompact(o.web.pageviews), label: `pageviews · ${win}` }
      : null,
    o.llm.tokens > 0 ? { value: fmtCompact(o.llm.tokens), label: `tokens · ${win}` } : null,
    o.llm.spendCents > 0 ? { value: fmtUsd(o.llm.spendCents), label: `spend · ${win}` } : null,
    hasLLM
      ? {
          value: fmtPct(o.llm.errorRate * 100, 1),
          label: 'error rate',
          sub: o.llm.models > 0 ? `${fmtInt(o.llm.models)} models` : undefined,
        }
      : null,
  ].filter((t): t is { value: string; label: string; sub?: string } => t !== null);

  const models = top?.models;
  const topModels =
    models && models.available && models.items.length > 0 ? models.items : [];

  return (
    <YStack gap="$3">
      <SizableText size="$1" color="$color9">
        your org · {win}
      </SizableText>

      <XStack flexWrap="wrap" gap="$2">
        {tiles.map((tile) => (
          <StatTile key={tile.label} value={tile.value} label={tile.label} sub={tile.sub} />
        ))}
      </XStack>

      {topModels.length > 0 ? (
        <YStack gap="$1.5">
          <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
            Top models · {win}
          </SizableText>
          <YStack gap="$2">
            {topModels.map((m) => {
              const sub = [
                m.tokens > 0 ? `${fmtCompact(m.tokens)} tokens` : '',
                m.spendCents > 0 ? fmtUsd(m.spendCents) : '',
                m.provider || '',
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <ModelRow
                  key={m.model}
                  name={m.model}
                  requests={m.requests}
                  fraction={m.pct / 100}
                  sub={sub}
                />
              );
            })}
          </YStack>
        </YStack>
      ) : null}
    </YStack>
  );
}

/** A dense stat tile — the @hanzo/gui analogue of cloud-format `statTile()`. */
function StatTile({ value, label, sub }: { value: string; label: string; sub?: string }): React.JSX.Element {
  return (
    <YStack
      minWidth={140}
      flex={1}
      gap="$1"
      paddingHorizontal="$2.5"
      paddingVertical="$2"
      borderRadius="$3"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.10)"
    >
      <SizableText size="$5" color="$color12">
        {value}
      </SizableText>
      <SizableText size="$1" color="$color9">
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

/** One top-model row — name + requests header, share bar, optional sub —
 * the primitive-native analogue of the vanilla `cloud-model-row` + `shareBar()`. */
function ModelRow({
  name,
  requests,
  fraction,
  sub,
}: {
  name: string;
  requests: number;
  fraction: number;
  sub: string;
}): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, fraction * 100));
  return (
    <YStack gap="$1">
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <SizableText size="$2" color="$color12" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
          {name}
        </SizableText>
        <SizableText size="$2" color="$color11">
          {fmtInt(requests)} req
        </SizableText>
      </XStack>
      <XStack height={6} borderRadius={999} backgroundColor="rgba(255,255,255,0.08)" overflow="hidden">
        <XStack width={`${pct.toFixed(1)}%`} height={6} backgroundColor="rgba(255,255,255,0.55)" />
      </XStack>
      {sub ? (
        <SizableText size="$1" color="$color9">
          {sub}
        </SizableText>
      ) : null}
    </YStack>
  );
}
