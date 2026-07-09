import { Panel } from './Panel';
import { fetchYahooQuotes } from '@/services/markets';
import { REFRESH_INTERVALS } from '@/config';
import type { MarketData } from '@/types';
import { quoteRow, changeDir, absFromPct } from '@/utils/market-format';

// FX — the dollar index plus the major pairs. Strictly monochrome, self-polling
// off the Yahoo passthrough. Compact pair codes (DXY, EUR/USD, …) as the primary
// label so nothing ellipsizes at half-panel width. Per-pair decimal precision
// (JPY 3dp, DXY 2dp, the rest 4dp) so the value cells read like a terminal tape.

interface FxItem { symbol: string; name: string; sub?: string; digits: number }

const ITEMS: FxItem[] = [
  { symbol: 'DX-Y.NYB', name: 'DXY', digits: 2 },
  { symbol: 'EURUSD=X', name: 'EUR/USD', digits: 4 },
  { symbol: 'USDJPY=X', name: 'USD/JPY', digits: 3 },
  { symbol: 'GBPUSD=X', name: 'GBP/USD', digits: 4 },
  { symbol: 'AUDUSD=X', name: 'AUD/USD', digits: 4 },
  { symbol: 'USDCHF=X', name: 'USD/CHF', digits: 4 },
  { symbol: 'USDCAD=X', name: 'USD/CAD', digits: 4 },
  { symbol: 'USDCNH=X', name: 'USD/CNH', sub: 'offshore', digits: 4 },
];

export class FxPanel extends Panel {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'fx', title: 'FX & currencies' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), REFRESH_INTERVALS.markets);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    let data: MarketData[];
    try {
      data = await fetchYahooQuotes(ITEMS.map((i) => ({ symbol: i.symbol, name: i.name, display: i.symbol })));
    } catch {
      this.setContent('<div class="mkt"><div class="mkt-na">FX unavailable.</div></div>');
      return;
    }
    const bySymbol = new Map(data.map((d) => [d.symbol, d]));
    const anyLive = data.some((d) => d.price != null);
    if (anyLive) this.setDataBadge('live'); else this.clearDataBadge();

    const rows = ITEMS.map((it) => {
      const q = bySymbol.get(it.symbol);
      if (!q || q.price == null) return quoteRow({ name: it.name, sub: it.sub });
      const pct = q.change ?? 0;
      const abs = absFromPct(q.price, pct);
      const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: it.digits, maximumFractionDigits: it.digits });
      return quoteRow({
        name: it.name,
        sub: it.sub,
        valueText: fmt(q.price),
        changeText: `${abs >= 0 ? '+' : ''}${fmt(abs)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`,
        dir: changeDir(q.change),
        sparkline: q.sparkline,
      });
    }).join('');

    this.setContent(`<div class="mkt">${rows}</div>`);
  }
}
