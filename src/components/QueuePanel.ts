import { Panel } from './Panel';
import { getCloudQueue, type CloudQueue, type QueueJob, type QueueService } from '@/services/cloud-admin';
import { escapeHtml } from '@/utils/sanitize';
import { fmtInt, fmtAgo, statTile, adminOnlyState } from '@/utils/cloud-format';
import { icon } from '@/utils/icons';

// GPU Queue — the SuperAdmin view of the platform's GPU job queue (gpu-jobs): how
// deep it is, what's RUNNING right now (each job with the service that dispatched
// it, the worker claiming it, and the target model), what's pending, and the online
// worker count. Real, live: /v1/world/cloud/queue aggregates the tasks engine +
// fleet workers (server enforces owner==admin, fail-closed 403). Refreshes every
// 15s — a queue moves faster than the fleet. Honest empty state, never a fake job.
export class QueuePanel extends Panel {
  private data: CloudQueue | null = null;
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'cloud-queue', title: 'GPU Queue', showCount: true, className: 'cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 15_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    this.data = await getCloudQueue();
    this.loaded = true;
    this.render();
  }

  private render(): void {
    if (!this.loaded) { this.showLoading('Reading queue…'); return; }
    const d = this.data;
    if (!d) { this.clearDataBadge(); this.setCount(0); this.setContent(adminOnlyState('The GPU job queue')); return; }
    if (!d.available) {
      this.clearDataBadge();
      this.setCount(0);
      this.setContent(`<div class="cloud-empty">${escapeHtml(d.note || 'The GPU job queue is unavailable right now.')}</div>`);
      return;
    }
    const active = d.depth.running + d.depth.pending;
    this.setCount(active);
    this.setDataBadge(d.depth.running > 0 ? 'live' : 'cached', `${d.depth.running} running · ${d.depth.pending} queued`);

    const services = d.services.length ? `
      <div class="cloud-subhead">${icon('layers', 12)} By service</div>
      <div class="cloud-svc-list">${d.services.map((s) => this.serviceRow(s)).join('')}</div>` : '';
    const running = d.running.length ? `
      <div class="cloud-subhead">${icon('zap', 12)} Running now · ${d.running.length}</div>
      ${d.running.map((j) => this.jobRow(j, true)).join('')}` : '';
    const pending = d.pending.length ? `
      <div class="cloud-subhead">${icon('circle-dot', 12)} Queued · ${d.pending.length}</div>
      ${d.pending.slice(0, 8).map((j) => this.jobRow(j, false)).join('')}` : '';
    const recent = d.recent.length ? `
      <div class="cloud-subhead">${icon('activity', 12)} Recent · ${d.recent.length}</div>
      ${d.recent.slice(0, 6).map((j) => this.jobRow(j, false)).join('')}` : '';
    const empty = active === 0 && d.recent.length === 0
      ? `<div class="cloud-empty">No GPU jobs in the queue right now — they appear live as services dispatch work to the fleet.</div>` : '';

    this.setContent(`
      <div class="cloud-queue">
        <div class="cloud-overview-head">
          <span class="cloud-scope">${icon('cpu', 13)} ${escapeHtml(d.namespace)} · ${fmtInt(d.workers.online)}/${fmtInt(d.workers.total)} workers online</span>
          <span class="cloud-live-note">live · tasks</span>
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-4">${this.tiles(d)}</div>
        ${services}${running}${pending}${recent}${empty}
      </div>
    `);
  }

  private tiles(d: CloudQueue): string {
    return [
      statTile(fmtInt(d.depth.running), 'running'),
      statTile(fmtInt(d.depth.pending), 'queued'),
      statTile(`${fmtInt(d.workers.online)}/${fmtInt(d.workers.total)}`, 'workers'),
      statTile(fmtInt(d.depth.failed), 'failed'),
    ].join('');
  }

  private serviceRow(s: QueueService): string {
    return `<div class="cloud-svc-row">
      <span class="cloud-status-dot ${s.running > 0 ? 'online' : 'degraded'}"></span>
      <span class="cloud-svc-name">${escapeHtml(s.service)}</span>
      <span class="cloud-svc-metrics">
        <span class="cloud-svc-metric">${fmtInt(s.running)}<span class="cloud-unit">run</span></span>
        <span class="cloud-svc-metric">${fmtInt(s.pending)}<span class="cloud-unit">queued</span></span>
      </span>
    </div>`;
  }

  // One job line: service badge + what it is + (for running) the worker→model it
  // serves, else its queued/terminal status and age.
  private jobRow(j: QueueJob, running: boolean): string {
    const dotCls = running ? 'online cloud-pulse-dot' : j.status === 'failed' ? 'offline' : j.status === 'done' ? 'online' : 'degraded';
    const serving = running
      ? `${j.worker ? escapeHtml(j.worker) : 'claiming'}${j.model ? ` → ${escapeHtml(j.model)}` : ''}`
      : `${escapeHtml(j.status)}${j.attempt > 1 ? ` · try ${j.attempt}` : ''}`;
    const when = fmtAgo(running ? j.startedAt : (j.closedAt || j.startedAt));
    return `<div class="cloud-queue-job">
      <span class="cloud-status-dot ${dotCls}"></span>
      <span class="cloud-queue-what"><span class="cloud-queue-svc">${escapeHtml(j.service)}</span>${escapeHtml(j.type)}</span>
      <span class="cloud-queue-meta">${serving} · ${escapeHtml(when)}</span>
    </div>`;
  }
}
