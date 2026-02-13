import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { UnhcrSummary, CountryDisplacement } from '@/types';
import { formatPopulation, getDisplacementBadge } from '@/services/unhcr';

type DisplacementTab = 'origins' | 'hosts';

export class DisplacementPanel extends Panel {
  private data: UnhcrSummary | null = null;
  private activeTab: DisplacementTab = 'origins';
  private onCountryClick?: (lat: number, lon: number) => void;

  constructor() {
    super({
      id: 'displacement',
      title: 'UNHCR Displacement',
      showCount: true,
      trackActivity: true,
      infoTooltip: `<strong>UNHCR Displacement Data</strong>
        Global refugee, asylum seeker, and IDP counts from UNHCR.
        <ul>
          <li><strong>Origins</strong>: Countries people flee FROM</li>
          <li><strong>Hosts</strong>: Countries hosting refugees</li>
          <li>Crisis badges: 🔴 >1M | 🟠 >500K displaced</li>
        </ul>
        Data updates yearly. CC BY 4.0 license.`,
    });
    this.showLoading('Loading displacement data');
  }

  public setCountryClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onCountryClick = handler;
  }

  public setData(data: UnhcrSummary): void {
    this.data = data;
    this.setCount(data.countries.length);
    this.renderContent();
  }

  private renderContent(): void {
    if (!this.data) return;

    const g = this.data.globalTotals;
    const summaryHtml = `
      <div class="displacement-summary">
        <span class="disp-stat"><strong>${formatPopulation(g.refugees)}</strong> refugees</span>
        <span class="disp-stat"><strong>${formatPopulation(g.asylumSeekers)}</strong> asylum seekers</span>
        <span class="disp-stat"><strong>${formatPopulation(g.idps)}</strong> IDPs</span>
        <span class="disp-total">${formatPopulation(g.total)} total</span>
      </div>
    `;

    const tabsHtml = `
      <div class="displacement-tabs">
        <button class="panel-tab ${this.activeTab === 'origins' ? 'active' : ''}" data-tab="origins">Origins</button>
        <button class="panel-tab ${this.activeTab === 'hosts' ? 'active' : ''}" data-tab="hosts">Hosts</button>
      </div>
    `;

    let countries: CountryDisplacement[];
    if (this.activeTab === 'origins') {
      countries = [...this.data.countries]
        .filter(c => c.refugees + c.asylumSeekers > 0)
        .sort((a, b) => (b.refugees + b.asylumSeekers) - (a.refugees + a.asylumSeekers));
    } else {
      countries = [...this.data.countries]
        .filter(c => (c.hostTotal || 0) > 0)
        .sort((a, b) => (b.hostTotal || 0) - (a.hostTotal || 0));
    }

    const displayed = countries.slice(0, 30);
    const listHtml = displayed.length === 0
      ? '<div class="panel-empty">No data</div>'
      : displayed.map(c => {
        const hostTotal = c.hostTotal || 0;
        const badge = getDisplacementBadge(this.activeTab === 'origins' ? c.totalDisplaced : hostTotal);
        const badgeHtml = badge.label
          ? `<span class="disp-badge" style="background:${badge.color}">${badge.label}</span>`
          : '';
        const primary = this.activeTab === 'origins'
          ? formatPopulation(c.refugees + c.asylumSeekers)
          : formatPopulation(hostTotal);

        return `
          <div class="disp-country" data-lat="${c.lat || ''}" data-lon="${c.lon || ''}">
            <span class="disp-name">${escapeHtml(c.name)}</span>
            ${badgeHtml}
            <span class="disp-count">${primary}</span>
          </div>`;
      }).join('');

    this.setContent(`${summaryHtml}${tabsHtml}<div class="displacement-list">${listHtml}</div>`);

    this.content.querySelectorAll('.panel-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = (btn as HTMLElement).dataset.tab as DisplacementTab;
        this.renderContent();
      });
    });

    this.content.querySelectorAll('.disp-country').forEach(el => {
      el.addEventListener('click', () => {
        const lat = Number((el as HTMLElement).dataset.lat);
        const lon = Number((el as HTMLElement).dataset.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) this.onCountryClick?.(lat, lon);
      });
    });
  }
}
