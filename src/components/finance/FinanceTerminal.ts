// Bloomberg-style finance terminal — the finance variant's primary surface.
//
// Charts ≫ news: a dense, dark grid of live TradingView charts (global indices,
// commodities, forex, crypto) + a Lux DEX trade card + curated alt-asset feeds.
// Code-split (App only imports this dynamically for the finance variant) so it
// never bloats the entry bundle, and every widget lazy-mounts on viewport with
// device-tier degradation (see ./tradingview). One class owns the layout; it
// mounts into a host element the App hands it.

import '@/styles/finance-terminal.css';
import { createChart, createTvWidget } from './tradingview';
import { getDeviceTier, maxLiveWidgets } from '@/utils/device-tier';
import { AuctionsPanel, LuxuryRealEstatePanel } from './AltFeedPanel';

interface Sym { s: string; t: string }

// Global equity indices — US, Asia, Europe. CAPITALCOM CFD symbols are the ones
// TradingView serves on the free embed (exchange-native SP:SPX / DJ:DJI etc. are
// account-gated and render a "symbol only available on TradingView" card).
const INDICES: Sym[] = [
  { s: 'CAPITALCOM:US500', t: 'S&P 500' },
  { s: 'CAPITALCOM:US100', t: 'Nasdaq 100' },
  { s: 'CAPITALCOM:US30', t: 'Dow Jones' },
  { s: 'CAPITALCOM:VIX', t: 'VIX — Volatility' },
  { s: 'CAPITALCOM:J225', t: 'Nikkei 225 — Japan' },
  { s: 'CAPITALCOM:HK50', t: 'Hang Seng — Hong Kong' },
  { s: 'CAPITALCOM:CN50', t: 'China A50' },
  { s: 'CAPITALCOM:DE40', t: 'DAX — Germany' },
  { s: 'CAPITALCOM:UK100', t: 'FTSE 100 — UK' },
  { s: 'CAPITALCOM:FR40', t: 'CAC 40 — France' },
  { s: 'CAPITALCOM:EU50', t: 'Euro Stoxx 50' },
  { s: 'CAPITALCOM:AU200', t: 'ASX 200 — Australia' },
];

const COMMODITIES: Sym[] = [
  { s: 'TVC:GOLD', t: 'Gold' },
  { s: 'TVC:SILVER', t: 'Silver' },
  { s: 'TVC:USOIL', t: 'Crude Oil — WTI' },
  { s: 'TVC:UKOIL', t: 'Brent Crude' },
  { s: 'CAPITALCOM:NATURALGAS', t: 'Natural Gas' },
  { s: 'CAPITALCOM:COPPER', t: 'Copper' },
];

const FOREX: Sym[] = [
  { s: 'CAPITALCOM:DXY', t: 'US Dollar Index' },
  { s: 'FX:EURUSD', t: 'EUR / USD' },
  { s: 'FX:USDJPY', t: 'USD / JPY' },
  { s: 'FX:GBPUSD', t: 'GBP / USD' },
  { s: 'FX:USDCNH', t: 'USD / CNH' },
];

const CRYPTO: Sym[] = [
  { s: 'BINANCE:BTCUSDT', t: 'Bitcoin' },
  { s: 'BINANCE:ETHUSDT', t: 'Ethereum' },
];

// Ticker-tape symbols — a live scrolling strip across the top.
const TAPE = [
  { proName: 'CAPITALCOM:US500', title: 'S&P 500' },
  { proName: 'CAPITALCOM:US100', title: 'Nasdaq 100' },
  { proName: 'CAPITALCOM:J225', title: 'Nikkei' },
  { proName: 'CAPITALCOM:HK50', title: 'Hang Seng' },
  { proName: 'CAPITALCOM:DE40', title: 'DAX' },
  { proName: 'TVC:GOLD', title: 'Gold' },
  { proName: 'TVC:USOIL', title: 'WTI' },
  { proName: 'CAPITALCOM:DXY', title: 'DXY' },
  { proName: 'FX:EURUSD', title: 'EUR/USD' },
  { proName: 'BINANCE:BTCUSDT', title: 'BTC' },
  { proName: 'BINANCE:ETHUSDT', title: 'ETH' },
];

const LUX_DEX_URL = 'https://exchange.lux.network/swap';

export class FinanceTerminal {
  private root: HTMLElement | null = null;

