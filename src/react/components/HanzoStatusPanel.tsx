import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import {
  getStatusPage,
  type StatusPage,
  type StatusPageService,
  type StatusIncident,
} from '@/services/cloud-admin';
import { fmtMs, fmtAgo } from '@/utils/cloud-format';
import { Panel, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * HanzoStatusPanel — the vanilla `HanzoStatusPanel` (src/components/HanzoStatusPanel.ts)
 * ported onto the React Panel chassis. Shape: fetch.
 *
 * It REUSES the vanilla data layer verbatim — `getStatusPage` (the same
 * same-origin /v1/world/cloud/status-page fetcher, inheriting the backend's
 * allowlist + cache + never-5xx contract) and the `fmtMs` / `fmtAgo` formatters.
 * No fetch/format logic is re-authored here; this file owns only the view — which
 * of the four chassis states to show, and the grouped service board / incident
 * rows re-expressed in @hanzo/gui longhand primitives. Honest states: unreachable
 * → error, reachable-but-empty → empty, never fabricated services.
 */

const STATUS_URL = 'https://status.hanzo.ai';
const OFFLINE = '#ef4444';
const ONLINE = '#22c55e';

export function HanzoStatusPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [data, setData] = useState<StatusPage | null>(null);
  const [state, setState] = useState<PanelState>('loading');

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const d = await getStatusPage();
      if (cancelled) return;
      setData(d);
      if (!d || !d.available) {
        setState('error');
      } else if (d.total === 0) {
        setState('empty');
      } else {
        setState('ready');
      }
    };

    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const d = data;
  const allUp = d != null && d.up === d.total;
  const groups = d ? groupServices(d.services) : [];

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Hanzo Status"
      state={state}
      errorText="Status page unreachable right now — services will appear once it responds."
      emptyText="Status page reachable but reporting no services yet."
      actions={
        <SizableText size="$1" color={allUp ? ONLINE : '$color9'}>
          {d ? `${d.up}/${d.total}` : ''}
        </SizableText>
      }
    >
      {d ? (
        <YStack gap="$2">
          <XStack justifyContent="space-between" alignItems="center">
            <SizableText size="$1" color="$color9">
              {d.source || 'status'} · {d.up}/{d.total} operational
            </SizableText>
            <a
              href={STATUS_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <SizableText size="$1" color="$color10">
                {allUp ? 'all systems go ↗' : 'incident open ↗'}
              </SizableText>
            </a>
          </XStack>

          {d.incidents.length > 0 ? (
            <YStack gap="$1">
              <SizableText size="$1" color={OFFLINE} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                Active incidents · {d.incidents.length}
              </SizableText>
              {d.incidents.map((i, idx) => (
                <IncidentRow key={`${i.group ?? ''}:${i.name}:${idx}`} incident={i} />
              ))}
            </YStack>
          ) : null}

          {groups.map((g) => (
            <YStack key={g.group} gap="$1">
              <SizableText size="$1" color="$color10" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                {g.group} · {g.up}/{g.rows.length}
              </SizableText>
              {g.rows.map((s) => (
                <ServiceRow key={`${g.group}:${s.name}`} svc={s} />
              ))}
            </YStack>
          ))}
        </YStack>
      ) : null}
    </Panel>
  );
}

interface Group {
  group: string;
  up: number;
  rows: StatusPageService[];
}

// Board grouped by service group (AI, Apps, …), each group's services in name
// order — the natural Gatus layout, re-expressed as chassis rows.
function groupServices(services: StatusPageService[]): Group[] {
  const cmp = (a: StatusPageService, b: StatusPageService): number =>
    (a.group || '').localeCompare(b.group || '') || a.name.localeCompare(b.name);
  const byGroup = new Map<string, StatusPageService[]>();
  for (const s of services.slice().sort(cmp)) {
    const g = s.group || 'Services';
    let arr = byGroup.get(g);
    if (!arr) {
      arr = [];
      byGroup.set(g, arr);
    }
    arr.push(s);
  }
  const out: Group[] = [];
  for (const [group, rows] of byGroup) {
    out.push({ group, up: rows.filter((r) => r.up).length, rows });
  }
  return out;
}

function ServiceRow({ svc }: { svc: StatusPageService }): React.JSX.Element {
  return (
    <XStack alignItems="center" gap="$2" paddingVertical="$0.5">
      <XStack width={6} height={6} borderRadius={999} backgroundColor={svc.up ? ONLINE : OFFLINE} />
      <SizableText size="$2" color="$color12" flex={1} numberOfLines={1}>
        {svc.name}
      </SizableText>
      {svc.latencyMs > 0 ? (
        <SizableText size="$1" color="$color9">
          {fmtMs(svc.latencyMs)} resp
        </SizableText>
      ) : null}
    </XStack>
  );
}

function IncidentRow({ incident }: { incident: StatusIncident }): React.JSX.Element {
  const name = incident.group ? `${incident.group} · ${incident.name}` : incident.name;
  return (
    <XStack alignItems="center" gap="$2" paddingVertical="$0.5">
      <XStack width={6} height={6} borderRadius={999} backgroundColor={OFFLINE} />
      <SizableText size="$2" color="$color12" flex={1} numberOfLines={1}>
        {name}
      </SizableText>
      {incident.error ? (
        <SizableText size="$1" color={OFFLINE} numberOfLines={1}>
          {incident.error}
        </SizableText>
      ) : null}
      {incident.since ? (
        <SizableText size="$1" color="$color9">
          {fmtAgo(incident.since)}
        </SizableText>
      ) : null}
    </XStack>
  );
}
