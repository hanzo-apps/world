import type { Feed, NewsItem } from '@/types';
import { SITE_VARIANT } from '@/config';
import { chunkArray, fetchWithProxy } from '@/utils';
import { classifyByKeyword, classifyWithAI } from './threat-classifier';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { ingestHeadlines } from './trending-keywords';
import { getCurrentLanguage } from './i18n';

// Per-feed circuit breaker: track failures and cooldowns
const FEED_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes after failure
const MAX_FAILURES = 2; // failures before cooldown
const MAX_CACHE_ENTRIES = 100; // Prevent unbounded growth
const FEED_SCOPE_SEPARATOR = '::';
const feedFailures = new Map<string, { count: number; cooldownUntil: number }>();
const feedCache = new Map<string, { items: NewsItem[]; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const AI_CLASSIFY_DEDUP_MS = 30 * 60 * 1000;
const AI_CLASSIFY_WINDOW_MS = 60 * 1000;
const AI_CLASSIFY_MAX_PER_WINDOW =
  SITE_VARIANT === 'finance' ? 40 : SITE_VARIANT === 'tech' ? 60 : 80;
const AI_CLASSIFY_MAX_PER_FEED =
  SITE_VARIANT === 'finance' ? 2 : SITE_VARIANT === 'tech' ? 2 : 3;
const aiRecentlyQueued = new Map<string, number>();
const aiDispatches: number[] = [];

function toSerializable(items: NewsItem[]): Array<Omit<NewsItem, 'pubDate'> & { pubDate: string }> {
  return items.map(item => ({ ...item, pubDate: item.pubDate.toISOString() }));
}

function fromSerializable(items: Array<Omit<NewsItem, 'pubDate'> & { pubDate: string }>): NewsItem[] {
  return items.map(item => ({ ...item, pubDate: new Date(item.pubDate) }));
}

function getFeedScope(feedName: string, lang: string): string {
  return `${feedName}${FEED_SCOPE_SEPARATOR}${lang}`;
}

function parseFeedScope(feedScope: string): { feedName: string; lang: string } {
  const splitIndex = feedScope.lastIndexOf(FEED_SCOPE_SEPARATOR);
  if (splitIndex === -1) return { feedName: feedScope, lang: 'en' };
  return {
    feedName: feedScope.slice(0, splitIndex),
    lang: feedScope.slice(splitIndex + FEED_SCOPE_SEPARATOR.length),
  };
}

function getPersistentFeedKey(feedScope: string): string {
  return `feed:${feedScope}`;
}

async function readPersistentFeed(key: string): Promise<NewsItem[] | null> {
  const entry = await getPersistentCache<Array<Omit<NewsItem, 'pubDate'> & { pubDate: string }>>(key);
  if (!entry?.data?.length) return null;
  return fromSerializable(entry.data);
}

async function loadPersistentFeed(feedScope: string): Promise<NewsItem[] | null> {
  const scopedKey = getPersistentFeedKey(feedScope);
  const scoped = await readPersistentFeed(scopedKey);
  if (scoped) return scoped;

  // Migration fallback: older builds stored feeds as `feed:<feedName>` without language scope.
  // Only use this for English to avoid mixing cached content across locales.
  const { feedName, lang } = parseFeedScope(feedScope);
  if (lang !== 'en') return null;
  return readPersistentFeed(`feed:${feedName}`);
}

// Clean up stale entries to prevent unbounded growth
function cleanupCaches(): void {
  const now = Date.now();

  for (const [key, value] of feedCache) {
    if (now - value.timestamp > CACHE_TTL * 2) {
      feedCache.delete(key);
    }
  }

  for (const [key, state] of feedFailures) {
    if (state.cooldownUntil > 0 && now > state.cooldownUntil) {
      feedFailures.delete(key);
    }
  }

  if (feedCache.size > MAX_CACHE_ENTRIES) {
    const entries = Array.from(feedCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, entries.length - MAX_CACHE_ENTRIES);
    for (const [key] of toRemove) {
      feedCache.delete(key);
    }
  }
}

function isFeedOnCooldown(feedScope: string): boolean {
  const state = feedFailures.get(feedScope);
  if (!state) return false;
  if (Date.now() < state.cooldownUntil) return true;
  if (state.cooldownUntil > 0) feedFailures.delete(feedScope);
  return false;
}

function recordFeedFailure(feedScope: string): void {
  const state = feedFailures.get(feedScope) || { count: 0, cooldownUntil: 0 };
  state.count++;
  if (state.count >= MAX_FAILURES) {
    state.cooldownUntil = Date.now() + FEED_COOLDOWN_MS;
    const { feedName, lang } = parseFeedScope(feedScope);
    console.warn(`[RSS] ${feedName} (${lang}) on cooldown for 5 minutes after ${state.count} failures`);
  }
  feedFailures.set(feedScope, state);
}

function recordFeedSuccess(feedScope: string): void {
  feedFailures.delete(feedScope);
}

export function getFeedFailures(): Map<string, { count: number; cooldownUntil: number }> {
  const currentLang = getCurrentLanguage();
  const currentLangFailures = new Map<string, { count: number; cooldownUntil: number }>();

  for (const [feedScope, state] of feedFailures) {
    const { feedName, lang } = parseFeedScope(feedScope);
    if (lang === currentLang) {
      currentLangFailures.set(feedName, state);
    }
  }

  return currentLangFailures;
}

function toAiKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function canQueueAiClassification(title: string): boolean {
  const now = Date.now();
  while (aiDispatches.length > 0 && now - aiDispatches[0]! > AI_CLASSIFY_WINDOW_MS) {
    aiDispatches.shift();
  }
  for (const [key, queuedAt] of aiRecentlyQueued) {
    if (now - queuedAt > AI_CLASSIFY_DEDUP_MS) {
      aiRecentlyQueued.delete(key);
    }
  }
  if (aiDispatches.length >= AI_CLASSIFY_MAX_PER_WINDOW) {
    return false;
  }

  const key = toAiKey(title);
  const lastQueued = aiRecentlyQueued.get(key);
  if (lastQueued && now - lastQueued < AI_CLASSIFY_DEDUP_MS) {
    return false;
  }

  aiDispatches.push(now);
  aiRecentlyQueued.set(key, now);
  return true;
}

export async function fetchFeed(feed: Feed): Promise<NewsItem[]> {
  if (feedCache.size > MAX_CACHE_ENTRIES / 2) cleanupCaches();
  const currentLang = getCurrentLanguage();
  const feedScope = getFeedScope(feed.name, currentLang);

  if (isFeedOnCooldown(feedScope)) {
    const cached = feedCache.get(feedScope);
    if (cached) return cached.items;
    return (await loadPersistentFeed(feedScope)) || [];
  }

  const cached = feedCache.get(feedScope);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.items;
  }

  try {
    let url = typeof feed.url === 'string' ? feed.url : feed.url['en'];
    if (typeof feed.url !== 'string') {
      url = feed.url[currentLang] || feed.url['en'] || Object.values(feed.url)[0] || '';
    }

    if (!url) throw new Error(`No URL found for feed ${feed.name}`);

    const response = await fetchWithProxy(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      console.warn(`Parse error for ${feed.name}`);
      recordFeedFailure(feedScope);
      const persistent = await loadPersistentFeed(feedScope);
      return cached?.items || persistent || [];
    }

    let items = doc.querySelectorAll('item');
    const isAtom = items.length === 0;
    if (isAtom) items = doc.querySelectorAll('entry');

    const raws = Array.from(items)
      .slice(0, 5)
      .map((item) => {
        const title = item.querySelector('title')?.textContent || '';
        let link = '';
        if (isAtom) {
          const linkEl = item.querySelector('link[href]');
          link = linkEl?.getAttribute('href') || '';
        } else {
          link = item.querySelector('link')?.textContent || '';
        }

        const pubDateStr = isAtom
          ? (item.querySelector('published')?.textContent || item.querySelector('updated')?.textContent || '')
          : (item.querySelector('pubDate')?.textContent || '');
        const parsedDate = pubDateStr ? new Date(pubDateStr) : new Date();
        const pubDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
        return { title, link, pubDate };
      });

    return storeFeedItems(feed, feedScope, raws);
  } catch (e) {
    console.error(`Failed to fetch ${feed.name}:`, e);
    recordFeedFailure(feedScope);
    const persistent = await loadPersistentFeed(feedScope);
    return cached?.items || persistent || [];
  }
}

