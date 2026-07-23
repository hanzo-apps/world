import { Panel } from './Panel';
import { isAuthenticated, login } from '@/services/iam';
import {
  getAnalyticsOverview,
  getAnalyticsTimeseries,
  getAnalyticsTop,
  type AnalyticsOverview,
  type AnalyticsTimeseries,
  type AnalyticsTop,
} from '@/services/analytics';
import { escapeHtml } from '@/utils/sanitize';
import { fmtCompact, fmtInt, fmtPct, fmtUsd, statTile, sparkline, shareBar } from '@/utils/cloud-format';

// Per-org Analytics — the caller's OWN web/event analytics over the native
// analytics warehouse (api.hanzo.ai /v1/analytics/*). REAL, org-scoped: the org
// is pinned server-side from the validated bearer's owner claim. Renders the
// aggregated read lens — requests/events, unique visitors, tokens/spend, a
// requests trend, and the top models (the real "top sources" of the org's usage).
// Every lens is honest: the LLM lens shows measured numbers, the web lens shows
// visitors/pageviews only when the events collector has emitted them, and an org
// with no data in the window gets a clean empty state — never fabricated numbers.
export class OrgAnalyticsPanel extends Panel {
  private overview: AnalyticsOverview | null = null;
  private series: AnalyticsTimeseries | null = null;
  private top: AnalyticsTop | null = null;
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private static readonly RANGE = '7d';
  private static readonly POLL_MS = 60_000;

  constructor() {
    super({ id: 'org-analytics', title: 'Analytics', showCount: false, className: 'panel-wide cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), OrgAnalyticsPanel.POLL_MS);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    if (!isAuthenticated()) { this.loaded = true; this.renderSignedOut(); return; }
    const r = OrgAnalyticsPanel.RANGE;
    const [overview, series, top] = await Promise.all([
      getAnalyticsOverview(r),
      getAnalyticsTimeseries(r),
      getAnalyticsTop(r),
    ]);
    this.overview = overview;
    this.series = series;
    this.top = top;
    this.loaded = true;
    this.render();
  }

  private renderSignedOut(): void {
    this.clearDataBadge();
    this.setContent(`
      <div class="cloud-signin">
        <div class="cloud-signin-title">Your analytics</div>
        <div class="cloud-signin-body">Sign in to see your org's real requests, visitors and top models — scoped to your account, no shared keys.</div>
        <button type="button" class="cloud-signin-btn" id="orgAnalyticsSigninBtn">Sign in</button>
      </div>
    `);
    this.content.querySelector('#orgAnalyticsSigninBtn')?.addEventListener('click', () => void login());
  }

  private topModels(): string {
    const t = this.top?.models;
    if (!t || !t.available || t.items.length === 0) return '';
    const rows = t.items.map((m) => {
      const sub = [
        m.tokens > 0 ? `${fmtCompact(m.tokens)} tokens` : '',
        m.spendCents > 0 ? fmtUsd(m.spendCents) : '',
        m.provider ? escapeHtml(m.provider) : '',
      ].filter(Boolean).join(' · ');
      return `<div class="cloud-model-row">
        <div class="cloud-model-head">
          <span class="cloud-model-name">${escapeHtml(m.model)}</span>
          <span class="cloud-model-req">${fmtInt(m.requests)}<span class="cloud-unit"> req</span></span>
        </div>
        ${shareBar(m.pct / 100)}
        ${sub ? `<div class="cloud-model-sub">${sub}</div>` : ''}
      </div>`;
    }).join('');
    return `<div class="cloud-subhead">Top models · ${OrgAnalyticsPanel.RANGE}</div>
      <div class="cloud-model-list">${rows}</div>`;
  }

  private render(): void {
    if (!this.loaded) { this.showLoading('Loading your analytics…'); return; }
    const o = this.overview;
    if (!o) {
      this.setDataBadge('unavailable');
      this.setContent('<div class="cloud-empty">Analytics is not available for this account yet.</div>');
      return;
    }
    const win = o.range || OrgAnalyticsPanel.RANGE;
    const hasLLM = o.llm.requests > 0;
    const hasWeb = o.web.available && (o.web.pageviews > 0 || o.web.visitors > 0 || o.web.sessions > 0);

    // Honest-empty: the warehouse answered but this org has no usage/events in the
    // window. A live dot (datastore is up) over a clean "nothing yet" line.
    if (!hasLLM && !hasWeb) {
      this.setDataBadge('live', 'no data');
      this.setContent(`
        <div class="cloud-overview">
          <div class="cloud-overview-head">
            <span class="cloud-scope">your org · ${escapeHtml(win)}</span>
          </div>
          <div class="cloud-empty">No requests or site events in the last ${escapeHtml(win)} yet — your org's API usage and web analytics will appear here.</div>
        </div>
      `);
      return;
    }

    this.setDataBadge('live', 'your org');

    // Tiles: only real, measured values. Requests headlines; visitors/pageviews
    // appear only when the web lens has emitted; tokens/spend only when non-zero.
    const tiles = [
      hasLLM ? statTile(fmtCompact(o.llm.requests), `requests · ${win}`) : '',
      hasWeb ? statTile(fmtCompact(o.web.visitors), `visitors · ${win}`) : '',
      hasWeb && o.web.pageviews > 0 ? statTile(fmtCompact(o.web.pageviews), `pageviews · ${win}`) : '',
      o.llm.tokens > 0 ? statTile(fmtCompact(o.llm.tokens), `tokens · ${win}`) : '',
      o.llm.spendCents > 0 ? statTile(fmtUsd(o.llm.spendCents), `spend · ${win}`) : '',
      hasLLM ? statTile(fmtPct(o.llm.errorRate * 100, 1), 'error rate', o.llm.models > 0 ? `${fmtInt(o.llm.models)} models` : undefined) : '',
    ].filter(Boolean).join('');

    // Requests trend from the gap-filled series — only a real, non-flat line.
    const reqSeries = (this.series?.series ?? []).map((p) => p.requests);
    const sparkRow = reqSeries.length >= 2 && reqSeries.some((v) => v > 0)
      ? `<div class="cloud-spark-row">
          <span class="cloud-spark-label">requests · ${escapeHtml(win)}</span>
          <span class="cloud-spark-wrap">${sparkline(reqSeries, 220, 30)}</span>
        </div>`
      : '';

    this.setContent(`
      <div class="cloud-overview">
        <div class="cloud-overview-head">
          <span class="cloud-scope">your org · ${escapeHtml(win)}</span>
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-3">${tiles}</div>
        ${sparkRow}
        ${this.topModels()}
      </div>
    `);
  }
}
