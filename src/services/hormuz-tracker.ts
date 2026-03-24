import { toApiUrl } from '@/services/runtime';

export interface HormuzSeries {
  date: string;
  value: number;
}

export interface HormuzChart {
  label: string;
  title: string;
  series: HormuzSeries[];
}

export interface HormuzTrackerData {
  fetchedAt: number;
  updatedDate: string;
  title: string | null;
  summary: string | null;
  paragraphs: string[];
  status: 'closed' | 'disrupted' | 'restricted' | 'open';
  charts: HormuzChart[];
  attribution: { source: string; url: string };
}

let cached: HormuzTrackerData | null = null;
let cachedAt = 0;
const CACHE_TTL = 30 * 60 * 1000;

export function getCachedHormuzTracker(): HormuzTrackerData | null {
  return cached;
}

export async function fetchHormuzTracker(): Promise<HormuzTrackerData | null> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL) return cached;

  try {
    const resp = await fetch(toApiUrl('/api/supply-chain/hormuz-tracker'), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return cached;
    const raw = (await resp.json()) as HormuzTrackerData;
    if (!Array.isArray(raw.charts)) return cached;
    cached = raw;
    cachedAt = now;
    return cached;
  } catch {
    return cached;
  }
}
