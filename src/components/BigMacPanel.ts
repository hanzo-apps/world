import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { getHydratedData } from '@/services/bootstrap';
import { getRpcBaseUrl } from '@/services/rpc-client';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { ListBigMacPricesResponse } from '@/generated/client/worldmonitor/economic/v1/service_client';

const client = new EconomicServiceClient(getRpcBaseUrl(), { fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) });

export class BigMacPanel extends Panel {
  constructor() {
    super({ id: 'bigmac', title: t('panels.bigmac') });
  }

  public async fetchData(): Promise<void> {
    try {
      const hydrated = getHydratedData('bigmac') as ListBigMacPricesResponse | undefined;
      if (hydrated?.countries?.length) {
        if (!this.element?.isConnected) return;
        this.renderIndex(hydrated);
        return;
      }
      const data = await client.listBigMacPrices({});
      if (!this.element?.isConnected) return;
      this.renderIndex(data);
    } catch (err) {
      if (this.isAbortError(err)) return;
      if (!this.element?.isConnected) return;
      this.showError(t('common.failedMarketData'), () => void this.fetchData());
    }
  }

  private renderIndex(data: ListBigMacPricesResponse): void {
    if (!data.countries?.length) {
      this.showError(t('common.failedMarketData'), () => void this.fetchData());
      return;
    }

    const sorted = [...data.countries]
      .filter(c => c.usdPrice)
      .sort((a, b) => (b.usdPrice ?? 0) - (a.usdPrice ?? 0));

    const rows = sorted.map(c => {
      const isHigh = c.code === data.mostExpensiveCountry;
      const isLow = c.code === data.cheapestCountry;
      const cls = isLow ? 'gb-cheapest' : isHigh ? 'gb-priciest' : '';
      return `<tr>
        <td class="gb-item-name">${escapeHtml(c.flag)} ${escapeHtml(c.name)}</td>
        <td class="gb-cell ${cls}">$${(c.usdPrice ?? 0).toFixed(2)}</td>
      </tr>`;
    }).join('');

    const updatedAt = data.fetchedAt ? new Date(data.fetchedAt).toLocaleDateString() : '';

    const html = `
      <div class="gb-wrapper">
        <div class="gb-scroll">
          <table class="gb-table">
            <thead><tr>
              <th class="gb-item-col">Country</th>
              <th class="gb-cell">USD</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${updatedAt ? `<div class="gb-updated">${t('common.updatedAt')}: ${updatedAt}</div>` : ''}
      </div>
    `;

    this.setContent(html);
  }
}
