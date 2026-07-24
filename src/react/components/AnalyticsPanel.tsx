import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { getCloudAnalytics, type CloudAnalytics, type AnalyticsMetric } from '@/services/cloud-admin';
import { fmtCompact, fmtInt } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * AnalyticsPanel — the vanilla `AnalyticsPanel` (src/components/AnalyticsPanel.ts)
 * ported onto the React Panel chassis. Global web analytics across every registered
 * Hanzo site (the insights.hanzo.ai / analytics.hanzo.ai merge): live visitors,
 * pageviews, and top pages / referrers / countries.
 *
 * It REUSES the vanilla data + formatting layer verbatim — `getCloudAnalytics`
 * (the REAL cloud /v1/world/cloud/analytics admin feed) and the `fmtCompact` /
 * `fmtInt` formatters. No fetch or number logic is re-authored. The vanilla
 * `statTile()` / `shareBar()` HTML helpers are re-expressed as the <StatTile> and
 * <ShareRows> primitives below (same value/label + label·bar·value shape).
 *
 * Admin-only: the service returns `null` when the session lacks a cloud global-admin
 * token — that maps to an honest empty state (the client mirror of the server 403),
 * never fabricated data. `available:false` (analytics product has no data yet) maps
 * to a quiet empty state with the server note.
 *
 * The chassis owns the frame + loading / empty / error states; this file owns only
 * which state to show and the rows, expressed in @hanzo/gui longhand primitives.
 */
export function AnalyticsPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<CloudAnalytics | null>(null);
  const [state, setState] = useState<PanelState>('loading');
  const [emptyText, setEmptyText] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const result = await getCloudAnalytics();
        if (cancelled) return;
        setData(result);
        if (!result) {
          // Admin-gated: no cloud global-admin token this session.
          setEmptyText(
            'Admin only — global web analytics is available to the platform admin org. Sign in with an admin account to view it.',
          );
          setState('empty');
        } else if (!result.available) {
          setEmptyText(result.note || 'Analytics unavailable.');
          setState('empty');
        } else {
          setState('ready');
        }
      } catch {
        if (!cancelled) setState('error');
      }
    };

    setState('loading');
    void load();
    // Live surface: refresh on the vanilla poller cadence (60s).
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const d = data && data.available ? data : null;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Web analytics"
      state={state}
      emptyText={emptyText}
      loadingText="Loading analytics…"
      width={520}
      actions={<PanelLiveDot />}
    >
      {d ? (
        <YStack gap="$3">
          <XStack alignItems="center" justifyContent="space-between" gap="$2">
            <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
              all Hanzo sites
            </SizableText>
            <SizableText size="$1" color="$color9">
              live · {d.window}
            </SizableText>
          </XStack>

          <XStack flexWrap="wrap" gap="$2">
            <StatTile value={fmtCompact(d.pageviews)} label={`pageviews · ${d.window}`} />
            <StatTile value={fmtCompact(d.visitors)} label={`visitors · ${d.window}`} />
            <StatTile value={fmtInt(d.activeNow)} label="active now" />
          </XStack>

          <XStack gap="$4" flexWrap="wrap">
            <MetricColumn title="Top pages" rows={d.topPages} />
            <MetricColumn title="Top referrers" rows={d.topReferrers} />
            <MetricColumn title="Top countries" rows={d.topCountries} />
          </XStack>
        </YStack>
      ) : null}
    </Panel>
  );
}

/** One labelled list of share rows — the vanilla `list()` (subhead + shareBar rows). */
function MetricColumn({ title, rows }: { title: string; rows: AnalyticsMetric[] }): React.JSX.Element {
  const max = Math.max(...rows.map((r) => r.y), 1);
  return (
    <YStack flex={1} minWidth={200} gap="$1.5">
      <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
        {title}
      </SizableText>
      <ShareRows
        rows={rows.map((r) => ({ label: r.x, fraction: r.y / max, value: fmtCompact(r.y) }))}
        empty="No data yet."
      />
    </YStack>
  );
}

/** A dense stat tile — the @hanzo/gui analogue of cloud-format `statTile`. */
function StatTile({ value, label }: { value: string; label: string }): React.JSX.Element {
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
    </YStack>
  );
}

interface ShareRow {
  label: string;
  fraction: number;
  value: string;
}

/** A column of label · share-bar · value rows — the analogue of cloud `shareBar` rows. */
function ShareRows({ rows, empty }: { rows: ShareRow[]; empty: string }): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <SizableText size="$2" color="$color9">
        {empty}
      </SizableText>
    );
  }
  return (
    <YStack gap="$1">
      {rows.map((r) => (
        <XStack key={r.label} alignItems="center" gap="$2">
          <SizableText
            size="$2"
            color="$color11"
            numberOfLines={1}
            style={{ flexBasis: 120, flexShrink: 0 }}
          >
            {r.label}
          </SizableText>
          <XStack
            flex={1}
            height={6}
            borderRadius={999}
            backgroundColor="rgba(255,255,255,0.08)"
            overflow="hidden"
          >
            <XStack
              width={`${Math.max(0, Math.min(100, r.fraction * 100)).toFixed(1)}%`}
              backgroundColor="rgba(255,255,255,0.55)"
            />
          </XStack>
          <SizableText
            size="$2"
            color="$color12"
            style={{ flexBasis: 64, textAlign: 'right', flexShrink: 0 }}
          >
            {r.value}
          </SizableText>
        </XStack>
      ))}
    </YStack>
  );
}
