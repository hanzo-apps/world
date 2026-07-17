import { Panel } from './Panel';
import { getCloudFleet, type CloudFleet } from '@/services/cloud-admin';
import { escapeHtml } from '@/utils/sanitize';
import { adminOnlyState } from '@/utils/cloud-format';
import { icon } from '@/utils/icons';
import { fleetTiles, fleetProviders, fleetWorkers } from '@/utils/cloud-fleet-view';

// Deep fleet view — every machine/GPU across DO / GCP / AWS / BYO, grouped by
// PROVIDER then REGION, with GPU model + (BYO) VRAM. REAL: visor /v1/machines +
// /v1/gpus + /v1/fleet/workers. Live GPU utilization / temperature is not yet
// instrumented in the data plane, so we show inventory + status honestly and
// label the gap rather than fake a gauge. Admin-only (server enforces 403).
export class CloudFleetPanel extends Panel {
  private data: CloudFleet | null = null;
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'cloud-fleet', title: 'Fleet & clusters', showCount: false, className: 'panel-wide cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 30_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    this.data = await getCloudFleet();
    this.loaded = true;
    this.render();
  }

  private render(): void {
    if (!this.loaded) { this.showLoading('Loading fleet…'); return; }
    if (!this.data || !this.data.available) {
      this.clearDataBadge();
      this.setContent(adminOnlyState('The platform fleet (machines, GPUs, clusters)'));
      return;
    }
    const d = this.data;
    this.setDataBadge('live', 'fleet');

    this.setContent(`
      <div class="cloud-fleet-deep">
        <div class="cloud-overview-head">
          <span class="cloud-scope">${icon('server', 13)} DO · GCP · AWS · BYO</span>
          <span class="cloud-live-note">live · visor</span>
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-4">${fleetTiles(d.totals)}</div>
        <div class="cloud-fleet-providers">${fleetProviders(d.providers)}</div>
        ${fleetWorkers(d.workers)}
        <div class="cloud-util-note" title="${escapeHtml(d.utilNote)}">${icon('gauge', 11)} ${escapeHtml(d.utilNote)}</div>
      </div>
    `);
  }
}
