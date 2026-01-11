/**
 * Web Worker for heavy computational tasks (clustering & correlation analysis).
 * Runs O(n²) Jaccard clustering and correlation detection off the main thread.
 *
 * IMPORTANT: This worker contains duplicated logic from:
 * - src/services/clustering.ts
 * - src/services/correlation.ts
 *
 * The constants and pure functions are defined in:
 * - src/utils/analysis-constants.ts
 *
 * Workers can't easily import from other modules, so this file maintains its own
 * copy. If you change any thresholds or logic, update BOTH places!
 *
 * Key constants to keep in sync:
 * - SIMILARITY_THRESHOLD (0.5)
 * - STOP_WORDS
 * - PREDICTION_SHIFT_THRESHOLD (5)
 * - MARKET_MOVE_THRESHOLD (2)
 * - NEWS_VELOCITY_THRESHOLD (3)
 * - FLOW_PRICE_THRESHOLD (1.5)
 * - PIPELINE_KEYWORDS, FLOW_DROP_KEYWORDS
 * - tokenize(), jaccardSimilarity(), findRelatedTopics()
 */

// Types needed for worker (duplicated to avoid import issues in worker context)
interface NewsItem {
  source: string;
  title: string;
  link: string;
  pubDate: Date;
  isAlert: boolean;
  monitorColor?: string;
  tier?: number;
}

interface ClusteredEvent {
  id: string;
  primaryTitle: string;
  primarySource: string;
  primaryLink: string;
  sourceCount: number;
  topSources: Array<{ name: string; tier: number; url: string }>;
  allItems: NewsItem[];
  firstSeen: Date;
  lastUpdated: Date;
  isAlert: boolean;
  monitorColor?: string;
}

interface PredictionMarket {
  title: string;
  yesPrice: number;
  volume?: number;
}

interface MarketData {
  symbol: string;
  name: string;
  display: string;
  price: number | null;
  change: number | null;
}

type SignalType =
  | 'prediction_leads_news'
  | 'news_leads_markets'
  | 'silent_divergence'
  | 'velocity_spike'
  | 'convergence'
  | 'triangulation'
  | 'flow_drop'
  | 'flow_price_divergence';

interface CorrelationSignal {
  id: string;
  type: SignalType;
  title: string;
  description: string;
  confidence: number;
  timestamp: Date;
  data: {
    newsVelocity?: number;
    marketChange?: number;
    predictionShift?: number;
    relatedTopics?: string[];
  };
}

type SourceType = 'wire' | 'gov' | 'intel' | 'mainstream' | 'market' | 'tech' | 'other';

// Message types for worker communication
interface ClusterMessage {
  type: 'cluster';
  id: string;
  items: NewsItem[];
  sourceTiers: Record<string, number>;
}

interface CorrelationMessage {
  type: 'correlation';
  id: string;
  clusters: ClusteredEvent[];
  predictions: PredictionMarket[];
  markets: MarketData[];
  sourceTypes: Record<string, SourceType>;
}

interface ResetMessage {
  type: 'reset';
}

type WorkerMessage = ClusterMessage | CorrelationMessage | ResetMessage;

interface ClusterResult {
  type: 'cluster-result';
  id: string;
  clusters: ClusteredEvent[];
}

interface CorrelationResult {
  type: 'correlation-result';
  id: string;
  signals: CorrelationSignal[];
}

// ============================================================================
// CLUSTERING LOGIC (from clustering.ts)
// ============================================================================

const SIMILARITY_THRESHOLD = 0.5;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
  'she', 'we', 'they', 'what', 'which', 'who', 'whom', 'how', 'when',
  'where', 'why', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'not', 'only', 'same', 'so', 'than',
  'too', 'very', 'just', 'also', 'now', 'new', 'says', 'said', 'after',
]);

type NewsItemWithTier = NewsItem & { tier: number };

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

function generateClusterId(items: NewsItemWithTier[]): string {
  const sorted = [...items].sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime());
  const first = sorted[0]!;
  return `${first.pubDate.getTime()}-${first.title.slice(0, 20).replace(/\W/g, '')}`;
}

