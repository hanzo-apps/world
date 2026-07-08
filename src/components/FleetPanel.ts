import { Panel } from './Panel';
import { getCloudPulse, getMyFleet, type CloudPulse, type CloudRegion, type MyFleet } from '@/services/cloud-pulse';
import { escapeHtml } from '@/utils/sanitize';
import { fmtInt, demoNote } from '@/utils/cloud-format';

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

// Fleet & GPUs. Signed in, this is the caller's REAL fleet (visor /v1/machines +
// /v1/gpus) grouped by region. Signed out (or if the org has no machines), it
// falls back to the demo pulse regions, clearly flagged. Clicking a region with
// known coordinates pans the map.
export class FleetPanel extends Panel {
  private pulse: CloudPulse | null = null;
  private fleet: MyFleet | null = null;
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
      const [pulse, fleet] = await Promise.all([getCloudPulse(), getMyFleet()]);
      this.pulse = pulse;
      this.fleet = fleet;
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'failed';
    }
    this.render();
  }

  /** Real fleet grouped by region, coords borrowed from the pulse region set when names match. */
  private realRows(fleet: MyFleet, pulse: CloudPulse): FleetRow[] {
    const byRegion = new Map<string, FleetRow>();
    const coord = (region: string): CloudRegion | undefined =>
      pulse.regions.find((r) => r.id === region || r.name.toLowerCase() === region.toLowerCase() || r.city.toLowerCase() === region.toLowerCase());
    const online = (s: string) => ['active', 'running', 'online', 'ready', 'healthy', ''].includes(s);
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

  private demoRows(pulse: CloudPulse): FleetRow[] {
    return pulse.regions.map((r) => ({
      id: r.id, name: r.name, sub: `${r.city}, ${r.country}`,
      nodesOnline: r.status === 'online' ? r.nodes : Math.round(r.nodes * 0.9),
      nodesTotal: r.nodes, gpus: r.gpus, status: r.status, lat: r.lat, lon: r.lon,
    }));
  }

  private render(): void {
    if (!this.pulse && this.error) { this.showError(this.error); return; }
    if (!this.pulse) { this.showLoading('Loading fleet…'); return; }
    const p = this.pulse;

    const isReal = !!this.fleet && this.fleet.machines.length > 0;
    const rows = isReal ? this.realRows(this.fleet as MyFleet, p) : this.demoRows(p);
    const totalNodes = rows.reduce((s, r) => s + r.nodesTotal, 0);
    const totalGpus = rows.reduce((s, r) => s + r.gpus, 0);
    this.setCount(rows.length);
    this.setDataBadge(isReal ? 'live' : 'unavailable', isReal ? 'your fleet' : 'demo');

    const list = rows.map((r) => {
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

    this.setContent(`
      <div class="cloud-fleet">
        <div class="cloud-overview-head">
          <span class="cloud-scope">${fmtInt(totalNodes)} nodes · ${fmtInt(totalGpus)} GPUs · ${rows.length} regions</span>
          ${isReal ? '<span class="cloud-live-note">your fleet</span>' : demoNote()}
        </div>
        <div class="cloud-fleet-list">${list}</div>
      </div>
    `);

    this.content.querySelectorAll('.cloud-fleet-row.clickable').forEach((el) => {
      el.addEventListener('click', () => {
        const lat = parseFloat((el as HTMLElement).dataset.lat || '');
        const lon = parseFloat((el as HTMLElement).dataset.lon || '');
        if (!isNaN(lat) && !isNaN(lon)) this.onLocationClick?.(lat, lon);
      });
    });
  }
}
