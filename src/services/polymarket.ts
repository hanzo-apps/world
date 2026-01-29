import type { PredictionMarket } from '@/types';
import { createCircuitBreaker } from '@/utils';
import { SITE_VARIANT } from '@/config';

interface PolymarketMarket {
  question: string;
  outcomes?: string;
  outcomePrices?: string;
  volume?: string;
  volumeNum?: number;
  closed?: boolean;
  slug?: string;
}

interface PolymarketEvent {
  id: string;
  title: string;
  slug: string;
  volume?: number;
  liquidity?: number;
  markets?: PolymarketMarket[];
  tags?: Array<{ slug: string }>;
  closed?: boolean;
}

const breaker = createCircuitBreaker<PredictionMarket[]>({ name: 'Polymarket' });

const GEOPOLITICAL_TAGS = [
  'politics', 'geopolitics', 'elections', 'world',
  'ukraine', 'china', 'middle-east', 'europe',
  'economy', 'fed', 'inflation',
];

const TECH_TAGS = [
  'ai', 'tech', 'crypto', 'science',
  'elon-musk', 'business', 'economy',
];

const EXCLUDE_KEYWORDS = [
  'nba', 'nfl', 'mlb', 'nhl', 'fifa', 'world cup', 'super bowl', 'championship',
  'playoffs', 'oscar', 'grammy', 'emmy', 'box office', 'movie', 'album', 'song',
  'streamer', 'influencer', 'celebrity', 'kardashian',
  'bachelor', 'reality tv', 'mvp', 'touchdown', 'home run', 'goal scorer',
  'academy award', 'bafta', 'golden globe', 'cannes', 'sundance',
  'documentary', 'feature film', 'tv series', 'season finale',
];

function isExcluded(title: string): boolean {
  const lower = title.toLowerCase();
  return EXCLUDE_KEYWORDS.some(kw => lower.includes(kw));
}

function parseMarketPrice(market: PolymarketMarket): number {
  try {
    const pricesStr = market.outcomePrices;
    if (pricesStr) {
      const prices: string[] = JSON.parse(pricesStr);
      if (prices.length >= 1) {
        const parsed = parseFloat(prices[0]!);
        if (!isNaN(parsed)) return parsed * 100;
      }
    }
  } catch { /* keep default */ }
  return 50;
}

function buildMarketUrl(eventSlug?: string, marketSlug?: string): string | undefined {
  if (eventSlug) return `https://polymarket.com/event/${eventSlug}`;
  if (marketSlug) return `https://polymarket.com/market/${marketSlug}`;
  return undefined;
}

async function fetchEventsByTag(tag: string, limit = 30): Promise<PolymarketEvent[]> {
  const response = await fetch(
    `/api/polymarket?endpoint=events&tag=${tag}&closed=false&order=volume&ascending=false&limit=${limit}`
  );
  if (!response.ok) return [];
  return response.json();
}

async function fetchTopMarkets(): Promise<PredictionMarket[]> {
  const response = await fetch('/api/polymarket?closed=false&order=volume&ascending=false&limit=100');
  if (!response.ok) return [];
  const data: PolymarketMarket[] = await response.json();

  return data
    .filter(m => m.question && !isExcluded(m.question))
    .map(m => {
      const yesPrice = parseMarketPrice(m);
      const volume = m.volumeNum ?? (m.volume ? parseFloat(m.volume) : 0);
      return {
        title: m.question,
        yesPrice,
        volume,
        url: buildMarketUrl(undefined, m.slug),
      };
    });
}

export async function fetchPredictions(): Promise<PredictionMarket[]> {
  return breaker.execute(async () => {
    const tags = SITE_VARIANT === 'tech' ? TECH_TAGS : GEOPOLITICAL_TAGS;

    const eventResults = await Promise.all(tags.map(tag => fetchEventsByTag(tag, 20)));

    const seen = new Set<string>();
    const markets: PredictionMarket[] = [];

    for (const events of eventResults) {
      for (const event of events) {
        if (event.closed || seen.has(event.id)) continue;
        seen.add(event.id);

        if (isExcluded(event.title)) continue;

        const eventVolume = event.volume ?? 0;
        if (eventVolume < 1000) continue;

        if (event.markets && event.markets.length > 0) {
          const topMarket = event.markets.reduce((best, m) => {
            const vol = m.volumeNum ?? (m.volume ? parseFloat(m.volume) : 0);
            const bestVol = best.volumeNum ?? (best.volume ? parseFloat(best.volume) : 0);
            return vol > bestVol ? m : best;
          });

          const yesPrice = parseMarketPrice(topMarket);
          markets.push({
            title: topMarket.question || event.title,
            yesPrice,
            volume: eventVolume,
            url: buildMarketUrl(event.slug),
          });
        } else {
          markets.push({
            title: event.title,
            yesPrice: 50,
            volume: eventVolume,
            url: buildMarketUrl(event.slug),
          });
        }
      }
    }

    // Fallback: only fetch top markets if tag queries didn't yield enough
    if (markets.length < 15) {
      const fallbackMarkets = await fetchTopMarkets();
      for (const m of fallbackMarkets) {
        if (markets.length >= 20) break;
        if (!markets.some(existing => existing.title === m.title)) {
          markets.push(m);
        }
      }
    }

    // Sort by volume descending, then filter for meaningful signal
    return markets
      .filter(m => {
        const discrepancy = Math.abs(m.yesPrice - 50);
        return discrepancy > 5 || (m.volume && m.volume > 50000);
      })
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, 15);
  }, []);
}

export function getPolymarketStatus(): string {
  return breaker.getStatus();
}
