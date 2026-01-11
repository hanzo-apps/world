import { Panel } from './Panel';
import type { FredSeries } from '@/services/fred';
import { getChangeClass, formatChange } from '@/services/fred';
import { escapeHtml } from '@/utils/sanitize';

export class EconomicPanel extends Panel {
  private data: FredSeries[] = [];
  private lastUpdate: Date | null = null;

  constructor() {
    super({ id: 'economic', title: 'Economic Indicators' });
  }

  public update(data: FredSeries[]): void {
    this.data = data;
    this.lastUpdate = new Date();
    this.render();
  }

  public setLoading(loading: boolean): void {
    if (loading) {
      this.showLoading();
    }
  }

  private render(): void {
    if (this.data.length === 0) {
      this.showError('No economic data available');
      return;
    }

    const indicatorsHtml = this.data.map(series => {
      const changeClass = getChangeClass(series.change);
      const changeStr = formatChange(series.change, series.unit);
      const arrow = series.change !== null
        ? (series.change > 0 ? '▲' : series.change < 0 ? '▼' : '–')
        : '';

      return `
        <div class="economic-indicator" data-series="${escapeHtml(series.id)}">
          <div class="indicator-header">
            <span class="indicator-name">${escapeHtml(series.name)}</span>
            <span class="indicator-id">${escapeHtml(series.id)}</span>
          </div>
          <div class="indicator-value">
            <span class="value">${series.value !== null ? series.value : 'N/A'}${escapeHtml(series.unit)}</span>
            <span class="change ${changeClass}">${arrow} ${changeStr}</span>
          </div>
          <div class="indicator-date">${escapeHtml(series.date)}</div>
        </div>
      `;
    }).join('');

    const updateTime = this.lastUpdate
      ? this.lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    this.setContent(`
      <div class="economic-indicators">
        ${indicatorsHtml}
      </div>
      <div class="economic-footer">
        <span class="economic-source">FRED • ${updateTime}</span>
      </div>
    `);
  }
}
