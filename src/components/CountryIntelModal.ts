/**
 * CountryIntelModal - Shows AI-generated intelligence brief when user clicks a country
 */
import { escapeHtml } from '@/utils/sanitize';
import type { CountryScore } from '@/services/country-instability';

interface CountryIntelData {
  brief: string;
  country: string;
  code: string;
  cached?: boolean;
  generatedAt?: string;
  error?: string;
}

interface ActiveSignals {
  protests: number;
  militaryFlights: number;
  militaryVessels: number;
  outages: number;
  earthquakes: number;
}

export class CountryIntelModal {
  private overlay: HTMLElement;
  private contentEl: HTMLElement;
  private headerEl: HTMLElement;
  private onCloseCallback?: () => void;
  private currentCode: string | null = null;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'country-intel-overlay';
    this.overlay.innerHTML = `
      <div class="country-intel-modal">
        <div class="country-intel-header">
          <div class="country-intel-title"></div>
          <button class="country-intel-close">×</button>
        </div>
        <div class="country-intel-content"></div>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.headerEl = this.overlay.querySelector('.country-intel-title')!;
    this.contentEl = this.overlay.querySelector('.country-intel-content')!;

    this.overlay.querySelector('.country-intel-close')?.addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('country-intel-overlay')) this.hide();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlay.classList.contains('active')) this.hide();
    });
  }

  private countryFlag(code: string): string {
    try {
      return code
        .toUpperCase()
        .split('')
        .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
        .join('');
    } catch {
      return '🌍';
    }
  }

  private levelBadge(level: string): string {
    const colors: Record<string, string> = {
      critical: '#ff4444',
      high: '#ff8800',
      elevated: '#ffaa00',
      normal: '#44aa44',
      low: '#3388ff',
    };
    const color = colors[level] || '#888';
    return `<span class="cii-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${level.toUpperCase()}</span>`;
  }

  private scoreBar(score: number): string {
    const pct = Math.min(100, Math.max(0, score));
    const color = pct >= 70 ? '#ff4444' : pct >= 50 ? '#ff8800' : pct >= 30 ? '#ffaa00' : '#44aa44';
    return `
      <div class="cii-score-bar">
        <div class="cii-score-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="cii-score-value">${score}/100</span>
    `;
  }

  public show(country: string, code: string, score: CountryScore | null, signals?: ActiveSignals): void {
    this.currentCode = code;
    const flag = this.countryFlag(code);
    this.headerEl.innerHTML = `
      <span class="country-flag">${flag}</span>
      <span class="country-name">${escapeHtml(country)}</span>
      ${score ? this.levelBadge(score.level) : ''}
    `;

    // Show loading state + any immediate data
    let html = '';

    if (score) {
      html += `
        <div class="cii-section">
          <div class="cii-label">Instability Index ${this.scoreBar(score.score)}</div>
          <div class="cii-components">
            <span title="Unrest">📢 ${score.components.unrest.toFixed(0)}</span>
            <span title="Security">🛡️ ${score.components.security.toFixed(0)}</span>
            <span title="Information">📡 ${score.components.information.toFixed(0)}</span>
            <span class="cii-trend ${score.trend}">${score.trend === 'rising' ? '↗' : score.trend === 'falling' ? '↘' : '→'} ${score.trend}</span>
          </div>
        </div>
      `;
    }

    if (signals) {
      const chips: string[] = [];
      if (signals.protests > 0) chips.push(`<span class="signal-chip protest">📢 ${signals.protests} protests</span>`);
      if (signals.militaryFlights > 0) chips.push(`<span class="signal-chip military">✈️ ${signals.militaryFlights} mil. aircraft</span>`);
      if (signals.militaryVessels > 0) chips.push(`<span class="signal-chip military">⚓ ${signals.militaryVessels} mil. vessels</span>`);
      if (signals.outages > 0) chips.push(`<span class="signal-chip outage">🌐 ${signals.outages} outages</span>`);
      if (signals.earthquakes > 0) chips.push(`<span class="signal-chip quake">🌍 ${signals.earthquakes} earthquakes</span>`);

      if (chips.length > 0) {
        html += `<div class="active-signals">${chips.join('')}</div>`;
      }
    }

    html += `
      <div class="intel-brief-section">
        <div class="intel-brief-loading">
          <div class="intel-skeleton"></div>
          <div class="intel-skeleton short"></div>
          <div class="intel-skeleton"></div>
          <div class="intel-skeleton short"></div>
          <span class="intel-loading-text">Generating intelligence brief...</span>
        </div>
      </div>
    `;

    this.contentEl.innerHTML = html;
    this.overlay.classList.add('active');
  }

  public updateBrief(data: CountryIntelData): void {
    if (data.code !== this.currentCode) return;

    const briefSection = this.contentEl.querySelector('.intel-brief-section');
    if (!briefSection) return;

    if (data.error) {
      briefSection.innerHTML = `<div class="intel-error">Unable to generate brief. ${escapeHtml(data.error)}</div>`;
      return;
    }

    // Convert markdown-like formatting to HTML
    const formatted = this.formatBrief(data.brief);

    briefSection.innerHTML = `
      <div class="intel-brief">${formatted}</div>
      <div class="intel-footer">
        ${data.cached ? '<span class="intel-cached">📋 Cached</span>' : '<span class="intel-fresh">✨ Fresh</span>'}
        <span class="intel-timestamp">${data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : ''}</span>
      </div>
    `;
  }

  private formatBrief(text: string): string {
    return escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>');
  }

  public hide(): void {
    this.overlay.classList.remove('active');
    this.currentCode = null;
    this.onCloseCallback?.();
  }

  public onClose(cb: () => void): void {
    this.onCloseCallback = cb;
  }

  public isVisible(): boolean {
    return this.overlay.classList.contains('active');
  }
}
