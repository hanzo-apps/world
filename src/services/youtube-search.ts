import { isDesktopRuntime, getRemoteApiBaseUrl } from '@/services/runtime';

// Thin client over /v1/world/youtube/search. Turns a free-text query into
// ranked non-live videos so the watch queue (and the analyst's queue_video
// command) can resolve "the Milken Jensen talk" to a real video id.

export interface YouTubeResult {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  publishedAt: string;
}

export async function searchYouTube(query: string): Promise<YouTubeResult[]> {
  const q = query.trim();
  if (!q) return [];
  const baseUrl = isDesktopRuntime() ? getRemoteApiBaseUrl() : '';
  const res = await fetch(`${baseUrl}/v1/world/youtube/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  const data = (await res.json()) as { results?: YouTubeResult[] };
  return Array.isArray(data.results) ? data.results : [];
}
