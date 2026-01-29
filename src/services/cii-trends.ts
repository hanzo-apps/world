// Country Instability Index Trend Service
// Tracks 7-day and 30-day rolling baselines with trend detection

import type { CountryScore } from './country-instability';

export interface CIITrend {
  code: string;
  name: string;
  currentScore: number;
  score7dAgo: number;
  score30dAgo: number;
  change24h: number;
  change7d: number;
  change30d: number;
  trend: 'rising' | 'falling' | 'stable';
  volatility: number;
  lastUpdated: Date;
}

export interface CIIComponentTrend {
  code: string;
  component: string;
  currentValue: number;
  baseline7d: number;
  baseline30d: number;
  trend: 'rising' | 'falling' | 'stable';
}

// In-memory storage for trends (would use IndexedDB in production)
const trendHistory = new Map<string, Array<{ date: Date; score: number }>>();
const componentHistory = new Map<string, Array<{ date: Date; component: string; value: number }>>();

const DAYS_TRACKED = 30;
const HOURS_PER_SAMPLE = 6;
const MIN_SAMPLES_FOR_TREND = 7;

export function recordCIISnapshot(score: CountryScore): void {
  const key = score.code.toUpperCase();
  const now = new Date();
  
  // Record main score
  let history = trendHistory.get(key);
  if (!history) {
    history = [];
    trendHistory.set(key, history);
  }
  
  history.push({ date: now, score: score.score });
  
  // Prune old data
  const cutoff = new Date(now.getTime() - DAYS_TRACKED * 24 * 60 * 60 * 1000);
  trendHistory.set(key, history.filter(h => h.date > cutoff));
  
  // Record components
  if (score.components) {
    for (const [component, value] of Object.entries(score.components)) {
      const componentKey = `${key}:${component}`;
      let compHistory = componentHistory.get(componentKey);
      if (!compHistory) {
        compHistory = [];
        componentHistory.set(componentKey, compHistory);
      }
      compHistory.push({ date: now, component, value });
      componentHistory.set(componentKey, compHistory.filter(h => h.date > cutoff));
    }
  }
}

export function getCIITrend(code: string): CIITrend | null {
  const key = code.toUpperCase();
  const history = trendHistory.get(key);
  
  if (!history || history.length < 3) {
    return null;
  }
  
  const now = new Date();
  const scores = history.map(h => h.score);
  const currentScore = scores[scores.length - 1];
  
  // Calculate 24h change (last sample vs samples ~24h ago)
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  const score24hAgo = scores.filter(h => h.date < cutoff24h).pop()?.score || currentScore;
  const score7dAgo = scores.filter(h => h.date < cutoff7d).pop()?.score || currentScore;
  const score30dAgo = scores.filter(h => h.date < cutoff30d).pop()?.score || currentScore;
  
  const change24h = Math.round((currentScore - score24hAgo) * 10) / 10;
  const change7d = Math.round((currentScore - score7dAgo) * 10) / 10;
  const change30d = Math.round((currentScore - score30dAgo) * 10) / 10;
  
  // Determine trend
  let trend: 'rising' | 'falling' | 'stable';
  if (change7d > 5) trend = 'rising';
  else if (change7d < -5) trend = 'falling';
  else trend = 'stable';
  
  // Calculate volatility (standard deviation of last 7 days)
  const last7d = scores.filter(h => h.date > cutoff7d);
  const avg = last7d.reduce((a, b) => a + b.score, 0) / last7d.length;
  const variance = last7d.reduce((sum, h) => sum + Math.pow(h.score - avg, 2), 0) / last7d.length;
  const volatility = Math.round(Math.sqrt(variance) * 10) / 10;
  
  return {
    code: key,
    name: getCountryName(key),
    currentScore,
    score7dAgo,
    score30dAgo,
    change24h,
    change7d,
    change30d,
    trend,
    volatility,
    lastUpdated: now,
  };
}

export function getComponentTrend(code: string, component: string): CIIComponentTrend | null {
  const key = `${code.toUpperCase()}:${component}`;
  const history = componentHistory.get(key);
  
  if (!history || history.length < 3) {
    return null;
  }
  
  const now = new Date();
  const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const values = history.map(h => h.value);
  const currentValue = values[values.length - 1];
  const baseline7d = history.filter(h => h.date > cutoff7d)
    .reduce((sum, h) => sum + h.value, 0) / 
    Math.max(1, history.filter(h => h.date > cutoff7d).length);
  
  // Trend
  let trend: 'rising' | 'falling' | 'stable';
  if (currentValue > baseline7d * 1.2) trend = 'rising';
  else if (currentValue < baseline7d * 0.8) trend = 'falling';
  else trend = 'stable';
  
  return {
    code: code.toUpperCase(),
    component,
    currentValue: Math.round(currentValue * 10) / 10,
    baseline7d: Math.round(baseline7d * 10) / 10,
    baseline30d: 0, // Would calculate similarly
    trend,
  };
}

export function getAllTrends(): CIITrend[] {
  const trends: CIITrend[] = [];
  
  for (const code of trendHistory.keys()) {
    const trend = getCIITrend(code);
    if (trend) trends.push(trend);
  }
  
  return trends.sort((a, b) => b.change7d - a.change7d);
}

export function getMostRising(limit: number = 10): CIITrend[] {
  return getAllTrends()
    .filter(t => t.trend === 'rising')
    .sort((a, b) => b.change7d - a.change7d)
    .slice(0, limit);
}

export function getMostFalling(limit: number = 10): CIITrend[] {
  return getAllTrends()
    .filter(t => t.trend === 'falling')
    .sort((a, b) => a.change7d - b.change7d)
    .slice(0, limit);
}

export function getMostVolatile(limit: number = 10): CIITrend[] {
  return getAllTrends()
    .sort((a, b) => b.volatility - a.volatility)
    .slice(0, limit);
}

function getCountryName(code: string): string {
  const names: Record<string, string> = {
    UA: 'Ukraine', RU: 'Russia', CN: 'China', US: 'United States',
    IR: 'Iran', IL: 'Israel', TW: 'Taiwan', KP: 'North Korea',
    SA: 'Saudi Arabia', TR: 'Turkey', PL: 'Poland', DE: 'Germany',
    FR: 'France', GB: 'United Kingdom', IN: 'India', PK: 'Pakistan',
    SY: 'Syria', YE: 'Yemen', MM: 'Myanmar', VE: 'Venezuela',
  };
  return names[code] || code;
}

export function getTrendCount(): number {
  return trendHistory.size;
}

export function clearTrends(): void {
  trendHistory.clear();
  componentHistory.clear();
}

// Debug function
export function debugInjectTestTrend(): void {
  const mockScore: CountryScore = {
    code: 'UA',
    name: 'Ukraine',
    score: 65,
    level: 'elevated',
    trend: 'rising',
    components: {
      unrest: 45,
      security: 78,
      information: 52,
    },
    change24h: 3,
  };
  recordCIISnapshot(mockScore);
  console.log('[CIITrends] Injected test trend data for Ukraine');
}
