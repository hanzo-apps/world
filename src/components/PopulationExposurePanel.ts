import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { PopulationExposure } from '@/types';
import { formatPopulation } from '@/services/population-exposure';

export class PopulationExposurePanel extends Panel {
  private exposures: PopulationExposure[] = [];

  constructor() {
    super({
      id: 'population-exposure',
      title: 'Population Exposure',
      showCount: true,
      trackActivity: true,
      infoTooltip: `<strong>Population Exposure Estimates</strong>
        Estimated population within event impact radius.
        Based on WorldPop country density data.
        <ul>
          <li>Conflict: 50km radius</li>
          <li>Earthquake: 100km radius</li>
          <li>Flood: 100km radius</li>
          <li>Wildfire: 30km radius</li>
        </ul>`,
    });
    this.showLoading('Calculating exposure');
  }

  public setExposures(exposures: PopulationExposure[]): void {
    this.exposures = exposures;
    this.setCount(exposures.length);
    this.renderContent();
  }

  private renderContent(): void {
    if (this.exposures.length === 0) {
      this.setContent('<div class="panel-empty">No exposure data available</div>');
      return;
    }

    const totalAffected = this.exposures.reduce((sum, e) => sum + e.exposedPopulation, 0);

    const rows = this.exposures.slice(0, 30).map(e => {
      const typeIcon = this.getTypeIcon(e.eventType);
      const popClass = e.exposedPopulation >= 1_000_000 ? ' popexp-large' : '';
      return `<tr class="popexp-row">
        <td class="popexp-type">${typeIcon}</td>
        <td class="popexp-name">${escapeHtml(e.eventName)}</td>
        <td class="popexp-pop${popClass}">${formatPopulation(e.exposedPopulation)}</td>
        <td class="popexp-radius">${e.exposureRadiusKm}km</td>
      </tr>`;
    }).join('');

    this.setContent(`
      <div class="popexp-panel-content">
        <div class="popexp-summary">
          <span class="popexp-label">Total Affected</span>
          <span class="popexp-total">${formatPopulation(totalAffected)}</span>
        </div>
        <table class="popexp-table">
          <thead>
            <tr>
              <th class="popexp-th-type"></th>
              <th>Event</th>
              <th>Population</th>
              <th>Radius</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <style>
        .popexp-panel-content { font-size: 12px; }
        .popexp-summary { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; margin-bottom: 6px; background: rgba(239, 68, 68, 0.08); border-radius: 4px; border-left: 3px solid #ef4444; }
        .popexp-label { color: #999; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
        .popexp-total { color: #fff; font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .popexp-table { width: 100%; border-collapse: collapse; }
        .popexp-table th { text-align: left; color: #666; font-weight: 600; font-size: 10px; text-transform: uppercase; padding: 4px 8px; border-bottom: 1px solid #222; }
        .popexp-table th:nth-child(3), .popexp-table th:nth-child(4) { text-align: right; }
        .popexp-table td { padding: 5px 8px; border-bottom: 1px solid #1a1a1a; color: #ccc; }
        .popexp-row:hover { background: #1a1a1a; }
        .popexp-th-type { width: 28px; }
        .popexp-type { width: 28px; text-align: center; }
        .popexp-name { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .popexp-pop { text-align: right; font-variant-numeric: tabular-nums; }
        .popexp-large { color: #fff; font-weight: 600; }
        .popexp-radius { text-align: right; font-variant-numeric: tabular-nums; color: #666; }
      </style>
    `);
  }

  private getTypeIcon(type: string): string {
    switch (type) {
      case 'state-based':
      case 'non-state':
      case 'one-sided':
      case 'conflict':
      case 'battle':
        return '\u2694\uFE0F';
      case 'earthquake':
        return '\uD83C\uDF0D';
      case 'flood':
        return '\uD83C\uDF0A';
      case 'fire':
      case 'wildfire':
        return '\uD83D\uDD25';
      default:
        return '\uD83D\uDCCD';
    }
  }
}
