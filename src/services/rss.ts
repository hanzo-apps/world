import type { Feed, NewsItem } from '@/types';
import { ALERT_KEYWORDS } from '@/config';
import { chunkArray, fetchWithProxy } from '@/utils';

// Per-feed circuit breaker: track failures and cooldowns
const FEED_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes after failure
const MAX_FAILURES = 2; // failures before cooldown
const feedFailures = new Map<string, { count: number; cooldownUntil: number }>();
const feedCache = new Map<string, { items: NewsItem[]; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function isFeedOnCooldown(feedName: string): boolean {
  const state = feedFailures.get(feedName);
  if (!state) return false;
  if (Date.now() < state.cooldownUntil) {
    return true;
  }
  // Cooldown expired, reset
  if (state.cooldownUntil > 0) {
    feedFailures.delete(feedName);
  }
  return false;
}

function recordFeedFailure(feedName: string): void {
  const state = feedFailures.get(feedName) || { count: 0, cooldownUntil: 0 };
  state.count++;
  if (state.count >= MAX_FAILURES) {
    state.cooldownUntil = Date.now() + FEED_COOLDOWN_MS;
    console.warn(`[RSS] ${feedName} on cooldown for 5 minutes after ${state.count} failures`);
  }
  feedFailures.set(feedName, state);
}

function recordFeedSuccess(feedName: string): void {
  feedFailures.delete(feedName);
}

export async function fetchFeed(feed: Feed): Promise<NewsItem[]> {
  // Check cooldown
  if (isFeedOnCooldown(feed.name)) {
    const cached = feedCache.get(feed.name);
    if (cached) return cached.items;
    return [];
  }

  // Check cache
  const cached = feedCache.get(feed.name);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.items;
  }

  try {
    const response = await fetchWithProxy(feed.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      console.warn(`Parse error for ${feed.name}`);
      recordFeedFailure(feed.name);
      return cached?.items || [];
    }

    const items = doc.querySelectorAll('item');

    const parsed = Array.from(items)
      .slice(0, 5)
      .map((item) => {
        const title = item.querySelector('title')?.textContent || '';
        const link = item.querySelector('link')?.textContent || '';
        const pubDateStr = item.querySelector('pubDate')?.textContent || '';
        const pubDate = pubDateStr ? new Date(pubDateStr) : new Date();
        const isAlert = ALERT_KEYWORDS.some((kw) =>
          title.toLowerCase().includes(kw)
        );

        return {
          source: feed.name,
          title,
          link,
          pubDate,
          isAlert,
        };
      });

    // Cache successful result
    feedCache.set(feed.name, { items: parsed, timestamp: Date.now() });
    recordFeedSuccess(feed.name);
    return parsed;
  } catch (e) {
    console.error(`Failed to fetch ${feed.name}:`, e);
    recordFeedFailure(feed.name);
    return cached?.items || [];
  }
}

export async function fetchCategoryFeeds(
  feeds: Feed[],
  options: {
    batchSize?: number;
    onBatch?: (items: NewsItem[]) => void;
  } = {}
): Promise<NewsItem[]> {
  const batchSize = options.batchSize ?? 5;
  const batches = chunkArray(feeds, batchSize);
  const items: NewsItem[] = [];

  for (const batch of batches) {
    const results = await Promise.all(batch.map(fetchFeed));
    items.push(...results.flat());

    items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    options.onBatch?.(items.slice(0, 20));
  }

  // Record data freshness if we got items
  if (items.length > 0) {
    import('./data-freshness').then(({ dataFreshness }) => {
      dataFreshness.recordUpdate('rss', items.length);
    });
  }

  return items.slice(0, 20);
}
