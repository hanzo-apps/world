import type { ClusteredEvent } from '@/types';
import { inferHubsFromTitle, type TechHubLocation } from './tech-hub-index';

export interface TechHubActivity {
  hubId: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  tier: 'mega' | 'major' | 'emerging';
  activityLevel: 'high' | 'elevated' | 'low';
  score: number;
  newsCount: number;
  hasBreaking: boolean;
  topStories: Array<{ title: string; link: string }>;
  trend: 'rising' | 'stable' | 'falling';
  matchedKeywords: string[];
}

interface HubAccumulator {
  hub: TechHubLocation;
  clusters: ClusteredEvent[];
  matchedKeywords: Set<string>;
  totalVelocity: number;
  hasBreaking: boolean;
}

const TIER_BONUS: Record<string, number> = {
  mega: 15,
  major: 8,
  emerging: 0,
};

export function aggregateTechActivity(clusters: ClusteredEvent[]): TechHubActivity[] {
  const hubAccumulators = new Map<string, HubAccumulator>();

  // Match each cluster to potential tech hubs
  for (const cluster of clusters) {
    const matches = inferHubsFromTitle(cluster.primaryTitle);

    for (const match of matches) {
      // Only consider matches with reasonable confidence
      if (match.confidence < 0.5) continue;

      let acc = hubAccumulators.get(match.hubId);
      if (!acc) {
        acc = {
          hub: match.hub,
          clusters: [],
          matchedKeywords: new Set(),
          totalVelocity: 0,
          hasBreaking: false,
        };
        hubAccumulators.set(match.hubId, acc);
      }

      acc.clusters.push(cluster);
      acc.matchedKeywords.add(match.matchedKeyword);

      if (cluster.velocity?.sourcesPerHour) {
        acc.totalVelocity += cluster.velocity.sourcesPerHour;
      }

      if (cluster.isAlert) {
        acc.hasBreaking = true;
      }
    }
  }

  // Calculate activity scores and build result
  const activities: TechHubActivity[] = [];

  for (const [hubId, acc] of hubAccumulators) {
    const newsCount = acc.clusters.length;
    const tierBonus = TIER_BONUS[acc.hub.tier] || 0;

    // Score formula: news count + breaking bonus + velocity bonus + tier bonus
    const score = Math.min(100,
      newsCount * 15 +
      (acc.hasBreaking ? 30 : 0) +
      acc.totalVelocity * 5 +
      tierBonus
    );

    // Determine activity level
    let activityLevel: 'high' | 'elevated' | 'low';
    if (score >= 50 || acc.hasBreaking) {
      activityLevel = 'high';
    } else if (score >= 20) {
      activityLevel = 'elevated';
    } else {
      activityLevel = 'low';
    }

    // Get top stories (up to 3)
    const topStories = acc.clusters
      .slice(0, 3)
      .map(c => ({ title: c.primaryTitle, link: c.primaryLink }));

    // Determine trend based on velocity
    let trend: 'rising' | 'stable' | 'falling' = 'stable';
    if (acc.totalVelocity > 2) {
      trend = 'rising';
    } else if (acc.totalVelocity < 0.5 && newsCount > 1) {
      trend = 'falling';
    }

    activities.push({
      hubId,
      name: acc.hub.name,
      city: acc.hub.city,
      country: acc.hub.country,
      lat: acc.hub.lat,
      lon: acc.hub.lon,
      tier: acc.hub.tier,
      activityLevel,
      score,
      newsCount,
      hasBreaking: acc.hasBreaking,
      topStories,
      trend,
      matchedKeywords: Array.from(acc.matchedKeywords),
    });
  }

  // Sort by score descending
  activities.sort((a, b) => b.score - a.score);

  return activities;
}

export function getTopActiveHubs(clusters: ClusteredEvent[], limit = 10): TechHubActivity[] {
  return aggregateTechActivity(clusters).slice(0, limit);
}

export function getHubActivity(hubId: string, clusters: ClusteredEvent[]): TechHubActivity | undefined {
  const activities = aggregateTechActivity(clusters);
  return activities.find(a => a.hubId === hubId);
}
