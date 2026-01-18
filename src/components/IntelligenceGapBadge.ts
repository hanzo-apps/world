import { dataFreshness, getIntelligenceGaps } from '@/services/data-freshness';
import { escapeHtml } from '@/utils/sanitize';

export class IntelligenceGapBadge {
  private badge: HTMLElement;
  private dropdown: HTMLElement;
  private isOpen = false;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.badge = document.createElement('button');
    this.badge.className = 'intel-gap-badge';
    this.badge.title = 'Intelligence coverage status';
    this.badge.innerHTML = '<span class="gap-icon">📡</span><span class="gap-count">0</span>';

    this.dropdown = document.createElement('div');
    this.dropdown.className = 'intel-gap-dropdown';

    this.badge.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown();
    });

    document.addEventListener('click', () => this.closeDropdown());

    this.mount();
    this.subscribe();
    this.update();
  }

  private mount(): void {
    const headerRight = document.querySelector('.header-right');
    if (headerRight) {
      headerRight.insertBefore(this.badge, headerRight.firstChild);
      headerRight.insertBefore(this.dropdown, this.badge.nextSibling);
    }
  }

  private subscribe(): void {
    this.unsubscribe = dataFreshness.subscribe(() => this.update());
  }

  private update(): void {
    const gaps = getIntelligenceGaps();
    const criticalCount = gaps.filter(g => g.severity === 'critical').length;
    const warningCount = gaps.filter(g => g.severity === 'warning').length;
    const totalCount = gaps.length;

    const countEl = this.badge.querySelector('.gap-count');
    if (countEl) {
      countEl.textContent = String(totalCount);
    }

    this.badge.classList.remove('status-ok', 'status-warning', 'status-critical');
    if (criticalCount > 0) {
      this.badge.classList.add('status-critical');
      this.badge.title = `${criticalCount} critical intelligence gaps`;
    } else if (warningCount > 0) {
      this.badge.classList.add('status-warning');
      this.badge.title = `${warningCount} data sources unavailable`;
    } else {
      this.badge.classList.add('status-ok');
      this.badge.title = 'All intelligence sources operational';
    }

    this.renderDropdown(gaps);
  }

  private renderDropdown(gaps: ReturnType<typeof getIntelligenceGaps>): void {
    const summary = dataFreshness.getSummary();

    if (gaps.length === 0) {
      this.dropdown.innerHTML = `
        <div class="intel-gap-header">
          <span class="header-title">Intelligence Coverage</span>
          <span class="coverage-badge ok">${summary.coveragePercent}% OPERATIONAL</span>
        </div>
        <div class="intel-gap-content">
          <div class="gap-status-ok">
            <span class="status-icon">✓</span>
            <span class="status-text">All ${summary.activeSources} sources reporting normally</span>
          </div>
        </div>
      `;
      return;
    }

    const coverageClass = summary.overallStatus === 'sufficient' ? 'ok' : summary.overallStatus === 'limited' ? 'warning' : 'critical';

    const gapsHtml = gaps.map(gap => `
      <div class="gap-item ${gap.severity}">
        <span class="gap-severity-icon">${gap.severity === 'critical' ? '⚠️' : '⚡'}</span>
        <span class="gap-message">${escapeHtml(gap.message)}</span>
      </div>
    `).join('');

    this.dropdown.innerHTML = `
      <div class="intel-gap-header">
        <span class="header-title">Intelligence Gaps</span>
        <span class="coverage-badge ${coverageClass}">${summary.coveragePercent}% COVERAGE</span>
      </div>
      <div class="intel-gap-content">
        <div class="gap-explainer">
          The following data sources are unavailable or stale. This may affect your situational awareness.
        </div>
        <div class="gap-list">
          ${gapsHtml}
        </div>
        <div class="gap-summary">
          <span class="summary-stat">${summary.activeSources}/${summary.totalSources} sources active</span>
          ${summary.newestUpdate ? `<span class="summary-stat">Last update: ${this.formatTimeAgo(summary.newestUpdate)}</span>` : ''}
        </div>
      </div>
    `;
  }

  private formatTimeAgo(date: Date): string {
    const ms = Date.now() - date.getTime();
    if (ms < 60000) return 'just now';
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
    if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
    return `${Math.floor(ms / 86400000)}d ago`;
  }

  private toggleDropdown(): void {
    this.isOpen = !this.isOpen;
    this.dropdown.classList.toggle('open', this.isOpen);
    this.badge.classList.toggle('active', this.isOpen);
  }

  private closeDropdown(): void {
    this.isOpen = false;
    this.dropdown.classList.remove('open');
    this.badge.classList.remove('active');
  }

  public destroy(): void {
    this.unsubscribe?.();
    this.badge.remove();
    this.dropdown.remove();
  }
}