type ServerThreat = { level: string; category: string; confidence: number; source: string };
type ServerGeo = { hubId: string; name: string; lat: number; lon: number; confidence: number };
type RawFeedItem = {
  title: string;
  link: string;
  pubDate: Date;
  // Enrichment from the Go backend (feeds-batch). Present for every item the
  // server parsed; the browser no longer classifies or geo-locates anything.
  threat?: ServerThreat;
  geo?: ServerGeo;
};

// Shared enrich+store pipeline for both transports (client-side DOM parse and
// the server-side /v1/world/feeds-batch): classification, geo inference,
// caches, trending ingestion and the AI reclassification queue live in ONE
// place regardless of where the XML got parsed.
function storeFeedItems(feed: Feed, feedScope: string, raws: RawFeedItem[]): NewsItem[] {
  const parsed = raws.slice(0, 5).map(({ title, link, pubDate, threat: srvThreat, geo }) => {
    // The Go backend classifies and geo-locates (internal/world/enrich.go, proven
    // identical to the old browser code). Falling back to the local classifier
    // keeps a feed usable if it ever arrives unenriched.
    const threat = (srvThreat as NewsItem['threat']) ?? classifyByKeyword(title, SITE_VARIANT);
    const isAlert = threat!.level === 'critical' || threat!.level === 'high';
    return {
      source: feed.name,
      title,
      link,
      pubDate,
      isAlert,
      threat,
      ...(geo && { lat: geo.lat, lon: geo.lon, locationName: geo.name }),
      lang: feed.lang,
    };
  });

  feedCache.set(feedScope, { items: parsed, timestamp: Date.now() });
  void setPersistentCache(getPersistentFeedKey(feedScope), toSerializable(parsed));
  recordFeedSuccess(feedScope);
  ingestHeadlines(parsed.map(item => ({
    title: item.title,
    pubDate: item.pubDate,
    source: item.source,
    link: item.link,
  })));

  const aiCandidates = parsed
    .filter(item => item.threat.source === 'keyword')
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
    .slice(0, AI_CLASSIFY_MAX_PER_FEED);

  for (const item of aiCandidates) {
    if (!canQueueAiClassification(item.title)) continue;
    classifyWithAI(item.title, SITE_VARIANT).then((aiResult) => {
      if (aiResult && aiResult.confidence > item.threat.confidence) {
        item.threat = aiResult;
        item.isAlert = aiResult.level === 'critical' || aiResult.level === 'high';
      }
    }).catch(() => { });
  }

  return parsed;
}

