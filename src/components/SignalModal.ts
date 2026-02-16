import { t } from '@/services/i18n';
import { type SignalType } from '@/utils/analysis-constants';
import { escapeHtml } from '@/utils/sanitize';
import type { UnifiedAlert } from '@/services/cross-module-integration';
import type { CorrelationSignal } from '@/services/correlation';
import { suppressTrendingTerm } from '@/services/trending-keywords';

export class SignalModal {
  private element: HTMLElement;
  private audio?: HTMLAudioElement;
  private audioEnabled: boolean = true;
  private locationClickHandler?: (lat: number, lon: number) => void;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'signal-modal-overlay';
    this.element.innerHTML = `
      <div class="signal-modal">
        <div class="signal-modal-header">
          <span class="signal-modal-title">🎯 ${t('modals.signal.title')}</span>
          <button class="signal-modal-close">×</button>
        </div>
        <div class="signal-modal-content"></div>
        <div class="signal-modal-footer">
          <label class="signal-audio-toggle">
            <input type="checkbox" checked>
            <span>${t('modals.signal.soundAlerts')}</span>
          </label>
          <button class="signal-dismiss-btn">${t('modals.signal.dismiss')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.element);
    this.setupEventListeners();
    this.initAudio();
  }

  public setLocationClickHandler(handler: (lat: number, lon: number) => void): void {
    this.locationClickHandler = handler;
  }

  private setupEventListeners(): void {
    this.element.querySelector('.signal-modal-close')?.addEventListener('click', () => this.hide());
    this.element.querySelector('.signal-dismiss-btn')?.addEventListener('click', () => this.hide());

    const toggle = this.element.querySelector('.signal-audio-toggle input') as HTMLInputElement;
    if (toggle) {
      toggle.addEventListener('change', (e) => {
        this.audioEnabled = (e.target as HTMLInputElement).checked;
      });
    }

    this.element.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('signal-modal-overlay')) {
        this.hide();
      } else if (target.classList.contains('suppress-keyword-btn')) {
        const term = target.getAttribute('data-term');
        if (term) {
          suppressTrendingTerm(term);
          target.textContent = t('modals.signal.suppressed') || 'Suppressed';
          target.setAttribute('disabled', 'true');
        }
      } else if (target.closest('.signal-location-btn')) {
        const btn = target.closest('.signal-location-btn') as HTMLElement;
        const lat = parseFloat(btn.dataset.lat || '0');
        const lon = parseFloat(btn.dataset.lon || '0');
        if (this.locationClickHandler) {
          this.locationClickHandler(lat, lon);
          this.hide();
        }
      }
    });
  }

  private initAudio(): void {
    // Assuming audio file exists, otherwise this will fail silently
    this.audio = new Audio('/assets/sounds/alert.mp3');
  }

  public hide(): void {
    this.element.classList.remove('active');
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
  }

  public show(signals?: CorrelationSignal[]): void {
    this.element.classList.add('active');
    if (signals) {
      this.showSignals(signals);
    }
  }

  public showAlert(alert: UnifiedAlert): void {
    this.show();
    const content = this.element.querySelector('.signal-modal-content');
    if (!content) return;

    const levelStr = (alert.priority || 'info').toUpperCase();

    content.innerHTML = `
      <div class="signal-alert-full ${alert.priority}">
        <div class="signal-alert-header">
          <span class="signal-alert-level">${levelStr}</span>
          <span class="signal-alert-time">${new Date(alert.timestamp).toLocaleTimeString()}</span>
        </div>
        <h2 class="signal-alert-title">${escapeHtml(alert.title)}</h2>
        <div class="signal-alert-body">${escapeHtml(alert.summary)}</div>
        
        <div class="signal-actions">
          ${alert.location ? `
            <button class="signal-location-btn" data-lat="${alert.location.lat}" data-lon="${alert.location.lon}">
              📍 ${t('modals.signal.location') || 'Location'}
            </button>
          ` : ''}
        </div>
      </div>
    `;

    if (this.audioEnabled && this.audio && alert.priority === 'critical') {
      this.audio.play().catch(() => { });
    }
  }

  public showSignal(signal: CorrelationSignal): void {
    this.showSignals([signal]);
  }

  public showSignals(signals: CorrelationSignal[]): void {
    this.show();
    const content = this.element.querySelector('.signal-modal-content');
    if (!content) return;

    if (signals.length === 0) {
      content.innerHTML = `<div class="no-signals">${t('modals.signal.noSignals') || 'No active signals found.'}</div>`;
      return;
    }

    content.innerHTML = signals.map(signal => `
      <div class="signal-item">
        <div class="signal-header">
          <span class="signal-tag">${this.getSignalLabel(signal.type)}</span>
          <span class="signal-confidence">${(signal.confidence * 100).toFixed(0)}% ${t('modals.signal.confidence')}</span>
          <span class="signal-time">${new Date(signal.timestamp).toLocaleTimeString()}</span>
        </div>
        <div class="signal-body">
          <h3>${escapeHtml(signal.title)}</h3>
          <p>${escapeHtml(signal.description)}</p>
        </div>
        <div class="signal-meta">
          ${signal.data.relatedTopics && signal.data.relatedTopics.length > 0 ? `
            <div class="signal-topics">
              <strong>${t('modals.signal.related') || 'Related'}:</strong> 
              ${signal.data.relatedTopics.map(tag => `<span class="topic-tag">${escapeHtml(tag)}</span>`).join('')}
            </div>
          ` : ''}
          ${signal.data.term ? `
             <button class="suppress-keyword-btn" data-term="${escapeHtml(signal.data.term)}">${t('modals.signal.suppress')}</button>
          ` : ''}
          ${signal.data.correlatedEntities && signal.data.correlatedEntities.length > 0 ? `
             <div class="signal-entities">
                <strong>${t('modals.signal.entities') || 'Entities'}:</strong>
                ${signal.data.correlatedEntities.join(', ')}
             </div>
          ` : ''}
        </div>
      </div>
    `).join('');

    if (this.audioEnabled && this.audio && signals.some(s => s.confidence > 0.8)) {
      this.audio.play().catch(() => { });
    }
  }

  private getSignalLabel(type: SignalType): string {
    const signalTypeLabels: Record<string, string> = {
      'prediction_leads_news': `🔮 ${t('modals.signal.predictionLeading')}`,
      'news_leads_markets': `📰 ${t('modals.signal.newsLeading')}`,
      'silent_divergence': `🔇 ${t('modals.signal.silentDivergence')}`,
      'velocity_spike': `🔥 ${t('modals.signal.velocitySpike')}`,
      'keyword_spike': `📊 ${t('modals.signal.keywordSpike')}`,
      'convergence': `◉ ${t('modals.signal.convergence')}`,
      'triangulation': `△ ${t('modals.signal.triangulation')}`,
      'flow_drop': `🛢️ ${t('modals.signal.flowDrop')}`,
      'flow_price_divergence': `📈 ${t('modals.signal.flowPriceDivergence')}`,
      'geo_convergence': `🌐 ${t('modals.signal.geoConvergence')}`,
      'explained_market_move': `✓ ${t('modals.signal.marketMove')}`,
      'sector_cascade': `📊 ${t('modals.signal.sectorCascade')}`,
      'military_surge': `🛩️ ${t('modals.signal.militarySurge')}`,
    };
    return signalTypeLabels[type] || type;
  }
}
