import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getTheaterPostureSummaries,
  type TheaterPostureSummary,
} from '@/services/military-surge';
import type { MilitaryFlight } from '@/types';

export class StrategicPosturePanel extends Panel {
  private postures: TheaterPostureSummary[] = [];
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private onLocationClick?: (lat: number, lon: number) => void;
  private lastFlights: MilitaryFlight[] = [];

  constructor() {
    super({
      id: 'strategic-posture',
      title: 'Strategic Posture',
      showCount: false,
      trackActivity: true,
      infoTooltip: `<strong>Methodology</strong>
        <p>Aggregates military aircraft by theater using ADS-B data.</p>
        <ul>
          <li><strong>Normal:</strong> Baseline activity</li>
          <li><strong>Elevated:</strong> Above threshold (50+ aircraft)</li>
          <li><strong>Critical:</strong> High concentration (100+ aircraft)</li>
        </ul>
        <p><strong>Strike Capable:</strong> Tankers + AWACS + Fighters present in sufficient numbers for sustained operations.</p>`,
    });
    this.init();
  }

  private init(): void {
    this.showNoData();
    this.startAutoRefresh();
  }

  private startAutoRefresh(): void {
    this.refreshInterval = setInterval(() => this.refresh(), 5 * 60 * 1000);
  }

  public updateFlights(flights: MilitaryFlight[]): void {
    this.lastFlights = flights;
    this.refresh();
  }

  public refresh(): void {
    if (this.lastFlights.length === 0) {
      this.showNoData();
      return;
    }

    this.postures = getTheaterPostureSummaries(this.lastFlights);

    const hasCritical = this.postures.some((p) => p.postureLevel === 'critical');
    const hasElevated = this.postures.some((p) => p.postureLevel === 'elevated');
    if (hasCritical) {
      this.setNewBadge(1, true);
    } else if (hasElevated) {
      this.setNewBadge(1, false);
    } else {
      this.clearNewBadge();
    }

    this.render();
  }

  private showNoData(): void {
    this.setContent(`
      <div class="posture-panel">
        <div class="posture-no-data">
          <div class="posture-no-data-icon">📡</div>
          <div class="posture-no-data-title">Awaiting Data</div>
          <div class="posture-no-data-desc">
            Enable military layer or wait for flight data to load.
          </div>
        </div>
      </div>
    `);
  }

  private getPostureBadge(level: string): string {
    switch (level) {
      case 'critical':
        return '<span class="posture-badge posture-critical">CRIT</span>';
      case 'elevated':
        return '<span class="posture-badge posture-elevated">ELEV</span>';
      default:
        return '<span class="posture-badge posture-normal">NORM</span>';
    }
  }

  private getTrendIcon(trend: string, change: number): string {
    switch (trend) {
      case 'increasing':
        return `<span class="posture-trend trend-up">↗ +${change}%</span>`;
      case 'decreasing':
        return `<span class="posture-trend trend-down">↘ ${change}%</span>`;
      default:
        return '<span class="posture-trend trend-stable">→ stable</span>';
    }
  }

  private renderTheater(p: TheaterPostureSummary): string {
    const isExpanded = p.postureLevel !== 'normal';

    if (!isExpanded) {
      return `
        <div class="posture-theater posture-compact" data-lat="${p.centerLat}" data-lon="${p.centerLon}">
          <div class="posture-theater-header">
            <span class="posture-name">${escapeHtml(p.shortName)}</span>
            ${this.getPostureBadge(p.postureLevel)}
          </div>
          <div class="posture-summary-mini">${p.totalAircraft} aircraft</div>
        </div>
      `;
    }

    return `
      <div class="posture-theater posture-expanded ${p.postureLevel}" data-lat="${p.centerLat}" data-lon="${p.centerLon}">
        <div class="posture-theater-header">
          <span class="posture-name">${escapeHtml(p.theaterName)}</span>
          ${this.getPostureBadge(p.postureLevel)}
        </div>

        <div class="posture-breakdown">
          ${p.fighters > 0 ? `<div class="posture-row"><span class="posture-icon">✈️</span><span class="posture-count">${p.fighters}</span><span class="posture-label">Fighters</span></div>` : ''}
          ${p.tankers > 0 ? `<div class="posture-row"><span class="posture-icon">⛽</span><span class="posture-count">${p.tankers}</span><span class="posture-label">Tankers</span></div>` : ''}
          ${p.awacs > 0 ? `<div class="posture-row"><span class="posture-icon">📡</span><span class="posture-count">${p.awacs}</span><span class="posture-label">AWACS</span></div>` : ''}
          ${p.reconnaissance > 0 ? `<div class="posture-row"><span class="posture-icon">🔍</span><span class="posture-count">${p.reconnaissance}</span><span class="posture-label">Recon</span></div>` : ''}
          ${p.transport > 0 ? `<div class="posture-row"><span class="posture-icon">📦</span><span class="posture-count">${p.transport}</span><span class="posture-label">Transport</span></div>` : ''}
          ${p.bombers > 0 ? `<div class="posture-row"><span class="posture-icon">💣</span><span class="posture-count">${p.bombers}</span><span class="posture-label">Bombers</span></div>` : ''}
        </div>

        <div class="posture-meta">
          ${p.strikeCapable ? '<span class="posture-strike">⚡ STRIKE CAPABLE</span>' : ''}
          ${this.getTrendIcon(p.trend, p.changePercent)}
        </div>

        ${p.targetNation ? `<div class="posture-target">Focus: ${escapeHtml(p.targetNation)}</div>` : ''}
      </div>
    `;
  }

  private render(): void {
    const sorted = [...this.postures].sort((a, b) => {
      const order: Record<string, number> = { critical: 0, elevated: 1, normal: 2 };
      return (order[a.postureLevel] ?? 2) - (order[b.postureLevel] ?? 2);
    });

    const html = `
      <div class="posture-panel">
        ${sorted.map((p) => this.renderTheater(p)).join('')}

        <div class="posture-footer">
          <span class="posture-updated">Updated: ${new Date().toLocaleTimeString()}</span>
          <button class="posture-refresh-btn" title="Refresh">↻</button>
        </div>
      </div>
    `;

    this.setContent(html);
    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    this.content.querySelector('.posture-refresh-btn')?.addEventListener('click', () => {
      this.refresh();
    });

    const theaters = this.content.querySelectorAll('.posture-theater');
    theaters.forEach((el) => {
      el.addEventListener('click', () => {
        const lat = parseFloat((el as HTMLElement).dataset.lat || '0');
        const lon = parseFloat((el as HTMLElement).dataset.lon || '0');
        if (this.onLocationClick && !isNaN(lat) && !isNaN(lon)) {
          this.onLocationClick(lat, lon);
        }
      });
    });
  }

  public setLocationClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onLocationClick = handler;
  }

  public destroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    super.destroy();
  }
}
