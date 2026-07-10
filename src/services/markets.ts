import type { MarketData, CryptoData } from '@/types';
import { API_URLS, CRYPTO_MAP } from '@/config';
import { fetchWithProxy } from '@/utils';

interface FinnhubQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  timestamp: number;
  error?: string;
}

interface FinnhubResponse {
  quotes: FinnhubQuote[];
  error?: string;
  skipped?: boolean;
  reason?: string;
}

export interface MarketFetchResult {
  data: MarketData[];
  skipped?: boolean;
  reason?: string;
}

interface YahooFinanceResponse {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice: number;
        chartPreviousClose?: number;
        previousClose?: number;
      };
      indicators?: {
        quote?: Array<{ close?: (number | null)[] }>;
      };
    }>;
  };
}

interface CoinGeckoResponse {
  [key: string]: {
    usd: number;
    usd_24h_change: number;
  };
}

interface CoinGeckoMarketItem {
  id: string;
  current_price: number;
  price_change_percentage_24h: number;
  sparkline_in_7d?: { price: number[] };
}

// Symbols that need Yahoo Finance (indices, world indices and futures are not on
// the Finnhub free tier). FX pairs and treasury yields also resolve via Yahoo but
// are fetched directly through fetchYahooQuotes, so they need not be listed here.
const YAHOO_ONLY_SYMBOLS = new Set([
  '^GSPC', '^DJI', '^IXIC', '^VIX', '^RUT',
  '^FTSE', '^GDAXI', '^N225', '^HSI',
  'GC=F', 'CL=F', 'NG=F', 'SI=F', 'HG=F',
]);

let lastSuccessfulResults: MarketData[] = [];

async function fetchFromFinnhub(
  symbols: Array<{ symbol: string; name: string; display: string }>
): Promise<MarketFetchResult> {
  const symbolList = symbols.map(s => s.symbol);
  const url = API_URLS.finnhub(symbolList);

  try {
    const response = await fetchWithProxy(url);

    if (!response.ok) {
      console.warn(`[Markets] Finnhub returned ${response.status}`);
      return { data: [] };
    }

    const data: FinnhubResponse = await response.json();

    if (data.skipped) {
      return { data: [], skipped: true, reason: data.reason || 'FINNHUB_API_KEY not configured' };
    }

    if (data.error) {
      console.warn(`[Markets] Finnhub error: ${data.error}`);
      return { data: [] };
    }

    const symbolMap = new Map(symbols.map(s => [s.symbol, s]));

    const results = data.quotes
      .filter(q => !q.error && q.price > 0)
      .map(q => {
        const info = symbolMap.get(q.symbol);
        return {
          symbol: q.symbol,
          name: info?.name || q.symbol,
          display: info?.display || q.symbol,
          price: q.price,
          change: q.changePercent,
        };
      });
    return { data: results };
  } catch (error) {
    console.error('[Markets] Finnhub fetch failed:', error);
    return { data: [] };
  }
}

// Extract a MarketData row from a Yahoo chart response — ONE parser shared by the
// single-symbol and batched fetch paths.
function extractYahooMarketData(
  symbol: string,
  name: string,
  display: string,
  data: YahooFinanceResponse | null | undefined
): MarketData | null {
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) return null;

  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose || meta.previousClose || price;
  const change = ((price - prevClose) / prevClose) * 100;

  const closes = result.indicators?.quote?.[0]?.close;
  const sparkline = closes?.filter((v): v is number => v != null);

  return { symbol, name, display, price, change, sparkline };
}

async function fetchFromYahoo(
  symbol: string,
  name: string,
  display: string
): Promise<MarketData | null> {
  try {
    const url = API_URLS.yahooFinance(symbol);
    const response = await fetchWithProxy(url);
    if (!response.ok) return null;
    const data: YahooFinanceResponse = await response.json();
    return extractYahooMarketData(symbol, name, display, data);
  } catch {
    return null;
  }
}

interface YahooBatchResponse {
  // `chart` is the upstream Yahoo body verbatim — the whole { chart: { result } }
  // envelope, same bytes the single-symbol passthrough returns — so it parses
  // through the shared extractor exactly like the single path.
  results?: Array<{ symbol: string; chart?: YahooFinanceResponse; error?: string }>;
}

