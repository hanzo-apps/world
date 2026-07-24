import { useEffect, useState } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { getCloudPulse, getMyFleet, type CloudPulse, type CloudRegion, type MyFleet } from '@/services/cloud-pulse';
import { getCloudFleet, type CloudFleet } from '@/services/cloud-admin';
import { isAdmin, isAuthenticated } from '@/services/iam';
import { escapeHtml } from '@/utils/sanitize';
import { fmtInt } from '@/utils/cloud-format';
import { icon } from '@/utils/icons';
import { fleetTiles, fleetProviders, fleetWorkers } from '@/utils/cloud-fleet-view';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * FleetPanel — the vanilla `FleetPanel` (src/components/FleetPanel.ts) ported onto
 * the React Panel chassis. "Fleet & GPUs", REAL/live, never demo:
 *   • signed-in ADMIN → the PLATFORM fleet (every machine + GPU across DO/GCP/AWS/BYO
 *     from visor /v1/world/cloud/fleet), rolled up by provider/region + BYO workers.
 *   • signed-in non-admin → the caller's OWN fleet (visor /v1/machines + /v1/gpus),
 *     grouped by region with coordinates borrowed from the public pulse set.
 *   • otherwise → an honest empty state, never fabricated regions.
 *
 * It REUSES the vanilla data + view layer VERBATIM — the same fetchers
 * (`getCloudFleet` / `getCloudPulse` / `getMyFleet`), the same `isAdmin` /
 * `isAuthenticated` gates, the same `fmtInt` formatter, the `icon()` SVG util, and
 * the shared fleet renderers `fleetTiles` / `fleetProviders` / `fleetWorkers`
 * (src/utils/cloud-fleet-view.ts) — the ONE source of truth for the admin
 * provider/region/machine + BYO-worker markup. No fetch/format/markup logic is
 * re-authored: the admin branch injects those helpers' trusted, self-owned HTML
 * verbatim; the chassis owns the frame + loading/empty/error states; this file owns
 * only which state to show and the your-fleet rows (re-expressed in @hanzo/gui
 * longhand primitives). The region grouping mirrors the vanilla `realRows` since
 * that helper is private to the vanilla class (not exported).
 *
 * View-only port: the vanilla row click-to-pan-the-map affordance is dropped (the
 * React surface wires the map separately); same data in, same info shown.
 */

const online = (s: string): boolean => ['active', 'running', 'online', 'ready', 'healthy', ''].includes(s);

interface FleetRow {
  id: string;
  name: string;
  sub: string;
  nodesOnline: number;
  nodesTotal: number;
  gpus: number;
  status: string;
  lat?: number;
  lon?: number;
}

/** The caller's own fleet grouped by region; coords borrowed from the pulse set.
 *  Mirrors the vanilla `FleetPanel.realRows` (private — reproduced, not re-authored). */
function realRows(fleet: MyFleet, pulse: CloudPulse | null): FleetRow[] {
  const byRegion = new Map<string, FleetRow>();
  const coord = (region: string): CloudRegion | undefined =>
    (pulse?.regions ?? []).find(
      (r) => r.id === region || r.name.toLowerCase() === region.toLowerCase() || r.city.toLowerCase() === region.toLowerCase(),
    );
  for (const m of fleet.machines) {
    const key = m.region || 'unknown';
    let row = byRegion.get(key);
    if (!row) {
      const c = coord(key);
      row = { id: key, name: c?.name ?? key, sub: c ? `${c.city}, ${c.country}` : 'region', nodesOnline: 0, nodesTotal: 0, gpus: 0, status: 'online', lat: c?.lat, lon: c?.lon };
      byRegion.set(key, row);
    }
    row.nodesTotal++;
    if (online(m.status)) row.nodesOnline++; else row.status = 'degraded';
  }
  for (const g of fleet.gpus) {
    const row = byRegion.get(g.region || 'unknown');
    if (row) row.gpus++;
  }
  return [...byRegion.values()].sort((a, b) => b.nodesTotal - a.nodesTotal);
}

/** Scope label from the providers actually reporting (mirrors the vanilla private
 *  `providerScope`) — honest ("BYO" when only BYO answered, "DO · GCP · BYO" as they join). */
function providerScope(d: CloudFleet): string {
  const names = [...new Set(d.providers.map((p) => p.provider.trim()).filter(Boolean))]
    .map((p) => (p.length <= 4 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)));
  return names.length ? names.join(' · ') : 'No providers reporting';
}

/** The admin platform fleet body — the vanilla `render()` admin branch, built from
 *  the SAME shared renderers so React and vanilla draw byte-identical fleet markup. */
function adminFleetHtml(d: CloudFleet): string {
  return `
    <div class="cloud-fleet-deep">
      <div class="cloud-overview-head">
        <span class="cloud-scope">${icon('server', 13)} ${escapeHtml(providerScope(d))}</span>
        <span class="cloud-live-note">live · visor</span>
      </div>
      <div class="cloud-stat-grid cloud-stat-grid-4">${fleetTiles(d.totals)}</div>
      <div class="cloud-fleet-providers">${fleetProviders(d.providers.filter((p) => p.provider.toLowerCase() !== 'byo'))}</div>
      ${fleetWorkers(d.workers)}
      ${d.utilNote ? `<div class="cloud-util-note" title="${escapeHtml(d.utilNote)}">${icon('gauge', 11)} ${escapeHtml(d.utilNote)}</div>` : ''}
    </div>
  `;
}

