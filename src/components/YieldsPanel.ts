import { Panel } from './Panel';
import { fetchYahooQuotes } from '@/services/markets';
import { REFRESH_INTERVALS } from '@/config';
import type { MarketData } from '@/types';
import { quoteRow, groupBlock, changeDir, absFromPct } from '@/utils/market-format';

// Rates & credit — the treasury curve plus a fixed-income/vol block, all off the
// same Yahoo passthrough. Panel key stays `yields`.
//
// Curve: 13w (^IRX), 2y (2YY=F, a futures-implied micro-yield — flagged *), 5y
// (^FVX), 10y (^TNX), 30y (^TYX). The CBOE yield indices were historically quoted
// at 10× the yield, so normalizeYield() defensively divides any >20 magnitude —
// a no-op at today's single-digit values, correct if Yahoo reverts. Below the
// curve: the 2s10s spread (falling back to 5s10s if the 2y future is absent) with
// an inversion note. Credit block: TLT (20y+ treasuries), LQD (IG), HYG (high
// yield), and ^MOVE (rate vol) as price + change. Strictly monochrome; degrades
// to quiet unavailable rows.

interface Tenor { symbol: string; name: string; sub: string }
interface Credit { symbol: string; name: string; sub: string; digits: number }

const TENORS: Tenor[] = [
  { symbol: '^IRX', name: '13-week', sub: 'T-bill' },
  { symbol: '2YY=F', name: '2-year', sub: 'futures*' },
  { symbol: '^FVX', name: '5-year', sub: 'note' },
  { symbol: '^TNX', name: '10-year', sub: 'note' },
  { symbol: '^TYX', name: '30-year', sub: 'bond' },
];

const CREDIT: Credit[] = [
  { symbol: 'TLT', name: 'TLT', sub: '20y+ treasuries', digits: 2 },
  { symbol: 'LQD', name: 'LQD', sub: 'IG credit', digits: 2 },
  { symbol: 'HYG', name: 'HYG', sub: 'high yield', digits: 2 },
  { symbol: '^MOVE', name: 'MOVE', sub: 'rate vol', digits: 1 },
];

// CBOE yield indices were once quoted at 10× the yield; real yields (0–20%) never
// reach that magnitude, so a magnitude test normalises either convention.
function normalizeYield(raw: number): number {
  return raw > 20 ? raw / 10 : raw;
}

export class YieldsPanel extends Panel {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'yields', title: 'Rates & credit' });
    void this.fetchData();
    this.timer = setInterval(() => void this.fetchData(), REFRESH_INTERVALS.markets);
  }

  public destroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    const items = [...TENORS, ...CREDIT];
    let data: MarketData[];
    try {
      data = await fetchYahooQuotes(items.map((i) => ({ symbol: i.symbol, name: i.name, display: i.symbol })));
    } catch {
      this.setContent('<div class="mkt"><div class="mkt-na">Rates & credit unavailable.</div></div>');
      return;
    }
    const bySymbol = new Map(data.map((d) => [d.symbol, d]));
    const anyLive = data.some((d) => d.price != null);
    if (anyLive) this.setDataBadge('live'); else this.clearDataBadge();

    const yieldOf = (symbol: string): number | null => {
      const q = bySymbol.get(symbol);
      return q && q.price != null ? normalizeYield(q.price) : null;
    };

    const tenorRows = TENORS.map((t) => {
      const q = bySymbol.get(t.symbol);
      if (!q || q.price == null) return quoteRow({ name: t.name, sub: t.sub });
      const y = normalizeYield(q.price);
      const pct = q.change ?? 0;
      const yPrev = normalizeYield(q.price / (1 + pct / 100));
      const dBps = (y - yPrev) * 100;
      return quoteRow({
        name: t.name,
        sub: t.sub,
        valueText: `${y.toFixed(2)}%`,
        changeText: `${dBps >= 0 ? '+' : ''}${dBps.toFixed(0)}bps`,
        dir: changeDir(q.change),
        sparkline: q.sparkline,
      });
    }).join('');

    const creditRows = CREDIT.map((c) => {
      const q = bySymbol.get(c.symbol);
      if (!q || q.price == null) return quoteRow({ name: c.name, sub: c.sub });
      const pct = q.change ?? 0;
      const abs = absFromPct(q.price, pct);
      const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: c.digits, maximumFractionDigits: c.digits });
      return quoteRow({
        name: c.name,
        sub: c.sub,
        valueText: fmt(q.price),
        changeText: `${abs >= 0 ? '+' : ''}${fmt(abs)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`,
        dir: changeDir(q.change),
        sparkline: q.sparkline,
      });
    }).join('');

    // 2s10s (10y − 2y); fall back to 5s10s (10y − 5y) when the 2y future is absent.
    const y2 = yieldOf('2YY=F');
    const y5 = yieldOf('^FVX');
    const y10 = yieldOf('^TNX');
    const short = y2 ?? y5;
    const shortLabel = y2 != null ? '2s10s' : '5s10s';
    let spreadHtml = '';
    if (short != null && y10 != null) {
      const bps = (y10 - short) * 100;
      const inverted = bps < 0;
      spreadHtml = `<div class="mkt-spread">
        <span class="mkt-spread-label">${shortLabel} spread</span>
        <span class="mkt-spread-val ${inverted ? 'down' : 'up'}">${bps >= 0 ? '+' : ''}${bps.toFixed(0)}bps</span>
      </div>${inverted ? '<div class="mkt-note">Curve inverted — 10y below the short leg.</div>' : ''}`;
    }

    const footnote = y2 != null ? '<div class="mkt-note">* 2-year is futures-implied (2YY).</div>' : '';

    this.setContent(
      `<div class="mkt">${groupBlock('Treasury curve', tenorRows)}${spreadHtml}${footnote}${groupBlock('Credit & rate vol', creditRows)}</div>`,
    );
  }
}
