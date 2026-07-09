import { Panel } from './Panel';
import { fetchYahooQuotes } from '@/services/markets';
import { REFRESH_INTERVALS } from '@/config';
import type { MarketData } from '@/types';
import { quoteRow, changeDir, absFromPct } from '@/utils/market-format';

// FX & currencies — the dollar index plus the majors, the crosses, and the full
// EM board (Asia / EMEA / LATAM). Strictly monochrome, self-polling off the Yahoo
// passthrough. Compact pair codes (EUR/USD, USD/JPY, …) as the primary label so
// nothing ellipsizes at half-panel width; per-pair decimal precision so every
// value cell reads like a terminal tape (JPY crosses 3dp, big-figure EM 0–2dp,
// the rest 4dp). Majors + Crosses are expanded by default; the regional boards
// collapse to a labelled count to keep the panel short, and that open/closed
// state is owned by the user's clicks so the 2-minute refresh never snaps it shut.

interface FxItem { symbol: string; name: string; sub?: string; digits: number }
interface FxGroup { label: string; defaultOpen: boolean; items: FxItem[] }

const GROUPS: FxGroup[] = [
  {
    label: 'Majors', defaultOpen: true, items: [
      { symbol: 'DX-Y.NYB', name: 'DXY', digits: 2 },
      { symbol: 'EURUSD=X', name: 'EUR/USD', digits: 4 },
      { symbol: 'USDJPY=X', name: 'USD/JPY', digits: 3 },
      { symbol: 'GBPUSD=X', name: 'GBP/USD', digits: 4 },
      { symbol: 'AUDUSD=X', name: 'AUD/USD', digits: 4 },
      { symbol: 'NZDUSD=X', name: 'NZD/USD', digits: 4 },
      { symbol: 'USDCHF=X', name: 'USD/CHF', digits: 4 },
      { symbol: 'USDCAD=X', name: 'USD/CAD', digits: 4 },
    ],
  },
  {
    label: 'Crosses', defaultOpen: true, items: [
      { symbol: 'EURGBP=X', name: 'EUR/GBP', digits: 4 },
      { symbol: 'EURJPY=X', name: 'EUR/JPY', digits: 3 },
      { symbol: 'EURCHF=X', name: 'EUR/CHF', digits: 4 },
      { symbol: 'GBPJPY=X', name: 'GBP/JPY', digits: 3 },
      { symbol: 'AUDJPY=X', name: 'AUD/JPY', digits: 3 },
    ],
  },
  {
    label: 'Asia', defaultOpen: false, items: [
      { symbol: 'USDCNH=X', name: 'USD/CNH', sub: 'offshore', digits: 4 },
      { symbol: 'CNY=X', name: 'USD/CNY', digits: 4 },
      { symbol: 'USDINR=X', name: 'USD/INR', digits: 3 },
      { symbol: 'USDKRW=X', name: 'USD/KRW', digits: 2 },
      { symbol: 'USDSGD=X', name: 'USD/SGD', digits: 4 },
      { symbol: 'USDTWD=X', name: 'USD/TWD', digits: 3 },
      { symbol: 'USDTHB=X', name: 'USD/THB', digits: 3 },
      { symbol: 'USDIDR=X', name: 'USD/IDR', digits: 0 },
      { symbol: 'USDPHP=X', name: 'USD/PHP', digits: 3 },
      { symbol: 'USDVND=X', name: 'USD/VND', digits: 0 },
    ],
  },
  {
    label: 'EMEA', defaultOpen: false, items: [
      { symbol: 'USDTRY=X', name: 'USD/TRY', digits: 3 },
      { symbol: 'USDZAR=X', name: 'USD/ZAR', digits: 4 },
      { symbol: 'USDPLN=X', name: 'USD/PLN', digits: 4 },
      { symbol: 'USDHUF=X', name: 'USD/HUF', digits: 2 },
      { symbol: 'USDCZK=X', name: 'USD/CZK', digits: 3 },
      { symbol: 'USDSEK=X', name: 'USD/SEK', digits: 4 },
      { symbol: 'USDNOK=X', name: 'USD/NOK', digits: 4 },
      { symbol: 'USDDKK=X', name: 'USD/DKK', digits: 4 },
      { symbol: 'USDILS=X', name: 'USD/ILS', digits: 4 },
      { symbol: 'USDAED=X', name: 'USD/AED', sub: 'peg', digits: 4 },
      { symbol: 'USDSAR=X', name: 'USD/SAR', sub: 'peg', digits: 4 },
    ],
  },
  {
    label: 'LATAM', defaultOpen: false, items: [
      { symbol: 'USDMXN=X', name: 'USD/MXN', digits: 4 },
      { symbol: 'USDBRL=X', name: 'USD/BRL', digits: 4 },
      { symbol: 'USDCLP=X', name: 'USD/CLP', digits: 2 },
      { symbol: 'USDCOP=X', name: 'USD/COP', digits: 2 },
      { symbol: 'USDARS=X', name: 'USD/ARS', digits: 2 },
    ],
  },
];

