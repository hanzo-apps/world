import { Panel } from './Panel';
import { isAuthenticated, login } from '@/services/iam';
import { getInsightsEvents, type InsightsEvent } from '@/services/analytics';
import { escapeHtml } from '@/utils/sanitize';
import { fmtInt, statTile, sparkline, shareBar, fmtAgo } from '@/utils/cloud-format';

// Per-org Insights — the caller's OWN product analytics over the native insights
// event stream (api.hanzo.ai /v1/insights/events, PostHog-wire compatible). REAL,
// org-scoped: the org is pinned server-side from the validated bearer's owner
// claim. From the most-recent events it derives the product-analytics signals —
// active users (unique distinct_id), sessions, top events by name, and an activity
// trend — client-side over the real rows. Honest: an org that has captured nothing
// yet gets a clean empty state with the instrument hint, never fabricated numbers.
export class OrgInsightsPanel extends Panel {
  private events: InsightsEvent[] | null = null;
  private loaded = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private static readonly LIMIT = 200;
  private static readonly POLL_MS = 45_000;

  constructor() {
    super({ id: 'org-insights', title: 'Insights', showCount: false, className: 'panel-wide cloud-panel' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), OrgInsightsPanel.POLL_MS);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    if (!isAuthenticated()) { this.loaded = true; this.renderSignedOut(); return; }
    this.events = await getInsightsEvents(OrgInsightsPanel.LIMIT);
    this.loaded = true;
    this.render();
  }

  private renderSignedOut(): void {
    this.clearDataBadge();
    this.setContent(`
      <div class="cloud-signin">
        <div class="cloud-signin-title">Your product insights</div>
        <div class="cloud-signin-body">Sign in to see your org's active users, top events and activity trend — scoped to your account.</div>
        <button type="button" class="cloud-signin-btn" id="orgInsightsSigninBtn">Sign in</button>
      </div>
    `);
    this.content.querySelector('#orgInsightsSigninBtn')?.addEventListener('click', () => void login());
  }

  /** Top events by name (count desc), rendered as labelled share bars. */
  private topEvents(events: InsightsEvent[]): string {
    const byName = new Map<string, number>();
    for (const e of events) {
      const name = e.event || '(unnamed)';
      byName.set(name, (byName.get(name) ?? 0) + 1);
    }
    const items = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (items.length === 0) return '';
    const max = Math.max(...items.map(([, c]) => c), 1);
    const rows = items.map(([name, count]) => `<div class="cloud-an-row">
        <span class="cloud-an-label" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        <span class="cloud-an-bar">${shareBar(count / max)}</span>
        <span class="cloud-an-val">${fmtInt(count)}</span>
      </div>`).join('');
    return `<div class="cloud-subhead">Top events</div><div class="cloud-an-col">${rows}</div>`;
  }

  /** Events-per-bucket counts over the span of the returned events (hour buckets,
   * degrading to day buckets when the span is wide). Empty when < 2 timestamps. */
  private trend(events: InsightsEvent[]): number[] {
    const times = events
      .map((e) => Date.parse(e.timestamp))
      .filter((t) => !Number.isNaN(t));
    if (times.length < 2) return [];
    const hour = 3_600_000;
    let step = hour;
    let min = Math.min(...times);
    let max = Math.max(...times);
    if ((max - min) / step > 72) step = 24 * hour; // wide span → day buckets
    const startB = Math.floor(min / step) * step;
    const endB = Math.floor(max / step) * step;
    const n = Math.floor((endB - startB) / step) + 1;
    const counts: number[] = new Array<number>(n).fill(0);
    for (const t of times) {
      const i = Math.floor((Math.floor(t / step) * step - startB) / step);
      counts[i] = (counts[i] ?? 0) + 1;
    }
    return counts;
  }

  private render(): void {
    if (!this.loaded) { this.showLoading('Loading your insights…'); return; }
    const evs = this.events;
    if (evs === null) {
      this.setDataBadge('unavailable');
      this.showEmpty('Insights is not available for this account yet.');
      return;
    }
    if (evs.length === 0) {
      this.setDataBadge('live', 'no events');
      this.setContent(`
        <div class="cloud-overview">
          <div class="cloud-overview-head"><span class="cloud-scope">your org</span></div>
          ${this.emptyStateHtml('No product events captured yet — instrument @hanzo/insights (PostHog-compatible) and your active users, top events and trend will appear here.')}
        </div>
      `);
      return;
    }

    this.setDataBadge('live', 'your org');

    const users = new Set(evs.map((e) => e.distinctId).filter(Boolean)).size;
    const sessions = new Set(evs.map((e) => e.sessionId).filter((s): s is string => !!s)).size;
    const oldest = evs.reduce((min, e) => {
      const t = Date.parse(e.timestamp);
      return !Number.isNaN(t) && t < min ? t : min;
    }, Date.now());
    const span = fmtAgo(new Date(oldest).toISOString());

    const tiles = [
      statTile(fmtInt(users), 'active users', `past ${span}`),
      sessions > 0 ? statTile(fmtInt(sessions), 'sessions') : '',
      statTile(fmtInt(evs.length), 'events'),
    ].filter(Boolean).join('');

    const trend = this.trend(evs);
    const sparkRow = trend.length >= 2 && trend.some((v) => v > 0)
      ? `<div class="cloud-spark-row">
          <span class="cloud-spark-label">events · past ${escapeHtml(span)}</span>
          <span class="cloud-spark-wrap">${sparkline(trend, 220, 30)}</span>
        </div>`
      : '';

    this.setContent(`
      <div class="cloud-overview">
        <div class="cloud-overview-head">
          <span class="cloud-scope">your org · last ${fmtInt(evs.length)} events</span>
          <span class="cloud-live-note">past ${escapeHtml(span)}</span>
        </div>
        <div class="cloud-stat-grid cloud-stat-grid-3">${tiles}</div>
        ${sparkRow}
        ${this.topEvents(evs)}
      </div>
    `);
  }
}
