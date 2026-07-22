// The ONE market universe. Every tradable this app plots — indices, commodities,
// FX, rates, crypto — declared once here with its asset class, group, importance
// weight and colour polarity. Every finance surface (the Markets Bubble, and the
// Commodities/FX/Rates panels that derive their symbol lists from it) reads THIS
// list, so a symbol is added or reweighted in exactly one place.
//
// `change` semantics live at the boundary (services/markets): MarketData.change and
// CryptoData.change are both PERCENT moves. `inverse` marks a gauge whose rise is
// risk-OFF (VIX, MOVE) so colour is flipped for it — up reads red, not green.

export type AssetClass = 'equities' | 'commodities' | 'fx' | 'rates' | 'crypto';

export interface UniverseSymbol {
  symbol: string; // Yahoo symbol (the join key), e.g. '^GSPC', 'GC=F', 'EURUSD=X'
  name: string; // human label, e.g. 'S&P 500', 'Gold'
  display?: string; // short ticker for the fetch payload; defaults to `symbol`
  cls: AssetClass;
  group: string; // sub-group within the class, e.g. 'Metals', 'Majors'
  digits?: number; // price decimals for terminal-style formatting
  weight?: number; // relative importance → base bubble radius (indices 3, majors 2, else 1)
  inverse?: boolean; // vol gauge: up = risk-off → flip the diverging colour
}

// Declared in render order; helpers below preserve it so grouped panels read
// top-to-bottom exactly as authored.
const UNIVERSE: UniverseSymbol[] = [
  // ── Equities ───────────────────────────────────────────────────────────────
  { symbol: '^GSPC', name: 'S&P 500', cls: 'equities', group: 'Indices', digits: 2, weight: 3 },
  { symbol: '^DJI', name: 'Dow Jones', cls: 'equities', group: 'Indices', digits: 2, weight: 3 },
  { symbol: '^IXIC', name: 'Nasdaq', cls: 'equities', group: 'Indices', digits: 2, weight: 3 },
  { symbol: '^RUT', name: 'Russell 2000', cls: 'equities', group: 'Indices', digits: 2, weight: 3 },
  { symbol: '^VIX', name: 'VIX', cls: 'equities', group: 'Volatility', digits: 2, weight: 2, inverse: true },

  // ── Commodities ──────────────────────────────────────────────────────────── (labels match CommoditiesPanel)
  { symbol: 'GC=F', name: 'Gold', cls: 'commodities', group: 'Metals', digits: 2, weight: 1 },
  { symbol: 'SI=F', name: 'Silver', cls: 'commodities', group: 'Metals', digits: 2, weight: 1 },
  { symbol: 'HG=F', name: 'Copper', cls: 'commodities', group: 'Metals', digits: 2, weight: 1 },
  { symbol: 'PL=F', name: 'Platinum', cls: 'commodities', group: 'Metals', digits: 2, weight: 1 },
  { symbol: 'CL=F', name: 'WTI crude', cls: 'commodities', group: 'Energy', digits: 2, weight: 1 },
  { symbol: 'BZ=F', name: 'Brent crude', cls: 'commodities', group: 'Energy', digits: 2, weight: 1 },
  { symbol: 'NG=F', name: 'Natural gas', cls: 'commodities', group: 'Energy', digits: 2, weight: 1 },
  { symbol: 'ZW=F', name: 'Wheat', cls: 'commodities', group: 'Agriculture', digits: 2, weight: 1 },
  { symbol: 'ZC=F', name: 'Corn', cls: 'commodities', group: 'Agriculture', digits: 2, weight: 1 },
  { symbol: 'ZS=F', name: 'Soybeans', cls: 'commodities', group: 'Agriculture', digits: 2, weight: 1 },
  { symbol: 'KC=F', name: 'Coffee', cls: 'commodities', group: 'Agriculture', digits: 2, weight: 1 },
  { symbol: 'SB=F', name: 'Sugar', cls: 'commodities', group: 'Agriculture', digits: 2, weight: 1 },
  { symbol: 'CC=F', name: 'Cocoa', cls: 'commodities', group: 'Agriculture', digits: 2, weight: 1 },

  // ── FX ───────────────────────────────────────────────────────────────────── (digits mirror FxPanel)
  { symbol: 'DX-Y.NYB', name: 'Dollar Index', display: 'DXY', cls: 'fx', group: 'Majors', digits: 2, weight: 2 },
  { symbol: 'EURUSD=X', name: 'EUR/USD', cls: 'fx', group: 'Majors', digits: 4, weight: 2 },
  { symbol: 'USDJPY=X', name: 'USD/JPY', cls: 'fx', group: 'Majors', digits: 3, weight: 2 },
  { symbol: 'GBPUSD=X', name: 'GBP/USD', cls: 'fx', group: 'Majors', digits: 4, weight: 2 },
  { symbol: 'AUDUSD=X', name: 'AUD/USD', cls: 'fx', group: 'Majors', digits: 4, weight: 2 },
  { symbol: 'NZDUSD=X', name: 'NZD/USD', cls: 'fx', group: 'Majors', digits: 4, weight: 2 },
  { symbol: 'USDCHF=X', name: 'USD/CHF', cls: 'fx', group: 'Majors', digits: 4, weight: 2 },
  { symbol: 'USDCAD=X', name: 'USD/CAD', cls: 'fx', group: 'Majors', digits: 4, weight: 2 },
  { symbol: 'EURGBP=X', name: 'EUR/GBP', cls: 'fx', group: 'Crosses', digits: 4, weight: 1 },
  { symbol: 'EURJPY=X', name: 'EUR/JPY', cls: 'fx', group: 'Crosses', digits: 3, weight: 1 },
  { symbol: 'EURCHF=X', name: 'EUR/CHF', cls: 'fx', group: 'Crosses', digits: 4, weight: 1 },
  { symbol: 'GBPJPY=X', name: 'GBP/JPY', cls: 'fx', group: 'Crosses', digits: 3, weight: 1 },
  { symbol: 'AUDJPY=X', name: 'AUD/JPY', cls: 'fx', group: 'Crosses', digits: 3, weight: 1 },
  { symbol: 'USDCNH=X', name: 'USD/CNH', cls: 'fx', group: 'Crosses', digits: 4, weight: 1 },

  // ── Rates & credit ───────────────────────────────────────────────────────── (^MOVE is vol → inverse)
  { symbol: '^IRX', name: '13-week', cls: 'rates', group: 'Treasuries', digits: 2, weight: 1 },
  { symbol: '2YY=F', name: '2-year', cls: 'rates', group: 'Treasuries', digits: 2, weight: 1 },
  { symbol: '^FVX', name: '5-year', cls: 'rates', group: 'Treasuries', digits: 2, weight: 1 },
  { symbol: '^TNX', name: '10-year', cls: 'rates', group: 'Treasuries', digits: 2, weight: 1 },
  { symbol: '^TYX', name: '30-year', cls: 'rates', group: 'Treasuries', digits: 2, weight: 1 },
  { symbol: 'TLT', name: 'TLT', cls: 'rates', group: 'Credit', digits: 2, weight: 1 },
  { symbol: 'LQD', name: 'LQD', cls: 'rates', group: 'Credit', digits: 2, weight: 1 },
  { symbol: 'HYG', name: 'HYG', cls: 'rates', group: 'Credit', digits: 2, weight: 1 },
  { symbol: '^MOVE', name: 'MOVE', cls: 'rates', group: 'Volatility', digits: 1, weight: 1, inverse: true },
];

