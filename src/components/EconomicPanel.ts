import { Panel } from './Panel';
import type { FredSeries } from '@/services/fred';
import { t } from '@/services/i18n';
import type { OilAnalytics } from '@/services/oil-analytics';
import type { SpendingSummary } from '@/services/usa-spending';
import { getChangeClass, formatChange } from '@/services/fred';
import { formatOilValue, getTrendIndicator, getTrendColor } from '@/services/oil-analytics';
import { formatAwardAmount, getAwardTypeIcon } from '@/services/usa-spending';
import type { ChinaMacroSnapshot, ChinaMacroIndicator, ChinaReleaseEvent } from '@/services/china-macro';
import { chinaSummaryState, toObservedDate, type ChinaCountrySummarySignal } from '@/app/china-summary-state';
import { escapeHtml } from '@/utils/sanitize';

type TabId = 'indicators' | 'oil' | 'spending' | 'china';

export class EconomicPanel extends Panel {
  private fredData: FredSeries[] = [];
  private oilData: OilAnalytics | null = null;
  private spendingData: SpendingSummary | null = null;
  private chinaData: ChinaMacroSnapshot | null = null;
  private lastUpdate: Date | null = null;
  private activeTab: TabId = 'indicators';
  private indicatorsNote: string | null = null;

  constructor() {
    super({ id: 'economic', title: t('panels.economic') });
  }

  public update(data: FredSeries[]): void {
    this.fredData = data;
    this.indicatorsNote = null; // live data clears any degraded note
    this.lastUpdate = new Date();
    this.render();
  }

  /**
   * Quiet degraded state — a missing upstream key or an empty response is NOT a
   * hard runtime error, so it renders as the calm monochrome empty style with a
   * short note and explicitly clears the red panel-header-error title (which is
   * reserved for genuine runtime failures via setErrorState).
   */
  public showDegraded(note: string): void {
    this.setErrorState(false);
    this.indicatorsNote = note;
    this.fredData = [];
    this.render();
  }

  public updateOil(data: OilAnalytics): void {
    this.oilData = data;
    this.render();
  }

  public updateSpending(data: SpendingSummary): void {
    this.spendingData = data;
    this.render();
  }

  public updateChina(data: ChinaMacroSnapshot): void {
    this.chinaData = data;
    this.render();
  }

  public setLoading(loading: boolean): void {
    if (loading) {
      this.showLoading();
    }
  }

