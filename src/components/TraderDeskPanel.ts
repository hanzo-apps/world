import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';

// Trader desk — consumes /v1/world/indicators. Dense stat tiles: value + change
// + tiny sparkline + green/red, grouped into the classic risk suite. Monochrome,
// Geist Mono numerics. Every field degrades to "—" when its source is down.

interface Quote {
  symbol?: string;
  name?: string;
  price?: number | null;
  change?: number | null;
  r1d?: number | null;
  r5d?: number | null;
  r1m?: number | null;
  sparkline?: number[];
  available?: boolean;
  percentile1y?: number | null;
  source?: string;
}

interface IndicatorData {
  timestamp: string;
  volatility: { vix: Quote | null; vvix: Quote | null; move: Quote; note?: string };
  yieldCurve: {
    threeMonth: number | null; twoYear: number | null; fiveYear: number | null;
    tenYear: number | null; thirtyYear: number | null;
    spread2s10s: number | null; spread3m10y: number | null; spread5s30s: number | null;
    inverted: boolean; note?: string;
  };
  fearGreed: {
    crypto: { value: number | null; label: string; source: string };
    equity: { value: number | null; label: string; components?: Record<string, unknown>; formula?: string };
  };
  momentum: { indices: Quote[] };
  breadth: { advancers: number; decliners: number; advanceDeclineRatio: number | null; sectors: Quote[]; note?: string };
  crypto: {
    btc: Quote | null; btcDominance: number | null; mcapChange24h: number | null;
    fundingRate: number | null; fundingAnnualized: number | null; fundingSource: string; note?: string;
  };
  fx: { dxy: Quote };
  commodities: { gold: Quote; oil: Quote; copper: Quote };
  riskOnOff: { score: number | null; label: string; formula?: string };
  unavailable?: boolean;
}

function fmt(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dp });
}
function signed(v: number | null | undefined, dp = 2, suffix = '%'): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return `${v > 0 ? '+' : ''}${v.toFixed(dp)}${suffix}`;
}
function chgClass(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return 'flat';
  return v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
}

