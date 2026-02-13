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

    const summaryHtml = `
      <div class="popexp-summary">
        <span class="popexp-total">Total Affected: <strong>${formatPopulation(totalAffected)}</strong></span>
      </div>
    `;

    const listHtml = this.exposures.slice(0, 30).map(e => {
      const typeIcon = this.getTypeIcon(e.eventType);
      return `
        <div class="popexp-event">
          <span class="popexp-icon">${typeIcon}</span>
          <span class="popexp-name">${escapeHtml(e.eventName.substring(0, 60))}</span>
          <span class="popexp-pop">${formatPopulation(e.exposedPopulation)}</span>
          <span class="popexp-radius">${e.exposureRadiusKm}km</span>
        </div>`;
    }).join('');

    this.setContent(`${summaryHtml}<div class="popexp-list">${listHtml}</div>`);
  }

  private getTypeIcon(type: string): string {
    switch (type) {
      case 'state-based':
      case 'non-state':
      case 'one-sided':
      case 'conflict':
      case 'battle':
        return '⚔️';
      case 'earthquake':
        return '🌍';
      case 'flood':
        return '🌊';
      case 'fire':
      case 'wildfire':
        return '🔥';
      default:
        return '📍';
    }
  }
}
