import { Panel } from './Panel';
import { fetchYahooQuotes } from '@/services/markets';
import { REFRESH_INTERVALS } from '@/config';
import type { MarketData } from '@/types';
import { quoteRow, groupBlock, changeDir } from '@/utils/market-format';

// US treasury yields — the CBOE yield indices (^IRX/^FVX/^TNX/^TYX). Yahoo quotes
// these as yield × 10 (4.25% → 42.5), so we normalise to a real percent. Below the
// curve we compute a 5s10s spread (10y − 5y; the honest name since a 2y index
// isn't in this set) and flag an inversion when it goes negative. Monochrome,
// self-polling, degrades to a quiet unavailable line.

interface Tenor { symbol: string; name: string; sub: string }

const TENORS: Tenor[] = [
  { symbol: '^IRX', name: '13-week', sub: 'T-bill' },
  { symbol: '^FVX', name: '5-year', sub: 'note' },
  { symbol: '^TNX', name: '10-year', sub: 'note' },
  { symbol: '^TYX', name: '30-year', sub: 'bond' },
];

// CBOE yield indices are quoted at 10× the yield; realistic yields (0–20%) never
// reach the ×10 magnitude, so a magnitude test normalises either convention.
function normalizeYield(raw: number): number {
  return raw > 20 ? raw / 10 : raw;
}

export class YieldsPanel extends Panel {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'yields', title: 'US treasury yields' });
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
      data = await fetchYahooQuotes(TENORS.map((t) => ({ symbol: t.symbol, name: t.name, display: t.symbol })));
    } catch {
      this.setContent('<div class="mkt"><div class="mkt-na">Yields unavailable.</div></div>');
      return;
    }
    const bySymbol = new Map(data.map((d) => [d.symbol, d]));
    const anyLive = data.some((d) => d.price != null);
    if (anyLive) this.setDataBadge('live'); else this.clearDataBadge();

    const yieldOf = (symbol: string): number | null => {
      const q = bySymbol.get(symbol);
      return q && q.price != null ? normalizeYield(q.price) : null;
    };

    const rows = TENORS.map((t) => {
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

    // 5s10s spread (10y − 5y): the truthful label given no 2y index in this set.
    const y5 = yieldOf('^FVX');
    const y10 = yieldOf('^TNX');
    let spreadHtml = '';
    if (y5 != null && y10 != null) {
      const bps = (y10 - y5) * 100;
      const inverted = bps < 0;
      spreadHtml = `<div class="mkt-spread">
        <span class="mkt-spread-label">5s10s spread</span>
        <span class="mkt-spread-val ${inverted ? 'down' : 'up'}">${bps >= 0 ? '+' : ''}${bps.toFixed(0)}bps</span>
      </div>${inverted ? '<div class="mkt-note">Curve inverted — 10y below 5y.</div>' : ''}`;
    }

    this.setContent(`<div class="mkt">${groupBlock('Tenor', rows)}${spreadHtml}</div>`);
  }
}
