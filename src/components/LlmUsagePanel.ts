import { Panel } from './Panel';
import { getCloudLLM, type CloudLLM } from '@/services/cloud-admin';
import { escapeHtml } from '@/utils/sanitize';
import { fmtCompact, fmtInt, fmtUsd, fmtMs, statTile, shareBar, sparkline, adminOnlyState } from '@/utils/cloud-format';
import { icon } from '@/utils/icons';

const RANGES = ['24h', '7d', '30d'];

// Platform LLM observability — per-model + per-org usage, tokens, cost, errors,
// trace latency (p50/p95/p99), over time. REAL: cloud /v1/admin/o11y (the
// hanzo.cloud_usage ledger + trace RED). Admin-only (double-gated: world verifies
// owner==admin, cloud re-verifies global-admin). Honest state when the session
// lacks a cloud global-admin token.
export class LlmUsagePanel extends Panel {
  private data: CloudLLM | null = null;
  private loaded = false;
  private range = '24h';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'llm-usage', title: 'LLM observability', showCount: false, className: 'panel-wide cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 60_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    this.data = await getCloudLLM(this.range);
    this.loaded = true;
    this.render();
  }

  private render(): void {
    if (!this.loaded) { this.showLoading('Loading LLM metrics…'); return; }
    if (!this.data) {
      this.clearDataBadge();
      this.setContent(adminOnlyState('Platform LLM observability'));
      return;
    }
    const d = this.data;
    if (!d.available || !d.data) {
      this.setDataBadge('unavailable', 'admin token');
      this.setContent(`${this.rangeBar()}<div class="cloud-empty">${escapeHtml(d.note || 'Not available.')}</div>`);
      this.wireRange();
      return;
    }
    this.setDataBadge('live', `o11y · ${d.range}`);
    const g = d.data;

    const tiles = [
      statTile(fmtCompact(g.totals.requests), `requests · ${d.range}`),
      statTile(fmtCompact(g.totals.tokens), 'tokens'),
      statTile(fmtUsd(g.totals.costCents), 'spend'),
      statTile(fmtInt(g.totals.errors), 'errors'),
      statTile(fmtMs(g.totals.latencyP95Ms), 'p95 latency'),
      statTile(fmtInt(g.totals.orgs), 'active orgs'),
    ].join('');

    const series = (g.series || []).map((p) => p.requests);
    const spark = series.length > 1
      ? `<div class="cloud-spark-row"><span class="cloud-spark-label">requests · ${d.range}</span><span class="cloud-spark-wrap">${sparkline(series, 240, 30)}</span></div>`
      : '';

    const maxModel = Math.max(...(g.topModels || []).map((m) => m.requests), 1);
    const models = (g.topModels || []).slice(0, 8).map((m) => `<div class="cloud-an-row">
      <span class="cloud-an-label" title="${escapeHtml(m.model)}">${escapeHtml(m.model)}</span>
      <span class="cloud-an-bar">${shareBar(m.requests / maxModel)}</span>
      <span class="cloud-an-val">${fmtCompact(m.requests)}</span>
    </div>`).join('') || '<div class="cloud-empty">No model traffic.</div>';

    const maxOrg = Math.max(...(g.topOrgs || []).map((o) => o.costCents), 1);
    const orgs = (g.topOrgs || []).slice(0, 8).map((o) => `<div class="cloud-an-row">
      <span class="cloud-an-label" title="${escapeHtml(o.org)}">${escapeHtml(o.org)}</span>
      <span class="cloud-an-bar">${shareBar(o.costCents / maxOrg)}</span>
      <span class="cloud-an-val">${fmtUsd(o.costCents)}</span>
    </div>`).join('') || '<div class="cloud-empty">No org spend.</div>';

    this.setContent(`
      <div class="cloud-llm">
        <div class="cloud-overview-head">
          <span class="cloud-scope">${icon('sparkles', 13)} platform-wide inference</span>
          ${this.rangeBar()}
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-6">${tiles}</div>
        ${spark}
        <div class="cloud-an-grid">
          <div class="cloud-an-col"><div class="cloud-subhead">${icon('box', 12)} Top models</div>${models}</div>
          <div class="cloud-an-col"><div class="cloud-subhead">${icon('users', 12)} Top orgs by spend</div>${orgs}</div>
        </div>
      </div>
    `);
    this.wireRange();
  }

  private rangeBar(): string {
    return `<span class="cloud-range">${RANGES.map((r) =>
      `<button type="button" class="cloud-range-btn ${r === this.range ? 'active' : ''}" data-range="${r}">${r}</button>`).join('')}</span>`;
  }

  private wireRange(): void {
    this.content.querySelectorAll<HTMLElement>('.cloud-range-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const r = b.dataset.range || '24h';
        if (r === this.range) return;
        this.range = r;
        this.loaded = false;
        this.showLoading('Loading LLM metrics…');
        void this.fetchData();
      });
    });
  }
}
