import { Panel } from './Panel';
import { getCloudFleet, type CloudFleet, type FleetProviderGroup } from '@/services/cloud-admin';
import { escapeHtml } from '@/utils/sanitize';
import { fmtInt, statTile, adminOnlyState } from '@/utils/cloud-format';
import { icon } from '@/utils/icons';

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
    const t = d.totals;

    const tiles = [
      statTile(`${fmtInt(t.online)}/${fmtInt(t.machines)}`, 'machines online'),
      statTile(fmtInt(t.gpus), 'GPUs'),
      statTile(fmtInt(t.providers), 'providers'),
      statTile(fmtInt(t.regions), 'regions'),
    ].join('');

    const providers = d.providers.map((p) => this.provider(p)).join('');
    const workers = d.workers.length
      ? `<div class="cloud-fleet-workers">
          <div class="cloud-subhead">${icon('cpu', 12)} BYO GPU workers</div>
          ${d.workers.map((wk) => `<div class="cloud-worker-row">
            <span class="cloud-status-dot ${wk.status === 'online' ? 'online' : 'offline'}"></span>
            <span class="cloud-worker-name">${escapeHtml(wk.hostname || wk.id)}</span>
            <span class="cloud-worker-gpu">${escapeHtml(wk.gpu || '—')}${wk.vram ? ` · ${escapeHtml(wk.vram)}` : ''}</span>
            <span class="cloud-worker-caps">${escapeHtml((wk.capabilities || []).join(', '))}</span>
          </div>`).join('')}
        </div>`
      : '';

    this.setContent(`
      <div class="cloud-fleet-deep">
        <div class="cloud-overview-head">
          <span class="cloud-scope">${icon('server', 13)} DO · GCP · AWS · BYO</span>
          <span class="cloud-live-note">live · visor</span>
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-4">${tiles}</div>
        <div class="cloud-fleet-providers">${providers}</div>
        ${workers}
        <div class="cloud-util-note" title="${escapeHtml(d.utilNote)}">${icon('gauge', 11)} ${escapeHtml(d.utilNote)}</div>
      </div>
    `);
  }

  private provider(p: FleetProviderGroup): string {
    const regions = p.regions.map((rg) => {
      const machines = rg.machines.map((m) => `<div class="cloud-machine-row">
        <span class="cloud-status-dot ${m.status === 'online' || m.status === 'active' || m.status === 'running' ? 'online' : 'degraded'}"></span>
        <span class="cloud-machine-name">${escapeHtml(m.name)}<span class="cloud-machine-type">${escapeHtml(m.type || '')}</span></span>
        <span class="cloud-machine-gpu">${m.gpus ? `${fmtInt(m.gpus)}× ${escapeHtml(m.gpuModel || 'GPU')}` : escapeHtml(m.gpuModel || '—')}${m.vram ? ` · ${escapeHtml(m.vram)}` : ''}</span>
      </div>`).join('');
      return `<div class="cloud-region-group">
        <div class="cloud-region-head">${icon('network', 11)} ${escapeHtml(rg.region)} <span class="cloud-region-meta">${fmtInt(rg.machines.length)} nodes · ${fmtInt(rg.gpus)} GPU</span></div>
        ${machines}
      </div>`;
    }).join('');
    return `<div class="cloud-provider-group">
      <div class="cloud-provider-head">
        <span class="cloud-provider-name">${escapeHtml(p.provider)}</span>
        <span class="cloud-provider-meta">${fmtInt(p.online)}/${fmtInt(p.machines)} online · ${fmtInt(p.gpus)} GPU</span>
      </div>
      ${regions}
    </div>`;
  }
}