  private render(): void {
    const hasOil = this.oilData && (this.oilData.wtiPrice || this.oilData.brentPrice);
    const hasSpending = this.spendingData && this.spendingData.awards.length > 0;
    const hasChina = !!this.chinaData;

    // Build tabs HTML
    const tabsHtml = `
      <div class="economic-tabs">
        <button class="economic-tab ${this.activeTab === 'indicators' ? 'active' : ''}" data-tab="indicators">
          📊 ${t('components.economic.indicators')}
        </button>
        ${hasOil ? `
          <button class="economic-tab ${this.activeTab === 'oil' ? 'active' : ''}" data-tab="oil">
            🛢️ ${t('components.economic.oil')}
          </button>
        ` : ''}
        ${hasSpending ? `
          <button class="economic-tab ${this.activeTab === 'spending' ? 'active' : ''}" data-tab="spending">
            🏛️ ${t('components.economic.gov')}
          </button>
        ` : ''}
        ${hasChina ? `
          <button class="economic-tab ${this.activeTab === 'china' ? 'active' : ''}" data-tab="china">
            🇨🇳 ${t('components.economic.china.tab')}
          </button>
        ` : ''}
      </div>
    `;

    let contentHtml = '';

    switch (this.activeTab) {
      case 'indicators':
        contentHtml = this.renderIndicators();
        break;
      case 'oil':
        contentHtml = this.renderOil();
        break;
      case 'spending':
        contentHtml = this.renderSpending();
        break;
      case 'china':
        contentHtml = this.renderChina();
        break;
    }

    const updateTime = this.lastUpdate
      ? this.lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    this.setContent(`
      ${tabsHtml}
      <div class="economic-content">
        ${contentHtml}
      </div>
      <div class="economic-footer">
        <span class="economic-source">${this.getSourceLabel()} • ${updateTime}</span>
      </div>
    `);

    // Bind tab click events
    this.content.querySelectorAll('.economic-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabId = (e.target as HTMLElement).dataset.tab as TabId;
        if (tabId) {
          this.activeTab = tabId;
          this.render();
        }
      });
    });
  }

  private getSourceLabel(): string {
    switch (this.activeTab) {
      case 'indicators': return 'FRED';
      case 'oil': return 'EIA';
      case 'spending': return 'USASpending.gov';
      case 'china': return 'OECD · FRED · NBS · PBoC';
    }
  }

  private renderIndicators(): string {
    if (this.fredData.length === 0) {
      return `<div class="economic-empty">${escapeHtml(this.indicatorsNote ?? t('components.economic.noIndicatorData'))}</div>`;
    }

    return `
      <div class="economic-indicators">
        ${this.fredData.map(series => {
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
                <span class="value">${escapeHtml(String(series.value !== null ? series.value : 'N/A'))}${escapeHtml(series.unit)}</span>
                <span class="change ${escapeHtml(changeClass)}">${escapeHtml(arrow)} ${escapeHtml(changeStr)}</span>
              </div>
              <div class="indicator-date">${escapeHtml(series.date)}</div>
            </div>
          `;
    }).join('')}
      </div>
    `;
  }

  private renderOil(): string {
    if (!this.oilData) {
      return `<div class="economic-empty">${t('components.economic.noOilDataRetry')}</div>`;
    }

    const metrics = [
      this.oilData.wtiPrice,
      this.oilData.brentPrice,
      this.oilData.usProduction,
      this.oilData.usInventory,
    ].filter(Boolean);

    if (metrics.length === 0) {
      return `<div class="economic-empty">${t('components.economic.noOilMetrics')}</div>`;
    }

    return `
      <div class="economic-indicators oil-metrics">
        ${metrics.map(metric => {
      if (!metric) return '';
      const trendIcon = getTrendIndicator(metric.trend);
      const trendColor = getTrendColor(metric.trend, metric.name.includes('Production'));

      return `
            <div class="economic-indicator oil-metric">
              <div class="indicator-header">
                <span class="indicator-name">${escapeHtml(metric.name)}</span>
              </div>
              <div class="indicator-value">
                <span class="value">${escapeHtml(formatOilValue(metric.current, metric.unit))} ${escapeHtml(metric.unit)}</span>
                <span class="change" style="color: ${escapeHtml(trendColor)}">
                  ${escapeHtml(trendIcon)} ${escapeHtml(String(metric.changePct > 0 ? '+' : ''))}${escapeHtml(String(metric.changePct))}%
                </span>
              </div>
              <div class="indicator-date">${t('components.economic.vsPreviousWeek')}</div>
            </div>
          `;
    }).join('')}
      </div>
    `;
  }

  private renderSpending(): string {
    if (!this.spendingData || this.spendingData.awards.length === 0) {
      return `<div class="economic-empty">${t('components.economic.noSpending')}</div>`;
    }

    const { awards, totalAmount, periodStart, periodEnd } = this.spendingData;

    return `
      <div class="spending-summary">
        <div class="spending-total">
          ${escapeHtml(formatAwardAmount(totalAmount))} ${t('components.economic.in')} ${escapeHtml(String(awards.length))} ${t('components.economic.awards')}
          <span class="spending-period">${escapeHtml(periodStart)} – ${escapeHtml(periodEnd)}</span>
        </div>
      </div>
      <div class="spending-list">
        ${awards.slice(0, 8).map(award => `
          <div class="spending-award">
            <div class="award-header">
              <span class="award-icon">${escapeHtml(getAwardTypeIcon(award.awardType))}</span>
              <span class="award-amount">${escapeHtml(formatAwardAmount(award.amount))}</span>
            </div>
            <div class="award-recipient">${escapeHtml(award.recipientName)}</div>
            <div class="award-agency">${escapeHtml(award.agency)}</div>
            ${award.description ? `<div class="award-desc">${escapeHtml(award.description.slice(0, 100))}${award.description.length > 100 ? '...' : ''}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  private renderChina(): string {
    const snap = this.chinaData;
    if (!snap || (snap.indicators.length === 0 && snap.releaseEvents.length === 0)) {
      return `<div class="economic-empty">${escapeHtml(t('components.economic.china.noData'))}</div>`;
    }

    // Panel state is derived from the required (non-context) indicators that
    // carry a value, via the ported four-state contract.
    const requiredSignals: ChinaCountrySummarySignal[] = snap.indicators
      .filter(ind => !ind.contextOnly && ind.value !== null)
      .map(ind => ({ stale: ind.stale }));
    const state = chinaSummaryState(requiredSignals, 4);

    const today = new Date().toISOString().slice(0, 10);
    const upcoming = snap.releaseEvents
      .filter(ev => ev.releaseDate >= today)
      .slice(0, 8);

    return `
      <div class="cn-summary">
        <div class="cn-summary-head">
          <span class="cn-status cn-status--${escapeHtml(state)}">${escapeHtml(t('components.economic.china.status.' + state))}</span>
        </div>
        <div class="economic-indicators cn-indicators">
          ${snap.indicators.map(ind => this.renderChinaIndicator(ind)).join('')}
        </div>
        <div class="cn-releases">
          <div class="cn-releases-head">${escapeHtml(t('components.economic.china.releases'))}</div>
          ${upcoming.length === 0
            ? `<div class="economic-empty">${escapeHtml(t('components.economic.china.noReleases'))}</div>`
            : upcoming.map(ev => this.renderChinaRelease(ev)).join('')}
        </div>
      </div>
    `;
  }

  private renderChinaIndicator(ind: ChinaMacroIndicator): string {
    const hasValue = ind.value !== null && Number.isFinite(ind.value);
    const valueStr = hasValue
      ? `${escapeHtml(String(ind.value))}${ind.unit ? ' ' + escapeHtml(ind.unit) : ''}`
      : '—';
    const prior = hasValue && ind.priorValue !== null && Number.isFinite(ind.priorValue)
      ? `<span class="cn-prior">${escapeHtml(t('components.economic.china.prior'))} ${escapeHtml(String(ind.priorValue))}</span>`
      : '';
    const badges: string[] = [];
    if (ind.contextOnly) {
      badges.push(`<span class="cn-badge cn-badge--context">${escapeHtml(t('components.economic.china.context'))}</span>`);
    }
    if (ind.stale) {
      badges.push(`<span class="cn-badge cn-badge--stale">${escapeHtml(t('components.economic.china.status.stale'))}</span>`);
    }
    // An unavailable series stays honestly empty with a labeled reason rather
    // than a fabricated value.
    const reason = (!hasValue && ind.unavailableReason)
      ? `<span class="cn-reason" title="${escapeHtml(ind.unavailableReason)}">${escapeHtml(this.chinaReasonLabel(ind.unavailableReason))}</span>`
      : '';
    const observed = ind.observationDate
      ? `<span class="cn-observed">${escapeHtml(t('components.economic.china.observed'))} ${escapeHtml(toObservedDate(ind.observationDate))}</span>`
      : '';

    return `
      <div class="economic-indicator cn-indicator" data-id="${escapeHtml(ind.id)}">
        <div class="indicator-header">
          <span class="indicator-name">${escapeHtml(ind.label)}</span>
          ${badges.join('')}
        </div>
        <div class="indicator-value">
          <span class="value">${valueStr}</span>
          ${prior}
          ${reason}
        </div>
        <div class="indicator-date">${observed}${observed && ind.source ? ' · ' : ''}${escapeHtml(ind.source)}</div>
      </div>
    `;
  }

  private renderChinaRelease(ev: ChinaReleaseEvent): string {
    const statusLabel = t('components.economic.china.eventStatus.' + ev.status, { defaultValue: ev.status });
    return `
      <div class="cn-release">
        <span class="cn-release-date">${escapeHtml(ev.releaseDate)}</span>
        <span class="cn-release-event">${escapeHtml(ev.event)}</span>
        <span class="cn-release-status cn-release-status--${escapeHtml(ev.status)}">${escapeHtml(statusLabel)}</span>
      </div>
    `;
  }

  private chinaReasonLabel(reason: string): string {
    if (reason === 'not_configured') return t('components.economic.china.notConfigured');
    return t('components.economic.china.sourceUnavailable');
  }
}
