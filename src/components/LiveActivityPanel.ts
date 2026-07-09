import { Panel } from './Panel';
import { getCloudPulse, type CloudPulse } from '@/services/cloud-pulse';
import { escapeHtml } from '@/utils/sanitize';
import { fmtCompact, fmtInt, sparkline, demoNote } from '@/utils/cloud-format';

// Live request-rate ticker. No request-rate SSE/WS endpoint exists (verified),
// so it polls /v1/world/cloud-pulse and keeps a client-side rolling buffer so
// the number and sparkline visibly move each poll. Demo-flagged whenever the
// pulse is demo — the ticker never implies live traffic it does not have.
export class LiveActivityPanel extends Panel {
  private pulse: CloudPulse | null = null;
  private buffer: number[] = [];
  private error: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private static readonly POLL_MS = 5_000;
  private static readonly BUF = 60;

  constructor() {
    super({ id: 'live-activity', title: 'Live Activity', showCount: false, className: 'cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), LiveActivityPanel.POLL_MS);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    try {
      this.pulse = await getCloudPulse();
      this.error = null;
      this.buffer.push(this.pulse.overview.requestsPerSec);
      if (this.buffer.length > LiveActivityPanel.BUF) this.buffer.shift();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'failed';
    }
    this.render();
  }

  private render(): void {
    if (!this.pulse && this.error) { this.showError(this.error); return; }
    if (!this.pulse) { this.showLoading('Connecting…'); return; }
    const p = this.pulse;
    // Live badge only when the pulse is real. A demo pulse drops the badge instead
    // of wearing an "UNAVAILABLE · demo" tag — the honest flag stays in the payload
    // (p.demo) and the quiet footer note, not as header jewelry.
    if (p.demo) this.clearDataBadge();
    else this.setDataBadge('live', 'polled');

    const topRegions = p.regions
      .slice()
      .sort((a, b) => b.requestsPerSec - a.requestsPerSec)
      .slice(0, 5);
    const maxR = Math.max(...topRegions.map((r) => r.requestsPerSec), 1);
    const regionRows = topRegions.map((r) => `
      <div class="cloud-activity-region">
        <span class="cloud-activity-rname">${escapeHtml(r.name)}</span>
        <span class="cloud-activity-rbar"><span style="width:${((r.requestsPerSec / maxR) * 100).toFixed(0)}%"></span></span>
        <span class="cloud-activity-rrate">${fmtCompact(r.requestsPerSec)}/s</span>
      </div>`).join('');

    const spark = this.buffer.length >= 2 ? sparkline(this.buffer, 240, 34) : '';

    this.setContent(`
      <div class="cloud-activity">
        <div class="cloud-activity-head">
          <div class="cloud-activity-big">
            <span class="cloud-activity-num" id="cloudRps">${fmtInt(p.overview.requestsPerSec)}</span>
            <span class="cloud-activity-unit">requests / sec</span>
          </div>
          <span class="cloud-activity-pulse${p.demo ? '' : ' on'}"></span>
        </div>
        <div class="cloud-activity-spark">${spark}</div>
        <div class="cloud-activity-regions">${regionRows}</div>
        <div class="cloud-overview-head cloud-activity-foot">
          <span class="cloud-scope">${fmtCompact(p.overview.requests24h)} requests · ${p.window}</span>
          ${p.demo ? demoNote() : `<span class="cloud-live-note">live · ${p.source}</span>`}
        </div>
      </div>
    `);
  }
}
