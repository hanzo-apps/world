import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type Ref } from 'react';
import { YStack, XStack, SizableText } from '@hanzo/gui';
import { fetchLiveVideoId } from '@/services/live-news';
import { loadYouTubeAPI, type YouTubePlayer } from '@/services/youtube';
import { liveChannels, type LiveChannel } from '@/config/live-channels';
import { Panel, PanelLiveDot, type PanelState } from './Panel';
import type { PanelSlot } from './PanelGrid';

/**
 * StationsWallPanel — the vanilla `StationsWallPanel` (src/components/StationsWallPanel.ts)
 * ported onto the React Panel chassis: EVERY live news channel at once, in a grid of
 * controllable YouTube players. All tiles play muted; hovering (or keyboard-focusing) a
 * tile gives it AUDIO FOCUS — it unmutes, every other tile mutes — so you scan the whole
 * wall and listen to any station without a click. Pointer leaving the wall mutes all.
 *
 * It REUSES the vanilla data/embed layer VERBATIM — `fetchLiveVideoId` (the same
 * `/v1/world/youtube/live` fetcher with its 5-minute cache), `loadYouTubeAPI` +
 * `YouTubePlayer` (the one-and-only IFrame API loader, injected once for the whole wall),
 * and the `liveChannels()` config (the single, variant-aware channel source of truth that
 * LiveNewsPanel is also fed by). No data or loader logic is re-authored; this file owns
 * only the React view + the imperative per-tile player lifecycle, expressed through the
 * chassis and @hanzo/gui LONGHAND primitives.
 *
 * All the hard-won vanilla behaviours are preserved:
 *   • Lazy build — the N simultaneous players are created only the first time the wall
 *     scrolls into view (IntersectionObserver); a hidden wall never decodes N videos.
 *   • Pause/resume — every player pauses when the wall leaves the viewport and resumes
 *     on return, matching LiveNewsPanel/LiveWebcamsPanel.
 *   • Per-tile degradation — a channel with no live/fallback video, or a YouTube embed
 *     refusal, degrades that ONE tile to an offline card; the rest of the wall is fine.
 *
 * The chassis owns the frame and the honest loading / empty / error states; this file
 * maps them faithfully:
 *   channel list empty          →  state="empty"   (never any tiles to show)
 *   loader/build threw          →  state="error"
 *   channels resolved           →  state="ready"   (the wall; tiles self-report offline)
 * The wall is lazy, so "loading" is expressed in-body ("Scroll into view to load the
 * wall…") until the first visibility builds the grid — the honest analogue of the vanilla
 * placeholder, not a spinner that would never resolve while the wall sits off-screen.
 */

interface TileRuntime {
  host: HTMLDivElement; // the player mount host (YouTube replaces a child of this)
  player: YouTubePlayer | null;
}

const NOCOOKIE_HOST = 'https://www.youtube-nocookie.com';

