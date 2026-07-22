// The canonical live-news channel lists — ONE source of truth for every embedder:
// LiveNewsPanel's single player, the StationsWall grid (all channels at once), and the
// immersive video background. These were module-private to LiveNewsPanel; a second
// embedder needed the same list, so the DATA lives in config now (the panels keep only
// their behavior). Import getSiteVariant from ./variant directly (not the @/config
// barrel) so this data module never cycles through the barrel that re-exports it.
import { getSiteVariant } from './variant';

export interface LiveChannel {
  id: string;
  name: string;
  handle: string; // YouTube channel handle (e.g., @markets)
  fallbackVideoId?: string; // Fallback if no live stream detected
  videoId?: string; // Dynamically fetched live video ID
  isLive?: boolean;
  useFallbackOnly?: boolean; // Skip auto-detection, always use fallback
}

// Full variant: World news channels (24/7 live streams).
export const FULL_LIVE_CHANNELS: LiveChannel[] = [
  { id: 'bloomberg', name: 'Bloomberg', handle: '@markets', fallbackVideoId: 'iEpJwprxDdk' },
  { id: 'sky', name: 'SkyNews', handle: '@SkyNews', fallbackVideoId: 'YDvsBbKfLPA' },
  { id: 'euronews', name: 'Euronews', handle: '@euronews', fallbackVideoId: 'pykpO5kQJ98' },
  { id: 'dw', name: 'DW', handle: '@DWNews', fallbackVideoId: 'LuKwFajn37U' },
  { id: 'cnbc', name: 'CNBC', handle: '@CNBC', fallbackVideoId: '9NyxcX3rhQs' },
  { id: 'france24', name: 'France24', handle: '@FRANCE24English', fallbackVideoId: 'Ap-UM1O9RBU' },
  { id: 'alarabiya', name: 'AlArabiya', handle: '@AlArabiya', fallbackVideoId: 'n7eQejkXbnM', useFallbackOnly: true },
  { id: 'aljazeera', name: 'AlJazeera', handle: '@AlJazeeraEnglish', fallbackVideoId: 'gCNeDWCI0vo', useFallbackOnly: true },
];

// Tech variant: Tech & business channels.
export const TECH_LIVE_CHANNELS: LiveChannel[] = [
  { id: 'bloomberg', name: 'Bloomberg', handle: '@markets', fallbackVideoId: 'iEpJwprxDdk' },
  { id: 'yahoo', name: 'Yahoo Finance', handle: '@YahooFinance', fallbackVideoId: 'KQp-e_XQnDE' },
  { id: 'cnbc', name: 'CNBC', handle: '@CNBC', fallbackVideoId: '9NyxcX3rhQs' },
  { id: 'nasa', name: 'NASA TV', handle: '@NASA', fallbackVideoId: 'fO9e9jnhYK8', useFallbackOnly: true },
];

// tech + ai → tech/business channels; crypto/finance/cloud/full → world+finance set.
// Read live (getSiteVariant) so the channel set reflects the current variant.
export function liveChannels(): LiveChannel[] {
  const v = getSiteVariant();
  return v === 'tech' || v === 'ai' ? TECH_LIVE_CHANNELS : FULL_LIVE_CHANNELS;
}

// Never-crash default: if a variant ever ships an empty channel list, embedders can
// still construct against a valid object and render a clean offline state instead of
// dereferencing undefined.
export const EMPTY_CHANNEL: LiveChannel = { id: 'none', name: '—', handle: '', useFallbackOnly: true };

// The variant's primary live channel, reused by the immersive video background so the
// "live-news YouTube embed" is defined in exactly one place (this channel list).
export function getDefaultLiveChannel(): { handle: string; videoId: string; name: string } {
  const c = liveChannels()[0] ?? EMPTY_CHANNEL;
  return { handle: c.handle, videoId: c.fallbackVideoId ?? '', name: c.name };
}