// The five classes in canonical display order.
export const ASSET_CLASSES: readonly AssetClass[] = ['equities', 'commodities', 'fx', 'rates', 'crypto'];

// Human labels for a class (crypto has no UniverseSymbols — it arrives from fetchCrypto).
export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  equities: 'Equities',
  commodities: 'Commodities',
  fx: 'FX',
  rates: 'Rates',
  crypto: 'Crypto',
};

export function universeByClass(cls: AssetClass): UniverseSymbol[] {
  return UNIVERSE.filter((s) => s.cls === cls);
}

// Class members grouped by `group`, preserving first-seen order for both groups and
// rows. The ONE place grouping is derived, so panels never re-encode their own lists.
export function universeGroups(cls: AssetClass): Array<{ label: string; items: UniverseSymbol[] }> {
  const groups: Array<{ label: string; items: UniverseSymbol[] }> = [];
  const byLabel = new Map<string, { label: string; items: UniverseSymbol[] }>();
  for (const s of universeByClass(cls)) {
    let g = byLabel.get(s.group);
    if (!g) {
      g = { label: s.group, items: [] };
      byLabel.set(s.group, g);
      groups.push(g);
    }
    g.items.push(s);
  }
  return groups;
}

// Every non-crypto symbol shaped for fetchYahooQuotes({symbol,name,display}[]).
export function yahooUniverse(): Array<{ symbol: string; name: string; display: string }> {
  return UNIVERSE.map((s) => ({ symbol: s.symbol, name: s.name, display: s.display ?? s.symbol }));
}
