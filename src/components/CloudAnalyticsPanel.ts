import { Panel } from './Panel';
import { getCloudAnalytics, type CloudAnalytics, type AnalyticsMetric } from '@/services/cloud-admin';
import { escapeHtml } from '@/utils/sanitize';
import { fmtCompact, fmtInt, statTile, shareBar, adminOnlyState } from '@/utils/cloud-format';
import { icon } from '@/utils/icons';

// Web analytics for global Hanzo Cloud — the insights.hanzo.ai / analytics.hanzo.ai
// merge. REAL: proxied from the standalone analytics product (analytics.hanzo.ai,
// Umami-style) across every registered site — top pages / referrers / countries,
// live visitors, pageviews. Admin-only (server enforces 403). Honest empty state
// when the analytics product has no data yet.
export class CloudAnalyticsPanel extends Panel {
  private data: CloudAnalytics | null = null;
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'cloud-analytics', title: 'Web analytics', showCount: false, className: 'panel-wide cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), 60_000);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    this.data = await getCloudAnalytics();
    this.loaded = true;
    this.render();
  }

  private list(title: string, ic: Parameters<typeof icon>[0], rows: AnalyticsMetric[]): string {
    const max = Math.max(...rows.map((r) => r.y), 1);
    const items = rows.length
      ? rows.map((r) => `<div class="cloud-an-row">
          <span class="cloud-an-label" title="${escapeHtml(r.x)}">${escapeHtml(r.x)}</span>
          <span class="cloud-an-bar">${shareBar(r.y / max)}</span>
          <span class="cloud-an-val">${fmtCompact(r.y)}</span>
        </div>`).join('')
      : '<div class="cloud-empty">No data yet.</div>';
    return `<div class="cloud-an-col">
      <div class="cloud-subhead">${icon(ic, 12)} ${escapeHtml(title)}</div>
      ${items}
    </div>`;
  }

  private render(): void {
    if (!this.loaded) { this.showLoading('Loading analytics…'); return; }
    if (!this.data) {
      this.clearDataBadge();
      this.setContent(adminOnlyState('Global web analytics'));
      return;
    }
    const d = this.data;
    if (!d.available) {
      this.setDataBadge('unavailable', 'no data');
      this.setContent(`<div class="cloud-empty">${escapeHtml(d.note || 'Analytics unavailable.')}</div>`);
      return;
    }
    this.setDataBadge('live', `${d.sites.length} sites`);

    const tiles = [
      statTile(fmtCompact(d.pageviews), `pageviews · ${d.window}`),
      statTile(fmtCompact(d.visitors), `visitors · ${d.window}`),
      statTile(fmtInt(d.activeNow), 'active now'),
    ].join('');

    this.setContent(`
      <div class="cloud-analytics">
        <div class="cloud-overview-head">
          <span class="cloud-scope">${icon('bar-chart', 13)} all Hanzo sites</span>
          <span class="cloud-live-note">live · ${escapeHtml(d.window)}</span>
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-3">${tiles}</div>
        <div class="cloud-an-grid">
          ${this.list('Top pages', 'layers', d.topPages)}
          ${this.list('Top referrers', 'network', d.topReferrers)}
          ${this.list('Top countries', 'globe', d.topCountries)}
        </div>
      </div>
    `);
  }
}
