import { Panel } from './Panel';
import { getCloudPulse, type CloudPulse } from '@/services/cloud-pulse';
import { fmtCompact, fmtInt, fmtPct, statTile, sparkline, demoNote } from '@/utils/cloud-format';

// Platform-wide overview — the investor hero tile. Always renders the public
// aggregate (/v1/world/cloud-pulse): demo-flagged unless a service token is
// wired server-side. The org's own real numbers live in the Fleet / Model Usage
// / My Usage panels (separation of concerns).
export class CloudOverviewPanel extends Panel {
  private pulse: CloudPulse | null = null;
  private error: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'cloud-overview', title: 'Cloud Overview', showCount: false, className: 'panel-wide cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 30_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    try {
      this.pulse = await getCloudPulse();
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'failed';
    }
    this.render();
  }

  private render(): void {
    if (!this.pulse && this.error) { this.showError(this.error); return; }
    if (!this.pulse) { this.showLoading('Loading cloud metrics…'); return; }
    const p = this.pulse;
    const o = p.overview;

    if (p.demo) this.setDataBadge('unavailable', 'demo'); else this.setDataBadge('live', p.source);

    const tiles = [
      statTile(fmtCompact(o.requestsPerSec), 'requests / sec', p.volumeModeled ? 'modeled' : undefined),
      statTile(fmtCompact(o.requests24h), `requests / ${p.window}`),
      statTile(fmtCompact(o.tokens24h), `tokens / ${p.window}`),
      statTile(fmtInt(o.modelsServed), 'models served'),
      statTile(`${fmtInt(o.nodesOnline)}/${fmtInt(o.nodesTotal)}`, 'nodes online'),
      statTile(fmtInt(o.gpusOnline), 'GPUs online'),
      statTile(fmtInt(o.regions), 'regions'),
      statTile(fmtPct(o.uptimePct), 'uptime'),
    ].join('');

    this.setContent(`
      <div class="cloud-overview">
        <div class="cloud-overview-head">
          <span class="cloud-scope">Global platform</span>
          ${p.demo ? demoNote() : `<span class="cloud-live-note">live · ${p.source}</span>`}
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-8">${tiles}</div>
        <div class="cloud-spark-row">
          <span class="cloud-spark-label">requests · last ${p.requestSeries.length}h</span>
          <span class="cloud-spark-wrap">${sparkline(p.requestSeries, 220, 30)}</span>
        </div>
      </div>
    `);
  }
}
