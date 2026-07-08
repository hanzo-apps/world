import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { getGlobalWeatherData, type GlobalWeatherData, type SevereWeatherKind } from '@/services/global-weather';
import type { WorldFeedSeverity } from '@/services/world-feed';

const KIND_ICON: Record<SevereWeatherKind, string> = {
  cyclone: '🌀',
  flood: '🌊',
  drought: '☀️',
  wildfire: '🔥',
  storm: '⛈️',
  other: '⚠️',
};

const SEV_CLASS: Record<WorldFeedSeverity, string> = {
  critical: 'sev-critical',
  high: 'sev-high',
  elevated: 'sev-elevated',
  low: 'sev-low',
  info: 'sev-info',
};

export class WeatherPanel extends Panel {
  private loading = false;
  private lastFetch = 0;
  private readonly REFRESH_MS = 10 * 60 * 1000;

  constructor() {
    super({
      id: 'weather',
      title: 'Severe Weather',
      showCount: true,
      infoTooltip: 'Hanzo World Model — Weather lens: worldwide severe weather from GDACS (cyclones, floods, droughts, wildfires) plus US National Weather Service alerts.',
    });
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    if (this.loading) return;
    if (this.lastFetch > 0 && Date.now() - this.lastFetch < this.REFRESH_MS) return;
    this.loading = true;
    try {
      const data = await getGlobalWeatherData();
      this.lastFetch = Date.now();
      this.setCount(data.events.length);
      this.setDataBadge(data.events.length > 0 ? 'live' : 'cached');
      this.render(data);
    } catch (e) {
      console.error('[Weather] refresh failed:', e);
      this.showError();
    } finally {
      this.loading = false;
    }
  }

  private render(data: GlobalWeatherData): void {
    if (data.events.length === 0) {
      this.setContent(`
        <div class="domain-panel">
          <div class="domain-insight">${escapeHtml(data.insight)}</div>
          <div class="domain-empty">No active severe-weather events</div>
        </div>`);
      return;
    }

    const rows = data.events.slice(0, 40).map((e) => {
      const icon = KIND_ICON[e.kind] || '⚠️';
      const date = e.time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const title = e.url
        ? `<a href="${sanitizeUrl(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.title)} ↗</a>`
        : escapeHtml(e.title);
      return `<div class="domain-item">
        <div class="domain-item-title">${icon} ${title} <span class="domain-tag ${SEV_CLASS[e.severity]}">${e.severity}</span></div>
        <div class="domain-item-meta">${escapeHtml(e.region || e.kind)} · ${e.source} · ${date}</div>
      </div>`;
    }).join('');

    this.setContent(`
      <div class="domain-panel">
        <div class="domain-insight">${escapeHtml(data.insight)}</div>
        <div class="domain-list">${rows}</div>
        <div class="domain-footer"><span>GDACS + NWS</span><span>${new Date(this.lastFetch).toLocaleTimeString()}</span></div>
      </div>
    `);
  }
}
