import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import {
  getCloudServices,
  getStatusPage,
  type CloudServices,
  type ServiceRow,
  type StatusPage,
  type StatusPageService,
  type StatusIncident,
} from '@/services/cloud-admin';
import { fmtCompact, fmtMs, fmtAgo } from '@/utils/cloud-format';
import { icon, type IconName } from '@/utils/icons';
import { Panel, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * CloudServicesPanel — the vanilla `CloudServicesPanel`
 * (src/components/CloudServicesPanel.ts) ported onto the React Panel chassis.
 * Status of every service Hanzo runs, two fused layers:
 *   • PUBLIC (status.hanzo.ai via /v1/world/cloud/status-page): a per-service
 *     up/down board + active-incidents list. No auth — anyone sees it.
 *   • ADMIN (o11y via /v1/world/cloud/services): the unified binary's mounted
 *     subsystems fused with RED metrics (requests / error rate / p95) over the
 *     last hour. Server enforces 403 for non-admins.
 *
 * It REUSES the vanilla data + formatting layer verbatim — the same two
 * `@/services/cloud-admin` fetchers (`getCloudServices`, `getStatusPage`), the
 * same `fmtCompact` / `fmtMs` / `fmtAgo` formatters, and the vanilla `icon()`
 * inline-SVG util. No fetch/format logic is re-authored; the port is purely the
 * view, expressed in @hanzo/gui longhand primitives. The chassis owns the frame +
 * the loading / empty / error states; this file owns only the rows and which state
 * to show. The vanilla `adminOnlyState()` gate becomes the chassis "empty" state
 * (same honest message) when neither layer is available. Neither layer ever throws.
 */

const ONLINE = '#22c55e';
const OFFLINE = '#ef4444';

/** Inline a canonical lucide icon (reuses the vanilla `icon()` SVG string), the
 *  same trusted, self-owned SVG the vanilla panel renders in its scope lines. */
function Icon({ name, size = 12 }: { name: IconName; size?: number }): React.JSX.Element {
  return (
    <span
      aria-hidden
      style={{ display: 'inline-flex', color: 'inherit', lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: icon(name, size) }}
    />
  );
}

export function CloudServicesPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<CloudServices | null>(null);
  const [status, setStatus] = useState<StatusPage | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async (): Promise<void> => {
      const [services, page] = await Promise.all([getCloudServices(), getStatusPage()]);
      if (cancelled) return;
      setData(services);
      setStatus(page);
      setLoaded(true);
    };

    void fetchData();
    const id = window.setInterval(() => void fetchData(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // The two available layers, gated exactly as the vanilla render().
  const board = status && status.available && status.total > 0 ? status : null;
  const admin = data && data.available ? data : null;

  const state: PanelState = !loaded ? 'loading' : !board && !admin ? 'empty' : 'ready';

  // Count + badge favor the public board (visible to everyone); fall back to the
  // admin subsystem count when the status page is unavailable — the vanilla logic.
  const badge = board
    ? `${board.up}/${board.total} up`
    : admin
      ? `${admin.up}/${admin.total} up`
      : undefined;

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Service status"
      state={state}
      loadingText="Checking services…"
      emptyText="Platform service status is available to the platform admin org. Sign in with an admin account to view it."
      width={460}
      actions={
        badge ? (
          <SizableText size="$1" color="$color9">
            {badge}
          </SizableText>
        ) : (
          <XStack />
        )
      }
    >
      <YStack gap="$3">
        {board ? <StatusSection s={board} /> : null}
        {admin ? <AdminSection d={admin} /> : null}
      </YStack>
    </Panel>
  );
}

/** A green/red status dot — the vanilla `.cloud-status-dot`. */
function StatusDot({ up }: { up: boolean }): React.JSX.Element {
  return <XStack width={7} height={7} borderRadius={999} backgroundColor={up ? ONLINE : OFFLINE} />;
}

/** The scope line — the vanilla `.cloud-overview-head`: an icon + scope on the
 *  left, a quiet note on the right. */
function ScopeHead({
  iconName,
  scope,
  note,
}: {
  iconName: IconName;
  scope: string;
  note: string;
}): React.JSX.Element {
  return (
    <XStack alignItems="center" justifyContent="space-between" gap="$2">
      <XStack alignItems="center" gap="$1.5" flex={1} minWidth={0}>
        <SizableText size="$2" color="$color10">
          <Icon name={iconName} size={13} />
        </SizableText>
        <SizableText size="$2" color="$color11" numberOfLines={1}>
          {scope}
        </SizableText>
      </XStack>
      <SizableText size="$1" color="$color9">
        {note}
      </SizableText>
    </XStack>
  );
}

/** One service/incident row — dot + name (+ optional trailing badge) on the left,
 *  metrics on the right. The vanilla `.cloud-svc-row`. */
function SvcRow({
  up,
  name,
  badge,
  metrics,
}: {
  up: boolean;
  name: string;
  badge?: string;
  metrics: React.ReactNode;
}): React.JSX.Element {
  return (
    <XStack alignItems="center" gap="$2" paddingVertical="$1">
      <StatusDot up={up} />
      <XStack alignItems="center" gap="$1.5" flex={1} minWidth={0}>
        <SizableText size="$2" color="$color12" numberOfLines={1}>
          {name}
        </SizableText>
        {badge ? (
          <SizableText size="$1" color="$color9">
            {badge}
          </SizableText>
        ) : null}
      </XStack>
      <XStack alignItems="center" gap="$2.5">
        {metrics}
      </XStack>
    </XStack>
  );
}

/** A single metric value + unit — the vanilla `.cloud-svc-metric` + `.cloud-unit`. */
function Metric({ value, unit }: { value: string; unit?: string }): React.JSX.Element {
  return (
    <XStack alignItems="baseline" gap="$1">
      <SizableText size="$2" color="$color11">
        {value}
      </SizableText>
      {unit ? (
        <SizableText size="$1" color="$color9">
          {unit}
        </SizableText>
      ) : null}
    </XStack>
  );
}

// ── public status.hanzo.ai board + incidents ─────────────────────────────────

function StatusSection({ s }: { s: StatusPage }): React.JSX.Element {
  const allUp = s.up === s.total;
  return (
    <YStack gap="$2">
      <ScopeHead
        iconName="activity"
        scope={`${s.source || 'status'} · ${s.up}/${s.total} operational`}
        note={allUp ? 'all systems go' : 'incident open'}
      />
      {s.incidents.length ? (
        <YStack gap="$1">
          <SizableText size="$1" color="$color10" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Active incidents · {s.incidents.length}
          </SizableText>
          {s.incidents.map((i, idx) => (
            <IncidentRow key={`${i.name}-${idx}`} i={i} />
          ))}
        </YStack>
      ) : null}
      <YStack>
        {s.services.map((svc, idx) => (
          <StatusRow key={`${svc.name}-${idx}`} s={svc} />
        ))}
      </YStack>
    </YStack>
  );
}

function StatusRow({ s }: { s: StatusPageService }): React.JSX.Element {
  const name = s.group ? `${s.group} · ${s.name}` : s.name;
  return (
    <SvcRow
      up={s.up}
      name={name}
      metrics={s.latencyMs > 0 ? <Metric value={fmtMs(s.latencyMs)} unit="resp" /> : null}
    />
  );
}

function IncidentRow({ i }: { i: StatusIncident }): React.JSX.Element {
  const name = i.group ? `${i.group} · ${i.name}` : i.name;
  return (
    <SvcRow
      up={false}
      name={name}
      metrics={
        <>
          {i.error ? (
            <SizableText size="$1" color="$color9" numberOfLines={1}>
              {i.error}
            </SizableText>
          ) : null}
          {i.since ? <Metric value={fmtAgo(i.since)} /> : null}
        </>
      }
    />
  );
}

// ── admin o11y RED metrics ───────────────────────────────────────────────────

function AdminSection({ d }: { d: CloudServices }): React.JSX.Element {
  const rows = d.services
    .slice()
    .sort((a, b) => Number(b.up) - Number(a.up) || b.requests - a.requests);
  return (
    <YStack gap="$2">
      <ScopeHead
        iconName="box"
        scope={`${d.total} subsystems · ${d.up} operational`}
        note={`o11y · ${d.window}`}
      />
      <YStack>
        {rows.map((s, idx) => (
          <AdminRow key={`${s.product}-${idx}`} s={s} />
        ))}
      </YStack>
    </YStack>
  );
}

function AdminRow({ s }: { s: ServiceRow }): React.JSX.Element {
  const badge = s.deployments > 0 ? `${s.deploymentsUp}/${s.deployments} up` : undefined;
  const metrics = s.instrumented ? (
    <>
      <Metric value={fmtCompact(s.requests)} unit="req/1h" />
      <Metric value={`${(s.errorRate * 100).toFixed(s.errorRate < 0.1 ? 2 : 1)}%`} unit="err" />
      <Metric value={fmtMs(s.p95Ms)} unit="p95" />
    </>
  ) : (
    <SizableText size="$1" color="$color9">
      not instrumented
    </SizableText>
  );
  return <SvcRow up={s.up} name={s.product} badge={badge} metrics={metrics} />;
}
