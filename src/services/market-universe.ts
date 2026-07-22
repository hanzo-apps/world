import type { MarketData, CryptoData } from '@/types';
import { fetchYahooQuotes, fetchCrypto } from '@/services/markets';
import {
  yahooUniverse,
  universeByClass,
  ASSET_CLASSES,
  type AssetClass,
} from '@/config/market-universe';

// One normalized quote for the whole market universe. Joins the two boundary
// fetchers (Yahoo passthrough for non-crypto, CoinGecko for crypto) back to the
// universe metadata so every consumer sees ONE flat, plot-ready row shape —
// `changePct` is always a percent, `inverse` is already resolved, `price` is never
// null (null-price rows are dropped at the source).
export interface MarketDatum {
  id: string; // symbol ('^GSPC', 'GC=F', 'EURUSD=X') or crypto ticker ('BTC')
  name: string;
  cls: AssetClass;
  group: string;
  price: number | null;
  changePct: number | null;
  weight: number;
  inverse: boolean;
  digits: number;
}

// Crypto is BTC/ETH-anchored (rank-lite): the two majors read bigger; everything
// else is baseline. Prices span 5 orders of magnitude, so decimals follow the value.
function cryptoWeight(symbol: string): number {
  return symbol === 'BTC' || symbol === 'ETH' ? 1.5 : 1;
}
function cryptoDigits(price: number): number {
  return price >= 1 ? 2 : 4;
}

async function load(): Promise<MarketDatum[]> {
  const [yahoo, crypto] = await Promise.all([
    fetchYahooQuotes(yahooUniverse()).catch(() => [] as MarketData[]),
    fetchCrypto().catch(() => [] as CryptoData[]),
  ]);

  const bySymbol = new Map(yahoo.map((d) => [d.symbol, d]));
  const out: MarketDatum[] = [];

  for (const cls of ASSET_CLASSES) {
    if (cls === 'crypto') continue; // crypto has no UniverseSymbols — joined below
    for (const u of universeByClass(cls)) {
      const q = bySymbol.get(u.symbol);
      if (!q || q.price == null) continue; // drop rows with no live price
      out.push({
        id: u.symbol,
        name: u.name,
        cls: u.cls,
        group: u.group,
        price: q.price,
        changePct: q.change,
        weight: u.weight ?? 1,
        inverse: u.inverse ?? false,
        digits: u.digits ?? 2,
      });
    }
  }

  for (const c of crypto) {
    if (!c.price) continue; // drop unpriced coins
    out.push({
      id: c.symbol,
      name: c.name,
      cls: 'crypto',
      group: 'Crypto',
      price: c.price,
      changePct: c.change,
      weight: cryptoWeight(c.symbol),
      inverse: false,
      digits: cryptoDigits(c.price),
    });
  }

  return out;
}

// Short-lived coalescing cache. Under the e2e harness (VITE_E2E=1) the window is
// tiny so a fast re-poll makes a real upstream round-trip a test can observe.
const TTL_MS =
  import.meta.env.VITE_E2E === '1' || import.meta.env.VITE_E2E === 'true' ? 200 : 15_000;
let cache: { at: number; data: MarketDatum[] } | null = null;
let inflight: Promise<MarketDatum[]> | null = null;

// Cached + in-flight-guarded so many pollers (bubble panel + future consumers)
// coalesce onto a single upstream round-trip within the TTL window.
export async function fetchMarketUniverse(): Promise<MarketDatum[]> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.data;
  if (inflight) return inflight;
  inflight = load()
    .then((data) => {
      cache = { at: Date.now(), data };
      inflight = null;
      return data;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}
