import type { PredictionMarket } from '@/types';
import { fetchWithProxy, createCircuitBreaker } from '@/utils';

interface PolymarketMarket {
  question: string;
  outcomes?: string[];
  outcomePrices?: string;
  volume?: string;
  volumeNum?: number;
  closed?: boolean;
}

const breaker = createCircuitBreaker<PredictionMarket[]>({ name: 'Polymarket' });

export async function fetchPredictions(): Promise<PredictionMarket[]> {
  return breaker.execute(async () => {
    const response = await fetchWithProxy(
      '/api/polymarket/markets?closed=false&order=volume&ascending=false&limit=25'
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: PolymarketMarket[] = await response.json();

    return data
      .map((market) => {
        let yesPrice = 50;
        try {
          const pricesStr = market.outcomePrices;
          if (pricesStr) {
            const prices: string[] = JSON.parse(pricesStr);
            if (Array.isArray(prices) && prices.length >= 1 && prices[0]) {
              const parsed = parseFloat(prices[0]);
              if (!isNaN(parsed)) yesPrice = parsed * 100;
            }
          }
        } catch { /* Keep default */ }

        const volume = market.volumeNum ?? (market.volume ? parseFloat(market.volume) : 0);
        return { title: market.question || '', yesPrice, volume };
      })
      .filter((p) => {
        if (!p.title || isNaN(p.yesPrice)) return false;
        const discrepancy = Math.abs(p.yesPrice - 50);
        return discrepancy > 10 || (p.volume && p.volume > 10000);
      })
      .slice(0, 12);
  }, []);
}

export function getPolymarketStatus(): string {
  return breaker.getStatus();
}
