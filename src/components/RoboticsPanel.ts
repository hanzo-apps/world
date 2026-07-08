import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { getRoboticsData, type RoboticsData } from '@/services/robotics';

const CATEGORY_ICON: Record<string, string> = {
  humanoid: '🤖',
  quadruped: '🐕',
  industrial: '🦾',
  platform: '🧠',
  research: '🔬',
};

export class RoboticsPanel extends Panel {
  private loading = false;
  private lastFetch = 0;
  private readonly REFRESH_MS = 60 * 60 * 1000;

  constructor() {
    super({
      id: 'robotics',
      title: 'Robotics',
      showCount: true,
      infoTooltip: 'Hanzo World Model — Robotics lens: live arXiv cs.RO research plus a curated registry of humanoid, quadruped, industrial and platform labs.',
    });
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    if (this.loading) return;
    if (this.lastFetch > 0 && Date.now() - this.lastFetch < this.REFRESH_MS) return;
    this.loading = true;
    try {
      const data = await getRoboticsData();
      this.lastFetch = Date.now();
      this.setCount(data.papers.length + data.orgs.length);
      this.setDataBadge(data.papers.length > 0 ? 'live' : 'cached');
      this.render(data);
    } catch (e) {
      console.error('[Robotics] refresh failed:', e);
      this.showError();
    } finally {
      this.loading = false;
    }
  }

  private render(data: RoboticsData): void {
    const papers = data.papers.slice(0, 8);
    const orgs = [...data.orgs].sort((a, b) => a.category.localeCompare(b.category));

    const paperRows = papers.map((p) => {
      const url = sanitizeUrl(p.link);
      const date = p.published.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `<a class="domain-item" href="${url}" target="_blank" rel="noopener">
        <div class="domain-item-title">${escapeHtml(p.title)}</div>
        <div class="domain-item-meta">🔬 ${escapeHtml(p.categories[0] || 'cs.RO')} · ${date}</div>
      </a>`;
    }).join('');

    const orgRows = orgs.map((o) => {
      const icon = CATEGORY_ICON[o.category] || '🤖';
      const link = o.url ? ` · <a href="${sanitizeUrl(o.url)}" target="_blank" rel="noopener">site ↗</a>` : '';
      return `<div class="domain-item">
        <div class="domain-item-title">${icon} ${escapeHtml(o.name)} <span class="domain-tag">${escapeHtml(o.category)}</span></div>
        <div class="domain-item-meta">${escapeHtml(o.focus)} · ${escapeHtml(o.city)}, ${escapeHtml(o.country)}${link}</div>
      </div>`;
    }).join('');

    this.setContent(`
      <div class="domain-panel">
        <div class="domain-insight">${escapeHtml(data.insight)}</div>
        <div class="domain-section-title">Latest research (arXiv cs.RO)</div>
        <div class="domain-list">${paperRows || '<div class="domain-empty">Research feed unavailable</div>'}</div>
        <div class="domain-section-title">Major labs &amp; companies</div>
        <div class="domain-list">${orgRows}</div>
        <div class="domain-footer"><span>arXiv cs.RO + curated registry</span><span>${new Date(this.lastFetch).toLocaleTimeString()}</span></div>
      </div>
    `);
  }
}
