import { Panel } from './Panel';
import { getStatusPage, type StatusPage, type StatusPageService, type StatusIncident } from '@/services/cloud-admin';
import { escapeHtml } from '@/utils/sanitize';
import { fmtMs, fmtAgo } from '@/utils/cloud-format';
import { icon } from '@/utils/icons';

const STATUS_URL = 'https://status.hanzo.ai';

// Full Hanzo platform status board — a NATIVE monochrome render of the live
// status page (status.hanzo.ai / Gatus), NOT an iframe. It reads the same-origin
// /v1/world/cloud/status-page summary (getStatusPage), so it inherits the
// backend's allowlist + cache + never-5xx contract and matches the rest of the
// Cloud dashboard's look. Services are shown grouped (AI, Apps, Commerce, …) with
// a per-service up/down dot + response time; any failing services surface first
// as active incidents. One data source, one style — no embedded-page jank.
export class HanzoStatusPanel extends Panel {
  private data: StatusPage | null = null;
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'hanzo-status', title: 'Hanzo Status', showCount: true, className: 'panel-wide cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 30_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    this.data = await getStatusPage();
    this.loaded = true;
    this.render();
  }

  private render(): void {
    if (!this.loaded) { this.showLoading('Loading status…'); return; }
    const d = this.data;
    if (!d || !d.available || d.total === 0) {
      this.clearDataBadge();
      this.setCount(0);
      const src = d?.source || 'status.hanzo.ai';
      this.setContent(`<div class="cloud-services">
        <div class="cloud-overview-head">
          <span class="cloud-scope">${icon('activity', 13)} ${escapeHtml(src)}</span>
          <a class="cloud-live-note" href="${STATUS_URL}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">full page &#8599;</a>
        </div>
        <div class="cloud-admin-gate-body" style="padding:12px 4px;">Status page unreachable right now — services will appear once it responds.</div>
      </div>`);
      return;
    }

    const allUp = d.up === d.total;
    this.setCount(d.total);
    this.setDataBadge(allUp ? 'live' : 'cached', `${d.up}/${d.total} up`);

    const incidents = d.incidents.length ? `
      <div class="cloud-subhead">${icon('activity', 12)} Active incidents · ${d.incidents.length}</div>
      <div class="cloud-svc-list">${d.incidents.map((i) => this.incidentRow(i)).join('')}</div>` : '';

    this.setContent(`
      <div class="cloud-services">
        <div class="cloud-overview-head">
          <span class="cloud-scope">${icon('activity', 13)} ${escapeHtml(d.source || 'status')} · ${d.up}/${d.total} operational</span>
          <a class="cloud-live-note" href="${STATUS_URL}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">${allUp ? 'all systems go' : 'incident open'} &#8599;</a>
        </div>
        ${incidents}
        ${this.groupedBoard(d.services)}
      </div>`);
  }

  // Full board grouped by service group (AI, Apps, …), each group's services in
  // name order — the natural Gatus layout, rendered in our own row style.
  private groupedBoard(services: StatusPageService[]): string {
    const groups = new Map<string, StatusPageService[]>();
    for (const s of services.slice().sort((a, b) => this.cmp(a, b))) {
      const g = s.group || 'Services';
      let arr = groups.get(g);
      if (!arr) { arr = []; groups.set(g, arr); }
      arr.push(s);
    }
    let html = '';
    for (const [group, rows] of groups) {
      const up = rows.filter((r) => r.up).length;
      html += `<div class="cloud-subhead">${escapeHtml(group)} · ${up}/${rows.length}</div>
        <div class="cloud-svc-list">${rows.map((r) => this.serviceRow(r)).join('')}</div>`;
    }
    return html;
  }

  private cmp(a: StatusPageService, b: StatusPageService): number {
    return (a.group || '').localeCompare(b.group || '') || a.name.localeCompare(b.name);
  }

  private serviceRow(s: StatusPageService): string {
    const cls = s.up ? 'online' : 'offline';
    const latency = s.latencyMs > 0
      ? `<span class="cloud-svc-metric">${fmtMs(s.latencyMs)}<span class="cloud-unit">resp</span></span>`
      : '';
    return `<div class="cloud-svc-row">
      <span class="cloud-status-dot ${cls}"></span>
      <span class="cloud-svc-name">${escapeHtml(s.name)}</span>
      <span class="cloud-svc-metrics">${latency}</span>
    </div>`;
  }

  private incidentRow(i: StatusIncident): string {
    const name = i.group ? `${i.group} · ${i.name}` : i.name;
    const detail = i.error ? `<span class="cloud-svc-metric cloud-svc-nodata">${escapeHtml(i.error)}</span>` : '';
    const since = i.since ? `<span class="cloud-svc-metric">${escapeHtml(fmtAgo(i.since))}</span>` : '';
    return `<div class="cloud-svc-row">
      <span class="cloud-status-dot offline"></span>
      <span class="cloud-svc-name">${escapeHtml(name)}</span>
      <span class="cloud-svc-metrics">${detail}${since}</span>
    </div>`;
  }
}