function clusterNews(items: NewsItem[], sourceTiers: Record<string, number>): ClusteredEvent[] {
  if (items.length === 0) return [];

  const getSourceTier = (source: string): number => sourceTiers[source] ?? 4;

  const itemsWithTier: NewsItemWithTier[] = items.map(item => ({
    ...item,
    tier: item.tier ?? getSourceTier(item.source),
  }));

  const tokenCache = new Map<string, Set<string>>();
  for (const item of itemsWithTier) {
    tokenCache.set(item.title, tokenize(item.title));
  }

  const clusters: NewsItemWithTier[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < itemsWithTier.length; i++) {
    if (assigned.has(i)) continue;

    const currentItem = itemsWithTier[i]!;
    const cluster: NewsItemWithTier[] = [currentItem];
    assigned.add(i);
    const tokensI = tokenCache.get(currentItem.title)!;

    for (let j = i + 1; j < itemsWithTier.length; j++) {
      if (assigned.has(j)) continue;

      const otherItem = itemsWithTier[j]!;
      const tokensJ = tokenCache.get(otherItem.title)!;
      const similarity = jaccardSimilarity(tokensI, tokensJ);

      if (similarity >= SIMILARITY_THRESHOLD) {
        cluster.push(otherItem);
        assigned.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters.map(cluster => {
    const sorted = [...cluster].sort((a, b) => {
      const tierDiff = a.tier - b.tier;
      if (tierDiff !== 0) return tierDiff;
      return b.pubDate.getTime() - a.pubDate.getTime();
    });

    const primary = sorted[0]!;
    const dates = cluster.map(i => i.pubDate.getTime());

    const topSources = sorted
      .slice(0, 3)
      .map(item => ({
        name: item.source,
        tier: item.tier,
        url: item.link,
      }));

    return {
      id: generateClusterId(cluster),
      primaryTitle: primary.title,
      primarySource: primary.source,
      primaryLink: primary.link,
      sourceCount: cluster.length,
      topSources,
      allItems: cluster,
      firstSeen: new Date(Math.min(...dates)),
      lastUpdated: new Date(Math.max(...dates)),
      isAlert: cluster.some(i => i.isAlert),
      monitorColor: cluster.find(i => i.monitorColor)?.monitorColor,
    };
  }).sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime());
}

// ============================================================================
// CORRELATION LOGIC (from correlation.ts)
// ============================================================================

interface StreamSnapshot {
  newsVelocity: Map<string, number>;
  marketChanges: Map<string, number>;
  predictionChanges: Map<string, number>;
  timestamp: number;
}

const PREDICTION_SHIFT_THRESHOLD = 5;
const MARKET_MOVE_THRESHOLD = 2;
const NEWS_VELOCITY_THRESHOLD = 3;
const FLOW_PRICE_THRESHOLD = 1.5;
const ENERGY_COMMODITY_SYMBOLS = new Set(['CL=F', 'NG=F']);

const PIPELINE_KEYWORDS = ['pipeline', 'pipelines', 'line', 'terminal'];
const FLOW_DROP_KEYWORDS = [
  'flow', 'throughput', 'capacity', 'outage', 'leak', 'rupture', 'shutdown',
  'maintenance', 'curtailment', 'force majeure', 'halt', 'halted', 'reduced',
  'reduction', 'drop', 'offline', 'suspend', 'suspended', 'stoppage',
];

// Worker-local state (persists between messages)
let previousSnapshot: StreamSnapshot | null = null;
const recentSignalKeys = new Set<string>();

function generateSignalId(): string {
  return `sig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateDedupeKey(type: SignalType, identifier: string, value: number): string {
  const roundedValue = Math.round(value * 10) / 10;
  return `${type}:${identifier}:${roundedValue}`;
}

function isRecentDuplicate(key: string): boolean {
  return recentSignalKeys.has(key);
}

function markSignalSeen(key: string): void {
  recentSignalKeys.add(key);
  // Clean old keys after 30 minutes
  setTimeout(() => recentSignalKeys.delete(key), 30 * 60 * 1000);
}

function extractTopics(events: ClusteredEvent[]): Map<string, number> {
  const topics = new Map<string, number>();

  const keywords = [
    'iran', 'israel', 'ukraine', 'russia', 'china', 'taiwan', 'oil', 'crypto',
    'fed', 'interest', 'inflation', 'recession', 'war', 'sanctions', 'tariff',
    'ai', 'tech', 'layoff', 'trump', 'biden', 'election',
  ];

  for (const event of events) {
    const title = event.primaryTitle.toLowerCase();
    for (const kw of keywords) {
      if (title.includes(kw)) {
        const velocity = (event as ClusteredEvent & { velocity?: { sourcesPerHour?: number } }).velocity?.sourcesPerHour ?? 0;
        topics.set(kw, (topics.get(kw) ?? 0) + velocity + event.sourceCount);
      }
    }
  }

  return topics;
}

function findRelatedTopics(prediction: string): string[] {
  const title = prediction.toLowerCase();
  const related: string[] = [];

  const mappings: Record<string, string[]> = {
    'iran': ['iran', 'israel', 'oil', 'sanctions'],
    'israel': ['israel', 'iran', 'war', 'gaza'],
    'ukraine': ['ukraine', 'russia', 'war', 'nato'],
    'russia': ['russia', 'ukraine', 'sanctions'],
    'china': ['china', 'taiwan', 'tariff', 'trade'],
    'taiwan': ['taiwan', 'china'],
    'trump': ['trump', 'election', 'tariff'],
    'fed': ['fed', 'interest', 'inflation', 'recession'],
    'bitcoin': ['crypto', 'bitcoin'],
    'recession': ['recession', 'fed', 'inflation'],
  };

  for (const [key, topics] of Object.entries(mappings)) {
    if (title.includes(key)) {
      related.push(...topics);
    }
  }

  return [...new Set(related)];
}

function includesKeyword(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword));
}

function detectPipelineFlowDrops(events: ClusteredEvent[]): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];

  for (const event of events) {
    const titles = [
      event.primaryTitle,
      ...(event.allItems?.map(item => item.title) ?? []),
    ]
      .map(title => title.toLowerCase())
      .filter(Boolean);

    const hasPipeline = titles.some(title => includesKeyword(title, PIPELINE_KEYWORDS));
    const hasFlowDrop = titles.some(title => includesKeyword(title, FLOW_DROP_KEYWORDS));

    if (hasPipeline && hasFlowDrop) {
      const dedupeKey = generateDedupeKey('flow_drop', event.id, event.sourceCount);
      if (!isRecentDuplicate(dedupeKey)) {
        markSignalSeen(dedupeKey);
        signals.push({
          id: generateSignalId(),
          type: 'flow_drop',
          title: 'Pipeline Flow Drop',
          description: `"${event.primaryTitle.slice(0, 70)}..." indicates reduced flow or disruption`,
          confidence: Math.min(0.9, 0.4 + event.sourceCount / 10),
          timestamp: new Date(),
          data: {
            newsVelocity: event.sourceCount,
            relatedTopics: ['pipeline', 'flow'],
          },
        });
      }
    }
  }

  return signals;
}

function detectConvergence(events: ClusteredEvent[], sourceTypes: Record<string, SourceType>): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];
  const WINDOW_MS = 60 * 60 * 1000;
  const now = Date.now();

  const getSourceType = (source: string): SourceType => sourceTypes[source] ?? 'other';

  for (const event of events) {
    if (!event.allItems || event.allItems.length < 3) continue;

    const recentItems = event.allItems.filter(
      item => now - item.pubDate.getTime() < WINDOW_MS
    );
    if (recentItems.length < 3) continue;

    const sourceTypesSet = new Set<SourceType>();
    for (const item of recentItems) {
      const type = getSourceType(item.source);
      sourceTypesSet.add(type);
    }

    if (sourceTypesSet.size >= 3) {
      const types = Array.from(sourceTypesSet).filter(t => t !== 'other');
      const dedupeKey = generateDedupeKey('convergence', event.id, sourceTypesSet.size);

      if (!isRecentDuplicate(dedupeKey) && types.length >= 3) {
        markSignalSeen(dedupeKey);
        signals.push({
          id: generateSignalId(),
          type: 'convergence',
          title: 'Source Convergence',
          description: `"${event.primaryTitle.slice(0, 50)}..." reported by ${types.join(', ')} (${recentItems.length} sources in 30m)`,
          confidence: Math.min(0.95, 0.6 + sourceTypesSet.size * 0.1),
          timestamp: new Date(),
          data: {
            newsVelocity: recentItems.length,
            relatedTopics: types,
          },
        });
      }
    }
  }

  return signals;
}

function detectTriangulation(events: ClusteredEvent[], sourceTypes: Record<string, SourceType>): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];
  const CRITICAL_TYPES: SourceType[] = ['wire', 'gov', 'intel'];

  const getSourceType = (source: string): SourceType => sourceTypes[source] ?? 'other';

  for (const event of events) {
    if (!event.allItems || event.allItems.length < 3) continue;

    const typePresent = new Set<SourceType>();
    for (const item of event.allItems) {
      const t = getSourceType(item.source);
      if (CRITICAL_TYPES.includes(t)) {
        typePresent.add(t);
      }
    }

    if (typePresent.size === 3) {
      const dedupeKey = generateDedupeKey('triangulation', event.id, 3);

      if (!isRecentDuplicate(dedupeKey)) {
        markSignalSeen(dedupeKey);
        signals.push({
          id: generateSignalId(),
          type: 'triangulation',
          title: 'Intel Triangulation',
          description: `Wire + Gov + Intel aligned: "${event.primaryTitle.slice(0, 45)}..."`,
          confidence: 0.9,
          timestamp: new Date(),
          data: {
            newsVelocity: event.sourceCount,
            relatedTopics: Array.from(typePresent),
          },
        });
      }
    }
  }

  return signals;
}

function analyzeCorrelations(
  events: ClusteredEvent[],
  predictions: PredictionMarket[],
  markets: MarketData[],
  sourceTypes: Record<string, SourceType>
): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];
  const now = Date.now();

  const newsTopics = extractTopics(events);
  const pipelineFlowSignals = detectPipelineFlowDrops(events);
  const pipelineFlowMentions = pipelineFlowSignals.length;

  const currentSnapshot: StreamSnapshot = {
    newsVelocity: newsTopics,
    marketChanges: new Map(markets.map(m => [m.symbol, m.change ?? 0])),
    predictionChanges: new Map(predictions.map(p => [p.title.slice(0, 50), p.yesPrice])),
    timestamp: now,
  };

  if (!previousSnapshot) {
    previousSnapshot = currentSnapshot;
    return signals;
  }

  // Detect prediction shifts
  for (const pred of predictions) {
    const key = pred.title.slice(0, 50);
    const prev = previousSnapshot.predictionChanges.get(key);
    if (prev !== undefined) {
      const shift = Math.abs(pred.yesPrice - prev);
      if (shift >= PREDICTION_SHIFT_THRESHOLD) {
        const related = findRelatedTopics(pred.title);
        const newsActivity = related.reduce((sum, t) => sum + (newsTopics.get(t) ?? 0), 0);

        const dedupeKey = generateDedupeKey('prediction_leads_news', key, shift);
        if (newsActivity < NEWS_VELOCITY_THRESHOLD && !isRecentDuplicate(dedupeKey)) {
          markSignalSeen(dedupeKey);
          signals.push({
            id: generateSignalId(),
            type: 'prediction_leads_news',
            title: 'Prediction Market Shift',
            description: `"${pred.title.slice(0, 60)}..." moved ${shift > 0 ? '+' : ''}${shift.toFixed(1)}% with low news coverage`,
            confidence: Math.min(0.9, 0.5 + shift / 20),
            timestamp: new Date(),
            data: {
              predictionShift: shift,
              newsVelocity: newsActivity,
              relatedTopics: related,
            },
          });
        }
      }
    }
  }

  // Detect news velocity spikes without market reaction
  for (const [topic, velocity] of newsTopics) {
    const prevVelocity = previousSnapshot.newsVelocity.get(topic) ?? 0;
    if (velocity > NEWS_VELOCITY_THRESHOLD * 2 && velocity > prevVelocity * 2) {
      const dedupeKey = generateDedupeKey('velocity_spike', topic, velocity);
      if (!isRecentDuplicate(dedupeKey)) {
        markSignalSeen(dedupeKey);
        signals.push({
          id: generateSignalId(),
          type: 'velocity_spike',
          title: 'News Velocity Spike',
          description: `"${topic}" coverage surging: ${velocity.toFixed(1)} activity score`,
          confidence: Math.min(0.85, 0.4 + velocity / 20),
          timestamp: new Date(),
          data: {
            newsVelocity: velocity,
            relatedTopics: [topic],
          },
        });
      }
    }
  }

  // Detect silent market divergence
  for (const market of markets) {
    const change = Math.abs(market.change ?? 0);
    if (change >= MARKET_MOVE_THRESHOLD) {
      const relatedNews = Array.from(newsTopics.entries())
        .filter(([k]) => market.name.toLowerCase().includes(k) || k.includes(market.symbol.toLowerCase()))
        .reduce((sum, [, v]) => sum + v, 0);

      const dedupeKey = generateDedupeKey('silent_divergence', market.symbol, change);
      if (relatedNews < 2 && !isRecentDuplicate(dedupeKey)) {
        markSignalSeen(dedupeKey);
        signals.push({
          id: generateSignalId(),
          type: 'silent_divergence',
          title: 'Unexplained Market Move',
          description: `${market.name} moved ${market.change! > 0 ? '+' : ''}${market.change!.toFixed(2)}% with minimal news coverage`,
          confidence: Math.min(0.8, 0.4 + change / 10),
          timestamp: new Date(),
          data: {
            marketChange: market.change!,
            newsVelocity: relatedNews,
          },
        });
      }
    }
  }

  // Detect flow/price divergence for energy commodities
  for (const market of markets) {
    if (!ENERGY_COMMODITY_SYMBOLS.has(market.symbol)) continue;

    const change = market.change ?? 0;
    if (change >= FLOW_PRICE_THRESHOLD) {
      const relatedNews = Array.from(newsTopics.entries())
        .filter(([k]) => market.name.toLowerCase().includes(k) || k.includes(market.symbol.toLowerCase()))
        .reduce((sum, [, v]) => sum + v, 0);

      const dedupeKey = generateDedupeKey('flow_price_divergence', market.symbol, change);
      if (relatedNews < 2 && pipelineFlowMentions === 0 && !isRecentDuplicate(dedupeKey)) {
        markSignalSeen(dedupeKey);
        signals.push({
          id: generateSignalId(),
          type: 'flow_price_divergence',
          title: 'Flow/Price Divergence',
          description: `${market.name} up ${change.toFixed(2)}% without pipeline flow news`,
          confidence: Math.min(0.85, 0.4 + change / 8),
          timestamp: new Date(),
          data: {
            marketChange: change,
            newsVelocity: relatedNews,
            relatedTopics: ['pipeline', market.display],
          },
        });
      }
    }
  }

  previousSnapshot = currentSnapshot;

  // Add convergence and triangulation signals
  signals.push(...detectConvergence(events, sourceTypes));
  signals.push(...detectTriangulation(events, sourceTypes));
  signals.push(...pipelineFlowSignals);

  // Dedupe by type to avoid spam
  const uniqueSignals = signals.filter((sig, idx) =>
    signals.findIndex(s => s.type === sig.type) === idx
  );

  // Only return high-confidence signals
  return uniqueSignals.filter(s => s.confidence >= 0.6);
}

// ============================================================================
// WORKER MESSAGE HANDLER
// ============================================================================

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'cluster': {
      // Deserialize dates (they come as strings over postMessage)
      const items = message.items.map(item => ({
        ...item,
        pubDate: new Date(item.pubDate),
      }));

      const clusters = clusterNews(items, message.sourceTiers);

      const result: ClusterResult = {
        type: 'cluster-result',
        id: message.id,
        clusters,
      };
      self.postMessage(result);
      break;
    }

    case 'correlation': {
      // Deserialize dates in clusters
      const clusters = message.clusters.map(cluster => ({
        ...cluster,
        firstSeen: new Date(cluster.firstSeen),
        lastUpdated: new Date(cluster.lastUpdated),
        allItems: cluster.allItems.map(item => ({
          ...item,
          pubDate: new Date(item.pubDate),
        })),
      }));

      const signals = analyzeCorrelations(
        clusters,
        message.predictions,
        message.markets,
        message.sourceTypes
      );

      const result: CorrelationResult = {
        type: 'correlation-result',
        id: message.id,
        signals,
      };
      self.postMessage(result);
      break;
    }

    case 'reset': {
      // Reset worker state (for testing or reinitialization)
      previousSnapshot = null;
      recentSignalKeys.clear();
      break;
    }
  }
};

// Signal that worker is ready
self.postMessage({ type: 'ready' });