// Yahoo symbols in ONE request per chunk instead of one GET per symbol. Returns a
// row per input in input order, price/change null when a symbol fails, so callers
// render a quiet unavailable line without an error wall — same contract as the old
// per-symbol Promise.all, at a fraction of the round trips.
async function fetchYahooBatch(
  symbols: Array<{ symbol: string; name: string; display: string }>
): Promise<MarketData[]> {
  const BATCH = 60; // must not exceed the server's yahooBatchMaxSymbols
  const out: MarketData[] = [];
  for (let i = 0; i < symbols.length; i += BATCH) {
    const chunk = symbols.slice(i, i + BATCH);
    try {
      const response = await fetchWithProxy(API_URLS.yahooBatch(chunk.map((s) => s.symbol)));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as YahooBatchResponse;
      const bySymbol = new Map((data.results ?? []).map((r) => [r.symbol.toUpperCase(), r]));
      for (const s of chunk) {
        const r = bySymbol.get(s.symbol.toUpperCase());
        const md = r?.chart ? extractYahooMarketData(s.symbol, s.name, s.display, r.chart) : null;
        out.push(md ?? { symbol: s.symbol, name: s.name, display: s.display, price: null, change: null });
      }
    } catch {
      for (const s of chunk) {
        out.push({ symbol: s.symbol, name: s.name, display: s.display, price: null, change: null });
      }
    }
  }
  return out;
}

export async function fetchMultipleStocks(
  symbols: Array<{ symbol: string; name: string; display: string }>,
  options: {
    onBatch?: (results: MarketData[]) => void;
  } = {}
): Promise<MarketFetchResult> {
  const finnhubSymbols = symbols.filter(s => !YAHOO_ONLY_SYMBOLS.has(s.symbol));
  const yahooSymbols = symbols.filter(s => YAHOO_ONLY_SYMBOLS.has(s.symbol));

  const results: MarketData[] = [];
  let skipped = false;
  let reason: string | undefined;

  if (finnhubSymbols.length > 0) {
    const finnhubResult = await fetchFromFinnhub(finnhubSymbols);
    if (finnhubResult.skipped) {
      skipped = true;
      reason = finnhubResult.reason;
    }
    results.push(...finnhubResult.data);
    options.onBatch?.(results);
  }

  if (yahooSymbols.length > 0) {
    const yahooResults = await fetchYahooBatch(yahooSymbols);
    results.push(...yahooResults.filter((r) => r.price != null));
    options.onBatch?.(results);
  }

  if (results.length > 0) {
    lastSuccessfulResults = results;
  }

  const data = results.length > 0 ? results : lastSuccessfulResults;
  return { data, skipped, reason };
}

export async function fetchStockQuote(
  symbol: string,
  name: string,
  display: string
): Promise<MarketData> {
  if (YAHOO_ONLY_SYMBOLS.has(symbol)) {
    const result = await fetchFromYahoo(symbol, name, display);
    return result || { symbol, name, display, price: null, change: null };
  }

  const result = await fetchFromFinnhub([{ symbol, name, display }]);
  return result.data[0] || { symbol, name, display, price: null, change: null };
}

/**
 * Fetch an arbitrary list of Yahoo symbols (indices, futures, FX pairs, treasury
 * yields — anything the /v1/world/yahoo-finance passthrough resolves). Returns
 * one row per input in the SAME order, price/change null when a symbol fails, so
 * callers can render a quiet unavailable line without an error wall. Independent
 * of the Finnhub path and the module-level last-good cache used by
 * fetchMultipleStocks — each poll stands alone.
 */
export async function fetchYahooQuotes(
  symbols: Array<{ symbol: string; name: string; display: string }>
): Promise<MarketData[]> {
  return fetchYahooBatch(symbols);
}

export async function fetchCrypto(): Promise<CryptoData[]> {
  try {
    const ids = Object.keys(CRYPTO_MAP).join(',');
    const marketsUrl = `/v1/world/coingecko?ids=${ids}&vs_currencies=usd&endpoint=markets`;
    const response = await fetchWithProxy(marketsUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: CoinGeckoMarketItem[] = await response.json();

    if (!Array.isArray(data)) {
      const fallback: CoinGeckoResponse = data;
      return Object.entries(CRYPTO_MAP).map(([id, info]) => ({
        name: info.name,
        symbol: info.symbol,
        price: fallback[id]?.usd ?? 0,
        change: fallback[id]?.usd_24h_change ?? 0,
      }));
    }

    const byId = new Map(data.map(c => [c.id, c]));
    return Object.entries(CRYPTO_MAP).map(([id, info]) => {
      const coin = byId.get(id);
      const prices = coin?.sparkline_in_7d?.price;
      const sparkline = prices && prices.length > 24 ? prices.slice(-48) : prices;
      return {
        name: info.name,
        symbol: info.symbol,
        price: coin?.current_price ?? 0,
        change: coin?.price_change_percentage_24h ?? 0,
        sparkline,
      };
    });
  } catch (e) {
    console.error('Failed to fetch crypto:', e);
    return [];
  }
}
