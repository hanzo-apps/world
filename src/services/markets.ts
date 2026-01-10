import type { MarketData, CryptoData } from '@/types';
import { API_URLS, CRYPTO_MAP } from '@/config';
import { chunkArray, fetchWithProxy } from '@/utils';

interface YahooFinanceResponse {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice: number;
        chartPreviousClose?: number;
        previousClose?: number;
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

// Circuit breaker for Yahoo Finance rate limiting
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
let rateLimitedUntil = 0;
let lastSuccessfulResults: MarketData[] = [];

function isRateLimited(): boolean {
  if (Date.now() < rateLimitedUntil) {
    const remaining = Math.ceil((rateLimitedUntil - Date.now()) / 1000);
    console.warn(`[Markets] Rate limited, ${remaining}s remaining`);
    return true;
  }
  return false;
}

function triggerRateLimit(): void {
  rateLimitedUntil = Date.now() + COOLDOWN_MS;
  console.warn(`[Markets] Rate limit detected, pausing for 5 minutes`);
}

export async function fetchStockQuote(
  symbol: string,
  name: string,
  display: string
): Promise<MarketData & { rateLimited?: boolean }> {
  if (isRateLimited()) {
    return { symbol, name, display, price: null, change: null };
  }

  try {
    const url = API_URLS.yahooFinance(symbol);
    const response = await fetchWithProxy(url);

    if (response.status === 429) {
      triggerRateLimit();
      return { symbol, name, display, price: null, change: null, rateLimited: true };
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: YahooFinanceResponse = await response.json();

    const meta = data.chart.result[0]?.meta;
    if (!meta) {
      return { symbol, name, display, price: null, change: null };
    }

    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose || price;
    const change = ((price - prevClose) / prevClose) * 100;

    return { symbol, name, display, price, change };
  } catch (e) {
    const msg = String(e);
    if (msg.includes('429')) {
      triggerRateLimit();
      return { symbol, name, display, price: null, change: null, rateLimited: true };
    }
    console.error(`Failed to fetch ${symbol}:`, e);
    return { symbol, name, display, price: null, change: null };
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchMultipleStocks(
  symbols: Array<{ symbol: string; name: string; display: string }>,
  options: {
    batchSize?: number;
    delayMs?: number;
    onBatch?: (results: MarketData[]) => void;
  } = {}
): Promise<MarketData[]> {
  // Return cached results if rate limited
  if (isRateLimited()) {
    if (lastSuccessfulResults.length > 0) {
      options.onBatch?.(lastSuccessfulResults);
      return lastSuccessfulResults;
    }
    return [];
  }

  const results: MarketData[] = [];
  const batchSize = options.batchSize ?? 2;
  const delayMs = options.delayMs ?? 3000;
  const batches = chunkArray(symbols, batchSize);

  for (const [index, batch] of batches.entries()) {
    // Check rate limit before each batch
    if (isRateLimited()) {
      console.log(`[Markets] Stopping fetch after ${results.length} symbols due to rate limit`);
      break;
    }

    const batchResults = await Promise.all(
      batch.map((s) => fetchStockQuote(s.symbol, s.name, s.display))
    );

    // Check if any result triggered rate limit
    const hitRateLimit = batchResults.some((r) => (r as { rateLimited?: boolean }).rateLimited);
    if (hitRateLimit) {
      console.log(`[Markets] Rate limit hit, stopping fetch`);
      break;
    }

    results.push(...batchResults);

    const visibleResults = results.filter((r) => r.price !== null);
    options.onBatch?.(visibleResults);

    if (index < batches.length - 1) {
      const jitter = Math.random() * 1000;
      await delay(delayMs + jitter);
    }
  }

  const successful = results.filter((r) => r.price !== null);
  if (successful.length > 0) {
    lastSuccessfulResults = successful;
  }
  return successful;
}

export async function fetchCrypto(): Promise<CryptoData[]> {
  try {
    const response = await fetchWithProxy(API_URLS.coingecko);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: CoinGeckoResponse = await response.json();

    return Object.entries(CRYPTO_MAP).map(([id, info]) => {
      const coinData = data[id];
      return {
        name: info.name,
        symbol: info.symbol,
        price: coinData?.usd ?? 0,
        change: coinData?.usd_24h_change ?? 0,
      };
    });
  } catch (e) {
    console.error('Failed to fetch crypto:', e);
    return [];
  }
}
