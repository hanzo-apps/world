import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { getCloudLLM, type CloudLLM } from '@/services/cloud-admin';
import { fmtCompact, fmtInt, fmtUsd, fmtMs } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import { Sparkline } from './Sparkline';
import type { PanelTab } from '@/components/Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * LlmUsagePanel — the vanilla `LlmUsagePanel` (src/components/LlmUsagePanel.ts)
 * ported onto the React Panel chassis. Platform LLM observability: per-model +
 * per-org usage, tokens, cost, errors and p95 latency over a chosen range.
 *
 * It REUSES the vanilla data layer verbatim — `getCloudLLM` (the REAL cloud
 * /v1/world/cloud/llm admin ledger) and the `fmtCompact/fmtInt/fmtUsd/fmtMs`
 * formatters + the vanilla `sparkline()` util (via <Sparkline>). No fetch or
 * number logic is re-authored. Admin-only: the service returns `null` when the
 * session lacks a cloud global-admin token; that maps to an honest empty state,
 * never fabricated data.
 *
 * The chassis owns the frame + loading/empty/error states + the range tab bar +
 * the sparkline slot; this file owns only which state to show and the rows,
 * re-expressed in @hanzo/gui longhand primitives.
 */

const RANGES = ['24h', '7d', '30d'] as const;
const RANGE_TABS: readonly PanelTab[] = RANGES.map((r) => ({ key: r, label: r }));

export function LlmUsagePanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<CloudLLM | null>(null);
  const [range, setRange] = useState<string>('24h');
  const [state, setState] = useState<PanelState>('loading');
  const [emptyText, setEmptyText] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const result = await getCloudLLM(range);
        if (cancelled) return;
        setData(result);
        if (!result) {
          // Admin-gated: no cloud global-admin token this session.
          setEmptyText(
            'Admin only — platform LLM observability is available to the platform admin org. Sign in with an admin account to view it.',
          );
          setState('empty');
        } else if (!result.available || !result.data) {
          setEmptyText(result.note || 'Not available.');
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
    // Live surface: refresh on the vanilla poller cadence.
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [range]);

  const g = data?.data;
  const series = (g?.series || []).map((p) => p.requests);
  const spark =
    g && series.length > 1 ? (
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <SizableText size="$1" color="$color9">
          requests · {data?.range}
        </SizableText>
        <Sparkline data={series} width={240} height={30} />
      </XStack>
    ) : undefined;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="LLM observability"
      state={state}
      emptyText={emptyText}
      tabs={RANGE_TABS}
      activeTab={range}
      onTabChange={setRange}
      sparkline={spark}
      width={520}
      actions={<PanelLiveDot />}
    >
      {g ? (
        <YStack gap="$3">
          <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
            platform-wide inference
          </SizableText>

          <XStack flexWrap="wrap" gap="$2">
            <StatTile value={fmtCompact(g.totals.requests)} label={`requests · ${data?.range}`} />
            <StatTile value={fmtCompact(g.totals.tokens)} label="tokens" />
            <StatTile value={fmtUsd(g.totals.costCents)} label="spend" />
            <StatTile value={fmtInt(g.totals.errors)} label="errors" />
            <StatTile value={fmtMs(g.totals.latencyP95Ms)} label="p95 latency" />
            <StatTile value={fmtInt(g.totals.orgs)} label="active orgs" />
          </XStack>

          <XStack gap="$4" flexWrap="wrap">
            <YStack flex={1} minWidth={200} gap="$1.5">
              <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                Top models
              </SizableText>
              <ShareRows
                rows={(g.topModels || []).slice(0, 8).map((m) => ({
                  label: m.model,
                  fraction: m.requests / Math.max(...(g.topModels || []).map((x) => x.requests), 1),
                  value: fmtCompact(m.requests),
                }))}
                empty="No model traffic."
              />
            </YStack>
            <YStack flex={1} minWidth={200} gap="$1.5">
              <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                Top orgs by spend
              </SizableText>
              <ShareRows
                rows={(g.topOrgs || []).slice(0, 8).map((o) => ({
                  label: o.org,
                  fraction: o.costCents / Math.max(...(g.topOrgs || []).map((x) => x.costCents), 1),
                  value: fmtUsd(o.costCents),
                }))}
                empty="No org spend."
              />
            </YStack>
          </XStack>
        </YStack>
      ) : null}
    </Panel>
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
          <SizableText size="$2" color="$color11" numberOfLines={1} style={{ flexBasis: 120, flexShrink: 0 }}>
            {r.label}
          </SizableText>
          <XStack flex={1} height={6} borderRadius={999} backgroundColor="rgba(255,255,255,0.08)" overflow="hidden">
            <XStack
              width={`${Math.max(0, Math.min(100, r.fraction * 100)).toFixed(1)}%`}
              backgroundColor="rgba(255,255,255,0.55)"
            />
          </XStack>
          <SizableText size="$2" color="$color12" style={{ flexBasis: 64, textAlign: 'right', flexShrink: 0 }}>
            {r.value}
          </SizableText>
        </XStack>
      ))}
    </YStack>
  );
}
