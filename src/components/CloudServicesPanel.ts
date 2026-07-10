import { Panel } from './Panel';
import {
  getCloudServices,
  getStatusPage,
  type CloudServices,
  type ServiceRow,
  type StatusPage,
  type StatusPageService,
  type StatusIncident,
} from '@/services/cloud-admin';
import { escapeHtml } from '@/utils/sanitize';
import { fmtCompact, fmtMs, adminOnlyState } from '@/utils/cloud-format';
import { icon } from '@/utils/icons';

// Status of every service Hanzo runs. Two fused layers:
//   • PUBLIC (status.hanzo.ai, Gatus proxy /v1/world/cloud/status-page): a
//     per-service up/down board + active-incidents list. No auth — anyone sees it.
//   • ADMIN (o11y, /v1/world/cloud/services): the unified binary's mounted
//     subsystems fused with RED metrics (requests / error rate / p95) over the
//     last hour. Server enforces 403 for non-admins.
// When the status page is down (available:false) and the caller isn't admin, the
// panel shows a clean gate. Neither layer ever throws.
export class CloudServicesPanel extends Panel {
  private data: CloudServices | null = null;
  private status: StatusPage | null = null;
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
    const [services, status] = await Promise.all([getCloudServices(), getStatusPage()]);
    this.data = services;
    this.status = status;
    this.loaded = true;
    this.render();
  }

  private render(): void {
    if (!this.loaded) { this.showLoading('Checking services…'); return; }

    const status = this.status && this.status.available && this.status.total > 0 ? this.status : null;
    const admin = this.data && this.data.available ? this.data : null;

    if (!status && !admin) {
      this.clearDataBadge();
      this.setCount(0);
      this.setContent(adminOnlyState('Platform service status'));
      return;
    }

    // Count + badge favor the public board (visible to everyone); fall back to
    // the admin subsystem count when the status page is unavailable.
    if (status) {
      this.setCount(status.total);
      this.setDataBadge(status.up === status.total ? 'live' : 'cached', `${status.up}/${status.total} up`);
    } else if (admin) {
      this.setCount(admin.services.length);
      this.setDataBadge(admin.up === admin.total ? 'live' : 'cached', `${admin.up}/${admin.total} up`);
    }

    const sections = [
      status ? this.statusSection(status) : '',
      admin ? this.adminSection(admin) : '',
    ].join('');
    this.setContent(`<div class="cloud-services">${sections}</div>`);
  }

  // ── public status.hanzo.ai board + incidents ──────────────────────────────

  private statusSection(s: StatusPage): string {
    const allUp = s.up === s.total;
    const incidents = s.incidents.length ? `
      <div class="cloud-subhead">${icon('activity', 12)} Active incidents · ${s.incidents.length}</div>
      <div class="cloud-svc-list">${s.incidents.map((i) => this.incidentRow(i)).join('')}</div>` : '';
    const board = s.services.map((svc) => this.statusRow(svc)).join('');
    return `
      <div class="cloud-overview-head">
        <span class="cloud-scope">${icon('activity', 13)} ${escapeHtml(s.source || 'status')} · ${s.up}/${s.total} operational</span>
        <span class="cloud-live-note">${allUp ? 'all systems go' : 'incident open'}</span>
      </div>
      ${incidents}
      <div class="cloud-svc-list">${board}</div>`;
  }

  private statusRow(s: StatusPageService): string {
    const cls = s.up ? 'online' : 'offline';
    const name = s.group ? `${s.group} · ${s.name}` : s.name;
    const latency = s.latencyMs > 0
      ? `<span class="cloud-svc-metric">${fmtMs(s.latencyMs)}<span class="cloud-unit">resp</span></span>`
      : '';
    return `<div class="cloud-svc-row">
      <span class="cloud-status-dot ${cls}"></span>
      <span class="cloud-svc-name">${escapeHtml(name)}</span>
      <span class="cloud-svc-metrics">${latency}</span>
    </div>`;
  }

  private incidentRow(i: StatusIncident): string {
    const name = i.group ? `${i.group} · ${i.name}` : i.name;
    const detail = i.error
      ? `<span class="cloud-svc-metric cloud-svc-nodata">${escapeHtml(i.error)}</span>`
      : '';
    const since = i.since ? `<span class="cloud-svc-metric">${escapeHtml(this.ago(i.since))}</span>` : '';
    return `<div class="cloud-svc-row">
      <span class="cloud-status-dot offline"></span>
      <span class="cloud-svc-name">${escapeHtml(name)}</span>
      <span class="cloud-svc-metrics">${detail}${since}</span>
    </div>`;
  }

  /** Compact "since" for an incident onset ("3m", "2h", "1d"), degrading to the
   * raw date if unparseable. Purely display — never throws. */
  private ago(iso: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return iso;
    const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (secs < 90) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 90) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 36) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  // ── admin o11y RED metrics ─────────────────────────────────────────────────

  private adminSection(d: CloudServices): string {
    const rows = d.services
      .slice()
      .sort((a, b) => Number(b.up) - Number(a.up) || b.requests - a.requests)
      .map((s) => this.row(s))
      .join('');
    return `
      <div class="cloud-overview-head">
        <span class="cloud-scope">${icon('box', 13)} ${d.total} subsystems · ${d.up} operational</span>
        <span class="cloud-live-note">o11y · ${escapeHtml(d.window)}</span>
      </div>
      <div class="cloud-svc-list">${rows}</div>`;
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
