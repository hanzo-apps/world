import { Panel } from './Panel';
import { fetchYahooQuotes } from '@/services/markets';
import { REFRESH_INTERVALS } from '@/config';
import type { MarketData } from '@/types';
import { universeGroups } from '@/config/market-universe';
import { quoteRow, groupBlock, changeDir, absFromPct } from '@/utils/market-format';

// Commodities & futures — grouped metals / energy / ags, Bloomberg-dense and
// strictly monochrome (bright = up, dim = down; no red/green). Self-polling off
// the Yahoo passthrough on the shared markets cadence; degrades to a quiet
// unavailable line per row, never an error wall.
//
// The symbol list is DERIVED from the one market-universe (universeGroups) — the
// same source the Markets Bubble reads — so a commodity is added/reweighted in
// exactly one place. Grouping + names + order come straight from that list.

const GROUPS = universeGroups('commodities');
const ALL = GROUPS.flatMap((g) => g.items).map((i) => ({
  symbol: i.symbol,
  name: i.name,
  display: i.display ?? i.symbol,
}));

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
