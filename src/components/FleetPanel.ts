import { Panel } from './Panel';
import { getCloudPulse, getMyFleet, type CloudPulse, type CloudRegion, type MyFleet } from '@/services/cloud-pulse';
import { getCloudFleet, type CloudFleet } from '@/services/cloud-admin';
import { isAdmin, isAuthenticated } from '@/services/iam';
import { escapeHtml } from '@/utils/sanitize';
import { fmtInt, statTile } from '@/utils/cloud-format';

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

const online = (s: string): boolean => ['active', 'running', 'online', 'ready', 'healthy', ''].includes(s);

// Fleet & GPUs — REAL, live, never demo.
//   - Signed-in ADMIN (z@hanzo.ai / operator org): the PLATFORM fleet — every
//     machine + GPU across DO/GCP/AWS/BYO from visor (/v1/world/cloud/fleet), rolled
//     up by region. Refreshes every 30s so it tracks the fleet as it changes.
//   - Signed-in non-admin: the caller's OWN fleet (visor /v1/machines + /v1/gpus).
//   - Otherwise: an honest empty state — never fabricated regions. Clicking a region
//     with known coordinates pans the map.
export class FleetPanel extends Panel {
  private pulse: CloudPulse | null = null;
  private fleet: MyFleet | null = null;
  private platform: CloudFleet | null = null;
  private admin = false;
  private loaded = false;
  private error: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onLocationClick: ((lat: number, lon: number) => void) | null = null;