export function StationsWallPanel({ slot }: { slot: PanelSlot }): React.JSX.Element {
  // One channel read at mount — the single variant-aware source of truth (verbatim).
  const channels = useMemo<LiveChannel[]>(() => liveChannels(), []);

  const [state, setState] = useState<PanelState>(channels.length === 0 ? 'empty' : 'ready');
  const [built, setBuilt] = useState(false);
  // The one channel currently unmuted (one at a time). null → everything muted.
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  // Ids whose tile degraded to an offline card (no video, or YouTube refused the embed).
  const [offlineIds, setOfflineIds] = useState<ReadonlySet<string>>(() => new Set());

  // Imperative state — refs so the observer/hover callbacks always read live values.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const tiles = useRef<Map<string, TileRuntime>>(new Map());
  const mountedRef = useRef(false);
  const activeAudioRef = useRef<string | null>(null);

  useEffect(() => {
    activeAudioRef.current = activeAudioId;
  }, [activeAudioId]);

  const markOffline = useCallback((id: string) => {
    setOfflineIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // One channel → its (muted, autoplaying) player, mounted into that tile's host. A
  // channel with no live/fallback video, or no YT API, degrades to an offline card.
  // Verbatim resolution order from the vanilla `mountTile`.
  const mountTile = useCallback(
    async (channel: LiveChannel): Promise<void> => {
      let videoId = channel.fallbackVideoId ?? null;
      if (!channel.useFallbackOnly) {
        const live = await fetchLiveVideoId(channel.handle).catch(() => null);
        if (live) videoId = live;
      }

      const host = hostEls.current.get(channel.id);
      if (!videoId || !window.YT?.Player || !host) {
        markOffline(channel.id);
        return;
      }

      const el = document.createElement('div');
      el.style.width = '100%';
      el.style.height = '100%';
      host.appendChild(el);

      const runtime: TileRuntime = { host, player: null };
      tiles.current.set(channel.id, runtime);

      runtime.player = new window.YT.Player(el, {
        host: NOCOOKIE_HOST,
        videoId,
        playerVars: { autoplay: 1, mute: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1 },
        events: {
          onReady: () => {
            // Start muted always; only the focused tile is later unmuted.
            runtime.player?.mute();
            runtime.player?.playVideo();
            // Honour a hover that landed on this tile before its player was ready.
            if (activeAudioRef.current === channel.id) {
              runtime.player?.unMute();
              runtime.player?.playVideo();
            }
          },
          onError: () => markOffline(channel.id),
        },
      });
    },
    [markOffline],
  );

  // Lazily build the whole wall the first time it becomes visible: one API load, then
  // create every tile's player. Idempotent — only ever runs once.
  const ensureBuilt = useCallback(async (): Promise<void> => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    try {
      await loadYouTubeAPI();
      await Promise.all(channels.map((c) => mountTile(c)));
      setBuilt(true);
    } catch {
      setState('error');
    }
  }, [channels, mountTile]);

  const pauseAll = useCallback(() => {
    for (const t of tiles.current.values()) t.player?.pauseVideo?.();
  }, []);
  const resumeAll = useCallback(() => {
    for (const t of tiles.current.values()) t.player?.playVideo?.();
  }, []);

  // Give exactly ONE tile audio (unmute it, mute every other). null → mute all.
  // Idempotent; drives both the players (imperative) and the badge/highlight (state).
  const focusAudio = useCallback((channelId: string | null) => {
    if (activeAudioRef.current === channelId) return;
    activeAudioRef.current = channelId;
    setActiveAudioId(channelId);
    for (const [id, t] of tiles.current) {
      if (!t.player) continue;
      if (id === channelId) {
        t.player.unMute();
        t.player.playVideo();
      } else {
        t.player.mute();
      }
    }
  }, []);

  // Lazy build + pause/resume as the wall enters/leaves the viewport (matches
  // LiveNewsPanel/LiveWebcamsPanel — no decoding a hidden wall).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || channels.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            void ensureBuilt();
            resumeAll();
          } else {
            pauseAll();
          }
        }
      },
      { threshold: 0.01 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [channels.length, ensureBuilt, resumeAll, pauseAll]);

  // Tear down every player on unmount.
  useEffect(() => {
    const registry = tiles.current;
    return () => {
      for (const t of registry.values()) t.player?.destroy?.();
      registry.clear();
    };
  }, []);

  const setHostRef = useCallback(
    (id: string) => (node: HTMLDivElement | null) => {
      if (node) hostEls.current.set(id, node);
      else hostEls.current.delete(id);
    },
    [],
  );

  return (
    <Panel
      ref={slot.ref}
      dragHandle={slot.dragHandle}
      title="News Wall"
      state={state}
      actions={
        <XStack alignItems="center" gap="$2">
          <SizableText size="$1" color="$color9">
            {channels.length}
          </SizableText>
          <PanelLiveDot />
        </XStack>
      }
      width={640}
      scroll={false}
    >
      {/* Container the IntersectionObserver watches — always present so the lazy build
          can fire on first visibility. Pointer leaving the wall mutes everything. */}
      <YStack
        ref={containerRef as unknown as Ref<ComponentRef<typeof YStack>>}
        gap="$2"
        onMouseLeave={() => focusAudio(null)}
      >
        {!built ? (
          <SizableText size="$2" color="$color9" paddingVertical="$2">
            Scroll into view to load the wall…
          </SizableText>
        ) : null}
        <div
          style={{
            display: built ? 'grid' : 'none',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 8,
          }}
        >
          {channels.map((channel) => (
            <StationTile
              key={channel.id}
              channel={channel}
              hostRef={setHostRef(channel.id)}
              offline={offlineIds.has(channel.id)}
              audioOn={activeAudioId === channel.id}
              onFocusAudio={() => focusAudio(channel.id)}
            />
          ))}
        </div>
      </YStack>
    </Panel>
  );
}

function StationTile({
  channel,
  hostRef,
  offline,
  audioOn,
  onFocusAudio,
}: {
  channel: LiveChannel;
  hostRef: (node: HTMLDivElement | null) => void;
  offline: boolean;
  audioOn: boolean;
  onFocusAudio: () => void;
}): React.JSX.Element {
  return (
    <YStack
      tabIndex={0}
      cursor="pointer"
      borderRadius="$2"
      overflow="hidden"
      backgroundColor="#000"
      borderWidth={1}
      borderColor={audioOn ? '#fff' : 'rgba(255,255,255,0.10)'}
      onMouseEnter={onFocusAudio}
      onFocus={onFocusAudio}
    >
      {/* 16:9 player host — YouTube replaces this box's child with its iframe. */}
      <YStack position="relative" width="100%" aspectRatio={16 / 9} backgroundColor="#000">
        <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
        {offline ? (
          <XStack
            position="absolute"
            top={0}
            left={0}
            right={0}
            bottom={0}
            alignItems="center"
            justifyContent="center"
            backgroundColor="rgba(0,0,0,0.85)"
          >
            <SizableText size="$1" color="$color9">
              offline
            </SizableText>
          </XStack>
        ) : null}
      </YStack>
      <XStack alignItems="center" gap="$1.5" paddingHorizontal="$2" paddingVertical="$1.5">
        <XStack width={6} height={6} borderRadius={999} backgroundColor="#ef4444" />
        <SizableText size="$1" color="$color12" numberOfLines={1} flex={1}>
          {channel.name}
        </SizableText>
        <SizableText size="$2" color={audioOn ? '$color12' : '$color9'} aria-hidden>
          {audioOn ? '🔊' : '🔇'}
        </SizableText>
      </XStack>
    </YStack>
  );
}
