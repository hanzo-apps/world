import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import {
  getCloudQueue,
  type CloudQueue,
  type QueueJob,
  type QueueService,
} from '@/services/cloud-admin';
import { fmtInt, fmtAgo } from '@/utils/cloud-format';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * QueuePanel — the vanilla `QueuePanel` (src/components/QueuePanel.ts) ported onto
 * the React Panel chassis. The SuperAdmin view of the platform's GPU job queue
 * (gpu-jobs): how deep it is, what's RUNNING now (each job with the dispatching
 * service, the claiming worker, and the target model), what's pending/recent, and
 * the online BYO worker count. Real, live: /v1/world/cloud/queue aggregates the
 * tasks engine + fleet workers (server enforces owner==admin, fail-closed 403).
 *
 * It REUSES the vanilla data + formatting layer verbatim — the same `getCloudQueue`
 * fetcher and the `fmtInt` / `fmtAgo` formatters. No fetch/format logic is
 * re-authored; the port is purely the view, expressed in @hanzo/gui longhand
 * primitives. The vanilla HTML helpers are re-expressed primitive-native:
 * `statTile()` → the <StatTile> tile below (same value/label shape),
 * `adminOnlyState()` → the chassis empty state carrying the same admin-gate copy,
 * `escapeHtml()` is unneeded because React escapes text nodes, and the vanilla
 * `icon()` subhead glyphs collapse to plain tracked labels. The chassis owns the
 * frame + the loading / empty / error states; this file owns only the rows and
 * which state to show. Refreshes every 15s (the vanilla cadence — a queue moves
 * faster than the fleet). Honest "admin only" / "unavailable" / "no jobs" states —
 * never a fabricated job.
 */

const DOT_COLOR: Record<'online' | 'degraded' | 'offline', string> = {
  online: '#22c55e',
  degraded: '#eab308',
  offline: '#ef4444',
};

export function QueuePanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<CloudQueue | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async (): Promise<void> => {
      const d = await getCloudQueue();
      if (cancelled) return;
      setData(d);
      setLoaded(true);
    };

    void fetchData();
    const id = window.setInterval(() => void fetchData(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // State machine, mirroring the vanilla render() gate exactly:
  //   !loaded            → loading
  //   loaded, data null  → admin-only gate (empty, with the gate copy)
  //   loaded, !available → unavailable (empty, with the payload note)
  //   else               → ready
  const state: PanelState = !loaded ? 'loading' : !data || !data.available ? 'empty' : 'ready';

  const emptyText = !data
    ? 'The GPU job queue is available to the platform admin org. Sign in with an admin account to view it.'
    : !data.available
      ? data.note || 'The GPU job queue is unavailable right now.'
      : undefined;

  const live = !!data && data.available && data.depth.running > 0;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="GPU Queue"
      state={state}
      loadingText="Reading queue…"
      emptyText={emptyText}
      actions={live ? <PanelLiveDot /> : <XStack />}
      width={460}
    >
      {data && data.available ? <QueueBody d={data} /> : null}
    </Panel>
  );
}

/** The overview head + stat grid + service/job sections — the vanilla `.cloud-queue` body. */
function QueueBody({ d }: { d: CloudQueue }): React.JSX.Element {
  const active = d.depth.running + d.depth.pending;
  const tiles: { value: string; label: string }[] = [
    { value: fmtInt(d.depth.running), label: 'running' },
    { value: fmtInt(d.depth.pending), label: 'queued' },
    { value: `${fmtInt(d.workers.online)}/${fmtInt(d.workers.total)}`, label: 'workers' },
    { value: fmtInt(d.depth.failed), label: 'failed' },
  ];
  const showEmpty = active === 0 && d.recent.length === 0;

  return (
    <YStack gap="$2.5">
      <XStack alignItems="center" justifyContent="space-between" gap="$3" flexWrap="wrap">
        <SizableText size="$2" color="$color11">
          {`${d.namespace} · ${fmtInt(d.workers.online)}/${fmtInt(d.workers.total)} workers online`}
        </SizableText>
        <SizableText size="$1" color="$color9">
          live · tasks
        </SizableText>
      </XStack>

      <XStack flexWrap="wrap" gap="$2">
        {tiles.map((tile) => (
          <StatTile key={tile.label} value={tile.value} label={tile.label} />
        ))}
      </XStack>

      {d.services.length ? (
        <YStack gap="$1.5">
          <SubHead label="By service" />
          {d.services.map((s) => (
            <ServiceRow key={s.service} s={s} />
          ))}
        </YStack>
      ) : null}

      {d.running.length ? (
        <YStack gap="$1.5">
          <SubHead label={`Running now · ${d.running.length}`} />
          {d.running.map((j) => (
            <JobRow key={j.id} j={j} running />
          ))}
        </YStack>
      ) : null}

      {d.pending.length ? (
        <YStack gap="$1.5">
          <SubHead label={`Queued · ${d.pending.length}`} />
          {d.pending.slice(0, 8).map((j) => (
            <JobRow key={j.id} j={j} running={false} />
          ))}
        </YStack>
      ) : null}

      {d.recent.length ? (
        <YStack gap="$1.5">
          <SubHead label={`Recent · ${d.recent.length}`} />
          {d.recent.slice(0, 6).map((j) => (
            <JobRow key={j.id} j={j} running={false} />
          ))}
        </YStack>
      ) : null}

      {showEmpty ? (
        <SizableText size="$2" color="$color9">
          No GPU jobs in the queue right now — they appear live as services dispatch work to the fleet.
        </SizableText>
      ) : null}
    </YStack>
  );
}

