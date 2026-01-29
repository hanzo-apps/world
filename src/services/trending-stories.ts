// Trending Stories Analytics Service
// Tracks which stories are being shared most

export interface StoryShare {
  countryCode: string;
  countryName: string;
  template: string;
  timestamp: Date;
}

export interface TrendingStats {
  countryCode: string;
  countryName: string;
  shareCount: number;
  lastShared: Date;
  templates: Record<string, number>;
}

// Local storage key
const STORAGE_KEY = 'worldmonitor_story_shares';
const MAX_STORED = 1000;
const TRENDING_WINDOW_HOURS = 168; // 7 days

// In-memory cache
let storyShares: StoryShare[] = [];

export function recordStoryShare(countryCode: string, countryName: string, template: string = 'ciianalysis'): void {
  const share: StoryShare = {
    countryCode: countryCode.toUpperCase(),
    countryName,
    template,
    timestamp: new Date(),
  };
  
  storyShares.push(share);
  
  // Keep only recent shares
  pruneOldShares();
  
  // Persist to localStorage
  saveToStorage();
  
  console.log(`[Trending] Recorded share for ${countryName} (${template})`);
}

export function getTrendingCountries(limit: number = 10): TrendingStats[] {
  const cutoff = new Date(Date.now() - TRENDING_WINDOW_HOURS * 60 * 60 * 1000);
  const recent = storyShares.filter(s => s.timestamp > cutoff);
  
  const countryStats = new Map<string, TrendingStats>();
  
  for (const share of recent) {
    let stats = countryStats.get(share.countryCode);
    if (!stats) {
      stats = {
        countryCode: share.countryCode,
        countryName: share.countryName,
        shareCount: 0,
        lastShared: new Date(0),
        templates: {},
      };
      countryStats.set(share.countryCode, stats);
    }
    
    stats.shareCount++;
    if (share.timestamp > stats.lastShared) {
      stats.lastShared = share.timestamp;
    }
    stats.templates[share.template] = (stats.templates[share.template] || 0) + 1;
  }
  
  return Array.from(countryStats.values())
    .sort((a, b) => b.shareCount - a.shareCount)
    .slice(0, limit);
}

export function getTrendingTemplates(): Array<{ template: string; count: number }> {
  const templateCounts: Record<string, number> = {};
  
  for (const share of storyShares) {
    templateCounts[share.template] = (templateCounts[share.template] || 0) + 1;
  }
  
  return Object.entries(templateCounts)
    .map(([template, count]) => ({ template, count }))
    .sort((a, b) => b.count - a.count);
}

export function getTotalShares(): number {
  return storyShares.length;
}

export function getSharesToday(): number {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  return storyShares.filter(s => s.timestamp > cutoff).length;
}

export function getSharesThisWeek(): number {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return storyShares.filter(s => s.timestamp > cutoff).length;
}

export function exportStats(): object {
  return {
    totalShares: getTotalShares(),
    sharesToday: getSharesToday(),
    sharesThisWeek: getSharesThisWeek(),
    trendingCountries: getTrendingCountries(10),
    trendingTemplates: getTrendingTemplates(),
    exportedAt: new Date().toISOString(),
  };
}

function pruneOldShares(): void {
  const cutoff = new Date(Date.now() - TRENDING_WINDOW_HOURS * 60 * 60 * 1000);
  storyShares = storyShares.filter(s => s.timestamp > cutoff);
  
  // Also limit total count
  if (storyShares.length > MAX_STORED) {
    storyShares = storyShares.slice(-MAX_STORED);
  }
}

function saveToStorage(): void {
  try {
    const serialized = storyShares.map(s => ({
      ...s,
      timestamp: s.timestamp.toISOString(),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch (e) {
    console.error('[Trending] Failed to save:', e);
  }
}

export function loadFromStorage(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      storyShares = parsed.map((s: any) => ({
        ...s,
        timestamp: new Date(s.timestamp),
      }));
      console.log(`[Trending] Loaded ${storyShares.length} shares from storage`);
    }
  } catch (e) {
    console.error('[Trending] Failed to load:', e);
  }
}

export function clearShares(): void {
  storyShares = [];
  localStorage.removeItem(STORAGE_KEY);
  console.log('[Trending] Cleared all shares');
}

export function getShareCount(): number {
  return storyShares.length;
}

// Debug function
export function debugInjectTestShares(): void {
  const testCountries = [
    { code: 'UA', name: 'Ukraine' },
    { code: 'RU', name: 'Russia' },
    { code: 'IR', name: 'Iran' },
    { code: 'IL', name: 'Israel' },
    { code: 'CN', name: 'China' },
  ];
  
  for (let i = 0; i < 10; i++) {
    const country = testCountries[Math.floor(Math.random() * testCountries.length)];
    const templates = ['ciianalysis', 'crisisalert', 'dailybrief', 'marketfocus'];
    const template = templates[Math.floor(Math.random() * templates.length)];
    recordStoryShare(country.code, country.name, template);
  }
  
  console.log('[Trending] Injected 10 test shares');
}
