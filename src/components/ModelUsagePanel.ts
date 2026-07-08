import { Panel } from './Panel';
import { getCloudPulse, getMyModels, type CloudPulse, type ServedModel } from '@/services/cloud-pulse';
import { escapeHtml } from '@/utils/sanitize';
import { fmtCompact, shareBar, demoNote } from '@/utils/cloud-format';

// Per-model usage. The ranked usage bars come from the platform aggregate
// (/v1/world/cloud-pulse) — demo-flagged, because no public per-model usage
// time-series endpoint exists. When signed in we ALSO fetch the caller's real
// available-model list (/v1/models) and surface that real count + tag the rows
// the org can actually call. Two clearly-separated facts, neither faked.
export class ModelUsagePanel extends Panel {
  private pulse: CloudPulse | null = null;
  private mine: ServedModel[] | null = null;
  private error: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'model-usage', title: 'Model Usage', showCount: false, className: 'cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 60_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    try {
      const [pulse, mine] = await Promise.all([getCloudPulse(), getMyModels()]);
      this.pulse = pulse;
      this.mine = mine;
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'failed';
    }
    this.render();
  }

  private render(): void {
    if (!this.pulse && this.error) { this.showError(this.error); return; }
    if (!this.pulse) { this.showLoading('Loading model usage…'); return; }
    const p = this.pulse;
    const mineIds = new Set((this.mine ?? []).map((m) => m.id));
    const max = Math.max(...p.models.map((m) => m.requests24h), 1);

    const rows = p.models.map((m) => {
      const yours = mineIds.has(m.id);
      return `<div class="cloud-model-row">
        <div class="cloud-model-head">
          <span class="cloud-model-name">${escapeHtml(m.name)}${yours ? '<span class="cloud-tag">yours</span>' : ''}</span>
          <span class="cloud-model-req">${fmtCompact(m.requests24h)}<span class="cloud-unit">req</span></span>
        </div>
        ${shareBar(m.requests24h / max)}
        <div class="cloud-model-sub">${fmtCompact(m.tokens24h)} tokens · ${(m.share * 100).toFixed(0)}% share</div>
      </div>`;
    }).join('');

    const available = this.mine !== null
      ? `<span class="cloud-live-note">${this.mine.length} available to you</span>`
      : '';

    this.setContent(`
      <div class="cloud-models">
        <div class="cloud-overview-head">
          <span class="cloud-scope">${p.overview.modelsServed} models served${p.window ? ` · ${p.window}` : ''}</span>
          ${available}
          ${p.demo ? demoNote('usage: demo') : ''}
        </div>
        <div class="cloud-model-list">${rows}</div>
      </div>
    `);
  }
}