  constructor() {
    super({ id: 'fleet', title: 'Fleet & GPUs', showCount: true, className: 'cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 30_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  public setLocationClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onLocationClick = handler;
  }

  private async fetchData(): Promise<void> {
    try {
      this.admin = await isAdmin();
      if (this.admin) {
        // Platform-wide fleet (all machines/GPUs) — real, live.
        this.platform = await getCloudFleet();
      } else {
        // The caller's own fleet; pulse only for borrowed region coordinates.
        const [pulse, fleet] = await Promise.all([getCloudPulse(), getMyFleet()]);
        this.pulse = pulse;
        this.fleet = fleet;
        this.platform = null;
      }
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'failed';
    }
    this.loaded = true;
    this.render();
  }

  /** Platform fleet rolled up by region (across every provider). Real visor data. */
  private platformRows(d: CloudFleet): FleetRow[] {
    const byRegion = new Map<string, FleetRow>();
    for (const p of d.providers) {
      for (const rg of p.regions) {
        let row = byRegion.get(rg.region);
        if (!row) {
          row = { id: rg.region, name: rg.region, sub: 'region', nodesOnline: 0, nodesTotal: 0, gpus: 0, status: 'online' };
          byRegion.set(rg.region, row);
        }
        row.gpus += rg.gpus;
        for (const m of rg.machines) {
          row.nodesTotal++;
          if (online(m.status)) row.nodesOnline++; else row.status = 'degraded';
        }
      }
    }
    return [...byRegion.values()].sort((a, b) => b.nodesTotal - a.nodesTotal);
  }

  /** The caller's own fleet grouped by region; coords borrowed from the pulse set. */
  private realRows(fleet: MyFleet, pulse: CloudPulse | null): FleetRow[] {
    const byRegion = new Map<string, FleetRow>();
    const coord = (region: string): CloudRegion | undefined =>
      (pulse?.regions ?? []).find((r) => r.id === region || r.name.toLowerCase() === region.toLowerCase() || r.city.toLowerCase() === region.toLowerCase());
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

  private render(): void {
    if (!this.loaded) { this.showLoading('Loading fleet…'); return; }

    // Admin → real platform fleet, or an honest "unavailable" state (never demo).
    if (this.admin) {
      const d = this.platform;
      if (!d || !d.available) {
        this.clearDataBadge();
        this.setCount(0);
        this.setContent(`<div class="cloud-empty">Platform fleet is unavailable right now — visor did not answer for this session.</div>`);
        return;
      }
      const rows = this.platformRows(d);
      this.setCount(d.totals.machines);
      this.setDataBadge('live', 'platform');
      const tiles = [
        statTile(`${fmtInt(d.totals.online)}/${fmtInt(d.totals.machines)}`, 'machines online'),
        statTile(fmtInt(d.totals.gpus), 'GPUs'),
        statTile(fmtInt(d.totals.providers), 'providers'),
        statTile(fmtInt(d.totals.regions), 'regions'),
      ].join('');
      this.setContent(`
        <div class="cloud-fleet">
          <div class="cloud-overview-head">
            <span class="cloud-scope">DO · GCP · AWS · BYO</span>
            <span class="cloud-live-note">live · visor</span>
          </div>
          <div class="cloud-stat-grid cloud-stat-grid-4">${tiles}</div>
          <div class="cloud-fleet-list">${this.rowsHtml(rows)}</div>
        </div>
      `);
      this.wireClicks();
      return;
    }

    // Non-admin: the caller's own real fleet, or an honest empty state.
    if (this.error && !this.fleet) { this.showError(this.error); return; }
    const isReal = !!this.fleet && this.fleet.machines.length > 0;
    if (!isReal) {
      this.clearDataBadge();
      this.setCount(0);
      const msg = isAuthenticated()
        ? 'No machines in your fleet yet — they appear here live from visor as they come online.'
        : 'Sign in to see your fleet — machines and GPUs across every region, live from visor.';
      this.setContent(`<div class="cloud-empty">${msg}</div>`);
      return;
    }
    const rows = this.realRows(this.fleet as MyFleet, this.pulse);
    const totalNodes = rows.reduce((s, r) => s + r.nodesTotal, 0);
    const totalGpus = rows.reduce((s, r) => s + r.gpus, 0);
    this.setCount(rows.length);
    this.setDataBadge('live', 'your fleet');
    this.setContent(`
      <div class="cloud-fleet">
        <div class="cloud-overview-head">
          <span class="cloud-scope">${fmtInt(totalNodes)} nodes · ${fmtInt(totalGpus)} GPUs · ${rows.length} regions</span>
          <span class="cloud-live-note">your fleet</span>
        </div>
        <div class="cloud-fleet-list">${this.rowsHtml(rows)}</div>
      </div>
    `);
    this.wireClicks();
  }

  private rowsHtml(rows: FleetRow[]): string {
    return rows.map((r) => {
      const clickable = r.lat !== undefined && r.lon !== undefined;
      return `<div class="cloud-fleet-row${clickable ? ' clickable' : ''}"${clickable ? ` data-lat="${r.lat}" data-lon="${r.lon}"` : ''}>
        <span class="cloud-status-dot ${escapeHtml(r.status)}"></span>
        <div class="cloud-fleet-region">
          <span class="cloud-fleet-name">${escapeHtml(r.name)}</span>
          <span class="cloud-fleet-sub">${escapeHtml(r.sub)}</span>
        </div>
        <div class="cloud-fleet-metrics">
          <span class="cloud-fleet-nodes">${fmtInt(r.nodesOnline)}/${fmtInt(r.nodesTotal)}<span class="cloud-unit">nodes</span></span>
          <span class="cloud-fleet-gpus">${fmtInt(r.gpus)}<span class="cloud-unit">GPU</span></span>
        </div>
      </div>`;
    }).join('');
  }

  private wireClicks(): void {
    this.content.querySelectorAll('.cloud-fleet-row.clickable').forEach((el) => {
      el.addEventListener('click', () => {
        const lat = parseFloat((el as HTMLElement).dataset.lat || '');
        const lon = parseFloat((el as HTMLElement).dataset.lon || '');
        if (!isNaN(lat) && !isNaN(lon)) this.onLocationClick?.(lat, lon);
      });
    });
  }
}