/** A section subhead — the vanilla `.cloud-subhead` (its icon glyph collapses to a tracked label). */
function SubHead({ label }: { label: string }): React.JSX.Element {
  return (
    <SizableText size="$1" color="$color9" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {label}
    </SizableText>
  );
}

/** One service row — dot + name + running/queued metrics (the vanilla `.cloud-svc-row`). */
function ServiceRow({ s }: { s: QueueService }): React.JSX.Element {
  return (
    <XStack alignItems="center" gap="$2">
      <StatusDot kind={s.running > 0 ? 'online' : 'degraded'} />
      <SizableText size="$2" color="$color11" flex={1} numberOfLines={1}>
        {s.service}
      </SizableText>
      <SizableText size="$1" color="$color10">
        {`${fmtInt(s.running)} run · ${fmtInt(s.pending)} queued`}
      </SizableText>
    </XStack>
  );
}

/**
 * One job line — the vanilla `jobRow()`: dot + service badge + type, then (running)
 * the worker→model it serves, else its queued/terminal status + attempt; plus age.
 */
function JobRow({ j, running }: { j: QueueJob; running: boolean }): React.JSX.Element {
  const dot: 'online' | 'degraded' | 'offline' = running
    ? 'online'
    : j.status === 'failed'
      ? 'offline'
      : j.status === 'done'
        ? 'online'
        : 'degraded';
  const serving = running
    ? `${j.worker ? j.worker : 'claiming'}${j.model ? ` → ${j.model}` : ''}`
    : `${j.status}${j.attempt > 1 ? ` · try ${j.attempt}` : ''}`;
  const when = fmtAgo(running ? j.startedAt : j.closedAt || j.startedAt);

  return (
    <XStack alignItems="center" gap="$2" paddingLeft="$2">
      <StatusDot kind={dot} />
      <XStack flex={1} gap="$1.5" alignItems="baseline">
        <SizableText size="$1" color="$color9">
          {j.service}
        </SizableText>
        <SizableText size="$2" color="$color11" numberOfLines={1}>
          {j.type}
        </SizableText>
      </XStack>
      <SizableText size="$1" color="$color10" numberOfLines={1}>
        {`${serving} · ${when}`}
      </SizableText>
    </XStack>
  );
}

function StatusDot({ kind }: { kind: 'online' | 'degraded' | 'offline' }): React.JSX.Element {
  return <XStack width={7} height={7} borderRadius={999} backgroundColor={DOT_COLOR[kind]} />;
}

/** Dense stat tile — the primitive-native analogue of the vanilla `statTile()` HTML
 * helper: big mono value + label. */
function StatTile({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <YStack
      gap="$0.5"
      paddingHorizontal="$2.5"
      paddingVertical="$2"
      borderRadius="$3"
      borderWidth={1}
      borderColor="rgba(255,255,255,0.10)"
      backgroundColor="rgba(255,255,255,0.03)"
      minWidth={100}
      flex={1}
    >
      <SizableText size="$6" color="$color12">
        {value}
      </SizableText>
      <SizableText size="$1" color="$color10" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </SizableText>
    </YStack>
  );
}
