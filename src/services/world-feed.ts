// Hanzo World Model — feed contract
//
// Every domain lens (robotics, quantum, post-quantum, weather, sports,
// space-weather, ...) publishes its structured data through ONE shape so the
// /v1/world backend can enumerate and serve every signal the same way. Panels
// render the same items they publish here — no second representation.
//
// This is the app-builder surface: query registerWorldFeed/getWorldFeed to pull
// realtime world intelligence into any Hanzo app.

export type WorldFeedSeverity = 'info' | 'low' | 'elevated' | 'high' | 'critical';

export interface WorldFeedItem {
  id: string;
  title: string;
  summary?: string;
  category: string;          // domain-specific bucket, e.g. 'humanoid', 'quant-ph', 'cyclone'
  url?: string;
  timestamp?: string;        // ISO 8601
  lat?: number;
  lon?: number;
  severity?: WorldFeedSeverity;
  tags?: string[];
  meta?: Record<string, unknown>;
}

export interface WorldFeed {
  domain: string;            // stable slug, e.g. 'robotics'
  label: string;             // human label, e.g. 'Robotics'
  updatedAt: string;         // ISO 8601
  source: string;            // provenance, e.g. 'arXiv cs.RO + curated registry'
  live: boolean;             // true if any item comes from a realtime source
  insight?: string;          // the domain lens — one computed at-a-glance line
  items: WorldFeedItem[];
}

export type WorldFeedProvider = () => Promise<WorldFeed>;

const providers = new Map<string, WorldFeedProvider>();

export function registerWorldFeed(domain: string, provider: WorldFeedProvider): void {
  providers.set(domain, provider);
}

export function listWorldFeedDomains(): string[] {
  return [...providers.keys()];
}

export async function getWorldFeed(domain: string): Promise<WorldFeed | null> {
  const provider = providers.get(domain);
  if (!provider) return null;
  return provider();
}

export async function getAllWorldFeeds(): Promise<WorldFeed[]> {
  const results = await Promise.allSettled([...providers.values()].map((p) => p()));
  const feeds: WorldFeed[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') feeds.push(r.value);
  }
  return feeds;
}