const RSS_PROXY_PREFIX = '/v1/world/rss-proxy?url=';

function resolveFeedUrl(feed: Feed, lang: string): string {
  if (typeof feed.url === 'string') return feed.url;
  return feed.url[lang] || feed.url['en'] || Object.values(feed.url)[0] || '';
}

function upstreamUrl(proxied: string): string | null {
  if (!proxied.startsWith(RSS_PROXY_PREFIX)) return null;
  try {
    return decodeURIComponent(proxied.slice(RSS_PROXY_PREFIX.length));
  } catch {
    return null;
  }
}

// The Go backend is the transport for every proxied feed — a single feed batches
// just as well as ten. The per-feed browser path survives ONLY for feeds that are
// not proxy-shaped (nothing for the server to fetch upstream).
function canBatchFeeds(feeds: Feed[]): boolean {
  const lang = getCurrentLanguage();
  return feeds.length > 0 && feeds.every(f => upstreamUrl(resolveFeedUrl(f, lang)) !== null);
}

// One POST per category: the server fetches + parses every feed in parallel
// (sharing the rss-proxy cache), so a category fills in ~1 round trip instead
// of 5-15 sequential client GETs. Throws on transport failure so the caller
// can fall back to the classic per-feed path.
async function fetchFeedsViaBatch(feeds: Feed[]): Promise<NewsItem[][]> {
  if (feedCache.size > MAX_CACHE_ENTRIES / 2) cleanupCaches();
  const lang = getCurrentLanguage();
  const jobs = feeds.map(feed => ({
    feed,
    scope: getFeedScope(feed.name, lang),
    url: upstreamUrl(resolveFeedUrl(feed, lang)),
  }));

  const results: (NewsItem[] | null)[] = await Promise.all(jobs.map(async ({ scope }) => {
    const cached = feedCache.get(scope);
    if (isFeedOnCooldown(scope)) return cached?.items || (await loadPersistentFeed(scope)) || [];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.items;
    return null;
  }));

  const pending = jobs
    .map((job, i) => ({ ...job, i }))
    .filter(({ i, url }) => results[i] === null && url !== null);
  jobs.forEach((job, i) => {
    if (results[i] === null && job.url === null) results[i] = [];
  });

  for (const group of chunkArray(pending, 30)) {
    // Hard deadline: the server bounds itself to ~25s, so a request outliving
    // that is a stalled connection — abort and let the caller fall back to the
    // per-feed path rather than hang the category's panel forever.
    const res = await fetchWithProxy('/v1/world/feeds-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: group.map(p => p.url), variant: SITE_VARIANT }),
    }, 28_000);
    if (!res.ok) throw new Error(`feeds-batch HTTP ${res.status}`);
    const data = await res.json() as {
      feeds?: Array<{
        url: string;
        ok: boolean;
        items?: Array<{ title?: string; link?: string; pubDate?: string; threat?: ServerThreat; geo?: ServerGeo }>;
      }>;
    };
    const byUrl = new Map((data.feeds || []).map(f => [f.url, f]));
    await Promise.all(group.map(async ({ feed, scope, url, i }) => {
      const entry = byUrl.get(url!);
      if (entry?.ok && entry.items?.length) {
        const raws = entry.items
          .filter(it => (it.title || '').trim() !== '')
          .map(it => {
            const d = it.pubDate ? new Date(it.pubDate) : new Date();
            return {
              title: it.title!,
              link: it.link || '',
              pubDate: Number.isNaN(d.getTime()) ? new Date() : d,
              threat: it.threat,
              geo: it.geo,
            };
          });
        results[i] = storeFeedItems(feed, scope, raws);
      } else {
        recordFeedFailure(scope);
        results[i] = feedCache.get(scope)?.items || (await loadPersistentFeed(scope)) || [];
      }
    }));
  }

  return results.map(r => r || []);
}

