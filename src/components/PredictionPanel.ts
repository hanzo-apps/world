import { Panel } from './Panel';
import type { PredictionMarket } from '@/types';
import { escapeHtml } from '@/utils/sanitize';

export class PredictionPanel extends Panel {
  constructor() {
    super({
      id: 'polymarket',
      title: 'Prediction Markets',
      infoTooltip: `<strong>Prediction Markets</strong>
        Real-money forecasting markets:
        <ul>
          <li>Prices reflect crowd probability estimates</li>
          <li>Higher volume = more reliable signal</li>
          <li>Geopolitical and current events focus</li>
        </ul>
        Source: Polymarket (polymarket.com)`,
    });
  }

  private formatVolume(volume?: number): string {
    if (!volume) return '';
    if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
    if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
    return `$${volume.toFixed(0)}`;
  }

  public renderPredictions(data: PredictionMarket[]): void {
    if (data.length === 0) {
      this.showError('Failed to load predictions');
      return;
    }

    const html = data
      .map((p) => {
        const yesPercent = Math.round(p.yesPrice);
        const noPercent = 100 - yesPercent;
        const volumeStr = this.formatVolume(p.volume);

        return `
      <div class="prediction-item">
        <div class="prediction-question">${escapeHtml(p.title)}</div>
        ${volumeStr ? `<div class="prediction-volume">Vol: ${volumeStr}</div>` : ''}
        <div class="prediction-bar">
          <div class="prediction-yes" style="width: ${yesPercent}%">
            <span class="prediction-label">Yes ${yesPercent}%</span>
          </div>
          <div class="prediction-no" style="width: ${noPercent}%">
            <span class="prediction-label">No ${noPercent}%</span>
          </div>
        </div>
      </div>
    `;
      })
      .join('');

    this.setContent(html);
  }
}
