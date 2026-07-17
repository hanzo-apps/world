import { Panel } from './Panel';
import { getCloudPulse, type CloudPulse } from '@/services/cloud-pulse';
import { escapeHtml } from '@/utils/sanitize';
import { fmtCompact, fmtInt, sparkline } from '@/utils/cloud-format';

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
      // Only buffer a REAL rate — an empty/warming pulse must not seed the ticker
      // with fabricated-looking zeros.
      if (!this.pulse.demo) {
        this.buffer.push(this.pulse.overview.requestsPerSec);
        if (this.buffer.length > LiveActivityPanel.BUF) this.buffer.shift();
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'failed';
    }
    this.render();
  }

  private render(): void {
    if (!this.pulse && this.error) { this.showError(this.error); return; }
    if (!this.pulse) { this.showLoading('Connecting…'); return; }
    const p = this.pulse;
    // Live badge only when the rate is the exact MEASURED ledger volume. demo
    // (nothing measured) OR volumeModeled (real public rate, but not the full
    // ledger) both drop it — never a live tag over a not-fully-measured number.
    const live = !p.demo && !p.volumeModeled;
    if (live) this.setDataBadge('live', 'polled');
    else this.clearDataBadge();

    // Region breakdown = REAL fleet-by-region from the visor (node counts). There is
    // no measured per-region request rate, so we never invent one; an empty region
    // set (no service token) hides the section instead of showing zeros.
    const topRegions = p.regions
      .slice()
      .sort((a, b) => b.nodes - a.nodes)
      .slice(0, 5);
    const maxR = Math.max(...topRegions.map((r) => r.nodes), 1);
    const regionRows = topRegions.map((r) => `
      <div class="cloud-activity-region">
        <span class="cloud-activity-rname">${escapeHtml(r.name)}</span>
        <span class="cloud-activity-rbar"><span style="width:${((r.nodes / maxR) * 100).toFixed(0)}%"></span></span>
        <span class="cloud-activity-rrate">${fmtInt(r.nodes)} nodes</span>
      </div>`).join('');

    const spark = this.buffer.length >= 2 ? sparkline(this.buffer, 240, 34) : '';
    // Headline shows a real rate or an honest "—" (never a fabricated 0).
    const big = p.demo ? '—' : fmtInt(p.overview.requestsPerSec);
    const foot = live
      ? `<span class="cloud-live-note">live · ${escapeHtml(p.source)}</span>`
      : (p.demo ? '' : `<span class="cloud-live-note">measured · ${escapeHtml(p.source)}</span>`);

    this.setContent(`
      <div class="cloud-activity">
        <div class="cloud-activity-head">
          <div class="cloud-activity-big">
            <span class="cloud-activity-num" id="cloudRps">${big}</span>
            <span class="cloud-activity-unit">requests / sec</span>
          </div>
          <span class="cloud-activity-pulse${live ? ' on' : ''}"></span>
        </div>
        <div class="cloud-activity-spark">${spark}</div>
        <div class="cloud-activity-regions">${regionRows}</div>
        <div class="cloud-overview-head cloud-activity-foot">
          <span class="cloud-scope">${p.demo ? 'warming up' : `${fmtCompact(p.overview.requests24h)} requests · ${p.window}`}</span>
          ${foot}
        </div>
      </div>
    `);
  }
}
