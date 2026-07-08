import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { fetchSportsEvents, sportsInsight, type SportEvent } from '@/services/sports';

export class SportsPanel extends Panel {
  private loading = false;
  private lastFetch = 0;
  private readonly REFRESH_MS = 2 * 60 * 1000;

  constructor() {
    super({
      id: 'sports',
      title: 'Sports & Events',
      showCount: true,
      infoTooltip: 'Hanzo World Model — Sports lens: live and scheduled major events across the NFL, NBA, MLB, NHL, Premier League and UEFA Champions League (ESPN public API).',
    });
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    if (this.loading) return;
    if (this.lastFetch > 0 && Date.now() - this.lastFetch < this.REFRESH_MS) return;
    this.loading = true;
    try {
      const events = await fetchSportsEvents();
      this.lastFetch = Date.now();
      this.setCount(events.length);
      this.setDataBadge(events.length > 0 ? 'live' : 'unavailable');
      this.render(events);
    } catch (e) {
      console.error('[Sports] refresh failed:', e);
      this.showError();
    } finally {
      this.loading = false;
    }
  }

  private renderEvent(e: SportEvent): string {
    const live = e.state === 'in';
    const badge = live
      ? '<span class="domain-tag sev-high">LIVE</span>'
      : e.state === 'post'
        ? '<span class="domain-tag">FINAL</span>'
        : `<span class="domain-tag">${escapeHtml(e.status)}</span>`;
    const score = e.state === 'pre'
      ? escapeHtml(e.status)
      : `${escapeHtml(e.away.name)} ${escapeHtml(e.away.score)} — ${escapeHtml(e.home.name)} ${escapeHtml(e.home.score)}`;
    const title = e.url
      ? `<a href="${sanitizeUrl(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.shortName || e.name)} ↗</a>`
      : escapeHtml(e.shortName || e.name);
    return `<div class="domain-item">
      <div class="domain-item-title">${title} ${badge}</div>
      <div class="domain-item-meta">${escapeHtml(e.league)} · ${score}</div>
    </div>`;
  }

  private render(events: SportEvent[]): void {
    if (events.length === 0) {
      this.setContent(`<div class="domain-panel"><div class="domain-empty">No events available right now</div></div>`);
      return;
    }
    const rows = events.slice(0, 40).map((e) => this.renderEvent(e)).join('');
    this.setContent(`
      <div class="domain-panel">
        <div class="domain-insight">${escapeHtml(sportsInsight(events))}</div>
        <div class="domain-list">${rows}</div>
        <div class="domain-footer"><span>ESPN</span><span>${new Date(this.lastFetch).toLocaleTimeString()}</span></div>
      </div>
    `);
  }
}