  mount(host: HTMLElement): void {
    const tier = getDeviceTier();
    // On a low-end laptop, thin the grid so we never mount dozens of live embeds.
    const cap = maxLiveWidgets();
    const indices = tier === 'low' ? INDICES.slice(0, Math.min(6, cap)) : INDICES;
    const commodities = tier === 'low' ? COMMODITIES.slice(0, 4) : COMMODITIES;
    const forex = tier === 'low' ? FOREX.slice(0, 3) : FOREX;

    const root = document.createElement('div');
    root.className = 'fin-terminal';
    root.dataset.tier = tier;

    // ── ticker tape ──────────────────────────────────────────────────────────
    const tape = createTvWidget('ticker-tape', {
      symbols: TAPE,
      showSymbolLogo: true,
      displayMode: 'adaptive',
    }, { minHeight: 46 });
    tape.classList.add('fin-tape');
    root.appendChild(tape);

    // ── Lux DEX trade card + market overview (top strip) ─────────────────────
    const topRow = document.createElement('div');
    topRow.className = 'fin-row fin-row-top';
    topRow.appendChild(this.luxDexCard());
    topRow.appendChild(this.marketOverviewCard());
    root.appendChild(topRow);

    // ── indices ──────────────────────────────────────────────────────────────
    root.appendChild(this.section('Global Indices', indices.map((x) => createChart(x.s, x.t))));
    // ── commodities ────────────────────────────────────────────────────────────
    root.appendChild(this.section('Commodities', commodities.map((x) => createChart(x.s, x.t))));
    // ── forex ──────────────────────────────────────────────────────────────────
    root.appendChild(this.section('Forex', forex.map((x) => createChart(x.s, x.t))));
    // ── crypto ─────────────────────────────────────────────────────────────────
    root.appendChild(this.section('Digital Assets', CRYPTO.map((x) => createChart(x.s, x.t))));

    // ── alt assets: auctions + luxury real estate ──────────────────────────────
    const alt = document.createElement('div');
    alt.className = 'fin-section';
    const altHead = document.createElement('div');
    altHead.className = 'fin-section-head';
    altHead.textContent = 'Alternative Assets';
    alt.appendChild(altHead);
    const altGrid = document.createElement('div');
    altGrid.className = 'fin-grid fin-grid-alt';
    altGrid.appendChild(new AuctionsPanel().getElement());
    altGrid.appendChild(new LuxuryRealEstatePanel().getElement());
    alt.appendChild(altGrid);
    root.appendChild(alt);

    host.appendChild(root);
    this.root = root;
  }

  private section(title: string, cards: HTMLElement[]): HTMLElement {
    const sec = document.createElement('div');
    sec.className = 'fin-section';
    const head = document.createElement('div');
    head.className = 'fin-section-head';
    head.textContent = title;
    sec.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'fin-grid';
    for (const c of cards) grid.appendChild(c);
    sec.appendChild(grid);
    return sec;
  }

  // The Lux DEX trade card. exchange.lux.network sets X-Frame-Options: DENY, so
  // the SwapWidget cannot be iframed; we surface a prominent launch card (opens
  // the real DEX) alongside the live BTC/ETH context — a labelled external trade
  // venue, like the TradingView embeds beside it.
  private luxDexCard(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'fin-card fin-dex';
    card.innerHTML = `
      <div class="fin-card-head">Trade &amp; Stake — Lux DEX</div>
      <div class="fin-dex-body">
        <p class="fin-dex-copy">On-chain spot &amp; staking on the Lux DEX. Swap majors, stablecoins and LUX with live routing.</p>
        <a class="fin-dex-cta" href="${LUX_DEX_URL}" target="_blank" rel="noopener noreferrer">Open Lux DEX ↗</a>
        <a class="fin-dex-sub" href="https://exchange.lux.network/pool" target="_blank" rel="noopener noreferrer">Provide liquidity / stake ↗</a>
      </div>`;
    return card;
  }

  private marketOverviewCard(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'fin-card fin-overview';
    const w = createTvWidget('market-overview', {
      showChart: true,
      showFloatingTooltip: true,
      width: '100%',
      height: '100%',
      tabs: [
        { title: 'Indices', symbols: [
          { s: 'CAPITALCOM:US500', d: 'S&P 500' }, { s: 'CAPITALCOM:US100', d: 'Nasdaq 100' },
          { s: 'CAPITALCOM:J225', d: 'Nikkei' }, { s: 'CAPITALCOM:HK50', d: 'Hang Seng' },
          { s: 'CAPITALCOM:DE40', d: 'DAX' }, { s: 'CAPITALCOM:UK100', d: 'FTSE 100' },
        ] },
        { title: 'Commodities', symbols: [
          { s: 'TVC:GOLD', d: 'Gold' }, { s: 'TVC:SILVER', d: 'Silver' },
          { s: 'TVC:USOIL', d: 'WTI' }, { s: 'CAPITALCOM:NATURALGAS', d: 'Nat Gas' },
        ] },
        { title: 'Crypto', symbols: [
          { s: 'BINANCE:BTCUSDT', d: 'BTC' }, { s: 'BINANCE:ETHUSDT', d: 'ETH' },
        ] },
      ],
    }, { minHeight: 260 });
    card.appendChild(w);
    return card;
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
  }
}
