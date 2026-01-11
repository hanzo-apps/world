import type { NewsItem, ClusteredEvent } from '@/types';
import { getSourceTier } from '@/config';
import {
  SIMILARITY_THRESHOLD,
  tokenize,
  jaccardSimilarity,
} from '@/utils/analysis-constants';

type NewsItemWithTier = NewsItem & { tier: number };

function generateClusterId(items: NewsItemWithTier[]): string {
  const sorted = [...items].sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime());
  const first = sorted[0]!;
  return `${first.pubDate.getTime()}-${first.title.slice(0, 20).replace(/\W/g, '')}`;
}

export function clusterNews(items: NewsItem[]): ClusteredEvent[] {
  if (items.length === 0) return [];

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
