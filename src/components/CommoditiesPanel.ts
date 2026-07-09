import { Panel } from './Panel';
import { fetchYahooQuotes } from '@/services/markets';
import { REFRESH_INTERVALS } from '@/config';
import type { MarketData } from '@/types';
import { quoteRow, groupBlock, changeDir, absFromPct } from '@/utils/market-format';

// Commodities & futures — grouped metals / energy / ags, Bloomberg-dense and
// strictly monochrome (bright = up, dim = down; no red/green). Self-polling off
// the Yahoo passthrough on the shared markets cadence; degrades to a quiet
// unavailable line per row, never an error wall.

interface Item { symbol: string; name: string; display: string }

const GROUPS: Array<{ label: string; items: Item[] }> = [
  {
    label: 'Metals',
    items: [
      { symbol: 'GC=F', name: 'Gold', display: 'GC=F' },
      { symbol: 'SI=F', name: 'Silver', display: 'SI=F' },
      { symbol: 'HG=F', name: 'Copper', display: 'HG=F' },
      { symbol: 'PL=F', name: 'Platinum', display: 'PL=F' },
    ],
  },
  {
    label: 'Energy',
    items: [
      { symbol: 'CL=F', name: 'WTI crude', display: 'CL=F' },
      { symbol: 'BZ=F', name: 'Brent crude', display: 'BZ=F' },
      { symbol: 'NG=F', name: 'Natural gas', display: 'NG=F' },
    ],
  },
  {
    label: 'Agriculture',
    items: [
      { symbol: 'ZW=F', name: 'Wheat', display: 'ZW=F' },
      { symbol: 'ZC=F', name: 'Corn', display: 'ZC=F' },
      { symbol: 'ZS=F', name: 'Soybeans', display: 'ZS=F' },
      { symbol: 'KC=F', name: 'Coffee', display: 'KC=F' },
      { symbol: 'SB=F', name: 'Sugar', display: 'SB=F' },
      { symbol: 'CC=F', name: 'Cocoa', display: 'CC=F' },
    ],
  },
];

const ALL: Item[] = GROUPS.flatMap((g) => g.items);

function fmtNum(n: number, digits = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export class CommoditiesPanel extends Panel {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'commodities', title: 'Commodities & futures' });
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
      data = await fetchYahooQuotes(ALL);
    } catch {
      this.setContent('<div class="mkt"><div class="mkt-na">Commodities unavailable.</div></div>');
      return;
    }
    const bySymbol = new Map(data.map((d) => [d.symbol, d]));
    const anyLive = data.some((d) => d.price != null);
    if (anyLive) this.setDataBadge('live'); else this.clearDataBadge();

    const groups = GROUPS.map((g) =>
      groupBlock(
        g.label,
        g.items
          .map((it) => {
            const q = bySymbol.get(it.symbol);
            if (!q || q.price == null) return quoteRow({ name: it.name, sub: it.symbol });
            const pct = q.change ?? 0;
            const abs = absFromPct(q.price, pct);
            return quoteRow({
              name: it.name,
              sub: it.symbol,
              valueText: fmtNum(q.price),
              changeText: `${abs >= 0 ? '+' : ''}${fmtNum(abs)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`,
              dir: changeDir(q.change),
              sparkline: q.sparkline,
            });
          })
          .join(''),
      ),
    ).join('');

    this.setContent(`<div class="mkt">${groups}</div>`);
  }
}