export async function fetchCategoryFeeds(
  feeds: Feed[],
  options: {
    batchSize?: number;
    onBatch?: (items: NewsItem[]) => void;
  } = {}
): Promise<NewsItem[]> {
  const topLimit = 20;
  const batchSize = options.batchSize ?? 5;
  const currentLang = getCurrentLanguage();

  // Filter feeds by language:
  // 1. Feeds with no explicit 'lang' are universal (or multi-url handled inside fetchFeed)
  // 2. Feeds with explicit 'lang' must match current UI language
  const filteredFeeds = feeds.filter(feed => !feed.lang || feed.lang === currentLang);

  const batches = chunkArray(filteredFeeds, batchSize);
  const topItems: NewsItem[] = [];
  let totalItems = 0;

  const ensureSortedDescending = () => [...topItems].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  const insertTopItem = (item: NewsItem) => {
    totalItems += 1;
    if (topItems.length < topLimit) {
      topItems.push(item);
      if (topItems.length === topLimit) topItems.sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime());
      return;
    }

    const itemTime = item.pubDate.getTime();
    if (itemTime <= topItems[0]!.pubDate.getTime()) return;

    topItems[0] = item;
    for (let i = 0; i < topItems.length - 1; i += 1) {
      if (topItems[i]!.pubDate.getTime() <= topItems[i + 1]!.pubDate.getTime()) break;
      [topItems[i], topItems[i + 1]] = [topItems[i + 1]!, topItems[i]!];
    }
  };

  // Fast path: one server-side batch for the whole category. Any transport
  // failure (older backend, network) falls back to the per-feed pipeline.
  if (canBatchFeeds(filteredFeeds)) {
    try {
      const perFeed = await fetchFeedsViaBatch(filteredFeeds);
      perFeed.flat().forEach(insertTopItem);
      const sorted = ensureSortedDescending();
      options.onBatch?.(sorted);
      if (totalItems > 0) {
        import('./data-freshness').then(({ dataFreshness }) => {
          dataFreshness.recordUpdate('rss', totalItems);
        });
      }
      return sorted;
    } catch (e) {
      console.warn('[RSS] feeds-batch unavailable, using per-feed fetch:', e);
    }
  }

  for (const batch of batches) {
    const results = await Promise.all(batch.map(fetchFeed));
    results.flat().forEach(insertTopItem);
    options.onBatch?.(ensureSortedDescending());
  }

  if (totalItems > 0) {
    import('./data-freshness').then(({ dataFreshness }) => {
      dataFreshness.recordUpdate('rss', totalItems);
    });
  }

  return ensureSortedDescending();
}
