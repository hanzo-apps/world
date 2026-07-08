import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { fetchSpaceWeather, type SpaceWeatherState } from '@/services/space-weather';

function kpClass(kp: number | null): string {
  if (kp === null) return 'sev-info';
  if (kp >= 8) return 'sev-critical';
  if (kp >= 7) return 'sev-high';
  if (kp >= 5) return 'sev-elevated';
  if (kp >= 4) return 'sev-low';
  return 'sev-info';
}

export class SpaceWeatherPanel extends Panel {
  private loading = false;
  private lastFetch = 0;
  private readonly REFRESH_MS = 10 * 60 * 1000;

  constructor() {
    super({
      id: 'space-weather',
      title: 'Space Weather',
      showCount: true,
      infoTooltip: 'Hanzo World Model — Space Weather lens: NOAA SWPC planetary Kp index and geomagnetic/solar advisories. Drives satellite, GPS, grid and HF-comms risk worldwide.',
    });
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    if (this.loading) return;
    if (this.lastFetch > 0 && Date.now() - this.lastFetch < this.REFRESH_MS) return;
    this.loading = true;
    try {
      const state = await fetchSpaceWeather();
      this.lastFetch = Date.now();
      this.setCount(state.alerts.length);
      this.setDataBadge(state.kp !== null || state.alerts.length > 0 ? 'live' : 'unavailable');
      this.render(state);
    } catch (e) {
      console.error('[SpaceWeather] refresh failed:', e);
      this.showError();
    } finally {
      this.loading = false;
    }
  }

  private render(state: SpaceWeatherState): void {
    const alerts = state.alerts.map((a) => `
      <div class="domain-item">
        <div class="domain-item-title">📡 ${escapeHtml(a.message)}</div>
        <div class="domain-item-meta">${a.issued.toLocaleString()}</div>
      </div>`).join('');

    this.setContent(`
      <div class="domain-panel">
        <div class="domain-insight">${escapeHtml(state.insight)}</div>
        <div class="domain-item">
          <div class="domain-item-title">🧭 Planetary Kp <span class="domain-tag ${kpClass(state.kp)}">${state.kp ?? '—'}</span></div>
          <div class="domain-item-meta">${escapeHtml(state.stormLevel)}${state.kpTime ? ' · ' + state.kpTime.toLocaleString() : ''}</div>
        </div>
        <div class="domain-section-title">Advisories</div>
        <div class="domain-list">${alerts || '<div class="domain-empty">No active advisories</div>'}</div>
        <div class="domain-footer"><span>NOAA SWPC</span><span>${new Date(this.lastFetch).toLocaleTimeString()}</span></div>
      </div>
    `);
  }
}
