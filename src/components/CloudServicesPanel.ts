import { Panel } from './Panel';
import { getCloudServices, type CloudServices, type ServiceRow } from '@/services/cloud-admin';
import { escapeHtml } from '@/utils/sanitize';
import { fmtCompact, fmtMs, adminOnlyState } from '@/utils/cloud-format';
import { icon } from '@/utils/icons';

// Full status of every service served via api.hanzo.ai — the unified binary's
// mounted subsystems (ai, gateway, iam, kms, s3, o11y, commerce, tasks, visor,
// world…). REAL: o11y live health probe fused with RED metrics (requests / error
// rate / p95) over the last hour. Admin-only (server enforces 403); non-admins
// see a clean gate.
export class CloudServicesPanel extends Panel {
  private data: CloudServices | null = null;
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'cloud-services', title: 'Service status', showCount: true, className: 'cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 30_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    this.data = await getCloudServices();
    this.loaded = true;
    this.render();
  }

  private render(): void {
    if (!this.loaded) { this.showLoading('Checking services…'); return; }
    if (!this.data || !this.data.available) {
      this.clearDataBadge();
      this.setContent(adminOnlyState('Platform service status'));
      return;
    }
    const d = this.data;
    this.setCount(d.services.length);
    this.setDataBadge(d.up === d.total ? 'live' : 'cached', `${d.up}/${d.total} up`);

    const rows = d.services
      .slice()
      .sort((a, b) => Number(b.up) - Number(a.up) || b.requests - a.requests)
      .map((s) => this.row(s))
      .join('');

    this.setContent(`
      <div class="cloud-services">
        <div class="cloud-overview-head">
          <span class="cloud-scope">${icon('box', 13)} ${d.total} subsystems · ${d.up} operational</span>
          <span class="cloud-live-note">o11y · ${escapeHtml(d.window)}</span>
        </div>
        <div class="cloud-svc-list">${rows}</div>
      </div>
    `);
  }

  private row(s: ServiceRow): string {
    const cls = s.up ? 'online' : 'offline';
    const metrics = s.instrumented
      ? `<span class="cloud-svc-metric">${fmtCompact(s.requests)}<span class="cloud-unit">req/1h</span></span>
         <span class="cloud-svc-metric">${(s.errorRate * 100).toFixed(s.errorRate < 0.1 ? 2 : 1)}%<span class="cloud-unit">err</span></span>
         <span class="cloud-svc-metric">${fmtMs(s.p95Ms)}<span class="cloud-unit">p95</span></span>`
      : `<span class="cloud-svc-metric cloud-svc-nodata">not instrumented</span>`;
    const deploys = s.deployments > 0 ? `<span class="cloud-svc-deploys">${s.deploymentsUp}/${s.deployments} up</span>` : '';
    return `<div class="cloud-svc-row">
      <span class="cloud-status-dot ${cls}"></span>
      <span class="cloud-svc-name">${escapeHtml(s.product)}${deploys}</span>
      <span class="cloud-svc-metrics">${metrics}</span>
    </div>`;
  }
}
