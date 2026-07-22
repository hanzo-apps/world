// Lazy TradingView embed mounter for the finance terminal.
//
// Each TradingView widget is a third-party <script> that injects its own iframe.
// Mounting a dense grid of them eagerly would stall a low-end laptop, so every
// widget here defers its script injection until it scrolls into view
// (IntersectionObserver) and the device tier caps how heavy each widget is.
// One place owns the embed contract; the terminal just declares what it wants.

import { getDeviceTier } from '@/utils/device-tier';

const TV_BASE = 'https://s3.tradingview.com/external-embedding/embed-widget-';

export type TvWidget =
  | 'advanced-chart'
  | 'mini-symbol-overview'
  | 'symbol-overview'
  | 'ticker-tape'
  | 'market-overview'
  | 'market-quotes'
  | 'forex-cross-rates'
  | 'economic-calendar';

const isDark = (): boolean => document.documentElement.dataset.theme !== 'light';

// A dark, brand-neutral palette so the embeds read as part of the terminal, not
// TradingView's default blue.
function baseTheme(): Record<string, unknown> {
  return {
    colorTheme: isDark() ? 'dark' : 'light',
    isTransparent: true,
    locale: 'en',
  };
}

/**
 * Create a lazily-mounted TradingView widget. Returns the wrapper element; the
 * heavy embed script is injected only on first viewport intersection (or
 * immediately if IntersectionObserver is unavailable).
 */
export function createTvWidget(
  type: TvWidget,
  config: Record<string, unknown>,
  opts: { minHeight?: number; title?: string } = {},
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'fin-tv';
  if (opts.minHeight) wrap.style.minHeight = `${opts.minHeight}px`;

  if (opts.title) {
    const h = document.createElement('div');
    h.className = 'fin-tv-title';
    h.textContent = opts.title;
    wrap.appendChild(h);
  }

  const host = document.createElement('div');
  host.className = 'tradingview-widget-container';
  const inner = document.createElement('div');
  inner.className = 'tradingview-widget-container__widget';
  host.appendChild(inner);
  wrap.appendChild(host);

  let mounted = false;
  const mount = (): void => {
    if (mounted) return;
    mounted = true;
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.src = `${TV_BASE}${type}.js`;
    script.textContent = JSON.stringify({ ...baseTheme(), ...config });
    host.appendChild(script);
  };

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries, obs) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          mount();
          obs.disconnect();
          break;
        }
      }
    }, { rootMargin: '200px' });
    io.observe(wrap);
  } else {
    mount();
  }

  return wrap;
}

/**
 * Advanced (candlestick) chart — the heaviest widget. On a low-end device the
 * terminal should prefer a mini chart; this respects that via the tier so the
 * caller can just ask for the "best chart this machine can afford".
 */
export function createChart(symbol: string, title: string): HTMLElement {
  const tier = getDeviceTier();
  if (tier === 'low') {
    // Lightweight sparkline-style overview — far cheaper than a full chart.
    return createTvWidget('mini-symbol-overview', {
      symbol,
      dateRange: '12M',
      trendLineColor: '#f97316',
      underLineColor: 'rgba(249,115,22,0.12)',
      width: '100%',
      height: '100%',
      chartOnly: false,
      noTimeScale: false,
    }, { minHeight: 180, title });
  }
  return createTvWidget('advanced-chart', {
    symbol,
    interval: 'D',
    timezone: 'Etc/UTC',
    style: '1',
    hide_side_toolbar: true,
    allow_symbol_change: false,
    save_image: false,
    calendar: false,
    width: '100%',
    height: '100%',
  }, { minHeight: tier === 'mid' ? 260 : 320, title });
}