const ALL: FxItem[] = GROUPS.flatMap((g) => g.items);

export class FxPanel extends Panel {
  private timer: ReturnType<typeof setInterval> | null = null;
  // Which groups are expanded — seeded from the per-group default, then owned by
  // the user's disclosure clicks so a refresh never snaps an opened board shut.
  private readonly expanded = new Set<string>(
    GROUPS.filter((g) => g.defaultOpen).map((g) => g.label),
  );

  constructor() {
    super({ id: 'fx', title: 'FX & currencies' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), REFRESH_INTERVALS.markets);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private fmt(n: number, digits: number): string {
    return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  private renderRow(it: FxItem, q: MarketData | undefined): string {
    if (!q || q.price == null) return quoteRow({ name: it.name, sub: it.sub });
    const pct = q.change ?? 0;
    const abs = absFromPct(q.price, pct);
    return quoteRow({
      name: it.name,
      sub: it.sub,
      valueText: this.fmt(q.price, it.digits),
      changeText: `${abs >= 0 ? '+' : ''}${this.fmt(abs, it.digits)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`,
      dir: changeDir(q.change),
      sparkline: q.sparkline,
    });
  }

  private async fetchData(): Promise<void> {
    let data: MarketData[];
    try {
      data = await fetchYahooQuotes(ALL.map((i) => ({ symbol: i.symbol, name: i.name, display: i.symbol })));
    } catch {
      this.setContent('<div class="mkt"><div class="mkt-na">FX unavailable.</div></div>');
      return;
    }
    const bySymbol = new Map(data.map((d) => [d.symbol, d]));
    const anyLive = data.some((d) => d.price != null);
    if (anyLive) this.setDataBadge('live'); else this.clearDataBadge();

    const groupsHtml = GROUPS.map((g) => {
      const rows = g.items.map((it) => this.renderRow(it, bySymbol.get(it.symbol))).join('');
      const open = this.expanded.has(g.label) ? ' open' : '';
      return `<details class="mkt-group"${open} data-fx-group="${g.label}">`
        + `<summary class="mkt-group-label">${g.label}<span class="mkt-group-count">${g.items.length}</span></summary>`
        + rows
        + `</details>`;
    }).join('');

    this.setContent(`<div class="mkt">${groupsHtml}</div>`);
    this.bindGroupToggles();
  }

  // Mirror the user's disclosure clicks into this.expanded so the next refresh
  // restores exactly the boards they left open.
  private bindGroupToggles(): void {
    this.content.querySelectorAll<HTMLDetailsElement>('details.mkt-group[data-fx-group]').forEach((el) => {
      el.addEventListener('toggle', () => {
        const label = el.dataset.fxGroup;
        if (!label) return;
        if (el.open) this.expanded.add(label);
        else this.expanded.delete(label);
      });
    });
  }
}