function sparkline(data: number[] | undefined, w = 110, h = 22): string {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return `<svg class="td-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function tile(name: string, value: string, r1d: number | null | undefined, spark?: number[], sub?: string): string {
  return `
    <div class="td-tile">
      <div class="td-tile-head">
        <span class="td-tile-name">${escapeHtml(name)}</span>
        <span class="td-chg ${chgClass(r1d)}">${signed(r1d)}</span>
      </div>
      <div class="td-tile-val">${value}</div>
      ${spark && spark.length > 1 ? `<div class="td-tile-spark ${chgClass(r1d)}">${sparkline(spark)}</div>` : ''}
      ${sub ? `<div class="td-tile-sub">${escapeHtml(sub)}</div>` : ''}
    </div>`;
}

function quoteTile(q: Quote | null | undefined, fallback: string, sub?: string): string {
  if (!q || q.available === false || q.price === null || q.price === undefined) {
    return tile(q?.name || q?.symbol || fallback, '—', null, undefined, sub);
  }
  return tile(q.name || q.symbol || fallback, fmt(q.price), q.r1d, q.sparkline, sub);
}

function fgClass(v: number | null): string {
  if (v === null) return 'fg-unknown';
  if (v >= 75) return 'fg-eg';
  if (v >= 55) return 'fg-g';
  if (v > 45) return 'fg-n';
  if (v >= 25) return 'fg-f';
  return 'fg-ef';
}

function fgGauge(title: string, value: number | null, label: string): string {
  const w = value === null ? 0 : Math.max(0, Math.min(100, value));
  return `
    <div class="td-fg ${fgClass(value)}">
      <div class="td-fg-title">${escapeHtml(title)}</div>
      <div class="td-fg-value">${value === null ? '—' : value}</div>
      <div class="td-fg-bar"><div class="td-fg-fill" style="width:${w}%"></div></div>
      <div class="td-fg-label">${escapeHtml(label)}</div>
    </div>`;
}

export class TraderDeskPanel extends Panel {
  private data: IndicatorData | null = null;
  private loading = true;
  private error: string | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'trader-desk',
      title: t('panels.traderDesk'),
      showCount: false,
      infoTooltip:
        'The classic trader risk suite from free sources: VIX/VVIX/MOVE, the yield curve (2s10s), crypto + equity fear/greed, index momentum, sector breadth, BTC dominance + perp funding, DXY and metals. Risk-on/off and equity fear/greed are computed here — formulas ship in the payload. Updates ~2 min.',
    });
    void this.fetchData();
    this.refreshInterval = setInterval(() => this.fetchData(), 2 * 60000);
  }

  public destroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    super.destroy();
  }

  private async fetchData(): Promise<void> {
    try {
      const res = await fetch('/v1/world/indicators');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.data = await res.json();
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to fetch';
    } finally {
      this.loading = false;
      this.renderPanel();
    }
  }

  private renderPanel(): void {
    if (this.loading) {
      this.showLoading(t('common.loading'));
      return;
    }
    if (this.error || !this.data) {
      this.showError(this.error || t('common.noDataShort'));
      return;
    }
    const d = this.data;
    if (d.unavailable) {
      this.showError(t('common.upstreamUnavailable'));
      return;
    }
    this.setDataBadge('live');

    // ── headline: risk-on/off + fear/greed ──
    const rs = d.riskOnOff;
    const riskCls = rs.score === null ? 'risk-unknown' : rs.score >= 20 ? 'risk-on' : rs.score <= -20 ? 'risk-off' : 'risk-neutral';
    const riskPct = rs.score === null ? 50 : Math.max(0, Math.min(100, (rs.score + 100) / 2));
    const headline = `
      <div class="td-headline">
        <div class="td-risk ${riskCls}">
          <div class="td-risk-title">Risk-on / off</div>
          <div class="td-risk-value">${rs.score === null ? '—' : (rs.score > 0 ? '+' : '') + rs.score}</div>
          <div class="td-risk-track"><div class="td-risk-mid"></div><div class="td-risk-dot" style="left:${riskPct}%"></div></div>
          <div class="td-risk-label">${escapeHtml(rs.label)}</div>
        </div>
        ${fgGauge('Equity fear / greed', d.fearGreed.equity.value, d.fearGreed.equity.label)}
        ${fgGauge('Crypto fear / greed', d.fearGreed.crypto.value, d.fearGreed.crypto.label)}
      </div>`;

    // ── volatility ──
    const vix = d.volatility.vix;
    const vixSub = vix && vix.percentile1y != null ? `${fmt(vix.percentile1y, 0)}%ile 1y` : undefined;
    const volatility = `
      <div class="td-section-title">Volatility</div>
      <div class="td-grid">
        ${quoteTile(vix, 'VIX', vixSub)}
        ${quoteTile(d.volatility.vvix, 'VVIX')}
        ${tile('MOVE', d.volatility.move && d.volatility.move.price != null ? fmt(d.volatility.move.price) : '—', d.volatility.move?.r1d ?? null, d.volatility.move?.sparkline, d.volatility.move?.source === '^MOVE' ? undefined : 'proxy')}
      </div>`;

    // ── yield curve ──
    const yc = d.yieldCurve;
    const spreadCls = yc.spread2s10s === null ? 'flat' : yc.spread2s10s < 0 ? 'down' : 'up';
    const yieldRow = [
      ['3M', yc.threeMonth], ['2Y', yc.twoYear], ['5Y', yc.fiveYear], ['10Y', yc.tenYear], ['30Y', yc.thirtyYear],
    ]
      .map(([lbl, v]) => `<div class="td-yield"><span class="td-yield-lbl">${lbl}</span><span class="td-yield-val">${v === null || v === undefined ? '—' : fmt(v as number, 2) + '%'}</span></div>`)
      .join('');
    const yieldCurve = `
      <div class="td-section-title">Yield curve</div>
      <div class="td-curve">
        <div class="td-spread ${spreadCls}">
          <span class="td-spread-lbl">2s10s</span>
          <span class="td-spread-val">${yc.spread2s10s === null ? '—' : signed(yc.spread2s10s, 0, ' bps')}</span>
          ${yc.inverted ? '<span class="td-pill inverted">inverted</span>' : '<span class="td-pill normal">normal</span>'}
        </div>
        <div class="td-yields">${yieldRow}</div>
      </div>`;

    // ── momentum ──
    const momentum = `
      <div class="td-section-title">Momentum</div>
      <div class="td-grid">
        ${(d.momentum.indices || []).map((q) => quoteTile(q, q.symbol || '?')).join('') || '<div class="td-empty">—</div>'}
      </div>`;

    // ── breadth ──
    const b = d.breadth;
    const adRatio = b.advanceDeclineRatio;
    const sectors = (b.sectors || [])
      .map((s) => `<div class="td-sec ${chgClass(s.r1d)}" title="${escapeHtml(s.name || '')} ${signed(s.r1d)}"><span class="td-sec-sym">${escapeHtml(s.symbol || '')}</span><span class="td-sec-chg">${signed(s.r1d, 1)}</span></div>`)
      .join('');
    const breadth = `
      <div class="td-section-title">Breadth <span class="td-section-sub">${b.advancers}▲ ${b.decliners}▼ · A/D ${adRatio === null ? '—' : (adRatio * 100).toFixed(0) + '%'}</span></div>
      <div class="td-sectors">${sectors || '<div class="td-empty">—</div>'}</div>`;

    // ── crypto ──
    const c = d.crypto;
    const funding = c.fundingRate;
    const crypto = `
      <div class="td-section-title">Crypto</div>
      <div class="td-grid">
        ${quoteTile(c.btc, 'BTC')}
        ${tile('BTC dominance', c.btcDominance === null ? '—' : fmt(c.btcDominance, 1) + '%', c.mcapChange24h)}
        ${tile('Perp funding', funding === null ? '—' : (funding * 100).toFixed(4) + '%', null, undefined, c.fundingAnnualized === null ? c.fundingSource : `${signed(c.fundingAnnualized, 1)} APR · ${c.fundingSource}`)}
      </div>`;

    // ── fx + commodities ──
    const fxComm = `
      <div class="td-section-title">FX & commodities</div>
      <div class="td-grid">
        ${quoteTile(d.fx.dxy, 'DXY')}
        ${quoteTile(d.commodities.gold, 'Gold')}
        ${quoteTile(d.commodities.oil, 'Oil')}
        ${quoteTile(d.commodities.copper, 'Copper')}
      </div>`;

    this.setContent(`
      <div class="trader-desk-container">
        ${headline}
        ${volatility}
        ${yieldCurve}
        ${momentum}
        ${breadth}
        ${crypto}
        ${fxComm}
      </div>
    `);
  }
}
