import type { PredictionMarket } from '@/types';
import { createCircuitBreaker } from '@/utils';

interface PolymarketMarket {
  question: string;
  outcomes?: string[];
  outcomePrices?: string;
  volume?: string;
  volumeNum?: number;
  closed?: boolean;
  tags?: Array<{ slug: string }>;
}

const breaker = createCircuitBreaker<PredictionMarket[]>({ name: 'Polymarket' });

// Geopolitical keywords for filtering relevant markets
const GEOPOLITICAL_KEYWORDS = [
  // Conflicts & Military
  'war', 'military', 'invasion', 'attack', 'strike', 'troops', 'nato', 'nuclear',
  'missile', 'drone', 'ceasefire', 'peace', 'conflict', 'terrorist', 'hamas', 'hezbollah',
  // Countries & Leaders
  'russia', 'ukraine', 'china', 'taiwan', 'iran', 'israel', 'gaza', 'palestine',
  'north korea', 'syria', 'putin', 'zelensky', 'xi jinping', 'netanyahu', 'kim jong',
  // Politics & Elections
  'president', 'election', 'congress', 'senate', 'parliament', 'government', 'minister',
  'trump', 'biden', 'administration', 'democrat', 'republican', 'vote', 'impeach',
  // Economics & Trade
  'fed', 'interest rate', 'inflation', 'recession', 'gdp', 'tariff', 'sanctions',
  'oil', 'opec', 'economy', 'trade war', 'currency', 'debt', 'default',
  // Global Issues
  'climate', 'pandemic', 'who', 'un ', 'united nations', 'eu ', 'european union',
  'summit', 'treaty', 'alliance', 'coup', 'protest', 'uprising', 'refugee',
];

// Sports/Entertainment to exclude
const EXCLUDE_KEYWORDS = [
  'nba', 'nfl', 'mlb', 'nhl', 'fifa', 'world cup', 'super bowl', 'championship',
  'playoffs', 'oscar', 'grammy', 'emmy', 'box office', 'movie', 'album', 'song',
  'tiktok', 'youtube', 'streamer', 'influencer', 'celebrity', 'kardashian',
  'bachelor', 'reality tv', 'mvp', 'touchdown', 'home run', 'goal scorer',
];

function isGeopoliticallyRelevant(title: string): boolean {
  const lower = title.toLowerCase();

  // Exclude sports/entertainment
  if (EXCLUDE_KEYWORDS.some(kw => lower.includes(kw))) {
    return false;
  }

  // Include if has geopolitical keywords
  return GEOPOLITICAL_KEYWORDS.some(kw => lower.includes(kw));
}

export async function fetchPredictions(): Promise<PredictionMarket[]> {
  return breaker.execute(async () => {
    const response = await fetch('/api/polymarket?closed=false&order=volume&ascending=false&limit=100');
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

        // Must be geopolitically relevant
        if (!isGeopoliticallyRelevant(p.title)) return false;

        // Must have meaningful signal (not 50/50) or high volume
        const discrepancy = Math.abs(p.yesPrice - 50);
        return discrepancy > 5 || (p.volume && p.volume > 50000);
      })
      .slice(0, 15);
  }, []);
}

export function getPolymarketStatus(): string {
  return breaker.getStatus();
}