export function FleetPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  const [admin, setAdmin] = useState(false);
  const [platform, setPlatform] = useState<CloudFleet | null>(null);
  const [fleet, setFleet] = useState<MyFleet | null>(null);
  const [pulse, setPulse] = useState<CloudPulse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Mirror the vanilla `fetchData` exactly — admin gets the platform fleet;
    // everyone else gets their own fleet + the pulse for borrowed coordinates.
    const fetchData = async (): Promise<void> => {
      try {
        const isAdm = await isAdmin();
        if (cancelled) return;
        if (isAdm) {
          const p = await getCloudFleet();
          if (cancelled) return;
          setAdmin(true);
          setPlatform(p);
        } else {
          const [pl, fl] = await Promise.all([getCloudPulse(), getMyFleet()]);
          if (cancelled) return;
          setAdmin(false);
          setPulse(pl);
          setFleet(fl);
          setPlatform(null);
        }
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'failed');
      }
      if (!cancelled) setLoaded(true);
    };

    void fetchData();
    // Refresh on the vanilla cadence so the fleet tracks as it changes.
    const id = window.setInterval(() => void fetchData(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Derive state + body exactly as the vanilla render() gates.
  let state: PanelState = 'loading';
  let emptyText: string | undefined;
  let badge: string | undefined;
  let body: React.ReactNode = null;

  if (loaded) {
    if (admin) {
      if (!platform || !platform.available) {
        state = 'empty';
        emptyText = 'Platform fleet is unavailable right now — visor did not answer for this session.';
      } else {
        state = 'ready';
        badge = `${fmtInt(platform.totals.machines)} machines`;
        body = (
          <div
            className="cloud-fleet-deep-host"
            // Trusted, self-owned SVG/markup from our own fleet renderers — no user input.
            dangerouslySetInnerHTML={{ __html: adminFleetHtml(platform) }}
          />
        );
      }
    } else if (error && !fleet) {
      state = 'error';
    } else {
      const isReal = !!fleet && fleet.machines.length > 0;
      if (!isReal) {
        state = 'empty';
        emptyText = isAuthenticated()
          ? 'No machines in your fleet yet — they appear here live from visor as they come online.'
          : 'Sign in to see your fleet — machines and GPUs across every region, live from visor.';
      } else {
        state = 'ready';
        const rows = realRows(fleet as MyFleet, pulse);
        const totalNodes = rows.reduce((s, r) => s + r.nodesTotal, 0);
        const totalGpus = rows.reduce((s, r) => s + r.gpus, 0);
        badge = `${rows.length} regions`;
        body = <MyFleetView rows={rows} totalNodes={totalNodes} totalGpus={totalGpus} />;
      }
    }
  }

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="Fleet & GPUs"
      state={state}
      loadingText="Loading fleet…"
      emptyText={emptyText}
      errorText={error ?? undefined}
      width={460}
      actions={
        state === 'ready' ? (
          <XStack alignItems="center" gap="$2">
            {badge ? (
              <SizableText size="$1" color="$color9">
                {badge}
              </SizableText>
            ) : null}
            <PanelLiveDot />
          </XStack>
        ) : (
          <XStack />
        )
      }
    >
      {body}
    </Panel>
  );
}

/** The caller's own fleet — regions grouped, re-expressed in @hanzo/gui primitives
 *  (the vanilla `.cloud-fleet` list). Nodes online/total + GPUs per region. */
function MyFleetView({
  rows,
  totalNodes,
  totalGpus,
}: {
  rows: FleetRow[];
  totalNodes: number;
  totalGpus: number;
}): React.JSX.Element {
  return (
    <YStack gap="$2">
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <SizableText size="$2" color="$color11" numberOfLines={1}>
          {fmtInt(totalNodes)} nodes · {fmtInt(totalGpus)} GPUs · {rows.length} regions
        </SizableText>
        <SizableText size="$1" color="$color9">
          your fleet
        </SizableText>
      </XStack>
      <YStack>
        {rows.map((r) => (
          <FleetRegionRow key={r.id} row={r} />
        ))}
      </YStack>
    </YStack>
  );
}

const ONLINE = '#22c55e';
const DEGRADED = '#f59e0b';

function FleetRegionRow({ row }: { row: FleetRow }): React.JSX.Element {
  return (
    <XStack alignItems="center" gap="$2" paddingVertical="$1">
      <XStack width={7} height={7} borderRadius={999} backgroundColor={row.status === 'online' ? ONLINE : DEGRADED} />
      <YStack flex={1} minWidth={0}>
        <SizableText size="$2" color="$color12" numberOfLines={1}>
          {row.name}
        </SizableText>
        <SizableText size="$1" color="$color9" numberOfLines={1}>
          {row.sub}
        </SizableText>
      </YStack>
      <XStack alignItems="baseline" gap="$1">
        <SizableText size="$2" color="$color11">
          {fmtInt(row.nodesOnline)}/{fmtInt(row.nodesTotal)}
        </SizableText>
        <SizableText size="$1" color="$color9">
          nodes
        </SizableText>
      </XStack>
      <XStack alignItems="baseline" gap="$1">
        <SizableText size="$2" color="$color11">
          {fmtInt(row.gpus)}
        </SizableText>
        <SizableText size="$1" color="$color9">
          GPU
        </SizableText>
      </XStack>
    </XStack>
  );
}
